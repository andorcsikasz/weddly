// The request logger masks capability tokens that travel in the URL path before
// the line is forwarded to a third-party log service. See lib/log_redact.ts.

import "../setup";

import { describe, expect, test } from "bun:test";
import { redactTokensInPath } from "../../src/lib/log_redact";

describe("log token redaction", () => {
  const tok = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"; // 32-char minted-token shape

  test("masks high-entropy token segments across every token-in-path route", () => {
    expect(redactTokensInPath(`/api/auth/verify/${tok}`)).toBe("/api/auth/verify/[token]");
    expect(redactTokensInPath(`/api/auth/change-email/${tok}`)).toBe(
      "/api/auth/change-email/[token]",
    );
    expect(redactTokensInPath(`/api/photo-albums/${tok}/photos`)).toBe(
      "/api/photo-albums/[token]/photos",
    );
    expect(redactTokensInPath(`/api/planner/activation/${tok}`)).toBe(
      "/api/planner/activation/[token]",
    );
    expect(redactTokensInPath(`/api/invites/${tok}/accept`)).toBe("/api/invites/[token]/accept");
    expect(redactTokensInPath(`/r/vendor-invite/${tok}`)).toBe("/r/vendor-invite/[token]");
    // the <id>.<hmac> opt-out shape (contains a dot)
    expect(redactTokensInPath("/api/emails/optout-onboarding/5.a1b2c3d4e5f6a7b8c9d0e1f2")).toBe(
      "/api/emails/optout-onboarding/[token]",
    );
  });

  test("leaves ordinary short segments (ids, slugs, codes, endpoints) untouched", () => {
    expect(redactTokensInPath("/api/guests/42")).toBe("/api/guests/42");
    expect(redactTokensInPath("/api/couples/current")).toBe("/api/couples/current");
    expect(redactTokensInPath("/w/andor-and-sari")).toBe("/w/andor-and-sari");
    expect(redactTokensInPath("/rsvp/8BM95ZY0")).toBe("/rsvp/8BM95ZY0"); // 8-char check-in code
    expect(redactTokensInPath("/api/admin/onboarding-campaigns")).toBe(
      "/api/admin/onboarding-campaigns",
    );
  });
});
