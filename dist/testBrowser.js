import { runTests } from "@web/test-runner-mocha";
const mocha = globalThis;
const sleep = (time) => new Promise((resolve) => setTimeout(resolve, time));
window.requestIdleCallback =
    undefined;
runTests(async () => {
    const { registerTestSuite } = await import("./test.js");
    const runner = {
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
