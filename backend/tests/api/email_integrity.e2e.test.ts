import "../setup";

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { scanEmailIntegrity } from "../../src/domain/emails/integrity_check";

describe("email integrity scan", () => {
  test("no module outside the central dispatcher imports sendEmail directly", () => {
    // setup.ts lives at backend/tests/setup.ts; the repo root is two levels up.
    const repoRoot = join(import.meta.dir, "..", "..", "..");
    const violations = scanEmailIntegrity(repoRoot);
    if (violations.length > 0) {
      const printable = violations.map((v) => `  ${v.path} — ${v.reason}`).join("\n");
      throw new Error(
        `sendEmail() should only be called from domain/emails/send.ts. Found:\n${printable}\n` +
          `Switch the call to sendKind(...) from domain/emails to inherit the branded shell.`,
      );
    }
    expect(violations.length).toBe(0);
  });
});
