// Couple-cards (100 kérdés az esküvő előtt) feedback + suggestion endpoints.
//
//   • POST /api/couple-cards/feedback                — anon rating, rate-limited
//   • GET  /api/admin/couple-cards/feedback          — admin rating aggregate
//   • POST /api/couple-cards/suggestions             — anon suggestion, rate-limited
//   • GET  /api/admin/couple-cards/suggestions       — admin suggestion list
//
// Each row in `couple_card_feedback` is one anonymous rating (bad / ok /
// great) on one question. Each row in `couple_card_suggestions` is one
// free-text question submitted via the 26th "blank" card on a deck.
// Both feed into the curator workflow for the next copy iteration; we
// never auto-promote a suggestion into the pack.

import { db } from "../db";
import { requireAdmin } from "../domain/users";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { now } from "../db";
import { rateLimit } from "../lib/rate_limit";

const VALID_DECKS = new Set(["roots", "everyday", "closeness", "deepwater", "lemonade"]);
const VALID_RATINGS = new Set(["bad", "ok", "great"]);
const VALID_LOCALES = new Set(["hu", "en"]);

interface SubmitBody {
  deck_id?: unknown;
  card_index?: unknown;
  rating?: unknown;
  locale?: unknown;
  question_snapshot?: unknown;
}

function trimStr(v: unknown, maxLen: number): string {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (s.length > maxLen) throw new HttpError(400, `Field too long (max ${maxLen})`);
  return s;
}

async function handleSubmit(ctx: Ctx): Promise<Response> {
  // Rate limit aggressively per-IP: a normal session generates 1-3
  // ratings; anything past 20/hour is a script.
  rateLimit(ctx.clientIp, "couple_cards_feedback", { capacity: 20, refillRate: 1 / 180 });

  const body = await readJson<SubmitBody>(ctx.req);
  const deckId = trimStr(body.deck_id, 32);
  const rating = trimStr(body.rating, 16);
  const locale = trimStr(body.locale, 8);
  const questionSnapshot = trimStr(body.question_snapshot, 1000);
  const cardIndex = Number(body.card_index);

  if (!VALID_DECKS.has(deckId)) throw new HttpError(400, "Unknown deck_id");
  if (!VALID_RATINGS.has(rating)) throw new HttpError(400, "rating must be bad|ok|great");
  if (!VALID_LOCALES.has(locale)) throw new HttpError(400, "locale must be hu|en");
  if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= 25) {
    throw new HttpError(400, "card_index must be an integer in [0, 25)");
  }

  db.prepare(
    `INSERT INTO couple_card_feedback (deck_id, card_index, rating, locale, question_snapshot, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(deckId, cardIndex, rating, locale, questionSnapshot, now());

  return json({ ok: true });
}

interface AggregateRow {
  deck_id: string;
  card_index: number;
  locale: string;
  question_snapshot: string;
  bad_count: number;
  ok_count: number;
  great_count: number;
  total: number;
  last_at: number;
}

async function handleAdminAggregate(ctx: Ctx): Promise<Response> {
  requireAdmin(ctx);
  // One row per (deck, card_index, locale) with rating tallies.
  // question_snapshot is taken from the most recent submission so a curator
  // sees the wording the visitor actually saw, not the (possibly changed)
  // current source string.
  const rows = db
    .prepare(
      `SELECT
         f.deck_id,
         f.card_index,
         f.locale,
         (SELECT question_snapshot FROM couple_card_feedback
           WHERE deck_id = f.deck_id AND card_index = f.card_index AND locale = f.locale
           ORDER BY created_at DESC LIMIT 1) AS question_snapshot,
         SUM(CASE WHEN rating = 'bad'   THEN 1 ELSE 0 END) AS bad_count,
         SUM(CASE WHEN rating = 'ok'    THEN 1 ELSE 0 END) AS ok_count,
         SUM(CASE WHEN rating = 'great' THEN 1 ELSE 0 END) AS great_count,
         COUNT(*) AS total,
         MAX(created_at) AS last_at
       FROM couple_card_feedback f
       GROUP BY deck_id, card_index, locale
       ORDER BY bad_count DESC, total DESC, last_at DESC`,
    )
    .all() as AggregateRow[];

  return json({ items: rows });
}

interface SuggestionBody {
  deck_id?: unknown;
  locale?: unknown;
  suggestion?: unknown;
}

async function handleSuggestionSubmit(ctx: Ctx): Promise<Response> {
  // Lower ceiling than ratings: a normal visitor types one suggestion at
  // most. Anything past 5/hour from a single IP is almost certainly noise
  // or a bot scraping the form.
  rateLimit(ctx.clientIp, "couple_cards_suggest", { capacity: 5, refillRate: 1 / 720 });

  const body = await readJson<SuggestionBody>(ctx.req);
  const deckId = trimStr(body.deck_id, 32);
  const locale = trimStr(body.locale, 8);
  const suggestion = trimStr(body.suggestion, 600);

  if (!VALID_DECKS.has(deckId)) throw new HttpError(400, "Unknown deck_id");
  if (!VALID_LOCALES.has(locale)) throw new HttpError(400, "locale must be hu|en");
  if (suggestion.length < 8) throw new HttpError(400, "suggestion too short (min 8 chars)");

  db.prepare(
    `INSERT INTO couple_card_suggestions (deck_id, locale, suggestion, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(deckId, locale, suggestion, now());

  return json({ ok: true });
}

interface SuggestionRow {
  id: number;
  deck_id: string;
  locale: string;
  suggestion: string;
  created_at: number;
}

async function handleAdminSuggestionList(ctx: Ctx): Promise<Response> {
  requireAdmin(ctx);
  const rows = db
    .prepare(
      `SELECT id, deck_id, locale, suggestion, created_at
         FROM couple_card_suggestions
         ORDER BY created_at DESC
         LIMIT 1000`,
    )
    .all() as SuggestionRow[];
  return json({ items: rows });
}

export function registerCoupleCardsRoutes(router: Router) {
  router.post("/api/couple-cards/feedback", handleSubmit);
  router.get("/api/admin/couple-cards/feedback", handleAdminAggregate, true);
  router.post("/api/couple-cards/suggestions", handleSuggestionSubmit);
  router.get("/api/admin/couple-cards/suggestions", handleAdminSuggestionList, true);
}
