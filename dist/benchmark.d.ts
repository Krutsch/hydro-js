export interface BenchDeps {
    gc: () => void;
    heap?: () => number;
    N?: number;
}
export interface ScenarioResult {
    name: string;
    n: number;
    alive: number;
    limit: number;
    leaked: boolean;
    control: boolean;
    heapMB?: number;
}
export interface BenchReport {
    results: ScenarioResult[];
    correctness: {
        name: string;
        ok: boolean;
    }[];
    pass: boolean;
}
export declare function runScenarios(deps: BenchDeps): Promise<BenchReport>;
export declare function formatReport(report: BenchReport): string;
