import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
const distDir = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(distDir);
const args = process.argv.slice(2);
const flag = (name) => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : undefined;
};
const writeBaselinePath = flag("--write-baseline");
const baselinePath = flag("--baseline");
const maxRegressionPercent = flag("--max-regression-percent");
const asJson = args.includes("--json");
const window = new Window({ url: "https://localhost:8080" });
window.document.write(`<!doctype html><html lang="en"><head></head><body></body></html>`);
// @ts-expect-error - install DOM globals before importing the library
globalThis.window = window;
// @ts-expect-error
globalThis.document = window.document;
// @ts-expect-error
globalThis.MouseEvent = window.MouseEvent;
await window.happyDOM.waitUntilComplete();
const { runPerfScenarios, formatPerfReport, toPerfBaseline, diffPerf } = await import("./benchmark.perf.js");
const report = await runPerfScenarios({
    rows: process.env.PERF_ROWS ? Number(process.env.PERF_ROWS) : 1000,
    manyRows: process.env.PERF_MANY_ROWS
        ? Number(process.env.PERF_MANY_ROWS)
        : 10000,
    ...(process.env.PERF_REPEATS
        ? { repeats: Number(process.env.PERF_REPEATS) }
        : {}),
    ...(process.env.PERF_WARMUPS
        ? { warmups: Number(process.env.PERF_WARMUPS) }
        : {}),
    now: () => performance.now(),
    cleanup: () => globalThis.gc?.(),
});
if (writeBaselinePath) {
    const target = resolve(rootDir, writeBaselinePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(toPerfBaseline(report), null, 2) + "\n");
}
let baseline;
if (baselinePath) {
    baseline = JSON.parse(await readFile(resolve(rootDir, baselinePath), "utf8"));
}
const tolerance = maxRegressionPercent !== undefined ? Number(maxRegressionPercent) : 15;
const diff = baseline ? diffPerf(report, baseline, tolerance) : undefined;
const failures = diff?.failures ?? [];
if (asJson) {
    console.log(JSON.stringify({ report, deltas: diff?.deltas, failures }, null, 2));
}
else {
    console.log(formatPerfReport(report, baseline, failures, tolerance));
}
process.exit(report.pass && !failures.length ? 0 : 1);
