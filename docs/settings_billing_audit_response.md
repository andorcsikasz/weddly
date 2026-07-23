# Settings / Billing audit — corrected response

A UI-only walkthrough of the couple **Profil** area (Fiók · Munkaterület ·
Tervezés · Előfizetés · Adatok) produced a list of billing/settings gaps. This
doc reconciles that audit against the **actual code** and records what changed.

**Headline:** the audit's top-priority items were largely already shipped. The
review was done on a **trialing/founding** account, where the manage-billing
surface is intentionally hidden (there is no Stripe customer to manage yet), so
several existing capabilities read as "missing."

Source of truth in code:
- `frontend/src/pages/BillingSettings.tsx` — the Előfizetés tab.
- `backend/src/routes/billing.ts` — status, checkout, **portal**, payment-method, webhook.
- Architecture rule (CLAUDE.md): *payment UI is 100% Stripe-hosted (Checkout +
  Billing Portal), no card fields in-app, no `@stripe/*` frontend deps.*

## Audit item → actual status

| # | Audit item | Reality | Where |
|---|------------|---------|-------|
| 1 | Payment method visibility + safe replace/delete | **Mostly already shipped.** The "Kezelés / Manage" button opens the **Stripe Billing Portal**, where the card is viewed, replaced, and removed — Stripe itself blocks detaching the only card on an active sub (the exact guard the audit describes). Now **also** shown read-only in-app (this pass). | `BillingSettings.tsx` Manage button; `POST /api/billing/portal`; card-on-file added `1ecc1372` |
| 2 | Subscription status + next billing date in-app | **Already shipped.** Plan label (trialing/founding/active/past_due/canceled) + a status line with the next-charge date (`current_period_end`) or a past-due message. | `BillingSettings.tsx` `PLAN_LABEL_KEY`, `statusLine` |
| 3 | Invoice / receipt history | **Already available** in the Billing Portal (Stripe supplies it). No in-app duplicate needed. | Portal |
| 4 | Kiosk toggle dependency hint | **Fixed this pass.** The no-slug notice existed but pointed at the wrong place; it now links straight to where the couple code (URL slug) is set. Toggle was never actually disabled. | `ProfilePage.tsx` welcome-desk card, `f01b15d7` |
| 5 | Tervezés tab grouping | **Fixed this pass.** The email-reminder cadence now sits under its own "Notifications" group, separated from budget + region. | `ProfilePage.tsx`, `f01b15d7` |

## Why the audit read #1/#2/#3 as gaps

The Manage button only renders for `status === "active" || "past_due"`
(`BillingSettings.tsx`, `showManage`). A trial/founding couple has **no Stripe
customer** yet — customers are created lazily at first checkout
(`billing.ts` checkout handler) — so there is genuinely nothing to manage, and
only the "Subscribe" (Checkout) button shows. The audit saw that intentional
empty state and concluded the whole capability was absent.

## What was implemented this pass

**Read-only card on file** (`1ecc1372`)
- `GET /api/billing/payment-method` fetches the customer's default card from
  Stripe on demand (falls back to the newest attached card) and **stores
  nothing**. Returns `{ card: null }` — never an error — when Stripe is off, the
  couple has no customer yet, or no card is attached.
- The Előfizetés tab renders a `Card on file: Visa •••• 4202 · expires 08/27`
  line. The **portal remains the only place to change it** — this is display
  only, so it stays inside the "no card fields in-app" rule.
- Types `PaymentMethodCard` / `PaymentMethodResponse` (`shared/billing.ts`).
  HU/EN/ES copy. Covered in `backend/tests/api/billing.e2e.test.ts`
  (`{card:null}` for a no-customer couple; auth required).

**Kiosk no-slug hint** (`f01b15d7`) — `Munkaterület` welcome-desk card now links
to `/app/guest-page` (where the couple code is set) instead of a dead-end note
that named the wrong location.

**Tervezés regroup** (`f01b15d7`) — "Timeline reminders by email" moved under a
new **Notifications** group label, distinct from budget + region. No setting
changed tabs.

## Genuinely open / non-code

- **Verify the Stripe Dashboard Customer Portal config** has *Payment methods →
  update* and *Invoice history* enabled. The code mints the portal session; the
  features shown inside it are a Dashboard setting, not code. This is the one
  real dependency for audit #1/#3 to fully deliver.
- **No custom card CRUD.** Building an in-app add/replace/delete flow would
  duplicate the portal and violate the Stripe-hosted architecture (and can't
  handle card data client-side). The portal is the intended mechanism; the
  audit's own note confirms Stripe enforces the safe-delete guard.

## Not changed (deliberately)

- Account (Fiók): email/name/language editable, security split out, workspace
  deletion is a 30-day pause-then-delete with reversal — all as the audit found,
  no change needed.
- Adatok: JSON export + CSV + 10-version snapshot history — strong as-is.
