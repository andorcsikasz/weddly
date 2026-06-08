// Download (or refresh) the MaxMind GeoLite2-Country database used to tag
// signups with a country. MaxMind updates the DB ~weekly; the server also
// downloads it once at boot if missing, but this script lets you refresh it
// out of band (e.g. from a cron / Railway one-off) without a redeploy.
//
// Usage:
//   MAXMIND_LICENSE_KEY=... bun backend/scripts/geoip_update.ts
//
// Honours GEOIP_DB_PATH (defaults to ./data/GeoLite2-Country.mmdb) — point it
// at the same path the server reads so the fresh DB lands on the /data volume.

import { CONFIG } from "../src/config";
import { downloadGeoDb } from "../src/lib/geoip";

if (!CONFIG.maxmindLicenseKey) {
  console.error(
    "MAXMIND_LICENSE_KEY is required. Run with: MAXMIND_LICENSE_KEY=... bun backend/scripts/geoip_update.ts",
  );
  process.exit(1);
}

console.log(`[geoip_update] downloading GeoLite2-Country → ${CONFIG.geoIpDbPath}`);
try {
  await downloadGeoDb();
  console.log("[geoip_update] done. Restart the server (or it picks it up at next boot).");
} catch (err) {
  console.error("[geoip_update] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
