// Email open-tracking endpoint.
//
//   GET /api/emails/track/open?t=<token>
//
// Returns a 1×1 transparent GIF and stamps `invitation_opened_at` on the
// matching guest row (once — subsequent loads are no-ops). The token is an
// HMAC-signed `guestId.coupleId` pair so it can't be forged. No auth cookie
// required — the image loads from within the email client.
//
// Caveats callers should know about:
//   • Apple Mail Privacy Protection pre-fetches every image in 2021+ clients,
//     so "opened" may fire as soon as Mail downloads the message, not when the
//     human reads it.
//   • Gmail and Outlook.com proxy images through their own CDNs, which means
//     the IP is always Google/Microsoft, not the guest's.
//   • Some clients (ProtonMail, plain-text-only configs) block remote images
//     entirely — the pixel never fires for those recipients.

import { createHmac, timingSafeEqual } from "node:crypto";
import { CONFIG } from "../config";
import { db, now } from "../db";
import type { Router } from "../lib/http";

// 1×1 transparent GIF (43 bytes, canonical minimum).
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

function sign(guestId: number, coupleId: number): string {
  return createHmac("sha256", CONFIG.jwtSecret)
    .update(`${guestId}.${coupleId}`)
    .digest("hex")
    .slice(0, 32);
}

export function makeOpenTrackingToken(guestId: number, coupleId: number): string {
  return `${guestId}.${coupleId}.${sign(guestId, coupleId)}`;
}

function verifyOpenTrackingToken(token: string): { guestId: number; coupleId: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [rawGuest, rawCouple, sig] = parts as [string, string, string];
  const guestId = parseInt(rawGuest, 10);
  const coupleId = parseInt(rawCouple, 10);
  if (!Number.isFinite(guestId) || !Number.isFinite(coupleId)) return null;
  const expected = sign(guestId, coupleId);
  try {
    if (!timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null;
  } catch {
    return null;
  }
  return { guestId, coupleId };
}

export function registerEmailTrackRoutes(router: Router): void {
  router.get("/api/emails/track/open", (ctx) => {
    const t = ctx.url.searchParams.get("t") ?? "";
    const parsed = verifyOpenTrackingToken(t);
    if (parsed) {
      const { guestId, coupleId } = parsed;
      db.prepare(
        `UPDATE guests
            SET invitation_opened_at = COALESCE(invitation_opened_at, ?)
          WHERE id = ? AND couple_id = ? AND invited_at IS NOT NULL`,
      ).run(now(), guestId, coupleId);
    }
    return new Response(PIXEL, {
      status: 200,
      headers: {
        "Content-Type": "image/gif",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    });
  });
}
