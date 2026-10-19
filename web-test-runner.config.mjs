export default {
  testFramework: {
    config: {
      // Native focus operations can exceed Mocha's 2s default on CI runners.
      timeout: 10000,
    },
  },
};
