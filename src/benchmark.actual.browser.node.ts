import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { availableParallelism, cpus } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const distDir = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(distDir);
const repeats = Number(process.env.ACTUAL_BENCHMARK_REPEATS ?? 5);
const warmups = Number(process.env.ACTUAL_BENCHMARK_WARMUPS ?? 3);
const memoryCycles = Number(process.env.ACTUAL_MEMORY_CYCLES ?? 3);
type ParsedArgs = {
  operation?: string;
  writeBaselinePath?: string;
  baselinePath?: string;
  profileMode?: string;
  profileOutput?: string;
  memoryMode: boolean;
};

const valueFlags = new Set([
  "--write-baseline",
  "--baseline",
  "--profile",
  "--profile-output",
]);
const booleanFlags = new Set(["--memory"]);

function parseArgs(input: string[]): ParsedArgs {
  const parsed: ParsedArgs = { memoryMode: false };
  for (let index = 0; index < input.length; index++) {
    const argument = input[index];
    if (!argument.startsWith("--")) {
      if (parsed.operation) {
        throw new Error(`Unexpected extra operation ${argument}`);
      }
      parsed.operation = argument;
      continue;
    }

    if (booleanFlags.has(argument)) {
      parsed.memoryMode = true;
      continue;
    }
    if (!valueFlags.has(argument)) {
      throw new Error(`Unknown option ${argument}`);
    }

    const value = input[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    if (argument === "--write-baseline") parsed.writeBaselinePath = value;
    if (argument === "--baseline") parsed.baselinePath = value;
    if (argument === "--profile") parsed.profileMode = value;
    if (argument === "--profile-output") parsed.profileOutput = value;
  }
  return parsed;
}

const parsedArgs = parseArgs(process.argv.slice(2));
const requestedOperation = parsedArgs.operation;
const writeBaselinePath = parsedArgs.writeBaselinePath;
const baselinePath = parsedArgs.baselinePath;
const profileMode = parsedArgs.profileMode;
const profileOutput = parsedArgs.profileOutput;
const memoryMode = parsedArgs.memoryMode;
const maxRegressionPercent = Number(
  process.env.ACTUAL_MAX_REGRESSION_PERCENT ?? 15,
);
const minRegressionMs = Number(process.env.ACTUAL_MIN_REGRESSION_MS ?? 0.25);
const maxFrameRegressionPercent = Number(
  process.env.ACTUAL_MAX_FRAME_REGRESSION_PERCENT ?? 50,
);
const minFrameRegressionMs = Number(
  process.env.ACTUAL_MIN_FRAME_REGRESSION_MS ?? 10,
);
const operations = [
  "create",
  "replace",
  "create-many",
  "append",
  "update",
  "select",
  "swap",
  "remove",
  "clear",
] as const;

type Operation = (typeof operations)[number];
type Sample = {
  elapsedMs: number;
  frameElapsedMs: number;
  passed: boolean;
};
type BrowserResult = {
  elapsedMs: number;
  frameElapsedMs: number;
  rowCount: number;
  selectedCount: number;
  firstLabel: string;
  passed: boolean;
};

const selectedOperations = requestedOperation
  ? operations.filter((operation) => operation === requestedOperation)
  : operations;
if (selectedOperations.length === 0) {
  throw new Error(
    `Unknown operation ${requestedOperation}. Expected one of ${operations.join(", ")}`,
  );
}
if (
  profileMode &&
  profileMode !== "cpu" &&
  profileMode !== "allocation" &&
  profileMode !== "timeline"
) {
  throw new Error(
    `Unknown profile mode ${profileMode}. Expected cpu, allocation, or timeline`,
  );
}
if (profileMode && !profileOutput) {
  throw new Error("--profile requires --profile-output");
}
if (profileOutput && !profileMode) {
  throw new Error("--profile-output requires --profile");
}
if (profileMode && !requestedOperation) {
  throw new Error("--profile requires one operation");
}
if (profileMode && (memoryMode || baselinePath || writeBaselinePath)) {
  throw new Error(
    "--profile cannot be combined with --memory, --baseline, or --write-baseline",
  );
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

async function buildActualApp(minify: boolean) {
  await build({
    absWorkingDir: rootDir,
    entryPoints: ["actual.tsx"],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "esnext",
    jsxFactory: "h",
    jsxFragment: "Fragment",
    minify,
    outfile: resolve(distDir, "benchmark.actual.app.js"),
    logLevel: "silent",
  });
}

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const urlPath = decodeURIComponent((request.url ?? "/").split("?")[0]);
      const filePath = join(rootDir, urlPath);
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
  return new Promise<{ port: number; close: () => Promise<void> }>(
    (resolvePromise) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        resolvePromise({
          port,
          close: () =>
            new Promise((resolveClose) => server.close(() => resolveClose())),
        });
      });
    },
  );
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function spread(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.1)];
  const high = sorted[Math.floor(sorted.length * 0.9)];
  return low ? ((high - low) / low) * 100 : 0;
}

async function measure(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  port: number,
  operation: Operation,
): Promise<BrowserResult> {
  const context = await browser.newContext();
  const page = await context.newPage();
  let pageError: string | undefined;
  page.on("pageerror", (error) => {
    pageError = error.stack || String(error);
  });
  try {
    await page.goto(
      `http://127.0.0.1:${port}/src/benchmark.actual.browser.html`,
      { waitUntil: "load" },
    );
    await page.waitForFunction(
      "window.__actualBenchmark && typeof window.__actualBenchmark.run === 'function'",
    );
    const result = await page.evaluate((name) => {
      return window.__actualBenchmark!.run(name);
    }, operation);
    if (pageError) throw new Error(pageError);
    return result;
  } finally {
    await context.close();
  }
}

async function measureProfile(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  port: number,
  operation: Operation,
  mode: "cpu" | "allocation" | "timeline",
): Promise<{ result: BrowserResult; profile?: unknown; trace: string }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  const tracingComplete = new Promise<{ stream?: string }>((resolvePromise) => {
    client.once("Tracing.tracingComplete", resolvePromise);
  });
  let tracing = false;
  let profiling = false;
  let pageError: string | undefined;
  page.on("pageerror", (error) => {
    pageError = error.stack || String(error);
  });
  try {
    await page.goto(
      `http://127.0.0.1:${port}/src/benchmark.actual.browser.html?profile=${mode}`,
      { waitUntil: "load" },
    );
    await page.waitForFunction(
      "window.__actualBenchmark && typeof window.__actualBenchmark.run === 'function'",
    );
    await client.send("Tracing.start", {
      categories:
        "devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline" +
        (mode === "timeline" ? ",disabled-by-default-v8.cpu_profiler" : ""),
      transferMode: "ReturnAsStream",
    });
    tracing = true;
    if (mode === "cpu") {
      await client.send("Profiler.enable");
      await client.send("Profiler.setSamplingInterval", { interval: 1000 });
      await client.send("Profiler.start");
      profiling = true;
    } else if (mode === "allocation") {
      await client.send("HeapProfiler.enable");
      await client.send("HeapProfiler.startSampling", {
        samplingInterval: 32768,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
      });
      profiling = true;
    }
    const result = await page.evaluate((name) => {
      return window.__actualBenchmark!.run(name);
    }, operation);
    let profile: unknown;
    if (mode === "cpu") {
      profile = (await client.send("Profiler.stop")).profile;
      profiling = false;
    } else if (mode === "allocation") {
      profile = (await client.send("HeapProfiler.stopSampling")).profile;
      profiling = false;
    }
    await client.send("Tracing.end");
    tracing = false;
    const completed = await tracingComplete;
    if (!completed.stream) throw new Error("Tracing did not return a stream");

    let trace = "";
    let endOfStream = false;
    while (!endOfStream) {
      const chunk = (await client.send("IO.read", {
        handle: completed.stream,
      })) as { data?: string; eof?: boolean; base64Encoded?: boolean };
      trace += chunk.base64Encoded
        ? Buffer.from(chunk.data ?? "", "base64").toString("utf8")
        : (chunk.data ?? "");
      endOfStream = Boolean(chunk.eof);
    }
    await client.send("IO.close", { handle: completed.stream });
    if (pageError) throw new Error(pageError);
    return { result, profile, trace };
  } finally {
    if (profiling) {
      await client
        .send(mode === "cpu" ? "Profiler.stop" : "HeapProfiler.stopSampling")
        .catch(() => undefined);
    }
    if (tracing) {
      await client.send("Tracing.end").catch(() => undefined);
      await tracingComplete.catch(() => undefined);
    }
    if (mode === "cpu") {
      await client.send("Profiler.disable").catch(() => undefined);
    }
    if (mode === "allocation") {
      await client.send("HeapProfiler.disable").catch(() => undefined);
    }
    await client.detach().catch(() => undefined);
    await context.close();
  }
}

async function measureMemory(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  port: number,
  cycles: number,
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const client = await context.newCDPSession(page);

  async function collectGarbage() {
    await client.send("HeapProfiler.collectGarbage");
    await page.waitForTimeout(25);
    await client.send("HeapProfiler.collectGarbage");
  }

  async function snapshot() {
    const heap = (await client.send("Runtime.getHeapUsage")) as {
      usedSize: number;
    };
    const dom = (await client.send("Memory.getDOMCounters")) as {
      nodes: number;
      jsEventListeners: number;
    };
    return {
      heapUsedBytes: heap.usedSize,
      domNodes: dom.nodes,
      jsEventListeners: dom.jsEventListeners,
    };
  }

  try {
    await page.goto(
      `http://127.0.0.1:${port}/src/benchmark.actual.browser.html`,
      { waitUntil: "load" },
    );
    await page.waitForFunction(
      "window.__actualBenchmark && typeof window.__actualBenchmark.memory === 'function'",
    );
    await collectGarbage();
    const before = await snapshot();
    const result = await page.evaluate((count) => {
      return window.__actualBenchmark!.memory(count);
    }, cycles);
    await collectGarbage();
    const aliveAfterReturn = await page.evaluate(() =>
      window.__actualBenchmark!.memorySurvivors(),
    );
    const afterReturn = await snapshot();
    await page.evaluate(() => window.__actualBenchmark!.releaseMemoryRefs());
    await collectGarbage();
    const afterRelease = await snapshot();
    return {
      ...result,
      aliveAfterReturn,
      heapBeforeBytes: before.heapUsedBytes,
      heapAfterReturnBytes: afterReturn.heapUsedBytes,
      heapAfterReleaseBytes: afterRelease.heapUsedBytes,
      heapDeltaBytes: afterRelease.heapUsedBytes - before.heapUsedBytes,
      domBeforeNodes: before.domNodes,
      domAfterReturnNodes: afterReturn.domNodes,
      domAfterReleaseNodes: afterRelease.domNodes,
      listenersBefore: before.jsEventListeners,
      listenersAfterReturn: afterReturn.jsEventListeners,
      listenersAfterRelease: afterRelease.jsEventListeners,
      passed: aliveAfterReturn === 0,
    };
  } finally {
    await client.detach().catch(() => undefined);
    await context.close();
  }
}

async function main() {
  if (!Number.isInteger(repeats) || repeats < 1) {
    throw new Error("ACTUAL_BENCHMARK_REPEATS must be a positive integer");
  }
  if (!Number.isInteger(warmups) || warmups < 0) {
    throw new Error("ACTUAL_BENCHMARK_WARMUPS must be a non-negative integer");
  }
  if (memoryMode && (!Number.isInteger(memoryCycles) || memoryCycles < 1)) {
    throw new Error("ACTUAL_MEMORY_CYCLES must be a positive integer");
  }

  await buildActualApp(!profileMode);
  const { port, close } = await startStaticServer();
  const browser = await chromium.launch(
    memoryMode
      ? { args: ["--js-flags=--expose-gc", "--enable-precise-memory-info"] }
      : undefined,
  );
  try {
    if (memoryMode) {
      const result = await measureMemory(browser, port, memoryCycles);
      console.log(JSON.stringify({ fixture: "actual.tsx", result }, null, 2));
      process.exitCode = result.passed ? 0 : 1;
      return;
    }

    if (profileMode) {
      for (let index = 0; index < warmups; index++) {
        const result = await measure(browser, port, selectedOperations[0]);
        if (!result.passed)
          throw new Error(`Profile warmup ${index + 1} failed`);
      }
    }

    if (profileMode) {
      const operation = selectedOperations[0];
      const { result, profile, trace } = await measureProfile(
        browser,
        port,
        operation,
        profileMode as "cpu" | "allocation" | "timeline",
      );
      const outputPath = resolve(rootDir, profileOutput!);
      const traceOutput =
        profileMode === "timeline" ? outputPath : `${outputPath}.trace.json`;
      const metadataOutput = `${outputPath}.meta.json`;
      const bundleOutput = `${outputPath}.app.js`;
      await mkdir(dirname(outputPath), { recursive: true });
      if (profileMode !== "timeline") {
        await writeFile(outputPath, JSON.stringify(profile, null, 2) + "\n");
      }
      await writeFile(traceOutput, trace);
      const bundle = await readFile(
        resolve(distDir, "benchmark.actual.app.js"),
      );
      await writeFile(bundleOutput, bundle);
      const sourceHashes: Record<string, string> = {};
      for (const path of ["actual.tsx", "src/library.ts", "dist/library.js"]) {
        sourceHashes[path] = createHash("sha256")
          .update(await readFile(resolve(rootDir, path)))
          .digest("hex");
      }
      const processStatus =
        process.platform === "linux"
          ? await readFile("/proc/self/status", "utf8").catch(() => "")
          : "";
      const report = {
        fixture: "actual.tsx",
        operation,
        generatedAt: new Date().toISOString(),
        metadata: {
          bundle: "unminified",
          browser: browser.version(),
          node: process.version,
          platform: process.platform,
          cpuModel: cpus()[0]?.model,
          availableParallelism: availableParallelism(),
          cpuAffinity: processStatus.match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1],
          sourceHashes,
          bundleSha256: createHash("sha256").update(bundle).digest("hex"),
        },
        config: {
          samples: 1,
          warmups,
          context: "fresh",
          profileMode,
          captureScope:
            "run including setup, handler, frames, and verification",
          cpuSamplingIntervalUs: profileMode === "cpu" ? 1000 : undefined,
          allocationSamplingIntervalBytes:
            profileMode === "allocation" ? 32768 : undefined,
          includeCollectedObjects:
            profileMode === "allocation" ? true : undefined,
        },
        profileOutput: outputPath,
        traceOutput,
        metadataOutput,
        bundleOutput,
        result,
      };
      const reportJson = JSON.stringify(report, null, 2) + "\n";
      await writeFile(metadataOutput, reportJson);
      console.log(reportJson);
      process.exitCode = result.passed ? 0 : 1;
      return;
    }

    const results = [];
    for (const operation of selectedOperations) {
      const samples: Sample[] = [];
      for (let index = 0; index < warmups + repeats; index++) {
        const result = await measure(browser, port, operation);
        if (index >= warmups) {
          samples.push({
            elapsedMs: result.elapsedMs,
            frameElapsedMs: result.frameElapsedMs,
            passed: result.passed,
          });
        }
      }
      const timings = samples.map((sample) => sample.elapsedMs);
      const frameTimings = samples.map((sample) => sample.frameElapsedMs);
      results.push({
        operation,
        samples: timings,
        minMs: Math.min(...timings),
        medianMs: median(timings),
        spreadPct: spread(timings),
        frameSamples: frameTimings,
        frameMedianMs: median(frameTimings),
        passed: samples.every((sample) => sample.passed),
      });
    }
    const report = {
      generatedAt: new Date().toISOString(),
      metadata: {
        fixture: "actual.tsx",
        timing: "handler duration plus two requestAnimationFrame callbacks",
        bundle: "minified",
        node: process.version,
        browser: browser.version(),
        platform: process.platform,
      },
      config: { repeats, warmups },
      results,
    };
    const failures: string[] = [];

    if (writeBaselinePath) {
      await writeFile(
        resolve(rootDir, writeBaselinePath),
        JSON.stringify(report, null, 2) + "\n",
      );
    }

    if (baselinePath) {
      const baseline = JSON.parse(
        await readFile(resolve(rootDir, baselinePath), "utf8"),
      ) as typeof report;
      for (const key of [
        "fixture",
        "timing",
        "bundle",
        "browser",
        "platform",
      ] as const) {
        if (baseline.metadata?.[key] !== report.metadata[key]) {
          failures.push(
            `baseline ${key} mismatch (baseline=${baseline.metadata?.[key]}, run=${report.metadata[key]})`,
          );
        }
      }
      for (const key of ["repeats", "warmups"] as const) {
        if (baseline.config?.[key] !== report.config[key]) {
          failures.push(
            `baseline ${key} mismatch (baseline=${baseline.config?.[key]}, run=${report.config[key]})`,
          );
        }
      }
      const before = new Map(
        baseline.results.map((result) => [result.operation, result]),
      );
      for (const result of results) {
        const baselineResult = before.get(result.operation);
        if (!baselineResult) {
          failures.push(`${result.operation} is missing from the baseline`);
          continue;
        }
        if (
          !Number.isFinite(result.medianMs) ||
          !Number.isFinite(baselineResult.medianMs) ||
          !Number.isFinite(result.frameMedianMs) ||
          !Number.isFinite(baselineResult.frameMedianMs)
        ) {
          failures.push(`${result.operation} has a non-finite median`);
          continue;
        }
        const deltaMs = result.medianMs - baselineResult.medianMs;
        const deltaPercent = baselineResult.medianMs
          ? (deltaMs / baselineResult.medianMs) * 100
          : deltaMs > 0
            ? Infinity
            : 0;
        if (deltaMs > minRegressionMs && deltaPercent > maxRegressionPercent) {
          failures.push(
            `${result.operation} median +${deltaPercent.toFixed(1)}% (> ${maxRegressionPercent}%)`,
          );
        }
        const frameDeltaMs =
          result.frameMedianMs - baselineResult.frameMedianMs;
        const frameDeltaPercent = baselineResult.frameMedianMs
          ? (frameDeltaMs / baselineResult.frameMedianMs) * 100
          : frameDeltaMs > 0
            ? Infinity
            : 0;
        if (
          frameDeltaMs > minFrameRegressionMs &&
          frameDeltaPercent > maxFrameRegressionPercent
        ) {
          failures.push(
            `${result.operation} frame median +${frameDeltaPercent.toFixed(1)}% (> ${maxFrameRegressionPercent}%)`,
          );
        }
      }
      for (const result of baseline.results) {
        if (
          !results.some((current) => current.operation === result.operation)
        ) {
          failures.push(`${result.operation} is missing from the current run`);
        }
      }
    }

    console.log(JSON.stringify({ ...report, failures }, null, 2));
    process.exitCode =
      results.every((result) => result.passed) && failures.length === 0 ? 0 : 1;
  } finally {
    await browser.close();
    await close();
  }
}

await main();
