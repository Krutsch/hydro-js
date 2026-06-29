import { Window } from "happy-dom";

const window = new Window({ url: "https://localhost:8080" });
window.document.write(
  `<!doctype html><html lang="en"><head></head><body></body></html>`,
);

// @ts-expect-error - install DOM globals before importing the library
globalThis.window = window;
// @ts-expect-error
globalThis.document = window.document;
// @ts-expect-error
globalThis.MouseEvent = window.MouseEvent;
await window.happyDOM.waitUntilComplete();

const { runPerfScenarios, formatPerfReport } =
  await import("./benchmark.perf.js");

const report = await runPerfScenarios({
  rows: 200,
  manyRows: 1000,
  now: () => performance.now(),
  cleanup: () => (globalThis as any).gc?.(),
});

console.log(formatPerfReport(report));
process.exit(report.pass ? 0 : 1);
