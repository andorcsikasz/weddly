#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { decryptBackupBytes } from "../src/lib/backup_crypto";

const [sourceArg, targetArg] = process.argv.slice(2);
if (!sourceArg || !targetArg) {
  console.error("Usage: bun run scripts/decrypt-backup.ts <encrypted-source> <new-target.db>");
  process.exit(1);
}
if (!process.env.OFFSITE_BACKUP_ENCRYPTION_KEYS) {
  console.error("OFFSITE_BACKUP_ENCRYPTION_KEYS is required");
  process.exit(1);
}

const source = resolve(sourceArg);
const target = resolve(targetArg);
if (!existsSync(source)) throw new Error(`Source not found: ${source}`);
if (existsSync(target)) throw new Error(`Refusing to overwrite existing target: ${target}`);

const plaintext = decryptBackupBytes(
  new Uint8Array(await Bun.file(source).arrayBuffer()),
  process.env.OFFSITE_BACKUP_ENCRYPTION_KEYS,
);
await writeFile(target, plaintext, { mode: 0o600, flag: "wx" });

const restored = new Database(target, { readonly: true });
try {
  const integrity = restored.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get();
  if (integrity?.integrity_check !== "ok")
    throw new Error("Restored database failed integrity_check");
} finally {
  restored.close();
}
console.log(`Restored and verified: ${target}`);
