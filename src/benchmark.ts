// Engine-agnostic memory-leak benchmark for hydro-js.
//
// Scenarios run in a clean Chromium instance with `window.gc` exposed by
// Playwright (see benchmark.browser.node.ts and benchmark.html). GC and heap
// readers are injected so the core stays environment-free.
//
// Metric: number of WeakRef survivors after forced GC. A reactive Node that is
// unmounted / diffed-out / unbound must become collectable. Surviving nodes ==
// leaked nodes that the library still references (reactivityMap / bindMap).

type Lib = typeof import("./library.js");

export interface BenchDeps {
  gc: () => void; // force GC (chromium: window.gc with --expose-gc)
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
    selector,
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

  // A caller may keep a row proxy after clearing the view. Cleanup must still
  // untrack the detached Element from bindMap/reactivityMap; it is not safe to
  // assume that row proxies become unreachable with the discarded data array.
  let retainedViewRows: any[] = [];
  await scenario(
    "view cleanup with externally retained row proxies",
    false,
    (refs) => {
      setReuseElements(false);
      const rootId = "bench-view-retained-proxy";
      const root: any = html`<ul id=${rootId}></ul>`;
      render(root);
      const selected = reactive(-1);
      const data: any = reactive([] as Array<{ id: number }>);

      view(`#${rootId}`, data, (item: any, i: number) => {
        const className = ternary(
          (value: number) => value === item.id,
          "selected",
          "",
          selected,
        );
        const li: any = html`<li class=${className} bind=${data[i]}>${data[i].id}</li>`;
        onCleanup(unset, li, className);
        refs.push(new WeakRef(li));
        return li;
      });

      const count = Math.min(N, 100);
      data(Array.from({ length: count }, (_, id) => ({ id })));
      retainedViewRows = Array.from({ length: count }, (_, i) => data[i]);
      data([]);
      void retainedViewRows[0];
      root.remove();
      unset(data);
      unset(selected);
      setReuseElements(true);
    },
  );
  retainedViewRows = [];

  // M4. Direct DOM removal is lazy-cleaned on the next reactive write to the
  // same key. The caller should prefer render()'s unmount handle for immediate
  // cleanup; this guard ensures stale traces don't survive a subsequent write.
  let releaseDetachedText: () => void = () => {};
  await scenario("manual DOM removal purged on next source update", false, (refs) => {
    const data = reactive({ n: 0 });
    releaseDetachedText = () => unset(data);
    for (let i = 0; i < N; i++) {
      const elem = html`<p>${data.n}</p>` as Element;
      render(elem, "", false);
      refs.push(new WeakRef(elem.firstChild!));
      elem.remove();
    }
    getValue(data).n++;
  });
  releaseDetachedText();

  // M5. ternary subscriptions are caller-owned; disposing each derived value
  // must stop its observer on the long-lived shared condition.
  await scenario("ternary observers released by unset", false, (refs) => {
    const selected = reactive(-1);
    for (let i = 0; i < N; i++) {
      const derived = ternary((value: number) => value === i, "yes", "no", selected);
      refs.push(new WeakRef(derived));
      unset(derived);
    }
    unset(selected);
  });

  // M14. selector() keeps one subscription on the source plus one derived
  // signal per requested key. Unsetting each derived value must drop it from
  // the selector; disposing the selector must stop the source subscription.
  await scenario("selector derived values released by unset+dispose", false, (refs) => {
    const selected = reactive(-1);
    const isSel = selector(selected);
    for (let i = 0; i < N; i++) {
      const derived = isSel(i);
      const className = ternary(
        (value: boolean) => value,
        "yes",
        "no",
        derived,
      );
      refs.push(new WeakRef(derived));
      refs.push(new WeakRef(className));
      unset(className);
      unset(derived);
    }
    // A null write drops the shared subscription (library contract); the
    // next lookup re-arms it. Exercise that cycle under GC scrutiny.
    selected(null);
    const revived = isSel(N + 1);
    refs.push(new WeakRef(revived));
    unset(revived);
    selected(N + 1);
    isSel.dispose();
    unset(selected);
  });

  // M6. chainKeys intentionally memoizes one child per chain node; repeated
  // changing-property reads must not retain every ephemeral child proxy.
  let releaseChainRoot: () => void = () => {};
  await scenario("chainKeys retains at most one child proxy", true, (refs) => {
    const value = reactive({}) as any;
    releaseChainRoot = () => unset(value);
    for (let i = 0; i < N; i++) refs.push(new WeakRef(value[`field${i}`]));
    void value.cleanup; // replace the one-slot memo with a non-measured child
  });
  releaseChainRoot();

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

  // M3. A throwing view row-builder must restore the global html wiring mode.
  // Keep this last because a regression leaves the module in view mode.
  {
    const id = "bench-view-throwing-renderer";
    const root: any = html`<ul id=${id}></ul>`;
    render(root, "", false);
    const data = reactive([{}]);
    let threw = false;
    try {
      view(`#${id}`, data, () => {
        throw new Error("expected view builder error");
      });
    } catch {
      threw = true;
    }
    const label = reactive({ value: "label" });
    const button: any = html`<button onclick=${() => undefined}>${label.value}${document.createTextNode("tail")}</button>`;
    const wired = button.getAttribute("onclick") === null;
    root.remove();
    button.remove();
    unset(data);
    unset(label);
    correctness.push({ name: "view error restores html wiring mode", ok: threw && wired });
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
