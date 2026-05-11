// Email preferences. The unsubscribe endpoint is intentionally one-click —
// a GET-with-token flips the flag and renders a tiny HTML confirmation. RFC
// 8058 ("List-Unsubscribe-Post") expects this to work without auth, since
// the recipient is identified by the opaque token.
//
// The `account/preferences` page (GET + POST) is for logged-in users to
// flip their lifecycle opt-out toggle from the dashboard.

import { ensurePreferences, getPreferencesByToken, setLifecycleOptOut } from "../domain/emails";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

interface UpdateBody {
  lifecycle_opt_out?: unknown;
}

function handleUnsubscribe(ctx: Ctx): Response {
  const token = ctx.params.token;
  if (!token) throw new HttpError(400, "Missing token");
  const prefs = getPreferencesByToken(token);
  if (!prefs) {
    return new Response(unsubscribeHtml(false), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  setLifecycleOptOut(prefs.user_id, true);
  return new Response(unsubscribeHtml(true), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function handleGetPrefs(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const prefs = ensurePreferences(userId);
  return json({
    lifecycle_opt_out: Boolean(prefs.lifecycle_opt_out),
    unsubscribe_token: prefs.unsubscribe_token,
  });
}

async function handleUpdatePrefs(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  ensurePreferences(userId);
  const body = await readJson<UpdateBody>(ctx.req);
  if (typeof body.lifecycle_opt_out !== "boolean") {
    throw new HttpError(400, "lifecycle_opt_out must be boolean");
  }
  setLifecycleOptOut(userId, body.lifecycle_opt_out);
  return json({ ok: true, lifecycle_opt_out: body.lifecycle_opt_out });
}

/** Tiny static HTML response — no SPA bootstrap needed. We escape nothing
 *  since there's no user input rendered into the body. */
function unsubscribeHtml(success: boolean): string {
  const title = success ? "Leiratkozva / Unsubscribed" : "Érvénytelen link / Invalid link";
  const body = success
    ? `<p>Sikeresen leiratkoztál a Weddly emlékeztetőiről.</p>
       <p style="color:#6e6863;">You've been unsubscribed from Weddly's reminder emails. We'll still send account-critical mail (verification, password reset, RSVP) as needed.</p>
       <p style="color:#6e6863;">Meggondoltad magad? A Weddly fiókodban a Beállítások &gt; Email preferenciák alatt visszakapcsolhatod. / Changed your mind? Re-enable from Settings &gt; Email preferences.</p>`
    : `<p>Ez a link már nem érvényes.</p>
       <p style="color:#6e6863;">This unsubscribe link is no longer valid. If you keep getting unwanted email, contact us — we'll fix it manually.</p>`;
  return `<!doctype html>
<html lang="hu"><head><meta charset="utf-8" /><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body{margin:0;padding:32px 16px;background:#faf7f2;color:#1f1d1b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}
  .card{max-width:560px;margin:0 auto;background:#fff;border-radius:14px;padding:32px;box-shadow:0 1px 2px rgba(31,29,27,0.04),0 4px 18px rgba(31,29,27,0.06);}
  h1{font-family:Georgia,'Times New Roman',serif;font-size:22px;margin:0 0 18px 0;}
  p{font-size:15px;line-height:1.55;margin:0 0 12px 0;}
  a{color:#7c5a3e;}
</style>
</head><body><div class="card"><h1>${title}</h1>${body}<p style="margin-top:24px;font-size:13px;color:#6e6863;">— Weddly</p></div></body></html>`;
}

/** RFC 8058 one-click unsubscribe. Gmail/Outlook bots POST to the
 *  List-Unsubscribe URL with `List-Unsubscribe=One-Click` in the body;
 *  they don't render the GET-confirmation HTML. We flip the flag and
 *  return 204 No Content so the bot doesn't trip on unparsable bodies. */
function handleUnsubscribePost(ctx: Ctx): Response {
  const token = ctx.params.token;
  if (!token) throw new HttpError(400, "Missing token");
  const prefs = getPreferencesByToken(token);
  if (!prefs) {
    // Spec says: invalid tokens should still 2xx — never feed the bot a 4xx.
    return new Response(null, { status: 204 });
  }
  setLifecycleOptOut(prefs.user_id, true);
  return new Response(null, { status: 204 });
}

export function registerEmailPrefsRoutes(router: Router) {
  // Public — token-authenticated, one-click.
  router.get("/api/unsubscribe/:token", handleUnsubscribe);
  // RFC 8058: Gmail/Outlook bot POSTs the same URL when the header is honored.
  router.post("/api/unsubscribe/:token", handleUnsubscribePost);
  // Logged-in dashboard prefs.
  router.get("/api/account/email-preferences", handleGetPrefs, true);
  router.post("/api/account/email-preferences", handleUpdatePrefs, true);
}
