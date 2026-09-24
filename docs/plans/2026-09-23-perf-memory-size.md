# Plan: js-framework-benchmark performance, memory/leaks, code size

Status: **local work complete — release prepared, not published** · Created: 2026-09-23 · Base: `v1.10.1` (`7c4fedc`)

Goals

1. Make hydro-js faster in [js-framework-benchmark] (jfb), the keyed
   `frameworks/keyed/hydro-js` app. Improve our own benchmark suite first so it
   measures what jfb measures.
2. Use less memory overall and remove every leak we can find.
3. Shrink and simplify `src/library.ts` (2964 LOC, 8.91 KB br for `full`)
   without removing features or changing behavior.

Non-goals: API breaking changes, dropping SSR / happy-dom / jsdom support, new
dependencies in the published package.

### Implementation progress

- B1: jfb hydro-js and vanillajs fixtures copied from upstream commit
  `f2df01a8679de05225c32714ca8cecbea3d78c5d`; local/published bundle variants
  are implemented.
- B1–B4: jfb fixtures/build variants, click-to-paint CDP harness, jfb warmup
  sequences and CPU throttling, paired ratio-vs-vanilla reports, heap/DOM/
  listener metrics, hydro root-key checks and optional heap snapshots are in
  place. `bench:jfb:check` passes against the 10-sample paired-ratio baseline.
- B3: the existing perf suite has an `incl deferred` metric and a `--same-app`
  mode. Reactive view rows use static ids and include the remove handler;
  clear also resets selection.
- B5: L1/L2 failing-before-fix tests were reproduced, then pass after M1/M2.
  M3/M4/M5/M6 guards pass; native removal is lazily purged on the next source
  write and ternaries require explicit disposal. A retained-row-proxy scenario
  also confirms cleanup releases detached nodes while callers keep `data[i]`.
- B6/B7: full-jfb validation script and CI memory/size gates are implemented.
  `JFB_COUNT=1 scripts/jfb-validate.sh` completed successfully against the
  1.10.2 tarball, including the upstream `isKeyed` check; the script handles
  the upstream peer-dependency conflict, server lifecycle, and local Chrome
  executable.
- `perf-baseline.jfb.v1.10.1.json` preserves the pre-fix release probe;
  `perf-baseline.jfb.phase-c.json` is the pre-M10/M11 raw-mouse comparison;
  `perf-baseline.jfb.json` is the post-M10/M11 gate (10 samples, 20 for
  jfb's repeated select benchmark).
- S1–S6 and S8 are implemented; S7 review found `h()` already uses one props
  pass and one children pass with mode branches. Phase C's full bundle was
  8.89 KB brotli (−19 B vs the original size baseline). S9's internal timeout
  fallback is now implemented; current full bundle is 9.05 KB.
- Phase D: M10/M11, P1's fresh-signal path, P4's scoped row wiring, P5's
  monotonic event ids, and the optional unminified CPU-profile fixture are
  implemented. P6 also removes a redundant `reactivityMap.has()` before
  `.get()` on the null-reset path; the focused clear gate passes, but the ratio
  change is within harness noise. M10/M11 reduce the 10k JFB heap delta;
  `bench:jfb:check` uses a 20% noise tolerance. A 10-sample `background`
  cleanup-priority trial showed no attributable local clear win, so
  `user-blocking` remains. M13's callback-record experiment was reverted for
  no measurable gain. M12's broad purge-skip premise is rejected by a
  retained-row proxy regression scenario; remaining hypotheses are deferred
  based on profiling or behavioral risk. The latest full JFB check passes:
  local/vanilla ratios are 1.23 create, 1.16 replace, 1.24 partial update,
  1.12 select, 1.13 swap, 1.02 remove, 1.26 runlots, 1.20 append and 1.21
  clear. Versus the post-M10/M11 baseline, these range roughly −4% to +12%,
  within the 20% noise gate.
- Phase E: S9's scheduler fallback is implemented; S10 retained existing
  function-source equality after regression tests confirmed the behavior
  contract; S11 removed an unused subtree helper and inert `internReset` flag.
  Prepared the 1.10.2 changelog/version bump and a local upstream JFB patch at
  `bench/jfb/upstream-hydro-js-1.10.2.patch`; it has not been pushed. The
  package was not published to npm; the user requested local release/PR prep
  only.
- Validation: `npm test` passes 327 tests in happy-dom, jsdom, Chromium,
  Firefox and WebKit; `bench:mem`, size, browser perf, full `bench:jfb:check`,
  and the full upstream JFB validation plus `isKeyed` pass. M10/M11 raised full
  brotli to 9.18 KB while reducing 10k heap; P5 brought it to 9.12 KB, P6 to
  9.11 KB, S9/S11 to 9.05 KB. S11 leaves the library at 2,994 lines vs the
  2,964-line starting point. The user accepted documenting unmet thresholds
  and proceeding: full brotli is 9.05 KB (target 8.0 KB), line count is 2,994
  (target 2,500), 10k retention is ~1.44 KB/row (target ≤1.2), 5× clear
  remains about +0.49 MB (target ≤+0.2 MB), and coverage is 96.39% (target
  100%). Version 1.10.2 is prepared locally; no npm publish or upstream push
  was performed.

---

## 0. Baseline (measured 2026-09-23, this machine, headless Chromium)

### Existing suites

| suite                                | result                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `test:dom`                           | 322/322 happy-dom, 322/322 jsdom                                                                             |
| `bench:mem` (WeakRef survivors)      | all 9 scenarios 0 alive → PASS                                                                               |
| `bench:size` brotli                  | library-file 8.99 KB · full 8.91 · html-render 6.95 · reactive-core 5.10 · view 5.81 · jsx-runtime 5.89      |
| `bench:perf:browser` (JS time, min)  | view: create 6.4 ms · replace 7.4 · create many 74.8 · append 6.5 · clear 0.2 (h direct: 2.6 / 2.9 / 27.3)   |
| scaled interactions (100 ops)        | view: update-10th 16.3 ms · select 9.0 ms · swap 0.3 · remove 0.8                                            |

### Phase C JFB-faithful baseline (10 paired samples, local hydro-js vs vanillajs)

Measured with the copied upstream app and stylesheet, 1024×768 headless
Chromium, jfb warmup sequences, and jfb CPU rates (4× update/select/swap/clear,
2× remove). Duration is click `EventDispatch` start → last `Paint`/`Commit`;
`fallback` is click-capture → two animation frames. Use ratios for comparisons;
these absolute times are machine-specific.

| operation | CPU | hydro median | vanilla median | hydro / vanilla |
| --- | ---: | ---: | ---: | ---: |
| create rows (1k) | 1× | 37.21 ms | 33.06 ms | 1.12× |
| replace all (1k) | 1× | 43.01 ms | 36.12 ms | 1.21× |
| partial update | 4× | 24.66 ms | 20.82 ms | 1.17× |
| select row | 4× | 7.08 ms | 6.46 ms | 1.06× |
| swap rows | 4× | 26.58 ms | 23.48 ms | 1.14× |
| remove row | 2× | 19.49 ms | 18.67 ms | 1.04× |
| create many (10k) | 1× | 485.63 ms | 386.61 ms | 1.27× |
| append 1k to 1k | 1× | 41.80 ms | 34.53 ms | 1.22× |
| clear rows (1k) | 4× | 19.86 ms | 15.17 ms | 1.17× |

Heap after forced GC (CDP `Performance.getMetrics`):

| implementation / state | JS heap | DOM nodes | listeners | hydro root keys |
| --- | ---: | ---: | ---: | ---: |
| hydro ready | 1.76 MB | 94 | 32 | 8 |
| hydro run 1k | 3.51 MB | 11,094 | 2,032 | 1,007 |
| hydro run 10k | 17.03 MB | 110,097 | 20,032 | 10,007 |
| hydro after 1× create/clear | 2.11 MB | 97 | 32 | 7 |
| hydro after 5× create/clear | 2.24 MB | 97 | 32 | 7 |
| hydro after 25× create/clear | 2.36 MB | 97 | 32 | 7 |
| vanilla ready | 1.67 MB | 105 | 28 | — |
| vanilla run 1k | 1.96 MB | 11,104 | 28 | — |
| vanilla run 10k | 3.33 MB | 110,107 | 28 | — |
| vanilla after 5× create/clear | 1.85 MB | 107 | 28 | — |

What this tells us:

- Hydro retains about **1.79 KB/row at 1k** and **1.56 KB/row at 10k**;
  vanilla retains about 0.29 KB and 0.17 KB respectively. This is the main
  target for "run memory".
- Five create/clear cycles leave **+0.48 MB** vs ready; 25 cycles leave
  **+0.53 MB**, so this is largely a retained plateau, not an unbounded slope.
- Root-key count falls from 8 to 7 after clear because the app's selected
  signal is intentionally set to null/deleted; after that, 1/5/25 cycles are
  stable at 7. During run it grows with row ternaries (1,007 / 10,007 keys),
  then returns to baseline.
- The DOM node count is still +3 after clear (94 → 97). Investigate whether
  these are persistent leaked nodes or Chromium table/layout bookkeeping.
- This Phase C paired-ratio baseline is preserved in
  `perf-baseline.jfb.phase-c.json`; the current M10/M11 gate is in
  `perf-baseline.jfb.json`. The harness uses raw browser mouse input after
  resolving the target, avoiding Playwright's injected locator hit-test work
  inside the trace. Do not compare absolute timings across machines.

### Leaks and bugs confirmed while probing (fixed in this work)

- **L1** At the base commit, `render(fragment)` with scheduling on (the
  default) returned `unmount(fragment)`. After the scheduled mount the fragment
  was empty, so `removeElement(fragment)` did nothing. M1 now captures the
  children for the unmount closure; its regression test passes.
- **L2** At the base commit, a throwing `watchEffect(fn)` left `trackDeps` true
  globally; later proxy reads were subscribed to the next effect and could
  cause wrong re-runs/retention. M2 now scopes dependencies to a local tracker
  and restores it in `finally`; its regression test passes.

---

## 1. Benchmark suite work (do this first; everything else depends on it)

The current `benchmark.perf.ts` misses what jfb measures:

| gap | jfb | our suite |
| --- | --- | --- |
| what is timed | click → last paint, from a Chrome trace | synchronous JS only |
| deferred work | `postTask(user-blocking)` / rIC work that runs before paint is counted | excluded (`yieldToScheduler` sits outside the timed region) |
| warm state | same page; warmups use run/clear cycles in the same app | a brand-new app per sample |
| CPU throttling | 4× for update/select/swap/clear, 2× for remove | none |
| app code | static `{item.id}`, **2 handlers/row** (select + remove), `remove` via `findIndex`, `clear = data([]); selected(null)`, `run = selected(null); data(...)`, JSX → `h` | reactive `data[i].id`, 1 handler, clear without `selected(null)` → "clear 0.2 ms" is misleading |
| memory | ready / run 1k / 5× create-clear (JS heap after GC) | WeakRef survivor counts only |
| reference | results reported as a slowdown factor vs the fastest framework | no vanilla reference |

### Tasks

- **B1 – Vendor the real jfb app as a fixture.** Add `bench/jfb/app.tsx` and
  `index.html` as verbatim copies from `frameworks/keyed/hydro-js/src`, plus
  jfb's `vanillajs` `main.js` as the reference (both Apache-2.0; keep the
  license header). Bundle them with esbuild (`--jsx-factory=h`, minified, like
  html-bundle does). Add a build variant that uses the **published npm
  version** so A/B comparisons against the release are possible.
- **B2 – `bench:jfb` harness** (`src/benchmark.jfb.node.ts`, Playwright + CDP,
  same static-server pattern as the other harnesses):
  - Reproduce the 9 jfb duration benchmarks with the same init/warmup
    sequences (see `webdriver-ts/src/benchmarksPlaywright.ts`) and the same
    throttling (`Emulation.setCPUThrottlingRate`).
  - Measure duration from a `Tracing` capture
    (`devtools.timeline`, `disabled-by-default-devtools.timeline`): from the
    click `EventDispatch` start to the end of the last `Paint`/`Commit`, like
    jfb's `parseTrace.ts`. Also report a cheap fallback metric
    (click-capture → two `requestAnimationFrame`s).
  - Memory: ready, run 1k, and 5× create/clear via
    `HeapProfiler.collectGarbage` + `JSHeapUsedSize`. Also record `Nodes` and
    `JSEventListeners`.
  - Run hydro-js and vanillajs interleaved and report absolute ms plus the
    **ratio to vanilla** to cancel machine noise. Use ≥10 samples, report
    median and min, and keep a baseline JSON with a regression gate like
    `perf-baseline.browser.json`.
- **B3 – Align `benchmark.perf.ts` with the real app.** The `view`/`view-html`
  row builders should match `app.tsx`: static id, a remove handler, and the
  real `run`/`clear` sequences. Add an **"incl. deferred"** column that awaits
  `yieldToScheduler()` inside the timed region. Add an in-page warm mode that
  runs warmups on the same app instance.
- **B4 – Memory size metrics in `bench:mem`,** on top of the survivor counts:
  bytes per row at 1k/10k, retained growth after 1/5/25 create/clear cycles
  (the slope must be ~0), listener and DOM node counts, and
  `Reflect.ownKeys(hydro).length` before and after cycles. `bench:heap` takes
  CDP heap snapshots at ready / run 1k / after 5× clear and reports the
  largest node-name/type groups by self size. These are diagnostic type
  totals (not V8 retained-size/dominator measurements).
- **B5 – New leak scenarios** (each must fail before its fix): L1, L2, plus
  every item in §2 marked *suspected*.
- **B6 – Full-jfb validation script** (`scripts/jfb-validate.sh`, not in CI):
  clone jfb, point `frameworks/keyed/hydro-js` at the local build
  (`npm pack` → file dep), then run `npm run bench -- --framework
  keyed/hydro-js keyed/vanillajs` and `isKeyed`. Use it at phase ends only.
  It is slow, but it is the ground truth.
- **B7 – CI.** Add `bench:mem` and a short `bench:size --baseline` gate to
  the workflow. Perf gates stay local because CI runners are too noisy.

Exit criteria: run `bench:jfb` three times and record ratio spread. The
current 10-sample paired-ratio regression gate is 20% because headless Chromium
shows occasional ~20% ratio swings on layout/cleanup-heavy operations; report
min/median/spread and reduce the gate after repeated-run noise calibration.

---

## 2. Memory and leaks

### Fix (confirmed)

- **M1 (L1) – fixed.** Scheduled `render()` of a DocumentFragment captures
  `Array.from(fragment.childNodes)` *before* scheduling and returns
  `unmount(children)`.
- **M2 (L2) – fixed.** `watchEffect` now uses a per-effect dependency `Map`
  and restores the previous tracker in `finally`. A thrown callback discards
  only its local dependencies; nested effects restore the outer tracker. Async
  effects track synchronous reads only, since a module-global collector cannot
  remain active across `await` while unrelated code runs.

### Leak review (B5 scenarios added)

- **M3 – fixed.** `view()` now restores its global mode and clears the
  temporary event-function map in `finally` on both initial render and
  observer updates.
- **M4 – documented/lazy purge.** Native `el.remove()` bypasses hydro lifecycle
  cleanup. Its tracked nodes are released on the next write to their source
  key (`applyNodeChanges` checks `isConnected`); use `render()`'s unmount
  function for immediate cleanup. `bench:mem` verifies the next-write purge.
- **M5 – explicit ownership contract.** A ternary subscription lives until its
  returned reactive value is `unset()`. If a DOM node owns the value, register
  `onCleanup(unset, node, ternaryValue)`; otherwise call `unset()` yourself.
  Automatic disposal is not safe because ternaries can be used outside the DOM
  or shared by multiple consumers. `README.md` documents this contract.
- **M6 – bounded.** The B5 WeakRef scenario confirms `chainKeys` retains only
  its documented one-child memo, not every historical child proxy.
- **M7 – plateau, not growth.** Heap rises about 0.48 MB by 5 cycles and
  0.59 MB by 25 cycles in the current harness; inspect heap snapshots before
  attributing this to library objects. Root hydro keys return to a stable
  post-clear count.
- **M8 – expected cache footprint.** CDP reports 3 extra nodes after
  create/clear (94 ready → 97), but the document tree and element count are
  unchanged. They are detached nodes in the compiled `html()` template cache,
  created on first row render; this is bounded per template, not a growing leak.
- **M9 – bounded queue trade-off.** `pendingCleanupRows` flushes when it
  reaches 2,000 rows and otherwise awaits the scheduler. Foreground repeated
  create/clear drains it. A background tab may defer the task, retaining fewer
  than 2,000 detached rows until it runs; document this bounded behavior and
  keep the current safety valve.

### Reduce the per-row footprint (about 1.79 KB/row today → target ≤ 1.2 KB)

Order these by heap-snapshot evidence from B4:

- **M10 – implemented, modest measured win.** `observe`, `getObservers` and
  `unobserve` are supplied by the shared `get` handler; `in` and
  `Object.getOwnPropertyDescriptor` remain compatible, and enumerable keys /
  JSON are unchanged. Keep `isProxy` and mutable `asyncUpdate` as own
  properties for compatibility. This removes 3 per-object slots. The JFB
  10k heap delta moved from about 15.27 MB to 15.15 MB (~0.01 KB/row saved);
  `sharedHandlers` remains lazy. Tests cover method identity/access, `in`,
  `Object.keys` and JSON.
- **M11 – implemented.** `allNodeChanges` and key-to-node entries now store a
  single 5-tuple directly and upgrade to an array only when a node has multiple
  reactive changes. After M10, the JFB run-10k heap delta improved from about
  15.15 MB to 14.05 MB (~0.11 KB/row saved); the brotli bundle grew by about
  0.13 KB. Keep only if follow-up profiling confirms the memory/runtime trade-off.
- **M12 broad purge-skip hypothesis rejected as unsafe.** A view caller can
  retain `data[i]` after clearing the list; `bindMap`/`reactivityMap` then keep
  detached nodes alive unless cleanup explicitly untracks them. New B4 scenario
  `view cleanup with externally retained row proxies` keeps 100 row proxies
  alive across clear and verifies their Elements still collect. This disproves
  the assumption that row proxies always die with the discarded array. Keep
  purge semantics; only revisit with an ownership-aware index that can prove a
  whole subtree has no live proxy mappings.
- **M13 – tested, reverted.** Replacing bound cleanup callbacks with `{fn,
  args}` records showed no reliable post-GC heap improvement (10k JFB run was
  ~15.93 MB vs ~15.81 MB after reverting) and increased code. Keep the existing
  binding until a heap snapshot isolates a larger win.

Phase B exit criteria: L1/L2 and all actionable B5 scenarios pass; ternary
subscriptions are disposed according to the documented ownership contract;
post-clear root-key count is stable and create/clear shows no unbounded slope.

Phase D memory targets vs the v1.10.1 release probe: retained heap after 5×
create/clear ≤ ready + 0.2 MB; run-1k heap delta reduced ≥ 30%; target ≤
1.2 KB/row. Current M10/M11 readings are about 1.66 KB/row at 1k and 1.44
KB/row at 10k; the 5× clear plateau is still about +0.49 MB, so these targets
remain unmet.

---

## 3. Performance (profile-driven; each item is a hypothesis until `bench:jfb` shows the gain)

Measure first: `bench:jfb:profile` takes a CDP `Profiler` capture for the
first local sample of each operation and writes `.cpuprofile` files under
`dist/.jfb-benchmark/profiles`. It uses a separate unminified bundle only for
symbol-readable profiling; duration baselines still use the minified bundle.

Initial self-time signals (10k/clear rows, approximate; Chromium 1 ms profiler
sampling, so use these to rank work, not as exact attribution):

| operation | top hydro/native self-time | direction |
| --- | --- | --- |
| create many rows | `createElement` ~12–23 ms, `setAttribute` ~9–11, `appendChild` ~9–16, `h` ~6–17, `generateProxy` / `reactive` ~4–6 each, `ternary` ~4, GC ~18–21 | P1–P3 / M10 |
| replace all rows | `resetViewRows` ~5 ms, `cleanupDetachedNode` ~2 ms, plus row construction | P7 / optimize without skipping purge |
| partial update | `applyNodeChanges` ~1–2 ms for ~100 changes | P9 |
| clear rows | `resetViewRows` ~11 ms, `purgeReactivity` ~4 ms, `cleanupDetachedNode` ~4 ms | P6–P7 / preserve cleanup ownership |
| select / swap / remove | profile samples mostly browser event dispatch/rAF and native DOM work; individual hydro functions were below ~2 ms in the first sample | use repeated raw-input profiles before micro-optimizing |

### create / replace / create many / append (largest weight in jfb)

- **P1 Cheap `ternary()` / `reactive()` creation.** Each row does all of this:
  - `do{…}while(Reflect.has(hydro,key))` goes through the proxy trap
  - `Reflect.set(hydro, key, v)` runs the full set trap: `Reflect.get`
    receiver, promise/node/object checks, 2× `reactivityMap` lookups,
    handler lookup
  - a new `chainKeys` proxy
  - `observe()` → `resolveObject`
  - `getValue()`

  A fresh-key fast path now writes a new non-object/non-null signal directly
  to the hydro target when dependency tracking is inactive. The closure-cached
  ternary value remains to be profiled/implemented; preserve public setter
  behavior if the derived value is manually changed.
- **P2 `data(rows)` – audited, no change yet.** `set` currently has one
  `Object.keys(val)` enumeration; `generateProxy` does not enumerate. On append,
  that loop checks old already-proxied rows before reaching new rows. Avoiding
  those checks needs a proven append-prefix fast path that still handles sparse
  arrays, custom enumerable properties and arbitrary replacement arrays. Keep
  as a profiling target; do not call it a duplicate pass.
- **P3 Reactive slot wiring in `h()` under `view` – profiled, deferred.** The
  unminified 10k-row profile reports about 3.23 ms in `wireViewHProp` and
  3.26 ms in `resolveObject` (roughly 0.7% of the ~485 ms operation). A cache
  would add per-row state/invalidations for a sub-1% theoretical ceiling; no
  change until a new profile shows a materially larger share.
- **P4 – implemented.** Appended/replacement rows that need wiring are now
  scanned via `setReactivityNodes()` on only the new nodes (including children
  captured from fragments), not the full `tbody`. Regression test asserts an
  append does not scan the old root and that the new row's handler still fires.
- **P5 – implemented.** `randomText()` now uses a monotonic
  `hydro-event-N` id instead of six `Math.random()` calls per handler.

### clear / replace (4× throttled for clear)

- **P6 `selected(null)` fan-out in clear.** 1000 ternary observers each call
  `unset()`, which goes through the null path of the set trap and
  `deleteProperty` on `hydro`. Then the deferred flush runs `onCleanup(unset)`
  again, where `done` short-circuits. Implemented one semantics-neutral
  reduction (`reactivityMap.get()` instead of `has()` + `get()`). Focused
  10-sample clear checks pass, but paired ratios have ranged from 1.09× to
  1.21× against the 1.159× baseline; no runtime gain is attributable yet.
  Further fan-out or dictionary-mode changes need a profile-isolated benefit
  and tests; storing values outside `hydro` is especially behavior-sensitive.
- **P7** Keep purge semantics (M12's broad skip was disproved by the retained
  row-proxy guard), then test whether deferred cleanup `postTask(user-blocking)`
  lands before paint and is counted by jfb. A 10-sample `background` trial
  measured local clear medians of 17.60 ms for `background` and 18.16 ms for
  forced rIC; separate `user-blocking` runs were 17.56 and 18.27 ms. Their
  paired ratios ranged 1.09–1.21×, with substantial vanilla timing shifts, so
  neither alternative shows a stable local win. A synchronous cleanup trial
  under `setGlobalSchedule(false)` regressed clear to 20.26 ms median (1.43×
  vs the 1.159× baseline), so it was reverted. Keep `user-blocking`; retain
  scheduler changes only when local paired click-to-paint improves without
  weakening cleanup.

### select (4×)

- **P8 – closure cache deferred.** The select profile's largest named hydro
  frame is `get` at ~0.89 ms; a closure-cached value would become stale if a
  caller manually changes the returned ternary signal. An extra observer to
  preserve that behavior would add one subscription per row. The optional
  `selector(reactive)` API remains out of scope and needs a separate decision.

### update every 10th (4×) / swap (4×) / remove (2×)

- **P9 – profiled, deferred.** The raw-input update profile attributes about
  1.86 ms self-time to the app's `update` loop and finds no library helper above
  the sampling threshold. Avoid adding a proxy-path cache without a repeatable
  library hotspot.
- **P10 – profiled, no safe win identified.** The remove profile is dominated
  by native/app work; no library cleanup frame is a stable top sample. M12's
  retained-proxy guard rules out skipping ownership cleanup. Keep the existing
  path until an ownership-aware index is justified by repeated profiles.
- **P11 – reviewed, no change.** The four-mutation swap regression check
  passes and the latest JFB ratio is 1.13× vs vanilla. No additional DOM move
  was found; leave the O(n) `indexOf` at the 1k-row workload.

### General

- **P12 – profiled, defer.** The select profile records ~0.89 ms in `get`;
  returning own functions without `bindToTarget` risks breaking method
  receiver semantics. No type-specialized path was retained without a
  measurable end-to-end gain.

Targets (vs the v1.10.1 `bench:jfb` baseline, ratio to vanilla): create /
replace / runlots / append −20%, clear −30%, select −50%, others no
regression.

---

## 4. Code size and simplification (behavior-neutral)

Do the pure refactors (S1–S8) **before** the perf work, so perf changes land
on less code. Do the final trims (S9–S11) after.

- **S1 One "one-or-many" helper.** The single-value-or-array/Set upgrade is
  hand-written 6 times: `elemEventFunctions` handlers, `boundElemProxies`,
  lifecycle fns (`addLifecycle`/`pushLifecycleFunctions`/`executeLifecycle`),
  `nodeChangeEntry`, `trackedHandlers`, handler Sets. Replace them with
  tiny `add/remove/each` helpers.
- **S2** `unset` / `setAsyncUpdate` / `observe` / `unobserve` each branch on
  `oneKey`, but `resolveObject([key])` already returns `hydro` as the parent.
  Collapse them into one `parentOf(reactive)` helper, keeping
  `hydroToReactive.delete` in `unset`.
- **S3** The two-way binding logic is duplicated between
  `setReactivitySingle` and `applyNodeChanges`. Extract `readTwoWay` /
  `writeTwoWay(node, value)` helpers.
- **S4** The event-function registration in `html()` (direct variables and
  object entries), `setReactivity`, `applyCompiledParts` and
  `applyNodeChanges` → one `bindEvent(node, attrName, value, prev?)`.
- **S5** Repeated `isServerSideCached && x.includes(Placeholder.reactiveKey)`
  / `"{{"` checks → one `hasMarker(str)` / `startsWithMarker(str)`.
  `isServerSide()` → one regex.
- **S6** `Reflect.get(x, keysSymbol.description!) as PropertyKey[]` appears
  many times → `keysOf(x)`. Minifier-friendly local aliases for `window.*`
  constructors.
- **S7 – reviewed, no change.** `h()` already has one props loop and one
  children loop, each with a `viewElements` mode branch; there are no duplicate
  loops to merge without adding indirection.
- **S8 – implemented.** The `reuseElements` view path now copies the next
  row's enumerable own fields with `Object.assign` instead of hard-coding
  `id`/`label`; a regression test covers an extra field.
- **S9 – scheduling fallback implemented.** Removed the global
  `window.requestIdleCallback` polyfill and use internal `setTimeout` when
  `scheduler.postTask` is unavailable. This avoids mutating `window` and saves
  about 60 B brotli (`full` 9.11 → 9.05 KB); async render/unmount tests and the
  browser matrix pass. Keep the shared `Range` eager because every normal
  `html()` call immediately needs it; keep duplicate-instance registration at
  module load so duplicate copies are detected before APIs run.
- **S10 – reviewed, no change.** `compareEvents` compares `String(fnArray)`,
  which stringifies function sources on each diff. Identity comparison was
  tested and changes existing behavior: tests explicitly require distinct
  functions with identical source to compare equal (`same functions return
  true`, including lifecycle hooks). Keep the established source-equivalence
  semantics; do not change it without an API/behavior decision.
- **S11 – dead paths reviewed.** Removed unused `purgeTrackedEventListenersInSubtree`
  and the never-assigned `internReset` flag/branch. Kept environment-specific
  SSR, Chrome-only and scheduler-availability paths; their coverage exclusions
  are not evidence that the code is dead.

Targets: `full` brotli ≤ 8.0 KB (−10%) and `library.ts` ≤ 2500 LOC, with
all tests green in happy-dom, jsdom, chromium, firefox and webkit, and
coverage kept at 100%.

---

## 5. Order of work and guardrails

1. **Phase A – Measure:** B1–B5 (B6 once). Commit baselines: `bench:jfb`,
   memory metrics, size.
2. **Phase B – Correctness and leaks:** M1–M3 with regression tests, then
   M4–M9 investigations.
3. **Phase C – Neutral simplification:** S1–S8.
4. **Phase D – Memory footprint and perf:** M10–M13, then P1–P12, in order of
   profile evidence.
5. **Phase E – Final trims and release preparation:** S9–S11. Run B6 full JFB
   validation, update CHANGELOG and `VERSION` in `library.ts` (must match
   `package.json`), and prepare the JFB framework-folder bump. For this run,
   version 1.10.2 and a local upstream patch were prepared; npm publish and
   upstream push/PR were explicitly not requested.

Rules for every change:

- One hypothesis per commit, with before/after numbers in the log below.
  Revert if there's no measurable gain; don't keep speculative code.
- These must pass: `npm test` (happy-dom, jsdom, 3 browsers), `bench:mem`
  (0 survivors, growth slope ~0), `bench:size --baseline` (no growth unless a
  perf win justifies it), `bench:perf:browser:check` and `bench:jfb
  --baseline` (current paired-ratio tolerance 20%; aim to reduce it after
  repeated-run noise calibration).
- Keyed-ness check stays green (swap = 4 mutations, remove = 1).
- No public API changes. New optional APIs (P8 `selector`) need a separate
  decision.

---

## 6. Results log

| date | item | metric | before | after | kept? |
| ---- | ---- | ------ | ------ | ----- | ----- |
| 2026-09-23 | S1–S8 | full brotli / tests | 8.91 KB / 324 | 8.89 KB / 326 | yes |
| 2026-09-23 | M10 | JFB run-10k heap delta | ~15.27 MB | ~15.15 MB | yes; modest |
| 2026-09-23 | M11 | JFB run-10k heap delta | ~15.15 MB | ~14.05 MB | yes; provisional |
| 2026-09-23 | M10–M11 | full brotli / size gate | 8.91 KB | 9.18 KB / pass | trade-off to revisit |
| 2026-09-23 | M13 | JFB heap / full brotli | 15.81 MB / 9.18 KB | trial: 15.93 MB / 9.23 KB; reverted | no |
| 2026-09-23 | P4 | appended-row root scan | full tbody | new rows only | yes; regression test passes |
| 2026-09-23 | P5 | full brotli / event IDs | 9.18 KB / random | 9.12 KB / monotonic | yes |
| 2026-09-23 | M12 | retained row-proxy cleanup | broad skip unsafe | 100 proxies retained; 0 detached Elements survive | keep purge |
| 2026-09-23 | P6 | full brotli / clear ratio | 9.12 KB / 1.159× | 9.11 KB / 1.09–1.21× | smaller path; runtime gain unproven |
| 2026-09-23 | P7 | clear scheduler / sync | user-blocking 17.56–18.27 ms | background 17.60 / rIC 18.16 / sync 20.26 ms | keep async user-blocking; sync failed gate |
| 2026-09-23 | P2 | `Object.keys(val)` audit | suspected duplicate pass | exactly one pass; safe fast path unproven | defer |
| 2026-09-23 | S9 | full brotli / scheduler fallback | 9.11 KB / global rIC polyfill | 9.05 KB / internal timeout | yes; async tests pass |
| 2026-09-23 | S10 | function comparison | identity experiment | existing source-equivalence tests require current semantics | no change |
| 2026-09-23 | S11 | dead paths | unused subtree helper + inert flag | both removed; 327 tests pass | yes |
| 2026-09-23 | Phase D | JFB / memory targets | ≤1.2 KB/row, +0.2 MB plateau | 1.44 KB/row, +0.49 MB; JFB gate passes | gaps accepted/documented |
| 2026-09-23 | B6 | full upstream JFB + `isKeyed` | not run | `JFB_COUNT=1` successful | yes |
| 2026-09-23 | release prep | version / package | 1.10.1 | 1.10.2, changelog + tarball prepared | not published |
| 2026-09-23 | upstream JFB | framework dependency bump | 1.9.4 | local 1.10.2 patch prepared | not pushed per user choice |

[js-framework-benchmark]: https://github.com/krausest/js-framework-benchmark
