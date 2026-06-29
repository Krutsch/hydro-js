import { playwrightLauncher } from "@web/test-runner-playwright";

// Dedicated config for the in-browser memory benchmark (src/benchmark.html).
// Chromium is launched with --expose-gc so the page can force collection via
// window.gc(); this proves the leak fix in a real engine, not just happy-dom.
export default {
  files: ["src/benchmark.html"],
  nodeResolve: true,
  browsers: [
    playwrightLauncher({
      product: "chromium",
      launchOptions: {
        args: ["--js-flags=--expose-gc"],
      },
    }),
  ],
  testFramework: {
    config: {
      timeout: "120000",
    },
  },
};
