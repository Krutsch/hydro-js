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
    repeats: 10,
    warmups: 3,
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
        ["view-html", createViewHtmlApp],
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
    const keyed = runKeyedChecks(impls, config);
    return {
        config,
        results,
        keyed,
        pass: results.every((result) => result.ok) &&
            keyed.every((result) => result.ok),
    };
}
// Proves the framework is keyed: drive a swap and a remove through the reactive
// data and assert DOM node identity is preserved (moved), not recreated.
function runKeyedChecks(impls, config) {
    const keyed = [];
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
        const swap = swapApp.keyed;
        const nodeI = swap.nodeAt(i);
        const nodeJ = swap.nodeAt(j);
        const idI = swap.idAt(i);
        const idJ = swap.idAt(j);
        swap.swap(i, j);
        const swapKeepsIdentity = !!nodeI &&
            !!nodeJ &&
            swap.nodeAt(i) === nodeJ &&
            swap.nodeAt(j) === nodeI &&
            swap.idAt(i) === idJ &&
            swap.idAt(j) === idI;
        swapApp.dispose();
        // Remove: the removed node detaches, its neighbour keeps identity one slot up.
        const removeApp = createApp();
        removeApp.run(build(count));
        const remove = removeApp.keyed;
        const target = remove.nodeAt(removeIndex);
        const neighbour = remove.nodeAt(removeIndex + 1);
        remove.removeAt(removeIndex);
        const removeKeepsIdentity = !!target &&
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
export function formatPerfReport(report) {
    const lines = [];
    lines.push("");
    lines.push("hydro-js performance benchmark");
    lines.push("=".repeat(88));
    lines.push(`${"impl".padEnd(9)} ${"operation".padEnd(28)} ${"rows".padStart(7)} ${"median".padStart(10)} ${"min".padStart(10)}  status`);
    lines.push("-".repeat(88));
    for (const result of report.results) {
        lines.push(`${result.impl.padEnd(9)} ${result.operation.padEnd(28)} ${String(result.rows).padStart(7)} ${formatMs(result.medianMs).padStart(10)} ${formatMs(result.minMs).padStart(10)}  ${result.ok ? "ok" : "FAIL"}`);
    }
    if (report.keyed.length) {
        lines.push("=".repeat(88));
        lines.push("keyed-ness (DOM node identity through the framework)");
        lines.push("-".repeat(88));
        lines.push(`${"impl".padEnd(9)} ${"swap keeps node".padEnd(20)} ${"remove keeps node".padEnd(20)}  status`);
        for (const result of report.keyed) {
            lines.push(`${result.impl.padEnd(9)} ${(result.swapKeepsIdentity
                ? "yes"
                : "NO").padEnd(20)} ${(result.removeKeepsIdentity ? "yes" : "NO").padEnd(20)}  ${result.ok ? "keyed" : "FAIL"}`);
        }
    }
    lines.push("=".repeat(88));
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
// Same reactive row, one built with `h`, one with `html`. Both carry reactive
// slots (class, bind, id, label), so `html` cannot hit the compiled cache and
// falls back to per-row parsing – exactly the comparison we want to measure.
const hRowBuilder = ({ row, index, className, data, selected }) => h("tr", { class: className, bind: data[index] }, h("td", { class: "col-md-1" }, data[index].id), h("td", { class: "col-md-4" }, h("a", { onclick: () => selected(row.id) }, data[index].label)), h("td", { class: "col-md-1" }, h("a", null, h("span", {
    class: "glyphicon glyphicon-remove",
    "aria-hidden": "true",
}))), h("td", { class: "col-md-6" }));
const htmlRowBuilder = ({ row, index, className, data, selected }) => html `<tr class="${className}" bind="${data[index]}">
    <td class="col-md-1">${data[index].id}</td>
    <td class="col-md-4">
      <a onclick=${() => selected(row.id)}>${data[index].label}</a>
    </td>
    <td class="col-md-1">
      <a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a>
    </td>
    <td class="col-md-6"></td>
  </tr>`;
function createViewApp() {
    return createReactiveViewApp(hRowBuilder);
}
function createViewHtmlApp() {
    return createReactiveViewApp(htmlRowBuilder);
}
function createReactiveViewApp(buildRow) {
    const { table, tbody } = createTable();
    const data = reactive([]);
    const selected = reactive(null);
    view(`#${tbody.id}`, data, (row, index) => {
        const className = ternary((value) => value === row.id, "danger", "", selected);
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
        keyed: {
            nodeAt: (index) => getRow(tbody, index),
            idAt: (index) => getRow(tbody, index)?.querySelector("td")?.textContent ?? "",
            swap: (i, j) => data((prev) => {
                [prev[i], prev[j]] = [prev[j], prev[i]];
            }),
            removeAt: (index) => data((curr) => {
                curr[index] = null;
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
