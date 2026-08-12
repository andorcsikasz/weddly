#!/usr/bin/env bun

// Fleet-safe backend test launcher. Every invocation gets its own SQLite DB,
// uploads directory and HTTP port, so two agents (or a local run beside CI)
// cannot delete each other's database or bind the same fixed port.

import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const runDir = mkdtempSync(join(tmpdir(), "weddly-test-"));
const randomPort = 18_000 + (randomBytes(2).readUInt16BE(0) % 20_000);

try {
  const result = spawnSync(
    process.execPath,
    ["test", "--timeout", "30000", ...process.argv.slice(2)],
    {
      cwd: join(import.meta.dir, ".."),
      stdio: "inherit",
      env: {
        ...process.env,
        BUN_TEST_PORT: process.env.BUN_TEST_PORT ?? String(randomPort),
        BUN_TEST_DB_PATH: process.env.BUN_TEST_DB_PATH ?? join(runDir, "test-weddly.db"),
        BUN_TEST_UPLOADS_DIR: process.env.BUN_TEST_UPLOADS_DIR ?? join(runDir, "test-uploads"),
      },
    },
  );
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(runDir, { recursive: true, force: true });
}
