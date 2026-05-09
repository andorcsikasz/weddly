# Weddly — Product & Architecture Blueprint

## What it is

A self-serve wedding-organising platform that wraps the full 12-month chain — *plan → search → book → guests → aftermath* — into one place. The customer is the **couple** (two linked accounts in one shared workspace). HU-first, EN secondary, mobile-first.

## The five phases (top-level IA)

1. **Planning** — onboarding (date, style, headcount, budget, location). Live budget planner with what-if snapshots and ROI per guest.
2. **Suppliers** — categorised marketplace (venue, catering, attire, decor, photo+video, music, cakes, hair+makeup, transport, honeymoon, stationery). Browse → shortlist → message → book → escrow. **v2.** v1 ships a static directory with outbound contact links.
3. **Guests** — guest list manager + auto-generated RSVP form + per-guest invite code. Public RSVP page at `/rsvp/<code>`. Tracks meal, dietary, +1, song, accommodation. CSV import.
4. **Seating** — visual table editor (round/long/square shapes on a canvas). Drag guests onto seats. Conflict detection (split families, exes flagged at onboarding). Print export to A4 / A6 / A3.
5. **Aftermath** — shared photo/video gallery (guest uploads via RSVP code), thank-you-note tracker, supplier review prompts, anniversary reminder. **v3.**

## v1 slice — what ships first

A real couple plans their wedding end-to-end without the marketplace.

1. Couple signup + partner-B invite + onboarding wizard.
2. Budget planner with live re-cost + saveable what-if snapshots.
3. Guest list CRUD + CSV import + invite-code generation.
4. Public RSVP at `/rsvp/<code>` (no auth, code only).
5. Seating canvas (table shapes, drag-drop, conflict warnings).
6. PDF export — seating chart (A4/A3), place cards (A6), table numbers.
7. Static suppliers directory (categorised, outbound link only).

v2 adds the marketplace (booking, escrow, messaging, reviews) on Stripe rails. v3 adds aftermath gallery + thank-you tracking.

## Stack decisions

- **Backend:** Bun 1.3.x, hand-rolled router (no Express/Hono), `bun:sqlite` with FTS5 (for v2 supplier search), TypeScript strict, Argon2id passwords, HMAC-signed opaque session tokens (no JWT).
- **Frontend:** Vite + React 19 + React Router 6 + Tailwind 3 + `lucide-react`. No UI library — design system is hand-rolled Tailwind tokens + custom CSS components.
- **Tests:** `bun:test` E2E suite from day one. Pre-commit gates Biome + typecheck + E2E.
- **Lint/format:** Biome.
- **Deploy:** Railway, single Bun service serving API + built SPA, `/data` persistent volume, healthcheck `/api/health`.
- **Money:** integer Forint (HUF has no sub-unit). No floats anywhere.
- **Schema:** additive-only — `CREATE TABLE IF NOT EXISTS` + `addColumnIfMissing()`. Never drop or rename.

## Domain primitives (v1)

- `couples` — the workspace. 1:N with `users` (partner_a_id, partner_b_id). wedding_date, style_tags, budget_ceiling_huf, target_guest_count, location_lat/lng/radius_km, status (`active | paused | deleting`).
- `users` — auth (email + argon2id password). name, role (`owner | partner | guest_admin | admin`). status (`active | suspended`).
- `couple_invites` — partner-B onboarding token (single-use, 7-day TTL).
- `sessions` — opaque session ids + HMAC sigs.
- `budget_lines` — couple_id, category, planned_huf, actual_huf, supplier_id (nullable). Live recompute on edit.
- `budget_snapshots` — name, payload JSON, created_at. What-if scenarios.
- `guests` — couple_id, full_name, email, phone, group_tag, invite_code (unique), rsvp_status, meal_choice, dietary, plus_one_name, plus_one_meal, accommodation_needed, song_request, notes.
- `tables` — couple_id, label, shape (`round | long | square`), seats, x, y.
- `seat_assignments` — table_id, seat_index, guest_id.
- `conflicts` — couple_id, guest_a_id, guest_b_id, kind (`split | avoid`).
- `audit_log` — actor_id, action, target_kind, target_id, before, after, ts. Append-only.
- `couple_pause_requests` — couple_id, requested_by_user_id, requested_at, scheduled_delete_at, status (`pending | cancelled | completed`).

(v2) `suppliers`, `supplier_categories`, `bookings`, `messages`, `escrow_holds`, `payouts`, `reviews`, `email_outbox`.
(v3) `aftermath_uploads`.

## Auth & workspace model

- **Two linked accounts.** Each partner has their own email/password and is linked to the same `couple` row. Audit log attributes every change.
- **Partner B onboarding** is invite-token-based. Partner A invites; partner B clicks the link, sets a password, and is bound to the same couple_id.
- **Role tiers:** `owner` (creator), `partner` (linked spouse), `guest_admin` (a friend the couple invites to help with logistics — read/write guests + seating, no budget access), `admin` (Weddly staff).
- **Breakup flow.** Either partner hits "pause workspace" → freezes edits, exports JSON+PDF bundle, schedules admin deletion in 30 days. Either partner can cancel within the window. After 30 days the couple row is soft-deleted (preserved for tax retention) and PII is purged.

## Non-negotiables

- **i18n from day one.** HU default when `navigator.language` starts with `hu`, else EN. Locale stored in `localStorage`. Currency always HUF via `Intl.NumberFormat`.
- **Mobile-first.** RSVP and budget tweaker get used on phones. Test 320px → desktop.
- **Print is a first-class output**, not an afterthought. Build the PDF pipeline early — it shapes the seating data model.
- **Couple owns their data.** Single-button JSON + PDFs export.
- **No analytics SDK with PII.** Plausible-style (events only, no user identifiers). RSVP data is sensitive (guest emails, dietary, family conflicts).
- **E2E test on every major addition.** Pre-commit hook runs the suite.

## Print formats (v1)

- **A4 (210×297mm)** — seating chart for home/office printers
- **A6 (105×148mm)** — place cards / table cards
- **A3 (297×420mm)** — large seating chart for venue display boards
