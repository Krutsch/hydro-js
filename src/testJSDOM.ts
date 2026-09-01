import { JSDOM } from "jsdom";
import { runNodeTestSuite } from "./testNodeHarness.js";

const { window } = new JSDOM(`<!doctype html>
  <html lang="en">
    <head>
    </head>
    <body>
    </body>
  </html>`);

// @ts-expect-error
globalThis.window = window;
globalThis.document = window.document;

const { registerTestSuite } = await import("./test.js");
await runNodeTestSuite("JSDOM", registerTestSuite);
