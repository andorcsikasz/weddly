// Tiny email sender. Uses Resend when RESEND_API_KEY is set; otherwise logs
// to stdout (matching the existing dev pattern documented in .env.example).

import { CONFIG } from "../config";
import { log } from "./logger";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** RFC 5322 From. Defaults to `CONFIG.emailFrom`; admin-console mail passes
   *  `CONFIG.emailFromAdmin` so a hand-written reply arrives from a mailbox a
   *  person actually reads. Resolved by `domain/emails/send.ts` — no caller
   *  outside the dispatcher picks a sender. */
  from?: string;
  /** Where a recipient hitting Reply lands. Defaults to `CONFIG.supportEmail`.
   *  Deliberately its OWN field rather than a `headers` entry — see
   *  `buildResendPayload`. */
  replyTo?: string;
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
// Reply-To is NOT here — it is a top-level Resend field, see below.
// Per-kind headers (e.g. List-Unsubscribe for lifecycle mail) override these
// only by adding entries — never by removing them.
function defaultHeaders(): Record<string, string> {
  return {
    "Auto-Submitted": "auto-generated",
    "X-Auto-Response-Suppress": "All",
  };
}

/** The exact JSON body sent to Resend. Split out of `dispatchToResend` so it
 *  can be asserted without a network call — the suite runs with no
 *  RESEND_API_KEY, so the real request never happens and nothing downstream
 *  of this function is otherwise observable.
 *
 *  `reply_to` is a TOP-LEVEL field and never a custom header. Resend owns the
 *  Reply-To of every message it sends and silently drops one passed through
 *  `headers`, which is how a footer reading "you can reply to this email and
 *  it reaches the Weddly team" sat for months under mail whose replies all
 *  went to `noreply@`: the header WAS set on our side, the log showed it, and
 *  nothing on the wire ever carried it. Reported 2026-07-31 by a couple who
 *  answered a hand-written support reply and got nowhere.
 *
 *  A caller that still puts a Reply-To in `headers` gets it promoted here
 *  rather than dropped, so the failure can't come back through a side door. */
export function buildResendPayload(input: SendEmailInput): Record<string, unknown> {
  const headers: Record<string, string> = {
    ...defaultHeaders(),
    ...(input.headers ?? {}),
  };
  // Header names are case-insensitive (RFC 5322 §1.2.2), so match that way.
  let headerReplyTo: string | undefined;
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "reply-to") {
      headerReplyTo = headers[key];
      delete headers[key];
    }
  }
  return {
    from: input.from ?? CONFIG.emailFrom,
    to: input.to,
    reply_to: input.replyTo ?? headerReplyTo ?? CONFIG.supportEmail,
    subject: input.subject,
    html: input.html,
    text: input.text,
    headers,
  };
}

// ── Sequential send queue ──────────────────────────────────────────────────
// Resend enforces a 5 req/s team rate limit. Lifecycle email sweeps can fire
// many sends in a tight loop — previously all went out simultaneously, causing
// 429s. This queue drains one request per RESEND_MIN_GAP_MS so we never
// exceed the limit regardless of how many sends are enqueued at once.
// Transactional and lifecycle sends share the same queue, so a signup burst
// can't crowd out a concurrent lifecycle sweep.
const RESEND_MIN_GAP_MS = 210; // ~4.7 req/s — stays under 5 with jitter headroom

interface QueueEntry {
  input: SendEmailInput;
  resolve: () => void;
  reject: (e: unknown) => void;
}

const sendQueue: QueueEntry[] = [];
let draining = false;

async function drainSendQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  while (sendQueue.length > 0) {
    const entry = sendQueue.shift()!;
    try {
      await dispatchToResend(entry.input);
      entry.resolve();
    } catch (e) {
      entry.reject(e);
    }
    if (sendQueue.length > 0) {
      await new Promise<void>((r) => setTimeout(r, RESEND_MIN_GAP_MS));
    }
  }
  draining = false;
}

async function dispatchToResend(input: SendEmailInput): Promise<void> {
  const payload = buildResendPayload(input);

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

export function sendEmail(input: SendEmailInput): Promise<void> {
  // Dev / test: no API key set — log immediately, skip the queue. Logging the
  // real payload (not a hand-assembled echo of it) is what makes the dev print
  // evidence of what production would send, Reply-To included.
  if (!CONFIG.resendApiKey) {
    const payload = buildResendPayload(input);
    log.info("mailer.dev_print", {
      from: payload.from,
      to: payload.to,
      reply_to: payload.reply_to,
      subject: input.subject,
      text: input.text,
      headers: payload.headers,
    });
    return Promise.resolve();
  }

  // Prod: enqueue so all sends go out sequentially at ≤5 req/s.
  return new Promise<void>((resolve, reject) => {
    sendQueue.push({ input, resolve, reject });
    void drainSendQueue();
  });
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
