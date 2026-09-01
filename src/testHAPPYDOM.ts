import { Window } from "happy-dom";
import { runNodeTestSuite } from "./testNodeHarness.js";

const window = new Window({ url: "https://localhost:8080" });
window.document.write(`
  <!doctype html>
  <html lang="en">
    <head>
      <title>Hello SSR</title>
    </head>
    <body>
    </body>
  </html>
`);

// @ts-expect-error
globalThis.window = window;
// @ts-expect-error
globalThis.document = window.document;
await window.happyDOM.waitUntilComplete();

const { registerTestSuite } = await import("./test.js");
await runNodeTestSuite("happy-dom", registerTestSuite);
