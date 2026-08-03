import { beforeEach, describe, expect, test } from "bun:test";
import "../setup";
import type { GoogleCalendarStatus } from "@shared/types";
import { db } from "../../src/db";
import {
  __fakeCalendarEvents,
  encryptToken,
  FAKE_REVOKED_REFRESH_MARKER,
} from "../../src/lib/google_calendar";
import { bootstrapCouple, req, wipeAll } from "../helpers";

// Runs with GOOGLE_CALENDAR_FAKE=1 + GOOGLE_CLIENT_SECRET pinned (tests/setup.ts):
// the lib answers the OAuth exchange + Calendar API from a deterministic
// in-memory fake, so these tests exercise the full connect -> sync -> disconnect
// pipeline (routes -> domain reconciler -> event map) without touching Google.

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

interface EventMapRow {
  source_kind: string;
  source_id: string;
  google_event_id: string;
  content_hash: string;
}

function eventMap(coupleId: number): EventMapRow[] {
  return db
    .prepare(
      "SELECT source_kind, source_id, google_event_id, content_hash FROM google_calendar_event_map WHERE couple_id = ? ORDER BY source_kind, source_id",
    )
    .all(coupleId) as EventMapRow[];
}

function stateFromConnectUrl(url: string): string {
  const state = new URL(url).searchParams.get("state");
  expect(state).toBeTruthy();
  return state as string;
}

/** Hit the public OAuth callback WITHOUT following the redirect (it points at
 *  the frontend origin, which isn't served in tests). */
function callback(query: string): Promise<Response> {
  return fetch(`${BASE}/api/google-calendar/callback?${query}`, { redirect: "manual" });
}

/** Drive a bootstrapped couple through the full connect flow; returns fresh
 *  status. */
async function connect(token: string): Promise<GoogleCalendarStatus> {
  const c = await req<{ url: string }>("GET", "/api/google-calendar/connect", undefined, { token });
  expect(c.status).toBe(200);
  const res = await callback(
    `code=fake-code&state=${encodeURIComponent(stateFromConnectUrl(c.data.url))}`,
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location") ?? "").toContain("gcal=connected");
  const s = await req<GoogleCalendarStatus>("GET", "/api/google-calendar/status", undefined, {
    token,
  });
  expect(s.status).toBe(200);
  return s.data;
}

async function addTask(
  token: string,
  title: string,
  start_date: string,
  due_date: string,
): Promise<number> {
  const r = await req<{ item: { id: number } }>(
    "POST",
    "/api/planning",
    { kind: "task", title, start_date, due_date },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.item.id;
}

async function addScheduleEvent(
  token: string,
  label: string,
  starts_at_minutes: number,
  duration_minutes: number,
): Promise<number> {
  const r = await req<{ event: { id: number } }>(
    "POST",
    "/api/schedule",
    { label, starts_at_minutes, duration_minutes },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data.event.id;
}

describe("google-calendar: status gating", () => {
  beforeEach(() => wipeAll());

  test("status requires auth", async () => {
    const r = await req("GET", "/api/google-calendar/status");
    expect(r.status).toBe(401);
  });

  test("reports configured + not-connected for a fresh couple", async () => {
    const { token } = await bootstrapCouple("gcal-fresh@test.test");
    const r = await req<GoogleCalendarStatus>("GET", "/api/google-calendar/status", undefined, {
      token,
    });
    expect(r.status).toBe(200);
    expect(r.data.configured).toBe(true);
    expect(r.data.connected).toBe(false);
    expect(r.data.email).toBeNull();
  });
});

describe("google-calendar: connect + sync", () => {
  beforeEach(() => wipeAll());

  test("connect pushes dated tasks + the wedding day + the run sheet", async () => {
    const { token, coupleId } = await bootstrapCouple("gcal-connect@test.test");
    await addTask(token, "Order invitations", "2026-03-01", "2026-03-15");
    await addScheduleEvent(token, "Ceremony", 900 /* 15:00 */, 60);

    const status = await connect(token);
    expect(status.connected).toBe(true);
    expect(status.email).toBe("weddly.fake@gmail.com");
    expect(status.calendarId).toBeTruthy();
    expect(status.syncState).toBe("idle");
    expect(status.lastSyncedAt).not.toBeNull();
    expect(status.lastError).toBeNull();

    const rows = eventMap(coupleId);
    const kinds = rows.map((r) => r.source_kind).sort();
    expect(kinds).toEqual(["schedule", "task", "wedding_day"]);

    const events = __fakeCalendarEvents(status.calendarId as string);
    expect(events.length).toBe(3);

    // Task + wedding day are all-day (start.date); the run-sheet beat is timed.
    const task = events.find((e) => "date" in e.start && e.start.date === "2026-03-15");
    expect(task).toBeDefined();
    const wedding = events.find((e) => "date" in e.start && e.start.date === "2026-09-12");
    expect(wedding).toBeDefined();
    const timed = events.find((e) => "dateTime" in e.start);
    expect(timed).toBeDefined();
    if (timed && "dateTime" in timed.start) {
      expect(timed.start.dateTime).toBe("2026-09-12T15:00:00");
      expect(timed.start.timeZone).toBe("Europe/Budapest");
    }
  });

  test("editing a task patches its event (same id, new hash)", async () => {
    const { token, coupleId } = await bootstrapCouple("gcal-edit@test.test");
    const taskId = await addTask(token, "Order invitations", "2026-03-01", "2026-03-15");
    const status = await connect(token);

    const before = eventMap(coupleId).find((r) => r.source_kind === "task");
    expect(before).toBeDefined();

    const patch = await req(
      "PATCH",
      `/api/planning/${taskId}`,
      { title: "Order invitations and save-the-dates" },
      { token },
    );
    expect(patch.status).toBe(200);

    const sync = await req<GoogleCalendarStatus>("POST", "/api/google-calendar/sync", undefined, {
      token,
    });
    expect(sync.status).toBe(200);

    const after = eventMap(coupleId).find((r) => r.source_kind === "task");
    expect(after).toBeDefined();
    // Same Google event, updated content.
    expect(after?.google_event_id).toBe(before?.google_event_id as string);
    expect(after?.content_hash).not.toBe(before?.content_hash);
    // No wedding date change, so still exactly task + wedding_day.
    expect(__fakeCalendarEvents(status.calendarId as string).length).toBe(2);
  });

  test("deleting a source removes its event on the next sync", async () => {
    const { token, coupleId } = await bootstrapCouple("gcal-delete@test.test");
    const eventId = await addScheduleEvent(token, "Ceremony", 900, 60);
    const status = await connect(token);
    // wedding day + the one run-sheet beat.
    expect(eventMap(coupleId).length).toBe(2);

    const del = await req("DELETE", `/api/schedule/${eventId}`, undefined, { token });
    expect(del.status).toBe(200);
    await req("POST", "/api/google-calendar/sync", undefined, { token });

    const rows = eventMap(coupleId);
    expect(rows.some((r) => r.source_kind === "schedule")).toBe(false);
    expect(rows.length).toBe(1);
    expect(__fakeCalendarEvents(status.calendarId as string).length).toBe(1);
  });

  test("disconnect deletes the calendar and clears local state", async () => {
    const { token, coupleId } = await bootstrapCouple("gcal-disconnect@test.test");
    await addTask(token, "Order invitations", "2026-03-01", "2026-03-15");
    const status = await connect(token);
    expect(eventMap(coupleId).length).toBeGreaterThan(0);

    const d = await req<GoogleCalendarStatus>(
      "POST",
      "/api/google-calendar/disconnect",
      undefined,
      { token },
    );
    expect(d.status).toBe(200);
    expect(d.data.connected).toBe(false);
    expect(eventMap(coupleId).length).toBe(0);
    // The whole dedicated calendar is gone from Google.
    expect(__fakeCalendarEvents(status.calendarId as string).length).toBe(0);
  });

  test("sync requires an active connection", async () => {
    const { token } = await bootstrapCouple("gcal-nosync@test.test");
    const r = await req("POST", "/api/google-calendar/sync", undefined, { token });
    expect(r.status).toBe(400);
  });

  test("callback with a tampered state redirects to error", async () => {
    const res = await callback("code=fake-code&state=not-a-valid-state");
    expect(res.status).toBe(302);
    expect(res.headers.get("location") ?? "").toContain("gcal=error");
  });
});

// ─── A grant that Google has ended ───────────────────────────────────────────
// The connection keeps its row and its calendar id, so nothing distinguishes it
// from a healthy one except the reason it stopped working. That is the whole
// point: `lastError` has been in this payload from the start and no screen
// rendered it, so a dead sync read as a green tick indefinitely. It matters more
// now than it did: while the OAuth app sits in Google's "Testing" publishing
// status, EVERY refresh token expires after 7 days.
describe("google-calendar: revoked grant asks for a reconnect", () => {
  beforeEach(() => wipeAll());

  /** Force the stored access token stale so the next sync must refresh, and
   *  swap the refresh token for one the fake refuses. */
  function expireAndRevoke(coupleId: number): void {
    db.prepare(
      "UPDATE google_calendar_connections SET token_expiry = 0, refresh_token_enc = ? WHERE couple_id = ?",
    ).run(encryptToken(`fake-refresh-${FAKE_REVOKED_REFRESH_MARKER}`), coupleId);
  }

  test("a refused refresh token sets needsReconnect, not a raw error string", async () => {
    const { token, coupleId } = await bootstrapCouple("gcal-revoked@test.test");
    await addTask(token, "Order invitations", "2026-03-01", "2026-03-15");
    const healthy = await connect(token);
    expect(healthy.needsReconnect).toBe(false);

    expireAndRevoke(coupleId);
    // Any sync attempt is enough; the manual one is the one a user would press.
    const synced = await req<GoogleCalendarStatus>("POST", "/api/google-calendar/sync", undefined, {
      token,
    });
    expect(synced.status).toBe(200);
    expect(synced.data.needsReconnect).toBe(true);
    // The connection is intact: the calendar, the email and the event map all
    // survive, because reconnecting must not cost the couple their sync state.
    expect(synced.data.connected).toBe(true);
    expect(synced.data.calendarId).toBeTruthy();
    // The one task plus the wedding day itself.
    expect(eventMap(coupleId).length).toBe(2);
  });

  test("an ordinary sync failure is NOT a reconnect prompt", async () => {
    const { token, coupleId } = await bootstrapCouple("gcal-blip@test.test");
    await connect(token);
    // A transient failure the worker will retry out of, recorded the way any
    // non-auth error is. Telling the couple to go back to Google for this would
    // be crying wolf.
    db.prepare("UPDATE google_calendar_connections SET last_error = ? WHERE couple_id = ?").run(
      "google events.insert 503: backend error",
      coupleId,
    );
    const s = await req<GoogleCalendarStatus>("GET", "/api/google-calendar/status", undefined, {
      token,
    });
    expect(s.data.lastError).toContain("503");
    expect(s.data.needsReconnect).toBe(false);
  });

  test("reconnecting clears it", async () => {
    const { token, coupleId } = await bootstrapCouple("gcal-recover@test.test");
    await connect(token);
    expireAndRevoke(coupleId);
    await req("POST", "/api/google-calendar/sync", undefined, { token });

    // The same consent round-trip the pill's "Reconnect" runs.
    const back = await connect(token);
    expect(back.needsReconnect).toBe(false);
    expect(back.lastError).toBeNull();
  });
});
