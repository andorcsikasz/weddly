// `users.locale`-aware email rendering. The template now picks single-card
// HU or EN based on the recipient's locale, falling back to bilingual when
// the locale is unknown (guests + pre-feature users).
//
// We exercise both layers:
//   - `renderEmail()` purely — given HU/EN blocks + a locale, does the output
//     include/exclude the right copy?
//   - the dispatcher path — does `sendKind` actually pick up `users.locale`
//     from the DB and pass it through to the renderer?

import "../setup";

import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { sendKind } from "../../src/domain/emails";
import { buildEmail } from "../../src/domain/emails/templates";
import { renderEmail } from "../../src/domain/emails/template";
import { localeForCountry } from "../../src/domain/vendor_campaign";
import { localeForVendor } from "../../src/domain/vendor_review_campaign";
import { bootstrapCouple, wipeAll } from "../helpers";

const HU = {
  greeting: "Szia Anna!",
  paragraphs: ["Köszönjük a jelentkezést.", "Hamarosan válaszolunk."],
  cta: "Megnyitás",
  footnote: "A link 7 napig érvényes.",
};
const EN = {
  greeting: "Hi Anna,",
  paragraphs: ["Thanks for signing up.", "We'll be in touch shortly."],
  cta: "Open",
  footnote: "Link valid for 7 days.",
};

describe("renderEmail: recipient locale branching", () => {
  test("recipientLocale='hu' renders HU-only — text excludes the EN block entirely", () => {
    const r = renderEmail({
      hu: HU,
      en: EN,
      ctaUrl: "https://weddly.hu/x",
      category: "transactional",
      recipientLocale: "hu",
    });
    expect(r.text).toContain("Szia Anna!");
    expect(r.text).toContain("Köszönjük a jelentkezést");
    expect(r.text).not.toContain("Hi Anna,");
    expect(r.text).not.toContain("Thanks for signing up");
    // Bilingual separator only shows when the renderer printed both blocks.
    expect(r.text).not.toContain("— — —");
    // HTML follows suit.
    expect(r.html).toContain("Szia Anna!");
    expect(r.html).not.toContain("Hi Anna,");
    // Footer in HU only.
    expect(r.text).toContain("Ezt a levelet a fiókoddal kapcsolatban kaptad.");
    expect(r.text).not.toContain("You got this email");
  });

  test("recipientLocale='en' renders EN-only — HU is absent", () => {
    const r = renderEmail({
      hu: HU,
      en: EN,
      ctaUrl: "https://weddly.hu/x",
      category: "transactional",
      recipientLocale: "en",
    });
    expect(r.text).toContain("Hi Anna,");
    expect(r.text).toContain("Thanks for signing up");
    expect(r.text).not.toContain("Szia Anna!");
    expect(r.text).not.toContain("Köszönjük a jelentkezést");
    expect(r.text).not.toContain("— — —");
    expect(r.html).toContain('html lang="en"');
    expect(r.html).toContain("Hi Anna,");
    expect(r.html).not.toContain("Szia Anna!");
    expect(r.text).toContain("You're getting this because");
    expect(r.text).not.toContain("Ezt a levelet a fiókoddal");
  });

  test("recipientLocale=null falls back to bilingual HU+EN (back-compat for guests)", () => {
    const r = renderEmail({
      hu: HU,
      en: EN,
      ctaUrl: "https://weddly.hu/x",
      category: "transactional",
      recipientLocale: null,
    });
    expect(r.text).toContain("Szia Anna!");
    expect(r.text).toContain("Hi Anna,");
    expect(r.text).toContain("· · ·");
    // Bilingual footer carries both languages.
    expect(r.text).toContain("Ezt a fiókoddal kapcsolatban kaptad.");
    expect(r.text).toContain("You're getting this");
    // HTML keeps the historical lang=hu attribute when leading with HU.
    expect(r.html).toContain('html lang="hu"');
  });

  test("recipientLocale omitted matches the null fallback (bilingual)", () => {
    const r = renderEmail({
      hu: HU,
      en: EN,
      ctaUrl: "https://weddly.hu/x",
      category: "transactional",
    });
    expect(r.text).toContain("Szia Anna!");
    expect(r.text).toContain("Hi Anna,");
  });

  test("lifecycle + unsubscribe token: footer language matches the picked locale", () => {
    const hu = renderEmail({
      hu: HU,
      en: EN,
      ctaUrl: "https://weddly.hu/x",
      category: "lifecycle",
      unsubscribeToken: "tok123",
      recipientLocale: "hu",
    });
    expect(hu.text).toContain("Leiratkozás");
    expect(hu.text).not.toContain("Unsubscribe");
    // The link stays, the invitation to use it does not: no "don't want these?"
    // question in front of the label, in either language.
    expect(hu.text).not.toContain("Nem kérsz emlékeztetőket");

    const en = renderEmail({
      hu: HU,
      en: EN,
      ctaUrl: "https://weddly.hu/x",
      category: "lifecycle",
      unsubscribeToken: "tok123",
      recipientLocale: "en",
    });
    expect(en.text).toContain("Unsubscribe");
    expect(en.text).not.toContain("Don't want updates");
    expect(en.text).not.toContain("Leiratkozás");
    expect(en.html).toContain("Unsubscribe");
    expect(en.html).not.toContain("Leiratkozás");
  });
});

describe("sendKind: picks up users.locale from the DB", () => {
  test("a user with locale='en' receives an EN-only welcome render path", async () => {
    wipeAll();
    await bootstrapCouple("locale-en@weddly.test");
    const userId = (
      db.prepare("SELECT id FROM users WHERE email = ?").get("locale-en@weddly.test") as
        | { id: number }
        | undefined
    )?.id as number;
    db.prepare("UPDATE users SET locale = 'en' WHERE id = ?").run(userId);

    // Fire any user-bound kind. The template doesn't have a render-snapshot
    // in email_log (only kind + status), but the test still proves the path:
    // any rendering crash from a bad locale-lookup would fail this call.
    const result = await sendKind(
      "verify_resend",
      { verifyUrl: "https://weddly.hu/verify-email/abc" },
      {
        user: {
          id: userId,
          email: "locale-en@weddly.test",
          full_name: "EN Locale",
        },
        couple_id: null,
      },
    );
    expect(result.status).toBe("skipped_no_provider");

    const row = db
      .prepare("SELECT kind, status FROM email_log WHERE user_id = ? ORDER BY id DESC LIMIT 1")
      .get(userId) as { kind: string; status: string } | undefined;
    expect(row?.kind).toBe("verify_resend");
  });

  test("a user with locale=null still gets the bilingual fallback (no crash on null lookup)", async () => {
    wipeAll();
    await bootstrapCouple("locale-null@weddly.test");
    const userId = (
      db.prepare("SELECT id FROM users WHERE email = ?").get("locale-null@weddly.test") as
        | { id: number }
        | undefined
    )?.id as number;
    // Explicit null wipe — bootstrap may have captured navigator.language.
    db.prepare("UPDATE users SET locale = NULL WHERE id = ?").run(userId);

    const result = await sendKind(
      "verify_resend",
      { verifyUrl: "https://weddly.hu/verify-email/xyz" },
      {
        user: {
          id: userId,
          email: "locale-null@weddly.test",
          full_name: "Null Locale",
        },
        couple_id: null,
      },
    );
    expect(result.status).toBe("skipped_no_provider");
  });

  test("a locale we ship no COPY for falls back to EN render — never bilingual", () => {
    // The fallback that lets a language be pointed at before every one of the
    // ~90 kinds has been translated. What must never happen is the bilingual
    // HU+EN stack: this recipient's language is KNOWN, it just has no card
    // here, and Hungarian is no more use to them than it is to an English
    // reader.
    const r = renderEmail({
      hu: HU,
      en: EN,
      ctaUrl: "https://weddly.hu/x",
      category: "transactional",
      recipientLocale: "de",
    });
    expect(r.text).toContain("Hi Anna,");
    expect(r.text).not.toContain("Szia");
  });

  test("a locale WITH copy renders its own card, and only that card", () => {
    const r = renderEmail({
      hu: HU,
      en: EN,
      extra: {
        de: {
          greeting: "Hallo Anna,",
          paragraphs: ["Danke für Ihre Anmeldung.", "Wir melden uns in Kürze."],
          cta: "Öffnen",
        },
      },
      ctaUrl: "https://weddly.hu/x",
      category: "transactional",
      recipientLocale: "de",
    });
    expect(r.text).toContain("Hallo Anna,");
    expect(r.text).toContain("Danke für Ihre Anmeldung");
    // Neither of the two languages it is NOT.
    expect(r.text).not.toContain("Szia Anna!");
    expect(r.text).not.toContain("Hi Anna,");
  });

  test("the footer speaks the card's language, not Hungarian by default", () => {
    // The regression this pins: the footer's unsubscribe / preferences labels
    // used to be `bilingual ? … : onlyEn ? … : hu`, so EVERY locale added after
    // HU and EN dropped into the Hungarian branch. A German lifecycle mail
    // would have ended on "Leiratkozás".
    const de = renderEmail({
      hu: HU,
      en: EN,
      extra: { de: { greeting: "Hallo,", paragraphs: ["Text."], cta: "Öffnen" } },
      ctaUrl: "https://weddly.hu/x",
      category: "lifecycle",
      unsubscribeToken: "tok",
      recipientLocale: "de",
    });
    expect(de.text).toContain("Abmelden");
    expect(de.text).not.toContain("Leiratkozás");

    const hr = renderEmail({
      hu: HU,
      en: EN,
      extra: { hr: { greeting: "Pozdrav,", paragraphs: ["Tekst."], cta: "Otvorite" } },
      ctaUrl: "https://weddly.hu/x",
      category: "lifecycle",
      unsubscribeToken: "tok",
      recipientLocale: "hr",
    });
    expect(hr.text).toContain("Odjava s liste");
    expect(hr.text).not.toContain("Leiratkozás");

    // A locale with a card but no footer entry of its own still must not read
    // Hungarian — English is the fallback everywhere in the chrome.
    const es = renderEmail({
      hu: HU,
      en: EN,
      ctaUrl: "https://weddly.hu/x",
      category: "lifecycle",
      unsubscribeToken: "tok",
      recipientLocale: "es",
    });
    expect(es.text).not.toContain("Leiratkozás");
  });
});

// The country → language rule the claim campaign writes by. It is the same
// table the listing editor labels its description box from, which is what
// makes "we write to you in Croatian" and "we ask you to write Croatian"
// the same decision rather than two that can drift.
describe("who gets written to in which language", () => {
  test("a listing's country picks the mail language, not just HU-or-English", () => {
    expect(localeForCountry("HU")).toBe("hu");
    expect(localeForCountry("HR")).toBe("hr");
    expect(localeForCountry("DE")).toBe("de");
    expect(localeForCountry("AT")).toBe("de");
    expect(localeForCountry("ES")).toBe("es");
    // A country whose language we ship no UI for still gets English rather
    // than a Hungarian mail nobody in the office can read — the original point
    // of the rule, preserved.
    expect(localeForCountry("SK")).toBe("en");
    expect(localeForCountry("FR")).toBe("en");
  });

  test("a claimed vendor's own account language outranks their country", () => {
    // They picked it themselves, which beats anything geography implies.
    expect(localeForVendor("de", "HR")).toBe("de");
    expect(localeForVendor("hu-HU", "DE")).toBe("hu");
    // No account locale captured → fall through to the country.
    expect(localeForVendor(null, "HR")).toBe("hr");
    // A language we do not ship is not honoured, it is not a card we have.
    expect(localeForVendor("fr", "HR")).toBe("en");
  });

  test("the Croatian claim campaign actually renders in Croatian", () => {
    // End to end through the real builder: this is the mail going to the
    // Croatian listings in the directory, and the thing that would silently
    // regress is the copy being present but never selected.
    const built = buildEmail(
      "vendor_claim_campaign",
      {
        listingName: "Studio Jadran",
        categoryLabel: "Fotograf",
        city: "Split",
        inviteUrl: "https://weddly.test/r/vendor-invite/tok",
        monthlyVisitors: 5000,
        freeMonths: 12,
        locale: "hr",
      },
      { recipientName: "Ivan", recipientLocale: "hr" },
    );
    expect(built.subject).toContain("je već na Weddlyju");
    expect(built.rendered.text).toContain("Preuzmite profil");
    expect(built.rendered.text).not.toContain("Take over your profile");
    expect(built.rendered.text).not.toContain("Profil átvétele");
  });
});
