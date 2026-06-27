// Invoice / receipt uploads attached to a budget row. Couple-scoped.
//
//   - GET    /api/budget/documents          → every document for the couple
//   - POST   /api/budget/documents          → multipart upload (scope + file)
//   - DELETE /api/budget/documents/:id       → remove one document
//
// Documents are anchored by `scope` to what the user sees in the PAID column:
// 'cat:<category>' for an aggregated category row, 'line:<id>' for a custom
// line. The paid amount stays on budget_lines.paid_huf — these are just proof
// the user attaches via the bill icon. Mirrors the moodboard upload pattern
// (validate-before-write, insert-then-name-by-id, public /uploads URL).

import type { BudgetCategory, BudgetDocument } from "@shared/types";
import { db, now } from "../db";
import { getCoupleForUser } from "../domain/couples";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, requireAuth, type Router } from "../lib/http";
import { sniffImageMime } from "../lib/image_sniff";
import { keyFromUploadUrl, storage } from "../lib/storage";

const MAX_DOC_BYTES = 8 * 1024 * 1024;
const MAX_DOCS_PER_SCOPE = 20;

const VALID_CATEGORIES: ReadonlySet<BudgetCategory> = new Set([
  "venue",
  "catering",
  "drinks",
  "attire",
  "decor_floral",
  "photo_video",
  "music_dj",
  "cake_dessert",
  "hair_makeup",
  "transport",
  "honeymoon",
  "stationery",
  "favours",
  "rings",
  "other",
]);

/** Allowed upload types → stored extension, keyed by sniffed mime. PDFs are the
 *  common invoice format; images cover phone-snapped receipts. */
const EXT_BY_MIME: Record<string, "pdf" | "jpg" | "png" | "webp"> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

interface DocRow {
  id: number;
  couple_id: number;
  scope: string;
  file_path: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  created_at: number;
}

function toDocument(r: DocRow): BudgetDocument {
  return {
    id: r.id,
    couple_id: r.couple_id,
    scope: r.scope,
    file_path: r.file_path,
    file_name: r.file_name,
    mime: r.mime,
    size_bytes: r.size_bytes,
    created_at: r.created_at,
  };
}

function requireCouple(ctx: Ctx) {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return { userId, couple };
}

/** Sniff PDF (`%PDF`) or a supported image by its leading bytes. The multipart
 *  Content-Type is attacker-controlled, so the stored mime/extension come from
 *  the actual bytes, never the claimed type. */
function sniffDocument(bytes: Uint8Array): "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return "application/pdf";
  }
  return sniffImageMime(bytes);
}

/** Validate `scope` and, for line scopes, confirm the line belongs to the
 *  couple so a caller can't attach documents to another couple's row. */
function validateScope(raw: unknown, coupleId: number): string {
  if (typeof raw !== "string" || raw.length > 60) throw new HttpError(400, "Invalid scope");
  const catMatch = /^cat:([a-z_]{1,30})$/.exec(raw);
  if (catMatch) {
    if (!VALID_CATEGORIES.has(catMatch[1] as BudgetCategory)) {
      throw new HttpError(400, "Unknown category scope");
    }
    return raw;
  }
  const lineMatch = /^line:(\d{1,15})$/.exec(raw);
  if (lineMatch) {
    const lineId = Number(lineMatch[1]);
    const line = db
      .prepare("SELECT id FROM budget_lines WHERE id = ? AND couple_id = ?")
      .get(lineId, coupleId) as { id: number } | undefined;
    if (!line) throw new HttpError(404, "Budget line not found");
    return raw;
  }
  throw new HttpError(400, "scope must be 'cat:<category>' or 'line:<id>'");
}

function listDocuments(coupleId: number): BudgetDocument[] {
  const rows = db
    .prepare("SELECT * FROM budget_documents WHERE couple_id = ? ORDER BY created_at ASC, id ASC")
    .all(coupleId) as DocRow[];
  return rows.map(toDocument);
}

function handleList(ctx: Ctx): Response {
  const { couple } = requireCouple(ctx);
  return json({ documents: listDocuments(couple.id) });
}

async function handleUpload(ctx: Ctx): Promise<Response> {
  const { userId, couple } = requireCouple(ctx);

  const form = await ctx.req.formData().catch(() => {
    throw new HttpError(400, "Multipart form-data required", { code: "bad_multipart" });
  });
  const scope = validateScope(form.get("scope"), couple.id);

  const entry = form.get("file");
  if (!(entry instanceof File)) {
    throw new HttpError(400, "`file` field required", { code: "missing_file" });
  }
  if (entry.size <= 0) throw new HttpError(400, "Empty file", { code: "empty_file" });
  if (entry.size > MAX_DOC_BYTES) {
    throw new HttpError(413, `File too large (max ${MAX_DOC_BYTES / 1024 / 1024} MB)`, {
      code: "file_too_large",
    });
  }

  const existing = (
    db
      .prepare("SELECT COUNT(*) AS n FROM budget_documents WHERE couple_id = ? AND scope = ?")
      .get(couple.id, scope) as { n: number }
  ).n;
  if (existing >= MAX_DOCS_PER_SCOPE) {
    throw new HttpError(400, `At most ${MAX_DOCS_PER_SCOPE} documents per row`, {
      code: "upload_limit",
    });
  }

  const head = new Uint8Array(await entry.arrayBuffer()).subarray(0, 12);
  const mime = sniffDocument(head);
  const ext = mime ? EXT_BY_MIME[mime] : undefined;
  if (!mime || !ext) {
    throw new HttpError(415, "Only PDF, JPEG, PNG or WebP files are allowed", {
      code: "unsupported_type",
    });
  }

  // Keep the original filename for display, but sanitise it: strip any path
  // segments and cap the length so a hostile name can't break the UI.
  const rawName = entry.name || `document.${ext}`;
  const fileName = rawName.replace(/^.*[\\/]/, "").slice(0, 200) || `document.${ext}`;

  const ts = now();
  // Insert first so the row id names the file (stable, collision-free).
  const res = db
    .prepare(
      "INSERT INTO budget_documents (couple_id, scope, file_path, file_name, mime, size_bytes, created_at) VALUES (?, ?, '', ?, ?, ?, ?)",
    )
    .run(couple.id, scope, fileName, mime, entry.size, ts);
  const id = Number(res.lastInsertRowid);
  const key = `couples/${couple.id}/budget-docs/${id}.${ext}`;
  await storage.write(key, entry);
  const filePath = `/uploads/couples/${couple.id}/budget-docs/${id}.${ext}?v=${ts}`;
  db.prepare("UPDATE budget_documents SET file_path = ? WHERE id = ?").run(filePath, id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "budget.document_upload",
    target_kind: "budget_document",
    target_id: id,
    after: { scope, file_name: fileName, mime, size_bytes: entry.size },
  });

  const row = db.prepare("SELECT * FROM budget_documents WHERE id = ?").get(id) as DocRow;
  return json({ document: toDocument(row) }, { status: 201 });
}

async function handleDelete(ctx: Ctx): Promise<Response> {
  const { userId, couple } = requireCouple(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) throw new HttpError(400, "Invalid id");

  const row = db
    .prepare("SELECT * FROM budget_documents WHERE id = ? AND couple_id = ?")
    .get(id, couple.id) as DocRow | undefined;
  if (!row) throw new HttpError(404, "Document not found");

  // Resolve the public URL back to a storage key, then delete the bytes. A
  // leaked file under uploads never surfaces to users.
  const k = keyFromUploadUrl(row.file_path);
  if (k) await storage.delete(k);
  db.prepare("DELETE FROM budget_documents WHERE id = ? AND couple_id = ?").run(id, couple.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "budget.document_delete",
    target_kind: "budget_document",
    target_id: id,
    before: { scope: row.scope, file_name: row.file_name },
  });

  return json({ ok: true });
}

export function registerBudgetDocumentRoutes(router: Router) {
  router.get("/api/budget/documents", handleList, true);
  router.post("/api/budget/documents", handleUpload, true);
  router.delete("/api/budget/documents/:id", handleDelete, true);
}
