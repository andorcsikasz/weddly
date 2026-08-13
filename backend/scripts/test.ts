#!/usr/bin/env bun

// Fleet-safe backend test launcher. Every invocation gets its own SQLite DB,
// uploads directory and HTTP port, so two agents (or a local run beside CI)
// cannot delete each other's database or bind the same fixed port.

import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const backendDir = join(import.meta.dir, "..");
const perfTest = "tests/api/perf_budget.e2e.test.ts";
const resourceHeavyTests = new Set([
  "tests/printed_cards_visual.test.ts",
  "tests/api/seating_schedule.e2e.test.ts",
]);
const allocatedPorts = new Set<number>();

function allocateTestPort(): number {
  // Parallel files must never receive the same port from this launcher. Keep
  // allocations for the entire run rather than returning a port to the pool:
  // a stopped Bun server can still be winding down when the next file starts.
  while (true) {
    const port = 18_000 + (randomBytes(2).readUInt16BE(0) % 20_000);
    if (!allocatedPorts.has(port)) {
      allocatedPorts.add(port);
      return port;
    }
  }
}

function testFiles(dir: string, prefix = "tests"): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...testFiles(join(dir, entry.name), relative));
    else if (entry.name.endsWith(".test.ts")) files.push(relative);
  }
  return files;
}

async function run(args: string[], honorOverrides: boolean): Promise<number> {
  const runDir = mkdtempSync(join(tmpdir(), "weddly-test-"));
  const randomPort = allocateTestPort();
  const isolatedEnv = {
    ...process.env,
    BUN_TEST_PORT: (honorOverrides ? process.env.BUN_TEST_PORT : undefined) ?? String(randomPort),
    BUN_TEST_DB_PATH:
      (honorOverrides ? process.env.BUN_TEST_DB_PATH : undefined) ?? join(runDir, "test-weddly.db"),
    BUN_TEST_UPLOADS_DIR:
      (honorOverrides ? process.env.BUN_TEST_UPLOADS_DIR : undefined) ??
      join(runDir, "test-uploads"),
  };
  try {
    const child = Bun.spawn([process.execPath, "test", "--timeout", "60000", ...args], {
      cwd: backendDir,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: isolatedEnv,
    });
    return await child.exited;
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
}

const requested = process.argv.slice(2);
if (requested.length > 0) {
  process.exitCode = await run(requested, true);
} else {
  // Backend suites share a process-wide server, database handle, timers and
  // Argon2 worker pool. Running hundreds of files in one Bun process lets old
  // async work and allocator pressure leak into later tests; in particular,
  // login-throttle tests can time out even though the same requests complete
  // promptly in a fresh process. Give each file its own port, DB and process.
  const functional = testFiles(join(backendDir, "tests"))
    .filter((file) => file !== perfTest && !resourceHeavyTests.has(file))
    .sort();
  const requestedWorkers = Number(process.env.BACKEND_TEST_WORKERS ?? "2");
  const workerCount = Number.isFinite(requestedWorkers)
    ? Math.max(1, Math.min(4, Math.floor(requestedWorkers)))
    : 2;
  let nextIndex = 0;
  const failures: string[] = [];

  async function worker() {
    while (nextIndex < functional.length) {
      const file = functional[nextIndex++];
      if (!file) return;
      console.log(`\n[backend-test] ${file}`);
      if ((await run([file], false)) !== 0) failures.push(file);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(workerCount, functional.length) }, () => worker()),
  );

  if (failures.length === 0) {
    // PDF rasterization and the large seating schedule allocate substantial CPU
    // and memory. Run them sequentially so their own correctness timeouts are
    // not distorted by another suite's Argon2/PDF workload.
    for (const file of resourceHeavyTests) {
      console.log(`\n[backend-test] ${file} (isolated resource-heavy suite)`);
      if ((await run([file], false)) !== 0) failures.push(file);
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} isolated backend test file(s) failed:`);
    for (const file of failures) console.error(`- ${file}`);
    process.exitCode = 1;
  } else {
    // Latency budgets run alone so concurrent functional tests cannot distort
    // their measurements.
    console.log(`\n[backend-test] ${perfTest} (isolated performance budget)`);
    process.exitCode = await run([perfTest], false);
  }
}
