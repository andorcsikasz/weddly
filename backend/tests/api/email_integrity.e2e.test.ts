import "../setup";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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

// No email of ours talks the reader out of being here. On LIFECYCLE mail the
// unsubscribe link and the List-Unsubscribe header stay exactly where they are,
// but body copy never points at them, never invites the reader to ignore the
// mail, and never mentions deleting an account as an option. "If this wasn't
// you, ignore this" on a security/verify mail is a different thing and stays:
// it is anti-phishing copy, not an exit sign. Campaign mail carries neither the
// link nor the header any more, which the describe block at the bottom guards.
describe("email copy: nothing that talks the reader out of staying", () => {
  const BANNED: Array<{ pattern: RegExp; why: string }> = [
    { pattern: /leiratkozhat/i, why: "offers the reader an unsubscribe" },
    { pattern: /iratkozz le/i, why: "tells the reader to unsubscribe" },
    { pattern: /leiratkozás lent/i, why: "points at the unsubscribe link" },
    { pattern: /nem kérsz emlékeztetőket/i, why: "asks whether they want out" },
    { pattern: /you can unsubscribe/i, why: "offers the reader an unsubscribe" },
    { pattern: /unsubscribe (below|here|from)/i, why: "points at the unsubscribe link" },
    { pattern: /don't want updates/i, why: "asks whether they want out" },
    { pattern: /(you can |can )?opt out (of|from)/i, why: "offers the reader an opt-out" },
    { pattern: /not (a good time|the right time)\?/i, why: "hands the reader a reason to leave" },
    { pattern: /ha most nem (alkalmas|aktuális)/i, why: "hands the reader a reason to leave" },
    { pattern: /nem zavarunk/i, why: "frames our own mail as a nuisance" },
    { pattern: /törölheted a fiókod/i, why: "suggests deleting the account" },
    { pattern: /delete your account/i, why: "suggests deleting the account" },
  ];

  // Only string literals are checked; a code comment explaining WHY a rule
  // exists (including the deletion-countdown mail's own rationale) must stay
  // writable, so comments are stripped before the scan.
  const STRING_LITERAL = /"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  for (const file of ["template.ts", "templates.ts"]) {
    test(`${file} carries no unsubscribe / opt-out / delete-account nudges`, () => {
      const src = stripComments(
        readFileSync(join(import.meta.dir, "..", "..", "src", "domain", "emails", file), "utf8"),
      );
      const hits: string[] = [];
      for (const m of src.matchAll(STRING_LITERAL)) {
        const literal = m[1] ?? m[2] ?? "";
        for (const { pattern, why } of BANNED) {
          if (pattern.test(literal)) hits.push(`  ${why}: "${literal.slice(0, 120)}"`);
        }
      }
      if (hits.length > 0) {
        throw new Error(`Email copy in ${file} nudges the reader away:\n${hits.join("\n")}`);
      }
      expect(hits.length).toBe(0);
    });
  }
});

// The offer is hospitality, never a price of zero. "Ingyen" / "free" / "gratis"
// makes the product read as a giveaway, and the cap number ("the first 200")
// turns a welcome into a queue, so outbound copy says who we are hosting and
// for how long instead. Same rule the locale files follow.
describe("email copy: the offer is hospitality, not a price of zero", () => {
  const BANNED: Array<{ pattern: RegExp; why: string }> = [
    { pattern: /ingyen/i, why: "says the price is zero" },
    { pattern: /\bfree\b/i, why: "says the price is zero" },
    { pattern: /\bgratis\b/i, why: "says the price is zero" },
    { pattern: /bankkártya nélkül/i, why: "leads with what the reader avoids paying" },
    { pattern: /no card (needed|required)/i, why: "leads with what the reader avoids paying" },
    { pattern: /(első|az első) 200/i, why: "fronts the cap instead of the welcome" },
    { pattern: /first 200/i, why: "fronts the cap instead of the welcome" },
  ];
  // `freeUntilHu` / `freeUntilEn` are payload FIELD names, and "free-text" /
  // "free-form" describe an input, not a price. Both are code, not copy.
  const NOT_COPY = /freeUntil|free-(text|form)|free window|UTM-free/i;
  const STRING_LITERAL = /"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("templates.ts never prices the offer at zero", () => {
    const src = stripComments(
      readFileSync(
        join(import.meta.dir, "..", "..", "src", "domain", "emails", "templates.ts"),
        "utf8",
      ),
    );
    const hits: string[] = [];
    for (const m of src.matchAll(STRING_LITERAL)) {
      const literal = m[1] ?? m[2] ?? "";
      if (NOT_COPY.test(literal)) continue;
      for (const { pattern, why } of BANNED) {
        if (pattern.test(literal)) hits.push(`  ${why}: "${literal.slice(0, 120)}"`);
      }
    }
    if (hits.length > 0) {
      throw new Error(`Email copy prices the offer at zero:\n${hits.join("\n")}`);
    }
    expect(hits.length).toBe(0);
  });
});

// Campaign (outreach) mail offers no way out at all, by owner decision on
// 2026-07-28: no unsubscribe link in the body, and no List-Unsubscribe header
// for a mail client to build its own button from. That header used to be fed by
// a caller-supplied `listUnsubscribeUrl` on SendTarget, so the guard here is
// that the field is gone AND that both header writes still sit inside the
// lifecycle-only branch. What deliberately stays: `email_optouts` suppression
// (the addresses that already opted out must never be mailed again) and the
// `/api/emails/optout-*` routes, because mail already delivered links to them.
describe("campaign mail offers no exit", () => {
  const emailsDir = join(import.meta.dir, "..", "..", "src", "domain", "emails");
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("only lifecycle mail attaches List-Unsubscribe", () => {
    const src = stripComments(readFileSync(join(emailsDir, "send.ts"), "utf8"));
    // The whole campaign path went through this one field.
    expect(src).not.toContain("listUnsubscribeUrl");
    // Both writes, and only those two, live under the lifecycle guard.
    const writes = [...src.matchAll(/extraHeaders\["List-Unsubscribe(?:-Post)?"\]/g)];
    expect(writes.length).toBe(2);
    const guard = /if \(category === "lifecycle" && unsubscribeToken\) \{([\s\S]*?)\n {2}\}/.exec(
      src,
    );
    expect(guard).not.toBeNull();
    expect(guard?.[1]).toContain('extraHeaders["List-Unsubscribe"]');
    expect(guard?.[1]).toContain('extraHeaders["List-Unsubscribe-Post"]');
  });

  test("no template renders an opt-out link", () => {
    const src = stripComments(readFileSync(join(emailsDir, "templates.ts"), "utf8"));
    expect(src).not.toContain("optOutUrl");
  });
});
