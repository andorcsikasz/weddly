// "A user suggested you" planner invites.
//
// Cold outreach to wedding planners a Weddly user named, run from the admin
// Szervezők page: paste the list you were given, preview what was parsed, send.
// Each recipient gets a dormant planner account (the existing
// `provisionPlanner` path, 2-year comp, `verified_email=0, password_set=0`) plus
// one email whose CTA takes that account over in a single click.
//
// Why this is a paste-a-list tool and not a fifth campaign family: the audience
// is a handful of names somebody recommended, not a segment we can query. There
// is no pacing, no reminder and no schedule on purpose. If this ever grows into
// a repeatable cold-mail programme it belongs in domain/campaign_schedules.ts
// with the cooldown machinery, not here.
//
// Three rules this module exists to enforce:
//   1. A suppressed address never gets an account. `isOptedOut` is checked
//      BEFORE provisioning, not just before sending, so someone who told us to
//      stop doesn't end up with a row in `users` anyway.
//   2. One address, one account. An email that already belongs to anybody is
//      reported back as `existing` and skipped, never re-provisioned.
//   3. The opt-out link in the mail is a real erasure, not just a mute. It
//      retires the dormant account we created (see `retireInvitedPlanner`),
//      because that is exactly what the mail's data paragraph promises.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { PlannerInviteRow, PlannerInviteRowStatus } from "@shared/types";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { log } from "../lib/logger";
import { sendKind } from "./emails";
import { isOptedOut, normalizeEmail } from "./emails/optouts";
import { getPlannerSub } from "./planner_billing";
import { provisionPlanner } from "./planner_provisioning";
import { getUserByEmail } from "./users";

/** What the account is filed under in the admin list. Free text on the users
 *  row, so it just needs to read correctly in the planner's own language. */
const CATEGORY_LABEL: Record<"hu" | "en", string> = {
  hu: "esküvőszervező",
  en: "wedding planner",
};

// ── Parsing ─────────────────────────────────────────────────────────────────
//
// The input is whatever the admin had in front of them: a table copied out of
// Notion or Sheets (tab-separated), a three-lines-per-person column dump, or
// something typed by hand. So the parser does NOT trust line or column
// structure. It tokenises, classifies every token as email / phone / text, and
// treats each EMAIL as the anchor of one record: the nearest unused text before
// it is the name, the first phone after it (before the next email) is the
// phone. That survives a missing phone, a missing name, a header row, and a
// stray "–" placeholder, all of which appear in real pasted lists.

/** Header labels to drop, in every language the lists show up in. */
const HEADER_TOKENS = new Set([
  "név",
  "nev",
  "name",
  "teljes név",
  "email",
  "e-mail",
  "email cím",
  "e-mail cím",
  "email address",
  "telefon",
  "telefonszám",
  "phone",
  "phone number",
  "tel",
  "cég",
  "cégnév",
  "company",
  "business",
]);

/** Placeholders people type for "we don't have this": en/em dashes, a lone
 *  hyphen, "n/a". Treated as an absent field rather than a value. */
const BLANK_TOKENS = new Set(["-", "–", "—", "n/a", "na", "nincs", "none", "?"]);

type TokenKind = "email" | "phone" | "text";

function classify(token: string): TokenKind {
  if (token.includes("@")) return "email";
  const digits = token.replace(/\D/g, "");
  // A phone is mostly digits and punctuation. The 6-digit floor keeps a house
  // number or a year in a business name from being mistaken for one.
  if (digits.length >= 6 && /^[+()\d\s./-]+$/.test(token)) return "phone";
  return "text";
}

function cleanEmail(token: string): string | null {
  const stripped = token
    .trim()
    .replace(/^mailto:/i, "")
    .replace(/^[<([]+|[>)\]]+$/g, "")
    .trim();
  const email = normalizeEmail(stripped);
  // Deliberately loose: the batch is hand-checked in the preview step, and a
  // stricter regex rejects addresses that deliver fine.
  if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/** Split "Koncsár Andi (Szellő Lovastanya)" into person + business. With no
 *  parenthesis the single name plays both parts: half these lists are just a
 *  studio name, and greeting a studio by its own name reads fine. */
function splitName(raw: string): { fullName: string; businessName: string } {
  const m = raw.match(/^(.*?)\s*[([]([^)\]]+)[)\]]\s*$/);
  if (m?.[1] && m[2]) {
    return { fullName: m[1].trim(), businessName: m[2].trim() };
  }
  const trimmed = raw.trim();
  return { fullName: trimmed, businessName: trimmed };
}

/** Derive something addressable when a row has an email and nothing else:
 *  "hello@rekadanko.events" → "Rekadanko". Better than greeting a stranger with
 *  their own raw address. */
function nameFromEmail(email: string): string {
  const domain = email.split("@")[1] ?? "";
  const label = domain.split(".")[0] ?? "";
  if (!label) return email;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export interface ParsedPlannerInvite {
  email: string;
  fullName: string;
  businessName: string;
  phone: string | null;
}

/** Parse a pasted list into invite rows. Duplicate addresses collapse to the
 *  first occurrence: a list assembled from two sources repeats people, and
 *  mailing someone twice in one batch is the one mistake there's no undo for. */
export function parsePlannerInviteList(text: string): ParsedPlannerInvite[] {
  const tokens = text
    .split(/[\n\r\t|;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .filter((t) => !HEADER_TOKENS.has(t.toLowerCase()))
    .filter((t) => !BLANK_TOKENS.has(t.toLowerCase()));

  const out: ParsedPlannerInvite[] = [];
  const seen = new Set<string>();
  let pendingName: string | null = null;

  for (const token of tokens) {
    const kind = classify(token);
    if (kind === "text") {
      // Keep the LAST text before the email. A two-line "Business / Contact
      // person" preamble should greet the person, not the business.
      pendingName = token;
      continue;
    }
    if (kind === "phone") {
      // Trailing phone belongs to the record we just opened. A phone with no
      // record before it is noise from a header or a stray column.
      const last = out[out.length - 1];
      if (last && !last.phone) last.phone = token.replace(/\s+/g, " ").trim();
      continue;
    }
    const email = cleanEmail(token);
    if (!email) continue;
    if (seen.has(email)) {
      pendingName = null;
      continue;
    }
    seen.add(email);
    const { fullName, businessName } = pendingName
      ? splitName(pendingName)
      : { fullName: nameFromEmail(email), businessName: nameFromEmail(email) };
    out.push({ email, fullName, businessName, phone: null });
    pendingName = null;
  }

  return out;
}

/** Hungarian phone or a .hu address means the planner works in Hungarian.
 *  Everything else falls back to English, which is the platform default. */
export function guessInviteLocale(row: ParsedPlannerInvite): "hu" | "en" {
  const phone = (row.phone ?? "").replace(/\s+/g, "");
  if (phone.startsWith("+36") || phone.startsWith("06") || phone.startsWith("0036")) return "hu";
  if (row.email.endsWith(".hu")) return "hu";
  return "en";
}

// ── Opt-out token ───────────────────────────────────────────────────────────
//
// Keyed by user id rather than a campaign send row (there is no sends table
// here). Same signed `<id>.<hmac>` shape the campaign tokens use, with its own
// purpose string so a token minted here can't be replayed against them.

function signInvite(userId: number): string {
  return createHmac("sha256", CONFIG.jwtSecret)
    .update(`planner_invite_optout:${userId}`)
    .digest("hex")
    .slice(0, 32);
}

export function makePlannerInviteOptOutToken(userId: number): string {
  return `${userId}.${signInvite(userId)}`;
}

export function verifyPlannerInviteOptOutToken(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [rawId, sig] = parts as [string, string];
  const userId = Number.parseInt(rawId, 10);
  if (!Number.isFinite(userId) || userId <= 0) return null;
  const expected = signInvite(userId);
  try {
    if (!timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null;
  } catch {
    return null;
  }
  return userId;
}

/**
 * Honour "take me off the list" for an invited planner: suppress the address
 * and, when the account is still the dormant one we opened for them, wipe it.
 *
 * Scrubbed in place rather than DELETEd, for the same reason `purgeOneUser`
 * does it: `audit_log` is append-only and foreign keys are ON. Nothing is sent
 * here either, unlike `purgeOneUser`, whose "your account is gone" notice would
 * be a second unwanted mail to someone who just asked us to stop.
 *
 * An ACTIVATED account is left alone: the planner set a password and is using
 * it, so deleting the workspace behind an unsubscribe click would be
 * destructive. They keep the account, and the suppression stops the mail.
 * Returns the email that was suppressed, or null for an unknown user.
 */
export function retireInvitedPlanner(userId: number): string | null {
  const user = db
    .prepare("SELECT id, email, password_set, verified_email, user_type FROM users WHERE id = ?")
    .get(userId) as
    | {
        id: number;
        email: string;
        password_set: number | null;
        verified_email: number | null;
        user_type: string | null;
      }
    | undefined;
  if (!user) return null;
  if (user.email.endsWith("@purged.local")) return null;

  const email = user.email;
  const dormant = user.user_type === "planner" && !user.password_set && !user.verified_email;
  if (!dormant) return email;

  const ts = now();
  db.transaction(() => {
    db.prepare("DELETE FROM planner_activation_tokens WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM planner_subscriptions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM email_preferences WHERE user_id = ?").run(userId);
    db.prepare(
      `UPDATE users SET email = 'deleted-' || id || '@purged.local',
                        password_hash = '!purged!',
                        full_name = 'Purged user',
                        business_name = NULL,
                        planner_phone = NULL,
                        planner_category = NULL,
                        status = 'suspended',
                        updated_at = ?
         WHERE id = ?`,
    ).run(ts, userId);
  })();
  return email;
}

// ── Sending ─────────────────────────────────────────────────────────────────

function guestUntilLabel(untilMs: number, locale: "hu" | "en"): string {
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(untilMs));
}

export interface InviteOutcome {
  status: PlannerInviteRowStatus;
  userId: number | null;
  error: string | null;
}

/** Provision one dormant planner account and send the take-over invite. Never
 *  throws: one bad address must not abort the rest of the batch. */
export async function inviteSuggestedPlanner(
  row: ParsedPlannerInvite,
  locale: "hu" | "en",
): Promise<InviteOutcome> {
  const email = normalizeEmail(row.email);
  if (isOptedOut(email)) return { status: "opted_out", userId: null, error: null };
  if (getUserByEmail(email)) return { status: "existing", userId: null, error: null };

  let userId: number;
  let token: string;
  try {
    const provisioned = await provisionPlanner({
      email,
      fullName: row.fullName,
      businessName: row.businessName,
      category: CATEGORY_LABEL[locale],
      locale,
      phone: row.phone,
    });
    userId = provisioned.userId;
    token = provisioned.token;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.warn("planner_invite.provision_failed", { email, error: message });
    return { status: "failed", userId: null, error: message };
  }

  const sub = getPlannerSub(userId);
  const result = await sendKind(
    "planner_suggested_invite",
    {
      plannerName: row.fullName,
      businessName: row.businessName,
      activateUrl: `${CONFIG.frontendBaseUrl}/planner/activate/${token}`,
      guestUntil: guestUntilLabel(sub?.founding_until ?? now(), locale),
      locale,
    },
    {
      user: { id: userId, email, full_name: row.fullName },
      outreachUnsubscribeUrl: `${CONFIG.frontendBaseUrl}/planner-optout/${makePlannerInviteOptOutToken(userId)}`,
    },
  );

  // `skipped_no_provider` is the dev/test path (no RESEND_API_KEY). Counted as
  // sent so a local run exercises the whole funnel, matching every other sweep
  // in this codebase.
  if (result.status === "sent" || result.status === "skipped_no_provider") {
    return { status: "sent", userId, error: null };
  }
  if (result.status === "skipped_opt_out") {
    return { status: "opted_out", userId, error: null };
  }
  return { status: "failed", userId, error: result.error ?? "send failed" };
}

/** Run a whole pasted list. `dryRun` parses and classifies without creating or
 *  sending anything, which is what the admin previews before committing. */
export async function runPlannerInviteBatch(
  text: string,
  opts: { dryRun: boolean; locale?: "hu" | "en" | null },
): Promise<PlannerInviteRow[]> {
  const parsed = parsePlannerInviteList(text);
  const rows: PlannerInviteRow[] = [];

  for (const row of parsed) {
    const locale = opts.locale ?? guessInviteLocale(row);
    const base = {
      email: row.email,
      full_name: row.fullName,
      business_name: row.businessName,
      phone: row.phone,
      locale,
    };
    if (opts.dryRun) {
      const status: PlannerInviteRowStatus = isOptedOut(row.email)
        ? "opted_out"
        : getUserByEmail(normalizeEmail(row.email))
          ? "existing"
          : "ready";
      rows.push({ ...base, status, user_id: null, error: null });
      continue;
    }
    const outcome = await inviteSuggestedPlanner(row, locale);
    rows.push({
      ...base,
      status: outcome.status,
      user_id: outcome.userId,
      error: outcome.error,
    });
  }

  return rows;
}
