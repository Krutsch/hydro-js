import { h, html, onCleanup, reactive, setGlobalSchedule, setReuseElements, ternary, unset, view, } from "./library.js";
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
const configDefaults = {
    rows: 1000,
    manyRows: 10000,
    repeats: 3,
    warmups: 1,
};
const operations = [
    {
        name: "create rows",
        rows: (config) => config.rows,
        run: (app, data) => app.run(data.base),
        verify: (app, data) => app.rowCount() === data.base.length && app.firstId() === "1",
    },
    {
        name: "replace all rows",
        rows: (config) => config.rows,
        run: (app, data) => {
            app.run(data.base);
            app.run(data.replacement);
        },
        verify: (app, data) => app.rowCount() === data.replacement.length &&
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
        verify: (app, data) => app.rowCount() === data.many.length &&
            app.firstId() === String(data.many[0].id),
    },
    {
        name: "append rows to large table",
        rows: (config) => config.rows,
        run: (app, data) => {
            app.run(data.base);
            app.add(data.append);
        },
        verify: (app, data) => app.rowCount() === data.base.length + data.append.length &&
            app.firstId() === "1",
    },
];
let hostId = 0;
export async function runPerfScenarios(deps = {}) {
    const config = { ...configDefaults, ...deps };
    const now = deps.now ?? (() => performance.now());
    const cleanup = deps.cleanup ?? (() => undefined);
    const results = [];
    setGlobalSchedule(false);
    setReuseElements(false);
    const impls = [
        ["html", createHtmlApp],
        ["h", createHApp],
        ["view", createViewApp],
    ];
    for (const [impl, createApp] of impls) {
        for (const operation of operations) {
            const samples = [];
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
                if (i >= config.warmups)
                    samples.push(elapsed);
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
export function formatPerfReport(report) {
    const lines = [];
    lines.push("");
    lines.push("hydro-js performance benchmark");
    lines.push("=".repeat(86));
    lines.push(`${"impl".padEnd(7)} ${"operation".padEnd(28)} ${"rows".padStart(7)} ${"median".padStart(10)} ${"min".padStart(10)}  status`);
    lines.push("-".repeat(86));
    for (const result of report.results) {
        lines.push(`${result.impl.padEnd(7)} ${result.operation.padEnd(28)} ${String(result.rows).padStart(7)} ${formatMs(result.medianMs).padStart(10)} ${formatMs(result.minMs).padStart(10)}  ${result.ok ? "ok" : "FAIL"}`);
    }
    lines.push("=".repeat(86));
    lines.push(report.pass ? "RESULT: PASS" : "RESULT: FAIL");
    lines.push("");
    return lines.join("\n");
}
function createSampleData(config, seed) {
    const build = createDataBuilder(seed);
    return {
        base: build(config.rows),
        replacement: build(config.rows),
        many: build(config.manyRows),
        append: build(config.rows),
    };
}
function createDataBuilder(seed) {
    let nextId = 1;
    let state = seed;
    const random = (max) => {
        state = (state * 1103515245 + 12345) >>> 0;
        return state % max;
    };
    return (count) => {
        const data = new Array(count);
        for (let i = 0; i < count; i++) {
            data[i] = {
                id: nextId++,
                label: `${ADJECTIVES[random(ADJECTIVES.length)]} ${COLOURS[random(COLOURS.length)]} ${NOUNS[random(NOUNS.length)]}`,
            };
        }
        return data;
    };
}
function createHtmlApp() {
    const { table, tbody } = createTable();
    let selectedRow = null;
    const selectRow = (row) => {
        if (selectedRow)
            selectedRow.className = "";
        selectedRow = row;
        selectedRow.className = "danger";
    };
    const createRow = (row) => {
        let tr;
        tr = html `<tr>
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
    </tr>`;
        return tr;
    };
    return createDirectApp(table, tbody, createRow, () => {
        selectedRow = null;
    });
}
function createHApp() {
    const { table, tbody } = createTable();
    let selectedRow = null;
    const selectRow = (row) => {
        if (selectedRow)
            selectedRow.className = "";
        selectedRow = row;
        selectedRow.className = "danger";
    };
    const createRow = (row) => {
        let tr;
        tr = h("tr", null, h("td", { class: "col-md-1" }, String(row.id)), h("td", { class: "col-md-4" }, h("a", { onclick: () => selectRow(tr) }, row.label)), h("td", { class: "col-md-1" }, h("a", null, h("span", {
            class: "glyphicon glyphicon-remove",
            "aria-hidden": "true",
        }))), h("td", { class: "col-md-6" }));
        return tr;
    };
    return createDirectApp(table, tbody, createRow, () => {
        selectedRow = null;
    });
}
function createDirectApp(table, tbody, createRow, resetSelected) {
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
function createViewApp() {
    const { table, tbody } = createTable();
    const data = reactive([]);
    const selected = reactive(null);
    view(`#${tbody.id}`, data, (row, index) => {
        const className = ternary((value) => value === row.id, "danger", "", selected);
        const tr = h("tr", { class: className, bind: data[index] }, h("td", { class: "col-md-1" }, data[index].id), h("td", { class: "col-md-4" }, h("a", { onclick: () => selected(row.id) }, data[index].label)), h("td", { class: "col-md-1" }, h("a", null, h("span", {
            class: "glyphicon glyphicon-remove",
            "aria-hidden": "true",
        }))), h("td", { class: "col-md-6" }));
        onCleanup(unset, tr, className);
        return tr;
    });
    return {
        run(rows) {
            selected(null);
            data(rows);
        },
        add(rows) {
            data((current) => [...current, ...rows]);
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
function getRow(tbody, index) {
    return tbody.children[index];
}
function firstCellText(tbody) {
    return getRow(tbody, 0)?.querySelector("td")?.textContent ?? "";
}
function clickEvent() {
    return new MouseEvent("click", { bubbles: true, cancelable: true });
}
function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}
function formatMs(value) {
    return `${value.toFixed(2)}ms`;
}
