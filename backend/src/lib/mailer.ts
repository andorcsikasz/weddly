// Tiny email sender. Uses Resend when RESEND_API_KEY is set; otherwise logs
// to stdout (matching the existing dev pattern documented in .env.example).

import { CONFIG } from "../config";
import { log } from "./logger";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Extra RFC 5322 headers to attach to the outgoing message. Used to
   *  carry `List-Unsubscribe` / `List-Unsubscribe-Post` for RFC 8058
   *  one-click unsubscribe — required by Gmail's 2024 bulk-sender rules
   *  once volume picks up. */
  headers?: Record<string, string>;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  if (!CONFIG.resendApiKey) {
    log.info("mailer.dev_print", {
      to: input.to,
      subject: input.subject,
      text: input.text,
      headers: input.headers,
    });
    return;
  }

  const payload: Record<string, unknown> = {
    from: CONFIG.emailFrom,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  };
  if (input.headers && Object.keys(input.headers).length > 0) {
    payload.headers = input.headers;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CONFIG.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    log.error("mailer.resend_failed", {
      status: res.status,
      body: detail.slice(0, 500),
      to: input.to,
    });
    throw new Error(`Email send failed: ${res.status}`);
  }
}

// Bilingual email body: HU hero (default locale) + compact EN block underneath.
// Per CLAUDE.md: never persist per-user locale; bilingual is the safer fallback.
export function bilingualBody(opts: {
  hu: { greeting: string; body: string; cta: string };
  en: { greeting: string; body: string; cta: string };
  ctaUrl: string;
}): { html: string; text: string } {
  const { hu, en, ctaUrl } = opts;
  const text = [
    hu.greeting,
    "",
    hu.body,
    "",
    `${hu.cta}: ${ctaUrl}`,
    "",
    "— — —",
    "",
    en.greeting,
    "",
    en.body,
    "",
    `${en.cta}: ${ctaUrl}`,
  ].join("\n");
  const html = `
<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#111;">
  <p>${escapeHtml(hu.greeting)}</p>
  <p>${escapeHtml(hu.body)}</p>
  <p><a href="${escapeAttr(ctaUrl)}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;">${escapeHtml(hu.cta)}</a></p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
  <p style="color:#666;font-size:14px;">${escapeHtml(en.greeting)}</p>
  <p style="color:#666;font-size:14px;">${escapeHtml(en.body)}</p>
  <p style="color:#666;font-size:14px;"><a href="${escapeAttr(ctaUrl)}" style="color:#111;">${escapeHtml(en.cta)}</a></p>
</div>`.trim();
  return { html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}

// Resend liveness probe for /api/health/deep. Hits the cheap api-keys list
// endpoint with a 30s memo so the deep health endpoint can be called every
// few minutes without burning Resend rate limits. Returns "skipped" when
// RESEND_API_KEY is unset (matches the dev pattern where mail goes to stdout).
export interface ResendLiveness {
  ok: boolean;
  ms?: number;
  reason?: string;
  skipped?: boolean;
}

const PROBE_TTL_MS = 30_000;
let lastProbe: { at: number; result: ResendLiveness } | null = null;

export async function checkResendLiveness(): Promise<ResendLiveness> {
  if (!CONFIG.resendApiKey) {
    return { ok: true, skipped: true, reason: "RESEND_API_KEY unset" };
  }
  const nowMs = Date.now();
  if (lastProbe && nowMs - lastProbe.at < PROBE_TTL_MS) return lastProbe.result;

  const start = performance.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch("https://api.resend.com/api-keys", {
      headers: { Authorization: `Bearer ${CONFIG.resendApiKey}` },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const ms = Math.round(performance.now() - start);
    let result: ResendLiveness;
    if (res.ok) {
      result = { ok: true, ms };
    } else if (res.status === 401) {
      // Send-only "restricted" keys (the security-correct production posture)
      // can't list api-keys but ARE valid for /emails. Resend's response body
      // disambiguates: `name: "restricted_api_key"` = good auth, scope-limited;
      // anything else = the key is actually bad (revoked / wrong / missing).
      const body = await res.text().catch(() => "");
      if (body.includes('"restricted_api_key"')) {
        result = { ok: true, ms, reason: "send-only key (verified)" };
      } else {
        result = { ok: false, ms, reason: `HTTP 401 ${body.slice(0, 120)}` };
      }
    } else {
      result = { ok: false, ms, reason: `HTTP ${res.status}` };
    }
    lastProbe = { at: nowMs, result };
    return result;
  } catch (e) {
    const ms = Math.round(performance.now() - start);
    const reason = e instanceof Error ? e.message : "unknown";
    const result: ResendLiveness = { ok: false, ms, reason };
    lastProbe = { at: nowMs, result };
    return result;
  }
}
