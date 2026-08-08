// Canonical model + registry for Design -> Printed cards.
//
// The browser preview and the server-side pdf-lib renderer both consume this
// document. Preview-only scaling belongs in the React component; demo copy and
// endpoint selection do not belong in either renderer.

import type { CoupleDesign } from "./design";
import { formatWeddingDate } from "./design";
import type { UiLocale } from "./locales";
import type { MenuCourse } from "./types";
import { pickKeyMoments } from "./schedule";

export const PRINT_CARD_TYPES = [
  "place_card",
  "table_number",
  "menu",
  "invitation",
  "thank_you",
  "schedule",
] as const;

export type PrintCardType = (typeof PRINT_CARD_TYPES)[number];

export interface PrintCardDefinition {
  cardType: PrintCardType;
  endpoint: string;
  filename: string;
  page: "a4-batch" | "a5" | "a6";
}

/** One exhaustive registry. Unknown ids never fall through to another export. */
export const PRINT_CARD_REGISTRY: Readonly<Record<PrintCardType, PrintCardDefinition>> = {
  place_card: {
    cardType: "place_card",
    endpoint: "/api/print/place-cards",
    filename: "weddly-place-card.pdf",
    page: "a4-batch",
  },
  table_number: {
    cardType: "table_number",
    endpoint: "/api/print/table-numbers",
    filename: "weddly-table-number.pdf",
    page: "a6",
  },
  menu: {
    cardType: "menu",
    endpoint: "/api/print/menu",
    filename: "weddly-menu.pdf",
    page: "a5",
  },
  invitation: {
    cardType: "invitation",
    endpoint: "/api/print/invitation",
    filename: "weddly-invitation.pdf",
    page: "a5",
  },
  thank_you: {
    cardType: "thank_you",
    endpoint: "/api/print/thank-you",
    filename: "weddly-thank-you.pdf",
    page: "a6",
  },
  schedule: {
    cardType: "schedule",
    // Intentionally NOT /api/print/schedule. That endpoint is the operational
    // A4 Run of show used by the Schedule page.
    endpoint: "/api/print/schedule-card",
    filename: "weddly-schedule-card.pdf",
    page: "a5",
  },
};

export function isPrintCardType(value: unknown): value is PrintCardType {
  return typeof value === "string" && (PRINT_CARD_TYPES as readonly string[]).includes(value);
}

export function printCardDefinition(value: unknown): PrintCardDefinition {
  if (!isPrintCardType(value)) throw new Error(`Unknown printed-card type: ${String(value)}`);
  return PRINT_CARD_REGISTRY[value];
}

export interface PrintCardScheduleEntry {
  id: number | string;
  label: string;
  starts_at_minutes: number;
  is_key_moment?: boolean;
}

export interface PrintableCardSource {
  cardType: PrintCardType;
  workspaceId: string;
  eventId: string;
  dataRevision: string;
  locale: UiLocale;
  timezone: string;
  theme: CoupleDesign;
  coupleName: string | null;
  brideName: string | null;
  groomName: string | null;
  weddingDate: string | null;
  venueName: string | null;
  venueCity: string | null;
  guestName?: string | null;
  guestTableLabel?: string | null;
  tableLabel?: string | null;
  menuCourses?: readonly MenuCourse[];
  schedule?: readonly PrintCardScheduleEntry[];
}

interface CardDocumentBase<T extends PrintCardType, C> {
  cardType: T;
  workspaceId: string;
  eventId: string;
  dataRevision: string;
  locale: UiLocale;
  timezone: string;
  theme: CoupleDesign;
  content: C;
}

export type PrintableCardDocument =
  | CardDocumentBase<"place_card", { guestName: string; tableLabel: string; isEmpty: boolean }>
  | CardDocumentBase<"table_number", { tableLabel: string; footer: string; isEmpty: boolean }>
  | CardDocumentBase<
      "menu",
      {
        heading: string;
        coupleName: string;
        date: string;
        courses: readonly MenuCourse[];
        emptyCourseLabels: readonly string[];
        emptyMessage: string;
        isEmpty: boolean;
      }
    >
  | CardDocumentBase<
      "invitation",
      {
        eyebrow: string;
        coupleName: string;
        line: string;
        date: string;
        venue: string;
        rsvp: string;
        isEmpty: boolean;
      }
    >
  | CardDocumentBase<
      "thank_you",
      { heading: string; line: string; coupleName: string; date: string; isEmpty: boolean }
    >
  | CardDocumentBase<
      "schedule",
      {
        heading: string;
        coupleName: string;
        date: string;
        entries: readonly { id: number | string; time: string; label: string }[];
        emptyMessage: string;
        isEmpty: boolean;
      }
    >;

interface PrintCardCopy {
  table: string;
  menu: string;
  menuCourses: readonly [string, string, string];
  invitationEyebrow: string;
  invitationLine: string;
  thankYou: string;
  thankYouLine: string;
  schedule: string;
  emptyGuest: string;
  emptyTable: string;
  emptyMenu: string;
  emptySchedule: string;
  emptyNames: string;
}

/** Fixed card copy is shared with the PDF instead of duplicated in frontend i18n. */
export const PRINT_CARD_COPY: Readonly<Record<UiLocale, PrintCardCopy>> = {
  en: {
    table: "table",
    menu: "Menu",
    menuCourses: ["Starter", "Main course", "Dessert"],
    invitationEyebrow: "Together with their families",
    invitationLine: "invite you to celebrate",
    thankYou: "Thank you",
    thankYouLine: "for celebrating with us",
    schedule: "Schedule",
    emptyGuest: "No guest selected",
    emptyTable: "No tables yet",
    emptyMenu: "No menu added yet",
    emptySchedule: "No schedule items yet",
    emptyNames: "Couple names not set",
  },
  hu: {
    table: "asztal",
    menu: "Menü",
    menuCourses: ["Előétel", "Főétel", "Desszert"],
    invitationEyebrow: "Családjaikkal együtt",
    invitationLine: "szeretettel meghívnak",
    thankYou: "Köszönjük",
    thankYouLine: "hogy velünk ünnepeltetek",
    schedule: "Program",
    emptyGuest: "Nincs kiválasztott vendég",
    emptyTable: "Még nincs asztal",
    emptyMenu: "Még nincs megadott menü",
    emptySchedule: "Még nincs programpont",
    emptyNames: "A pár neve nincs megadva",
  },
  es: {
    table: "mesa",
    menu: "Menú",
    menuCourses: ["Entrante", "Plato principal", "Postre"],
    invitationEyebrow: "Junto a sus familias",
    invitationLine: "te invitan a celebrar",
    thankYou: "Gracias",
    thankYouLine: "por celebrarlo con nosotros",
    schedule: "Programa",
    emptyGuest: "No hay invitado seleccionado",
    emptyTable: "Aún no hay mesas",
    emptyMenu: "Aún no hay menú",
    emptySchedule: "Aún no hay elementos de programa",
    emptyNames: "Faltan los nombres de la pareja",
  },
  hr: {
    table: "stol",
    menu: "Jelovnik",
    menuCourses: ["Predjelo", "Glavno jelo", "Desert"],
    invitationEyebrow: "Zajedno sa svojim obiteljima",
    invitationLine: "pozivaju vas na slavlje",
    thankYou: "Hvala",
    thankYouLine: "što ste slavili s nama",
    schedule: "Raspored",
    emptyGuest: "Nije odabran gost",
    emptyTable: "Još nema stolova",
    emptyMenu: "Jelovnik još nije dodan",
    emptySchedule: "Još nema stavki rasporeda",
    emptyNames: "Imena para nisu unesena",
  },
  de: {
    table: "Tisch",
    menu: "Menü",
    menuCourses: ["Vorspeise", "Hauptgang", "Dessert"],
    invitationEyebrow: "Gemeinsam mit ihren Familien",
    invitationLine: "laden sie Sie zum Feiern ein",
    thankYou: "Danke",
    thankYouLine: "dass Sie mit uns gefeiert haben",
    schedule: "Programm",
    emptyGuest: "Kein Gast ausgewählt",
    emptyTable: "Noch keine Tische",
    emptyMenu: "Noch kein Menü hinzugefügt",
    emptySchedule: "Noch keine Programmpunkte",
    emptyNames: "Namen des Paares fehlen",
  },
};

export function weddingTimezoneForCountry(country: string | null | undefined): string {
  switch ((country ?? "").toUpperCase()) {
    case "HU":
      return "Europe/Budapest";
    case "HR":
      return "Europe/Zagreb";
    case "DE":
      return "Europe/Berlin";
    case "ES":
      return "Europe/Madrid";
    default:
      return "UTC";
  }
}

export function formatPrintCardTime(minutes: number): string {
  const withinDay = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  const base = `${String(Math.floor(withinDay / 60)).padStart(2, "0")}:${String(
    withinDay % 60,
  ).padStart(2, "0")}`;
  return minutes >= 1440 ? `${base}+1` : base;
}

function resolvedCoupleName(source: PrintableCardSource, copy: PrintCardCopy): string {
  return (
    source.coupleName?.trim() ||
    [source.brideName?.trim(), source.groomName?.trim()].filter(Boolean).join(" & ") ||
    copy.emptyNames
  );
}

function base<T extends PrintCardType, C>(
  source: PrintableCardSource & { cardType: T },
  content: C,
): CardDocumentBase<T, C> {
  return {
    cardType: source.cardType,
    workspaceId: source.workspaceId,
    eventId: source.eventId,
    dataRevision: source.dataRevision,
    locale: source.locale,
    timezone: source.timezone,
    theme: source.theme,
    content,
  };
}

export function buildPrintableCardDocument<T extends PrintCardType>(
  source: PrintableCardSource & { cardType: T },
): Extract<PrintableCardDocument, { cardType: T }>;
export function buildPrintableCardDocument(source: PrintableCardSource): PrintableCardDocument;
export function buildPrintableCardDocument(source: PrintableCardSource): PrintableCardDocument {
  const copy = PRINT_CARD_COPY[source.locale];
  const coupleName = resolvedCoupleName(source, copy);
  const date = formatWeddingDate(source.weddingDate, source.theme.dateFormat, source.locale);
  switch (source.cardType) {
    case "place_card": {
      const guestName = source.guestName?.trim() || copy.emptyGuest;
      return base(
        { ...source, cardType: "place_card" },
        {
          guestName,
          tableLabel: source.guestTableLabel?.trim() || "",
          isEmpty: !source.guestName?.trim(),
        },
      );
    }
    case "table_number": {
      const tableLabel = source.tableLabel?.trim() || copy.emptyTable;
      return base(
        { ...source, cardType: "table_number" },
        {
          tableLabel,
          footer: copy.table,
          isEmpty: !source.tableLabel?.trim(),
        },
      );
    }
    case "menu": {
      const courses = (source.menuCourses ?? []).filter(
        (course) => course.title.trim() || course.lines.some((line) => line.trim()),
      );
      return base(
        { ...source, cardType: "menu" },
        {
          heading: copy.menu,
          coupleName,
          date,
          courses,
          emptyCourseLabels: copy.menuCourses,
          emptyMessage: copy.emptyMenu,
          isEmpty: courses.length === 0,
        },
      );
    }
    case "invitation": {
      const venue = [source.venueName?.trim(), source.venueCity?.trim()].filter(Boolean).join(", ");
      return base(
        { ...source, cardType: "invitation" },
        {
          eyebrow: copy.invitationEyebrow,
          coupleName,
          line: copy.invitationLine,
          date,
          venue,
          rsvp: "RSVP",
          isEmpty: coupleName === copy.emptyNames,
        },
      );
    }
    case "thank_you":
      return base(
        { ...source, cardType: "thank_you" },
        {
          heading: copy.thankYou,
          line: copy.thankYouLine,
          coupleName,
          date,
          isEmpty: coupleName === copy.emptyNames,
        },
      );
    case "schedule": {
      const entries = pickKeyMoments([...(source.schedule ?? [])]).map((entry) => ({
        id: entry.id,
        time: formatPrintCardTime(entry.starts_at_minutes),
        label: entry.label,
      }));
      return base(
        { ...source, cardType: "schedule" },
        {
          heading: copy.schedule,
          coupleName,
          date,
          entries,
          emptyMessage: copy.emptySchedule,
          isEmpty: entries.length === 0,
        },
      );
    }
  }
}
