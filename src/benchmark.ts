// Engine-agnostic memory-leak benchmark for hydro-js.
//
// The same scenarios run in Node (happy-dom + `global.gc`, see benchmark.node.ts)
// and in a real browser (chromium + `window.gc`, see benchmark.html). A GC
// implementation is injected so the core stays environment-free.
//
// Metric: number of WeakRef survivors after forced GC. A reactive Node that is
// unmounted / diffed-out / unbound must become collectable. Surviving nodes ==
// leaked nodes that the library still references (reactivityMap / bindMap).

type Lib = typeof import("./library.js");

export interface BenchDeps {
  gc: () => void; // force GC (node: global.gc, chromium: window.gc w/ --expose-gc)
  heap?: () => number; // current heap usage in bytes (optional)
  N?: number; // iterations per scenario
}

export interface ScenarioResult {
  name: string;
  n: number;
  alive: number; // surviving WeakRefs after GC
  limit: number; // allowed survivors (noise budget)
  leaked: boolean; // alive > limit
  control: boolean; // sanity scenario that must always pass
  heapMB?: number;
}

export interface BenchReport {
  results: ScenarioResult[];
  correctness: { name: string; ok: boolean }[];
  pass: boolean;
}

function threshold(n: number) {
  // Tolerate GC noise + the final loop variable that may still be on stack.
  return Math.max(5, Math.floor(n * 0.02));
}

async function settle(gc: () => void) {
  // Drain microtasks + a macrotask, GC a few times so WeakRefs clear.
  await new Promise((r) => setTimeout(r, 0));
  gc();
  await new Promise((r) => setTimeout(r, 25));
  gc();
  await new Promise((r) => setTimeout(r, 0));
  gc();
}

function countAlive(refs: Array<WeakRef<object>>) {
  let alive = 0;
  for (const r of refs) if (r.deref()) alive++;
  return alive;
}

export async function runScenarios(deps: BenchDeps): Promise<BenchReport> {
  const { gc, heap } = deps;
  const N = deps.N ?? 3000;
  const lib: Lib = await import("./library.js");
  const {
    html,
    render,
    reactive,
    unset,
    hydro,
    setGlobalSchedule,
    view,
    getValue,
    onCleanup,
    ternary,
    setReuseElements,
  } = lib;

  setGlobalSchedule(false); // synchronous render / update — deterministic

  const results: ScenarioResult[] = [];

  async function scenario(
    name: string,
    control: boolean,
    run: (refs: Array<WeakRef<object>>) => void | Promise<void>,
  ) {
    const refs: Array<WeakRef<object>> = [];
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
      let e: any = html`<p>${d.n}</p>`;
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
    const host: any = html`<div><span>seed ${d.n}</span></div>`;
    render(host);
    let where: any = host.querySelector("span");
    for (let i = 0; i < N; i++) {
      const e: any = html`<span>${i} ${d.n}</span>`;
      refs.push(new WeakRef(where)); // old node, about to be diffed out
      render(e, where);
      where = host.querySelector("span");
    }
    host.remove();
    void d;
  });

  // 3. bind + unmount WITHOUT unset (bindMap retains nodes).
  await scenario("bind + unmount (no unset)", false, (refs) => {
    (hydro as any).benchBind = { v: 0 };
    for (let i = 0; i < N; i++) {
      let e: any = html`<p bind="{{benchBind}}">x${i}</p>`;
      render(e)();
      refs.push(new WeakRef(e));
      e = null;
    }
  });

  // 4. event listeners on detached nodes should not retain captured payloads.
  //    Keep the removed Elements alive on purpose: this isolates listener cleanup
  //    from ordinary Element GC and proves unmount releases handler closures.
  let retainedDetachedWithEvents: Element[] = [];
  await scenario("event listeners + retained detached nodes", false, (refs) => {
    for (let i = 0; i < N; i++) {
      const payload = { i };
      const onClick = (
        (held) => () =>
          held.i
      )(payload);
      const listener =
        i % 2 === 0 ? { event: onClick, options: { capture: true } } : onClick;
      let e: any = html`<button onclick=${listener}>${i}</button>`;
      render(e)();
      retainedDetachedWithEvents.push(e);
      refs.push(new WeakRef(payload));
      e = null;
    }
  });
  retainedDetachedWithEvents = [];

  // 5. view() registers multiple root cleanup callbacks. They must all run on
  //    unmount, otherwise the reactive view data remains reachable from hydro.
  await scenario("view unmount releases reactive data", false, (refs) => {
    for (let i = 0; i < N; i++) {
      const id = `bench-view-${i}`;
      let root: any = html`<ul id=${id}></ul>`;
      const unmount = render(root);
      let data: any = reactive([{ id: i, label: `row-${i}` }]);
      view(`#${id}`, data, (item, index) => html`<li>${data[index].id}</li>`);
      refs.push(new WeakRef(getValue(data)));
      unmount();
      root = null;
      data = null;
    }
  });

  // 5b. Real-world list pattern: view() + ternary(shared condition) + bind,
  // with the exact run()/clear() sequence used by the js-framework-benchmark
  // keyed app (selected(null) around each data swap). This passes even
  // without the view()/ternary() fixes below, because nulling the shared
  // condition happens to force-clear its whole observer Set as a side effect
  // - kept as a faithful reproduction of the actual benchmark app for context/
  // regression coverage of that exact sequence, not as the primary guard
  // (see 5c for that).
  await scenario(
    "view + ternary(shared) + bind: repeated create/clear (real app pattern)",
    false,
    async (refs) => {
      setReuseElements(false); // matches js-framework-benchmark keyed app
      const rootId = "bench-view-realworld";
      const root: any = html`<ul id=${rootId}></ul>`;
      render(root);
      const selected = reactive(-1);
      const data: any = reactive([] as Array<{ id: number }>);

      view(`#${rootId}`, data, (item: any, i: number) => {
        const className = ternary(
          (val: number) => val === item.id,
          "danger",
          "",
          selected,
        );
        const li: any = html`<li class=${className} bind=${data[i]}>
          ${data[i].id}
        </li>`;
        onCleanup(unset, li, className);
        refs.push(new WeakRef(li));
        return li;
      });

      const cycles = Math.max(3, Math.floor(N / 100));
      const rowsPerCycle = 25;
      let nextId = 0;
      for (let c = 0; c < cycles; c++) {
        selected(null);
        const rows = new Array(rowsPerCycle);
        for (let i = 0; i < rowsPerCycle; i++) rows[i] = { id: nextId++ };
        data(rows);
        data([]);
        selected(null);
      }

      root.remove();
      setReuseElements(true);
    },
  );

  // 5c. Same as 5b but WITHOUT ever nulling the shared condition (`selected`).
  // A "currently selected id" that legitimately persists across data reloads
  // (never nulled) is at least as realistic as 5b's pattern, and is the actual
  // regression guard: reverting either fix below fails it.
  //   - Without view()'s resetViewRows (the textContent="" reset skipping
  //     runLifecyle/purgeSubtree): rows' onCleanup(unset, li, className)
  //     never runs at all, so nothing here is exercised - the <li> Elements
  //     leak (the expensive part: DOM nodes, Text children, listeners).
  //   - With resetViewRows but without ternary()'s disposer wiring: unset()
  //     now runs, and purgeSubtree's explicit bindMap/reactivityMap deletes
  //     free the <li> Elements regardless - but the observe(selected, ...)
  //     subscription itself is still never stopped, so the row Proxy (and the
  //     closure capturing it) leaks forever, smaller but unbounded.
  //   - Both together: neither leaks.
  await scenario(
    "view + ternary(shared, never-nulled) + bind: repeated create/clear",
    false,
    async (refs) => {
      setReuseElements(false);
      const rootId = "bench-view-realworld-nonull";
      const root: any = html`<ul id=${rootId}></ul>`;
      render(root);
      const selected = reactive(-1); // never nulled below, unlike scenario 5b

      const data: any = reactive([] as Array<{ id: number }>);

      view(`#${rootId}`, data, (item: any, i: number) => {
        const className = ternary(
          (val: number) => val === item.id,
          "danger",
          "",
          selected,
        );
        const li: any = html`<li class=${className} bind=${data[i]}>
          ${data[i].id}
        </li>`;
        onCleanup(unset, li, className);
        refs.push(new WeakRef(li));
        return li;
      });

      const cycles = Math.max(3, Math.floor(N / 100));
      const rowsPerCycle = 25;
      let nextId = 0;
      for (let c = 0; c < cycles; c++) {
        const rows = new Array(rowsPerCycle);
        for (let i = 0; i < rowsPerCycle; i++) rows[i] = { id: nextId++ };
        data(rows);
        data([]);
      }

      root.remove();
      setReuseElements(true);
    },
  );

  // 6. CONTROL: non-reactive nodes must always be collectable (~0).
  await scenario("control: non-reactive", true, (refs) => {
    for (let i = 0; i < N; i++) {
      let e: any = html`<p>static-${i}</p>`;
      render(e)();
      refs.push(new WeakRef(e));
      e = null;
    }
  });

  // 7. CONTROL: reactive + unset already cleans today (~0).
  await scenario("control: reactive + unset", true, (refs) => {
    for (let i = 0; i < N; i++) {
      const d = reactive({ n: i });
      let e: any = html`<p>${d.n}</p>`;
      render(e)();
      unset(d);
      refs.push(new WeakRef(e));
      e = null;
    }
  });

  // ---- Correctness guards: the fix must not break reactivity ----
  const correctness: { name: string; ok: boolean }[] = [];

  // reactive update still reflects in DOM, and unmount still detaches.
  {
    const d = reactive({ n: 1 });
    const e: any = html`<p>${d.n}</p>`;
    const u = render(e);
    d((c: any) => {
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
    const host: any = html`<div><span>seed ${d.n}</span></div>`;
    render(host);
    const first = host.querySelector("span");
    const e2: any = html`<span>next ${d.n}</span>`;
    render(e2, first);
    d((c: any) => {
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
    const e: any = html`<button onclick=${() => clicked++}>hit</button>`;
    const u = render(e);
    e.click();
    u();
    correctness.push({ name: "event fires before unmount", ok: clicked === 1 });
    correctness.push({ name: "event unmount detaches", ok: !e.isConnected });
  }

  const pass =
    results.every((r) => !r.leaked) && correctness.every((c) => c.ok);

  return { results, correctness, pass };
}

export function formatReport(report: BenchReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("hydro-js memory benchmark");
  lines.push("=".repeat(64));
  lines.push(
    `${"scenario".padEnd(40)} ${"alive".padStart(7)} ${"limit".padStart(6)}  status`,
  );
  lines.push("-".repeat(64));
  for (const r of report.results) {
    const status = r.leaked ? "LEAK" : "ok";
    const heap =
      r.heapMB !== undefined ? `  Δheap ${r.heapMB.toFixed(1)}MB` : "";
    lines.push(
      `${r.name.padEnd(40)} ${String(r.alive).padStart(7)} ${String(
        r.limit,
      ).padStart(6)}  ${status}${heap}`,
    );
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
