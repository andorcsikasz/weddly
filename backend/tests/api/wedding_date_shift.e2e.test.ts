import "../setup";
import { daysBetweenIso, shiftIsoDate, suggestHoneymoonShift } from "@shared/date_shift";
import type { Couple } from "@shared/types";
import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { bootstrapCouple, req, wipeAll } from "../helpers";

// What moves when the wedding day moves: the guest camera follows on its own,
// open task deadlines follow only when the couple says yes, and the honeymoon
// remembers which wedding date it was planned around.

const DAY_MS = 24 * 60 * 60 * 1000;

function goal(date: string) {
  return {
    kind: "exact" as const,
    exact_date: date,
    target_year: Number(date.slice(0, 4)),
    target_month: Number(date.slice(5, 7)),
    target_season: null,
    target_quarter: null,
  };
}

async function moveWedding(token: string, date: string): Promise<Couple> {
  const r = await req<{ couple: Couple }>(
    "PATCH",
    "/api/couples/current",
    { wedding_date_goal: goal(date) },
    { token },
  );
  expect(r.status).toBe(200);
  return r.data.couple;
}

function addTask(
  coupleId: number,
  title: string,
  opts: { due?: string | null; start?: string | null; done?: boolean },
): number {
  const ts = Date.now();
  const row = db
    .prepare(
      `INSERT INTO planning_items
         (couple_id, kind, title, done, due_date, start_date, position, created_at, updated_at)
       VALUES (?, 'task', ?, ?, ?, ?, 0, ?, ?) RETURNING id`,
    )
    .get(coupleId, title, opts.done ? 1 : 0, opts.due ?? null, opts.start ?? null, ts, ts) as {
    id: number;
  };
  return row.id;
}

function taskDates(id: number): { due_date: string | null; start_date: string | null } {
  return db.prepare("SELECT due_date, start_date FROM planning_items WHERE id = ?").get(id) as {
    due_date: string | null;
    start_date: string | null;
  };
}

describe("shared date shift helpers", () => {
  test("day arithmetic is calendar-exact across month and DST boundaries", () => {
    expect(daysBetweenIso("2027-03-20", "2027-04-03")).toBe(14);
    expect(shiftIsoDate("2027-03-25", 7)).toBe("2027-04-01");
    expect(shiftIsoDate("2027-10-30", -2)).toBe("2027-10-28");
    expect(shiftIsoDate("not-a-date", 3)).toBe("not-a-date");
  });

  test("a trip slides with the wedding it was planned around", () => {
    expect(
      suggestHoneymoonShift({
        weddingDate: "2027-07-10",
        start: "2027-06-14",
        end: "2027-06-21",
        anchor: "2027-06-12",
      }),
    ).toEqual({ start: "2027-07-12", end: "2027-07-19", reason: "moved" });
  });

  test("with no anchor, only a trip before the wedding earns a suggestion", () => {
    expect(
      suggestHoneymoonShift({
        weddingDate: "2027-07-10",
        start: "2027-07-01",
        end: "2027-07-05",
        anchor: null,
      }),
    ).toEqual({ start: "2027-07-11", end: "2027-07-15", reason: "before_wedding" });
    expect(
      suggestHoneymoonShift({
        weddingDate: "2027-07-10",
        start: "2027-07-12",
        end: "2027-07-19",
        anchor: null,
      }),
    ).toBeNull();
    expect(
      suggestHoneymoonShift({
        weddingDate: "2027-07-10",
        start: "2027-07-12",
        end: "2027-07-19",
        anchor: "2027-07-10",
      }),
    ).toBeNull();
  });
});

describe("moving the wedding date", () => {
  let token: string;
  let coupleId: number;

  beforeEach(async () => {
    wipeAll();
    db.exec("DELETE FROM photo_albums");
    ({ token, coupleId } = await bootstrapCouple("dateshift@weddly.test"));
    db.prepare("DELETE FROM planning_items WHERE couple_id = ?").run(coupleId);
    await moveWedding(token, "2027-06-12");
    // The move off the bootstrap date is setup, not the thing under test.
    db.prepare("UPDATE couples SET deadline_shift_from = NULL WHERE id = ?").run(coupleId);
  });

  test("the guest camera's reveal and shooting window follow the day on their own", async () => {
    const revealAt = Date.parse("2027-06-13T10:00:00Z");
    const endsAt = Date.parse("2027-06-13T02:00:00Z");
    const created = await req(
      "POST",
      "/api/photo-albums",
      { film_aesthetic: "natural", reveal_at: revealAt, event_ends_at: endsAt },
      { token },
    );
    expect(created.status).toBe(201);

    await moveWedding(token, "2027-06-26");
    const album = db
      .prepare("SELECT reveal_at, event_ends_at FROM photo_albums WHERE couple_id = ?")
      .get(coupleId) as { reveal_at: number; event_ends_at: number };
    expect(album.reveal_at).toBe(revealAt + 14 * DAY_MS);
    expect(album.event_ends_at).toBe(endsAt + 14 * DAY_MS);
  });

  test("open deadlines move only after the couple says yes, ticked ones never", async () => {
    const open = addTask(coupleId, "Book florist", { due: "2027-03-01", start: "2027-02-15" });
    const done = addTask(coupleId, "Book venue", { due: "2026-12-01", done: true });
    const undated = addTask(coupleId, "Think about music", {});

    const moved = await moveWedding(token, "2027-06-26");
    expect(moved.deadline_shift_from).toBe("2027-06-12");
    // Nothing moved yet: asking is not answering.
    expect(taskDates(open).due_date).toBe("2027-03-01");

    const offer = await req<{ shift: { from: string; to: string; days: number; count: number } }>(
      "GET",
      "/api/couples/current/deadline-shift",
      undefined,
      { token },
    );
    expect(offer.status).toBe(200);
    expect(offer.data.shift).toEqual({ from: "2027-06-12", to: "2027-06-26", days: 14, count: 1 });

    const answer = await req<{ moved: number; couple: Couple }>(
      "POST",
      "/api/couples/current/deadline-shift",
      { apply: true },
      { token },
    );
    expect(answer.status).toBe(200);
    expect(answer.data.moved).toBe(1);
    expect(answer.data.couple.deadline_shift_from).toBeNull();
    expect(taskDates(open)).toEqual({ due_date: "2027-03-15", start_date: "2027-03-01" });
    expect(taskDates(done).due_date).toBe("2026-12-01");
    expect(taskDates(undated).due_date).toBeNull();

    // A second yes (a partner's stale tab) must not shift twice.
    const replay = await req<{ moved: number }>(
      "POST",
      "/api/couples/current/deadline-shift",
      { apply: true },
      { token },
    );
    expect(replay.data.moved).toBe(0);
    expect(taskDates(open).due_date).toBe("2027-03-15");
  });

  test("declining closes the question and moves nothing", async () => {
    const open = addTask(coupleId, "Order rings", { due: "2027-04-01" });
    await moveWedding(token, "2027-05-29");
    const r = await req<{ moved: number; couple: Couple }>(
      "POST",
      "/api/couples/current/deadline-shift",
      { apply: false },
      { token },
    );
    expect(r.data.moved).toBe(0);
    expect(r.data.couple.deadline_shift_from).toBeNull();
    expect(taskDates(open).due_date).toBe("2027-04-01");
  });

  test("two moves before an answer ask about the whole distance; moving back asks nothing", async () => {
    addTask(coupleId, "Send invites", { due: "2027-03-01" });
    await moveWedding(token, "2027-06-19");
    const twice = await moveWedding(token, "2027-07-03");
    expect(twice.deadline_shift_from).toBe("2027-06-12");
    const offer = await req<{ shift: { days: number } }>(
      "GET",
      "/api/couples/current/deadline-shift",
      undefined,
      { token },
    );
    expect(offer.data.shift.days).toBe(21);

    const back = await moveWedding(token, "2027-06-12");
    expect(back.deadline_shift_from).toBeNull();
  });

  test("with no open dated task there is nothing to ask", async () => {
    addTask(coupleId, "Done already", { due: "2027-01-01", done: true });
    const c = await moveWedding(token, "2027-06-19");
    expect(c.deadline_shift_from).toBeNull();
  });

  test("the honeymoon remembers which wedding date it was planned around", async () => {
    const saved = await req<{ couple: Couple }>(
      "PATCH",
      "/api/couples/current",
      { honeymoon_start_date: "2027-06-14", honeymoon_end_date: "2027-06-21" },
      { token },
    );
    expect(saved.data.couple.honeymoon_anchor_wedding_date).toBe("2027-06-12");

    // Moving the wedding leaves the trip and its anchor alone; the page offers.
    const moved = await moveWedding(token, "2027-07-10");
    expect(moved.honeymoon_start_date).toBe("2027-06-14");
    expect(moved.honeymoon_anchor_wedding_date).toBe("2027-06-12");

    // Re-saving the trip (moved or kept) pins it to the current wedding.
    const kept = await req<{ couple: Couple }>(
      "PATCH",
      "/api/couples/current",
      { honeymoon_start_date: "2027-07-12", honeymoon_end_date: "2027-07-19" },
      { token },
    );
    expect(kept.data.couple.honeymoon_anchor_wedding_date).toBe("2027-07-10");
  });

  test("a trip saved before anchors existed is pinned to the date it was planned against", async () => {
    db.prepare(
      `UPDATE couples SET honeymoon_start_date = '2027-06-14', honeymoon_end_date = '2027-06-20',
              honeymoon_anchor_wedding_date = NULL WHERE id = ?`,
    ).run(coupleId);
    const moved = await moveWedding(token, "2027-08-07");
    expect(moved.honeymoon_anchor_wedding_date).toBe("2027-06-12");
  });
});
