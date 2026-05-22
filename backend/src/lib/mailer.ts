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

// Headers attached to every outgoing message:
//   - `Auto-Submitted: auto-generated` — RFC 3834. Tells vacation auto-
//     responders, ticket systems, and Exchange "do not auto-reply to this".
//     Without it, every verification email risks bouncing back via OOO replies.
//   - `X-Auto-Response-Suppress: All` — Outlook/Exchange equivalent. Belt-and-
//     braces; some Microsoft tenants honour this and ignore Auto-Submitted.
// Per-kind headers (e.g. List-Unsubscribe for lifecycle mail) override these
// only by adding entries — never by removing them.
const DEFAULT_HEADERS: Record<string, string> = {
  "Auto-Submitted": "auto-generated",
  "X-Auto-Response-Suppress": "All",
};

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const mergedHeaders: Record<string, string> = {
    ...DEFAULT_HEADERS,
    ...(input.headers ?? {}),
  };

  if (!CONFIG.resendApiKey) {
    log.info("mailer.dev_print", {
      to: input.to,
      subject: input.subject,
      text: input.text,
      headers: mergedHeaders,
    });
    return;
  }

  const payload: Record<string, unknown> = {
    from: CONFIG.emailFrom,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    headers: mergedHeaders,
  };

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
