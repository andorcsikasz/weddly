// Pure logic behind the share-Weddly prompt: the language rule and the
// automatic-trigger math. Both are the kind of decision that a locale flip or
// an off-by-one in the session count silently breaks, so they're pinned here
// without any rendering.

import { describe, expect, it } from "bun:test";
import {
  ACTIONS_REQUIRED,
  SESSIONS_REQUIRED,
  type ShareActivity,
  shouldAutoOpenShare,
} from "@/lib/share_activity";
import { shareLanguage, splitShareMessage, SHARE_URL } from "@/lib/share_weddly";

describe("shareLanguage", () => {
  it("uses English only for the English interface", () => {
    expect(shareLanguage("en")).toBe("en");
  });

  it("uses Hungarian for the Hungarian interface", () => {
    expect(shareLanguage("hu")).toBe("hu");
  });

  it("falls back to Hungarian when the locale is unresolved", () => {
    expect(shareLanguage(null)).toBe("hu");
    expect(shareLanguage(undefined)).toBe("hu");
  });
});

describe("splitShareMessage", () => {
  it("lifts the URL out of the text so native share doesn't duplicate it", () => {
    const msg = `We're planning our wedding with Weddly: ${SHARE_URL}`;
    const { text, url } = splitShareMessage(msg);
    expect(url).toBe(SHARE_URL);
    expect(text).not.toContain(SHARE_URL);
    // The trailing colon that introduced the link is trimmed too.
    expect(text).toBe("We're planning our wedding with Weddly");
  });
});

function activity(over: Partial<ShareActivity> = {}): ShareActivity {
  return { uid: 1, sessions: 0, actions: 0, seen: false, ...over };
}

describe("shouldAutoOpenShare", () => {
  it("never fires once the server latch is set", () => {
    expect(shouldAutoOpenShare(activity({ sessions: SESSIONS_REQUIRED }), true)).toBe(false);
  });

  it("never fires once the local mirror is set", () => {
    expect(shouldAutoOpenShare(activity({ sessions: SESSIONS_REQUIRED, seen: true }), false)).toBe(
      false,
    );
  });

  it("fires on the third session on its own", () => {
    expect(shouldAutoOpenShare(activity({ sessions: SESSIONS_REQUIRED }), false)).toBe(true);
  });

  it("does not fire in the first session, even with the edits done", () => {
    // The "not immediately after registration" guard: three edits in session 1
    // (a busy onboarding) must not trip the prompt.
    expect(shouldAutoOpenShare(activity({ sessions: 1, actions: ACTIONS_REQUIRED }), false)).toBe(
      false,
    );
  });

  it("fires on the action path once past the first session", () => {
    expect(shouldAutoOpenShare(activity({ sessions: 2, actions: ACTIONS_REQUIRED }), false)).toBe(
      true,
    );
  });

  it("stays quiet below both thresholds", () => {
    expect(shouldAutoOpenShare(activity({ sessions: 2, actions: 1 }), false)).toBe(false);
  });
});
