import { runTests } from "@web/test-runner-mocha";
import type { TestRunner } from "./test.js";

type MochaGlobals = {
  describe: TestRunner["describe"];
  it: (name: string, fn: () => void | Promise<void>) => void;
};

const mocha = globalThis as typeof globalThis & MochaGlobals;
const sleep = (time: number) =>
  new Promise((resolve) => setTimeout(resolve, time));

(window as unknown as { requestIdleCallback: unknown }).requestIdleCallback =
  undefined;

runTests(async () => {
  const { registerTestSuite } = await import("./test.js");
  const runner: TestRunner = {
    runtime: "browser",
    describe: mocha.describe,
    it: (name, run) => {
      mocha.it(name, async () => {
        const passed = await run();
        await sleep(0);
        if (!passed) {
          throw new Error(`Test failed: ${name}`);
        }
      });
    },
  };
  registerTestSuite(runner, sleep);
});
