export type ActualOperation = "create" | "replace" | "create-many" | "append" | "update" | "select" | "swap" | "remove" | "clear";
type ActualResult = {
    elapsedMs: number;
    frameElapsedMs: number;
    rowCount: number;
    selectedCount: number;
    firstLabel: string;
    passed: boolean;
};
type ActualMemoryResult = {
    cycles: number;
    rowsPerCycle: number;
    aliveBeforeReturn: number;
    passed: boolean;
};
declare global {
    interface Window {
        __actualBenchmark?: {
            run(operation: ActualOperation): Promise<ActualResult>;
            memory(cycles: number): Promise<ActualMemoryResult>;
            memorySurvivors(): number;
            releaseMemoryRefs(): void;
        };
    }
}
export declare function installActualBenchmark(): void;
export {};
