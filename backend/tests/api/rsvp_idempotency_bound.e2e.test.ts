// The RSVP check-in idempotency cache is an in-process Map keyed partly by
// attacker-influenced input (household code + idempotency key). Without a hard
// size cap, many unique keys would grow it until the single Bun process OOMs —
// a full-service DoS. setIdempotent() GCs expired entries and then evicts
// oldest-first to keep the Map at/under RSVP_IDEMPOTENCY_MAX. These tests pin
// that bound directly (via a test-only hook) and confirm eviction is FIFO.

import "../setup";

import { describe, expect, test } from "bun:test";
import { __rsvpIdempotencyTestHook as cache } from "../../src/routes/rsvp";

function entry() {
  return { status: 200, body: "x", expiresAt: Date.now() + 5 * 60 * 1000 };
}

describe("RSVP idempotency cache is bounded", () => {
  test("size never exceeds RSVP_IDEMPOTENCY_MAX even after a flood of unique keys", () => {
    cache.clear();
    // Insert well past the cap with non-expiring entries so GC can't help —
    // only the size-based eviction keeps it bounded.
    for (let i = 0; i < cache.MAX + 2_000; i++) {
      cache.set(`flood-${i}`, entry());
    }
    expect(cache.size()).toBeLessThanOrEqual(cache.MAX);
    // The most-recently-inserted key survived; an early one was evicted (FIFO).
    expect(cache.has(`flood-${cache.MAX + 1_999}`)).toBe(true);
    expect(cache.has("flood-0")).toBe(false);
    cache.clear();
  });

  test("under the cap, entries are retained (no premature eviction)", () => {
    cache.clear();
    for (let i = 0; i < 100; i++) cache.set(`small-${i}`, entry());
    expect(cache.size()).toBe(100);
    expect(cache.has("small-0")).toBe(true);
    expect(cache.has("small-99")).toBe(true);
    cache.clear();
  });
});
