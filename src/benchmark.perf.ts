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

type ImplName = "html" | "h" | "view";
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
  ok: boolean;
}

export interface PerfReport {
  config: Required<PerfConfig>;
  results: PerfResult[];
  pass: boolean;
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
  ];

  for (const [impl, createApp] of impls) {
    for (const operation of operations) {
      const samples: number[] = [];
      let ok = true;
      const totalRuns = config.warmups + config.repeats;

      for (let i = 0; i < totalRuns; i++) {
        const data = createSampleData(config, i + 1);
        const app = createApp();
        const start = now();
        operation.run(app, data);
        const elapsed = now() - start;
        ok = operation.verify(app, data) && ok;
        app.dispose();
        cleanup();

        if (i >= config.warmups) samples.push(elapsed);
      }

      results.push({
        impl,
        operation: operation.name,
        rows: operation.rows(config),
        samples,
        medianMs: median(samples),
        minMs: Math.min(...samples),
        ok,
      });
    }
  }

  return { config, results, pass: results.every((result) => result.ok) };
}

export function formatPerfReport(report: PerfReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("hydro-js performance benchmark");
  lines.push("=".repeat(86));
  lines.push(
    `${"impl".padEnd(7)} ${"operation".padEnd(28)} ${"rows".padStart(
      7,
    )} ${"median".padStart(10)} ${"min".padStart(10)}  status`,
  );
  lines.push("-".repeat(86));
  for (const result of report.results) {
    lines.push(
      `${result.impl.padEnd(7)} ${result.operation.padEnd(28)} ${String(
        result.rows,
      ).padStart(7)} ${formatMs(result.medianMs).padStart(
        10,
      )} ${formatMs(result.minMs).padStart(10)}  ${result.ok ? "ok" : "FAIL"}`,
    );
  }
  lines.push("=".repeat(86));
  lines.push(report.pass ? "RESULT: PASS" : "RESULT: FAIL");
  lines.push("");
  return lines.join("\n");
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

function createViewApp(): PerfApp {
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
    const tr = h(
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

function formatMs(value: number) {
  return `${value.toFixed(2)}ms`;
}
