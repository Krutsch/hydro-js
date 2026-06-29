// Engine-agnostic memory-leak benchmark for hydro-js.
//
// The same scenarios run in Node (happy-dom + `global.gc`, see benchmark.node.ts)
// and in a real browser (chromium + `window.gc`, see benchmark.html). A GC
// implementation is injected so the core stays environment-free.
//
// Metric: number of WeakRef survivors after forced GC. A reactive Node that is
// unmounted / diffed-out / unbound must become collectable. Surviving nodes ==
// leaked nodes that the library still references (reactivityMap / bindMap).
function threshold(n) {
    // Tolerate GC noise + the final loop variable that may still be on stack.
    return Math.max(5, Math.floor(n * 0.02));
}
async function settle(gc) {
    // Drain microtasks + a macrotask, GC a few times so WeakRefs clear.
    await new Promise((r) => setTimeout(r, 0));
    gc();
    await new Promise((r) => setTimeout(r, 25));
    gc();
    await new Promise((r) => setTimeout(r, 0));
    gc();
}
function countAlive(refs) {
    let alive = 0;
    for (const r of refs)
        if (r.deref())
            alive++;
    return alive;
}
export async function runScenarios(deps) {
    const { gc, heap } = deps;
    const N = deps.N ?? 3000;
    const lib = await import("./library.js");
    const { html, render, reactive, unset, hydro, setGlobalSchedule } = lib;
    setGlobalSchedule(false); // synchronous render / update — deterministic
    const results = [];
    async function scenario(name, control, run) {
        const refs = [];
        const before = heap?.() ?? 0;
        await run(refs);
        await settle(gc);
        const alive = countAlive(refs);
        const limit = threshold(N);
        const after = heap?.() ?? 0;
        results.push({
            name,
            n: N,
            alive,
            limit,
            leaked: alive > limit,
            control,
            heapMB: heap ? (after - before) / 1048576 : undefined,
        });
    }
    // 1. render -> unmount of a reactive node, WITHOUT unset.
    //    One long-lived reactive isolates the *node* leak from hydro key growth.
    await scenario("render/unmount (reactive, no unset)", false, (refs) => {
        const d = reactive({ n: 0 });
        for (let i = 0; i < N; i++) {
            let e = html `<p>${d.n}</p>`;
            render(e)(); // mount then immediately unmount
            refs.push(new WeakRef(e));
            e = null;
        }
        void d; // keep proxy alive on purpose
    });
    // 2. diff/replace churn: each render replaces the previous node (discarded).
    //    Distinct leading int forces a real diff; the reactive token is space-
    //    separated so it resolves in both browser and server-side modes.
    await scenario("diff/replace churn (discarded old nodes)", false, (refs) => {
        const d = reactive({ n: 0 });
        const host = html `<div><span>seed ${d.n}</span></div>`;
        render(host);
        let where = host.querySelector("span");
        for (let i = 0; i < N; i++) {
            const e = html `<span>${i} ${d.n}</span>`;
            refs.push(new WeakRef(where)); // old node, about to be diffed out
            render(e, where);
            where = host.querySelector("span");
        }
        host.remove();
        void d;
    });
    // 3. bind + unmount WITHOUT unset (bindMap retains nodes).
    await scenario("bind + unmount (no unset)", false, (refs) => {
        hydro.benchBind = { v: 0 };
        for (let i = 0; i < N; i++) {
            let e = html `<p bind="{{benchBind}}">x${i}</p>`;
            render(e)();
            refs.push(new WeakRef(e));
            e = null;
        }
    });
    // 4. event listeners on detached nodes should not retain captured payloads.
    //    Keep the removed Elements alive on purpose: this isolates listener cleanup
    //    from ordinary Element GC and proves unmount releases handler closures.
    let retainedDetachedWithEvents = [];
    await scenario("event listeners + retained detached nodes", false, (refs) => {
        for (let i = 0; i < N; i++) {
            const payload = { i };
            const onClick = ((held) => () => held.i)(payload);
            const listener = i % 2 === 0 ? { event: onClick, options: { capture: true } } : onClick;
            let e = html `<button onclick=${listener}>${i}</button>`;
            render(e)();
            retainedDetachedWithEvents.push(e);
            refs.push(new WeakRef(payload));
            e = null;
        }
    });
    retainedDetachedWithEvents = [];
    // 5. CONTROL: non-reactive nodes must always be collectable (~0).
    await scenario("control: non-reactive", true, (refs) => {
        for (let i = 0; i < N; i++) {
            let e = html `<p>static-${i}</p>`;
            render(e)();
            refs.push(new WeakRef(e));
            e = null;
        }
    });
    // 6. CONTROL: reactive + unset already cleans today (~0).
    await scenario("control: reactive + unset", true, (refs) => {
        for (let i = 0; i < N; i++) {
            const d = reactive({ n: i });
            let e = html `<p>${d.n}</p>`;
            render(e)();
            unset(d);
            refs.push(new WeakRef(e));
            e = null;
        }
    });
    // ---- Correctness guards: the fix must not break reactivity ----
    const correctness = [];
    // reactive update still reflects in DOM, and unmount still detaches.
    {
        const d = reactive({ n: 1 });
        const e = html `<p>${d.n}</p>`;
        const u = render(e);
        d((c) => {
            c.n = 2;
        });
        const updated = String(e.textContent).includes("2");
        u();
        const detached = !e.isConnected;
        unset(d);
        correctness.push({ name: "reactive update reflects", ok: updated });
        correctness.push({ name: "unmount detaches", ok: detached });
    }
    // after a diff/replace, the NEW node is still reactive (guards purge gating).
    {
        const d = reactive({ n: 0 });
        const host = html `<div><span>seed ${d.n}</span></div>`;
        render(host);
        const first = host.querySelector("span");
        const e2 = html `<span>next ${d.n}</span>`;
        render(e2, first);
        d((c) => {
            c.n = 9;
        });
        const ok = String(host.textContent).includes("9");
        host.remove();
        unset(d);
        correctness.push({ name: "reactive after diff replace", ok });
    }
    // event listeners still fire before unmount, then unmount detaches.
    {
        let clicked = 0;
        const e = html `<button onclick=${() => clicked++}>hit</button>`;
        const u = render(e);
        e.click();
        u();
        correctness.push({ name: "event fires before unmount", ok: clicked === 1 });
        correctness.push({ name: "event unmount detaches", ok: !e.isConnected });
    }
    const pass = results.every((r) => !r.leaked) && correctness.every((c) => c.ok);
    return { results, correctness, pass };
}
export function formatReport(report) {
    const lines = [];
    lines.push("");
    lines.push("hydro-js memory benchmark");
    lines.push("=".repeat(64));
    lines.push(`${"scenario".padEnd(40)} ${"alive".padStart(7)} ${"limit".padStart(6)}  status`);
    lines.push("-".repeat(64));
    for (const r of report.results) {
        const status = r.leaked ? "LEAK" : "ok";
        const heap = r.heapMB !== undefined ? `  Δheap ${r.heapMB.toFixed(1)}MB` : "";
        lines.push(`${r.name.padEnd(40)} ${String(r.alive).padStart(7)} ${String(r.limit).padStart(6)}  ${status}${heap}`);
    }
    lines.push("-".repeat(64));
    for (const c of report.correctness) {
        lines.push(`${c.name.padEnd(40)} ${c.ok ? "ok" : "FAIL"}`);
    }
    lines.push("=".repeat(64));
    lines.push(report.pass ? "RESULT: PASS" : "RESULT: FAIL (leaks present)");
    lines.push("");
    return lines.join("\n");
}
