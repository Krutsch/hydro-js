// Real-Chromium perf regression harness, sibling to benchmark.perf.node.ts
// (which runs the same scenarios under happy-dom). happy-dom does not
// reproduce the GC-pause behavior real DOM churn triggers in an actual
// browser (confirmed 2026-07-08 - see /memories/repo/view-performance.md),
// so the happy-dom harness's baseline/regression-gate can't catch the
// `view()`/`view-html` regression class this file exists to guard against.
//
// Drives a real headless Chromium via playwright-core (already a transitive
// dep of @web/test-runner-playwright; declared directly here since we import
// it ourselves rather than going through @web/test-runner). No mocha/wtr
// dependency: a tiny built-in static server + benchmark.perf.browser.html.
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
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
const maxFirstPaintRegressionPercent = flag("--max-first-paint-regression-percent");
const asJson = args.includes("--json");
const timeout = Number(process.env.PERF_TIMEOUT_MS ?? 120000);
const firstPaintTimeout = Number(process.env.PERF_FIRST_PAINT_TIMEOUT_MS ?? 30000);
const firstPaintRepeats = Number(process.env.PERF_FIRST_PAINT_REPEATS ?? 3);
const firstPaintWarmups = Number(process.env.PERF_FIRST_PAINT_WARMUPS ?? 1);
const minAbsoluteRegressionMs = Number(process.env.PERF_MIN_ABSOLUTE_REGRESSION_MS ?? 50);
// `benchmark.perf.js` -> `library.js` touches `window`/`document` at module
// top-level (Safari polyfills, a shared Range). The actual benchmark runs in
// a REAL browser via CDP below - this fake window only exists so importing
// the module for its pure `toPerfBaseline`/`diffPerf`/`formatPerfReport`
// helpers doesn't crash under plain Node. Same shim benchmark.perf.node.ts
// uses for its happy-dom run.
const shimWindow = new Window({ url: "https://localhost:8080" });
shimWindow.document.write(`<!doctype html><html lang="en"><head></head><body></body></html>`);
// @ts-expect-error - install DOM globals before importing the library
globalThis.window = shimWindow;
// @ts-expect-error
globalThis.document = shimWindow.document;
// @ts-expect-error
globalThis.MouseEvent = shimWindow.MouseEvent;
await shimWindow.happyDOM.waitUntilComplete();
const { toPerfBaseline, diffPerf, formatPerfReport, summarizeFirstPaint } = await import("./benchmark.perf.js");
const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
};
function startStaticServer(root) {
    const server = createServer(async (req, res) => {
        try {
            const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
            const filePath = join(root, urlPath);
            const body = await readFile(filePath);
            res.writeHead(200, {
                "Cache-Control": "no-store",
                "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
            });
            res.end(body);
        }
        catch {
            res.writeHead(404);
            res.end("Not found");
        }
    });
    return new Promise((resolvePromise) => {
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            const port = typeof address === "object" && address ? address.port : 0;
            resolvePromise({
                port,
                close: () => new Promise((r) => server.close(() => r())),
            });
        });
    });
}
async function measureFirstPaint(browser, port, implementation, sample) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
        const query = new URLSearchParams({
            impl: implementation,
            cacheKey: `${implementation}-${sample}-${Date.now()}`,
        });
        await page.goto(`http://127.0.0.1:${port}/src/benchmark.first-paint.browser.html?${query}`, { waitUntil: "load" });
        await page.waitForFunction("window.__firstPaintDone === true", null, {
            timeout: firstPaintTimeout,
        });
        const result = await page.evaluate(() => {
            const fixtureWindow = window;
            return {
                error: fixtureWindow.__firstPaintError,
                report: fixtureWindow.__firstPaintReport,
            };
        });
        if (result.error)
            throw new Error(result.error);
        const fcpMs = result.report?.fcpMs;
        const importMs = result.report?.importMs;
        const mountMs = result.report?.mountMs;
        const paintDelayMs = result.report?.paintDelayMs;
        if (!result.report?.mounted ||
            typeof fcpMs !== "number" ||
            typeof importMs !== "number" ||
            typeof mountMs !== "number" ||
            typeof paintDelayMs !== "number" ||
            ![fcpMs, importMs, mountMs, paintDelayMs].every(Number.isFinite)) {
            throw new Error(`First-paint fixture produced no valid FCP for ${implementation}`);
        }
        return { fcpMs, importMs, mountMs, paintDelayMs };
    }
    finally {
        await context.close();
    }
}
async function runFirstPaintScenarios(browser, port) {
    const implementations = ["html", "h", "view", "view-html"];
    const results = [];
    for (const implementation of implementations) {
        const samples = [];
        for (let sample = 0; sample < firstPaintWarmups + firstPaintRepeats; sample++) {
            const timing = await measureFirstPaint(browser, port, implementation, sample);
            if (sample >= firstPaintWarmups)
                samples.push(timing);
        }
        results.push(summarizeFirstPaint(implementation, samples, true));
    }
    return {
        results,
        pass: results.every((result) => result.ok),
    };
}
const { port, close } = await startStaticServer(rootDir);
const browser = await chromium.launch();
try {
    const page = await browser.newPage();
    let reportJson;
    let pageError;
    page.on("console", (msg) => {
        const text = msg.text();
        if (text.startsWith("PERF_REPORT_JSON:")) {
            reportJson = text.slice("PERF_REPORT_JSON:".length);
        }
        else if (text.startsWith("PERF_REPORT_ERROR:")) {
            pageError = text.slice("PERF_REPORT_ERROR:".length);
        }
        else {
            console.log(text);
        }
    });
    page.on("pageerror", (err) => {
        pageError = err.stack || String(err);
    });
    const query = new URLSearchParams({
        ...(process.env.PERF_ROWS ? { rows: process.env.PERF_ROWS } : {}),
        ...(process.env.PERF_MANY_ROWS
            ? { manyRows: process.env.PERF_MANY_ROWS }
            : {}),
        ...(process.env.PERF_REPEATS ? { repeats: process.env.PERF_REPEATS } : {}),
        ...(process.env.PERF_WARMUPS ? { warmups: process.env.PERF_WARMUPS } : {}),
    });
    await page.goto(`http://127.0.0.1:${port}/src/benchmark.perf.browser.html?${query}`, { waitUntil: "load" });
    await page.waitForFunction("window.__perfDone === true", null, {
        timeout,
    });
    if (pageError)
        throw new Error("Browser perf run failed: " + pageError);
    if (!reportJson)
        throw new Error("Browser perf run produced no report");
    const interactionReport = JSON.parse(reportJson);
    const firstPaint = await runFirstPaintScenarios(browser, port);
    const report = {
        ...interactionReport,
        firstPaint,
        pass: interactionReport.pass && firstPaint.pass,
    };
    if (writeBaselinePath) {
        const target = resolve(rootDir, writeBaselinePath);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, JSON.stringify(toPerfBaseline(report), null, 2) + "\n");
    }
    let baseline;
    if (baselinePath) {
        baseline = JSON.parse(await readFile(resolve(rootDir, baselinePath), "utf8"));
    }
    // Real-browser DOM/GC noise is far higher than happy-dom's. The percentage
    // tolerance catches large regressions, while the absolute floor prevents
    // a small best-sample baseline from flagging ordinary scheduler variance.
    const tolerance = maxRegressionPercent !== undefined ? Number(maxRegressionPercent) : 100;
    const firstPaintTolerance = maxFirstPaintRegressionPercent !== undefined
        ? Number(maxFirstPaintRegressionPercent)
        : 25;
    const diff = baseline
        ? diffPerf(report, baseline, tolerance, firstPaintTolerance, minAbsoluteRegressionMs)
        : undefined;
    const failures = diff?.failures ?? [];
    if (asJson) {
        console.log(JSON.stringify({
            report,
            deltas: diff?.deltas,
            firstPaintDeltas: diff?.firstPaintDeltas,
            failures,
        }, null, 2));
    }
    else {
        console.log(formatPerfReport(report, baseline, failures, tolerance, firstPaintTolerance, minAbsoluteRegressionMs));
    }
    process.exitCode = report.pass && !failures.length ? 0 : 1;
}
finally {
    await browser.close();
    await close();
}
