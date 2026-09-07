import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
const execute = promisify(execFile);
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const runner = join(rootDir, "dist/benchmark.actual.browser.node.js");
async function run(args, warmups = "3", repeats = "10") {
    return execute(process.execPath, [runner, ...args], {
        cwd: rootDir,
        env: {
            ...process.env,
            ACTUAL_BENCHMARK_WARMUPS: warmups,
            ACTUAL_BENCHMARK_REPEATS: repeats,
        },
        timeout: 120_000,
    });
}
for (const mode of ["cpu", "allocation", "timeline"]) {
    test(`${mode} captures one marked context after fresh-context warmups`, async () => {
        const directory = await mkdtemp(join(tmpdir(), "hydro-profile-test-"));
        try {
            const output = join(directory, "nested", "capture.json");
            const { stdout } = await run([
                "--profile",
                mode,
                "--profile-output",
                output,
                "create",
            ]);
            const report = JSON.parse(stdout);
            assert.equal(report.config.samples, 1);
            assert.equal(report.config.warmups, 3);
            assert.equal(report.config.context, "fresh");
            assert.equal(report.config.profileMode, mode);
            assert.equal(report.result.passed, true);
            assert.equal(report.result.rowCount, 1000);
            assert.ok(report.metadata.availableParallelism > 0);
            if (process.platform === "linux") {
                const status = await readFile("/proc/self/status", "utf8");
                assert.equal(report.metadata.cpuAffinity, status.match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1]);
            }
            assert.equal(report.profileOutput, output);
            assert.ok(report.result.frameElapsedMs >= report.result.elapsedMs);
            assert.deepEqual(JSON.parse(await readFile(report.metadataOutput, "utf8")), report);
            const bundle = await readFile(report.bundleOutput);
            assert.equal(createHash("sha256").update(bundle).digest("hex"), report.metadata.bundleSha256);
            for (const [path, hash] of Object.entries(report.metadata.sourceHashes)) {
                assert.equal(createHash("sha256")
                    .update(await readFile(join(rootDir, path)))
                    .digest("hex"), hash);
            }
            const { traceEvents } = JSON.parse(await readFile(report.traceOutput, "utf8"));
            const marks = ["handler-start", "handler-end", "frame-end"].map((name) => {
                const matches = traceEvents.filter((event) => event.name === `hydro-actual-${name}`);
                assert.equal(matches.length, 1);
                return matches[0];
            });
            assert.ok(marks[0].ts < marks[1].ts && marks[1].ts < marks[2].ts);
            for (const mark of marks) {
                assert.equal(mark.pid, marks[0].pid);
                assert.equal(mark.tid, marks[0].tid);
            }
            assert.ok(Math.abs((marks[1].ts - marks[0].ts) / 1000 - report.result.elapsedMs) <
                5);
            assert.ok(Math.abs((marks[2].ts - marks[0].ts) / 1000 - report.result.frameElapsedMs) < 5);
            const profile = JSON.parse(await readFile(output, "utf8"));
            if (mode === "cpu") {
                assert.equal(report.config.cpuSamplingIntervalUs, 1000);
                assert.ok(profile.samples.length > 0);
                assert.equal(profile.samples.length, profile.timeDeltas.length);
                assert.ok(profile.startTime < marks[0].ts);
                assert.ok(profile.endTime > marks[2].ts);
            }
            else if (mode === "allocation") {
                assert.equal(report.config.allocationSamplingIntervalBytes, 32768);
                assert.equal(report.config.includeCollectedObjects, true);
                assert.ok(profile.head.children.length > 0);
                assert.ok(profile.samples.length > 0);
            }
            else {
                assert.equal(report.traceOutput, output);
                assert.ok(profile.traceEvents.length > 0);
            }
        }
        finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
}
test("profiling rejects invalid arguments before capture", async () => {
    const cases = [
        [["create", "--profile", "unknown"], /Unknown profile mode/],
        [
            ["create", "--profile", "allocation"],
            /--profile requires --profile-output/,
        ],
        [
            ["create", "--profile-output", "unused.json"],
            /--profile-output requires --profile/,
        ],
        [
            ["--profile", "cpu", "--profile-output", "unused.json"],
            /--profile requires one operation/,
        ],
        [
            [
                "create",
                "--profile",
                "cpu",
                "--profile-output",
                "unused.json",
                "--memory",
            ],
            /cannot be combined/,
        ],
        [
            [
                "create",
                "--profile",
                "allocation",
                "--profile-output",
                "unused.json",
                "--baseline",
                "unused.json",
            ],
            /cannot be combined/,
        ],
        [
            [
                "create",
                "--profile",
                "timeline",
                "--profile-output",
                "unused.json",
                "--write-baseline",
                "unused.json",
            ],
            /cannot be combined/,
        ],
        [["create", "--profile-output"], /requires a value/],
    ];
    for (const [args, message] of cases)
        await assert.rejects(run(args), message);
    await assert.rejects(run(["create", "--profile", "cpu", "--profile-output", "unused.json"], "-1"), /ACTUAL_BENCHMARK_WARMUPS/);
});
test("ordinary measurements retain repeats without profile metadata", async () => {
    const { stdout } = await run(["create"], "0", "2");
    const report = JSON.parse(stdout);
    assert.deepEqual(report.config, { repeats: 2, warmups: 0 });
    assert.equal(report.results[0].samples.length, 2);
    assert.equal(report.results[0].frameSamples.length, 2);
    assert.equal(report.results[0].passed, true);
    assert.equal(report.profileOutput, undefined);
    assert.deepEqual(report.failures, []);
});
