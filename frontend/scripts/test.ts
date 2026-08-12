#!/usr/bin/env bun

// Run every frontend test file in its own Bun process. A number of the legacy
// component suites install module-level fetch/browser mocks; process isolation
// prevents those globals from leaking into the next file while still allowing
// a small worker pool to keep the full suite fast.

import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const frontendDir = resolve(import.meta.dir, "..");
const supplied = process.argv.slice(2);
const suppliedFiles = supplied.filter((arg) => /(?:\.test|\.spec)\.[cm]?[jt]sx?$/.test(arg));
const flags = supplied.filter((arg) => !suppliedFiles.includes(arg));

function findTests(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findTests(path));
    else if (/(?:\.test|\.spec)\.[cm]?[jt]sx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

const files = (
  suppliedFiles.length > 0
    ? suppliedFiles.map((file) => resolve(frontendDir, file))
    : findTests(join(frontendDir, "tests"))
).sort();

const requestedWorkers = Number(process.env.FRONTEND_TEST_WORKERS ?? "4");
const workerCount = Number.isFinite(requestedWorkers)
  ? Math.max(1, Math.min(8, Math.floor(requestedWorkers)))
  : 4;
let nextIndex = 0;
const failures: string[] = [];

async function worker() {
  while (nextIndex < files.length) {
    const file = files[nextIndex++];
    if (!file) return;
    const display = relative(frontendDir, file);
    const child = Bun.spawn([process.execPath, "test", file, ...flags], {
      cwd: frontendDir,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: process.env,
    });
    const exitCode = await child.exited;
    if (exitCode !== 0) failures.push(display);
  }
}

await Promise.all(Array.from({ length: Math.min(workerCount, files.length) }, () => worker()));

if (failures.length > 0) {
  console.error(`\n${failures.length} isolated frontend test file(s) failed:`);
  for (const file of failures) console.error(`- ${file}`);
  process.exit(1);
}

console.log(`\nAll ${files.length} isolated frontend test files passed.`);
