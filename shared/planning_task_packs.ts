// The starter task packs the planning + honeymoon wands offer, and the lead
// time each item carries. This lives in `shared/` rather than beside the pages
// that render it for one reason: the "Ütemező varázsló" (`planning_wand.ts`)
// has to read the same leads. While the catalogue sat in `frontend/src/lib/`,
// `planning_wand.ts` could not import it, so every honeymoon task fell through
// to the neutral fallback and the wizard proposed the SAME date for the
// passport check, the flights and the packing list.
//
// `frontend/src/lib/planning_templates.ts` re-exports everything here, so the
// pages keep importing from where they always did.
//
// Content data, not UI labels: HU + EN inline, same pattern as
// `planning_timeline.ts` and `domain/suppliers_data.ts`. Pure module (no DB, no
// I/O) so both sides import it directly.

export type TaskPackText = { hu: string; en: string };

/** One item in a starter pack. `deadline_days` is relative to the wedding day
 *  and NEGATIVE for "before the wedding" (-180 = six months out), matching the
 *  `T-N` chip the planning wand prints. */
export interface TaskPackItem {
  title: TaskPackText;
  deadline_days: number;
}

/** Task starter set, organised into two sections the wand renders as
 *  separate groups: the universally-applicable wedding bookings + decisions
 *  every couple makes, followed by the honeymoon trip-prep set (passport,
 *  flights, insurance…) added once the couple sets a honeymoon destination.
 *  Groups stay distinct in the modal so the wedding list isn't drowned by trip
 *  items. */
export type TaskTemplateGroupId = "wedding" | "honeymoon";

export interface TaskPackGroup {
  id: TaskTemplateGroupId;
  label: TaskPackText;
  items: TaskPackItem[];
}

export const TASK_TEMPLATE_GROUPS: TaskPackGroup[] = [
  {
    id: "wedding",
    label: { hu: "Esküvő", en: "Wedding" },
    // Titles are kept verbatim-identical to the matching WEDDING_TIMELINE items
    // in shared/planning_timeline.ts, so the wand and the "Build my timeline"
    // generator de-dupe against each other on apply. deadline_days mirrors each
    // item's lead time (months × ~30).
    items: [
      { title: { hu: "Helyszínt foglalni", en: "Book your venue" }, deadline_days: -365 },
      {
        title: { hu: "Anyakönyvvezetőt egyeztetni", en: "Confirm registrar" },
        deadline_days: -330,
      },
      {
        title: { hu: "Fotós és videós lefoglalása", en: "Book photo and video" },
        deadline_days: -300,
      },
      { title: { hu: "Catering lefoglalása", en: "Book catering" }, deadline_days: -300 },
      {
        title: { hu: "Menyasszonyi ruha keresése", en: "Start dress shopping" },
        deadline_days: -330,
      },
      { title: { hu: "Zenekar vagy DJ lefoglalása", en: "Book music or DJ" }, deadline_days: -240 },
      { title: { hu: "Virágkötő lefoglalása", en: "Book florist" }, deadline_days: -240 },
      {
        title: { hu: "Menyasszonyi ruha megrendelése", en: "Order your dress" },
        deadline_days: -240,
      },
      {
        title: { hu: "Esküvői torta megrendelése", en: "Order wedding cake" },
        deadline_days: -180,
      },
      { title: { hu: "Karikagyűrűk beszerzése", en: "Buy rings" }, deadline_days: -150 },
      { title: { hu: "Meghívók kiküldése", en: "Send invitations" }, deadline_days: -120 },
      { title: { hu: "Tanúk felkérése", en: "Ask the witnesses" }, deadline_days: -120 },
      { title: { hu: "Végleges létszám leadása", en: "Finalize guest count" }, deadline_days: -30 },
      {
        title: { hu: "Házassági papírok rendezése", en: "Sort the marriage paperwork" },
        deadline_days: -30,
      },
      {
        title: { hu: "Esküvői próba egyeztetése", en: "Schedule wedding rehearsal" },
        deadline_days: -7,
      },
    ],
  },
  {
    id: "honeymoon",
    label: { hu: "Nászút", en: "Honeymoon" },
    items: [
      {
        title: { hu: "Útlevél lejáratot ellenőrizni", en: "Check passport validity" },
        deadline_days: -180,
      },
      {
        title: { hu: "Vízum/ESTA igényt megnézni", en: "Check visa / ESTA requirements" },
        deadline_days: -150,
      },
      { title: { hu: "Repjegyet lefoglalni", en: "Book flights" }, deadline_days: -150 },
      { title: { hu: "Szállást lefoglalni", en: "Book accommodation" }, deadline_days: -120 },
      {
        title: { hu: "Utasbiztosítást kötni", en: "Take out travel insurance" },
        deadline_days: -90,
      },
      {
        title: { hu: "Bankot értesíteni az utazásról", en: "Notify the bank about travel" },
        deadline_days: -30,
      },
      {
        title: {
          hu: "Devizát váltani / kártyát ellenőrizni",
          en: "Exchange currency / check cards",
        },
        deadline_days: -14,
      },
      {
        title: { hu: "Reptéri transzfert szervezni", en: "Arrange airport transfer" },
        deadline_days: -30,
      },
      {
        title: { hu: "Programot tervezni a helyszínen", en: "Plan activities at destination" },
        deadline_days: -60,
      },
      { title: { hu: "Csomagolási lista", en: "Pack list" }, deadline_days: -3 },
    ],
  },
];

/** Backwards-compatible flat task list, the wand modal still indexes its
 *  selection state into this array, so the index order must stay stable
 *  (wedding first, then honeymoon). New items get appended to the end of
 *  their group to keep prior indices pointing to the same task. */
export const TASK_TEMPLATE: TaskPackItem[] = TASK_TEMPLATE_GROUPS.flatMap((g) => g.items);

/** Reserve honeymoon trip-prep tasks. NOT part of the base pack above, these
 *  are the backfill the honeymoon wand pulls from: for every base item a couple
 *  has already added (shown as "already on the list"), one fresh suggestion from
 *  here is appended to the bottom of the dialog so the pack always offers a full
 *  set of things still worth doing. Same HU + EN inline pattern as the groups.
 *  All real, broadly useful pre-departure tasks (no filler).
 *
 *  `deadline_days` is carried here for the same reason the base items carry it:
 *  without a lead of its own an item is invisible to the wizard's title lookup
 *  and lands on the neutral fallback, i.e. a second class of tasks all sharing
 *  one date. Each value is the point where the task stops being premature: an
 *  IDP is an office visit with a wait, vaccination courses run in weeks, an
 *  eSIM or an adapter is a purchase you make the fortnight before, and the
 *  offline itinerary only exists once everything else is booked. */
export const HONEYMOON_EXTRA_TASKS: TaskPackItem[] = [
  {
    title: { hu: "Roaming vagy eSIM beállítása", en: "Set up roaming or an eSIM" },
    deadline_days: -14,
  },
  {
    title: {
      hu: "Oltások és utazási egészségügy ellenőrzése",
      en: "Check vaccinations and travel health",
    },
    deadline_days: -90,
  },
  {
    title: { hu: "Online check-in emlékeztető beállítása", en: "Set an online check-in reminder" },
    deadline_days: -3,
  },
  {
    title: {
      hu: "Útiterv és foglalások mentése offline",
      en: "Save the itinerary and bookings offline",
    },
    deadline_days: -2,
  },
  {
    title: {
      hu: "Fontos dokumentumok másolata (felhő + papír)",
      en: "Copies of key documents (cloud + paper)",
    },
    deadline_days: -10,
  },
  {
    title: {
      hu: "Vészhelyzeti elérhetőségek és nagykövetség elmentése",
      en: "Save emergency contacts and the embassy",
    },
    deadline_days: -7,
  },
  {
    title: {
      hu: "Hálózati adapter és töltő a célországhoz",
      en: "Power adapter and charger for the destination",
    },
    deadline_days: -14,
  },
  {
    title: { hu: "Alap útipatika összeállítása", en: "Pack a basic travel first-aid kit" },
    deadline_days: -5,
  },
  {
    title: {
      hu: "Otthoni teendők: növények, posta, kulcs",
      en: "Home prep: plants, mail, spare key",
    },
    deadline_days: -4,
  },
  {
    title: { hu: "Reptéri parkolás vagy transzfer foglalása", en: "Book airport parking" },
    deadline_days: -21,
  },
  {
    title: {
      hu: "Nemzetközi vezetői engedélyt igényelni",
      en: "Apply for an international driving permit",
    },
    deadline_days: -60,
  },
  {
    title: {
      hu: "Pénznem és időeltolódás megnézése",
      en: "Check the currency and time difference",
    },
    deadline_days: -14,
  },
];

/** Every pack item in one list: the two groups plus the honeymoon reserve.
 *  What the wizard's title lookup is built from. */
export const ALL_TASK_PACK_ITEMS: TaskPackItem[] = [...TASK_TEMPLATE, ...HONEYMOON_EXTRA_TASKS];
