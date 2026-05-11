// Public anonymous feedback form. All fields optional, but the request
// must carry at least one of: message / rating / monthly_value_ft.
// Submissions are emailed to the feedback inbox; no DB row is written,
// so this stays a thin pipe — easy to re-route later by changing the
// recipient or swapping in a queue.

import { CONFIG } from "../config";
import { sendEmail } from "../lib/mailer";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

/** Inbox feedback is forwarded to. Hard-coded during the beta — flip to
 *  a CONFIG env var if/when this needs to vary per environment. */
const FEEDBACK_RECIPIENT = "test.andorcsikasz@gmail.com";

interface SubmitBody {
  message?: unknown;
  rating?: unknown;
  monthly_value_ft?: unknown;
  from_email?: unknown;
  /** "hu" | "en" — captured so the team can see what language the visitor
   *  was reading the page in when they submitted. */
  locale?: unknown;
}

function trimStr(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  if (s.length > maxLen) throw new HttpError(400, `Field too long (max ${maxLen})`);
  return s;
}

function intInRange(v: unknown, lo: number, hi: number, field: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `${field} must be a number`);
  const rounded = Math.round(n);
  if (rounded < lo || rounded > hi) {
    throw new HttpError(400, `${field} must be between ${lo} and ${hi}`);
  }
  return rounded;
}

function isValidEmail(s: string): boolean {
  if (s.length > 200) return false;
  const at = s.indexOf("@");
  return at >= 1 && s.indexOf(".", at) !== -1;
}

async function handleSubmit(ctx: Ctx): Promise<Response> {
  // Anon endpoint — IP-bucket. 10 submissions per hour per IP. Higher
  // than the vendor-waitlist limit because feedback is naturally
  // bursty (someone might fire off two or three thoughts in a session).
  rateLimit(ctx.clientIp, "feedback", { capacity: 10, refillRate: 1 / 360 });

  const body = await readJson<SubmitBody>(ctx.req);

  const message = trimStr(body.message, 2000);
  const rating = intInRange(body.rating, 1, 10, "rating");
  const monthlyValue = intInRange(body.monthly_value_ft, 0, 15000, "monthly_value_ft");
  const fromEmailRaw = trimStr(body.from_email, 200);
  const fromEmail = fromEmailRaw?.toLowerCase() ?? null;
  if (fromEmail && !isValidEmail(fromEmail)) {
    throw new HttpError(400, "from_email is not valid");
  }
  const locale = trimStr(body.locale, 8);

  if (!message && rating === null && monthlyValue === null) {
    throw new HttpError(400, "Feedback is empty — provide message, rating or monthly_value_ft");
  }

  // Compose the email. Bilingual structure isn't necessary (this is
  // forwarded to the team, not the user), so we lay it out as a simple
  // labelled block — plain text and a minimal HTML body for clients
  // that prefer it.
  const lines: string[] = ["Új visszajelzés érkezett a Weddly landingről."];
  if (rating !== null) lines.push(`Értékelés (1–10): ${rating}`);
  if (monthlyValue !== null) lines.push(`Havi érték (Ft): ${monthlyValue.toLocaleString("hu")}`);
  if (message) lines.push("", "Üzenet:", message);
  if (fromEmail) lines.push("", `Válasz e-mail: ${fromEmail}`);
  if (locale) lines.push("", `Felhasználó nyelve: ${locale}`);
  const text = lines.join("\n");
  const html = `<pre style="font:14px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;white-space:pre-wrap;">${text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")}</pre>`;

  // Fire-and-forget — the visitor doesn't need to wait for the SMTP
  // round-trip, and a transient mailer hiccup shouldn't return a 500
  // that makes them retype their message.
  void sendEmail({
    to: FEEDBACK_RECIPIENT,
    subject: "Weddly · visszajelzés",
    text,
    html,
  }).catch(() => {
    // Logged inside sendEmail; nothing to do here.
  });

  return json({ ok: true });
}

export function registerFeedbackRoutes(router: Router) {
  router.post("/api/feedback", handleSubmit);
}

// Silences "unused import" when CONFIG isn't directly referenced — kept
// so the recipient is easy to wire through a config var later.
void CONFIG;
