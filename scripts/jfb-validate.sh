#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JFB_URL="${JFB_URL:-https://github.com/krausest/js-framework-benchmark.git}"
JFB_REF="${JFB_REF:-master}"
JFB_COUNT="${JFB_COUNT:-1}"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hydro-jfb-validate.XXXXXX")"
JFB_DIR="${TMP_DIR}/js-framework-benchmark"
SERVER_PID=""
SERVER_GROUP_PID=""
cleanup() {
  if [[ -n "$SERVER_GROUP_PID" ]]; then
    kill -- "-$SERVER_GROUP_PID" 2>/dev/null || true
  elif [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ -n "$SERVER_PID" ]]; then
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

if ! [[ "$JFB_COUNT" =~ ^[1-9][0-9]*$ ]]; then
  echo "JFB_COUNT must be a positive integer" >&2
  exit 2
fi

cd "$ROOT_DIR"
npm run build
TARBALL_NAME="$(npm pack --pack-destination "$TMP_DIR" --silent)"
TARBALL="${TMP_DIR}/${TARBALL_NAME}"

git clone --depth 1 --branch "$JFB_REF" "$JFB_URL" "$JFB_DIR"
(
  cd "$JFB_DIR"
  npm install --no-audit --no-fund --legacy-peer-deps
  npm run install-webdriver-ts
)

FRAMEWORK_DIR="${JFB_DIR}/frameworks/keyed/hydro-js"
(
  cd "$FRAMEWORK_DIR"
  npm install --no-save --package-lock=false --no-audit --no-fund "$TARBALL"
  HYDRO_VERSION="$(node -p 'require("./node_modules/hydro-js/package.json").version')"
  node - "$FRAMEWORK_DIR/package.json" "$FRAMEWORK_DIR/package-lock.json" "$HYDRO_VERSION" <<'NODE'
const fs = require("node:fs");
const [packagePath, lockPath, version] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
pkg.version = version;
pkg.dependencies["hydro-js"] = `^${version}`;
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
lock.version = version;
lock.packages[""].version = version;
lock.packages[""].dependencies["hydro-js"] = `^${version}`;
lock.packages["node_modules/hydro-js"].version = version;
fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
NODE
  npm run build-prod
)

JFB_CHROME_BINARY="${JFB_CHROME_BINARY:-}"
if [[ -z "$JFB_CHROME_BINARY" ]]; then
  for candidate in chromium chromium-browser google-chrome google-chrome-stable; do
    if command -v "$candidate" >/dev/null 2>&1; then
      JFB_CHROME_BINARY="$(command -v "$candidate")"
      break
    fi
  done
fi
if [[ -z "$JFB_CHROME_BINARY" ]]; then
  JFB_CHROME_BINARY="$(node -e 'try { process.stdout.write(require("playwright").chromium.executablePath()); } catch {}')"
  if [[ ! -x "$JFB_CHROME_BINARY" ]]; then JFB_CHROME_BINARY=""; fi
fi

cd "$JFB_DIR"
if curl --fail --silent http://localhost:8080/ >/dev/null; then
  echo "localhost:8080 is already serving another process; stop it before validation" >&2
  exit 1
fi
if command -v setsid >/dev/null 2>&1; then
  setsid npm start >"$TMP_DIR/jfb-server.log" 2>&1 &
  SERVER_PID=$!
  SERVER_GROUP_PID="$SERVER_PID"
else
  npm start >"$TMP_DIR/jfb-server.log" 2>&1 &
  SERVER_PID=$!
fi
server_ready=0
for _ in {1..30}; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then break; fi
  if curl --fail --silent http://localhost:8080/ >/dev/null; then
    server_ready=1
    break
  fi
  sleep 1
done
if [[ "$server_ready" != 1 ]]; then
  cat "$TMP_DIR/jfb-server.log" >&2
  echo "js-framework-benchmark server did not start on localhost:8080" >&2
  exit 1
fi

BENCH_ARGS=(--framework keyed/hydro-js keyed/vanillajs --count "$JFB_COUNT" --headless)
KEYED_ARGS=(keyed/hydro-js)
if [[ -n "$JFB_CHROME_BINARY" ]]; then
  BENCH_ARGS+=(--chromeBinary "$JFB_CHROME_BINARY")
  KEYED_ARGS+=(--chromeBinary "$JFB_CHROME_BINARY")
fi
npm run bench -- "${BENCH_ARGS[@]}"
npm --prefix webdriver-ts run isKeyed -- "${KEYED_ARGS[@]}"
