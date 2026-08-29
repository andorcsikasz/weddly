// Object storage abstraction. App code addresses files by a stable *key* — the
// same relative path we already bake into public `/uploads/<key>` URLs (e.g.
// `couples/3/photos/5/5.jpg`). Two interchangeable backends share that key
// space so the DB-stored URLs never change when we flip drivers:
//
//   - DiskStorage: the historical behaviour, rooted at CONFIG.uploadsDir.
//   - R2Storage:   Cloudflare R2 (S3-compatible) via Bun's built-in S3 client.
//
// Driver selection mirrors the Stripe "configured?" pattern: when the R2 env is
// fully set we use R2, otherwise we fall back to local disk with ZERO behaviour
// change. `lib/` stays app-agnostic — nothing here imports from `domain/`.

import { existsSync } from "node:fs";
import { rm, statfs } from "node:fs/promises";
import { resolve } from "node:path";
import { CONFIG, R2_ENABLED } from "../config";
import { log } from "./logger";

/** Map a file extension to a content type for objects we store. Uploads are
 *  validated to this set upstream (image sniffing + PDF for budget docs). */
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
};

function contentTypeForKey(key: string): string {
  const ext = key.split("?")[0]?.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";
}

/** 30-day cache. Upload URLs carry a `?v=<timestamp>` cache-bust suffix that
 *  changes on every re-upload, so a long max-age is safe. */
const SERVE_CACHE_CONTROL = "public, max-age=2592000";

/** Bytes we accept for a write. `Bun.file(...)` (an on-disk handle, used by the
 *  photos temp→final copy) is also accepted by both backends' `write`. */
export type Writable = Uint8Array | ArrayBuffer | Blob;

export interface Storage {
  /** Driver name for logs / health output. */
  readonly driver: "disk" | "r2";
  /** Persist `data` at `key`, creating parents as needed. */
  write(key: string, data: Writable, contentType?: string): Promise<void>;
  /** True if an object exists at `key`. */
  exists(key: string): Promise<boolean>;
  /** Build an HTTP Response that serves `key`, or null when it doesn't exist.
   *  Used by the single `/uploads/*` handler in server.ts. */
  serve(key: string): Promise<Response | null>;
  /** Delete a single object. No-op when absent. */
  delete(key: string): Promise<void>;
  /** Delete every object under `prefix` (used by couple purge). */
  deletePrefix(prefix: string): Promise<void>;
}

// ─── Disk backend ─────────────────────────────────────────────────────────────

// Once the local volume crosses this, refuse new local writes rather than let
// the OS return ENOSPC mid-write. A full disk doesn't just fail the upload —
// it fails every SQLite write app-wide (sessions, signups, rate limiting,
// the email dispatch dedupe), which is what turned one oversized curated-
// directory photo batch into a ~40h production outage on 2026-08-27.
// `/api/health/deep` already alerts external monitors at 90% (`near_full`),
// so a human has a five-point window to react before this backstop fires;
// this is what catches it when nobody did, or nobody was watching.
const DISK_WRITE_BLOCK_PCT = 95;
// statfs is cheap, but a bulk import can write hundreds of files a second —
// re-checking on every single one buys nothing once we're nowhere near the
// edge. Short TTL so a genuinely fast-filling disk is still caught quickly.
const HEADROOM_CACHE_MS = 2_000;
let headroomCache: { checkedAt: number; blocked: boolean } | null = null;

async function assertDiskHeadroom(root: string): Promise<void> {
  const cached = headroomCache;
  if (cached && Date.now() - cached.checkedAt < HEADROOM_CACHE_MS) {
    if (cached.blocked) throw new Error("storage: local disk is near full, refusing write");
    return;
  }
  const s = await statfs(root).catch(() => null);
  if (!s) return; // statfs failing isn't what should block a write here.
  const totalBytes = s.bsize * s.blocks;
  const freeBytes = s.bsize * s.bavail;
  const percentUsed = totalBytes > 0 ? ((totalBytes - freeBytes) / totalBytes) * 100 : 0;
  const blocked = percentUsed >= DISK_WRITE_BLOCK_PCT;
  headroomCache = { checkedAt: Date.now(), blocked };
  if (blocked) {
    log.error("storage.disk_near_full", { percent_used: Math.round(percentUsed) });
    throw new Error("storage: local disk is near full, refusing write");
  }
}

class DiskStorage implements Storage {
  readonly driver = "disk" as const;
  private readonly root = resolve(CONFIG.uploadsDir);

  /** Resolve a key to an absolute path, refusing anything that escapes root. */
  private abs(key: string): string | null {
    const clean = key.split("?")[0] ?? key;
    if (!clean || clean.includes("..") || clean.startsWith("/")) return null;
    const p = resolve(this.root, clean);
    if (p !== this.root && !p.startsWith(this.root + "/")) return null;
    return p;
  }

  async write(key: string, data: Writable): Promise<void> {
    const p = this.abs(key);
    if (!p) throw new Error(`storage: refusing unsafe key '${key}'`);
    await assertDiskHeadroom(this.root);
    // Bun.write creates missing parent directories automatically.
    await Bun.write(p, data as Blob);
  }

  async exists(key: string): Promise<boolean> {
    const p = this.abs(key);
    if (!p || !existsSync(p)) return false;
    return Bun.file(p).exists();
  }

  async serve(key: string): Promise<Response | null> {
    const p = this.abs(key);
    if (!p || !existsSync(p)) return null;
    const f = Bun.file(p);
    if (!(await f.exists())) return null;
    return new Response(f, { headers: { "Cache-Control": SERVE_CACHE_CONTROL } });
  }

  async delete(key: string): Promise<void> {
    const p = this.abs(key);
    if (!p) return;
    await rm(p, { force: true }).catch(() => {});
  }

  async deletePrefix(prefix: string): Promise<void> {
    const p = this.abs(prefix);
    if (!p) return;
    await rm(p, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── R2 backend ───────────────────────────────────────────────────────────────

class R2Storage implements Storage {
  readonly driver = "r2" as const;
  private readonly client = new Bun.S3Client({
    accessKeyId: CONFIG.r2.accessKeyId,
    secretAccessKey: CONFIG.r2.secretAccessKey,
    bucket: CONFIG.r2.bucket,
    endpoint: CONFIG.r2.endpoint,
    region: "auto",
  });

  async write(key: string, data: Writable, contentType?: string): Promise<void> {
    await this.client.write(key, data as Blob, {
      type: contentType ?? contentTypeForKey(key),
    });
  }

  async exists(key: string): Promise<boolean> {
    return this.client.exists(key);
  }

  async serve(key: string): Promise<Response | null> {
    const f = this.client.file(key);
    if (!(await f.exists())) return null;
    // Stream the object through the app so the public URL, auth semantics and
    // cache headers stay identical to the disk backend. R2 egress to the app
    // is free; only app→client egress is billed, same as serving from disk.
    return new Response(f.stream(), {
      headers: {
        "Cache-Control": SERVE_CACHE_CONTROL,
        "Content-Type": f.type || contentTypeForKey(key),
      },
    });
  }

  async delete(key: string): Promise<void> {
    await this.client.delete(key).catch(() => {});
  }

  async deletePrefix(prefix: string): Promise<void> {
    // R2 has no recursive delete — list the prefix and remove each object.
    let cursor: string | undefined;
    do {
      const page = await this.client.list({ prefix, continuationToken: cursor, maxKeys: 1000 });
      const objects = page?.contents ?? [];
      await Promise.all(objects.map((o: { key: string }) => this.delete(o.key)));
      cursor = page?.isTruncated ? page.nextContinuationToken : undefined;
    } while (cursor);
  }
}

/** Strip a public `/uploads/<key>?v=...` URL (or a bare relative path) down to
 *  the canonical storage key, or null when it isn't a local uploads reference.
 *  Centralises the guard the call sites used to hand-roll. */
export function keyFromUploadUrl(urlOrRel: string): string | null {
  const noQuery = urlOrRel.split("?")[0] ?? urlOrRel;
  const rel = noQuery.startsWith("/uploads/") ? noQuery.slice("/uploads/".length) : noQuery;
  if (!rel || rel.includes("..") || rel.startsWith("/")) return null;
  return rel;
}

/** The active backend, chosen once at boot. */
export const storage: Storage = R2_ENABLED ? new R2Storage() : new DiskStorage();
