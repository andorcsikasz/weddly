// Consistent, encrypted, off-site SQLite disaster-recovery snapshots.
//
// Railway volumes belong to one service and cannot be mounted into a separate
// cron service. The web process is therefore the only process that can safely
// run SQLite's online snapshot operation. It writes each snapshot to a
// dedicated R2 bucket using a dedicated least-privilege credential, encrypts
// before upload, verifies SQLite integrity, and pings an external missed-run
// monitor. Railway's native volume backups remain the first recovery layer.

import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import { CONFIG, OFFSITE_BACKUP_ENABLED } from "../config";
import { db, now } from "../db";
import { log } from "../lib/logger";
import { captureException } from "../lib/observability";
import { decryptBackupBytes, encryptBackupBytes } from "../lib/backup_crypto";

function backupKeyForMs(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return `prod/weddly-${stamp}.db.aes256gcm`;
}

function backupClient(): InstanceType<typeof Bun.S3Client> {
  return new Bun.S3Client({
    accessKeyId: CONFIG.offsiteBackup.accessKeyId,
    secretAccessKey: CONFIG.offsiteBackup.secretAccessKey,
    bucket: CONFIG.offsiteBackup.bucket,
    endpoint: CONFIG.offsiteBackup.endpoint,
    region: "auto",
  });
}

export async function dumpDbSnapshot(tmpPath: string): Promise<void> {
  await rm(tmpPath, { force: true }).catch(() => {});
  db.exec(`VACUUM INTO '${tmpPath.replaceAll("'", "''")}'`);
}

export function assertSnapshotIntegrity(path: string): void {
  const snapshot = new Database(path, { readonly: true });
  try {
    const result = snapshot.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get();
    if (result?.integrity_check !== "ok") {
      throw new Error("SQLite snapshot integrity check failed");
    }
  } finally {
    snapshot.close();
  }
}

/** Encrypt bytes into a self-describing envelope. The key id is not secret and
 * permits staged key rotation; the key material itself never leaves config. */
export function encryptBackup(plaintext: Uint8Array, createdAtMs = now()): Uint8Array {
  return encryptBackupBytes(plaintext, CONFIG.offsiteBackup.encryptionKeys, createdAtMs);
}

/** Used by restore tooling and tests. Authentication and checksum validation
 * fail closed before the caller is given any plaintext. */
export function decryptBackup(encrypted: Uint8Array): Uint8Array {
  return decryptBackupBytes(encrypted, CONFIG.offsiteBackup.encryptionKeys);
}

export async function backupDbOffsite(nowMs: number = now()): Promise<string> {
  if (!OFFSITE_BACKUP_ENABLED) throw new Error("Off-site backup is not configured");
  const tmpPath = join(dirname(CONFIG.dbPath), `backup-tmp-${nowMs}.db`);
  try {
    await dumpDbSnapshot(tmpPath);
    assertSnapshotIntegrity(tmpPath);
    const plaintext = new Uint8Array(await Bun.file(tmpPath).arrayBuffer());
    const encrypted = encryptBackup(plaintext, nowMs);
    const key = backupKeyForMs(nowMs);
    await backupClient().write(key, encrypted, { type: "application/octet-stream" });
    log.info("backup.uploaded", { key, encrypted_bytes: encrypted.byteLength });
    await pruneOldBackups();
    return key;
  } finally {
    await rm(tmpPath, { force: true }).catch(() => {});
  }
}

async function pruneOldBackups(): Promise<void> {
  const keep = CONFIG.offsiteBackup.retention;
  if (!Number.isFinite(keep) || keep <= 0) return;
  const client = backupClient();
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.list({
      prefix: "prod/",
      continuationToken: cursor,
      maxKeys: 1000,
    });
    for (const object of page?.contents ?? []) {
      if (object.key.endsWith(".db.aes256gcm")) keys.push(object.key);
    }
    cursor = page?.isTruncated ? page.nextContinuationToken : undefined;
  } while (cursor);
  keys.sort();
  const stale = keys.slice(0, Math.max(0, keys.length - keep));
  for (const key of stale) await client.delete(key);
  if (stale.length) log.info("backup.pruned", { removed: stale.length, kept: keep });
}

async function heartbeat(suffix: "" | "/start" | "/fail"): Promise<void> {
  if (!CONFIG.offsiteBackup.healthcheckUrl) return;
  const url = `${CONFIG.offsiteBackup.healthcheckUrl.replace(/\/$/, "")}${suffix}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Backup heartbeat returned HTTP ${response.status}`);
}

async function runBackup(): Promise<void> {
  await heartbeat("/start");
  try {
    await backupDbOffsite();
    await heartbeat("");
  } catch (error) {
    captureException(error, { extra: { job: "offsite_backup" } });
    log.error("backup.failed", error);
    await heartbeat("/fail").catch((heartbeatError) =>
      log.error("backup.failure_heartbeat_failed", heartbeatError),
    );
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let initialTimer: ReturnType<typeof setTimeout> | null = null;

export function startBackupWorker(): void {
  if (timer || initialTimer || !OFFSITE_BACKUP_ENABLED) return;
  const hours = CONFIG.offsiteBackup.intervalHours;
  if (!Number.isFinite(hours) || hours <= 0) return;
  initialTimer = setTimeout(() => {
    initialTimer = null;
    void runBackup();
  }, 30_000);
  initialTimer.unref?.();
  timer = setInterval(() => void runBackup(), hours * 60 * 60 * 1000);
  timer.unref?.();
}

export function stopBackupWorker(): void {
  if (initialTimer) clearTimeout(initialTimer);
  if (timer) clearInterval(timer);
  initialTimer = null;
  timer = null;
}
