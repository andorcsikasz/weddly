// IP → ISO-3166-1 alpha-2 country lookup for signup acquisition analytics.
//
// Privacy posture: the caller passes the request IP, we return a 2-letter
// country code, and the IP is never persisted by this module. The MaxMind
// GeoLite2-Country `.mmdb` is read into memory once at boot and reused for
// every lookup (the reader does in-memory tree walks, no per-call I/O).
//
// Graceful degrade is the whole contract: if the DB file is absent (dev with
// no key, or before the first boot-download), `lookupCountry()` returns null
// and the app keeps working — mirrors the GA4/Stripe "configured?" pattern in
// config.ts. The file is NEVER committed (MaxMind's EULA forbids
// redistribution); it's fetched at boot by `ensureGeoDb()` when a license key
// is set, onto the `/data` persistent volume so it survives redeploys.

import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import maxmind, { type CountryResponse, type Reader } from "maxmind";
import { CONFIG } from "../config";
import { log } from "./logger";

let reader: Reader<CountryResponse> | null = null;
let opened = false;

/** Open the `.mmdb` at the configured path into the module-level reader. Idempotent.
 *  Missing file or a malformed DB leaves the reader null (lookups return null). */
export async function openGeoDb(): Promise<void> {
  if (opened) return;
  opened = true;
  if (!existsSync(CONFIG.geoIpDbPath)) {
    log.info("geoip: no DB present, country lookup disabled", { path: CONFIG.geoIpDbPath });
    return;
  }
  try {
    reader = await maxmind.open<CountryResponse>(CONFIG.geoIpDbPath);
    log.info("geoip: country DB loaded", { path: CONFIG.geoIpDbPath });
  } catch (err) {
    log.error("geoip: failed to open country DB", err, { path: CONFIG.geoIpDbPath });
    reader = null;
  }
}

/** Resolve an IP to an uppercase ISO-3166-1 alpha-2 country code, or null when
 *  the reader is absent, the IP is missing/private, or the lookup misses. Never
 *  throws — a bad IP must never break the signup it's attached to. */
export function lookupCountry(ip: string | null): string | null {
  if (!reader || !ip) return null;
  try {
    const iso = reader.get(ip)?.country?.iso_code;
    return iso ? iso.toUpperCase() : null;
  } catch {
    // Malformed / unroutable address — maxmind throws on invalid input.
    return null;
  }
}

/** Boot hook: if the DB is missing AND a MaxMind license key is set, download +
 *  extract it to `geoIpDbPath`, then open it. No key or a download failure is
 *  non-fatal — the app boots with country lookup disabled. Safe to await at
 *  startup; it short-circuits instantly when the file already exists. */
export async function ensureGeoDb(): Promise<void> {
  if (existsSync(CONFIG.geoIpDbPath)) {
    await openGeoDb();
    return;
  }
  if (!CONFIG.maxmindLicenseKey) {
    log.info("geoip: no MAXMIND_LICENSE_KEY, skipping country DB download");
    await openGeoDb(); // logs the "disabled" line and leaves reader null
    return;
  }
  try {
    await downloadGeoDb();
    // Re-arm the open guard so the freshly downloaded file gets read.
    opened = false;
    await openGeoDb();
  } catch (err) {
    log.error("geoip: country DB download failed, lookup disabled", err);
  }
}

/** Download the GeoLite2-Country DB from MaxMind and place the `.mmdb` at
 *  `geoIpDbPath`. The endpoint serves a gzipped tarball whose `.mmdb` sits one
 *  directory deep (`GeoLite2-Country_YYYYMMDD/GeoLite2-Country.mmdb`); we
 *  extract to a temp dir with the system `tar`, then atomically move the mmdb
 *  into place. Exported so `scripts/geoip_update.ts` can refresh it out of band
 *  (MaxMind updates the DB ~weekly) without a redeploy. */
export async function downloadGeoDb(): Promise<void> {
  if (!CONFIG.maxmindLicenseKey) throw new Error("MAXMIND_LICENSE_KEY is not set");
  const url =
    "https://download.maxmind.com/app/geoip_download" +
    "?edition_id=GeoLite2-Country&suffix=tar.gz" +
    `&license_key=${encodeURIComponent(CONFIG.maxmindLicenseKey)}`;
  log.info("geoip: downloading country DB from MaxMind");
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MaxMind download failed: HTTP ${res.status}`);
  }
  const work = join(tmpdir(), `geolite2-${process.pid}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const tarball = join(work, "country.tar.gz");
  await Bun.write(tarball, await res.arrayBuffer());

  // Extract with the system tar (present in the Bun Debian runtime + macOS dev).
  const proc = Bun.spawn(["tar", "-xzf", tarball, "-C", work], { stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`tar extract failed (${code}): ${stderr.trim()}`);
  }

  // Find the extracted .mmdb (the dated dir name varies by release).
  const glob = new Bun.Glob("**/GeoLite2-Country.mmdb");
  let found: string | null = null;
  for await (const rel of glob.scan({ cwd: work })) {
    found = join(work, rel);
    break;
  }
  if (!found) throw new Error("GeoLite2-Country.mmdb not found in MaxMind tarball");

  mkdirSync(dirname(CONFIG.geoIpDbPath), { recursive: true });
  // copy (not rename) — tmpdir and the /data volume are usually different
  // filesystems, where rename would throw EXDEV.
  copyFileSync(found, CONFIG.geoIpDbPath);
  rmSync(work, { recursive: true, force: true });
  log.info("geoip: country DB installed", { path: CONFIG.geoIpDbPath });
}
