// Auto-translate for a vendor's two description fields (their LOCAL language
// <-> English). Thin layer over lib/translate (DeepL). Two endpoints:
//
//   GET  /api/translate/availability  — { available } so the UI hides the
//                                        button when no DeepL key is configured
//   POST /api/translate               — { text, source, target } -> { text }
//
// Auth-required + rate-limited per IP: DeepL is a paid upstream, so the
// endpoint must not be usable as an open translation proxy. The language pair
// stays a CLOSED union (shared/translate.ts) for the same reason — widening it
// to every DeepL language would make this a general-purpose translation API on
// someone else's bill.

import type { TranslateLang } from "@shared/translate";
import { isTranslateLang, TRANSLATE_LANGS, TRANSLATE_MAX_CHARS } from "@shared/translate";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { rateLimit, TRANSLATE_BUCKET } from "../lib/rate_limit";
import { translateConfigured, translateText } from "../lib/translate";

// Availability is a pure in-process check (env presence, no upstream call), so
// it stays unauthenticated + unthrottled — it only reveals a feature-flag bit.
function handleAvailability(): Response {
  return json({ available: translateConfigured() });
}

function parseLang(raw: unknown, field: string): TranslateLang {
  if (isTranslateLang(raw)) return raw;
  throw new HttpError(400, `${field} must be one of ${TRANSLATE_LANGS.join(", ")}`);
}

async function handleTranslate(ctx: Ctx): Promise<Response> {
  requireAuth(ctx);
  rateLimit(ctx.clientIp, "translate", TRANSLATE_BUCKET);
  if (!translateConfigured()) {
    throw new HttpError(503, "translation is not configured");
  }
  const body = await readJson<{ text?: unknown; source?: unknown; target?: unknown }>(ctx.req);
  if (typeof body.text !== "string") throw new HttpError(400, "text required");
  const text = body.text.trim();
  if (!text) throw new HttpError(400, "text required");
  if (text.length > TRANSLATE_MAX_CHARS) {
    throw new HttpError(400, `text too long (max ${TRANSLATE_MAX_CHARS})`);
  }
  const source = parseLang(body.source, "source");
  const target = parseLang(body.target, "target");
  if (source === target) throw new HttpError(400, "source and target must differ");

  const translated = await translateText(text, source, target);
  if (translated === null) throw new HttpError(502, "translation temporarily unavailable");
  return json({ text: translated });
}

export function registerTranslateRoutes(router: Router) {
  router.get("/api/translate/availability", handleAvailability);
  router.post("/api/translate", handleTranslate);
}
