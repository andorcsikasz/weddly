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

## Vendors (the same integration, second aggregate)

Vendors get the identical opt-in flow on `/vendor/calendar`, pushing their Weddly
calendar into a `Weddly – {business name}` calendar in their Google account.

**No extra operator setup.** Same OAuth client, same scope, and crucially the
**same redirect URI** — both flows share `/api/google-calendar/callback`, which
dispatches on a `kind` baked into the *signed* OAuth state. Nothing to add in the
Google Cloud Console beyond what the couple flow already needed.

What gets pushed, and how it reads in Google:

| Weddly                        | Google event                        |
| ----------------------------- | ----------------------------------- |
| Confirmed wedding             | all-day, **busy**                   |
| Pending inquiry               | all-day, **free** (not a commitment)|
| Blocked day (whole)           | all-day, **busy**                   |
| Blocked day (partial hours)   | **timed** event over the range, busy|
| Open task with a due date     | all-day, **free**                   |

Two deliberate choices worth knowing:

- **A partial block becomes a timed event**, not an all-day one, because a
  partial block leaves the day bookable in Weddly — an all-day event would
  misrepresent the vendor's availability to anyone reading their free/busy.
- **Pending inquiries are transparent.** A request is not a booking, so it must
  not make the vendor look busy.

**PRO-gated.** The availability calendar is itself a PRO feature, so `/connect`
403s for a FREE vendor. If a connected vendor later lapses, nothing is destroyed:
the connection and the Google calendar survive, sync just parks with
`last_error='pro_required'` until they upgrade.

**Strictly one-way.** Google is never read back, so nothing in a vendor's personal
calendar can change the availability couples see. A pull direction was considered
and rejected: it needs incremental-sync/`syncToken` machinery that doesn't exist
here, and a dentist appointment would otherwise mark a wedding date unavailable.

(That paragraph describes the original vendor push. The pull direction shipped in
2026-07 and is free/busy only; see the CLAUDE.md bullet for the current rules.)

## OAuth verification (going past 100 users)

`https://www.googleapis.com/auth/calendar` is a **sensitive** scope, so the app
has to be verified before it works for the public. Two facts decide the
sequencing, and both surprise people:

- **You cannot submit while the app is in Testing.** Verification is submitted
  from the Verification Center, which only exists once the app is published to
  production. Publishing is therefore not a separate later step, it is the first
  one.
- **In Testing every refresh token expires after 7 days.** A connection made on
  Monday is dead the following Monday, which is why the pilot cannot simply sit
  in Testing while the review runs. The app now says so out loud rather than
  showing a green tick over a dead sync (`needsReconnect`), but a vendor
  reconnecting weekly is exactly the chore this feature exists to remove.

So: publish, submit, and accept the "Google hasn't verified this app" screen for
the length of the review. Keep the pilot small while it stands.

### The demo video

The reviewer wants to see, on the **production** URL: how a user reaches the
consent screen, which scopes it asks for, what the app then does with the data,
and that the user can take it back. Two to three minutes, screen recording, no
cuts inside the flow. Anything recording the screen is fine (macOS `Cmd+Shift+5`
writes a `.mov` with no install; upload as an unlisted YouTube video and paste
the link into the form).

Set up before recording:

1. **Switch the UI to English.** Reviewers read English; the locale switcher is
   in the footer and persists to `localStorage`.
2. **Use the demo vendor, never a real one.** `/vendors` → "Try the demo" seeds
   a Shrek-themed cake studio whose client couples are all `is_demo = 1`
   fairy-tale names. A real vendor's calendar carries real couples' names, and
   this video goes on YouTube. The demo account is also seeded as entitled, which
   matters: `/connect` 403s for a FREE vendor, so a non-PRO account cannot even
   reach the consent screen.
3. **Use a Google account that is a test user** (Audience page) if you record
   before publishing; after publishing, any account works and simply shows the
   unverified warning, which is fine to leave in the video.
4. **Keep the URL bar visible in every frame.** It is how the reviewer confirms
   this is the production app and not localhost. Quit anything that pops
   notifications.

Shot list:

| # | What happens | What must be on screen |
| - | ------------ | ---------------------- |
| 1 | Land on `tryweddly.com/vendors`, click the demo launcher, arrive in the vendor portal | The domain in the URL bar |
| 2 | Go to Settings → Schedule (`/vendor/settings/schedule`) | The "Google Calendar" card and its one-line explanation of what the sync does |
| 3 | Click "Connect Google Calendar", pick the account | Google's own consent screen, the app name, and the calendar permission being requested |
| 4 | Land back in Weddly | The pill now reads connected, with the Google address under it |
| 5 | Open Google Calendar in a new tab | The separate "Weddly – …" calendar, holding the demo bookings and blocked days. Say out loud (or caption) that Weddly writes only into this calendar |
| 6 | Back in Weddly, tick "Respect the busy time in my Google Calendar" and pick a calendar | The line stating free/busy only. This is the justification for reading, and the one reviewers probe |
| 7 | Show a day the pull marked busy | That Weddly shows the day as taken with **no title, no place, no attendee**, which is what "free/busy only" means in practice |
| 8 | Open the menu → Disconnect, confirm | The calendar disappearing from the Google account afterwards |

Steps 6 to 8 are the ones that decide the review. They are the visual proof of
the two claims the privacy policy makes: that the read half sees times and
nothing else, and that the user can revoke it. Step 5 is what justifies asking
for a scope that can create a calendar rather than only edit events.

The matching privacy text lives at `/privacy` under "Google account data"
(`privacy.google_data_*`). Reviewers open that URL, so it must be deployed
before submitting, not after.

## Env reference

| Var                    | Required | Notes                                                        |
| ---------------------- | -------- | ------------------------------------------------------------ |
| `GOOGLE_CLIENT_ID`     | yes      | Shared with Google sign-in.                                  |
| `GOOGLE_CLIENT_SECRET` | yes      | OAuth client secret; empty = feature hidden.                 |
| `FRONTEND_BASE_URL`    | yes      | Used to build the redirect URI.                              |
| `GOOGLE_CALENDAR_FAKE` | no       | `1` in tests only — answers OAuth/API from an in-memory fake. Never set in prod. |

Covered by `backend/tests/api/google_calendar.e2e.test.ts` (couples) and
`backend/tests/api/vendor_google_calendar.e2e.test.ts` (vendors), both on the fake.
