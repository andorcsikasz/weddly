import { resolveDesign } from "@shared/design";
import {
  buildPrintableCardDocument,
  PRINT_CARD_TYPES,
  type PrintableCardDocument,
  type PrintableCardSource,
  type PrintCardType,
} from "@shared/print_cards";

const theme = resolveDesign({
  style: "garden_romance",
  borderStyle: "hairline",
  print: { border: true, ornament: true, qr: false },
});

const base = {
  workspaceId: "visual-workspace",
  eventId: "visual-event",
  dataRevision: "visual-v1",
  locale: "hu",
  timezone: "Europe/Budapest",
  theme,
  coupleName: "Andor & Sári",
  brideName: "Sári",
  groomName: "Andor",
  weddingDate: "2027-05-29",
  venueName: "Árvíztűrő Udvar",
  venueCity: "Győr",
} satisfies Omit<PrintableCardSource, "cardType">;

function document(source: PrintableCardSource): PrintableCardDocument {
  return buildPrintableCardDocument(source);
}

const placeNames = [
  "Andor & Sári",
  "Árvíztűrő tükörfúrógép",
  "Előétel",
  "Gulyás leves újházi módra",
  "ŐRÜLT ÁRVÍZTŰRŐ",
  "Á É Í Ó Ö Ő Ú Ü Ű",
  "Kovács-Szűcs D'Árvíz",
  "Alexandra-Magdolna Őz",
  "Bálint Ürmös",
  "Zsófia Tűzkő",
];

export const printedCardVisualDocuments: Readonly<
  Record<PrintCardType, readonly PrintableCardDocument[]>
> = {
  place_card: placeNames.map((guestName) =>
    document({ ...base, cardType: "place_card", guestName, guestTableLabel: "12. asztal" }),
  ),
  table_number: [document({ ...base, cardType: "table_number", tableLabel: "128" })],
  menu: [
    document({
      ...base,
      cardType: "menu",
      menuCourses: [
        { title: "Előétel", lines: ["Gulyás leves újházi módra"] },
        {
          title: "Főétel",
          lines: ["Árvíztűrő tükörfúrógép pirított zöldségekkel és rozmaringgal"],
        },
        { title: "Desszert", lines: ["ŐRÜLT ÁRVÍZTŰRŐ"] },
      ],
    }),
  ],
  invitation: [document({ ...base, cardType: "invitation" })],
  thank_you: [document({ ...base, cardType: "thank_you" })],
  schedule: [
    document({
      ...base,
      cardType: "schedule",
      schedule: [
        {
          id: 1,
          label: "Naplementés fogadalom",
          starts_at_minutes: 16 * 60 + 45,
          is_key_moment: true,
        },
        {
          id: 2,
          label: "Gyertyafényes vacsora újházi módra",
          starts_at_minutes: 19 * 60 + 15,
          is_key_moment: true,
        },
        { id: 3, label: "Első tánc", starts_at_minutes: 21 * 60, is_key_moment: true },
      ],
    }),
  ],
};

/** Additional state baseline kept separate from the six canonical card-type
 * baselines so an empty state cannot accidentally be approved as real data. */
export const printedCardAdditionalVisualCases = {
  empty_menu: [
    document({
      ...base,
      cardType: "menu",
      coupleName: null,
      brideName: null,
      groomName: null,
      weddingDate: null,
      menuCourses: [],
    }),
  ],
} as const;

if (Object.keys(printedCardVisualDocuments).join(",") !== PRINT_CARD_TYPES.join(",")) {
  throw new Error("Visual fixtures must stay exhaustive with PRINT_CARD_TYPES");
}
