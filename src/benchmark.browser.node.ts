// Run the memory benchmark in one fresh Chromium process without WTR/Mocha.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright-core";

const distDir = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(distDir);
const timeout = Number(process.env.MEMORY_TIMEOUT_MS ?? 120000);
const iterations = process.env.MEMORY_ITERATIONS ?? "1500";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function startStaticServer(
  root: string,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer(async (request, response) => {
    try {
      const urlPath = decodeURIComponent((request.url ?? "/").split("?")[0]);
      const filePath = join(root, urlPath);
      const body = await readFile(filePath);
      response.writeHead(200, {
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
        close: () =>
          new Promise((resolveClose) => server.close(() => resolveClose())),
      });
    });
  });
}

const { port, close } = await startStaticServer(rootDir);
let browser: Browser | undefined;

try {
  browser = await chromium.launch({
    args: ["--js-flags=--expose-gc", "--enable-precise-memory-info"],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  let reportJson: string | undefined;
  let reportText: string | undefined;
  let pageError: string | undefined;

  page.on("console", (message) => {
    const text = message.text();
    if (text.startsWith("MEMORY_REPORT_JSON:")) {
      reportJson = text.slice("MEMORY_REPORT_JSON:".length);
    } else if (text.startsWith("MEMORY_REPORT_TEXT:")) {
      reportText = text.slice("MEMORY_REPORT_TEXT:".length);
    } else if (text.startsWith("MEMORY_REPORT_ERROR:")) {
      pageError = text.slice("MEMORY_REPORT_ERROR:".length);
    } else {
      console.log(text);
    }
  });
  page.on("pageerror", (error) => {
    pageError = error.stack || String(error);
  });

  const query = new URLSearchParams({ iterations });
  await page.goto(`http://127.0.0.1:${port}/src/benchmark.html?${query}`, {
    waitUntil: "load",
  });
  await page.waitForFunction("window.__memoryDone === true", null, {
    timeout,
  });

  if (pageError) throw new Error("Browser memory run failed: " + pageError);
  if (!reportJson) throw new Error("Browser memory run produced no report");

  const report = JSON.parse(reportJson) as { pass: boolean };
  if (reportText) console.log(reportText);
  process.exitCode = report.pass ? 0 : 1;
  await context.close();
} finally {
  await browser?.close();
  await close();
}
