type ImplName = "html" | "h" | "view" | "view-html";
type OperationName = "create rows" | "replace all rows" | "update every 10th row" | "select row" | "swap rows" | "remove row" | "create many rows" | "append rows to large table" | "clear rows";
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
    spreadPct: number;
    ok: boolean;
}
export interface PerfReport {
    config: Required<PerfConfig>;
    results: PerfResult[];
    keyed: KeyedResult[];
    pass: boolean;
}
export interface PerfBaselineEntry {
    impl: ImplName;
    operation: OperationName;
    minMs: number;
    medianMs: number;
}
export interface PerfBaseline {
    generatedAt: string;
    entries: PerfBaselineEntry[];
}
export interface PerfDelta {
    impl: ImplName;
    operation: OperationName;
    beforeMinMs: number;
    afterMinMs: number;
    deltaPct: number;
    regressed: boolean;
}
export interface KeyedResult {
    impl: ImplName;
    swapKeepsIdentity: boolean;
    removeKeepsIdentity: boolean;
    swapDomMutations: number;
    removeDomMutations: number;
    ok: boolean;
}
export declare function runPerfScenarios(deps?: PerfDeps): Promise<PerfReport>;
export declare function formatPerfReport(report: PerfReport, baseline?: PerfBaseline, failures?: string[], tolerancePct?: number): string;
export declare function toPerfBaseline(report: PerfReport): PerfBaseline;
export declare function diffPerf(report: PerfReport, baseline: PerfBaseline, tolerancePct?: number): {
    deltas: PerfDelta[];
    failures: string[];
};
export {};
