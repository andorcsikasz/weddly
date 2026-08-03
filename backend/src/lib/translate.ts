// DeepL-backed text translation for the bilingual vendor "Leírás" fields
// (HU <-> EN). Configured only when DEEPL_API_KEY is set — same "configured?"
// gate as Stripe / GEMI: when unset the endpoint reports available:false and
// the frontend hides the button. DEEPL_FAKE=1 makes the E2E suite translate
// against a deterministic stub instead of the network (mirrors
// COMPANY_LOOKUP_FAKE / ADDRESS_SUGGEST_FAKE in tests/setup.ts).
//
// DeepL free keys end in ":fx" and hit api-free.deepl.com; paid keys hit
// api.deepl.com. Auth is a request header, not a query param.
// Docs: https://developers.deepl.com/docs/api-reference/translate

import type { TranslateLang } from "@shared/translate";
import { log as logger } from "./logger";

const TIMEOUT_MS = 8_000;

// DeepL target codes. Two languages must be REGIONALISED on the target side
// (DeepL rejects the bare code): English and Portuguese. The source side takes
// the bare language for both, so this map is target-only. Everything else
// passes straight through, which is what keeps adding a language to
// `TranslateLang` a one-line change there and nothing here.
const TARGET_CODE: Partial<Record<TranslateLang, string>> = { EN: "EN-US", PT: "PT-PT" };

function targetCode(lang: TranslateLang): string {
  return TARGET_CODE[lang] ?? lang;
}

function apiKey(): string | null {
  const k = process.env.DEEPL_API_KEY;
  return k && k.length > 0 ? k : null;
}

function fakeMode(): boolean {
  return process.env.DEEPL_FAKE === "1";
}

/** True when a DeepL key is configured. The frontend gates the translate
 *  button on GET /api/translate/availability, which returns this. */
export function translateConfigured(): boolean {
  return apiKey() !== null;
}

/** Translate `text` from `source` to `target`. Returns the translated string,
 *  or null on any upstream failure / missing config (the route maps null to a
 *  502 so the client shows a transient error rather than a broken field). */
export async function translateText(
  text: string,
  source: TranslateLang,
  target: TranslateLang,
): Promise<string | null> {
  if (fakeMode()) return fakeTranslate(text, target);
  const key = apiKey();
  if (!key) return null;
  const base = key.trimEnd().endsWith(":fx")
    ? "https://api-free.deepl.com"
    : "https://api.deepl.com";
  try {
    const r = await fetch(`${base}/v2/translate`, {
      method: "POST",
      headers: {
        authorization: `DeepL-Auth-Key ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text: [text],
        source_lang: source,
        target_lang: targetCode(target),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      logger.warn("translate.upstream_status", { status: r.status });
      return null;
    }
    const body = (await r.json().catch(() => null)) as {
      translations?: { text?: string }[];
    } | null;
    const out = body?.translations?.[0]?.text;
    return typeof out === "string" ? out : null;
  } catch (e) {
    logger.warn("translate.upstream_throw", { error: String(e) });
    return null;
  }
}

/** Deterministic stub for DEEPL_FAKE=1: prefixes the text with the target
 *  language tag so tests can assert a translation happened without a network
 *  call. */
function fakeTranslate(text: string, target: TranslateLang): string {
  return `[${target}] ${text}`;
}
