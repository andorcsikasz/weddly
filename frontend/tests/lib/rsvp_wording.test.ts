// The RSVP wording builder: every language/format/tone renders, blanks stay
// visibly blank, and a date that ends in a period never prints two.

import { describe, expect, it } from "bun:test";
import { UI_LOCALES } from "@shared/locales";
import { buildRsvpText, RSVP_FORMATS, RSVP_TONES, type RsvpInput } from "@/lib/rsvp_wording";

const FILLED: RsvpInput = {
  partnerA: "Kata",
  partnerB: "Máté",
  date: "2027-06-12",
  time: "15:00",
  venue: "Normafa",
  deadline: "2027-05-01",
  contact: "+36 30 123 4567",
  plusOne: true,
  dietary: true,
  adultsOnly: false,
};

describe("buildRsvpText", () => {
  it("renders every language, format and tone with the couple, venue and contact", () => {
    for (const lang of UI_LOCALES) {
      for (const format of RSVP_FORMATS) {
        for (const tone of RSVP_TONES) {
          const text = buildRsvpText(lang, format, tone, FILLED);
          expect(text).toContain("Kata");
          expect(text).toContain("+36 30 123 4567");
          if (format !== "reminder") expect(text).toContain("Normafa");
          expect(text).not.toMatch(/(?<!\.)\.\.(?!\.)/);
          expect(text).not.toContain("undefined");
        }
      }
    }
  });

  it("keeps empty fields as a visible blank and falls back to sample names", () => {
    const text = buildRsvpText("en", "invitation", "formal", {
      ...FILLED,
      partnerA: "",
      partnerB: "",
      date: "",
      time: "",
      venue: "",
      contact: "",
    });
    expect(text).toContain("Anna and Bence");
    expect(text).toContain("When: ______");
    expect(text).not.toContain("Reply to");
  });

  it("adds the optional lines only when switched on", () => {
    const on = buildRsvpText("en", "invitation", "casual", { ...FILLED, adultsOnly: true });
    expect(on).toContain("adults-only");
    expect(on).toContain("plus-one");
    const off = buildRsvpText("en", "invitation", "casual", {
      ...FILLED,
      plusOne: false,
      dietary: false,
    });
    expect(off).not.toContain("plus-one");
    expect(off).not.toContain("dietary");
  });
});
