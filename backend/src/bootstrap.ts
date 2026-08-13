// Container bootstrap for Railway volumes. Attached volumes are mounted as
// root even when the image declares a non-root user, so fix only /data and drop
// privileges before importing any application module. Local/dev launches keep
// using src/server.ts directly and never enter this file.

import { lchownSync, lstatSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const APP_UID = 1000;
const APP_GID = 1000;

function takeOwnership(path: string, uid: number, gid: number): void {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    // lchown never follows a symlink out of the fixed /data boundary.
    lchownSync(child, uid, gid);
    if (entry.isDirectory()) takeOwnership(child, uid, gid);
  }
  lchownSync(path, uid, gid);
}

if (typeof process.getuid === "function" && process.getuid() === 0) {
  mkdirSync("/data", { recursive: true });
  const uid = Number.parseInt(process.env.APP_RUNTIME_UID ?? String(APP_UID), 10);
  const gid = Number.parseInt(process.env.APP_RUNTIME_GID ?? String(APP_GID), 10);
  if (!Number.isInteger(uid) || uid <= 0 || !Number.isInteger(gid) || gid <= 0) {
    throw new Error("APP_RUNTIME_UID and APP_RUNTIME_GID must be positive integers");
  }
  const marker = "/data/.weddly-runtime-owner-v1";
  let markerStat: ReturnType<typeof lstatSync> | undefined;
  try {
    markerStat = lstatSync(marker);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // Never follow a marker symlink while privileged. The application user can
  // write under /data, so a stale or malicious non-file marker must be replaced
  // before writeFileSync runs as root.
  if (markerStat && !markerStat.isFile()) {
    unlinkSync(marker);
    markerStat = undefined;
  }
  const alreadyMigrated = markerStat?.uid === uid && markerStat.gid === gid;
  if (!alreadyMigrated) {
    takeOwnership("/data", uid, gid);
    writeFileSync(marker, `${uid}:${gid}\n`, { mode: 0o600 });
    lchownSync(marker, uid, gid);
  } else {
    lchownSync("/data", uid, gid);
  }
  process.setgid?.(gid);
  process.setuid?.(uid);
}

await import("./server");
