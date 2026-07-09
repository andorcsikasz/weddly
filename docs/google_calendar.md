# Google Calendar sync — operator setup

Weddly can push a couple's Timeline into their **own Google Calendar**: it creates
a dedicated secondary calendar ("Weddly – {names}") in the couple's Google account
and one-way syncs three things into it, keeping it up to date as the couple edits:

- **dated planning tasks** → all-day events on the due date,
- **the wedding day** → an all-day anchor event,
- **the day-of run sheet** (Programterv / `schedule_events`) → timed events.

The feature is **off until configured** (same "configured?" gate as Stripe /
DeepL / Google sign-in): with no OAuth secret set, `GET /api/google-calendar/status`
reports `configured: false` and the frontend hides the "Connect Google Calendar"
button entirely. Nothing else changes, so the app boots and runs fine without it.

## What it uses

- **OAuth client:** the existing GSI **Web** OAuth client (the one already behind
  `GOOGLE_CLIENT_ID` for sign-in) is reused as the `client_id`. It just needs a
  **client secret** and the calendar **redirect URI** registered.
- **Scope:** `https://www.googleapis.com/auth/calendar` (full calendar — needed to
  create the dedicated secondary calendar). This is a **sensitive** Google scope.
- **Redirect URI:** `${FRONTEND_BASE_URL}/api/google-calendar/callback`.
- **Tokens** are stored AES-256-GCM-encrypted at rest (key derived from
  `JWT_SECRET`), never in plaintext.

## One-time Google Cloud Console setup

1. **Enable the API.** In the Google Cloud project that owns your OAuth client:
   *APIs & Services → Library →* enable **Google Calendar API**.
2. **OAuth consent screen.** *APIs & Services → OAuth consent screen*:
   - Add the scope `https://www.googleapis.com/auth/calendar`.
   - While in **Testing** mode, add each Google account that will connect under
     **Test users** (max 100). Test users can connect immediately, no review.
   - For public production, submit the consent screen for **verification** (the
     sensitive-scope path: branding + a limited review — **not** the heavyweight
     third-party CASA security assessment that restricted scopes require).
3. **Credentials → the Web OAuth client** (reuse the sign-in one):
   - Under **Authorized redirect URIs**, add
     `https://YOUR_DOMAIN/api/google-calendar/callback`
     (e.g. `https://tryweddly.com/api/google-calendar/callback`).
   - Copy the client **secret**.
4. **Railway env.** Set:
   - `GOOGLE_CLIENT_SECRET` = the OAuth client secret from step 3.
   - (`GOOGLE_CLIENT_ID` and `FRONTEND_BASE_URL` are already set.)

That's it. On next boot `GOOGLE_CALENDAR_ENABLED` flips true, the status endpoint
reports `configured: true`, and the button appears on `/app/timeline`.

## How sync runs

- Connecting runs the OAuth code flow, creates the calendar, and pushes an initial
  set. After that, any edit to a task or run-sheet beat flags the couple `dirty`;
  a background worker (`domain/google_calendar_worker.ts`, ~30s) reconciles dirty
  couples, coalescing bursts (e.g. the timeline generator adding ~20 tasks at once
  becomes one diff). Couples can also hit **Sync now** for an immediate reconcile.
- **Disconnect** deletes the whole dedicated calendar from Google and revokes the
  token. The couple's data stays untouched in Weddly.

## Env reference

| Var                    | Required | Notes                                                        |
| ---------------------- | -------- | ------------------------------------------------------------ |
| `GOOGLE_CLIENT_ID`     | yes      | Shared with Google sign-in.                                  |
| `GOOGLE_CLIENT_SECRET` | yes      | OAuth client secret; empty = feature hidden.                 |
| `FRONTEND_BASE_URL`    | yes      | Used to build the redirect URI.                              |
| `GOOGLE_CALENDAR_FAKE` | no       | `1` in tests only — answers OAuth/API from an in-memory fake. Never set in prod. |

Covered by `backend/tests/api/google_calendar.e2e.test.ts` (runs on the fake).
