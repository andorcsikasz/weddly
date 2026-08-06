// AI Concierge — the vendor's inquiry assistant. Wedding-domain half of the
// feature; the model transport is `lib/ai.ts` and knows nothing about weddings.
//
// ─── WHAT LEAVES THE BUILDING ───────────────────────────────────────────────
//
// EXACTLY these five things go into the prompt, and nothing else:
//
//   1. the couple's own inquiry text (their messages on this thread, or the
//      legacy `supplier_bookings.notes` blob when the thread predates messages),
//   2. the event date,
//   3. the guest count the couple gave at onboarding,
//   4. the vendor's own listing CATEGORY,
//   5. the vendor's own saved package NAMES and their row ids.
//
// NEVER SENT: the couple's email address, their phone number, their names
// (`couples.display_name`, `bride_name`, `groom_name`), their budget, their
// venue, their address, any other vendor's data, and — deliberately — the
// vendor's own package PRICE. The price is attached server-side from the
// row the model's chosen id names, which is what makes "the model never invents
// a price" true by construction rather than by instruction: it never sees one.
//
// ADDING A FIELD TO THE PROMPT IS A PRIVACY DECISION, NOT A FORMATTING ONE.
// `buildAssistPrompt` is the single place it can happen, and it is covered by a
// test that asserts the couple's email, phone and name are absent from the
// bytes that actually went out.
//
// ─── WHAT COMES BACK ────────────────────────────────────────────────────────
//
// `coerceAssistOutput` is the whole trust boundary. The model returns a package
// ID and nothing else about the package; an id that is not one of THIS vendor's
// saved rows is dropped to null rather than repaired, because a suggestion
// pointing at a package that does not exist is worse than no suggestion. Name
// and every price field is copied verbatim from the row. Every string is trimmed
// and capped. A missing summary or a missing draft means the answer was not
// usable, and the caller degrades to nothing.

import type {
  AssistLanguage,
  InquiryAssist,
  InquiryAssistPackage,
  InquiryAssistResult,
} from "@shared/ai_assist";
import {
  ASSIST_DRAFT_MAX_CHARS,
  ASSIST_INQUIRY_MAX_CHARS,
  ASSIST_MISSING_MAX,
  ASSIST_SUMMARY_MAX_CHARS,
  assistLanguageFor,
} from "@shared/ai_assist";
import type { ListingPackage } from "@shared/listing_packages";
import type { Currency } from "@shared/currency";
import { listingCurrency } from "@shared/listing_pricing";
import { db } from "../db";
import { aiJson } from "../lib/ai";
import { listMessages } from "./booking_messages";
import { getListingByVendorAccountId, listListingPackages } from "./listings";
import type { BookingRow } from "./supplier_bookings";

/** One short phrase in `missing` should be a phrase, not a paragraph. */
const MISSING_ITEM_MAX_CHARS = 140;

/** The one sentence the model contributes about a package. */
const PACKAGE_REASON_MAX_CHARS = 240;

/** Output ceiling. Comfortably above summary + four phrases + a full reply,
 *  well short of anything that would let a runaway answer become a bill. */
const MAX_OUTPUT_TOKENS = 1200;

const LANGUAGE_NAME: Record<AssistLanguage, string> = {
  en: "English",
  hu: "Hungarian",
  es: "Spanish",
};

/** The JSON Schema the answer is constrained to. `additionalProperties:false`
 *  plus a complete `required` list is what the Messages API demands of a strict
 *  schema; the nullables use `anyOf` because a `type: [...]` union is not part
 *  of the supported subset. */
const ASSIST_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "missing", "draft_reply", "package_id", "package_reason"],
  properties: {
    summary: { type: "string" },
    missing: { type: "array", items: { type: "string" } },
    draft_reply: { type: "string" },
    package_id: { anyOf: [{ type: "integer" }, { type: "null" }] },
    package_reason: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
};

/** Everything the prompt is allowed to know about one inquiry. Flat and
 *  primitive on purpose: what you can read here is precisely what can be sent,
 *  which is what makes the privacy rule reviewable in one screen. */
export interface AssistFacts {
  event_date: string;
  /** Free-text rendering of the couple's guest goal, or null when they gave
   *  none. A rendered phrase rather than three columns, so the prompt does not
   *  grow a shape every time the goal model does. */
  guest_count: string | null;
  /** The VENDOR's own listing category. */
  vendor_category: string | null;
  /** The couple's own words, capped. */
  inquiry: string;
  /** The vendor's own saved packages: id + name ONLY. */
  packages: { id: number; name: string }[];
  language: AssistLanguage;
}

/** What `coerceAssistOutput` checks the model's answer against. */
export interface AssistContext {
  language: AssistLanguage;
  currency: Currency;
  /** THIS vendor's saved packages, by id. The only ids a suggestion may name. */
  packagesById: ReadonlyMap<number, ListingPackage>;
}

// ─── Gathering ──────────────────────────────────────────────────────────────

interface CoupleFactsRow {
  target_guest_count: number | null;
  guest_count_kind: string | null;
  target_guest_count_min: number | null;
  target_guest_count_max: number | null;
  partner_a_id: number;
}

/** Render the couple's guest goal as one phrase, or null when they never said.
 *  A range and a "to be decided" are both real answers and read differently to
 *  a vendor sizing a quote, so neither is flattened into a number. */
function renderGuestCount(row: CoupleFactsRow): string | null {
  const kind = row.guest_count_kind ?? "exact";
  if (kind === "range") {
    const min = row.target_guest_count_min;
    const max = row.target_guest_count_max;
    if (min !== null && max !== null) return `${min}-${max}`;
    if (min !== null) return `${min}+`;
    if (max !== null) return `up to ${max}`;
    return null;
  }
  if (kind === "tbd") return "not decided yet";
  return row.target_guest_count !== null ? String(row.target_guest_count) : null;
}

/** The couple's own words on this inquiry: their messages oldest first, with
 *  the legacy `notes` blob as the fallback for a thread that predates message
 *  rows. The VENDOR's replies are deliberately excluded — the assistant is
 *  summarising what was asked, and feeding the vendor their own prose back
 *  makes a longer prompt say less. */
function gatherInquiryText(booking: BookingRow): string {
  const fromCouple = listMessages(booking.id)
    .filter((m) => m.sender_kind === "couple")
    .map((m) => m.body.trim())
    .filter((b) => b.length > 0);
  const joined = fromCouple.length > 0 ? fromCouple.join("\n\n") : (booking.notes ?? "").trim();
  return joined.slice(0, ASSIST_INQUIRY_MAX_CHARS);
}

/** Assemble the five permitted facts. The ONLY place a field can enter the
 *  prompt — see the module header. */
export function gatherAssistFacts(
  booking: BookingRow,
  vendorAccountId: number,
): AssistFacts & { packageRows: ListingPackage[]; packageCurrency: Currency } {
  const couple = db
    .prepare(
      `SELECT target_guest_count, guest_count_kind, target_guest_count_min,
              target_guest_count_max, partner_a_id
         FROM couples WHERE id = ?`,
    )
    .get(booking.couple_id) as CoupleFactsRow | undefined;

  // Output language follows the COUPLE, since the draft is addressed to them.
  // `users.locale` is captured at signup; anything unknown falls to EN, like
  // the rest of the app.
  const localeRow = couple
    ? (db.prepare("SELECT locale FROM users WHERE id = ?").get(couple.partner_a_id) as
        | { locale: string | null }
        | undefined)
    : undefined;

  // The vendor's OWN listing, addressed by its own id — never `v<accountId>`,
  // which is a guess that is wrong for every claimed listing.
  const listing = getListingByVendorAccountId(vendorAccountId);
  const packageRows = listing ? listListingPackages(listing.id) : [];
  const account = db
    .prepare("SELECT country FROM vendor_accounts WHERE id = ?")
    .get(vendorAccountId) as { country: string | null } | undefined;

  return {
    event_date: booking.event_date,
    guest_count: couple ? renderGuestCount(couple) : null,
    vendor_category: listing?.category ?? null,
    inquiry: gatherInquiryText(booking),
    // NAMES ONLY. `price_text` is deliberately withheld from the model.
    packages: packageRows.map((p) => ({ id: p.id, name: p.name })),
    language: assistLanguageFor(localeRow?.locale ?? null),
    packageRows,
    packageCurrency: listingCurrency({
      country: account?.country,
      currency: listing?.currency_override,
    }),
  };
}

// ─── Prompting ──────────────────────────────────────────────────────────────

/** The stable instruction half. Written once per language so the per-call
 *  payload carries only facts. */
export function buildAssistSystem(language: AssistLanguage): string {
  return [
    "You are an assistant inside Weddly, a wedding marketplace. A wedding vendor",
    "has received one inquiry from a couple. Help the vendor answer it.",
    "",
    "Produce exactly three things:",
    "1. summary: two or three short lines covering the guest count, the date and",
    "   what the couple actually asked for.",
    `2. missing: up to ${ASSIST_MISSING_MAX} short phrases naming what the couple did NOT say and`,
    "   the vendor should ask about, for example a missing venue, a missing",
    "   budget, a missing ceremony time. Return an empty array when nothing",
    "   important is missing.",
    "3. draft_reply: a warm, concrete first reply that THE VENDOR will read, edit",
    "   and send themselves. Address the couple directly, answer what you can and",
    "   ask for what is missing. Do not sign it with anyone's name.",
    "",
    "Hard rules, no exceptions:",
    "- Never state a price, a fee, a rate, a discount, a deposit or a payment",
    "  term. You have not been told any of them and you must not guess one.",
    "- Never promise availability or confirm a date. Only the vendor knows that.",
    "- package_id: pick ONE id from the vendor's saved packages listed below, or",
    "  null when none of them fits or the list is empty. Never invent a package,",
    "  a package name or a package price, and never mention a price in",
    "  package_reason.",
    "- Invent no fact that is not in the message below. If something is unknown,",
    "  it belongs in missing, not in the summary or the reply.",
    `- Write every field in ${LANGUAGE_NAME[language]}.`,
  ].join("\n");
}

/** The per-call facts half. Read this function to know exactly what is sent. */
export function buildAssistPrompt(facts: AssistFacts): string {
  const lines: string[] = [];
  lines.push(`Event date: ${facts.event_date}`);
  lines.push(`Guest count: ${facts.guest_count ?? "not given"}`);
  lines.push(`Vendor category: ${facts.vendor_category ?? "not given"}`);
  if (facts.packages.length === 0) {
    lines.push("Vendor's saved packages: none saved.");
  } else {
    lines.push("Vendor's saved packages (choose at most one by id):");
    for (const p of facts.packages) lines.push(`- id ${p.id}: ${p.name}`);
  }
  lines.push("");
  lines.push("The couple's inquiry, verbatim:");
  lines.push('"""');
  lines.push(facts.inquiry.length > 0 ? facts.inquiry : "(the couple wrote no message)");
  lines.push('"""');
  return lines.join("\n");
}

// ─── Coercing the answer ────────────────────────────────────────────────────

function cleanString(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** Validate and re-ground the model's answer. THE trust boundary of this
 *  feature: after this function, nothing in the payload originated from the
 *  model except three prose fields, and the package name and price come from
 *  the vendor's own row. Returns null when the answer is not usable at all. */
export function coerceAssistOutput(raw: unknown, ctx: AssistContext): InquiryAssist | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const summary = cleanString(o.summary, ASSIST_SUMMARY_MAX_CHARS);
  const draft = cleanString(o.draft_reply, ASSIST_DRAFT_MAX_CHARS);
  // Two of the three jobs missing means there was no answer, not a partial one.
  if (summary.length === 0 || draft.length === 0) return null;

  const missing = (Array.isArray(o.missing) ? o.missing : [])
    .map((m) => cleanString(m, MISSING_ITEM_MAX_CHARS))
    .filter((m) => m.length > 0)
    .slice(0, ASSIST_MISSING_MAX);

  // A package id the vendor did not save is dropped, never repaired. Note the
  // Number() guard: a model that answers "3" as a string must not be able to
  // slip past an id check that only tested `typeof === 'number'`.
  let pkg: InquiryAssistPackage | null = null;
  const rawId = o.package_id;
  const id =
    typeof rawId === "number" || (typeof rawId === "string" && rawId.trim() !== "")
      ? Number(rawId)
      : Number.NaN;
  if (Number.isInteger(id)) {
    const row = ctx.packagesById.get(id);
    if (row) {
      pkg = {
        package_id: row.id,
        // Name and price come from the ROW. The model supplied neither, and
        // could not have: it was never shown a price at all.
        name: row.name,
        price_text: row.price_text,
        price_min: row.price_min,
        price_max: row.price_max,
        price_mode: row.price_mode,
        currency: ctx.currency,
        reason: cleanString(o.package_reason, PACKAGE_REASON_MAX_CHARS),
      };
    }
  }

  return {
    summary,
    missing,
    draft_reply: draft,
    package: pkg,
    no_packages: ctx.packagesById.size === 0,
    language: ctx.language,
  };
}

// ─── The one entry point ────────────────────────────────────────────────────

/** The deterministic AI_FAKE=1 stub. Shaped like a real answer so the E2E suite
 *  walks the whole route -> domain -> coerce pipeline: it names the FIRST saved
 *  package (or null when the vendor saved none), which is what lets a test
 *  prove a suggestion only ever points at a row that exists. The hallucinated-id
 *  case is covered directly against `coerceAssistOutput`, since a stub that
 *  lied about the id could not also serve the happy path. */
function fakeAssistAnswer(facts: AssistFacts): unknown {
  const first = facts.packages[0];
  return {
    summary: `[${facts.language}] ${facts.packages.length} package(s), ${facts.event_date}, ${
      facts.guest_count ?? "no guest count"
    }`,
    missing: ["no venue", "no budget"],
    draft_reply: `[${facts.language}] draft reply about ${facts.event_date}`,
    package_id: first ? first.id : null,
    package_reason: first ? `[${facts.language}] fits the date and the guest count` : null,
  };
}

/** Summarise, draft and suggest, for one inquiry the caller has already proved
 *  the vendor owns. NEVER throws for a model problem: an unreachable, refusing
 *  or nonsense answer comes back as `generated:false`, which the strip renders
 *  as nothing at all. */
export async function generateInquiryAssist(
  booking: BookingRow,
  vendorAccountId: number,
): Promise<InquiryAssistResult> {
  const { packageRows, packageCurrency, ...facts } = gatherAssistFacts(booking, vendorAccountId);
  const raw = await aiJson({
    system: buildAssistSystem(facts.language),
    user: buildAssistPrompt(facts),
    schema: ASSIST_SCHEMA,
    maxTokens: MAX_OUTPUT_TOKENS,
    fake: () => fakeAssistAnswer(facts),
  });
  const assist = coerceAssistOutput(raw, {
    language: facts.language,
    currency: packageCurrency,
    packagesById: new Map(packageRows.map((p) => [p.id, p])),
  });
  return assist ? { generated: true, assist } : { generated: false, assist: null };
}
