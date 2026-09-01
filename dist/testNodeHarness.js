export async function runNodeTestSuite(runtimeName, registerTestSuite) {
    const tests = [];
    const runner = {
        runtime: runtimeName,
        describe: (_name, fn) => fn(),
        it: (name, run) => tests.push({ name, run }),
    };
    const sleep = (time) => new Promise((resolve) => setTimeout(resolve, time));
    registerTestSuite(runner, sleep);
    let passed = 0;
    for (const test of tests) {
        try {
            if (await test.run()) {
                passed++;
            }
            else {
                console.error(`${runtimeName}: failed: ${test.name}`);
            }
        }
        catch (error) {
            console.error(`${runtimeName}: failed: ${test.name}`, error);
        }
        await sleep(0);
    }
    const failed = tests.length - passed;
    console.log(`${runtimeName}: ${passed}/${tests.length} tests passed`);
    if (failed > 0) {
        globalThis.process.exitCode = 1;
    }
}
