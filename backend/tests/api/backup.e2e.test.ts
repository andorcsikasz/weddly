import "../setup";

import { Database } from "bun:sqlite";
import { existsSync, rmSync } from "node:fs";
import { afterAll, describe, expect, test } from "bun:test";
import {
  assertSnapshotIntegrity,
  decryptBackup,
  dumpDbSnapshot,
  encryptBackup,
  startBackupWorker,
  stopBackupWorker,
} from "../../src/domain/backup";

// R2 is pinned off in setup.ts, so the upload path can't run here. We cover the
// risky, R2-independent parts: the VACUUM INTO snapshot produces a readable
// SQLite copy of the live schema, and the worker is a no-op when R2 is off.

const SNAP = "./data/test-backup-snapshot.db";

afterAll(() => {
  for (const ext of ["", "-shm", "-wal"])
    if (existsSync(SNAP + ext)) rmSync(SNAP + ext, { force: true });
});

describe("db backup", () => {
  test("dumpDbSnapshot writes a readable SQLite copy of the live DB", async () => {
    await dumpDbSnapshot(SNAP);
    expect(existsSync(SNAP)).toBe(true);
    expect(() => assertSnapshotIntegrity(SNAP)).not.toThrow();

    // Re-open the snapshot independently and confirm it carries the schema.
    const snap = new Database(SNAP, { readonly: true });
    const tables = snap
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    snap.close();
    expect(tables).toContain("couples");
    expect(tables).toContain("users");
  });

  test("encrypted backup envelope authenticates and round-trips", () => {
    const plaintext = new TextEncoder().encode("not a real database, but secret bytes");
    const encrypted = encryptBackup(plaintext, Date.UTC(2026, 7, 13));
    expect(new TextDecoder().decode(encrypted)).not.toContain("but secret bytes");
    expect(decryptBackup(encrypted)).toEqual(plaintext);

    const finalByte = encrypted.byteLength - 1;
    encrypted[finalByte] = (encrypted[finalByte] ?? 0) ^ 1;
    expect(() => decryptBackup(encrypted)).toThrow();
  });

  test("startBackupWorker is a no-op while R2 is disabled", () => {
    // Must not throw and must not schedule anything when R2 is unconfigured.
    expect(() => startBackupWorker()).not.toThrow();
    stopBackupWorker();
  });
});
