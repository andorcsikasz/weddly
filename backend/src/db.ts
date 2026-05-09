// SQLite + idempotent migrations. New tables go in schema.sql; new columns
// go through addColumnIfMissing(). Never DROP or RENAME — old servers still
// need to read the DB during a rolling deploy.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CONFIG } from "./config";

try {
  mkdirSync(dirname(CONFIG.dbPath), { recursive: true });
  mkdirSync(CONFIG.uploadsDir, { recursive: true });
} catch (e) {
  console.error(
    `[db] FATAL: could not create data dirs (db=${CONFIG.dbPath} uploads=${CONFIG.uploadsDir}). ` +
      `On Railway, mount a volume at '/data' in the service settings.`,
    e,
  );
  process.exit(1);
}

export const db = new Database(CONFIG.dbPath, { create: true });
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");

const schemaPath = new URL("./schema.sql", import.meta.url);
const schema = await Bun.file(schemaPath).text();
db.exec(schema);

/** Idempotent ALTER TABLE: adds the column iff it's missing. The whole
 *  migration story for v1 — no migration files, no version table. */
export function addColumnIfMissing(table: string, column: string, ddl: string) {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!rows.some((r) => r.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

// ── Future column additions land here. ──
addColumnIfMissing("couples", "bride_name", "bride_name TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("couples", "groom_name", "groom_name TEXT NOT NULL DEFAULT ''");

// Flexible "wedding goal" — couples often start before they have a fixed
// date / final guest count / locked budget. We keep the original columns
// (wedding_date, target_guest_count, budget_ceiling_huf) for back-compat and
// "exact" answers; the *_kind columns plus structured period / range fields
// hold the fuzzier shapes.
//
//   wedding_date_kind:      'exact' | 'month' | 'season' | 'year' | 'tbd'
//   wedding_target_year:    integer (e.g. 2027). Filled for month/season/year/exact.
//   wedding_target_month:   1..12. Filled when kind = 'month' or 'exact'.
//   wedding_target_season:  'spring' | 'summer' | 'fall' | 'winter'.
//                           Filled when kind = 'season'.
//   guest_count_kind:       'exact' | 'range' | 'tbd'
//   target_guest_count_min/max: range bounds when kind = 'range'.
//   budget_kind:            'exact' | 'range' | 'tbd'
//   budget_ceiling_min_huf/max_huf: range bounds when kind = 'range'.
addColumnIfMissing(
  "couples",
  "wedding_date_kind",
  "wedding_date_kind TEXT NOT NULL DEFAULT 'exact'",
);
addColumnIfMissing("couples", "wedding_target_year", "wedding_target_year INTEGER");
addColumnIfMissing("couples", "wedding_target_month", "wedding_target_month INTEGER");
addColumnIfMissing("couples", "wedding_target_season", "wedding_target_season TEXT");
addColumnIfMissing("couples", "guest_count_kind", "guest_count_kind TEXT NOT NULL DEFAULT 'exact'");
addColumnIfMissing("couples", "target_guest_count_min", "target_guest_count_min INTEGER");
addColumnIfMissing("couples", "target_guest_count_max", "target_guest_count_max INTEGER");
addColumnIfMissing("couples", "budget_kind", "budget_kind TEXT NOT NULL DEFAULT 'exact'");
addColumnIfMissing("couples", "budget_ceiling_min_huf", "budget_ceiling_min_huf INTEGER");
addColumnIfMissing("couples", "budget_ceiling_max_huf", "budget_ceiling_max_huf INTEGER");

// Real-world table dimensions in millimetres so the floor-plan map and PDF
// can render at exact size when the user knows their venue's table sizes.
addColumnIfMissing("seating_tables", "width_mm", "width_mm INTEGER NOT NULL DEFAULT 1500");
addColumnIfMissing("seating_tables", "length_mm", "length_mm INTEGER NOT NULL DEFAULT 1500");

export function now(): number {
  return Date.now();
}
