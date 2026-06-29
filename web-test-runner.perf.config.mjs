import { playwrightLauncher } from "@web/test-runner-playwright";

export default {
  files: ["src/benchmark.perf.html"],
  nodeResolve: true,
  testsStartTimeout: 120000,
  testsFinishTimeout: 600000,
  browsers: [
    playwrightLauncher({
      product: "chromium",
    }),
  ],
  testFramework: {
    config: {
      timeout: "120000",
    },
  },
};
