#!/usr/bin/env bun

/**
 * Production SQLite migration gate.
 *
 * The application reapplies schema.sql before db.ts runs additive column
 * migrations. A fresh test database cannot expose ordering bugs in that path:
 * CREATE TABLE sees every new column immediately. Production can, because
 * CREATE TABLE IF NOT EXISTS is a no-op for an existing table.
 *
 * This check builds a database from the previous schema, boots the CURRENT
 * db.ts over it twice, and then compares the result with the current canonical
 * schema. It fails on boot errors, non-idempotent migrations, dropped tables or
 * columns, missing current tables/columns/indexes, integrity failures, or a
 * broad data wipe.
 */

import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const CURRENT_SCHEMA_PATH = join(REPO_ROOT, "backend/src/schema.sql");
const GUARD_TABLE = "__weddly_migration_guard";
const GUARD_VALUE = "keep-production-data";

type ColumnRow = { name: string };
type NameRow = { name: string };
type IntegrityRow = { integrity_check: string };

type SchemaShape = {
  tables: Map<string, Set<string>>;
  indexes: Map<string, string>;
};

function die(message: string): never {
  console.error(`migration-check: ${message}`);
  process.exit(1);
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) die(`${name} requires a value`);
  return value;
}

function git(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    die(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function quotedIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function shapeOf(db: Database, excludeGuard = false): SchemaShape {
  const tableNames = db
    .query(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as NameRow[];
  const tables = new Map<string, Set<string>>();
  for (const { name } of tableNames) {
    if (excludeGuard && name === GUARD_TABLE) continue;
    const columns = db.query(`PRAGMA table_info(${quotedIdentifier(name)})`).all() as ColumnRow[];
    tables.set(name, new Set(columns.map((column) => column.name)));
  }

  const indexRows = db
    .query(
      "SELECT name, tbl_name AS table_name FROM sqlite_schema " +
        "WHERE type = 'index' AND sql IS NOT NULL ORDER BY name",
    )
    .all() as { name: string; table_name: string }[];
  const indexes = new Map(indexRows.map((row) => [row.name, row.table_name]));
  return { tables, indexes };
}

function assertContainsShape(actual: SchemaShape, expected: SchemaShape, label: string): void {
  const failures: string[] = [];
  for (const [table, expectedColumns] of expected.tables) {
    const actualColumns = actual.tables.get(table);
    if (!actualColumns) {
      failures.push(`missing table ${table}`);
      continue;
    }
    for (const column of expectedColumns) {
      if (!actualColumns.has(column)) failures.push(`missing column ${table}.${column}`);
    }
  }
  for (const [index, table] of expected.indexes) {
    if (!actual.indexes.has(index)) failures.push(`missing index ${index} on ${table}`);
  }
  if (failures.length > 0) {
    die(`${label}:\n  - ${failures.join("\n  - ")}`);
  }
}

function assertHealthy(db: Database, label: string): void {
  const integrity = db.query("PRAGMA integrity_check").get() as IntegrityRow | null;
  if (integrity?.integrity_check !== "ok") {
    die(`${label}: SQLite integrity_check returned ${integrity?.integrity_check ?? "no result"}`);
  }
  const foreignKeyFailures = db.query("PRAGMA foreign_key_check").all();
  if (foreignKeyFailures.length > 0) {
    die(`${label}: ${foreignKeyFailures.length} foreign-key violation(s)`);
  }
}

async function probeDatabase(dbPath: string): Promise<void> {
  process.env.NODE_ENV = "test";
  process.env.DB_PATH = dbPath;
  process.env.UPLOADS_DIR = `${dbPath}.uploads`;
  process.env.JWT_SECRET = "migration-check-secret-0123456789abcdef0123456789abcdef";
  process.env.RESEND_API_KEY = "";
  process.env.EMAIL_FROM = "";
  process.env.SENTRY_DSN = "";
  process.env.R2_ENDPOINT = "";
  mkdirSync(process.env.UPLOADS_DIR, { recursive: true });

  const module = await import(`../backend/src/db.ts?migration_probe=${Date.now()}`);
  const db = module.db as Database;
  assertHealthy(db, "booted database");
  db.close();
}

function runProbe(dbPath: string, pass: number): void {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, "--probe", dbPath], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const details = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
    die(`boot pass ${pass} failed against the previous schema:\n${details}`);
  }
}

function schemaFromReference(): { label: string; sql: string } {
  const schemaFile = argumentValue("--base-schema");
  if (schemaFile) {
    return { label: schemaFile, sql: readFileSync(resolve(schemaFile), "utf8") };
  }

  const baseRef = argumentValue("--base") ?? "HEAD^";
  git(["rev-parse", "--verify", `${baseRef}^{commit}`]);
  return {
    label: baseRef,
    sql: git(["show", `${baseRef}:backend/src/schema.sql`]),
  };
}

async function checkMigrations(): Promise<void> {
  const currentSql = readFileSync(CURRENT_SCHEMA_PATH, "utf8");
  const base = schemaFromReference();
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "weddly-migration-check-"));
  const legacyPath = join(temporaryDirectory, "legacy.db");

  try {
    const baseCanonical = new Database(":memory:");
    baseCanonical.exec(base.sql);
    const baseShape = shapeOf(baseCanonical);
    baseCanonical.close();

    const currentCanonical = new Database(":memory:");
    currentCanonical.exec(currentSql);
    const currentShape = shapeOf(currentCanonical);
    currentCanonical.close();

    // Canonical schema changes are additive. A removed definition would leave
    // old production databases and fresh installs with different structures.
    assertContainsShape(
      currentShape,
      { tables: baseShape.tables, indexes: new Map() },
      "schema removal",
    );

    const legacy = new Database(legacyPath, { create: true });
    legacy.exec("PRAGMA foreign_keys = ON");
    legacy.exec(base.sql);
    legacy.exec(`CREATE TABLE ${GUARD_TABLE} (value TEXT NOT NULL)`);
    legacy.query(`INSERT INTO ${GUARD_TABLE} (value) VALUES (?)`).run(GUARD_VALUE);
    legacy.close();

    // Pass 1 proves upgrade safety. Pass 2 proves every migration is idempotent.
    runProbe(legacyPath, 1);
    runProbe(legacyPath, 2);

    const migrated = new Database(legacyPath);
    assertHealthy(migrated, "migrated database");
    const guard = migrated.query(`SELECT value FROM ${GUARD_TABLE}`).get() as {
      value: string;
    } | null;
    if (guard?.value !== GUARD_VALUE) die("migration removed or changed existing data");

    const migratedShape = shapeOf(migrated, true);
    assertContainsShape(migratedShape, currentShape, "incomplete migration");
    migrated.close();

    console.log(
      `migration-check: safe upgrade from ${base.label}; two boots passed, schema and data intact`,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

const probePath = argumentValue("--probe");
if (probePath) await probeDatabase(resolve(probePath));
else await checkMigrations();
