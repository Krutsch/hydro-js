// Node entry for the memory benchmark. Run with:
//   npm run bench        (tsc && node --expose-gc dist/benchmark.node.js)
//
// Uses happy-dom for a DOM and Node's --expose-gc for deterministic collection.
import { Window } from "happy-dom";
const window = new Window({ url: "https://localhost:8080" });
window.document.write(`<!doctype html><html lang="en"><head></head><body></body></html>`);
// @ts-expect-error - install DOM globals before importing the library
globalThis.window = window;
// @ts-expect-error
globalThis.document = window.document;
await window.happyDOM.waitUntilComplete();
const gc = globalThis.gc;
if (typeof gc !== "function") {
    console.error("global.gc is not available. Run with: node --expose-gc dist/benchmark.node.js (or `npm run bench`).");
    process.exit(2);
}
const { runScenarios, formatReport } = await import("./benchmark.js");
const report = await runScenarios({
    gc,
    heap: () => process.memoryUsage().heapUsed,
});
console.log(formatReport(report));
process.exit(report.pass ? 0 : 1);
