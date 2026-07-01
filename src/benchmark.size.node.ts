import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { build, transform } from "esbuild";

type SizeTarget =
  | { name: string; type: "source"; path: string }
  | { name: string; type: "bundle"; entry: string; source: string };

type SizeResult = {
  name: string;
  rawBytes: number;
  minifiedBytes: number;
  gzipBytes: number;
  brotliBytes: number;
};

type SizeDelta = Partial<Record<keyof Omit<SizeResult, "name">, number>>;

type SizeReport = {
  generatedAt: string;
  results: SizeResult[];
};

type Options = {
  baselinePath?: string;
  writeBaselinePath?: string;
  json: boolean;
  maxFullBrotli?: number;
  maxRegressionPercent?: number;
};
type EntrySource = { name: string; source: string };

const distDir = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(distDir);
const tempDir = join(distDir, ".size-benchmark");
const brotliParams = {
  [constants.BROTLI_PARAM_QUALITY]: 9,
};

const entrySources: EntrySource[] = [
  {
    name: "full",
    source: `export * from "../library.js";\n`,
  },
  {
    name: "html-render",
    source: `export { html, render } from "../library.js";\n`,
  },
  {
    name: "reactive-core",
    source: `export { reactive, unset, observe, unobserve, watchEffect, emit, ternary, getValue } from "../library.js";\n`,
  },
  {
    name: "view",
    source: `export { view } from "../library.js";\n`,
  },
  {
    name: "jsx-runtime",
    source: `export { jsx, jsxs, jsxDEV, Fragment } from "../jsx-runtime.js";\n`,
  },
];

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const targets = await createTargets();
  const report: SizeReport = {
    generatedAt: new Date().toISOString(),
    results: [],
  };

  for (const target of targets) {
    report.results.push(await measureTarget(target));
  }

  if (options.writeBaselinePath) {
    const baselinePath = resolve(rootDir, options.writeBaselinePath);
    await mkdir(dirname(baselinePath), { recursive: true });
    await writeFile(baselinePath, JSON.stringify(report, null, 2) + "\n");
  }

  const baseline = options.baselinePath
    ? await readBaseline(resolve(rootDir, options.baselinePath))
    : undefined;
  const failures = findFailures(report, baseline, options);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          ...report,
          deltas: baseline ? createDeltas(report, baseline) : undefined,
          failures,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(formatReport(report, baseline, failures));
  }

  process.exit(failures.length ? 1 : 0);
}

async function createTargets(): Promise<SizeTarget[]> {
  await mkdir(tempDir, { recursive: true });

  const targets: SizeTarget[] = [
    {
      name: "library-file",
      type: "source",
      path: join(distDir, "library.js"),
    },
  ];

  for (const entry of entrySources) {
    const entryPath = join(tempDir, `${entry.name}.js`);
    await writeFile(entryPath, entry.source);
    targets.push({ ...entry, type: "bundle", entry: entryPath });
  }

  return targets;
}

async function measureTarget(target: SizeTarget): Promise<SizeResult> {
  const rawCode =
    target.type === "source"
      ? await readFile(target.path, "utf8")
      : await bundleTarget(target.entry, false);
  const minifiedCode =
    target.type === "source"
      ? await minifySource(rawCode)
      : await bundleTarget(target.entry, true);
  const minifiedBuffer = Buffer.from(minifiedCode);

  return {
    name: target.name,
    rawBytes: Buffer.byteLength(rawCode),
    minifiedBytes: minifiedBuffer.length,
    gzipBytes: gzipSync(minifiedBuffer, { level: 9 }).length,
    brotliBytes: brotliCompressSync(minifiedBuffer, {
      params: brotliParams,
    }).length,
  };
}

async function bundleTarget(entry: string, minify: boolean) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "esnext",
    minify,
    treeShaking: true,
    legalComments: "none",
    logLevel: "silent",
  });
  const output = result.outputFiles[0];
  if (!output) throw new Error(`No esbuild output for ${entry}`);
  return output.text;
}

async function minifySource(code: string) {
  const result = await transform(code, {
    format: "esm",
    target: "esnext",
    minify: true,
    legalComments: "none",
  });
  return result.code;
}

async function readBaseline(path: string): Promise<SizeReport> {
  return JSON.parse(await readFile(path, "utf8")) as SizeReport;
}

function findFailures(
  report: SizeReport,
  baseline: SizeReport | undefined,
  options: Options,
) {
  const failures: string[] = [];
  const full = report.results.find((result) => result.name === "full");
  if (
    options.maxFullBrotli !== undefined &&
    full &&
    full.brotliBytes > options.maxFullBrotli
  ) {
    failures.push(`full brotli ${full.brotliBytes} > ${options.maxFullBrotli}`);
  }

  if (baseline && options.maxRegressionPercent !== undefined) {
    const baselineByName = new Map(
      baseline.results.map((result) => [result.name, result]),
    );
    for (const result of report.results) {
      const before = baselineByName.get(result.name);
      if (!before) continue;
      const allowed = before.brotliBytes * (options.maxRegressionPercent / 100);
      const delta = result.brotliBytes - before.brotliBytes;
      if (delta > allowed) {
        failures.push(
          `${result.name} brotli +${delta} exceeds ${options.maxRegressionPercent}%`,
        );
      }
    }
  }

  return failures;
}

function createDeltas(report: SizeReport, baseline: SizeReport) {
  const baselineByName = new Map(
    baseline.results.map((result) => [result.name, result]),
  );
  const deltas: Record<string, SizeDelta> = {};

  for (const result of report.results) {
    const before = baselineByName.get(result.name);
    if (!before) continue;
    deltas[result.name] = {
      rawBytes: result.rawBytes - before.rawBytes,
      minifiedBytes: result.minifiedBytes - before.minifiedBytes,
      gzipBytes: result.gzipBytes - before.gzipBytes,
      brotliBytes: result.brotliBytes - before.brotliBytes,
    };
  }

  return deltas;
}

function formatReport(
  report: SizeReport,
  baseline: SizeReport | undefined,
  failures: string[],
) {
  const deltas = baseline ? createDeltas(report, baseline) : undefined;
  const lines: string[] = [];
  lines.push("");
  lines.push("hydro-js size benchmark");
  lines.push("=".repeat(86));
  lines.push(
    `${"target".padEnd(16)} ${"raw".padStart(9)} ${"min".padStart(
      9,
    )} ${"gzip".padStart(9)} ${"brotli".padStart(9)} ${"delta br".padStart(10)}`,
  );
  lines.push("-".repeat(86));
  for (const result of report.results) {
    const delta = deltas?.[result.name]?.brotliBytes;
    lines.push(
      `${result.name.padEnd(16)} ${formatBytes(result.rawBytes).padStart(
        9,
      )} ${formatBytes(result.minifiedBytes).padStart(9)} ${formatBytes(
        result.gzipBytes,
      ).padStart(9)} ${formatBytes(result.brotliBytes).padStart(
        9,
      )} ${formatDelta(delta).padStart(10)}`,
    );
  }
  lines.push("=".repeat(86));
  if (failures.length) {
    for (const failure of failures) lines.push(`FAIL: ${failure}`);
    lines.push("RESULT: FAIL");
  } else {
    lines.push("RESULT: PASS");
  }
  lines.push("");
  return lines.join("\n");
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(2)} KB`;
}

function formatDelta(delta: number | undefined) {
  if (delta === undefined) return "-";
  if (delta === 0) return "0 B";
  const sign = delta > 0 ? "+" : "-";
  return `${sign}${formatBytes(Math.abs(delta))}`;
}

function parseOptions(args: string[]): Options {
  const options: Options = { json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--baseline") {
      options.baselinePath = readArg(args, ++i, arg);
    } else if (arg === "--write-baseline") {
      options.writeBaselinePath = readArg(args, ++i, arg);
    } else if (arg === "--max-full-brotli") {
      options.maxFullBrotli = Number(readArg(args, ++i, arg));
    } else if (arg === "--max-regression-percent") {
      options.maxRegressionPercent = Number(readArg(args, ++i, arg));
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function readArg(args: string[], index: number, flag: string) {
  const value = args[index];
  if (!value) throw new Error(`${flag} needs a value`);
  return value;
}

await main();
