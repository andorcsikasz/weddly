// Scheduled SQLite → R2 disaster-recovery backups. The live DB stays on the
// /data volume; this job periodically snapshots it (SQLite `VACUUM INTO`, which
// produces a consistent copy even under WAL + concurrent writes) and uploads
// the snapshot to Cloudflare R2 under `backups/`. Old snapshots beyond the
// retention count are pruned. Entirely gated on R2 being configured — when R2
// is off the worker never starts, so dev/local runs are unaffected.

import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CONFIG, R2_ENABLED } from "../config";
import { db, now } from "../db";
import { log } from "../lib/logger";

/** `backups/weddly-YYYYMMDD-HHmmss.db` — timestamp keeps keys lexicographically
 *  sortable so prune-oldest is a simple sort. */
function backupKeyForMs(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  return `backups/weddly-${stamp}.db`;
}

/** R2 client for the backup bucket (falls back to the uploads bucket with a
 *  `backups/` prefix when R2_BACKUP_BUCKET is unset). Built lazily so importing
 *  this module never touches the network. */
function backupClient(): InstanceType<typeof Bun.S3Client> {
  return new Bun.S3Client({
    accessKeyId: CONFIG.r2.accessKeyId,
    secretAccessKey: CONFIG.r2.secretAccessKey,
    bucket: CONFIG.r2.backupBucket || CONFIG.r2.bucket,
    endpoint: CONFIG.r2.endpoint,
    region: "auto",
  });
}

/** Write a consistent snapshot of the live DB to `tmpPath` (must be absent).
 *  Uses SQLite `VACUUM INTO`, safe under WAL + concurrent writes. The path is
 *  always server-derived (no user input), so the string-literal interpolation
 *  can't be injected. Exported for direct testing without a live R2. */
export async function dumpDbSnapshot(tmpPath: string): Promise<void> {
  await rm(tmpPath, { force: true }).catch(() => {});
  db.exec(`VACUUM INTO '${tmpPath}'`);
}

/** Snapshot the DB and upload it to R2. Returns the object key on success.
 *  Throws on failure (caller logs); never mutates the live DB. */
export async function backupDbToR2(nowMs: number = now()): Promise<string> {
  const tmpPath = join(dirname(CONFIG.dbPath), `backup-tmp-${nowMs}.db`);
  try {
    await dumpDbSnapshot(tmpPath);
    const bytes = await Bun.file(tmpPath).arrayBuffer();
    const key = backupKeyForMs(nowMs);
    await backupClient().write(key, bytes, { type: "application/octet-stream" });
    log.info("backup.uploaded", { key, bytes: bytes.byteLength });
    await pruneOldBackups();
    return key;
  } finally {
    await rm(tmpPath, { force: true }).catch(() => {});
  }
}

/** Keep only the newest `R2_BACKUP_RETENTION` snapshots; delete the rest. */
async function pruneOldBackups(): Promise<void> {
  const keep = CONFIG.r2.backupRetention;
  if (!Number.isFinite(keep) || keep <= 0) return;
  const client = backupClient();
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.list({
      prefix: "backups/",
      continuationToken: cursor,
      maxKeys: 1000,
    });
    for (const o of page?.contents ?? []) keys.push(o.key);
    cursor = page?.isTruncated ? page.nextContinuationToken : undefined;
  } while (cursor);
  // Lexicographic sort == chronological (timestamped keys). Drop all but the
  // newest `keep`.
  keys.sort();
  const stale = keys.slice(0, Math.max(0, keys.length - keep));
  for (const k of stale) await client.delete(k).catch(() => {});
  if (stale.length) log.info("backup.pruned", { removed: stale.length, kept: keep });
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the periodic backup loop. No-op when R2 is unconfigured or the
 *  interval is 0. Idempotent. Runs once shortly after boot, then every
 *  R2_BACKUP_INTERVAL_HOURS. */
export function startBackupWorker(): void {
  if (timer) return;
  const hours = CONFIG.r2.backupIntervalHours;
  if (!R2_ENABLED || !Number.isFinite(hours) || hours <= 0) return;

  const run = () => {
    void backupDbToR2().catch((e) => log.error("backup.failed", e));
  };
  // Delay the boot backup a little so it doesn't compete with startup work.
  setTimeout(run, 1000 * 30).unref?.();
  timer = setInterval(run, hours * 60 * 60 * 1000);
  timer.unref?.();
}

export function stopBackupWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
