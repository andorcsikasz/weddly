// Tiny email sender. Uses Resend when RESEND_API_KEY is set; otherwise logs
// to stdout (matching the existing dev pattern documented in .env.example).

import { CONFIG } from "../config";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  if (!CONFIG.resendApiKey) {
    console.log(
      `[mailer:dev] To: ${input.to}\n  Subject: ${input.subject}\n  Text:\n${input.text.replace(/^/gm, "    ")}`,
    );
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CONFIG.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: CONFIG.emailFrom,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[mailer] Resend failed status=${res.status} body=${detail.slice(0, 500)}`);
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
