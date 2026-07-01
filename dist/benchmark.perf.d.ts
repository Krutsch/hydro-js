type ImplName = "html" | "h" | "view" | "view-html";
type OperationName = "create rows" | "replace all rows" | "select row" | "create many rows" | "append rows to large table";
type PerfConfig = {
    rows?: number;
    manyRows?: number;
    repeats?: number;
    warmups?: number;
};
export interface PerfDeps extends PerfConfig {
    now?: () => number;
    cleanup?: () => void;
}
export interface PerfResult {
    impl: ImplName;
    operation: OperationName;
    rows: number;
    samples: number[];
    medianMs: number;
    minMs: number;
    ok: boolean;
}
export interface PerfReport {
    config: Required<PerfConfig>;
    results: PerfResult[];
    keyed: KeyedResult[];
    pass: boolean;
}
export interface KeyedResult {
    impl: ImplName;
    swapKeepsIdentity: boolean;
    removeKeepsIdentity: boolean;
    ok: boolean;
}
export declare function runPerfScenarios(deps?: PerfDeps): Promise<PerfReport>;
export declare function formatPerfReport(report: PerfReport): string;
export {};
