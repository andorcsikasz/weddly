// The "come back to this vendor after you sign up" memory. The rule that
// matters is what it refuses: the destination is an allowlist of ONE shape (an
// in-app vendor page), so a poisoned value in storage can never become an open
// redirect, and it is handed back exactly once.

import { beforeEach, describe, expect, it } from "bun:test";
import {
  isSafeDestination,
  rememberDestination,
  takeDestination,
} from "@/lib/post_signup_destination";

const KEY = "weddly.post_signup_destination";
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* happy-dom without storage, ignore */
  }
});

describe("isSafeDestination", () => {
  it("accepts an in-app vendor page, bare or pretty", () => {
    expect(isSafeDestination("/app/suppliers/v12")).toBe(true);
    expect(isSafeDestination("/app/suppliers/magyar-foto-v12")).toBe(true);
    expect(isSafeDestination("/app/suppliers/oreg-tolgy-kastely-fogado-c17")).toBe(true);
  });

  it("refuses everything that is not exactly that", () => {
    for (const bad of [
      "https://evil.example/app/suppliers/v12",
      "//evil.example",
      "/app",
      "/app/suppliers",
      "/app/suppliers/",
      "/app/suppliers/v12/../../admin",
      "/app/suppliers/..",
      "/app/suppliers/.",
      "/app/suppliers/v12?next=//evil.example",
      "/app/admin/users",
      "javascript:alert(1)",
      "/app/suppliers/" + "a".repeat(121),
      "",
      null,
      42,
    ]) {
      expect(isSafeDestination(bad)).toBe(false);
    }
  });
});

describe("remember + take", () => {
  it("hands the destination back exactly once", () => {
    rememberDestination("/app/suppliers/magyar-foto-v12");
    expect(takeDestination()).toBe("/app/suppliers/magyar-foto-v12");
    expect(takeDestination()).toBeNull();
  });

  it("never stores something unsafe in the first place", () => {
    rememberDestination("https://evil.example");
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(takeDestination()).toBeNull();
  });

  it("forgets a destination after a week", () => {
    const start = 1_800_000_000_000;
    rememberDestination("/app/suppliers/v12", start);
    expect(takeDestination(start + 8 * DAY)).toBeNull();

    rememberDestination("/app/suppliers/v12", start);
    expect(takeDestination(start + 6 * DAY)).toBe("/app/suppliers/v12");
  });

  it("ignores, and clears, a value it would never have written", () => {
    localStorage.setItem(KEY, JSON.stringify({ path: "https://evil.example", at: Date.now() }));
    expect(takeDestination()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();

    localStorage.setItem(KEY, "not json at all");
    expect(takeDestination()).toBeNull();

    localStorage.setItem(KEY, JSON.stringify({ path: "/app/suppliers/v12" }));
    expect(takeDestination()).toBeNull();
  });
});
