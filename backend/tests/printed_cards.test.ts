import { describe, expect, test } from "bun:test";
import { resolveDesign } from "@shared/design";
import {
  buildPrintableCardDocument,
  formatPrintCardTime,
  PRINT_CARD_REGISTRY,
  PRINT_CARD_TYPES,
  printCardDefinition,
  weddingTimezoneForCountry,
  type PrintableCardSource,
} from "@shared/print_cards";

const base = {
  workspaceId: "workspace-17",
  eventId: "event-42",
  dataRevision: "rev-9",
  locale: "hu",
  timezone: "Europe/Budapest",
  theme: resolveDesign(null),
  coupleName: "Andor & Sári",
  brideName: "Sári",
  groomName: "Andor",
  weddingDate: "2027-05-29",
  venueName: "Árvíztűrő Udvar",
  venueCity: "Győr",
} satisfies Omit<PrintableCardSource, "cardType">;

describe("printed-card registry", () => {
  test("maps all six card types exhaustively to their own endpoints", () => {
    expect(Object.keys(PRINT_CARD_REGISTRY)).toEqual([...PRINT_CARD_TYPES]);
    expect(PRINT_CARD_REGISTRY).toMatchObject({
      place_card: { endpoint: "/api/print/place-cards", page: "a4-batch" },
      table_number: { endpoint: "/api/print/table-numbers", page: "a6" },
      menu: { endpoint: "/api/print/menu", page: "a5" },
      invitation: { endpoint: "/api/print/invitation", page: "a5" },
      thank_you: { endpoint: "/api/print/thank-you", page: "a6" },
      schedule: { endpoint: "/api/print/schedule-card", page: "a5" },
    });
    expect(PRINT_CARD_REGISTRY.schedule.endpoint).not.toBe("/api/print/schedule");
  });

  test("rejects unknown ids instead of falling back to another export", () => {
    expect(() => printCardDefinition("run_of_show")).toThrow(
      "Unknown printed-card type: run_of_show",
    );
  });
});

describe("workspace data -> canonical printed-card document", () => {
  test("uses real couple/date/venue/menu/schedule data with Hungarian formatting", () => {
    const invitation = buildPrintableCardDocument({ ...base, cardType: "invitation" });
    expect(invitation.content).toMatchObject({
      coupleName: "Andor & Sári",
      date: "2027. május 29.",
      venue: "Árvíztűrő Udvar, Győr",
    });

    const menu = buildPrintableCardDocument({
      ...base,
      cardType: "menu",
      menuCourses: [{ title: "Előétel", lines: ["Gulyás leves újházi módra", "ŐRÜLT ÁRVÍZTŰRŐ"] }],
    });
    expect(menu.content.courses[0]).toEqual({
      title: "Előétel",
      lines: ["Gulyás leves újházi módra", "ŐRÜLT ÁRVÍZTŰRŐ"],
    });

    const schedule = buildPrintableCardDocument({
      ...base,
      cardType: "schedule",
      schedule: [
        { id: 2, label: "Gyertyafényes vacsora", starts_at_minutes: 19 * 60 + 15 },
        {
          id: 1,
          label: "Naplementés fogadalom",
          starts_at_minutes: 16 * 60 + 45,
          is_key_moment: true,
        },
      ],
    });
    expect(schedule.content.entries).toEqual([
      { id: 1, time: "16:45", label: "Naplementés fogadalom" },
    ]);

    const serialized = JSON.stringify([invitation, menu, schedule]);
    expect(serialized).not.toContain("Anna & Bence");
    expect(serialized).not.toContain("20 June 2027");
    expect(serialized).not.toContain("Ceremony");
  });

  test("renders explicit localized empty states, never plausible demo data", () => {
    const emptyBase = {
      ...base,
      coupleName: null,
      brideName: null,
      groomName: null,
      weddingDate: null,
      venueName: null,
      venueCity: null,
    };
    expect(
      buildPrintableCardDocument({ ...emptyBase, cardType: "place_card" }).content,
    ).toMatchObject({ guestName: "Nincs kiválasztott vendég", isEmpty: true });
    expect(buildPrintableCardDocument({ ...emptyBase, cardType: "menu" }).content).toMatchObject({
      coupleName: "A pár neve nincs megadva",
      date: "",
      emptyMessage: "Még nincs megadott menü",
      isEmpty: true,
    });
    expect(
      buildPrintableCardDocument({ ...emptyBase, cardType: "schedule" }).content,
    ).toMatchObject({ entries: [], emptyMessage: "Még nincs programpont", isEmpty: true });
  });

  test("normalizes time boundaries and country timezones", () => {
    expect(formatPrintCardTime(-1)).toBe("23:59");
    expect(formatPrintCardTime(0)).toBe("00:00");
    expect(formatPrintCardTime(24 * 60 + 5)).toBe("00:05+1");
    expect(weddingTimezoneForCountry("HU")).toBe("Europe/Budapest");
    expect(weddingTimezoneForCountry("hr")).toBe("Europe/Zagreb");
    expect(weddingTimezoneForCountry(undefined)).toBe("UTC");
  });

  test("formats long dates for every supported locale", () => {
    const expected = {
      en: "May 29, 2027",
      hu: "2027. május 29.",
      es: "29 de mayo de 2027",
      hr: "29. svibnja 2027.",
      de: "29. Mai 2027",
    } as const;
    for (const [locale, date] of Object.entries(expected)) {
      const doc = buildPrintableCardDocument({
        ...base,
        locale: locale as keyof typeof expected,
        cardType: "thank_you",
      });
      expect(doc.content.date).toBe(date);
    }
  });
});
