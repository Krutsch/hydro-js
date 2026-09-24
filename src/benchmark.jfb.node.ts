// js-framework-benchmark-shaped end-to-end harness. Runs the upstream hydro-js
// and vanillajs apps in real Chromium, captures the click-to-paint trace, and
// samples heap/DOM/listener metrics through CDP.
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium, type Browser, type CDPSession, type Page } from "playwright-core";

const distDir = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(distDir);
const siteDir = join(distDir, ".jfb-benchmark", "site");
const buildScript = join(rootDir, "scripts", "build-jfb-bench.mjs");
const samples = positiveInt(flag("--samples") ?? process.env.JFB_SAMPLES, 10);
const only = flag("--only");
const baselinePath = flag("--baseline");
const writeBaselinePath = flag("--write-baseline");
const heapSnapshotDir = flag("--heap-snapshots");
const cpuProfileDir = flag("--cpu-profile-dir");
const memoryOnly = process.argv.includes("--memory-only");
const maxRegressionPercent = positiveNumber(flag("--max-regression-percent"), 20);
const asJson = process.argv.includes("--json");
const requestedPublishedVersion = flag("--published-version");
const operationFilter = only
  ? only.split(",").map((value) => value.trim())
  : undefined;

if (requestedPublishedVersion) {
  execFileSync(
    process.execPath,
    [buildScript, "--published-version", requestedPublishedVersion],
    { cwd: rootDir, stdio: "inherit" },
  );
}

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".eot": "application/vnd.ms-fontobject",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
const TRACE_CATEGORIES = [
  "blink.user_timing",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
];

type OperationName =
  | "create rows"
  | "replace all rows"
  | "partial update"
  | "select row"
  | "swap rows"
  | "remove row"
  | "create many rows"
  | "append rows to large table"
  | "clear rows";
type Implementation = "local" | "published" | "vanilla";
type TraceEvent = {
  name?: string;
  ph?: string;
  ts?: number;
  dur?: number;
  pid?: number;
  tid?: number;
  args?: { data?: { type?: string } };
};
type DurationOperation = {
  name: OperationName;
  additionalSamples?: number;
  selector: string;
  throttle: number;
  warmup: (page: Page) => Promise<void>;
  verify: (page: Page) => Promise<boolean>;
};
type DurationSample = {
  implementation: Implementation;
  operation: OperationName;
  sample: number;
  traceMs: number | null;
  fallbackMs: number;
};
type DurationResult = {
  implementation: Implementation;
  operation: OperationName;
  sampleCount: number;
  cpuRate: number;
  traceSamples: Array<number | null>;
  traceMedianMs: number | null;
  traceMinMs: number | null;
  fallbackSamples: number[];
  fallbackMedianMs: number;
  fallbackMinMs: number;
  ratioToVanilla: number | null;
  ok: boolean;
};
type MemoryMetrics = {
  heapMB: number;
  nodes: number;
  listeners: number;
  hydroKeys: number | null;
};
type HeapSnapshotSummary = {
  implementation: Implementation;
  state: string;
  file: string;
  topNodes: Array<{ type: string; name: string; count: number; selfMB: number }>;
};
type MemoryResult = {
  implementation: Implementation;
  ready: MemoryMetrics;
  run1k: MemoryMetrics;
  run10k: MemoryMetrics;
  createClear1: MemoryMetrics;
  createClear5: MemoryMetrics;
  createClear25: MemoryMetrics;
  hydroKeysStable: boolean;
  heapSnapshots: HeapSnapshotSummary[];
};
type Report = {
  generatedAt: string;
  config: { samples: number; viewport: string; traceCategories: string[] };
  results: DurationResult[];
  memory: MemoryResult[];
  pass: boolean;
};
type Baseline = {
  generatedAt: string;
  config: Report["config"];
  results: Array<
    Pick<
      DurationResult,
      | "implementation"
      | "operation"
      | "sampleCount"
      | "traceMedianMs"
      | "traceMinMs"
      | "fallbackMedianMs"
      | "ratioToVanilla"
    >
  >;
  memory: Array<
    Pick<
      MemoryResult,
      | "implementation"
      | "ready"
      | "run1k"
      | "run10k"
      | "createClear1"
      | "createClear5"
      | "createClear25"
      | "hydroKeysStable"
    >
  >;
};

const operations: DurationOperation[] = [
  {
    name: "create rows",
    selector: "#run",
    throttle: 1,
    warmup: async (page) => {
      await repeatRunClear(page, 5);
    },
    verify: (page) => hasRowCount(page, 1000),
  },
  {
    name: "replace all rows",
    selector: "#run",
    throttle: 1,
    warmup: async (page) => {
      for (let i = 0; i < 5; i++) await clickAndSettle(page, "#run");
    },
    verify: (page) => hasRowCount(page, 1000),
  },
  {
    name: "partial update",
    selector: "#update",
    throttle: 4,
    warmup: async (page) => {
      await clickAndSettle(page, "#run");
      for (let i = 0; i < 3; i++) await clickAndSettle(page, "#update");
    },
    verify: async (page) =>
      page.evaluate(() =>
        (document.querySelector("tbody>tr:nth-of-type(1)>td:nth-of-type(2)>a")
          ?.textContent ?? "").includes(" !!!"),
      ),
  },
  {
    name: "select row",
    additionalSamples: 10,
    selector: "tbody>tr:nth-of-type(2)>td:nth-of-type(2)>a",
    throttle: 4,
    warmup: async (page) => {
      await clickAndSettle(page, "#run");
      await clickAndSettle(page, "tbody>tr:nth-of-type(5)>td:nth-of-type(2)>a");
    },
    verify: async (page) =>
      page.evaluate(
        () =>
          document.querySelectorAll("tbody>tr.danger").length === 1 &&
          document.querySelector("tbody>tr:nth-of-type(2)")?.classList.contains("danger") ===
            true,
      ),
  },
  {
    name: "swap rows",
    selector: "#swaprows",
    throttle: 4,
    warmup: async (page) => {
      await clickAndSettle(page, "#run");
      for (let i = 0; i <= 5; i++) await clickAndSettle(page, "#swaprows");
    },
    verify: async (page) =>
      page.evaluate(
        () =>
          document.querySelector("tbody>tr:nth-of-type(2)>td:first-child")
            ?.textContent === "999",
      ),
  },
  {
    name: "remove row",
    selector: "tbody>tr:nth-of-type(4)>td:nth-of-type(3)>a>span",
    throttle: 2,
    warmup: async (page) => {
      await clickAndSettle(page, "#run");
      for (let i = 0; i < 5; i++) {
        const rowToClick = 9 - i;
        await clickAndSettle(
          page,
          `tbody>tr:nth-of-type(${rowToClick})>td:nth-of-type(3)>a>span`,
        );
      }
      await clickAndSettle(page, "tbody>tr:nth-of-type(6)>td:nth-of-type(3)>a>span");
      await clickAndSettle(page, "tbody>tr:nth-of-type(6)>td:nth-of-type(3)>a>span");
    },
    // jfb's remove init performs seven extra removal clicks in addition to
    // the five warmup loop iterations before the measured click.
    verify: (page) => hasRowCount(page, 992),
  },
  {
    name: "create many rows",
    selector: "#runlots",
    throttle: 1,
    warmup: async (page) => {
      await repeatRunClear(page, 5);
    },
    verify: (page) => hasRowCount(page, 10000),
  },
  {
    name: "append rows to large table",
    selector: "#add",
    throttle: 1,
    warmup: async (page) => {
      await repeatRunClear(page, 5);
      await clickAndSettle(page, "#run");
    },
    verify: (page) => hasRowCount(page, 2000),
  },
  {
    name: "clear rows",
    selector: "#clear",
    throttle: 4,
    warmup: async (page) => {
      await repeatRunClear(page, 5);
      await clickAndSettle(page, "#run");
    },
    verify: (page) => hasRowCount(page, 0),
  },
];

const { port, close } = await startStaticServer(siteDir);
const browser = await chromium.launch({
  args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"],
});
try {
  const implementations: Implementation[] = [
    "local",
    ...(await exists(join(siteDir, "published", "app.js")) ? ["published" as const] : []),
    "vanilla",
  ];
  const selectedOperations = operations.filter(
    (operation) =>
      !operationFilter ||
      operationFilter.includes(operation.name) ||
      operationFilter.includes(operationSlug(operation.name)),
  );
  if (selectedOperations.length === 0) {
    throw new Error(`No benchmark matches --only ${only}`);
  }

  if (cpuProfileDir) {
    await mkdir(resolve(rootDir, cpuProfileDir), { recursive: true });
  }
  const sampleRows: DurationSample[] = [];
  if (!memoryOnly) {
    for (const operation of selectedOperations) {
      const operationSamples = samples + (operation.additionalSamples ?? 0);
      for (let sample = 0; sample < operationSamples; sample++) {
        // Alternate the order to reduce systematic thermal / frequency bias.
        const order =
          sample % 2 === 0 ? implementations : [...implementations].reverse();
        for (const implementation of order) {
          const profilePath =
            cpuProfileDir && implementation === "local" && sample === 0
              ? join(resolve(rootDir, cpuProfileDir), `${operationSlug(operation.name)}.cpuprofile`)
              : undefined;
          const result = await measureSample(
            browser,
            port,
            implementation,
            operation,
            sample,
            profilePath,
          );
          sampleRows.push(result);
          if (!asJson) {
            console.log(
              `${operation.name.padEnd(31)} ${implementation.padEnd(10)} ` +
                `trace=${formatMs(result.traceMs)} fallback=${formatMs(result.fallbackMs)} ` +
                `(${sample + 1}/${operationSamples})`,
            );
          }
        }
      }
    }
  }

  const results = summarizeDurations(sampleRows, memoryOnly ? [] : selectedOperations, implementations);
  const memory = await Promise.all(
    implementations.map((implementation) =>
      measureMemory(browser, port, implementation, heapSnapshotDir),
    ),
  );
  const report: Report = {
    generatedAt: new Date().toISOString(),
    config: {
      samples,
      viewport: "1024x768",
      traceCategories: TRACE_CATEGORIES,
    },
    results,
    memory,
    pass:
      results.every((result) => result.ok) &&
      memory.every((result) => result.hydroKeysStable),
  };

  if (writeBaselinePath) {
    const target = resolve(rootDir, writeBaselinePath);
    await writeFile(target, JSON.stringify(toBaseline(report), null, 2) + "\n");
  }

  const baseline = baselinePath
    ? (JSON.parse(await readFile(resolve(rootDir, baselinePath), "utf8")) as Baseline)
    : undefined;
  const failures = baseline
    ? compareBaseline(report, baseline, maxRegressionPercent)
    : [];

  if (asJson) {
    console.log(JSON.stringify({ report, failures }, null, 2));
  } else {
    console.log(formatReport(report, failures, maxRegressionPercent));
  }
  process.exitCode = report.pass && failures.length === 0 ? 0 : 1;
} finally {
  await browser.close();
  await close();
}

async function measureSample(
  browser: Browser,
  port: number,
  implementation: Implementation,
  operation: DurationOperation,
  sample: number,
  cpuProfilePath?: string,
): Promise<DurationSample> {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  let cdp: CDPSession | undefined;
  try {
    cdp = await context.newCDPSession(page);
    await page.goto(
      pageUrl(port, implementation, false, !!cpuProfilePath),
      { waitUntil: "load" },
    );
    await page.waitForSelector("#run");
    await operation.warmup(page);

    const target = page.locator(operation.selector);
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error(`No click target for ${operation.name}`);
    const clickX = box.x + box.width / 2;
    const clickY = box.y + box.height / 2;

    if (operation.throttle !== 1) {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: operation.throttle });
    }

    await page.evaluate(() => {
      const target = window as typeof window & {
        __jfbFallback?: Promise<number>;
      };
      target.__jfbFallback = new Promise<number>((resolvePromise) => {
        window.addEventListener(
          "click",
          () => {
            const start = performance.now();
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolvePromise(performance.now() - start)),
            );
          },
          { capture: true, once: true },
        );
      });
    });

    if (cpuProfilePath) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
      await cdp.send("Profiler.start");
    }

    const events: TraceEvent[] = [];
    const onData = (payload: { value?: TraceEvent[] }) => {
      if (payload.value) events.push(...payload.value);
    };
    cdp.on("Tracing.dataCollected", onData);
    const tracingComplete = waitForTraceComplete(cdp);
    await cdp.send("Tracing.start", {
      transferMode: "ReportEvents",
      traceConfig: {
        enableSampling: false,
        enableSystrace: false,
        excludedCategories: [],
        includedCategories: TRACE_CATEGORIES,
      },
    });

    let fallbackMs: number;
    try {
      // Use raw CDP-backed mouse input after resolving the target outside the
      // trace. Locator.click injects Playwright hit-target checks into the page
      // and can dominate these small interaction measurements.
      await page.mouse.click(clickX, clickY);
      fallbackMs = await page.evaluate(() => {
        const target = window as typeof window & {
          __jfbFallback?: Promise<number>;
        };
        if (!target.__jfbFallback) throw new Error("Click fallback timer not armed");
        return target.__jfbFallback;
      });
      await yieldToHydroScheduler(page);
    } finally {
      if (cpuProfilePath) {
        const { profile } = await cdp.send("Profiler.stop");
        await writeFile(cpuProfilePath, JSON.stringify(profile));
        const summary = summarizeCpuProfile(profile);
        const log = asJson ? console.error : console.log;
        log(`CPU self-time profile ${operation.name} (${cpuProfilePath})`);
        for (const entry of summary) {
          log(`  ${entry.functionName.padEnd(30)} ${entry.selfMs.toFixed(2)} ms  ${entry.location}`);
        }
        await cdp.send("Profiler.disable").catch(() => undefined);
      }
      if (operation.throttle !== 1) {
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }).catch(() => undefined);
      }
      await cdp.send("Tracing.end");
      await tracingComplete;
      cdp.off("Tracing.dataCollected", onData);
    }

    const traceMs = clickToLastPaintMs(events);
    const ok = await operation.verify(page);
    if (!ok) {
      throw new Error(
        `jfb validation failed: ${implementation} / ${operation.name} / sample ${sample + 1}`,
      );
    }
    return { implementation, operation: operation.name, sample, traceMs, fallbackMs };
  } finally {
    await cdp?.detach().catch(() => undefined);
    await context.close();
  }
}

function summarizeCpuProfile(profile: any) {
  const byId = new Map<number, any>(profile.nodes.map((node: any) => [node.id, node]));
  const selfTime = new Map<number, number>();
  const samples: number[] = profile.samples ?? [];
  const deltas: number[] = profile.timeDeltas ?? [];
  for (let index = 0; index < samples.length; index++) {
    const id = samples[index];
    selfTime.set(id, (selfTime.get(id) ?? 0) + (deltas[index] ?? 1000));
  }
  return [...selfTime.entries()]
    .map(([id, micros]) => {
      const frame = byId.get(id)?.callFrame ?? {};
      return {
        functionName: frame.functionName || "(anonymous)",
        location: `${frame.url || "<native>"}:${(frame.lineNumber ?? -1) + 1}:${(frame.columnNumber ?? -1) + 1}`,
        selfMs: micros / 1000,
      };
    })
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 15);
}

function waitForTraceComplete(cdp: CDPSession) {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      cdp.off("Tracing.tracingComplete", onComplete);
      rejectPromise(new Error("Timed out waiting for Tracing.tracingComplete"));
    }, 30000);
    const onComplete = () => {
      clearTimeout(timeout);
      resolvePromise();
    };
    cdp.once("Tracing.tracingComplete", onComplete);
  });
}

function clickToLastPaintMs(events: TraceEvent[]): number | null {
  const clicks = events.filter(
    (event) =>
      event.name === "EventDispatch" &&
      event.ph === "X" &&
      event.args?.data?.type === "click" &&
      typeof event.ts === "number",
  );
  const click = clicks.at(-1);
  if (!click || click.ts === undefined) return null;

  const ends = events
    .filter(
      (event) =>
        event.pid === click.pid &&
        (event.name === "Commit" || event.name === "Paint") &&
        event.ph === "X" &&
        typeof event.ts === "number" &&
        event.ts >= click.ts!,
    )
    .map((event) => (event.ts ?? 0) + (event.dur ?? 0));
  if (ends.length === 0) return null;
  return (Math.max(...ends) - click.ts) / 1000;
}

async function measureMemory(
  browser: Browser,
  port: number,
  implementation: Implementation,
  snapshotDir?: string,
): Promise<MemoryResult> {
  const snapshots: HeapSnapshotSummary[] = [];
  const readyRun = await withMemoryPage(browser, port, implementation, async (page, cdp) => {
    const ready = await collectMemory(page, cdp);
    if (snapshotDir && implementation !== "vanilla") {
      snapshots.push(
        await takeHeapSnapshot(cdp, snapshotDir, implementation, "ready"),
      );
    }

    await clickAndSettle(page, "#run");
    const run1k = await collectMemory(page, cdp);
    if (snapshotDir && implementation !== "vanilla") {
      snapshots.push(
        await takeHeapSnapshot(cdp, snapshotDir, implementation, "run-1k"),
      );
    }

    await clickAndSettle(page, "#runlots");
    const run10k = await collectMemory(page, cdp);
    return { ready, run1k, run10k };
  });

  const createClear1 = await memoryAfterCycles(browser, port, implementation, 1);
  const createClear5 = await memoryAfterCycles(browser, port, implementation, 5, snapshotDir, snapshots);
  const createClear25 = await memoryAfterCycles(browser, port, implementation, 25);
  // The app starts with a selected=-1 signal, then clear() sends null and
  // removes that key. Compare successive post-clear snapshots instead of the
  // initial page (which legitimately has one extra signal key).
  const hydroKeysStable =
    implementation === "vanilla" ||
    [createClear5, createClear25].every(
      (metrics) => metrics.hydroKeys === createClear1.hydroKeys,
    );

  return {
    implementation,
    ...readyRun,
    createClear1,
    createClear5,
    createClear25,
    hydroKeysStable,
    heapSnapshots: snapshots,
  };
}

async function memoryAfterCycles(
  browser: Browser,
  port: number,
  implementation: Implementation,
  cycles: number,
  snapshotDir?: string,
  snapshots?: HeapSnapshotSummary[],
) {
  return withMemoryPage(browser, port, implementation, async (page, cdp) => {
    await repeatRunClear(page, cycles);
    const metrics = await collectMemory(page, cdp);
    if (cycles === 5 && snapshotDir && snapshots && implementation !== "vanilla") {
      snapshots.push(
        await takeHeapSnapshot(cdp, snapshotDir, implementation, "create-clear-5"),
      );
    }
    return metrics;
  });
}

async function withMemoryPage<T>(
  browser: Browser,
  port: number,
  implementation: Implementation,
  run: (page: Page, cdp: CDPSession) => Promise<T>,
) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send("Performance.enable");
    await page.goto(pageUrl(port, implementation, implementation !== "vanilla"), {
      waitUntil: "load",
    });
    await page.waitForSelector("#run");
    return await run(page, cdp);
  } finally {
    await cdp.detach().catch(() => undefined);
    await context.close();
  }
}

async function collectMemory(
  page: Page,
  cdp: CDPSession,
): Promise<MemoryMetrics> {
  await cdp.send("HeapProfiler.collectGarbage");
  const [{ metrics }, hydroKeys] = await Promise.all([
    cdp.send("Performance.getMetrics"),
    page.evaluate(() => {
      const target = window as typeof window & {
        __hydroKeyCount?: () => number;
      };
      return target.__hydroKeyCount?.() ?? null;
    }),
  ]);
  const value = (name: string) => {
    const metric = metrics.find((entry) => entry.name === name);
    if (!metric) throw new Error(`Missing Chrome performance metric: ${name}`);
    return metric.value;
  };
  return {
    heapMB: value("JSHeapUsedSize") / 1048576,
    nodes: value("Nodes"),
    listeners: value("JSEventListeners"),
    hydroKeys,
  };
}

async function takeHeapSnapshot(
  cdp: CDPSession,
  snapshotDir: string,
  implementation: Implementation,
  state: string,
): Promise<HeapSnapshotSummary> {
  const directory = resolve(rootDir, snapshotDir);
  await mkdir(directory, { recursive: true });
  const file = join(directory, `${implementation}-${state}.heapsnapshot`);
  const chunks: string[] = [];
  const onChunk = (payload: { chunk: string }) => chunks.push(payload.chunk);
  await cdp.send("HeapProfiler.enable");
  cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
  try {
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  } finally {
    cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
    await cdp.send("HeapProfiler.disable").catch(() => undefined);
  }

  const contents = chunks.join("");
  if (!contents) throw new Error(`Chrome produced an empty heap snapshot: ${file}`);
  await writeFile(file, contents);
  const snapshot = JSON.parse(contents) as {
    snapshot: {
      meta: { node_fields: string[]; node_types: Array<string[] | string> };
    };
    nodes: number[];
    strings: string[];
  };
  const fields = snapshot.snapshot.meta.node_fields;
  const typeIndex = fields.indexOf("type");
  const nameIndex = fields.indexOf("name");
  const sizeIndex = fields.indexOf("self_size");
  const width = fields.length;
  const typeNames = snapshot.snapshot.meta.node_types[typeIndex] as string[];
  const totals = new Map<string, { type: string; name: string; count: number; bytes: number }>();
  for (let index = 0; index < snapshot.nodes.length; index += width) {
    const type = typeNames[snapshot.nodes[index + typeIndex]] ?? "unknown";
    const rawName = (snapshot.strings[snapshot.nodes[index + nameIndex]] ?? "unknown").replace(/\s+/g, " ");
    const name = rawName.length > 80 ? `${rawName.slice(0, 77)}...` : rawName;
    const key = `${type}:${name}`;
    let total = totals.get(key);
    if (!total) {
      total = { type, name, count: 0, bytes: 0 };
      totals.set(key, total);
    }
    total.count++;
    total.bytes += snapshot.nodes[index + sizeIndex];
  }
  const topNodes = [...totals.values()]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 20)
    .map(({ type, name, count, bytes }) => ({
      type,
      name,
      count,
      selfMB: bytes / 1048576,
    }));
  return { implementation, state, file, topNodes };
}

function summarizeDurations(
  rows: DurationSample[],
  selected: DurationOperation[],
  implementations: Implementation[],
): DurationResult[] {
  const summaries: DurationResult[] = [];
  for (const operation of selected) {
    const operationSamples = samples + (operation.additionalSamples ?? 0);
    const vanillaBySample = new Map(
      rows
        .filter(
          (row) => row.operation === operation.name && row.implementation === "vanilla" && row.traceMs !== null,
        )
        .map((row) => [row.sample, row.traceMs!]),
    );
    for (const implementation of implementations) {
      const matching = rows.filter(
        (row) => row.operation === operation.name && row.implementation === implementation,
      );
      const traceSamples = matching.map((row) => row.traceMs);
      const validTraceSamples = traceSamples.filter(
        (value): value is number => value !== null,
      );
      const fallbackSamples = matching.map((row) => row.fallbackMs);
      const traceMedian = validTraceSamples.length ? median(validTraceSamples) : null;
      const pairedRatios = matching
        .map((row) => {
          const vanillaMs = vanillaBySample.get(row.sample);
          return row.traceMs !== null && vanillaMs ? row.traceMs / vanillaMs : null;
        })
        .filter((value): value is number => value !== null);
      summaries.push({
        implementation,
        operation: operation.name,
        sampleCount: operationSamples,
        cpuRate: operation.throttle,
        traceSamples,
        traceMedianMs: traceMedian,
        traceMinMs: validTraceSamples.length ? Math.min(...validTraceSamples) : null,
        fallbackSamples,
        fallbackMedianMs: median(fallbackSamples),
        fallbackMinMs: Math.min(...fallbackSamples),
        // Pair each hydro sample with the vanilla sample from the same
        // alternating run; this is less sensitive to machine drift than
        // dividing two independent medians.
        ratioToVanilla:
          implementation === "vanilla"
            ? 1
            : pairedRatios.length
              ? median(pairedRatios)
              : null,
        ok:
          matching.length === operationSamples &&
          matching.every((row) => row.traceMs !== null),
      });
    }
  }
  return summaries;
}

async function clickAndSettle(page: Page, selector: string) {
  await page.locator(selector).click({ timeout: 15000 });
  await page.evaluate(
    () =>
      new Promise<void>((resolvePromise) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolvePromise())),
      ),
  );
  await yieldToHydroScheduler(page);
}

async function repeatRunClear(page: Page, count: number) {
  for (let index = 0; index < count; index++) {
    await clickAndSettle(page, "#run");
    await clickAndSettle(page, "#clear");
  }
}

async function yieldToHydroScheduler(page: Page) {
  await page.evaluate(async () => {
    const candidate = window as typeof window & {
      scheduler?: { postTask?: (callback: () => void, options: { priority: string }) => Promise<void> };
      requestIdleCallback?: (callback: () => void) => number;
    };
    if (candidate.scheduler?.postTask) {
      await candidate.scheduler.postTask(() => undefined, {
        priority: "user-blocking",
      });
    } else if (candidate.requestIdleCallback) {
      await new Promise<void>((resolvePromise) => {
        candidate.requestIdleCallback!(() => resolvePromise());
      });
    } else {
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 0));
    }
  });
}

async function hasRowCount(page: Page, expected: number) {
  return page.locator("tbody>tr").count().then((count) => count === expected);
}

function pageUrl(
  port: number,
  implementation: Implementation,
  diagnostic = false,
  profile = false,
) {
  const directory =
    profile && implementation === "local"
      ? "profile-local"
      : diagnostic && implementation !== "vanilla"
        ? `diagnostic-${implementation}`
        : implementation;
  return `http://127.0.0.1:${port}/${directory}/index.html`;
}

function summarizeNumbers(values: number[]) {
  return { median: median(values), min: Math.min(...values) };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function toBaseline(report: Report): Baseline {
  return {
    generatedAt: report.generatedAt,
    config: report.config,
    results: report.results.map(
      ({
        implementation,
        operation,
        sampleCount,
        traceMedianMs,
        traceMinMs,
        fallbackMedianMs,
        ratioToVanilla,
      }) => ({
        implementation,
        operation,
        sampleCount,
        traceMedianMs,
        traceMinMs,
        fallbackMedianMs,
        ratioToVanilla,
      }),
    ),
    memory: report.memory.map(
      ({
        implementation,
        ready,
        run1k,
        run10k,
        createClear1,
        createClear5,
        createClear25,
        hydroKeysStable,
      }) => ({
        implementation,
        ready,
        run1k,
        run10k,
        createClear1,
        createClear5,
        createClear25,
        hydroKeysStable,
      }),
    ),
  };
}

function compareBaseline(report: Report, baseline: Baseline, tolerancePct: number) {
  if (
    baseline.config.samples !== report.config.samples ||
    baseline.config.viewport !== report.config.viewport
  ) {
    return [
      `JFB baseline workload mismatch (samples ${baseline.config.samples} vs ${report.config.samples}, ` +
        `viewport ${baseline.config.viewport} vs ${report.config.viewport}); regenerate the baseline`,
    ];
  }

  const baselineByKey = new Map(
    baseline.results.map((entry) => [resultKey(entry), entry]),
  );
  const failures: string[] = [];
  for (const result of report.results) {
    if (result.implementation === "vanilla" || result.ratioToVanilla === null) continue;
    const baselineEntry = baselineByKey.get(resultKey(result));
    if (!baselineEntry) continue;
    if (baselineEntry.sampleCount !== result.sampleCount) {
      failures.push(
        `${result.implementation}/${result.operation}: sample count ${result.sampleCount} ` +
          `does not match baseline ${baselineEntry.sampleCount}`,
      );
      continue;
    }
    const before = baselineEntry.ratioToVanilla;
    if (before === null || before <= 0) continue;
    const allowed = before * (1 + tolerancePct / 100);
    if (result.ratioToVanilla > allowed) {
      failures.push(
        `${result.implementation}/${result.operation}: ratio ${result.ratioToVanilla.toFixed(3)} ` +
          `exceeds baseline ${before.toFixed(3)} by more than ${tolerancePct}%`,
      );
    }
  }
  return failures;
}

function formatReport(report: Report, failures: string[], tolerancePct: number) {
  const lines = [
    "",
    "hydro-js js-framework-benchmark harness",
    "=".repeat(116),
    `${"operation".padEnd(31)} ${"impl".padEnd(10)} ${"CPU".padStart(4)} ${"trace med".padStart(11)} ${"trace min".padStart(11)} ${"fallback med".padStart(13)} ${"vs vanilla".padStart(12)} status`,
    "-".repeat(116),
  ];
  for (const result of report.results) {
    lines.push(
      `${result.operation.padEnd(31)} ${result.implementation.padEnd(10)} ${`${result.cpuRate}x`.padStart(4)} ` +
        `${formatMs(result.traceMedianMs).padStart(11)} ${formatMs(result.traceMinMs).padStart(11)} ` +
        `${formatMs(result.fallbackMedianMs).padStart(13)} ${formatRatio(result.ratioToVanilla).padStart(12)} ` +
        `${result.ok ? "ok" : "NO TRACE"}`,
    );
  }
  lines.push("-".repeat(116));
  lines.push("memory after forced GC (CDP)");
  lines.push(
    `${"impl".padEnd(10)} ${"state".padEnd(17)} ${"heap MB".padStart(9)} ${"nodes".padStart(9)} ${"listeners".padStart(11)} ${"hydro keys".padStart(11)}`,
  );
  for (const entry of report.memory) {
    for (const [name, metrics] of [
      ["ready", entry.ready],
      ["run 1k", entry.run1k],
      ["run 10k", entry.run10k],
      ["create/clear x1", entry.createClear1],
      ["create/clear x5", entry.createClear5],
      ["create/clear x25", entry.createClear25],
    ] as const) {
      lines.push(
        `${entry.implementation.padEnd(10)} ${name.padEnd(17)} ${metrics.heapMB.toFixed(2).padStart(9)} ` +
          `${String(metrics.nodes).padStart(9)} ${String(metrics.listeners).padStart(11)} ${String(metrics.hydroKeys ?? "-").padStart(11)}`,
      );
    }
  }
  for (const entry of report.memory) {
    const delta1k = (entry.run1k.heapMB - entry.ready.heapMB) * 1024;
    const delta10k = (entry.run10k.heapMB - entry.ready.heapMB) * 1024;
    lines.push(
      `${entry.implementation.padEnd(10)} retained heap: 1k ${delta1k.toFixed(0)} KB ` +
        `(about ${(delta1k / 1000).toFixed(2)} KB/row), 10k ${delta10k.toFixed(0)} KB ` +
        `(about ${(delta10k / 10000).toFixed(2)} KB/row); root keys stable: ${entry.hydroKeysStable ? "yes" : "NO"}`,
    );
    for (const snapshot of entry.heapSnapshots) {
      lines.push(`heap snapshot ${snapshot.implementation}/${snapshot.state}: ${snapshot.file}`);
      for (const node of snapshot.topNodes.slice(0, 8)) {
        lines.push(`  ${node.type.padEnd(10)} ${node.name.padEnd(32)} ${node.selfMB.toFixed(2)} MB (${node.count})`);
      }
    }
  }
  if (failures.length) {
    lines.push("-".repeat(116));
    for (const failure of failures) lines.push(`FAIL: ${failure}`);
  }
  lines.push("=".repeat(116));
  lines.push(
    failures.length
      ? `RESULT: FAIL (ratio regression > ${tolerancePct}%)`
      : report.pass
        ? "RESULT: PASS"
        : "RESULT: FAIL (missing trace or invalid state)",
  );
  lines.push("");
  return lines.join("\n");
}

function resultKey(result: { implementation: string; operation: string }) {
  return `${result.implementation}/${result.operation}`;
}

function formatMs(value: number | null) {
  return value === null ? "n/a" : `${value.toFixed(2)}ms`;
}

function formatRatio(value: number | null) {
  return value === null ? "n/a" : `${value.toFixed(2)}x`;
}

function operationSlug(value: OperationName) {
  return value.toLowerCase().replaceAll(" ", "-");
}

function positiveInt(raw: string | undefined, fallback: number) {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Expected a positive integer, got ${raw}`);
  }
  return value;
}

function positiveNumber(raw: string | undefined, fallback: number) {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Expected a non-negative number, got ${raw}`);
  }
  return value;
}

function flag(name: string) {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

async function exists(path: string) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

function startStaticServer(root: string): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer(async (request, response) => {
    try {
      const urlPath = decodeURIComponent((request.url ?? "/").split("?")[0]);
      const filePath = resolve(root, `.${urlPath}`);
      if (filePath !== root && !filePath.startsWith(root + sep)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  return new Promise((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolvePromise({
        port,
        close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
      });
    });
  });
}
