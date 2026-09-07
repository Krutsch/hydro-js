# Actual-app profiling follow-up: 2026-09-07

These are local Chromium diagnostics, not official js-framework-benchmark
results. No library optimization was attempted or retained in this follow-up.
The application fixture and both existing baselines were left unchanged.

## Capture changes

- CPU, allocation, and timeline modes discard the configured ordinary
  fresh-context warmups before capturing one new context.
- This matches the timing runner's procedure, not same-page JIT warming.
  Capture modes ignore the measured-repeat count and remain diagnostic only.
- CPU and allocation profiles have a simultaneously recorded timeline with
  handler-start, handler-end, and frame-end marks.
- Metadata records versions, sampling settings, source hashes, CPU model,
  Linux process affinity, output paths, and results. A bundle snapshot preserves
  the generated call-frame locations.
- Allocation sampling uses a 32 KiB interval and includes objects collected by
  both minor and major GC. It estimates JavaScript allocation, not retained heap
  or total native DOM memory.

See the [benchmark documentation](../README.md#browser-benchmarks) for commands.

## A/A stability

Environment: Chromium 151.0.7922.34, Node v26.7.0, Linux, reported CPU
Intel Core i9-14900K. Host topology did not reliably distinguish core classes.
No OS governor, priority, system-wide affinity, or other process was changed.

Each row below is an independent browser launch with 10 measured samples and
3 discarded fresh-context warmups. Runs were sequential, with no competing
benchmark or profiler started by this session. All samples were retained.

| Run | Default handler ms | Default frame ms | CPUs 2-9 handler ms | CPUs 2-9 frame ms |
| --- | -----------------: | ---------------: | ------------------: | ----------------: |
| 1   |             114.35 |           375.70 |              114.40 |            374.15 |
| 2   |             115.30 |           384.25 |              112.65 |            373.70 |
| 3   |             130.30 |           431.05 |              119.45 |            388.20 |
| 4   |             136.35 |           438.80 |              118.35 |            394.15 |
| 5   |             126.40 |           407.10 |              114.75 |            389.40 |
| 6   |             124.15 |           399.35 |              115.70 |            383.00 |

Pairs are runs 1/2, 3/4, and 5/6. Maximum paired handler differences were
6.05 ms (4.64%) with default affinity and 1.75 ms (1.55%) with process-local
`taskset --cpu-list 2-9`. Maximum paired frame differences were 8.55 and 6.40 ms,
respectively. Across all six medians, handler ranges were 22.00 and 6.80 ms.

Fixed affinity improved paired-median repeatability in this observation, but
did not remove variability: its last run contained a 204.7 ms handler sample
and an 80.67% reported spread. The two series were sequential, not randomized
affinity comparisons, so this is not proof that affinity alone caused the
improvement. Absolute timings across affinity settings are not a library gain.
Do not discard outliers or generalize this host's CPU list to other machines.
Future A/B runs still need contemporaneous A/A drift and balanced order.

## Marked CPU attribution

Three independent CPU captures used CPUs 2-9, each after three discarded
fresh-context warmups. Instrumented durations are not acceptance measurements.
Sample timestamps are reconstructed from the profile start and deltas; each
sample is weighted until the next sample, then clipped to the handler marks.
Sample intervals partition each marked handler interval without double counting.

| Capture | Marked handler ms | Reactive self ms | Handler share | Native DOM self ms |
| ------- | ----------------: | ---------------: | ------------: | -----------------: |
| 1       |           116.409 |           38.936 |        33.45% |             47.180 |
| 2       |           117.307 |           33.645 |        28.68% |             45.309 |
| 3       |           115.074 |           31.405 |        27.29% |             49.420 |

Reactive self includes wiring, trace registration, reactive/proxy construction,
chain access, resolution, and observation functions. It excludes `h()` self,
other Hydro helpers, fixture code, native calls, GC, and harness verification.
The hypothesis that this work accounts for at least 20% is supported again.
These are sampled estimates, not exact instruction-level costs.

Other Hydro self was 8.23-22.74 ms. Data-generation self had 0-2.14 ms of samples;
zero samples do not mean zero work. Handler GC had 8.25-13.58 ms of CPU samples
versus 11.88-14.67 ms in the simultaneous trace. Inclusive `h()` or `set()`
totals include their descendants and cannot be added to these self totals.

The simultaneous traces locate the post-handler work:

| Capture | Post-handler wall ms | Layout ms | Style update ms | PrePaint ms | Paint ms |
| ------- | -------------------: | --------: | --------------: | ----------: | -------: |
| 1       |              261.743 |   174.396 |          52.010 |      31.079 |    1.698 |
| 2       |              258.033 |   167.946 |          55.359 |      30.341 |    1.848 |
| 3       |              268.941 |   174.208 |          57.108 |      32.594 |    2.139 |

GC can overlap these categories; the analysis uses interval unions instead of
adding nested durations. Main-thread RunTask spans covered nearly all of the
post-handler window, but wall-time task spans cannot rule out OS descheduling.
Opaque CPU `(program)` samples are not evidence of idle time. The two-frame
elapsed measurement includes the handler and is not direct paint time.

## Allocation attribution

Three separate allocation captures used the same affinity and warmup procedure.
Only nodes beneath the driver's `perform()` stack contribute to handler totals;
setup, frames, and verification allocations outside that stack are excluded.
Allocation samples have ordinals, not timestamps: companion traces cannot
assign individual allocations to precise times or GC events.

| Capture | Handler tree estimate MB | Excluded tree estimate MB | Reactive self MB |
| ------- | -----------------------: | ------------------------: | ---------------: |
| 1       |                   31.381 |                     1.602 |           17.894 |
| 2       |                   31.184 |                     1.869 |           17.447 |
| 3       |                   32.210 |                     1.419 |           19.135 |

MB denotes decimal megabytes. Large self-allocation sites included `h()`
(3.11-3.18 MB), chain-proxy `get` (2.59-3.18 MB), `setTraces()` (2.56-3.44 MB),
`reactive()` (1.74-2.29 MB), and `generateProxy()` (2.00-2.36 MB).
Native/runtime allocation frames such as Map, Proxy, set, and iterator next
are reported separately from named Hydro self allocations.

Tree `selfSize` totals and sums of raw sample sizes differed by 24-41 KB
(approximately 0.07-0.12%). All sample node IDs resolve in the tree. The report
preserves both API estimates rather than assuming exact equality; tables use
tree self sizes consistently. Inclusive allocation totals overlap and must not
be added to self totals.

Hot allocations are not necessarily redundant. In particular, the earlier
fresh-map initialization experiment in `setTraces()` already failed its A/B
gate and should not be retried based on these totals. The next decision needs
object/line-level evidence of removable work and a preserved update/disposal
invariant, followed by a new balanced comparison. No new library candidate is
justified by this report alone.

## Artifacts and validation

Raw controls, profiles, trace sidecars, metadata, bundle snapshots, and the
reproducible analysis are currently in the temporary directory
`/tmp/hydro-profile-followup-aB1nCv`:

- `stability.json` and `affinity-stability.json` include every control run.
- `cpu-{1,2,3}.cpuprofile` and `allocation-{1,2,3}.heapprofile` have sidecars.
- `analyze.mjs` regenerates `attribution.json` and checks interval coverage and
  allocation node ownership.

Validation passed: build, all five focused profiling tests (all three modes,
argument errors, and the ordinary timing path), and the normal nine-operation
actual baseline check. The initial actual-app memory check reported one
surviving row and `passed: false`; it is not a passing validation. The memory
path and library were not changed by this follow-up. Two direct Node repetitions
reported zero survivors (exit 0), then one survivor (exit 1). All three outcomes
are retained: this memory validation is intermittent and unresolved, not green.
No cleanup code, memory threshold, or baseline was changed to conceal it.

## Rejected ternary resolver experiment

The next narrow candidate hoisted `ternary()`'s per-instance `checkCondition`
closure into a shared `resolveTernaryValue()` helper. The intended invariant was
to preserve condition predicates, function-valued branches, Promise-as-false
handling, identical-value suppression, keyed row identity, cleanup, and observer
disposal while removing one closure allocation per row.

The candidate was measured under fixed `taskset --cpu-list 2-9` affinity in three
balanced pairs, each with 10 measured samples and 3 discarded fresh-context
warmups:

| Order | Control handler | Candidate handler |             Change | Control frame | Candidate frame |
| ----- | --------------: | ----------------: | -----------------: | ------------: | --------------: |
| A/B   |       117.75 ms |         113.85 ms |  -3.31% / -3.90 ms |     394.05 ms |       378.60 ms |
| B/A   |       113.75 ms |         123.75 ms | +8.79% / +10.00 ms |     372.45 ms |       408.10 ms |
| A/B   |       115.30 ms |         113.85 ms |  -1.26% / -1.45 ms |     378.90 ms |       373.45 ms |

It failed the required 5% and 5 ms handler improvement in every pair and
introduced a 35.65 ms / 9.57% frame regression in pair 2. The candidate was
removed. DOM tests still passed 322/322 in happy-dom and JSDOM, and the complete
control validation passed afterward. The closure is not a justified
optimization under this workload.

## Rejected primitive ternary slot pool

The next experiment recycled only the hydro key strings for primitive-valued
ternaries. Reactive proxies and DOM trace entries were deliberately not reused;
the key returned to the pool only after `unset()` stopped the observer and nulled
the old slot. The intended benefit was lower repeated create/clear growth in the
hydro object's property shape and less key allocation. Fresh first-render
`create-many` could not benefit because its pool starts empty.

The candidate used the same three balanced pairs, fixed affinity, 10 measured
samples, and 3 discarded warmups:

| Order | Control handler | Candidate handler |            Change | Control frame | Candidate frame |
| ----- | --------------: | ----------------: | ----------------: | ------------: | --------------: |
| A/B   |       117.95 ms |         118.10 ms | -0.13% / -0.15 ms |     379.80 ms |       385.35 ms |
| B/A   |       118.05 ms |         114.70 ms | +2.84% / +3.35 ms |     383.85 ms |       383.05 ms |
| A/B   |       116.50 ms |         115.75 ms | +0.64% / +0.75 ms |     385.25 ms |       381.70 ms |

It failed the required 5% and 5 ms handler improvement. Repeated five-cycle
memory runs also moved in the wrong direction: controls retained zero rows and
had 1.326-1.350 MB heap deltas; candidate runs had 1.615-1.618 MB deltas and
one run retained five rows. The candidate was removed. DOM tests passed 322/322
after restoration, and `src/library.ts` is unchanged.

## Rejected lazy nested proxy experiment

This experiment removed eager one-level child proxying from the proxy `set`
trap and installed a child proxy only when an object value was read. The
invariant under test was that deep reactive writes, array iteration, keyed row
identity, bound elements, events, and cleanup would remain equivalent while
unused nested objects avoided proxy allocation.

The candidate passed the DOM suite, including 322/322 tests in happy-dom and
JSDOM, but failed the fixed-affinity balanced performance gate:

| Order | Control handler | Candidate handler |            Change | Control frame | Candidate frame |
| ----- | --------------: | ----------------: | ----------------: | ------------: | --------------: |
| A/B   |       115.95 ms |         120.95 ms | -4.31% / -5.00 ms |     382.90 ms |       384.40 ms |
| B/A   |       117.25 ms |         123.40 ms | -5.25% / -6.15 ms |     385.10 ms |       388.90 ms |
| A/B   |       115.90 ms |         122.55 ms | -5.74% / -6.65 ms |     384.10 ms |       384.50 ms |

Five-cycle memory runs were slightly lower for the candidate at 1.329 MB in
all three runs versus 1.330-1.352 MB for controls, but one control run had one
survivor and all candidate runs had zero. This small, noisy memory difference
does not compensate for the repeatable handler regression. The candidate was
removed and the eager proxy implementation restored.

## Remaining candidate experiments

The remaining candidates were tested sequentially from the committed baseline.
Rejected experiments were removed; no library optimization is retained.

### Compact single-change trace storage

`allNodeChanges` was changed to store one trace tuple directly and promote to an
array only when a second marker used the same node. This preserved the existing
multi-marker and cleanup paths in DOM tests, but did not clear the handler gate:

| Order | Control handler | Candidate handler |            Change | Control frame | Candidate frame |
| ----- | --------------: | ----------------: | ----------------: | ------------: | --------------: |
| A/B   |       117.80 ms |         117.85 ms | -0.04% / -0.05 ms |     393.70 ms |       382.70 ms |
| B/A   |       122.05 ms |         118.85 ms | +2.62% / +3.20 ms |     400.10 ms |       397.75 ms |
| A/B   |       118.50 ms |         120.05 ms | -1.31% / -1.55 ms |     389.70 ms |       393.75 ms |

Against the current staged control, the candidate actual-app bundle grew from
20,907 to 20,943 minified bytes and from 7,640 to 7,672 Brotli bytes. Candidate
five-cycle memory deltas were
1.332-1.333 MB with zero survivors, which is not enough evidence to offset the
missing speed gain and size regression.

### Immediate cleanup flushing

The pending cleanup threshold was changed from 2,000 rows to 1, forcing every
reset to clean synchronously. DOM tests passed, but the balanced timing was
unstable and regressed badly in pair 3:

| Order | Control handler | Candidate handler |              Change | Control frame | Candidate frame |
| ----- | --------------: | ----------------: | ------------------: | ------------: | --------------: |
| A/B   |       122.00 ms |         118.45 ms |   +2.91% / +3.55 ms |     394.85 ms |       389.85 ms |
| B/A   |       119.60 ms |         114.60 ms |   +4.18% / +5.00 ms |     392.40 ms |       381.05 ms |
| A/B   |       122.00 ms |         134.40 ms | -10.16% / -12.40 ms |     404.50 ms |       453.60 ms |

Five-cycle memory deltas were 1.330-1.351 MB for the candidate versus
1.330-1.330 MB for controls, all with zero survivors. The threshold was restored.

### `chainKeys()` concat path copying

Replacing `[...keys, subKey]` with `keys.concat(subKey)` passed DOM tests but
regressed handler timing by 7.85, 6.30, and 4.40 ms, with frame regressions in
all three pairs. It was removed.

### Direct `resolveObject()` property lookup

Replacing `Reflect.get(prev, prop)` with `prev[prop]` passed DOM tests but
regressed handlers by 24.40, 7.10, and 1.30 ms. Pair 1 also regressed frames by
54.05 ms / 13.69%. It was removed.

### Primitive-type predicate

Replacing the `primitiveTypes` Set with a string-comparison predicate passed DOM
tests but produced the same current actual-app size, 20,907 minified bytes and
7,640 Brotli bytes. It was removed without a size gain.
