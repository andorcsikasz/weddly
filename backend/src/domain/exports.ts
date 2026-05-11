// Saved download archive. Every JSON / PDF / CSV the user downloads gets
// snapshotted via `recordExport()` so they can re-download past versions
// from the Profile page. Capped at DATA_EXPORT_CAP_PER_COUPLE per couple —
// new inserts purge the oldest rows beyond that.

import type { DataExportSummary, ExportKind } from "@shared/types";
import { DATA_EXPORT_CAP_PER_COUPLE } from "@shared/types";
import { db, now } from "../db";

interface DataExportRow {
  id: number;
  couple_id: number;
  created_by_user_id: number | null;
  kind: ExportKind;
  format: string | null;
  filename: string;
  content_type: string;
  byte_size: number;
  body: Uint8Array;
  created_at: number;
}

interface RecordInput {
  coupleId: number;
  userId: number;
  kind: ExportKind;
  format: string | null;
  filename: string;
  contentType: string;
  body: Uint8Array;
}

/** Persist one export and trim the couple's archive down to the cap. */
export function recordExport(input: RecordInput): DataExportSummary {
  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO data_exports
         (couple_id, created_by_user_id, kind, format, filename, content_type, byte_size, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.coupleId,
      input.userId,
      input.kind,
      input.format,
      input.filename,
      input.contentType,
      input.body.byteLength,
      input.body,
      ts,
    );
  const id = Number(result.lastInsertRowid);

  // Drop anything past the cap.
  const stale = db
    .prepare(
      `SELECT id FROM data_exports
         WHERE couple_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT -1 OFFSET ?`,
    )
    .all(input.coupleId, DATA_EXPORT_CAP_PER_COUPLE) as { id: number }[];
  if (stale.length > 0) {
    const placeholders = stale.map(() => "?").join(",");
    db.prepare(`DELETE FROM data_exports WHERE id IN (${placeholders})`).run(
      ...stale.map((r) => r.id),
    );
  }

  return {
    id,
    kind: input.kind,
    format: input.format,
    filename: input.filename,
    content_type: input.contentType,
    byte_size: input.body.byteLength,
    created_at: ts,
  };
}

export function listExports(coupleId: number): DataExportSummary[] {
  const rows = db
    .prepare(
      `SELECT id, kind, format, filename, content_type, byte_size, created_at
         FROM data_exports
         WHERE couple_id = ?
         ORDER BY created_at DESC, id DESC`,
    )
    .all(coupleId) as DataExportSummary[];
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    format: r.format,
    filename: r.filename,
    content_type: r.content_type,
    byte_size: r.byte_size,
    created_at: r.created_at,
  }));
}

export function getExport(id: number, coupleId: number): DataExportRow | null {
  const row = db
    .prepare("SELECT * FROM data_exports WHERE id = ? AND couple_id = ?")
    .get(id, coupleId) as DataExportRow | null;
  return row ?? null;
}

/** Returns true when a row matched and was deleted, false otherwise. The
 *  couple_id guard prevents one partner from deleting another couple's row
 *  via a guessed id. */
export function deleteExport(id: number, coupleId: number): boolean {
  const result = db
    .prepare("DELETE FROM data_exports WHERE id = ? AND couple_id = ?")
    .run(id, coupleId);
  return result.changes > 0;
}
