// Unit coverage for the booking progress rail's derivation. Pure, no DB, no
// network: the whole point of `shared/booking_stage.ts` is that the rail, the
// quick-look drawer and anything added later read ONE ladder, so the rules are
// locked here rather than re-checked by eye on a screen.

import { describe, expect, test } from "bun:test";
import {
  BOOKING_STAGES,
  type BookingStageFacts,
  bookingStage,
  isStageReached,
  pickStageQuoteStatus,
} from "../../shared/booking_stage";

/** 2026-08-03T12:00:00Z. Every date literal below is read against this. */
const NOW = Date.UTC(2026, 7, 3, 12, 0, 0);
const FUTURE = "2026-12-12";
const PAST = "2026-06-06";

function facts(over: Partial<BookingStageFacts> = {}): BookingStageFacts {
  return {
    status: "requested",
    event_date: FUTURE,
    quote_status: null,
    hold_state: null,
    contract_value: null,
    deposit_paid: null,
    ...over,
  };
}

describe("bookingStage ladder", () => {
  test("a fresh inquiry sits on the first rung", () => {
    const view = bookingStage(facts(), NOW);
    expect(view.key).toBe("inquiry");
    expect(view.index).toBe(0);
    expect(view.closed).toBe(false);
    expect(view.hold_live).toBe(false);
  });

  test("an unknown status lands on inquiry rather than throwing", () => {
    expect(bookingStage(facts({ status: "some_future_state" }), NOW).key).toBe("inquiry");
  });

  test("a draft quote is not a quote the couple has seen", () => {
    expect(bookingStage(facts({ quote_status: "draft" }), NOW).key).toBe("inquiry");
  });

  test("every quote state that left the vendor's hands reaches quoted", () => {
    for (const s of ["sent", "viewed", "declined", "withdrawn", "expired"] as const) {
      expect(bookingStage(facts({ quote_status: s }), NOW).key).toBe("quoted");
    }
  });

  test("a recorded contract value reaches quoted with no quote at all", () => {
    expect(bookingStage(facts({ contract_value: 450_000 }), NOW).key).toBe("quoted");
  });

  test("a contract value of zero still counts, because the vendor typed it", () => {
    expect(bookingStage(facts({ contract_value: 0 }), NOW).key).toBe("quoted");
  });

  test("confirmed reaches booked", () => {
    expect(bookingStage(facts({ status: "confirmed" }), NOW).key).toBe("booked");
  });

  test("an accepted quote is a booking even while the status lags behind", () => {
    const view = bookingStage(facts({ status: "vendor_seen", quote_status: "accepted" }), NOW);
    expect(view.key).toBe("booked");
  });

  test("a deposit only counts once the job is booked", () => {
    expect(bookingStage(facts({ deposit_paid: 100_000 }), NOW).key).toBe("inquiry");
    expect(bookingStage(facts({ status: "confirmed", deposit_paid: 100_000 }), NOW).key).toBe(
      "deposit",
    );
  });

  test("a zero deposit is not a deposit", () => {
    expect(bookingStage(facts({ status: "confirmed", deposit_paid: 0 }), NOW).key).toBe("booked");
  });

  test("a booked wedding whose date has gone reaches done", () => {
    expect(bookingStage(facts({ status: "confirmed", event_date: PAST }), NOW).key).toBe("done");
  });

  test("done does not need a deposit to have been recorded", () => {
    const view = bookingStage(facts({ status: "confirmed", event_date: PAST }), NOW);
    expect(isStageReached(view, "deposit")).toBe(true);
  });

  test("an open inquiry whose date has gone is not done", () => {
    expect(bookingStage(facts({ event_date: PAST }), NOW).key).toBe("inquiry");
  });

  test("today is not the past", () => {
    // The event is today: the wedding has not happened yet at noon.
    expect(bookingStage(facts({ status: "confirmed", event_date: "2026-08-03" }), NOW).key).toBe(
      "booked",
    );
  });

  test("a junk event date cannot push a booking to done", () => {
    expect(bookingStage(facts({ status: "confirmed", event_date: "not-a-date" }), NOW).key).toBe(
      "booked",
    );
  });
});

describe("bookingStage closed leads", () => {
  for (const status of ["declined", "cancelled", "expired"] as const) {
    test(`${status} has no rung at all`, () => {
      const view = bookingStage(facts({ status, contract_value: 900, deposit_paid: 500 }), NOW);
      expect(view.closed).toBe(true);
      expect(view.key).toBeNull();
      expect(view.index).toBe(-1);
      expect(view.closed_status).toBe(status);
    });
  }

  test("nothing reads as reached on a closed lead", () => {
    const view = bookingStage(facts({ status: "cancelled" }), NOW);
    for (const key of BOOKING_STAGES) expect(isStageReached(view, key)).toBe(false);
  });
});

describe("bookingStage date hold", () => {
  test("only a live hold marks the rail", () => {
    expect(bookingStage(facts({ hold_state: "live" }), NOW).hold_live).toBe(true);
    expect(bookingStage(facts({ hold_state: "expired" }), NOW).hold_live).toBe(false);
    expect(bookingStage(facts({ hold_state: "released" }), NOW).hold_live).toBe(false);
  });

  test("a hold moves nothing on the ladder", () => {
    expect(bookingStage(facts({ hold_state: "live" }), NOW).key).toBe("inquiry");
  });

  test("a closed lead still reports its hold", () => {
    const view = bookingStage(facts({ status: "declined", hold_state: "live" }), NOW);
    expect(view.closed).toBe(true);
    expect(view.hold_live).toBe(true);
  });
});

describe("pickStageQuoteStatus", () => {
  test("no quotes is no evidence", () => {
    expect(pickStageQuoteStatus([])).toBeNull();
  });

  test("an accepted quote wins over a newer draft revision", () => {
    const picked = pickStageQuoteStatus([
      { status: "accepted", created_at: 1_000 },
      { status: "draft", created_at: 9_000 },
    ]);
    expect(picked).toBe("accepted");
  });

  test("a sent quote wins over an older withdrawn one", () => {
    expect(
      pickStageQuoteStatus([
        { status: "withdrawn", created_at: 1_000 },
        { status: "sent", created_at: 2_000 },
      ]),
    ).toBe("sent");
  });

  test("equal rank falls back to the newest", () => {
    expect(
      pickStageQuoteStatus([
        { status: "sent", created_at: 1_000 },
        { status: "viewed", created_at: 2_000 },
      ]),
    ).toBe("viewed");
  });

  test("a lone draft is still reported, and the ladder decides what it means", () => {
    expect(pickStageQuoteStatus([{ status: "draft", created_at: 1 }])).toBe("draft");
  });
});

describe("isStageReached", () => {
  test("everything at or below the current rung is reached, nothing above", () => {
    const view = bookingStage(facts({ status: "confirmed", deposit_paid: 1 }), NOW);
    expect(view.key).toBe("deposit");
    expect(isStageReached(view, "inquiry")).toBe(true);
    expect(isStageReached(view, "quoted")).toBe(true);
    expect(isStageReached(view, "booked")).toBe(true);
    expect(isStageReached(view, "deposit")).toBe(true);
    expect(isStageReached(view, "done")).toBe(false);
  });

  test("the ladder fills the gap a hand-managed booking leaves", () => {
    // No quote ever went through Weddly, yet the vendor confirmed the job.
    const view = bookingStage(facts({ status: "confirmed" }), NOW);
    expect(isStageReached(view, "quoted")).toBe(true);
  });
});
