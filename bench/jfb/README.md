# js-framework-benchmark fixtures

These fixtures are copied from `krausest/js-framework-benchmark` at commit
`f2df01a8679de05225c32714ca8cecbea3d78c5d` so the local benchmark exercises
the real keyed hydro-js app and a vanilla reference, with the same Bootstrap
CSS.

- `hydro/app.tsx` and `hydro/index.html`:
  `frameworks/keyed/hydro-js/src/`
- `vanilla/src/Main.js` and `vanilla/index.html`:
  `frameworks/keyed/vanillajs/`
- `css/`: `css/currentStyle.css`, `css/main.css`, and the Bootstrap 3.3.7
  stylesheet/font used by that entrypoint.
- `LICENSE`: the upstream Apache License 2.0 text. The hydro-js and vanillajs
  benchmark implementations are Apache-2.0 licensed in their upstream
  package metadata. Bootstrap's license header remains in its copied CSS.

The vanilla fixture is kept verbatim. The hydro-js fixture carries one local-only
improvement over upstream `f2df01a` (not proposed upstream yet): `remove()`
guards an unknown id (`findIndex` returning `-1`). A `selector()`-wired row
variant was measured and reverted: select moved only within harness noise
(0.97–1.14× vs ~1.01–1.07× baseline) while run heap regressed +0.46 MB at 1k
rows (+0.52 KB/row at 10k, root keys doubled) for the extra per-row derived
signal. `selector()` stays in the library as a tested opt-in API.
`scripts/build-jfb-bench.mjs` bundles the hydro-js TSX fixture against the
local `dist/library.js`; optionally pass `--published-version <version>` to
pack and bundle a released npm version as a third variant.

`upstream-hydro-js-1.10.2.patch` updates the upstream keyed framework's
`package.json` and lockfile for the 1.10.2 release. It targets upstream commit
`f2df01a8679de05225c32714ca8cecbea3d78c5d`; apply it after publishing that
exact package tarball so the lockfile integrity matches. This patch was kept
local only; no upstream branch or PR was opened. The vanilla implementation is served as its original script.
