import {
  h,
  html,
  onCleanup,
  reactive,
  setGlobalSchedule,
  setReuseElements,
  ternary,
  unset,
  view,
} from "./library.js";

type ImplName = "html" | "h" | "view" | "view-html";
type OperationName =
  | "create rows"
  | "replace all rows"
  | "select row"
  | "create many rows"
  | "append rows to large table";

type Row = { id: number; label: string };

type PerfApp = {
  run: (rows: Row[]) => void;
  add: (rows: Row[]) => void;
  select: (index: number) => void;
  rowCount: () => number;
  selectedCount: () => number;
  rowClass: (index: number) => string;
  firstId: () => string;
  dispose: () => void;
  // Only the reactive `view` apps expose this: it lets the keyed-ness check drive
  // the framework's own swap/remove and inspect DOM node identity afterwards.
  keyed?: KeyedProbe;
};

type KeyedProbe = {
  nodeAt: (index: number) => Element | undefined;
  idAt: (index: number) => string;
  swap: (i: number, j: number) => void;
  removeAt: (index: number) => void;
};

type Operation = {
  name: OperationName;
  rows: (config: Required<PerfConfig>) => number;
  run: (app: PerfApp, data: SampleData) => void;
  verify: (app: PerfApp, data: SampleData) => boolean;
};

type SampleData = {
  base: Row[];
  replacement: Row[];
  many: Row[];
  append: Row[];
};

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
  // Interquartile spread as a % of the median – a noise indicator. High spread
  // means the median for that op is not trustworthy for before/after comparison.
  spreadPct: number;
  ok: boolean;
}

export interface PerfReport {
  config: Required<PerfConfig>;
  results: PerfResult[];
  keyed: KeyedResult[];
  pass: boolean;
}

// A saved perf snapshot for objective before/after comparison. We compare on
// `minMs` (best sample) because it is by far the most reproducible statistic
// under GC/scheduler noise – the median swings run-to-run, the min barely moves.
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
  // After swapping rows i and j through the framework, the two original DOM nodes
  // are the ones now sitting at j and i (moved, not recreated + text-patched).
  swapKeepsIdentity: boolean;
  // After removing a row, that exact node is detached and its former neighbour is
  // still the same node, one slot up.
  removeKeepsIdentity: boolean;
  ok: boolean;
}

const ADJECTIVES = [
  "pretty",
  "large",
  "big",
  "small",
  "tall",
  "short",
  "long",
  "handsome",
  "plain",
  "quaint",
  "clean",
  "elegant",
  "easy",
  "angry",
  "crazy",
  "helpful",
  "mushy",
  "odd",
  "unsightly",
  "adorable",
  "important",
  "inexpensive",
  "cheap",
  "expensive",
  "fancy",
];
const COLOURS = [
  "red",
  "yellow",
  "blue",
  "green",
  "pink",
  "brown",
  "purple",
  "brown",
  "white",
  "black",
  "orange",
];
const NOUNS = [
  "table",
  "chair",
  "house",
  "bbq",
  "desk",
  "car",
  "pony",
  "cookie",
  "sandwich",
  "burger",
  "pizza",
  "mouse",
  "keyboard",
];

const configDefaults: Required<PerfConfig> = {
  rows: 1000,
  manyRows: 10000,
  // `minMs` is the reported/compared statistic and is stable at a modest sample
  // count, so keep the run count low: happy-dom retains memory across iterations
  // and a large repeat count OOMs the "create many rows" op.
  repeats: 10,
  warmups: 3,
};

const operations: Operation[] = [
  {
    name: "create rows",
    rows: (config) => config.rows,
    run: (app, data) => app.run(data.base),
    verify: (app, data) =>
      app.rowCount() === data.base.length && app.firstId() === "1",
  },
  {
    name: "replace all rows",
    rows: (config) => config.rows,
    run: (app, data) => {
      app.run(data.base);
      app.run(data.replacement);
    },
    verify: (app, data) =>
      app.rowCount() === data.replacement.length &&
      app.firstId() === String(data.replacement[0].id),
  },
  {
    name: "select row",
    rows: () => 1,
    run: (app, data) => {
      app.run(data.base);
      app.select(1);
    },
    verify: (app) => app.selectedCount() === 1 && app.rowClass(1) === "danger",
  },
  {
    name: "create many rows",
    rows: (config) => config.manyRows,
    run: (app, data) => app.run(data.many),
    verify: (app, data) =>
      app.rowCount() === data.many.length &&
      app.firstId() === String(data.many[0].id),
  },
  {
    name: "append rows to large table",
    rows: (config) => config.rows,
    run: (app, data) => {
      app.run(data.base);
      app.add(data.append);
    },
    verify: (app, data) =>
      app.rowCount() === data.base.length + data.append.length &&
      app.firstId() === "1",
  },
];

// Real usage always has a discrete gap between operations (paint/idle between
// clicks) in which the library's own deferred/scheduled work (e.g. view()'s
// resetViewRows cleanup) gets a chance to run. setTimeout(0) and
// scheduler.postTask are different task queues with no guaranteed relative
// order, so a plain setTimeout yield isn't reliably "after" a previously
// posted scheduler task. Yield via the exact same mechanism/priority the
// library's own schedule() uses instead - same-priority scheduler.postTask
// tasks run FIFO, so this reliably waits for a prior one to have already run.
function yieldToScheduler(): Promise<void> {
  return new Promise((resolve) => {
    if ("scheduler" in window) {
      // @ts-ignore
      window.scheduler.postTask(() => resolve(), { priority: "user-blocking" });
    } else {
      // @ts-ignore
      window.requestIdleCallback(() => resolve());
    }
  });
}

let hostId = 0;

export async function runPerfScenarios(
  deps: PerfDeps = {},
): Promise<PerfReport> {
  const config: Required<PerfConfig> = { ...configDefaults, ...deps };
  const now = deps.now ?? (() => performance.now());
  const cleanup = deps.cleanup ?? (() => undefined);
  const results: PerfResult[] = [];

  setGlobalSchedule(false);
  setReuseElements(false);

  const impls: Array<[ImplName, () => PerfApp]> = [
    ["html", createHtmlApp],
    ["h", createHApp],
    ["view", createViewApp],
    ["view-html", createViewHtmlApp],
  ];

  for (const [impl, createApp] of impls) {
    for (const operation of operations) {
      const samples: number[] = [];
      let ok = true;
      const totalRuns = config.warmups + config.repeats;

      for (let i = 0; i < totalRuns; i++) {
        const data = createSampleData(config, i + 1);
        const app = createApp();
        // Settle GC *before* the timed region so a collection triggered by the
        // previous iteration does not land inside this measurement.
        cleanup();
        const start = now();
        operation.run(app, data);
        const elapsed = now() - start;
        ok = operation.verify(app, data) && ok;
        app.dispose();
        cleanup();
        // Real usage always has a discrete gap between operations (paint/idle
        // between clicks) in which the library's own deferred/scheduled work
        // (e.g. view()'s resetViewRows cleanup) gets a chance to run. Yield
        // once per trial so this harness reflects that instead of measuring a
        // tight, never-yielding loop that pathologically starves scheduled
        // cleanup and trips its own safety-valve mid-benchmark.
        await yieldToScheduler();

        if (i >= config.warmups) samples.push(elapsed);
      }

      results.push({
        impl,
        operation: operation.name,
        rows: operation.rows(config),
        samples,
        medianMs: median(samples),
        minMs: Math.min(...samples),
        spreadPct: spread(samples),
        ok,
      });
    }
  }

  const keyed = runKeyedChecks(impls, config);

  return {
    config,
    results,
    keyed,
    pass:
      results.every((result) => result.ok) &&
      keyed.every((result) => result.ok),
  };
}

// Proves the framework is keyed: drive a swap and a remove through the reactive
// data and assert DOM node identity is preserved (moved), not recreated.
function runKeyedChecks(
  impls: Array<[ImplName, () => PerfApp]>,
  config: Required<PerfConfig>,
): KeyedResult[] {
  const keyed: KeyedResult[] = [];
  const count = Math.max(config.rows, 4);
  const i = 1;
  const j = count - 2;
  const removeIndex = count >> 1;

  for (const [impl, createApp] of impls) {
    const probe = createApp();
    if (!probe.keyed) {
      probe.dispose();
      continue;
    }
    probe.dispose();

    const build = createDataBuilder(impl.length + 1);

    // Swap: capture the two nodes, swap through the framework, expect them moved.
    const swapApp = createApp();
    swapApp.run(build(count));
    const swap = swapApp.keyed!;
    const nodeI = swap.nodeAt(i);
    const nodeJ = swap.nodeAt(j);
    const idI = swap.idAt(i);
    const idJ = swap.idAt(j);
    swap.swap(i, j);
    const swapKeepsIdentity =
      !!nodeI &&
      !!nodeJ &&
      swap.nodeAt(i) === nodeJ &&
      swap.nodeAt(j) === nodeI &&
      swap.idAt(i) === idJ &&
      swap.idAt(j) === idI;
    swapApp.dispose();

    // Remove: the removed node detaches, its neighbour keeps identity one slot up.
    const removeApp = createApp();
    removeApp.run(build(count));
    const remove = removeApp.keyed!;
    const target = remove.nodeAt(removeIndex);
    const neighbour = remove.nodeAt(removeIndex + 1);
    remove.removeAt(removeIndex);
    const removeKeepsIdentity =
      !!target &&
      !!neighbour &&
      !target.isConnected &&
      remove.nodeAt(removeIndex) === neighbour &&
      removeApp.rowCount() === count - 1;
    removeApp.dispose();

    keyed.push({
      impl,
      swapKeepsIdentity,
      removeKeepsIdentity,
      ok: swapKeepsIdentity && removeKeepsIdentity,
    });
  }

  return keyed;
}

export function formatPerfReport(
  report: PerfReport,
  baseline?: PerfBaseline,
  failures: string[] = [],
): string {
  const deltas = baseline ? diffPerf(report, baseline).deltas : undefined;
  const deltaByKey = new Map(
    (deltas ?? []).map((d) => [`${d.impl}|${d.operation}`, d]),
  );
  const lines: string[] = [];
  lines.push("");
  lines.push("hydro-js performance benchmark");
  lines.push("=".repeat(100));
  lines.push(
    `${"impl".padEnd(9)} ${"operation".padEnd(28)} ${"rows".padStart(
      7,
    )} ${"median".padStart(9)} ${"min".padStart(9)} ${"spread".padStart(
      7,
    )} ${"Δmin".padStart(9)}  status`,
  );
  lines.push("-".repeat(100));
  for (const result of report.results) {
    const delta = deltaByKey.get(`${result.impl}|${result.operation}`);
    const deltaStr = delta ? formatPct(delta.deltaPct) : "-";
    const status = delta?.regressed ? "REGRESSED" : result.ok ? "ok" : "FAIL";
    lines.push(
      `${result.impl.padEnd(9)} ${result.operation.padEnd(28)} ${String(
        result.rows,
      ).padStart(7)} ${formatMs(result.medianMs).padStart(9)} ${formatMs(
        result.minMs,
      ).padStart(9)} ${`${result.spreadPct.toFixed(0)}%`.padStart(
        7,
      )} ${deltaStr.padStart(9)}  ${status}`,
    );
  }

  if (report.keyed.length) {
    lines.push("=".repeat(100));
    lines.push("keyed-ness (DOM node identity through the framework)");
    lines.push("-".repeat(100));
    lines.push(
      `${"impl".padEnd(9)} ${"swap keeps node".padEnd(20)} ${"remove keeps node".padEnd(
        20,
      )}  status`,
    );
    for (const result of report.keyed) {
      lines.push(
        `${result.impl.padEnd(9)} ${(result.swapKeepsIdentity
          ? "yes"
          : "NO"
        ).padEnd(20)} ${(result.removeKeepsIdentity ? "yes" : "NO").padEnd(
          20,
        )}  ${result.ok ? "keyed" : "FAIL"}`,
      );
    }
  }

  lines.push("=".repeat(100));
  if (failures.length) {
    for (const failure of failures) lines.push(`FAIL: ${failure}`);
  }
  lines.push(report.pass && !failures.length ? "RESULT: PASS" : "RESULT: FAIL");
  lines.push("");
  return lines.join("\n");
}

// Snapshot a report for later comparison (only the stable fields).
export function toPerfBaseline(report: PerfReport): PerfBaseline {
  return {
    generatedAt: new Date().toISOString(),
    entries: report.results.map((r) => ({
      impl: r.impl,
      operation: r.operation,
      minMs: r.minMs,
      medianMs: r.medianMs,
    })),
  };
}

// Compare on minMs. A regression only counts when the new best sample is slower
// than the baseline best by more than `tolerancePct` – below that it is noise.
export function diffPerf(
  report: PerfReport,
  baseline: PerfBaseline,
  tolerancePct = 15,
): { deltas: PerfDelta[]; failures: string[] } {
  const before = new Map(
    baseline.entries.map((e) => [`${e.impl}|${e.operation}`, e]),
  );
  const deltas: PerfDelta[] = [];
  const failures: string[] = [];
  for (const r of report.results) {
    const base = before.get(`${r.impl}|${r.operation}`);
    if (!base) continue;
    const deltaPct = ((r.minMs - base.minMs) / base.minMs) * 100;
    const regressed = deltaPct > tolerancePct;
    deltas.push({
      impl: r.impl,
      operation: r.operation,
      beforeMinMs: base.minMs,
      afterMinMs: r.minMs,
      deltaPct,
      regressed,
    });
    if (regressed) {
      failures.push(
        `${r.impl} | ${r.operation} min +${deltaPct.toFixed(
          1,
        )}% (> ${tolerancePct}%)`,
      );
    }
  }
  return { deltas, failures };
}

function createSampleData(
  config: Required<PerfConfig>,
  seed: number,
): SampleData {
  const build = createDataBuilder(seed);
  return {
    base: build(config.rows),
    replacement: build(config.rows),
    many: build(config.manyRows),
    append: build(config.rows),
  };
}

function createDataBuilder(seed: number) {
  let nextId = 1;
  let state = seed;
  const random = (max: number) => {
    state = (state * 1103515245 + 12345) >>> 0;
    return state % max;
  };

  return (count: number) => {
    const data = new Array<Row>(count);
    for (let i = 0; i < count; i++) {
      data[i] = {
        id: nextId++,
        label: `${ADJECTIVES[random(ADJECTIVES.length)]} ${
          COLOURS[random(COLOURS.length)]
        } ${NOUNS[random(NOUNS.length)]}`,
      };
    }
    return data;
  };
}

function createHtmlApp(): PerfApp {
  const { table, tbody } = createTable();
  let selectedRow: HTMLTableRowElement | null = null;

  const selectRow = (row: HTMLTableRowElement) => {
    if (selectedRow) selectedRow.className = "";
    selectedRow = row;
    selectedRow.className = "danger";
  };
  const createRow = (row: Row) => {
    let tr!: HTMLTableRowElement;
    tr = html`<tr>
      <td class="col-md-1">${row.id}</td>
      <td class="col-md-4">
        <a onclick=${() => selectRow(tr)}>${row.label}</a>
      </td>
      <td class="col-md-1">
        <a
          ><span class="glyphicon glyphicon-remove" aria-hidden="true"></span
        ></a>
      </td>
      <td class="col-md-6"></td>
    </tr>` as HTMLTableRowElement;
    return tr;
  };

  return createDirectApp(table, tbody, createRow, () => {
    selectedRow = null;
  });
}

function createHApp(): PerfApp {
  const { table, tbody } = createTable();
  let selectedRow: HTMLTableRowElement | null = null;

  const selectRow = (row: HTMLTableRowElement) => {
    if (selectedRow) selectedRow.className = "";
    selectedRow = row;
    selectedRow.className = "danger";
  };
  const createRow = (row: Row) => {
    let tr!: HTMLTableRowElement;
    tr = h(
      "tr",
      null,
      h("td", { class: "col-md-1" }, String(row.id)),
      h(
        "td",
        { class: "col-md-4" },
        h("a", { onclick: () => selectRow(tr) }, row.label),
      ),
      h(
        "td",
        { class: "col-md-1" },
        h(
          "a",
          null,
          h("span", {
            class: "glyphicon glyphicon-remove",
            "aria-hidden": "true",
          }),
        ),
      ),
      h("td", { class: "col-md-6" }),
    ) as HTMLTableRowElement;
    return tr;
  };

  return createDirectApp(table, tbody, createRow, () => {
    selectedRow = null;
  });
}

function createDirectApp(
  table: HTMLTableElement,
  tbody: HTMLTableSectionElement,
  createRow: (row: Row) => HTMLTableRowElement,
  resetSelected: () => void,
): PerfApp {
  const clear = () => {
    tbody.textContent = "";
    resetSelected();
  };

  return {
    run(rows) {
      clear();
      tbody.append(...rows.map(createRow));
    },
    add(rows) {
      tbody.append(...rows.map(createRow));
    },
    select(index) {
      getRow(tbody, index)?.querySelector("a")?.dispatchEvent(clickEvent());
    },
    rowCount: () => tbody.children.length,
    selectedCount: () => tbody.querySelectorAll("tr.danger").length,
    rowClass: (index) => getRow(tbody, index)?.className ?? "",
    firstId: () => firstCellText(tbody),
    dispose: () => table.remove(),
  };
}

type RowBuilder = (ctx: {
  row: Row;
  index: number;
  className: any;
  data: any;
  selected: any;
}) => HTMLTableRowElement;

// Same reactive row, one built with `h`, one with `html`. Both carry reactive
// slots (class, bind, id, label), so `html` cannot hit the compiled cache and
// falls back to per-row parsing – exactly the comparison we want to measure.
const hRowBuilder: RowBuilder = ({ row, index, className, data, selected }) =>
  h(
    "tr",
    { class: className, bind: data[index] },
    h("td", { class: "col-md-1" }, data[index].id),
    h(
      "td",
      { class: "col-md-4" },
      h("a", { onclick: () => selected(row.id) }, data[index].label),
    ),
    h(
      "td",
      { class: "col-md-1" },
      h(
        "a",
        null,
        h("span", {
          class: "glyphicon glyphicon-remove",
          "aria-hidden": "true",
        }),
      ),
    ),
    h("td", { class: "col-md-6" }),
  ) as HTMLTableRowElement;

const htmlRowBuilder: RowBuilder = ({
  row,
  index,
  className,
  data,
  selected,
}) =>
  html`<tr class="${className}" bind="${data[index]}">
    <td class="col-md-1">${data[index].id}</td>
    <td class="col-md-4">
      <a onclick=${() => selected(row.id)}>${data[index].label}</a>
    </td>
    <td class="col-md-1">
      <a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a>
    </td>
    <td class="col-md-6"></td>
  </tr>` as HTMLTableRowElement;

function createViewApp(): PerfApp {
  return createReactiveViewApp(hRowBuilder);
}

function createViewHtmlApp(): PerfApp {
  return createReactiveViewApp(htmlRowBuilder);
}

function createReactiveViewApp(buildRow: RowBuilder): PerfApp {
  const { table, tbody } = createTable();
  const data = reactive<Row[]>([]) as any;
  const selected = reactive<number | null>(null) as any;

  view(`#${tbody.id}`, data, (row: Row, index: number) => {
    const className = ternary(
      (value: number | null) => value === row.id,
      "danger",
      "",
      selected,
    );
    const tr = buildRow({ row, index, className, data, selected });
    onCleanup(unset, tr, className);
    return tr;
  });

  return {
    run(rows) {
      selected(null);
      data(rows);
    },
    add(rows) {
      data((current: Row[]) => [...current, ...rows]);
    },
    select(index) {
      getRow(tbody, index)?.querySelector("a")?.dispatchEvent(clickEvent());
    },
    rowCount: () => tbody.children.length,
    selectedCount: () => tbody.querySelectorAll("tr.danger").length,
    rowClass: (index) => getRow(tbody, index)?.className ?? "",
    firstId: () => firstCellText(tbody),
    dispose() {
      data([]);
      unset(selected);
      table.remove();
    },
    keyed: {
      nodeAt: (index) => getRow(tbody, index),
      idAt: (index) =>
        getRow(tbody, index)?.querySelector("td")?.textContent ?? "",
      swap: (i, j) =>
        data((prev: Row[]) => {
          [prev[i], prev[j]] = [prev[j], prev[i]];
        }),
      removeAt: (index) =>
        data((curr: Row[]) => {
          curr[index] = null as any;
        }),
    },
  };
}

function createTable() {
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  tbody.id = `hydro-perf-${++hostId}`;
  table.append(tbody);
  document.body.append(table);
  return { table, tbody };
}

function getRow(tbody: HTMLTableSectionElement, index: number) {
  return tbody.children[index] as HTMLTableRowElement | undefined;
}

function firstCellText(tbody: HTMLTableSectionElement) {
  return getRow(tbody, 0)?.querySelector("td")?.textContent ?? "";
}

function clickEvent() {
  return new MouseEvent("click", { bubbles: true, cancelable: true });
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Interquartile range as a percentage of the median: a compact noise gauge.
function spread(values: number[]) {
  if (values.length < 2) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.round(p * (sorted.length - 1)))];
  const med = median(values);
  return med ? ((at(0.75) - at(0.25)) / med) * 100 : 0;
}

function formatPct(pct: number) {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function formatMs(value: number) {
  return `${value.toFixed(2)}ms`;
}
