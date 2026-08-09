import "../setup";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scanEmailIntegrity } from "../../src/domain/emails/integrity_check";
import { renderEmail } from "../../src/domain/emails/template";

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

// No email of ours talks the reader out of being here. "If this wasn't you,
// ignore this" on security/verify mail is different and stays: it is
// anti-phishing copy, not an exit sign.
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

describe("unsubscribe controls stay out of campaign messages", () => {
  const emailsDir = join(import.meta.dir, "..", "..", "src", "domain", "emails");
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("the dispatcher omits List-Unsubscribe headers", () => {
    const src = stripComments(readFileSync(join(emailsDir, "send.ts"), "utf8"));
    expect(src).not.toContain("List-Unsubscribe");
    expect(src).not.toContain("outreachUnsubscribeUrl");
  });

  test("the shared template hides the outreach opt-out URL", () => {
    const templateSource = stripComments(readFileSync(join(emailsDir, "template.ts"), "utf8"));
    const rendered = renderEmail({
      hu: { greeting: "Szia!", paragraphs: ["Bemutatkozás."], cta: "Megnyitás" },
      en: { greeting: "Hi!", paragraphs: ["Introduction."], cta: "Open" },
      ctaUrl: "https://weddly.test/open",
      category: "outreach",
      recipientLocale: "hu",
    });
    expect(templateSource).not.toContain("outreachUnsubscribeUrl");
    expect(rendered.text).not.toContain("Leiratkozás");
  });
});
