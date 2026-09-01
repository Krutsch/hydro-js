import type { TestRunner } from "./test.js";
export declare function runNodeTestSuite(runtimeName: string, registerTestSuite: (runner: TestRunner, sleep: (time: number) => Promise<unknown>) => void): Promise<void>;
