import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { build } from "esbuild";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureDir = join(rootDir, "bench", "jfb");
const siteDir = join(rootDir, "dist", ".jfb-benchmark", "site");
const hydroFixture = join(fixtureDir, "hydro");
const vanillaFixture = join(fixtureDir, "vanilla");
const args = process.argv.slice(2);
const publishedVersion = valueAfter("--published-version");

await rm(siteDir, { recursive: true, force: true });
await mkdir(join(siteDir, "local"), { recursive: true });
await mkdir(join(siteDir, "vanilla"), { recursive: true });
await cp(join(hydroFixture, "index.html"), join(siteDir, "local", "index.html"));
await cp(join(vanillaFixture, "index.html"), join(siteDir, "vanilla", "index.html"));
await cp(join(vanillaFixture, "src"), join(siteDir, "vanilla", "src"), {
  recursive: true,
});
await cp(join(fixtureDir, "css"), join(siteDir, "css"), { recursive: true });

const localLibrary = join(rootDir, "dist", "library.js");
await bundleHydro(localLibrary, join(siteDir, "local", "app.js"));
await buildDiagnosticBundle("local", localLibrary);
// The diagnostic profile fixture is unminified so CDP call frames keep source
// function names. It is used only for attribution, never for timing baselines.
const profileDir = join(siteDir, "profile-local");
await mkdir(profileDir, { recursive: true });
await cp(join(hydroFixture, "index.html"), join(profileDir, "index.html"));
await bundleHydro(localLibrary, join(profileDir, "app.js"), undefined, true);
console.log("Built js-framework-benchmark fixtures: local hydro-js + vanillajs");

if (publishedVersion) {
  if (!/^[a-zA-Z0-9._-]+$/.test(publishedVersion)) {
    throw new Error(`Invalid npm version or tag: ${publishedVersion}`);
  }

  const tempDir = await mkdtemp(join(tmpdir(), "hydro-jfb-published-"));
  try {
    execFileSync(
      "npm",
      [
        "pack",
        `hydro-js@${publishedVersion}`,
        "--pack-destination",
        tempDir,
        "--silent",
      ],
      { cwd: tempDir, stdio: "inherit" },
    );
    const tarball = (await readdir(tempDir)).find((name) => name.endsWith(".tgz"));
    if (!tarball) throw new Error("npm pack did not produce a package tarball");
    const unpackDir = join(tempDir, "unpacked");
    await mkdir(unpackDir);
    execFileSync("tar", ["-xzf", join(tempDir, tarball), "-C", unpackDir]);
    const publishedLibrary = join(unpackDir, "package", "dist", "library.js");
    await mkdir(join(siteDir, "published"), { recursive: true });
    await cp(
      join(hydroFixture, "index.html"),
      join(siteDir, "published", "index.html"),
    );
    await bundleHydro(
      publishedLibrary,
      join(siteDir, "published", "app.js"),
    );
    await buildDiagnosticBundle("published", publishedLibrary);
    console.log(`Built published hydro-js@${publishedVersion} fixture`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function bundleHydro(
  libraryPath,
  outfile,
  entryPoint = join(hydroFixture, "app.tsx"),
  unminified = false,
) {
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "esnext",
    jsxFactory: "h",
    minify: !unminified,
    legalComments: "none",
    alias: { "hydro-js": libraryPath },
    logLevel: "silent",
  });
}

async function buildDiagnosticBundle(implementation, libraryPath) {
  const entryPoint = join(dirname(siteDir), `${implementation}-diagnostic-entry.ts`);
  const diagnosticDir = join(siteDir, `diagnostic-${implementation}`);
  await mkdir(diagnosticDir, { recursive: true });
  await cp(join(hydroFixture, "index.html"), join(diagnosticDir, "index.html"));
  await writeFile(
    entryPoint,
    `import ${JSON.stringify(join(hydroFixture, "app.tsx"))};\n` +
      `import { hydro } from "hydro-js";\n` +
      `(window as typeof window & { __hydroKeyCount?: () => number }).__hydroKeyCount = () => Reflect.ownKeys(hydro).length;\n`,
  );
  await bundleHydro(libraryPath, join(diagnosticDir, "app.js"), entryPoint);
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}
