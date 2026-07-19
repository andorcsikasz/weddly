# Vendor Dashboard — UX/UI Audit & Backlog

_Source: vendor-side web app walkthrough (Áttekintés, Ügyfelek, Naptár, Hirdetésem, Statisztika, Vélemények, Beállítások), cross-checked against the marketing site and the couple app for brand consistency. Goal: keep the Uber-style clean, card-based layout while elevating the product to feel like a premium, well-funded startup._

One ticket per line item, grouped by priority, each with a root-cause note where one is known and acceptance criteria. Statuses reflect the repo as of this file's commit. Import-friendly: each `###` block is one ticket.

Legend — **Status:** `DONE` (shipped, commit noted) · `PARTIAL` (some shipped) · `OPEN`.

---

## P0 — trust-breaking, paying-customer-facing

### VND-1 · Pro vendor sees the free-tier lockout on Ügyfelek (Clients)
- **Priority:** P0 · **Labels:** bug, billing, vendor · **Status:** DONE — `b35a24aa`
- **Symptom:** A confirmed Pro account saw the blurred/locked CRM table + "Válts Pro csomagra" banner, despite being Pro in Settings → Csomag, the profile dropdown, and billing.
- **Root cause:** `plan` state defaulted to `"free"` and the paywall rendered off `!isPro` before billing had loaded; `Promise.all([clients, billing])` meant any clients-list hiccup rejected the pair and discarded the successful Pro plan.
- **Fix:** The clients list and billing load independently; `plan` starts `null` (unknown); the lock (`crmLocked`) shows only once billing resolves AND the plan genuinely lacks the feature. Server remains the real gate on the data.
- **Acceptance:** A Pro vendor never sees the upsell/lock; a free vendor still does; a clients-list error no longer flips a Pro vendor to locked.

### VND-2 · "Előnézet megnyitása" is a dead link (silent bounce home)
- **Priority:** P0 · **Labels:** bug, vendor, routing · **Status:** DONE — `b35a24aa` (listing page) + `e212f758` (reviews page)
- **Symptom:** Clicking "Előnézet megnyitása" made no `/api/suppliers/...` call, loaded the dashboard chunk, and silently redirected the vendor to `/vendor` — no error, no toast.
- **Root cause:** The link pointed at `/app/suppliers/:id` — the couple-app-internal detail route (behind `RequireCoupleAuth`), which bounces a `role='vendor'` user back to `/vendor`. The public listing lives at `/vendors/:id` (`PublicVendorPage`, no auth wall).
- **Fix:** All three preview links (2 on Hirdetésem, 1 on the Vélemények empty state) now point at `/vendors/:id` (same `v{N}` id), open in a new tab, and carry the external-link affordance.
- **Acceptance:** From every entry point, "Előnézet megnyitása" opens the live public listing in a new tab; editor edits survive.

---

## P1 — premium-feel and activation

### VND-3 · One shared design system across marketing / vendor / couple
- **Priority:** P1 · **Labels:** design-system, brand · **Status:** OPEN
- **Problem:** The marketing homepage and couple app use a confident editorial language (large serif/display headings, warm gold accent, generous photography). The vendor dashboard uses generic system-font, flat beige cards, and no imagery — it reads as a third, stitched-on app.
- **Scope:** Adopt the shared typographic scale + accent palette on the vendor side; give hero/empty areas illustration or photography instead of plain text. Decide deliberately how far the vendor portal adopts the couple app's serif/gold vs. its own steel-blue vendor identity (there's an intentional steel accent for the vendor portal today).
- **Acceptance:** A vendor screen and a couple screen side by side read as one brand; type scale + accent tokens are shared, not re-invented per surface.
- **Note:** This is a design decision, not just code — needs a direction call before build.

### VND-4 · Persistent onboarding checklist with completion ring
- **Priority:** P1 · **Labels:** onboarding, activation, vendor · **Status:** DONE — persistence + ring `fa7756dd`, checklist + 2nd surface + honest scoring this session
- **Problem:** A fresh account is a wall of bare zero-states (Áttekintés, Naptár, Statisztika, Vélemények, Teendők). The only onboarding element is one dismissible "20% kész" banner on the overview; once dismissed it can't be recalled, and the percentage isn't reflected anywhere else.
- **Scope:** Replace the one-shot banner with a persistent, visual checklist (completion ring) listing concrete steps — cover photo, gallery, packages, description, contact info — visible until the profile hits 100%, surfaced in the sidebar and the listing page.
- **Done (`fa7756dd`):** the banner is persistent and reopenable — a `CompletenessRing` in a full alert plus a collapsed chip, dismissal stored per device in `localStorage` (`VendorDashboardPage.tsx`).
- **Also done (this session):**
  - **Real per-step checklist.** `VendorStats` gained `listing_steps`; the alert renders one row per step, each deep-linking to `/vendor/listing#vendor-section-<key>` (anchors added to the cover / gallery / description / contact / pricing / capacity / packages sections). Done rows stay visible and struck through — seeing what's finished is half of what makes a checklist feel like progress. The listing editor scrolls to the anchor once its fetch resolves, since a SPA can't honour a hash for a section that doesn't exist yet.
  - **Second surface.** `frontend/src/components/VendorSetupProgress.tsx` now owns the ring + checklist (extracted from `VendorDashboardPage`, so there is no second copy); `SetupProgressPanel` renders them in the listing editor's sticky column, where it stays visible while the vendor scrolls the long form. It hides itself at 100%.
  - **Honest scoring.** The rules moved to `listingChecklistFor` in `shared/vendor_clients.ts` and now score 7 steps including gallery and packages, so the ring can no longer read 100% on a listing with no photos beyond the cover and no price offers. `listing_completeness` is DERIVED from the steps on both sides, so ring and checklist cannot drift. The backend passes DB counts, the editor passes the arrays it already holds.
- **Acceptance:** Progress is always recallable ✓, reflected in ≥2 places ✓, each step deep-links to the relevant editor ✓, and the ring hits 100% only when the listing is genuinely complete ✓.

### VND-5 · Live-reactive listing preview
- **Priority:** P1 · **Labels:** vendor, listing-editor · **Status:** PARTIAL — cover done `0ef61b6a`
- **Problem (as reported):** the preview panel "stays static and empty regardless of what's filled in."
- **Reality / done:** The preview already mirrors city, price band, capacity and blurb live from form state. The cover photo was the lagging field — it only appeared after the upload round-trip; it now renders instantly on pick/drop via a local object URL (`0ef61b6a`).
- **Remaining (OPEN):** the preview is a compact directory card; it does not reflect packages, gallery, or videos. Optional enrichment: a fuller couple's-eye preview, or a package/pricing summary chip, so the vendor's richest edits show up couple-side.
- **Acceptance:** Every editor field the couple would see is reflected in the preview without a save/round-trip; decide whether to keep the compact card or grow it into a fuller preview.

### VND-6 · Turn the conversion funnel into a real visualization
- **Priority:** P1 · **Labels:** vendor, stats, dataviz · **Status:** DONE — this session
- **Problem:** The "Konverzió" funnel (megkeresés → megerősített foglalás → foglalásból foglalás) is genuinely useful, differentiated data but was rendered as three flat number boxes (`ConversionCell`) at the bottom of Statisztika, which undersold it.
- **Fix:** Replaced the three flat cells with a `ConversionFunnel` — left-aligned proportional bars (inquiries = 100% track, confirmed carries its conversion share), so the empty remainder of a track shows drop-off at a glance. One hue per stage (steel → sage), counts in text tokens (magnitude never on the fill), the conversion % labeled on the confirmed stage, and each row still deep-links into the matching client list. Follows the dataviz single-hue-per-magnitude rule, not a categorical palette.
- **Acceptance:** Step-to-step drop-off is visible at a glance; rates are labeled; it reads as a funnel, not three counters. ✓

### VND-7 · Dark-mode card contrast
- **Priority:** P1 · **Labels:** dark-mode, a11y, design-system · **Status:** DONE — this session
- **Problem:** Card borders/shadows nearly disappeared in dark mode (e.g. Settings → Adatok). Shadows are dropped in dark, and card fills equalled the page (`umber-900`) or lifted to `umber-800` behind only a faint `umber-700` edge.
- **Fix:** Brightened the dark card edge `umber-700 → umber-600` (the tone `.card-hover` already used) on the shared `.card` primitive (fixes Adatok + app-wide), on the vendor flat-outlined card idiom (25 sites), and on the `shadow-elevated` ring cards. Fills untouched, so each surface keeps its look.
- **Acceptance:** Every card in dark mode has a clearly visible edge against the page; no fill changes; light mode unchanged.

---

## P2 — coherence, features, polish

### VND-8 · Overview and Statisztika duplicate the same stat cards
- **Priority:** P2 · **Labels:** vendor, redundancy · **Status:** DONE
- **Problem:** The Overview and Statisztika pages repeat the same three stat cards almost verbatim. In fact all four metrics overlapped: Overview's hero is `inquiries_30d` and its KPI row is `inquiries_total` / `revenue_tracked` / `blocked_dates_count`, which is exactly Statisztika's summary row (Statisztika even reused Overview's `vendor.dashboard.inquiries_30d` key).
- **Fix:** The summary row now renders ONLY in Statisztika's FREE branch. A PRO vendor lands directly on the analysis (trend chart, status donut, conversion funnel) instead of scrolling past a re-render of the page they just left; a FREE vendor, who has no analysis to land on, still gets the counts. Overview is untouched and remains the glanceable surface.
- **Acceptance:** No verbatim duplication; each page earns its screen real estate. ✓

### VND-9 · Integrate Naptár and Teendők instead of swapping views
- **Priority:** P2 · **Labels:** vendor, calendar · **Status:** DONE — verified in code 2026-07-20
- **Problem:** Switching Naptár ↔ Teendők replaces the whole view, so the two features feel disconnected.
- **Scope:** Surface tasks as due-date markers on the calendar itself so it reads as one planning tool.
- **Reality:** `VendorCalendarPage.tsx` already pushes every not-done task carrying a `due_date` into the calendar event list as `kind: "task"`, rendered across the month / time-grid / schedule views, and the pills link back to the board. Acceptance is met. Only the mode toggle itself still swaps views, which is a cosmetic preference, not the disconnect the ticket described.
- **Acceptance:** Dated tasks appear on the calendar; the two are one coherent surface. ✓

### VND-10 · Replace native date inputs with the custom date picker
- **Priority:** P2 · **Labels:** vendor, a11y, consistency · **Status:** DONE
- **Problem:** Native browser date inputs (calendar day-blocking, to-do due dates) show the raw browser calendar icon and clash with the custom-styled components everywhere else; they also vary across browsers.
- **Root cause:** the shared `CalendarPicker` is deliberately only a GRID — it renders inside a `position: relative` wrapper and leaves open/close, click-outside and Escape to its parent. So every caller wanting a plain date input had to re-implement that shell, and the vendor surfaces reached for the native control instead. Before this, `CalendarPicker` had exactly two callers, both in the couple app's dashboard, both inside a dialog.
- **Fix:** new `frontend/src/components/ui/DateField.tsx` supplies the missing shell (labelled trigger showing the locale-formatted date, popover, outside-click + Escape, optional clear) so a date field is now a one-liner. Adopted at all three vendor sites: the to-do due date (`VendorCalendarPage`), availability day-blocking (`VendorListingPage`), and the payment due date (`VendorClientDetailPage`, which the ticket didn't list but had the same problem via `TextField type="date"`). No native `type="date"` remains anywhere under `pages/vendor/`.
- **Acceptance:** Both date entry points use the shared custom picker; visual + keyboard behavior is consistent across browsers. ✓
- **Follow-up:** roughly 30 native date inputs remain OUTSIDE the vendor surfaces (couple app, admin). `DateField` is exported from `components/ui`, so migrating them is now mechanical.

### VND-11 · Functional notifications + inquiry alerts
- **Priority:** P2 · **Labels:** vendor, notifications, growth · **Status:** PARTIAL
- **Problem (as reported):** The notification bell always shows "Nincs új értesítés" — no functional content.
- **Reality:** the bell is NOT a stub. The vendor bell is its own component in `VendorShell.tsx` (not the couple `NotificationBell`) and renders real rows off live stats: new inquiries (→ `/vendor/clients`) and confirmed events inside the next 7 days, with a per-device seen watermark driving the red dot. `vendor.notif.none` shows only when there is genuinely nothing.
- **Also done:** the new-review kind. `VendorStats` gained `reviews_recent` (published, undeleted reviews on the vendor's listing from the last 30 days; reviews key off the LISTING, so an account without one simply has zero), and the bell renders a third row linking to `/vendor/reviews`. The count joins the existing seen-watermark, so the dot re-arms when it rises. Covered in `backend/tests/api/vendor_stats.e2e.test.ts`.
- **Remaining (OPEN):** the booking-change kind — deliberately skipped rather than faked, because there is no event source for it today (`supplier_bookings.updated_at` mostly records the vendor's own edits, which would ping them about their own actions); it needs a real status-transition log first. Also open: the push/email inquiry alert (lead-response speed is one of the biggest marketplace levers), and moving the vendor bell onto the real `notificationApi` feed that backs the couple bell.
- **Acceptance:** The bell shows real events ✓; a new couple inquiry triggers a timely out-of-app alert (still open).

### VND-12 · "Average response time" metric + SLA-style badges
- **Priority:** P2 · **Labels:** vendor, growth, marketplace · **Status:** OPEN
- **Scope:** Track and show the vendor's average response time; add SLA-style badges that reward fast responders — benefits both sides of the marketplace.
- **Acceptance:** Vendors see their own response-time metric; a "fast responder"-style badge is earned from real data (no fabricated numbers).

### VND-13 · In-app messaging / inbox between vendors and couples
- **Priority:** P2 · **Labels:** vendor, messaging · **Status:** OPEN
- **Problem:** There's no messaging beyond the CRM-style client list.
- **Acceptance:** Vendors and couples can exchange messages in-app tied to an inquiry/client.

### VND-14 · Search / filter on the client list
- **Priority:** P2 · **Labels:** vendor, crm · **Status:** DONE
- **Fix:** A free-text search box above the status pills, filtering the already-fetched array client-side (no new endpoint) and composing with the status filter. The haystack mirrors what the row actually shows: couple name, event date and localized status always, the PRO `stage` only when that column isn't locked, so a FREE vendor can't probe hidden CRM values by watching rows appear and disappear. The query deliberately stays out of the URL (the status filter is a shareable deep link, a half-typed query is not); zero matches get their own message rather than the "no clients yet" empty state.
- **Acceptance:** The Ügyfelek list supports search and at least status filtering. ✓

### VND-15 · Self-serve brand-name rename request
- **Priority:** P2 · **Labels:** vendor, listing-editor · **Status:** OPEN
- **Problem:** The "brand name is locked" messaging is honest and good, but the only remedy is emailing support.
- **Scope:** A self-serve rename-request flow (submitted → admin moderation queue) to remove the email friction, keeping admin approval.
- **Acceptance:** A vendor can request a rename in-app; it lands in the existing moderation queue; no support email required.

### VND-16 · Micro-interactions and motion pass
- **Priority:** P2 · **Labels:** polish, motion · **Status:** DONE
- **Problem:** State changes are instant/static — no easing on skeleton→content, no hover/press feedback on cards, no animated counters, and the "Mentve" confirmation is a small, easy-to-miss checkmark.
- **Already present before this pass:** the motion infrastructure (`animate-fade-in`, `animate-fade-in-up`, `animate-shimmer` skeletons, `check-pop`, and a global `prefers-reduced-motion` kill-switch in index.css), plus hover feedback on the dashboard's KPI and action cards.
- **Fix:**
  - **Animated counters.** New `frontend/src/components/AnimatedNumber.tsx` (`useCountUp` + `<AnimatedNumber>`) counts a stat from its previous value to the new one, so a number that changes reads as having MOVED. Reduced motion is handled in JS, not CSS — the global rule clamps animation/transition durations but cannot stop a `requestAnimationFrame` loop, so the hook checks the media query itself and jumps to the final value. Applied to the dashboard hero + 3 KPIs and the 4 FREE-tier stat cards; money is animated through a `format` callback so it stays in whole minor units. The end value is always exact; easing only affects intermediate frames.
  - **Skeleton→content eases.** Both vendor data pages fade their loaded view in instead of popping.
  - **Legible saved state.** The autosave confirmation became a tinted pill with the check popping in via the shared `.check-pop` keyframe, so the eye catches the state CHANGE rather than having to notice a static 14px glyph.
- **Acceptance:** Cards have hover/press feedback ✓ (already did); skeleton→content eases ✓; stat numbers animate ✓; saved state is clearly noticed ✓.

---

_Done in the current pass: VND-1, VND-2, VND-5 (cover), VND-6 (conversion funnel), VND-7 (dark-mode card contrast). Everything else is open, roughly in the reporter's suggested order: shared design system → onboarding checklist → fuller live preview → the bigger feature bets._
