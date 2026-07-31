// Vendor calendar -> Google Calendar push-sync.
//
// Mirrors google_calendar.e2e.test.ts (the couple flow) for the vendor
// aggregate, and additionally covers the two things that are genuinely new here:
// the PRO entitlement gate (the calendar is a PRO feature, so syncing it is too)
// and the SHARED OAuth callback, which dispatches on a signed `kind` so a state
// minted by the couple flow cannot be replayed to bind a vendor connection.
//
// Runs against the in-memory Google fake (GOOGLE_CALENDAR_FAKE=1, pinned in
// tests/setup.ts), so assertions read the Google-side state, not just the local
// event map.

import { beforeEach, describe, expect, test } from "bun:test";
import "../setup";

import type { GoogleCalendarStatus } from "@shared/types";
import { db } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import { initVendorBilling } from "../../src/domain/vendor_billing";
import { zonedParts } from "../../src/domain/vendor_external_busy";
import {
  __fakeAddCalendar,
  __fakeCalendarEvents,
  __fakeSetBusy,
  type GoogleEventBody,
} from "../../src/lib/google_calendar";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

interface ClaimRow {
  token: string;
}

interface EventMapRow {
  source_kind: string;
  source_id: string;
  google_event_id: string;
  content_hash: string;
}

function eventMap(vendorAccountId: number): EventMapRow[] {
  return db
    .prepare(
      "SELECT source_kind, source_id, google_event_id, content_hash FROM vendor_google_calendar_event_map WHERE vendor_account_id = ? ORDER BY source_kind, source_id",
    )
    .all(vendorAccountId) as EventMapRow[];
}

/** The all-day `date` off an event boundary, or null when it's a timed event.
 *  `start`/`end` are a union, so this narrows once instead of at every assert. */
function allDay(part: GoogleEventBody["start"] | undefined): string | null {
  return part && "date" in part ? part.date : null;
}

async function registerAdminAndGetToken(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Ádám Nagy",
  });
  if (reg.status === 201) return reg.data.token;
  const login = await req<{ token: string }>("POST", "/api/auth/login", {
    email: "admin@test.test",
    password: "supersafe123",
  });
  return login.data.token;
}

/** Community submit → verify → admin approve → claim, i.e. the real path to a
 *  claimed vendor. Same shape as vendor_availability/vendor_clients use. */
async function bootstrapVendor(
  slug: string,
): Promise<{ vendorToken: string; listingId: string; accountId: number }> {
  const { token } = await bootstrapCouple(`owner-${slug}@weddly.test`);
  const contactEmail = `vendor-${slug}@weddly.test`;
  const submit = await req<{ supplier: { id: string } }>(
    "POST",
    "/api/suppliers/community",
    {
      category: "photography",
      submitter_type: "self",
      name: `${slug} Studio`,
      city: "Budapest",
      address: null,
      website: `https://${slug}.example`,
      contact_email: contactEmail,
      contact_phone: null,
      blurb: `${slug} blurb`,
      price_band: 3,
    },
    { token },
  );
  expect(submit.status).toBe(201);
  const numericId = Number(submit.data.supplier.id.slice(1));

  createVerificationToken(numericId);
  const vtok = db
    .prepare(
      "SELECT token FROM community_supplier_verifications WHERE supplier_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(numericId) as ClaimRow | undefined;
  await req("POST", `/api/suppliers/community/verify/${vtok?.token}`, {});

  const adminToken = await registerAdminAndGetToken();
  await req("POST", `/api/admin/suppliers/${numericId}/approve`, {}, { token: adminToken });
  const listingId = `c${numericId}`;

  await req("POST", "/api/vendor/claim/start", {
    listing_id: listingId,
    claimant_email: "claimer@gmail.test",
  });
  const claim = db
    .prepare(
      "SELECT token FROM listing_claims WHERE listing_id = ? AND email_sent_to = ? ORDER BY id DESC LIMIT 1",
    )
    .get(listingId, contactEmail) as ClaimRow | undefined;
  await req("POST", `/api/vendor/claim/verify/${claim?.token}`, {});
  const complete = await req<{ token: string }>("POST", "/api/vendor/claim/complete", {
    token: claim?.token,
    password: "vendorpass123",
    full_name: `Vendor ${slug}`,
  });
  expect(complete.status).toBe(201);

  const acct = db
    .prepare("SELECT vendor_account_id AS id FROM listings WHERE id = ?")
    .get(listingId) as { id: number };
  // The availability calendar is PRO-gated, so the sync is too — every test in
  // this suite needs an entitled vendor except the one asserting the gate.
  initVendorBilling(acct.id, "EUR");
  return { vendorToken: complete.data.token, listingId, accountId: acct.id };
}

function stateFromConnectUrl(url: string): string {
  const state = new URL(url).searchParams.get("state");
  expect(state).toBeTruthy();
  return state as string;
}

/** Hit the shared public OAuth callback WITHOUT following the redirect (it
 *  points at the frontend origin, which isn't served in tests). */
function callback(query: string): Promise<Response> {
  return fetch(`${BASE}/api/google-calendar/callback?${query}`, { redirect: "manual" });
}

async function connect(token: string): Promise<GoogleCalendarStatus> {
  const c = await req<{ url: string }>("GET", "/api/vendor/google-calendar/connect", undefined, {
    token,
  });
  expect(c.status).toBe(200);
  const res = await callback(
    `code=fake-code&state=${encodeURIComponent(stateFromConnectUrl(c.data.url))}`,
  );
  expect(res.status).toBe(302);
  const loc = res.headers.get("location") ?? "";
  expect(loc).toContain("gcal=connected");
  // The vendor flow must land on the vendor calendar, not the couple timeline.
  expect(loc).toContain("/vendor/calendar");
  const s = await req<GoogleCalendarStatus>(
    "GET",
    "/api/vendor/google-calendar/status",
    undefined,
    { token },
  );
  expect(s.status).toBe(200);
  return s.data;
}

async function sync(token: string): Promise<GoogleCalendarStatus> {
  const r = await req<GoogleCalendarStatus>(
    "POST",
    "/api/vendor/google-calendar/sync",
    {},
    { token },
  );
  expect(r.status).toBe(200);
  return r.data;
}

async function blockDay(token: string, date: string, hours?: number[]): Promise<void> {
  const r = await req("POST", "/api/vendor/availability/me", hours ? { date, hours } : { date }, {
    token,
  });
  expect(r.status).toBe(201);
}

async function addTask(token: string, title: string, dueDate: string): Promise<number> {
  const r = await req<{ task: { id: number } }>(
    "POST",
    "/api/vendor/tasks",
    { title, due_date: dueDate },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.task.id;
}

async function createInquiry(listingId: string, coupleId: number, date: string): Promise<number> {
  const adminToken = await registerAdminAndGetToken();
  const r = await req<{ id: number }>(
    "POST",
    `/api/suppliers/${encodeURIComponent(listingId)}/bookings`,
    { couple_id: coupleId, event_date: date },
    { token: adminToken },
  );
  expect(r.status).toBe(201);
  return r.data.id;
}

describe("vendor google calendar — connect + sync", () => {
  beforeEach(() => wipeAll());

  test("status requires a vendor session", async () => {
    const anon = await req("GET", "/api/vendor/google-calendar/status");
    expect(anon.status).toBe(401);

    const { token } = await bootstrapCouple("not-a-vendor-gcal@weddly.test");
    const couple = await req("GET", "/api/vendor/google-calendar/status", undefined, { token });
    expect(couple.status).toBe(403);
  });

  test("reports configured + not-connected for a fresh vendor", async () => {
    const { vendorToken } = await bootstrapVendor("gcal-fresh");
    const r = await req<GoogleCalendarStatus>(
      "GET",
      "/api/vendor/google-calendar/status",
      undefined,
      { token: vendorToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.configured).toBe(true);
    expect(r.data.connected).toBe(false);
    expect(r.data.calendarId).toBe(null);
  });

  test("connect pushes confirmed bookings, inquiries, blocked days and task deadlines", async () => {
    const { vendorToken, listingId, accountId } = await bootstrapVendor("gcal-push");
    const { coupleId } = await bootstrapCouple("couple-gcal@weddly.test");

    const bookingId = await createInquiry(listingId, coupleId, "2030-06-15");
    await blockDay(vendorToken, "2030-07-04");
    await addTask(vendorToken, "Send the contract", "2030-05-01");

    const status = await connect(vendorToken);
    expect(status.connected).toBe(true);
    expect(status.calendarId).toBeTruthy();

    const map = eventMap(accountId);
    expect(map.map((m) => m.source_kind).sort()).toEqual(["blocked", "inquiry", "task"]);

    const events = __fakeCalendarEvents(status.calendarId as string);
    expect(events.length).toBe(3);

    // A pending inquiry must NOT mark the vendor busy — it isn't a commitment.
    const inquiry = events.find((e) => e.summary?.includes("Inquiry"));
    expect(inquiry?.transparency).toBe("transparent");
    expect(allDay(inquiry?.start)).toBe("2030-06-15");
    expect(allDay(inquiry?.end)).toBe("2030-06-16");

    // A whole-day block is all-day and genuinely busy.
    const blocked = events.find((e) => e.summary?.startsWith("⛔"));
    expect(blocked?.transparency).toBe("opaque");
    expect(allDay(blocked?.start)).toBe("2030-07-04");

    // A task deadline is a marker, not busy time.
    const task = events.find((e) => e.summary?.includes("Send the contract"));
    expect(task?.transparency).toBe("transparent");
    expect(allDay(task?.start)).toBe("2030-05-01");

    // Confirming the booking flips it to a busy wedding and REPLACES the
    // inquiry event (different source_kind ⇒ delete + insert).
    const adminToken = await registerAdminAndGetToken();
    const patch = await req(
      "PATCH",
      `/api/bookings/${bookingId}`,
      { status: "confirmed" },
      { token: adminToken },
    );
    expect(patch.status).toBe(200);
    await sync(vendorToken);

    const after = eventMap(accountId);
    expect(after.map((m) => m.source_kind).sort()).toEqual(["blocked", "booking", "task"]);
    const confirmed = __fakeCalendarEvents(status.calendarId as string).find((e) =>
      e.summary?.startsWith("💍"),
    );
    expect(confirmed?.transparency).toBe("opaque");
  });

  test("a partial-hours block becomes a TIMED event, not an all-day one", async () => {
    const { vendorToken, accountId } = await bootstrapVendor("gcal-partial");
    // 09:00-13:00 — the day stays bookable in Weddly, so an all-day event would
    // misrepresent it.
    await blockDay(vendorToken, "2030-08-08", [9, 10, 11, 12]);

    const status = await connect(vendorToken);
    const events = __fakeCalendarEvents(status.calendarId as string);
    expect(events.length).toBe(1);
    const ev = events[0];
    expect(ev).toBeDefined();
    if (!ev) return;
    // Timed, not all-day: the `start`/`end` union must be on the dateTime side.
    expect("dateTime" in ev.start).toBe(true);
    if ("dateTime" in ev.start && "dateTime" in ev.end) {
      expect(ev.start.dateTime).toBe("2030-08-08T09:00:00");
      expect(ev.end.dateTime).toBe("2030-08-08T13:00:00");
      expect(ev.start.timeZone).toBe("Europe/Budapest");
    }
    expect(eventMap(accountId).length).toBe(1);
  });

  test("editing a task patches its event (same google id, new hash)", async () => {
    const { vendorToken, accountId } = await bootstrapVendor("gcal-patch");
    const taskId = await addTask(vendorToken, "Original", "2030-05-01");
    const status = await connect(vendorToken);

    const before = eventMap(accountId).find((m) => m.source_kind === "task");
    expect(before).toBeTruthy();

    const patch = await req(
      "PATCH",
      `/api/vendor/tasks/${taskId}`,
      { title: "Renamed" },
      { token: vendorToken },
    );
    expect(patch.status).toBe(200);
    await sync(vendorToken);

    const after = eventMap(accountId).find((m) => m.source_kind === "task");
    expect(after?.google_event_id).toBe(before?.google_event_id as string);
    expect(after?.content_hash).not.toBe(before?.content_hash);
    expect(__fakeCalendarEvents(status.calendarId as string).length).toBe(1);
  });

  test("unblocking a day deletes its event on the next sync", async () => {
    const { vendorToken, accountId } = await bootstrapVendor("gcal-delete");
    await blockDay(vendorToken, "2030-07-04");
    const status = await connect(vendorToken);
    expect(__fakeCalendarEvents(status.calendarId as string).length).toBe(1);

    const del = await req("DELETE", "/api/vendor/availability/me?date=2030-07-04", undefined, {
      token: vendorToken,
    });
    expect(del.status).toBe(200);
    await sync(vendorToken);

    expect(eventMap(accountId).length).toBe(0);
    expect(__fakeCalendarEvents(status.calendarId as string).length).toBe(0);
  });

  test("a completed task drops off the calendar", async () => {
    const { vendorToken, accountId } = await bootstrapVendor("gcal-done");
    const taskId = await addTask(vendorToken, "Finish me", "2030-05-01");
    const status = await connect(vendorToken);
    expect(eventMap(accountId).length).toBe(1);

    await req(
      "PATCH",
      `/api/vendor/tasks/${taskId}`,
      { board_status: "done" },
      { token: vendorToken },
    );
    await sync(vendorToken);
    expect(eventMap(accountId).length).toBe(0);
    expect(__fakeCalendarEvents(status.calendarId as string).length).toBe(0);
  });

  test("disconnect deletes the calendar and clears local state", async () => {
    const { vendorToken, accountId } = await bootstrapVendor("gcal-disc");
    await blockDay(vendorToken, "2030-07-04");
    const status = await connect(vendorToken);

    const r = await req<GoogleCalendarStatus>(
      "POST",
      "/api/vendor/google-calendar/disconnect",
      {},
      { token: vendorToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.connected).toBe(false);
    expect(eventMap(accountId).length).toBe(0);
    expect(__fakeCalendarEvents(status.calendarId as string).length).toBe(0);
  });

  test("sync requires an active connection", async () => {
    const { vendorToken } = await bootstrapVendor("gcal-nosync");
    const r = await req("POST", "/api/vendor/google-calendar/sync", {}, { token: vendorToken });
    expect(r.status).toBe(400);
  });
});

describe("vendor google calendar — entitlement + callback security", () => {
  beforeEach(() => wipeAll());

  test("connect is PRO-gated (the availability calendar itself is)", async () => {
    const { vendorToken, accountId } = await bootstrapVendor("gcal-free");
    // A claimed vendor is entitled out of the box (claim-complete grants the
    // subscription), so lapse it deliberately to exercise the FREE tier.
    db.prepare(
      "UPDATE vendor_subscriptions SET subscription_status = 'canceled' WHERE vendor_account_id = ?",
    ).run(accountId);

    const r = await req<{ detail?: { code?: string } }>(
      "GET",
      "/api/vendor/google-calendar/connect",
      undefined,
      { token: vendorToken },
    );
    expect(r.status).toBe(403);
    expect(r.data.detail?.code).toBe("vendor_pro_required");
  });

  test("a lapsed vendor stops syncing but keeps their calendar and connection", async () => {
    // Downgrade must not destroy data — same principle as the couple read-only
    // gate. The connection and the already-pushed events survive; they just
    // stop receiving updates.
    const { vendorToken, accountId } = await bootstrapVendor("gcal-lapse");
    await blockDay(vendorToken, "2030-07-04");
    const status = await connect(vendorToken);
    expect(__fakeCalendarEvents(status.calendarId as string).length).toBe(1);

    db.prepare(
      "UPDATE vendor_subscriptions SET subscription_status = 'canceled' WHERE vendor_account_id = ?",
    ).run(accountId);
    // The availability ROUTES are already 402-gated for a lapsed vendor, so the
    // data can't change through the API anyway. Write straight to the table so
    // this asserts the SYNC itself declines to push, rather than leaning on that
    // outer gate.
    db.prepare(
      "INSERT INTO vendor_unavailable_dates (vendor_account_id, blocked_date, reason, created_at) VALUES (?, '2030-07-05', NULL, ?)",
    ).run(accountId, Date.now());
    await sync(vendorToken);

    // The new block did NOT reach Google, but nothing was torn down.
    expect(__fakeCalendarEvents(status.calendarId as string).length).toBe(1);
    expect(eventMap(accountId).length).toBe(1);
    const still = await req<GoogleCalendarStatus>(
      "GET",
      "/api/vendor/google-calendar/status",
      undefined,
      { token: vendorToken },
    );
    expect(still.data.connected).toBe(true);
    expect(still.data.lastError).toBe("pro_required");
  });

  test("a couple-issued state cannot be replayed against the vendor flow", async () => {
    // Both flows share one redirect URI, so the ONLY thing separating them is
    // the signed `kind` inside the state. A couple state must therefore bind a
    // couple connection and never a vendor one.
    const { vendorToken, accountId } = await bootstrapVendor("gcal-replay");
    const { token: coupleToken, coupleId } = await bootstrapCouple("replay@weddly.test");

    const c = await req<{ url: string }>("GET", "/api/google-calendar/connect", undefined, {
      token: coupleToken,
    });
    expect(c.status).toBe(200);
    const res = await callback(
      `code=fake-code&state=${encodeURIComponent(stateFromConnectUrl(c.data.url))}`,
    );
    expect(res.status).toBe(302);
    // It bound the COUPLE, and landed on the couple surface.
    expect(res.headers.get("location") ?? "").toContain("/app/timeline");

    const vendorStatus = await req<GoogleCalendarStatus>(
      "GET",
      "/api/vendor/google-calendar/status",
      undefined,
      { token: vendorToken },
    );
    expect(vendorStatus.data.connected).toBe(false);
    expect(eventMap(accountId).length).toBe(0);

    const coupleConn = db
      .prepare("SELECT couple_id FROM google_calendar_connections WHERE couple_id = ?")
      .get(coupleId);
    expect(coupleConn).toBeTruthy();
  });

  test("a tampered state redirects to error without connecting", async () => {
    const { vendorToken, accountId } = await bootstrapVendor("gcal-tamper");
    const c = await req<{ url: string }>("GET", "/api/vendor/google-calendar/connect", undefined, {
      token: vendorToken,
    });
    const good = stateFromConnectUrl(c.data.url);
    const tampered = `${good.slice(0, -2)}xx`;
    const res = await callback(`code=fake-code&state=${encodeURIComponent(tampered)}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location") ?? "").toContain("gcal=error");

    const status = await req<GoogleCalendarStatus>(
      "GET",
      "/api/vendor/google-calendar/status",
      undefined,
      { token: vendorToken },
    );
    expect(status.data.connected).toBe(false);
    expect(eventMap(accountId).length).toBe(0);
  });
});

// ─── The PULL direction ──────────────────────────────────────────────────────
// Free/busy read back out of the vendor's own calendars. The interesting
// assertions are not "does it fetch" but the three guards that make a two-way
// sync safe: an ordinary appointment must not cost a wedding date, our own
// pushed calendar must never be read back, and switching the pull off must take
// its effect with it.
describe("vendor google calendar — free/busy pull", () => {
  beforeEach(() => wipeAll());

  /** A busy block `daysOut` from today, given as UTC instants, plus the LOCAL
   *  date and minutes the server should file it under.
   *
   *  Built at runtime rather than hard-coded because the pull only looks a year
   *  ahead, and derived through the server's own zone helper rather than a fixed
   *  "+02:00" because Europe/Budapest is CET half the year: a literal offset
   *  would make these tests pass in July and fail in December. */
  function busyAt(daysOut: number, utcHour: number, lengthHours: number) {
    const start = new Date(Date.now() + daysOut * 86_400_000);
    start.setUTCHours(utcHour, 0, 0, 0);
    const end = new Date(start.getTime() + lengthHours * 3_600_000);
    const from = zonedParts(start.getTime(), "Europe/Budapest");
    const to = zonedParts(end.getTime(), "Europe/Budapest");
    return {
      range: { start: start.toISOString(), end: end.toISOString() },
      date: from.date,
      startMin: from.min,
      endDate: to.date,
      endMin: to.min,
    };
  }

  async function pullWith(
    token: string,
    busy: Array<{ start: string; end: string }>,
  ): Promise<GoogleCalendarStatus> {
    __fakeSetBusy("primary", busy);
    return sync(token);
  }

  function externalBusyOf(token: string) {
    return req<{ external_busy: Array<{ date: string; start_min: number; end_min: number }> }>(
      "GET",
      "/api/vendor/availability/me",
      undefined,
      { token },
    );
  }

  test("busy blocks land as date + minutes, and nothing else", async () => {
    const { vendorToken } = await bootstrapVendor("gcal-pull");
    await connect(vendorToken);

    const b = busyAt(60, 8, 2);
    const status = await pullWith(vendorToken, [b.range]);
    expect(status.busySyncedAt).toBeTruthy();
    expect(status.externalBusyCount).toBe(1);
    expect(status.pullEnabled).toBe(true);

    const view = await externalBusyOf(vendorToken);
    expect(view.status).toBe(200);
    expect(view.data.external_busy).toEqual([
      { date: b.date, start_min: b.startMin, end_min: b.startMin + 120 },
    ]);
  });

  test("two hours at the dentist do NOT take the date off the market", async () => {
    const { vendorToken, listingId } = await bootstrapVendor("gcal-pull-partial");
    const { token: coupleToken } = await bootstrapCouple("couple-pull-partial@weddly.test");
    await connect(vendorToken);
    const b = busyAt(60, 8, 2);
    await pullWith(vendorToken, [b.range]);

    const pub = await req<{ unavailable_dates: string[]; partial_dates: string[] }>(
      "GET",
      `/api/suppliers/${encodeURIComponent(listingId)}/availability`,
      undefined,
      { token: coupleToken },
    );
    expect(pub.status).toBe(200);
    // This is the whole rule: partly busy, still bookable.
    expect(pub.data.unavailable_dates).not.toContain(b.date);
    expect(pub.data.partial_dates).toContain(b.date);
  });

  test("a day with no workable time left IS taken", async () => {
    const { vendorToken, listingId } = await bootstrapVendor("gcal-pull-full");
    const { token: coupleToken } = await bootstrapCouple("couple-pull-full@weddly.test");
    await connect(vendorToken);
    // The vendor works 09:00-17:00 every weekday; a dawn-to-late shoot swallows it.
    await req(
      "PUT",
      "/api/vendor/availability/me/pattern",
      {
        working_hours: {
          1: [{ start_min: 540, end_min: 1020 }],
          2: [{ start_min: 540, end_min: 1020 }],
          3: [{ start_min: 540, end_min: 1020 }],
          4: [{ start_min: 540, end_min: 1020 }],
          5: [{ start_min: 540, end_min: 1020 }],
          6: [{ start_min: 540, end_min: 1020 }],
          7: [{ start_min: 540, end_min: 1020 }],
        },
      },
      { token: vendorToken },
    );
    const b = busyAt(60, 4, 16); // local 05:00/06:00 to 21:00/22:00, either way over 09:00-17:00
    await pullWith(vendorToken, [b.range]);

    const pub = await req<{ unavailable_dates: string[]; partial_dates: string[] }>(
      "GET",
      `/api/suppliers/${encodeURIComponent(listingId)}/availability`,
      undefined,
      { token: coupleToken },
    );
    expect(pub.data.unavailable_dates).toContain(b.date);
    expect(pub.data.partial_dates).not.toContain(b.date);
  });

  test("a date the vendor opened by hand outranks the external calendar", async () => {
    const { vendorToken, listingId } = await bootstrapVendor("gcal-pull-exception");
    const { token: coupleToken } = await bootstrapCouple("couple-pull-exception@weddly.test");
    await connect(vendorToken);
    const b = busyAt(60, 4, 16);
    await pullWith(vendorToken, [b.range]);
    // "I am working that day after all."
    const open = await req(
      "POST",
      "/api/vendor/availability/me",
      { date: b.date, available: true },
      { token: vendorToken },
    );
    expect(open.status).toBe(201);

    const pub = await req<{ unavailable_dates: string[]; partial_dates: string[] }>(
      "GET",
      `/api/suppliers/${encodeURIComponent(listingId)}/availability`,
      undefined,
      { token: coupleToken },
    );
    expect(pub.data.unavailable_dates).not.toContain(b.date);
    expect(pub.data.partial_dates).not.toContain(b.date);
  });

  test("Weddly's own pushed calendar is never read back", async () => {
    const { vendorToken, accountId } = await bootstrapVendor("gcal-pull-loop");
    await connect(vendorToken);
    const ourCalendarId = (
      db
        .prepare(
          "SELECT calendar_id AS id FROM vendor_google_calendar_connections WHERE vendor_account_id = ?",
        )
        .get(accountId) as { id: string | null }
    ).id;
    expect(ourCalendarId).toBeTruthy();

    // It is not even offered in the picker...
    const list = await req<{ calendars: Array<{ id: string }> }>(
      "GET",
      "/api/vendor/google-calendar/calendars",
      undefined,
      { token: vendorToken },
    );
    expect(list.status).toBe(200);
    expect(list.data.calendars.map((c) => c.id)).not.toContain(ourCalendarId);

    // ...and selecting it by hand still reads nothing from it, so a booking we
    // pushed can't come back as external busy on its own date.
    __fakeSetBusy(ourCalendarId as string, [busyAt(60, 4, 16).range]);
    const saved = await req<GoogleCalendarStatus>(
      "PUT",
      "/api/vendor/google-calendar/calendars",
      { calendar_ids: [ourCalendarId] },
      { token: vendorToken },
    );
    expect(saved.status).toBe(200);
    expect(saved.data.externalBusyCount).toBe(0);
  });

  test("the picker lists the vendor's own calendars and remembers the ticks", async () => {
    const { vendorToken } = await bootstrapVendor("gcal-pull-picker");
    __fakeAddCalendar({ id: "primary", summary: "Personal", primary: true });
    __fakeAddCalendar({
      id: "birthdays@group.calendar.google.com",
      summary: "Birthdays",
      primary: false,
    });
    await connect(vendorToken);

    const before = await req<{ calendars: Array<{ id: string; selected: boolean }> }>(
      "GET",
      "/api/vendor/google-calendar/calendars",
      undefined,
      { token: vendorToken },
    );
    // Nothing chosen yet reads as "primary only", which is what the pull does.
    expect(before.data.calendars.find((c) => c.id === "primary")?.selected).toBe(true);
    expect(
      before.data.calendars.find((c) => c.id === "birthdays@group.calendar.google.com")?.selected,
    ).toBe(false);

    await req(
      "PUT",
      "/api/vendor/google-calendar/calendars",
      { calendar_ids: ["birthdays@group.calendar.google.com"] },
      { token: vendorToken },
    );
    const after = await req<{ calendars: Array<{ id: string; selected: boolean }> }>(
      "GET",
      "/api/vendor/google-calendar/calendars",
      undefined,
      { token: vendorToken },
    );
    expect(
      after.data.calendars.find((c) => c.id === "birthdays@group.calendar.google.com")?.selected,
    ).toBe(true);
    expect(after.data.calendars.find((c) => c.id === "primary")?.selected).toBe(false);
  });

  test("switching the pull off clears what it had pulled", async () => {
    const { vendorToken } = await bootstrapVendor("gcal-pull-off");
    await connect(vendorToken);
    await pullWith(vendorToken, [busyAt(60, 8, 2).range]);
    expect((await externalBusyOf(vendorToken)).data.external_busy.length).toBe(1);

    const off = await req<GoogleCalendarStatus>(
      "PUT",
      "/api/vendor/google-calendar/calendars",
      { calendar_ids: [], pull_enabled: false },
      { token: vendorToken },
    );
    expect(off.data.pullEnabled).toBe(false);
    expect(off.data.externalBusyCount).toBe(0);
    expect((await externalBusyOf(vendorToken)).data.external_busy).toEqual([]);
  });

  test("disconnecting takes the pulled busy with it", async () => {
    const { vendorToken, accountId } = await bootstrapVendor("gcal-pull-disconnect");
    await connect(vendorToken);
    await pullWith(vendorToken, [busyAt(60, 8, 2).range]);

    const d = await req(
      "POST",
      "/api/vendor/google-calendar/disconnect",
      {},
      { token: vendorToken },
    );
    expect(d.status).toBe(200);
    const rows = db
      .prepare("SELECT COUNT(*) AS c FROM vendor_external_busy WHERE vendor_account_id = ?")
      .get(accountId) as { c: number };
    expect(rows.c).toBe(0);
  });

  test("a multi-day block splits across the local dates it covers", async () => {
    const { vendorToken } = await bootstrapVendor("gcal-pull-multiday");
    await connect(vendorToken);
    // 39 hours from a local evening: the first day to midnight, one whole day,
    // then the morning of the third.
    const b = busyAt(60, 16, 39);
    await pullWith(vendorToken, [b.range]);
    const view = await externalBusyOf(vendorToken);
    const middle = view.data.external_busy[1];
    expect(view.data.external_busy.length).toBe(3);
    expect(view.data.external_busy[0]).toEqual({
      date: b.date,
      start_min: b.startMin,
      end_min: 1440,
    });
    expect(middle?.start_min).toBe(0);
    expect(middle?.end_min).toBe(1440);
    expect(view.data.external_busy[2]).toEqual({
      date: b.endDate,
      start_min: 0,
      end_min: b.endMin,
    });
  });
});
