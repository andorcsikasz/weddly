// Anthropic Messages API client — generic infra, no wedding domain in it.
//
// Configured only when ANTHROPIC_API_KEY is set: the same "configured?" gate as
// Stripe / DeepL / GEMI. When the key is unset `aiConfigured()` is false, the
// availability endpoint reports it, and the whole UI is absent rather than
// broken. AI_FAKE=1 makes the caller's own deterministic stub answer instead of
// the network, so the E2E suite exercises the full route -> domain -> lib
// pipeline with no HTTP at all (mirrors DEEPL_FAKE / GOOGLE_PLACES_FAKE).
//
// Plain `fetch`, no SDK, for the same reason `lib/translate.ts` calls DeepL with
// fetch: one POST to one endpoint does not earn a dependency, and the project
// keeps its dependency list short on purpose.
//
// Docs: https://platform.claude.com/docs/en/api/messages

import { log as logger } from "./logger";

/** THE model id. One constant, one place to change it.
 *
 *  Claude Haiku 4.5 — chosen for what this feature actually is: a SHORT,
 *  high-volume, latency-sensitive summarise-and-draft task whose entire output
 *  is a draft a human then edits. The strip sits inline on a page the vendor is
 *  already reading, so seconds of wait cost more than a slightly better
 *  sentence, and at $1/$5 per MTok it is the cheapest current model by a wide
 *  margin — which matters when the caller is "every vendor, every inquiry".
 *  Nothing here needs deep reasoning: the one judgement call (which saved
 *  package fits) is a pick from at most three options, and the invariant that
 *  makes it safe (never invent a price) is enforced in `domain/ai_assist.ts`
 *  rather than trusted to the model.
 *
 *  If HU or ES drafting quality ever disappoints, `claude-sonnet-5` is a
 *  drop-in swap here and nothing else changes: same Messages API, same
 *  structured-output shape, roughly 2-3x the cost per call. */
export const AI_MODEL = "claude-haiku-4-5";

/** Anthropic's dated API version header. Not the model, not a beta flag. */
const API_VERSION = "2023-06-01";

const API_URL = "https://api.anthropic.com/v1/messages";

/** The strip is inline on a page the vendor is reading. Past this it is not
 *  worth waiting for, and the caller degrades to no strip at all. */
const TIMEOUT_MS = 20_000;

function apiKey(): string | null {
  const k = process.env.ANTHROPIC_API_KEY;
  return k && k.trim().length > 0 ? k.trim() : null;
}

function fakeMode(): boolean {
  return process.env.AI_FAKE === "1";
}

/** Test-only failure injection: with AI_FAKE=1 AND AI_FAKE_FAIL=1 every call
 *  answers null, so the suite can prove the whole feature degrades to nothing
 *  on a bad model minute WITHOUT a network call. The alternative was turning
 *  the fake off and letting the test hit the real API, which is not a test. */
function fakeFails(): boolean {
  return process.env.AI_FAKE_FAIL === "1";
}

/** True when an Anthropic key is configured. The frontend gates the assistant
 *  strip on GET /api/ai/availability, which returns this. */
export function aiConfigured(): boolean {
  return apiKey() !== null;
}

/** One request for a JSON answer. `schema` is a JSON Schema the Messages API
 *  constrains the response to (structured outputs), so a malformed body is not
 *  a failure mode the caller has to carry. */
export interface AiJsonRequest {
  /** The instruction block. Stable across calls, which is what makes it the
   *  cacheable half of the prompt. */
  system: string;
  /** The per-call facts. THE CALLER decides what goes in here, and adding a
   *  field to it is a privacy decision, not a formatting one. */
  user: string;
  /** JSON Schema for the answer. Must set `additionalProperties: false` and
   *  list every property in `required` — the API rejects anything looser. */
  schema: Record<string, unknown>;
  maxTokens: number;
  /** Deterministic answer used when AI_FAKE=1. Supplied by the caller so the
   *  stub can be shaped by the feature that owns it, and so `lib/` stays free
   *  of any knowledge of what the answers mean. */
  fake?: () => unknown;
}

/** The last prompt this process handed to `aiJson`, recorded ONLY in fake mode.
 *  Exists so a test can assert what actually went out rather than what a
 *  builder said it would, which is the only way the privacy contract is
 *  verifiable end to end. Never populated with a real key configured. */
let lastFakeRequest: { system: string; user: string } | null = null;

/** Test-only: the exact system + user text of the most recent fake-mode call.
 *  Same shape of escape hatch as `mintTestBearer` in `google_oauth.ts`. */
export function aiLastFakeRequest(): { system: string; user: string } | null {
  return lastFakeRequest;
}

/** Test-only: forget the recorded prompt so one test cannot read another's. */
export function resetAiLastFakeRequest(): void {
  lastFakeRequest = null;
}

/** Ask the model for a JSON answer. Returns the parsed value, or null on EVERY
 *  failure: missing key, timeout, non-2xx, refusal, truncation, unparseable
 *  body. Callers must treat null as "no answer this time" and
 *  degrade, never as an error worth surfacing: a model that is having a bad
 *  minute is not the vendor's problem. */
export async function aiJson(req: AiJsonRequest): Promise<unknown | null> {
  if (fakeMode()) {
    lastFakeRequest = { system: req.system, user: req.user };
    if (fakeFails()) return null;
    return req.fake ? req.fake() : null;
  }
  const key = apiKey();
  if (!key) return null;
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        // Structured outputs: the response is constrained to the schema, so a
        // "here is your JSON:" preamble is not a shape we have to survive.
        output_config: { format: { type: "json_schema", schema: req.schema } },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      logger.warn("ai.upstream_status", { status: r.status });
      return null;
    }
    const body = (await r.json().catch(() => null)) as {
      stop_reason?: string;
      content?: { type?: string; text?: string }[];
    } | null;
    if (!body) return null;
    // A refusal or a truncated answer is a non-answer. Both are ordinary,
    // neither is an error, and half a drafted reply is worse than none.
    if (body.stop_reason === "refusal" || body.stop_reason === "max_tokens") {
      logger.warn("ai.stop_reason", { stop_reason: body.stop_reason });
      return null;
    }
    const text = body.content?.find((b) => b.type === "text")?.text;
    if (typeof text !== "string") return null;
    return parseJsonLoosely(text);
  } catch (e) {
    logger.warn("ai.upstream_throw", { error: String(e) });
    return null;
  }
}

/** Parse a JSON object out of the model's text. Structured outputs should make
 *  the whole string valid JSON on their own; the brace-slice is the belt to
 *  that pair of braces, so a stray wrapper never costs the whole answer.
 *  Returns null rather than throwing. */
function parseJsonLoosely(text: string): unknown | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}
