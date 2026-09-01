import type { TestRunner } from "./test.js";

type TestCase = {
  name: string;
  run: () => boolean | Promise<boolean>;
};

export async function runNodeTestSuite(
  runtimeName: string,
  registerTestSuite: (
    runner: TestRunner,
    sleep: (time: number) => Promise<unknown>,
  ) => void,
) {
  const tests: TestCase[] = [];
  const runner: TestRunner = {
    runtime: runtimeName,
    describe: (_name, fn) => fn(),
    it: (name, run) => tests.push({ name, run }),
  };
  const sleep = (time: number) =>
    new Promise((resolve) => setTimeout(resolve, time));

  registerTestSuite(runner, sleep);

  let passed = 0;
  for (const test of tests) {
    try {
      if (await test.run()) {
        passed++;
      } else {
        console.error(`${runtimeName}: failed: ${test.name}`);
      }
    } catch (error) {
      console.error(`${runtimeName}: failed: ${test.name}`, error);
    }
    await sleep(0);
  }

  const failed = tests.length - passed;
  console.log(`${runtimeName}: ${passed}/${tests.length} tests passed`);
  if (failed > 0) {
    (
      globalThis as typeof globalThis & { process: { exitCode: number } }
    ).process.exitCode = 1;
  }
}
