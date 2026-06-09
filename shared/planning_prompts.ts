// The "Döntések" decision-prompt master: the long tail of small yes/no
// decisions and "did you think of this?" prompts that sit BELOW the big-rock
// timeline (shared/planning_timeline.ts). Where the timeline answers "what to
// book", this layer answers "what to decide once it's booked" - entrance music,
// who carries the rings, the venue's default coffee, the rain plan, who takes
// the cake home.
//
// A prompt is materialised lazily as a kind='task' planning_items row carrying a
// stable `seed_key` from PROMPT_SEEDS below. Only `seed_key` + `decision_status`
// + `resolution` are persisted; everything else (kind, target, supplier
// category, hint, group, default priority) is looked up from this master by key
// on read - so this file is the single source of truth and rows never go stale
// against it. Pure module (no DB, no I/O); both backend and frontend import it.

import type { SupplierCategory } from "./suppliers";
import type { CeremonyKind } from "./types";

export type LocaleText = { hu: string; en: string };

/** What the prompt asks the couple to DO - drives the card's primary action and
 *  the right lifecycle. A `decision` is a choice the two of them make (free-text
 *  outcome); a `check` is a question whose answer comes from a supplier (so the
 *  couple "asks" then "records the answer"); a `todo` is a plain do-it task. */
export type PromptKind = "decision" | "check" | "todo";

/** Who resolves it. `supplier` prompts also surface on the booked supplier's
 *  lifecycle card as an "ask them" agenda item. */
export type PromptTarget = "couple" | "supplier";

/** A prompt is shown only when its condition is active for the couple. `null`
 *  condition = universal (always shown). See `isPromptVisible`. */
export type ConditionTag =
  | "outdoor"
  | "has_children"
  | "religious"
  | "civil_only"
  | "destination"
  | "has_pets"
  | "multi_event"
  | "large_guest_count"
  | "accommodation_needed"
  | "evening_party"
  | "alcohol_served"
  | "wedding_cake"
  | "pro_photo"
  | "own_decor";

/** The eight top-level theme groups the deck is organised into. Theme is the
 *  display spine because it is the only axis with no lopsided "other" bucket and
 *  is couple-independent (stable at seed time), unlike chronology / supplier /
 *  owner. */
export type PromptGroup =
  | "venue_weather"
  | "food_drink"
  | "ceremony"
  | "style_decor"
  | "music_photo"
  | "guests"
  | "morning_timeline"
  | "dayof_money_close";

export interface PromptSeed {
  /** Stable identifier - never reused. Persisted on the row; dedupe + lookup key. */
  seed_key: string;
  group: PromptGroup;
  prompt_kind: PromptKind;
  prompt_target: PromptTarget;
  title: LocaleText;
  /** Optional one-line "why this matters / what to watch for". */
  hint?: LocaleText;
  /** Set when prompt_target = "supplier": which directory category to anchor to. */
  supplier_category?: SupplierCategory;
  /** Set when the prompt is conditional; omitted = universal. */
  condition?: ConditionTag;
  default_priority: 0 | 1 | 2;
}

export const PROMPT_GROUPS: readonly { key: PromptGroup; title: LocaleText; blurb: LocaleText }[] =
  [
    {
      key: "venue_weather",
      title: { hu: "Helyszín, időjárás és B-terv", en: "Venue, weather and plan B" },
      blurb: {
        hu: "A helyszín rejtett alapbeállításai és az időjárás-kockázat.",
        en: "The venue's hidden defaults and the weather risk.",
      },
    },
    {
      key: "food_drink",
      title: { hu: "Étel, ital és torta", en: "Food, drink and cake" },
      blurb: {
        hu: "Kávé, víz, welcome drink, diéták, éjféli falatok, torta.",
        en: "Coffee, water, welcome drink, diets, late-night bites, the cake.",
      },
    },
    {
      key: "ceremony",
      title: { hu: "Ceremónia és hagyományok", en: "Ceremony and traditions" },
      blurb: {
        hu: "Bevonulás, gyűrűk, rítuselemek, telefon- és közvetítés-policy.",
        en: "The processional, the rings, ritual moments, phone and stream policy.",
      },
    },
    {
      key: "style_decor",
      title: { hu: "Stílus, dekor és papíráruk", en: "Style, decor and stationery" },
      blurb: {
        hu: "Vendégkönyv, táblák, kártyák, és ki pakol be/ki.",
        en: "Guest book, signs, cards, and who sets up and tears down.",
      },
    },
    {
      key: "music_photo",
      title: { hu: "Zene, fotó és program", en: "Music, photo and the party" },
      blurb: {
        hu: "Táncok, playlist, beszédek, shotlist, fotók leadása.",
        en: "Dances, the playlist, speeches, the shotlist, photo delivery.",
      },
    },
    {
      key: "guests",
      title: {
        hu: "Vendégek: meghívás, szállás, inklúzió",
        en: "Guests: invites, stay, inclusion",
      },
      blurb: {
        hu: "Kísérő-policy, allergia, akadálymentesség, szállás, transzfer.",
        en: "Plus-ones, allergies, accessibility, accommodation, transfer.",
      },
    },
    {
      key: "morning_timeline",
      title: { hu: "A nagy nap reggele és menetrendje", en: "The morning and the run of show" },
      blurb: {
        hu: "Készülődés sorrendje, idő-puffer, vészhelyzeti táska, felelős.",
        en: "Getting-ready order, time buffers, the emergency kit, who runs it.",
      },
    },
    {
      key: "dayof_money_close",
      title: { hu: "Aznapi felelősök, pénz és zárás", en: "Day-of owners, money and wrap-up" },
      blurb: {
        hu: "Ki fizet, borravaló, ki visz haza mit, számlák, köszönet.",
        en: "Who pays, tipping, who takes what home, invoices, thank-yous.",
      },
    },
  ];

// ─── the seed list ───────────────────────────────────────────────────────────
// Authored HU-first with natural EN, grouped by theme. Generated and dedup-
// audited; real content, no placeholders.

export const PROMPT_SEEDS: readonly PromptSeed[] = [
  {
    seed_key: "venue-weather-rain-plan-owner",
    group: "venue_weather",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Ki és mikor hozza meg az eső-döntést?",
      en: "Who calls the rain decision, and by when?",
    },
    hint: {
      hu: "Jelölj ki egy konkrét embert (pl. koordinátor vagy egyik tanú) és egy időpontot a nap reggelén, ameddig eldől a kül- vagy beltéri verzió. Így senki nem méricskéli az eget az utolsó percig.",
      en: "Name one person (a coordinator or witness) and a cutoff time on the morning of the event for the indoor-or-outdoor call. That way nobody is squinting at the sky at the last minute.",
    },
    condition: "outdoor",
    default_priority: 2,
  },
  {
    seed_key: "venue-weather-rain-backup-space",
    group: "venue_weather",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Van beltéri B-terv ugyanannyi főre eső esetén?",
      en: "Is there an indoor backup space for the full guest count if it rains?",
    },
    hint: {
      hu: "Kérdezd meg, hogy a tartalék terem elfér-e mindenkit asztalokkal együtt, és hogy az átállás külön díjba vagy időbe kerül-e.",
      en: "Ask whether the backup room fits everyone with tables, and whether switching over costs extra time or money.",
    },
    supplier_category: "venue",
    condition: "outdoor",
    default_priority: 2,
  },
  {
    seed_key: "venue-weather-tent-marquee-decision",
    group: "venue_weather",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Kell-e sátor a kültéri részre, és meddig tartható fenn a foglalása?",
      en: "Do you need a marquee outdoors, and how long can you hold the booking?",
    },
    hint: {
      hu: "A sátorbérlést gyakran pár nappal előre le kell mondani vagy meg kell tartani. Tisztázd, meddig dönthetsz fizetési kötelezettség nélkül.",
      en: "Marquee rentals often must be confirmed or cancelled days ahead. Clarify your last free decision point.",
    },
    condition: "outdoor",
    default_priority: 2,
  },
  {
    seed_key: "venue-weather-outdoor-shade-heat",
    group: "venue_weather",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Lesz árnyékolás a vendégeknek a tűző napon?",
      en: "Will there be shade for guests in direct sun?",
    },
    hint: {
      hu: "Délutáni szertartásnál a nap könnyen 30+ fok. Napernyő, ponyva vagy fa árnyéka sokat ment, főleg idősebb vendégeknek.",
      en: "An afternoon ceremony can hit serious heat. Parasols, a canopy, or tree shade matter, especially for older guests.",
    },
    condition: "outdoor",
    default_priority: 0,
  },
  {
    seed_key: "venue-weather-outdoor-heating-blankets",
    group: "venue_weather",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Lesz fűtés vagy pokróc a hűvös estére kint?",
      en: "Will there be heaters or blankets for a cool evening outside?",
    },
    hint: {
      hu: "Még nyáron is hűvös tud lenni este a kerti részen. Gázhősugárzó vagy egy kosár pokróc megmenti a táncparkettet.",
      en: "Even summer evenings turn chilly outdoors. Patio heaters or a basket of blankets keep the dance floor alive.",
    },
    condition: "outdoor",
    default_priority: 0,
  },
  {
    seed_key: "venue-indoor-climate-control",
    group: "venue_weather",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Van légkondi és fűtés a terembe, és működik a teljes létszámnál?",
      en: "Does the room have working AC and heating that handles a full crowd?",
    },
    hint: {
      hu: "Egy tele terem 100+ emberrel és reflektorokkal felmelegszik. Kérdezd meg, valóban hűt-e a rendszer ekkora tömegnél.",
      en: "A packed room with stage lights heats up fast. Ask whether the system actually cools a full house.",
    },
    supplier_category: "venue",
    default_priority: 1,
  },
  {
    seed_key: "venue-curfew-end-time",
    group: "venue_weather",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Hány órakor kell elhagyni a helyszínt, és van-e zenei kapuzárás?",
      en: "What time must you vacate, and is there a music curfew?",
    },
    hint: {
      hu: "A zárás és a hangos zene vége gyakran nem ugyanaz az időpont. Mindkettőt írasd le, hogy a DJ-vel egyeztetni tudd.",
      en: "The vacate time and the loud-music cutoff are often two different things. Get both in writing so you can brief the DJ.",
    },
    supplier_category: "venue",
    default_priority: 1,
  },
  {
    seed_key: "venue-overtime-extension-price",
    group: "venue_weather",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Lehet hosszabbítani, és mennyibe kerül óránként?",
      en: "Can you extend the night, and what does each extra hour cost?",
    },
    hint: {
      hu: "Tisztázd a hosszabbítás árát és azt, hogy a helyszínen kell-e eldönteni vagy előre. Az aznap esti alku a legdrágább.",
      en: "Pin down the overtime rate and whether you decide on the night or in advance. A spur-of-the-moment deal is the priciest.",
    },
    supplier_category: "venue",
    default_priority: 0,
  },
  {
    seed_key: "venue-power-capacity-dj-tent",
    group: "venue_weather",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Elég áram és konnektor van a DJ-nek és a kültéri sátornak?",
      en: "Is there enough power and enough outlets for the DJ and the outdoor tent?",
    },
    hint: {
      hu: "A hangtechnika, fények és a melegítőpultok együtt sok áramot húznak. Kérdezd meg, hány külön kör van és hol vannak a konnektorok kint.",
      en: "Sound gear, lighting, and warming trays draw a lot together. Ask how many separate circuits exist and where the outdoor outlets are.",
    },
    supplier_category: "venue",
    default_priority: 1,
  },
  {
    seed_key: "venue-deposit-damage-terms",
    group: "venue_weather",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Mennyi a kaució, és mi számít levonásnak?",
      en: "How much is the deposit, and what counts as a deduction?",
    },
    hint: {
      hu: "Kérdezd meg a kaució összegét, mi a visszafizetés feltétele (takarítás, sérülés) és mikor kapod vissza. Borfolt vagy túlóra gyakran ide tartozik.",
      en: "Ask the deposit amount, what triggers a deduction (cleaning, damage), and when it is returned. Wine stains or overtime often hit it.",
    },
    supplier_category: "venue",
    default_priority: 1,
  },
  {
    seed_key: "venue-decor-access-time",
    group: "venue_weather",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Mikortól lehet bemenni dekorálni, és mikorra kell kipakolni?",
      en: "When can you get in to decorate, and when must everything be cleared out?",
    },
    hint: {
      hu: "Ha csak aznap reggel nyit a terem, a dekoroknak rohanniuk kell. Az elszállítás ideje (aznap éjjel vagy másnap) is fontos a kölcsönzött kellékek miatt.",
      en: "If the room only opens that morning, your decorators will be rushed. The load-out time (same night or next day) also matters for rented items.",
    },
    supplier_category: "venue",
    default_priority: 0,
  },
  {
    seed_key: "venue-parking-capacity",
    group: "venue_weather",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Hány autót lehet leparkolni, és van-e éjszakai parkolás?",
      en: "How many cars fit, and is overnight parking allowed?",
    },
    hint: {
      hu: "Ha kevés a hely, érdemes előre buszt vagy közös autózást szervezni. Az éjszakázó vendégek autóit is hol hagyják?",
      en: "If parking is tight, arrange a shuttle or carpools in advance. Where do overnight guests leave their cars?",
    },
    supplier_category: "venue",
    default_priority: 0,
  },
  {
    seed_key: "venue-accessibility-access",
    group: "venue_weather",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Akadálymentes a megközelítés a kerekesszékes vagy idős vendégeknek?",
      en: "Is the venue accessible for wheelchair users or elderly guests?",
    },
    hint: {
      hu: "Kérdezz rá a lépcsőkre, rámpára, lifte és a mosdó akadálymentességére. A kavicsos kerti út is gond lehet bottal vagy babakocsival.",
      en: "Ask about stairs, ramps, a lift, and an accessible toilet. A gravel garden path can also be tricky with a cane or stroller.",
    },
    supplier_category: "venue",
    default_priority: 0,
  },
  {
    seed_key: "venue-smoking-area",
    group: "venue_weather",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Hol lesz a kijelölt dohányzóhely?",
      en: "Where will the designated smoking area be?",
    },
    hint: {
      hu: "Jelölj ki egy helyet hamutartóval, távol a büfétől és a gyerekektől. Esőben fedett sarok kell, különben a bejáratnál gyűlnek össze.",
      en: "Pick a spot with an ashtray, away from the buffet and kids. In the rain you need a covered corner, or people pile up at the entrance.",
    },
    default_priority: 0,
  },
  {
    seed_key: "venue-outdoor-rest-zone",
    group: "venue_weather",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Lesz kültéri pihenőzóna ülőhelyekkel?",
      en: "Will there be an outdoor lounge area with seating?",
    },
    hint: {
      hu: "Egy pár pad, puff vagy szalmabála a tánc és a beszélgetés között ad menedéket. Idősebb vendégeknek és a gyerekes szülőknek aranyat ér.",
      en: "A few benches, poufs, or hay bales give people a break from the dance floor. Older guests and parents with kids will thank you.",
    },
    condition: "outdoor",
    default_priority: 0,
  },
  {
    seed_key: "venue-liability-insurance",
    group: "venue_weather",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Kell-e felelősségbiztosítás, és kérnek-e igazolást a szolgáltatóktól?",
      en: "Is liability insurance required, and do they need proof from your suppliers?",
    },
    hint: {
      hu: "Sok helyszín megköveteli a felelősségbiztosítást a cateringtől, sátrastól vagy a tűzijátéktól. Tisztázd előre, nehogy a szolgáltató ne léphessen be aznap.",
      en: "Many venues require liability cover from catering, marquee, or fireworks suppliers. Sort it early so nobody is turned away on the day.",
    },
    supplier_category: "venue",
    default_priority: 1,
  },
  {
    seed_key: "food-drink-coffee-type",
    group: "food_drink",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Milyen kávé lesz a vacsora után: automata, filteres vagy baristás?",
      en: "What kind of coffee is served after dinner: machine, filter, or barista?",
    },
    hint: {
      hu: "Sok helyen alap a kannás filteres, az eszpresszó/automata gyakran külön díjas vagy bérelt gép. Tisztázd, mi van benne az árban.",
      en: "Many venues default to filter coffee in carafes; espresso or a machine is often an extra or a rented unit. Confirm what is included in the price.",
    },
    supplier_category: "catering",
    default_priority: 0,
  },
  {
    seed_key: "food-drink-decaf-available",
    group: "food_drink",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Lesz-e koffeinmentes kávé az idősebb vagy érzékeny vendégeknek?",
      en: "Will decaf coffee be available for older or sensitive guests?",
    },
    hint: {
      hu: "Esti kávénál sokan koffeinmentest kérnek. Ritkán alap, érdemes előre szólni.",
      en: "Many guests want decaf with evening coffee. It is rarely standard, so ask in advance.",
    },
    supplier_category: "catering",
    default_priority: 0,
  },
  {
    seed_key: "food-drink-plant-milk",
    group: "food_drink",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Van-e növényi tej (zab, mandula, szója) a kávéhoz?",
      en: "Is plant-based milk (oat, almond, soy) offered for the coffee?",
    },
    hint: {
      hu: "Laktózérzékeny és vegán vendégeknek fontos. Jelezd, hány adagra számíthatnak.",
      en: "It matters for lactose-intolerant and vegan guests. Tell them roughly how many portions to expect.",
    },
    supplier_category: "catering",
    default_priority: 0,
  },
  {
    seed_key: "food-drink-water-on-tables",
    group: "food_drink",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Lesz-e folyamatosan víz az asztalokon, vagy külön kell kérni?",
      en: "Is water kept on the tables throughout, or does it have to be requested?",
    },
    hint: {
      hu: "Nyári esküvőn kritikus. Tisztázd, szénsavas és mentes is legyen-e, és újratöltik-e.",
      en: "Critical at a summer wedding. Confirm both still and sparkling, and whether it gets refilled.",
    },
    supplier_category: "catering",
    default_priority: 1,
  },
  {
    seed_key: "food-drink-welcome-drink",
    group: "food_drink",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Mi legyen a welcome drink a vendégek fogadásakor?",
      en: "What will the welcome drink be when guests arrive?",
    },
    hint: {
      hu: "Döntsetek alkoholos és alkoholmentes verzióról is, és hogy felszolgálják vagy önkiszolgáló.",
      en: "Decide on both an alcoholic and a non-alcoholic version, and whether it is served or self-serve.",
    },
    default_priority: 0,
  },
  {
    seed_key: "food-drink-nonalcoholic-options",
    group: "food_drink",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Milyen alkoholmentes italok legyenek (limonádé, üdítő, tea, alkoholmentes pezsgő)?",
      en: "Which non-alcoholic drinks should be on offer (lemonade, sodas, tea, alcohol-free fizz)?",
    },
    hint: {
      hu: "A nem ivó, terhes és sofőr vendégeknek is legyen rendes választás, ne csak víz.",
      en: "Non-drinkers, pregnant guests, and designated drivers deserve a real choice beyond water.",
    },
    default_priority: 0,
  },
  {
    seed_key: "food-drink-late-night-snack",
    group: "food_drink",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Lesz-e késő esti vagy éjféli falat, és mi legyen az?",
      en: "Will there be a late-night or midnight snack, and what should it be?",
    },
    hint: {
      hu: "Korhely leves, hot dog, lángos vagy zsíros kenyér jól jön a tánc után. Egyeztesd az időzítést a cateringgel.",
      en: "Goulash soup, hot dogs, or savoury bites land well after dancing. Agree the timing with catering.",
    },
    condition: "evening_party",
    default_priority: 0,
  },
  {
    seed_key: "food-drink-dietary-options",
    group: "food_drink",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Tudtok-e vegetáriánus, vegán, gluténmentes és laktózmentes fogást adni?",
      en: "Can you provide vegetarian, vegan, gluten-free, and lactose-free dishes?",
    },
    hint: {
      hu: "Gyűjtsd be a vendégek igényeit a visszajelzésekből, és add le pontosan, hány adag kell mindegyikből.",
      en: "Collect needs from the RSVPs and pass on exactly how many of each are required.",
    },
    supplier_category: "catering",
    default_priority: 1,
  },
  {
    seed_key: "food-drink-allergen-labels-menu-card",
    group: "food_drink",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Legyenek-e allergén-jelölések a menükártyán?",
      en: "Should allergen markings appear on the menu cards?",
    },
    hint: {
      hu: "A büféasztalnál különösen hasznos kis táblákkal jelölni, mi mit tartalmaz.",
      en: "At a buffet it especially helps to mark each dish with small labels showing what it contains.",
    },
    default_priority: 1,
  },
  {
    seed_key: "food-drink-vendor-meals",
    group: "food_drink",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Kapnak-e meleg ételt a szolgáltatók (fotós, DJ, sofőr)?",
      en: "Will the suppliers (photographer, DJ, driver) get a hot meal?",
    },
    hint: {
      hu: "A legtöbb szerződésben elvárás. A catering gyakran kedvezményes szolgáltatói adagot ad, ezt kérd külön.",
      en: "Most contracts expect it. Catering often offers a discounted vendor portion, so ask for it separately.",
    },
    default_priority: 0,
  },
  {
    seed_key: "food-drink-byo-corkage",
    group: "food_drink",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Behozhatjuk-e a saját italunkat, és van-e dugópénz?",
      en: "Can we bring our own drinks, and is there a corkage fee?",
    },
    hint: {
      hu: "Saját bor/pálinka sokat spórol, de sok helyen üvegenkénti dugópénz van. Számold ki, megéri-e.",
      en: "Bringing your own wine or spirits can save a lot, but many venues charge corkage per bottle. Check whether it is worth it.",
    },
    supplier_category: "venue",
    condition: "alcohol_served",
    default_priority: 0,
  },
  {
    seed_key: "food-drink-bar-open-vs-paid",
    group: "food_drink",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Az ital korlátlan (open bar), átalánnyal vagy fogyasztás szerint megy?",
      en: "Will drinks be open bar, a flat package, or charged by consumption?",
    },
    hint: {
      hu: "A fogyasztás szerinti elszámolásnál állíts be felső keretet, hogy ne szaladjon el a számla.",
      en: "If charged by consumption, set a cap so the bill does not run away from you.",
    },
    condition: "alcohol_served",
    default_priority: 1,
  },
  {
    seed_key: "food-drink-cake-delivery-storage",
    group: "food_drink",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Hánykor érkezik a torta, és van-e hűtött tárolás a felszolgálásig?",
      en: "What time does the cake arrive, and is there chilled storage until serving?",
    },
    hint: {
      hu: "Nyáron a vajkrémes és habos torta megolvadhat. Egyeztesd a cukrász és a helyszín között a hűtést és az átvevő személyt.",
      en: "In summer buttercream and cream cakes can melt. Coordinate chilled storage and who receives it between the baker and the venue.",
    },
    supplier_category: "cake_dessert",
    condition: "wedding_cake",
    default_priority: 1,
  },
  {
    seed_key: "food-drink-cake-cutting-timing",
    group: "food_drink",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Mikor legyen a tortavágás, és kell-e fényszóró/zene hozzá?",
      en: "When should the cake cutting happen, and does it need a spotlight or music?",
    },
    hint: {
      hu: "Tipikusan az első tánc környékén vagy a vacsora után. Egyeztesd a DJ-vel és a fotóssal az időpontot.",
      en: "Typically around the first dance or after dinner. Coordinate the moment with the DJ and the photographer.",
    },
    condition: "wedding_cake",
    default_priority: 0,
  },
  {
    seed_key: "food-drink-toast-bubbly",
    group: "food_drink",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Mivel köszöntetek: pezsgővel, és lesz-e alkoholmentes alternatíva?",
      en: "What do you toast with: bubbly, and is there a non-alcoholic alternative?",
    },
    hint: {
      hu: "Mindenkinek legyen tele pohara a köszöntőre, a nem ivóknak is. Add le a felszolgálandó adatszámot.",
      en: "Everyone should have a full glass for the toast, including non-drinkers. Give the count of portions to serve.",
    },
    condition: "alcohol_served",
    default_priority: 0,
  },
  {
    seed_key: "food-drink-dessert-table-buffet",
    group: "food_drink",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Lesz-e desszertasztal a torta mellett, és ki tölti fel?",
      en: "Will there be a dessert table beside the cake, and who keeps it stocked?",
    },
    hint: {
      hu: "Aprósütemény, gyümölcs vagy mini desszertek. Tisztázd, a cukrász vagy a catering felel a feltöltésért.",
      en: "Cookies, fruit, or mini desserts. Clarify whether the baker or the catering keeps it topped up.",
    },
    supplier_category: "cake_dessert",
    condition: "wedding_cake",
    default_priority: 0,
  },
  {
    seed_key: "ceremony-processional-music",
    group: "ceremony",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Milyen zene szóljon a bevonuláskor?",
      en: "What music plays during the processional?",
    },
    hint: {
      hu: "Külön dal jöhet a menethez és külön a menyasszony belépésére. Egyeztesd a zenésszel vagy DJ-vel a verziót és a hosszt.",
      en: "You can pick one track for the wedding party and a separate one for the bride's entrance. Confirm the version and length with your musician or DJ.",
    },
    default_priority: 1,
  },
  {
    seed_key: "ceremony-recessional-music",
    group: "ceremony",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Milyen zene szóljon a kivonuláskor?",
      en: "What music plays during the recessional?",
    },
    hint: {
      hu: "Az örömteli, felemelő darab itt jól működik. Ez a pillanat, amikor a vendégek tapsolnak és szórnak.",
      en: "An upbeat, joyful piece works well here. This is the moment guests clap and toss confetti.",
    },
    default_priority: 0,
  },
  {
    seed_key: "ceremony-background-music-signing",
    group: "ceremony",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Szóljon-e háttérzene az aláírás és a holtidők alatt?",
      en: "Should background music play during the signing and quiet moments?",
    },
    hint: {
      hu: "Az anyakönyvi aláírás és a gyűrűhúzás körül könnyen lesz csendes holtidő. Egy halk háttérdarab feloldja a feszültséget.",
      en: "There is often dead air around the signing and ring exchange. A soft instrumental piece fills it naturally.",
    },
    default_priority: 0,
  },
  {
    seed_key: "ceremony-music-cue-owner",
    group: "ceremony",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Ki indítja és állítja le a szertartás zenéjét?",
      en: "Who starts and stops the ceremony music?",
    },
    hint: {
      hu: "Legyen egy konkrét felelős (DJ, hangtechnikus vagy egy tanú telefonnal) és egyezzetek le egy jelet a belépésre. A rosszul időzített zene a leggyakoribb szertartás-baki.",
      en: "Assign one person (DJ, sound tech, or a witness with a phone) and agree on a cue for the entrance. Mistimed music is the most common ceremony slip.",
    },
    default_priority: 1,
  },
  {
    seed_key: "ceremony-vows-own-or-prewritten",
    group: "ceremony",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Saját fogadalmat írtok, vagy a kész szöveget mondjátok?",
      en: "Will you write your own vows or use the standard text?",
    },
    hint: {
      hu: "Ha sajátot írtok, beszéljétek meg a hosszt és a hangnemet, hogy a kettő illjen egymáshoz. Küldjétek el a szertartásvezetőnek időben.",
      en: "If you write your own, agree on length and tone so the two match. Send them to your officiant in advance.",
    },
    default_priority: 1,
  },
  {
    seed_key: "ceremony-ring-bearer",
    group: "ceremony",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Ki hozza be a gyűrűket a szertartásra?",
      en: "Who brings the rings into the ceremony?",
    },
    hint: {
      hu: "Lehet a tanú, egy gyerek vagy a szertartásvezető. Jelöljetek ki egy biztos felelőst, és nála legyenek a gyűrűk az indulás előtt.",
      en: "It can be a witness, a child, or the officiant. Pick one reliable person and make sure the rings are with them before the start.",
    },
    default_priority: 2,
  },
  {
    seed_key: "ceremony-ring-pillow-holder",
    group: "ceremony",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Gyűrűpárnát, gyűrűtartó dobozt vagy tálcát használtok?",
      en: "Will you use a ring pillow, box, or tray for the rings?",
    },
    hint: {
      hu: "Egyeztesd a dekorral és a virágokkal, hogy stílusban illjen. A párnára varrt gyűrűt mindig kösd meg lazán, hogy könnyen levehető legyen.",
      en: "Match it to your decor and florals. If the rings are tied to a pillow, keep the knot loose so they come off easily.",
    },
    default_priority: 0,
  },
  {
    seed_key: "ceremony-front-row-seating",
    group: "ceremony",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Ki üljön az első sorokban, és jelöljétek-e a szülők, tanúk, nagyszülők helyét?",
      en: "Who sits in the front rows, and will you reserve seats for parents, witnesses, and grandparents?",
    },
    hint: {
      hu: "Egy kis lefoglalva tábla vagy szalag elkerüli a kínos helykeresést. Gondoljátok át az elvált szülők ülésrendjét is.",
      en: "A small reserved sign or ribbon avoids awkward seat hunting. Think through seating for divorced parents too.",
    },
    default_priority: 0,
  },
  {
    seed_key: "ceremony-readers",
    group: "ceremony",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Felolvas-e valaki a szertartáson, és ki?",
      en: "Will someone do a reading during the ceremony, and who?",
    },
    hint: {
      hu: "Kérjétek fel jó előre, és adjátok oda a kinyomtatott szöveget. Beszéljétek meg, hova álljon és hol kapcsolódik be.",
      en: "Ask them well ahead and hand over the printed text. Agree where they stand and when they come in.",
    },
    default_priority: 0,
  },
  {
    seed_key: "ceremony-vow-microphone",
    group: "ceremony",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Lesz-e mikrofon a fogadalmakhoz, és hogyan oldjuk meg a hangosítást?",
      en: "Will there be a microphone for the vows, and how is the sound handled?",
    },
    hint: {
      hu: "Szabadtéren és nagy létszámnál a halk fogadalom elvész. Kérdezd meg, csíptetős vagy kézi mikrofon lesz, ki kezeli, és ha nincs DJ a szertartáson, ki adja a hangosítást.",
      en: "Outdoors and with a large crowd, quiet vows get lost. Ask whether it is a clip-on or handheld mic and who manages it.",
    },
    supplier_category: "music_dj",
    default_priority: 1,
  },
  {
    seed_key: "ceremony-toss-permission",
    group: "ceremony",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Engedélyezett-e a sziromszórás, konfetti vagy buborékfújás a helyszínen?",
      en: "Is petal tossing, confetti, or bubbles allowed at the venue?",
    },
    hint: {
      hu: "Sok helyszín tiltja a műanyag konfettit vagy a beltéri szórást a takarítás miatt. Kérdezd meg, mi megengedett és hol.",
      en: "Many venues ban plastic confetti or indoor tossing because of cleanup. Ask what is allowed and where.",
    },
    supplier_category: "venue",
    default_priority: 1,
  },
  {
    seed_key: "ceremony-unplugged-policy",
    group: "ceremony",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Legyen-e unplugged szertartás, ahol a vendégek leteszik a telefont?",
      en: "Will the ceremony be unplugged, with phones put away?",
    },
    hint: {
      hu: "A felemelt telefonok kilógnak a fotós felvételein, és eltakarják az arcokat. Ha igen, kérd meg a szertartásvezetőt, hogy jelezze a vendégeknek.",
      en: "Raised phones photobomb the photographer's shots and hide faces. If yes, ask the officiant to remind guests at the start.",
    },
    default_priority: 0,
  },
  {
    seed_key: "ceremony-officiant-intro",
    group: "ceremony",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Legyen-e ceremóniamesteri felvezetés a szertartás előtt vagy a belépés előtt?",
      en: "Will there be a host or officiant introduction before the ceremony begins?",
    },
    hint: {
      hu: "Egy rövid felvezetés leülteti a vendégeket, jelzi a kezdést és bemondja az unplugged kérést. Tisztázzátok, ki és mit mond.",
      en: "A short intro seats the guests, signals the start, and can deliver the unplugged request. Settle who says it and what.",
    },
    default_priority: 0,
  },
  {
    seed_key: "ceremony-live-stream",
    group: "ceremony",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Lesz-e élő közvetítés a távoli vendégeknek?",
      en: "Will you live stream the ceremony for remote guests?",
    },
    hint: {
      hu: "Jelöljetek ki egy felelőst és egy fix állványos telefont vagy kamerát, és előre teszteljétek a térerőt vagy wifit a szertartás helyén.",
      en: "Assign one person and a phone or camera on a fixed tripod, and test signal or wifi at the ceremony spot beforehand.",
    },
    default_priority: 0,
  },
  {
    seed_key: "ceremony-religious-rituals",
    group: "ceremony",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Milyen vallási vagy kulturális rítuselemek legyenek a szertartásban?",
      en: "Which religious or cultural ritual elements will the ceremony include?",
    },
    hint: {
      hu: "Gyertyagyújtás, áldás, homokszertartás vagy közös ima: egyeztessétek a lelkésszel vagy paphoz a sorrendet és a kellékeket.",
      en: "Candle lighting, blessing, sand ritual, or shared prayer: coordinate the order and props with your minister or priest.",
    },
    condition: "religious",
    default_priority: 1,
  },
  {
    seed_key: "ceremony-pet-handler",
    group: "ceremony",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Ki vezeti és viszi el a kisállatot a ceremónia után?",
      en: "Who handles the pet and takes it away after the ceremony?",
    },
    hint: {
      hu: "A kutya csak rövid ideig bírja a figyelmet. Legyen egy felelős, aki bevezeti, majd a szertartás után hazaviszi vagy felügyeli.",
      en: "A dog only handles attention for a short while. Have one person bring it in, then take it home or watch it after the ceremony.",
    },
    condition: "has_pets",
    default_priority: 0,
  },
  {
    seed_key: "ceremony-kids-during-ceremony",
    group: "ceremony",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Mi legyen a kisgyerekekkel a szertartás alatt?",
      en: "What is the plan for young children during the ceremony?",
    },
    hint: {
      hu: "Egy síró baba vagy unatkozó gyerek megzavarhatja a csendes pillanatokat. Gondoljatok ki egy halk foglalkoztatót vagy egy felügyelőt a hátsó sorhoz.",
      en: "A crying baby or restless child can disrupt the quiet moments. Plan a quiet activity or a minder near the back row.",
    },
    condition: "has_children",
    default_priority: 0,
  },
  {
    seed_key: "style-decor-guestbook-format",
    group: "style_decor",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Milyen formájú legyen a vendégkönyv?",
      en: "What form should the guestbook take?",
    },
    hint: {
      hu: "Klasszikus könyv, aláírható poszter, üzenetes kártyák egy dobozba, vagy Polaroid-album. Döntsd el, ki teszi ki látható helyre és melyik asztalhoz.",
      en: "A classic book, a poster to sign, message cards dropped in a box, or a Polaroid album. Decide who sets it out and at which table.",
    },
    default_priority: 0,
  },
  {
    seed_key: "style-decor-photo-booth-or-corner",
    group: "style_decor",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Lesz fotósarok vagy photo booth?",
      en: "Will there be a photo corner or photo booth?",
    },
    hint: {
      hu: "Ha igen, kell hozzá háttér, kellékek és világítás. Tisztázd, gép vagy bérelt automata, és ki tölti újra a papírt vagy a kellékeket este.",
      en: "If yes, you need a backdrop, props and lighting. Clarify whether it is a hired booth or a camera, and who restocks paper or props during the night.",
    },
    default_priority: 0,
  },
  {
    seed_key: "style-decor-signage-checklist",
    group: "style_decor",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Melyik papírtáblák kellenek: ülésrend, asztalszám, menü, itallap, programtábla?",
      en: "Which printed signs do you need: seating chart, table numbers, menu, drinks list, schedule board?",
    },
    hint: {
      hu: "Nem mind kell minden esküvőre. Jelöld be, mi van, hogy a nyomdai rendelés egyben mehessen, és ne maradjon ki egy darab sem.",
      en: "Not every wedding needs all of them. Tick what applies so the print order goes out in one batch and nothing is missing.",
    },
    default_priority: 0,
  },
  {
    seed_key: "style-decor-place-cards-needed",
    group: "style_decor",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Lesz névkártya minden terítéken vagy csak asztalbeosztás?",
      en: "Will there be a place card at every setting, or just table assignments?",
    },
    hint: {
      hu: "Kötött ültetésnél névkártya kell, szabad ülésnél elég az asztalszám. Ettől függ, hány darabot kell nyomtatni és kihelyezni.",
      en: "Fixed seating needs place cards, open seating just needs table numbers. This decides how many pieces to print and lay out.",
    },
    default_priority: 0,
  },
  {
    seed_key: "style-decor-welcome-sign",
    group: "style_decor",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Lesz üdvözlőtábla a bejáratnál?",
      en: "Will there be a welcome sign at the entrance?",
    },
    hint: {
      hu: "A nevetek és a dátum a fogadásnál. Döntsd el, nyomtatott, írott vagy tükör, és ki állítja fel, ki viszi haza utána.",
      en: "Your names and the date at the reception. Decide if it is printed, hand-lettered or a mirror, and who sets it up and takes it home.",
    },
    default_priority: 0,
  },
  {
    seed_key: "style-decor-ceremony-flowers-reuse",
    group: "style_decor",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Mi lesz a ceremónia virágaival utána: átviszik a vacsorához?",
      en: "What happens to the ceremony flowers afterwards: moved to the dinner?",
    },
    hint: {
      hu: "A kapudísz és a sorvégek gyakran újrahasználhatók a vacsoraterembe. Beszéld meg, ki és mikor pakolja át a ceremónia és a vacsora között.",
      en: "The arch and aisle pieces can often be reused in the dinner room. Agree who moves them, and when, between ceremony and dinner.",
    },
    default_priority: 0,
  },
  {
    seed_key: "style-decor-delivery-to-venue",
    group: "style_decor",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Ki viszi a dekort a helyszínre és mikorra?",
      en: "Who brings the decor to the venue and by when?",
    },
    hint: {
      hu: "A saját kezű dekornál (gyertyák, keretek, vendégkönyv) nevesíts egy felelőst és egy időpontot, hogy ne aznap reggel derüljön ki, hogy a kocsiban maradt.",
      en: "For self-supplied decor (candles, frames, guestbook) name one person and a time, so it does not turn out on the morning that it was left in the car.",
    },
    condition: "own_decor",
    default_priority: 1,
  },
  {
    seed_key: "style-decor-setup-owner",
    group: "style_decor",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Ki pakolja ki és rendezi el a dekort a helyszínen?",
      en: "Who sets up and arranges the decor at the venue?",
    },
    hint: {
      hu: "A párnak aznap nem ér rá erre. Bízd egy barátra, a koordinátorra vagy a dekoros csapatra, és adj nekik egy fotót a kívánt elrendezésről.",
      en: "The couple has no time for this on the day. Hand it to a friend, the coordinator or the decor team, and give them a photo of the wanted layout.",
    },
    condition: "own_decor",
    default_priority: 1,
  },
  {
    seed_key: "style-decor-gift-table",
    group: "style_decor",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Lesz ajándékasztal, és hol áll a teremben?",
      en: "Will there be a gift table, and where in the room?",
    },
    hint: {
      hu: "Jól látható, de nem útban legyen, lehetőleg a bejárat közelében. Tisztázd, ki visz haza mindent a végén.",
      en: "Visible but out of the way, ideally near the entrance. Clarify who takes everything home at the end.",
    },
    default_priority: 0,
  },
  {
    seed_key: "style-decor-open-flame-allowed",
    group: "style_decor",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Engedélyezett a nyílt láng és a gyertya a dekorban?",
      en: "Is open flame and candle decor allowed?",
    },
    hint: {
      hu: "Sok helyszín csak üvegbe zárt vagy LED-gyertyát enged, faszerkezetnél tilthatja. Kérdezd meg a helyszínt a dekorrendelés előtt.",
      en: "Many venues only allow enclosed or LED candles, and timber structures may ban flame entirely. Ask the venue before ordering decor.",
    },
    supplier_category: "venue",
    default_priority: 1,
  },
  {
    seed_key: "style-decor-stationery-quantities-confirm",
    group: "style_decor",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Egyeztetett-e a nyomda a végleges darabszámokat és neveket a névkártyákhoz?",
      en: "Has the stationer confirmed the final counts and names for the place cards?",
    },
    hint: {
      hu: "Az ülésrend és a névkártya a végleges létszámból készül, ezért a lemondásokat is át kell adni. A neveket ellenőriztesd vissza nyomtatás előtt.",
      en: "The seating chart and place cards are built from the final headcount, so cancellations must be passed on. Have the names proofread before printing.",
    },
    supplier_category: "stationery",
    default_priority: 1,
  },
  {
    seed_key: "style-decor-florist-setup-teardown",
    group: "style_decor",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "A virágos kihelyezi és elszállítja a dekort, vagy nektek kell?",
      en: "Does the florist set up and remove the floral decor, or is that on you?",
    },
    hint: {
      hu: "Tisztázd, benne van-e a helyszíni installálás, az átpakolás a vacsorához és az esti bontás, vagy csak leszállítják. Ettől függ, kell-e segítőt szervezni.",
      en: "Clarify whether on-site setup, the move to dinner and the evening teardown are included, or just delivery. This decides if you need to arrange help.",
    },
    supplier_category: "decor_floral",
    default_priority: 1,
  },
  {
    seed_key: "style-decor-kids-corner-decor",
    group: "style_decor",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Lesz gyereksarok kifestővel és játékkal?",
      en: "Will there be a kids corner with coloring and toys?",
    },
    hint: {
      hu: "Egy kis asztal kifestővel, ceruzával és pár játékkal leköti a gyerekeket a vacsora alatt. Döntsd el, ki rendezi be és hová tegyük.",
      en: "A small table with coloring sheets, pencils and a few toys keeps children busy during dinner. Decide who sets it up and where it goes.",
    },
    condition: "has_children",
    default_priority: 0,
  },
  {
    seed_key: "style-decor-outdoor-signage-wind",
    group: "style_decor",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "A szabadtéri táblák és könnyű dekor rögzítve van szél ellen?",
      en: "Are the outdoor signs and light decor secured against wind?",
    },
    hint: {
      hu: "A kinti üdvözlőtábla, könnyű váza és papír menü elszáll vagy felborul széllökésben. Tervezz nehezéket, állványt vagy rögzítést hozzá.",
      en: "An outdoor welcome sign, light vase or paper menu blows away or tips over in a gust. Plan weights, stands or fixings for them.",
    },
    condition: "outdoor",
    default_priority: 1,
  },
  {
    seed_key: "style-decor-table-numbering-scheme",
    group: "style_decor",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Hogyan jelöljük az asztalokat: számmal vagy névvel?",
      en: "How will the tables be labeled: numbers or names?",
    },
    hint: {
      hu: "Szám egyszerűbb a felszolgálásnak és az ülésrendnek, a téma-nevek hangulatosak. Bármit választasz, legyen összhangban az ülésrend-táblával.",
      en: "Numbers are simpler for service and the seating chart, themed names add character. Whichever you pick, keep it consistent with the seating chart.",
    },
    default_priority: 0,
  },
  {
    seed_key: "music-photo-first-dance-song",
    group: "music_photo",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: { hu: "Melyik legyen a nyitótánc zenéje?", en: "Which song will be your first dance?" },
    hint: {
      hu: "Adjátok meg a DJ-nek vagy a zenekarnak pontosan, lemezverzió vagy élő feldolgozás kell-e, és kell-e rövidített vágás.",
      en: "Tell the DJ or band the exact track, whether you want the recorded version or a live cover, and if it needs a shortened edit.",
    },
    condition: "evening_party",
    default_priority: 1,
  },
  {
    seed_key: "music-photo-parent-dance",
    group: "music_photo",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Lesz szülőtánc, és kivel táncoltok?",
      en: "Will there be a parent dance, and with whom?",
    },
    hint: {
      hu: "Tisztázzátok, ki kivel táncol és milyen zenére, hogy senki ne maradjon kínosan állva. Elvált vagy elhunyt szülő esetén előre beszéljétek meg a forgatókönyvet.",
      en: "Decide who dances with whom and to what music so no one is left standing awkwardly. If a parent is divorced or has passed, plan the moment in advance.",
    },
    condition: "evening_party",
    default_priority: 0,
  },
  {
    seed_key: "music-photo-do-not-play-list",
    group: "music_photo",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: 'Állítsátok össze a "semmiképp ne menjen" számlistát.',
      en: 'Put together your "do not play" song list.',
    },
    hint: {
      hu: "Pár tiltott szám vagy stílus (pl. exhez kötődő dal, bizonyos műfaj) sokat ér a DJ-nek. Adjátok át időben.",
      en: "A few banned songs or genres (an ex-related track, a style you can't stand) really help the DJ. Hand it over in time.",
    },
    condition: "evening_party",
    default_priority: 1,
  },
  {
    seed_key: "music-photo-must-play-list",
    group: "music_photo",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: 'Állítsátok össze a "mindenképp játsszátok" számlistát.',
      en: 'Put together your "definitely play these" song list.',
    },
    hint: {
      hu: "10-15 biztos befutó dal, amitől garantáltan megtelik a tánctér. Ne tervezzétek túl, a DJ-nek hagyjatok mozgásteret.",
      en: "10-15 sure-fire tracks that will fill the dance floor. Don't over-plan it; leave the DJ room to read the room.",
    },
    condition: "evening_party",
    default_priority: 0,
  },
  {
    seed_key: "music-photo-dj-final-timeline",
    group: "music_photo",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Megkapta a DJ vagy zenekar a pontos napi menetrendet?",
      en: "Does the DJ or band have the final run-of-day timeline?",
    },
    hint: {
      hu: "A bevonulás, első tánc, tortavágás, menyasszonytánc és beszédek pontos időpontjai nélkül félrecsúszik a buli. Egyeztessétek a koordinátorral is.",
      en: "Without exact times for the entrance, first dance, cake cutting, bride's dance and speeches, the night drifts off track. Sync it with your coordinator too.",
    },
    supplier_category: "music_dj",
    default_priority: 1,
  },
  {
    seed_key: "music-photo-entrance-song",
    group: "music_photo",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Milyen zenére vonultok be a vacsorához?",
      en: "What song will you walk in to for the reception?",
    },
    hint: {
      hu: "A nagy bevonulás zenéje adja meg az este hangulatát. Döntsétek el, energikus vagy meghitt belépőt szeretnétek.",
      en: "Your grand entrance song sets the tone for the evening. Decide whether you want a high-energy or an intimate entrance.",
    },
    condition: "evening_party",
    default_priority: 0,
  },
  {
    seed_key: "music-photo-bouquet-toss",
    group: "music_photo",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: { hu: "Lesz csokordobás, és mikor?", en: "Will you do a bouquet toss, and when?" },
    hint: {
      hu: "Ha igen, kell-e külön dobócsokor, hogy az igazi megmaradjon. Egyeztessétek a fotóssal és a DJ-vel az időpontot.",
      en: "If yes, you may want a separate toss bouquet so you can keep the real one. Coordinate the timing with the photographer and DJ.",
    },
    condition: "evening_party",
    default_priority: 0,
  },
  {
    seed_key: "music-photo-garter-toss",
    group: "music_photo",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Lesz harisnyakötő-dobás vagy hasonló program?",
      en: "Will there be a garter toss or similar program?",
    },
    hint: {
      hu: "Sok pár ma már kihagyja, vagy szelídebb verziót választ. Döntsétek el előre, hogy a műsorvezető tudja, számoljon-e vele.",
      en: "Many couples skip it now or pick a tamer version. Decide in advance so the MC knows whether to include it.",
    },
    condition: "evening_party",
    default_priority: 0,
  },
  {
    seed_key: "music-photo-bride-dance-format",
    group: "music_photo",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Lesz menyasszonytánc, és hogyan bonyolítsátok?",
      en: "Will there be a bride's dance, and how should it run?",
    },
    hint: {
      hu: "Tisztázzátok a pénzgyűjtés módját (tányér, perselyező), ki vezeti és meddig tartson. A menyasszonyszöktetés is ide tartozik, ha lesz.",
      en: "Decide how the money is collected, who leads it, and how long it runs. The bride-kidnapping bit belongs here too, if you're doing it.",
    },
    condition: "evening_party",
    default_priority: 0,
  },
  {
    seed_key: "music-photo-dinner-games",
    group: "music_photo",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Lesz játék vagy program a vacsora alatt?",
      en: "Will there be games or activities during dinner?",
    },
    hint: {
      hu: "Kvíz a párról, cipős játék, tanúk műsora. Döntsétek el, mit engedélyeztek, hogy ne legyen kínos vagy túl hosszú.",
      en: "A quiz about the couple, the shoe game, a bit by the witnesses. Decide what you allow so it doesn't get awkward or run long.",
    },
    condition: "evening_party",
    default_priority: 0,
  },
  {
    seed_key: "music-photo-speeches-schedule",
    group: "music_photo",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: { hu: "Ki és mikor mond beszédet?", en: "Who gives a speech, and when?" },
    hint: {
      hu: "Rögzítsétek a sorrendet és nagyjából a hosszt, hogy ne csússzon szét a vacsora. Szóljatok a beszélőknek előre.",
      en: "Lock the order and rough length so dinner doesn't drag. Let each speaker know in advance.",
    },
    default_priority: 0,
  },
  {
    seed_key: "music-photo-speech-microphone",
    group: "music_photo",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Lesz mikrofon a beszédekhez és a műsorvezetőnek?",
      en: "Is there a microphone for speeches and the MC?",
    },
    hint: {
      hu: "Nagyobb terem vagy szabadtér esetén kézi vagy csiptetős mikrofon nélkül a hátsó asztalok semmit nem hallanak. Kérdezzétek meg a DJ-t vagy zenekart.",
      en: "In a larger room or outdoors, without a handheld or clip mic the back tables hear nothing. Ask the DJ or band.",
    },
    supplier_category: "music_dj",
    default_priority: 1,
  },
  {
    seed_key: "music-photo-noise-curfew",
    group: "music_photo",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Van hangerőlimit vagy csendrendelet a helyszínen?",
      en: "Is there a noise limit or curfew at the venue?",
    },
    hint: {
      hu: "Sok helyszínen este 10-22 óra után kötelező halkítani vagy beltérre költözni a buli. Tudjátok meg előre, hogy ne a hatóság állítsa le.",
      en: "Many venues require turning it down or moving indoors after a set hour. Find out up front so the authorities don't shut it down.",
    },
    supplier_category: "venue",
    default_priority: 1,
  },
  {
    seed_key: "music-photo-first-look",
    group: "music_photo",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Lesz first look fotózás a szertartás előtt?",
      en: "Will you do a first look shoot before the ceremony?",
    },
    hint: {
      hu: "Ha igen, ez extra időt igényel a napirendben, de oldja a feszültséget és kényelmesebb a páros fotózás. Egyeztessétek a fotóssal.",
      en: "If yes, it needs extra time in the day's schedule but eases the nerves and makes the couple's portraits more relaxed. Coordinate with the photographer.",
    },
    condition: "pro_photo",
    default_priority: 0,
  },
  {
    seed_key: "music-photo-group-shot-list",
    group: "music_photo",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Állítsátok össze a kötelező csoportkép-listát és ki tereli a családot.",
      en: "Build the must-have group photo list and pick who herds the family.",
    },
    hint: {
      hu: "Konkrét felsorolás (pl. menyasszony szülei, nagyszülők, tanúk) felgyorsítja a fotózást. Jelöljetek ki egy hangos rokont, aki név szerint összehívja az embereket.",
      en: "A concrete list (bride's parents, grandparents, witnesses) speeds up the session. Assign one loud relative to call people over by name.",
    },
    condition: "pro_photo",
    default_priority: 0,
  },
  {
    seed_key: "music-photo-detail-shot-list",
    group: "music_photo",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Készítsétek elő a részletfotókhoz a kellékeket.",
      en: "Gather the items for the detail shots.",
    },
    hint: {
      hu: "Gyűrűk, ruha, cipő, meghívó, parfüm, ékszer, csokor egy helyen legyen reggel, hogy a fotós gyorsan le tudja kapni a készülődésnél.",
      en: "Have the rings, dress, shoes, invitation, perfume, jewelry and bouquet in one spot in the morning so the photographer can shoot them quickly while you get ready.",
    },
    condition: "pro_photo",
    default_priority: 0,
  },
  {
    seed_key: "music-photo-drone-allowed",
    group: "music_photo",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Engedélyezett a drónfelvétel a helyszínen?",
      en: "Are drone shots allowed at the venue?",
    },
    hint: {
      hu: "Védett terület, repülőtér közelsége vagy házirend tilthatja. Tisztázzátok a helyszínnel és a fotóssal, mielőtt rákalkuláltok a videóra.",
      en: "A protected area, nearby airport, or house rules may forbid it. Clear it with the venue and the videographer before you count on aerial footage.",
    },
    supplier_category: "venue",
    condition: "pro_photo",
    default_priority: 0,
  },
  {
    seed_key: "music-photo-gallery-delivery",
    group: "music_photo",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Mikor és hol lesznek elérhetők a kész fotók és a videó?",
      en: "When and where will the finished photos and video be available?",
    },
    hint: {
      hu: "Kérdezzétek meg a leadási határidőt, a galéria formáját (online link, letöltés) és hogy meddig marad elérhető. Az előzetes (sneak peek) időpontja is jó, ha van.",
      en: "Ask about the delivery deadline, the gallery format (online link, download) and how long it stays live. Find out if there's a sneak peek date too.",
    },
    supplier_category: "photo_video",
    condition: "pro_photo",
    default_priority: 0,
  },
  {
    seed_key: "music-photo-guest-photo-qr",
    group: "music_photo",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Lesz vendég-fotó feltöltés QR-kóddal?",
      en: "Will you set up guest photo uploads via QR code?",
    },
    hint: {
      hu: "Egy QR-kód az asztalokon, amin a vendégek a saját képeiket egy közös albumba töltik. Döntsétek el, melyik megoldást használjátok, és tegyétek ki időben.",
      en: "A QR code on the tables lets guests drop their own shots into a shared album. Pick the service and put the codes out in time.",
    },
    default_priority: 0,
  },
  {
    seed_key: "music-photo-vendor-backup-clause",
    group: "music_photo",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Van a szerződésben pótlás, ha a fotós vagy videós megbetegszik?",
      en: "Does the contract cover a backup if the photographer or videographer falls ill?",
    },
    hint: {
      hu: "Az egyszeri esemény legnagyobb pótolhatatlan kockázata, ha a fotós aznap kiesik. Kérdezd meg, van-e helyettesítési záradék és bevonható kollégahálózat.",
      en: "A no-show on the day is the one loss you can't redo. Ask whether there is a substitution clause and a network they can call on.",
    },
    supplier_category: "photo_video",
    condition: "pro_photo",
    default_priority: 1,
  },
  {
    seed_key: "guests-plus-one-policy",
    group: "guests",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: { hu: "Ki hozhat kísérőt (plus one)?", en: "Who is allowed to bring a plus one?" },
    hint: {
      hu: "Döntsétek el a szabályt: csak a komoly párkapcsolatban élők, vagy mindenki. Ezt következetesen tartsátok, különben sértődés lesz belőle.",
      en: "Set a clear rule (only established couples, or everyone) and apply it consistently, otherwise it causes hurt feelings.",
    },
    default_priority: 1,
  },
  {
    seed_key: "guests-children-invited-policy",
    group: "guests",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Gyerekes esküvő lesz vagy felnőtt only?",
      en: "Are children invited, or is it adults only?",
    },
    hint: {
      hu: "Ha felnőtt only, jelezzétek a meghívón finoman, hogy a szülők időben tudjanak felügyeletet szervezni.",
      en: "If it is adults only, signal it gently on the invitation so parents can arrange childcare in time.",
    },
    default_priority: 1,
  },
  {
    seed_key: "guests-rsvp-dietary-collection",
    group: "guests",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Allergiák és étrendi igények begyűjtése az RSVP-ben",
      en: "Collect allergies and dietary needs in the RSVP",
    },
    hint: {
      hu: "Kérdezzétek be vendégenként (vegetáriánus, vegán, gluténmentes, laktózmentes, allergia). A végső számokat a catering felé továbbítani kell.",
      en: "Ask per guest (vegetarian, vegan, gluten-free, lactose-free, allergies). The final counts must go to catering.",
    },
    default_priority: 2,
  },
  {
    seed_key: "guests-allergy-handoff-catering",
    group: "guests",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Kezelitek a súlyos allergiákat (pl. mogyoró, glutén) külön?",
      en: "Can you handle severe allergies (e.g. nut, gluten) separately?",
    },
    hint: {
      hu: "Kérdezzétek meg, hogy az érintett vendég tányérja jelölve van-e és a konyha elkerüli-e a keresztszennyeződést.",
      en: "Ask whether the affected guest's plate is marked and the kitchen avoids cross-contamination.",
    },
    supplier_category: "catering",
    default_priority: 2,
  },
  {
    seed_key: "guests-kids-menu-catering",
    group: "guests",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Van gyerekmenü és milyen kortól?",
      en: "Is there a kids menu, and from what age?",
    },
    hint: {
      hu: "Tisztázzátok az árat és hogy hány éves korig számít gyereknek, hogy a végösszeg ne legyen meglepetés.",
      en: "Clarify the price and the age cutoff for a child plate so the final bill holds no surprises.",
    },
    supplier_category: "catering",
    condition: "has_children",
    default_priority: 1,
  },
  {
    seed_key: "guests-accessibility-mobility",
    group: "guests",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Akadálymentes a helyszín (rámpa, mosdó, lift)?",
      en: "Is the venue wheelchair accessible (ramp, restroom, lift)?",
    },
    hint: {
      hu: "Ha van mozgáskorlátozott vagy idős vendég, ellenőrizzétek a megközelítést és a mosdót előre, ne a helyszínen derüljön ki.",
      en: "If a guest uses a wheelchair or is elderly, confirm access and the restroom in advance, not on the day.",
    },
    supplier_category: "venue",
    default_priority: 1,
  },
  {
    seed_key: "guests-accommodation-block",
    group: "guests",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Szállásblokk foglalása a vidéki és külföldi vendégeknek",
      en: "Reserve a room block for out-of-town guests",
    },
    hint: {
      hu: "Kérjetek el pár szobát kedvezményes áron egy közeli szállodában, és küldjétek ki a foglalási kódot időben.",
      en: "Hold a set of rooms at a nearby hotel at a group rate and send the booking code out early.",
    },
    condition: "accommodation_needed",
    default_priority: 1,
  },
  {
    seed_key: "guests-transfer-shuttle",
    group: "guests",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Lesz transzfer busz a szállás és a helyszín között?",
      en: "Will there be a shuttle between the lodging and the venue?",
    },
    hint: {
      hu: "Két irány kell: oda a ceremóniára és vissza este. A visszafelé induló időpontot egyeztessétek a buli várható végével.",
      en: "You need both directions: out for the ceremony and back at night. Match the return time to when the party ends.",
    },
    supplier_category: "transport",
    condition: "accommodation_needed",
    default_priority: 1,
  },
  {
    seed_key: "guests-late-ride-home",
    group: "guests",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Taxi vagy sofőr ajánlás a vendégek hazajutásához",
      en: "Arrange a taxi or driver option for getting home",
    },
    hint: {
      hu: "Tegyetek ki egy helyi taxi számot, vagy szervezzetek éjszakai fuvart, hogy senki ne vezessen ittasan.",
      en: "Post a local taxi number or set up a night ride so nobody drives after drinking.",
    },
    default_priority: 1,
  },
  {
    seed_key: "guests-parking-info",
    group: "guests",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Parkolási infó kiküldése a vendégeknek",
      en: "Send parking information to guests",
    },
    hint: {
      hu: "Hol parkolhatnak, fizetős-e, és van-e elég hely. Ezt az útbaigazítóval együtt érdemes kiküldeni.",
      en: "Where to park, whether it costs, and if there is enough space. Send it together with the directions.",
    },
    default_priority: 0,
  },
  {
    seed_key: "guests-welcome-bag",
    group: "guests",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: { hu: "Welcome csomag a szállodai szobákba?", en: "Welcome bag in the hotel rooms?" },
    hint: {
      hu: "Egyszerű csomag (víz, snack, programlap, helyi tipp) sokat jelent a messziről érkezőknek. Egyeztessétek a recepcióval a kihelyezést.",
      en: "A simple bag (water, snack, schedule, local tip) means a lot to guests who travel far. Arrange drop-off with the front desk.",
    },
    condition: "accommodation_needed",
    default_priority: 0,
  },
  {
    seed_key: "guests-childcare-babysitter",
    group: "guests",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Lesz bébiszitter vagy gyerekfelügyelet?",
      en: "Will there be a babysitter or supervised childcare?",
    },
    hint: {
      hu: "Egy dedikált felügyelő mellett a szülők is el tudnak lazulni. Tisztázzátok, meddig marad és hol lesz a gyerekek helye.",
      en: "With a dedicated minder the parents can relax too. Settle how late they stay and where the kids will be.",
    },
    condition: "has_children",
    default_priority: 0,
  },
  {
    seed_key: "guests-kids-corner-program",
    group: "guests",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Gyereksarok vagy gyerekprogram a vacsora alatt?",
      en: "A kids corner or activity during dinner?",
    },
    hint: {
      hu: "Egy nyugodt sarok játékkal, színezővel leköti a kicsiket, amíg a felnőttek vacsoráznak. Hely és felügyelet kell hozzá.",
      en: "A calm corner with toys and coloring keeps the little ones busy while adults dine. It needs space and supervision.",
    },
    condition: "has_children",
    default_priority: 0,
  },
  {
    seed_key: "guests-quiet-seating-elderly",
    group: "guests",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Csendes hely és kényelmes ülőhely az idősebbeknek",
      en: "A quiet spot and easy seating for older guests",
    },
    hint: {
      hu: "Ültessétek őket a hangfaltól távolabb, közel a mosdóhoz és a kijárathoz, hogy korábban is el tudjanak menni.",
      en: "Seat them away from the speakers, near the restroom and exit, so they can leave early if needed.",
    },
    default_priority: 0,
  },
  {
    seed_key: "guests-directional-signage",
    group: "guests",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Útbaigazító táblák a helyszínre és a helyszínen belül",
      en: "Directional signs to and inside the venue",
    },
    hint: {
      hu: "A főúttól a parkolóig és a ceremónia helyéig. Nagy helyszínen belül is segít, ha jelzitek a mosdót és a termet.",
      en: "From the main road to the parking and the ceremony spot. On a large site it also helps to mark the restroom and hall.",
    },
    default_priority: 0,
  },
  {
    seed_key: "guests-arrival-time-waiting",
    group: "guests",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Mikor érkezhetnek a vendégek és hol várakoznak a ceremónia előtt?",
      en: "When can guests arrive, and where do they wait before the ceremony?",
    },
    hint: {
      hu: "Adjatok meg egy érkezési ablakot (pl. 30 perccel előtte), és jelöljetek ki egy fedett, üdítős várakozót, ha meleg vagy eső van.",
      en: "Give an arrival window (e.g. 30 minutes before) and set a covered waiting area with drinks in case of heat or rain.",
    },
    default_priority: 0,
  },
  {
    seed_key: "guests-pet-attendance",
    group: "guests",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Bejöhet a kutyátok a ceremóniára vagy a fotózásra?",
      en: "Can your dog be present at the ceremony or photos?",
    },
    hint: {
      hu: "Sok helyszínnek szabálya van a kisállatra. Ha be akarjátok vonni, kérjetek engedélyt és szervezzetek valakit, aki a buli alatt vigyáz rá.",
      en: "Many venues have pet rules. If you want to include them, get permission and arrange someone to look after the pet during the party.",
    },
    supplier_category: "venue",
    condition: "has_pets",
    default_priority: 0,
  },
  {
    seed_key: "style-decor-second-dress",
    group: "morning_timeline",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Lesz második (esti) ruha a bulira?",
      en: "Will there be a second (evening) dress for the party?",
    },
    hint: {
      hu: "Ha igen, kell hely az átöltözéshez és valaki, aki segít. Gondold át a cipőváltást is a táncra.",
      en: "If yes, you need a place to change and someone to help. Think about a shoe swap for dancing too.",
    },
    default_priority: 0,
  },
  {
    seed_key: "morning-timeline-hairmakeup-order",
    group: "morning_timeline",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Ki készülődik először: haj vagy smink, és milyen sorrendben a lányok?",
      en: "Who gets ready first, and in what order, hair or makeup?",
    },
    hint: {
      hu: "A menyasszony általában a sor közepén végez, ne a legvégén, hogy maradjon idő a ruhára és a fotókra. Koszorúslányok előbb.",
      en: "The bride usually finishes mid-sequence, not last, so there is time for the dress and photos. Bridesmaids go earlier.",
    },
    default_priority: 1,
  },
  {
    seed_key: "morning-timeline-supplier-contact-person",
    group: "morning_timeline",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Ki a szolgáltatók fő kapcsolattartója aznap a pár helyett?",
      en: "Who is the suppliers' point of contact on the day instead of you?",
    },
    hint: {
      hu: "Adjatok meg egy telefonszámot a szolgáltatóknak, hogy titeket ne hívogassanak kérdésekkel. Általában a koordinátor vagy egy tanú.",
      en: "Give suppliers one phone number so they do not call you with questions. Usually the coordinator or a witness.",
    },
    default_priority: 2,
  },
  {
    seed_key: "morning-timeline-emergency-kit",
    group: "morning_timeline",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Állítsátok össze a vészhelyzeti táskát a készülődéshez.",
      en: "Pack the emergency kit for getting ready.",
    },
    hint: {
      hu: "Varrókészlet, tűzőgép, tűsarok-védő, fájdalomcsillapító, folteltávolító, zsebkendő, ragtapasz, hajtű, biztosítótű, dezodor.",
      en: "Sewing kit, stapler, heel protectors, painkillers, stain remover, tissues, plasters, hairpins, safety pins, deodorant.",
    },
    default_priority: 1,
  },
  {
    seed_key: "morning-timeline-bride-accessories-prep",
    group: "morning_timeline",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Készítsétek elő a menyasszonyi kellékeket: fátyol, hajdísz, ékszer, cipő.",
      en: "Lay out the bridal accessories: veil, hair piece, jewellery, shoes.",
    },
    hint: {
      hu: "Pakoljátok egy helyre előző este, hogy reggel ne kelljen keresgélni. Jelöljétek, ki hozza, ha máshol van.",
      en: "Gather them in one place the night before so nothing is hunted for in the morning. Note who brings any item kept elsewhere.",
    },
    default_priority: 0,
  },
  {
    seed_key: "morning-timeline-groom-accessories-prep",
    group: "morning_timeline",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Készítsétek elő a vőlegény kellékeit: mandzsetta, öv, nyakkendő vagy csokornyakkendő, zokni.",
      en: "Lay out the groom's accessories: cufflinks, belt, tie or bow tie, socks.",
    },
    hint: {
      hu: "A kis dolgok tűnnek el a leggyorsabban. Próbáljátok fel a teljes szettet egyszer a nagy nap előtt.",
      en: "Small items disappear fastest. Try the full outfit on once before the big day.",
    },
    default_priority: 0,
  },
  {
    seed_key: "morning-timeline-comfy-shoes-evening",
    group: "morning_timeline",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Pakoljatok be váltócipőt vagy kényelmes cipőt az estére.",
      en: "Pack a change of shoes or comfortable shoes for the evening.",
    },
    hint: {
      hu: "A magas sarok a tánc közepére elfogy. Egy lapos balerina vagy párnázott talpú cipő megment a buli második felére.",
      en: "High heels run out by the middle of the dancing. A flat or cushioned pair saves the second half of the party.",
    },
    default_priority: 0,
  },
  {
    seed_key: "morning-timeline-dress-hanger-photos",
    group: "morning_timeline",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Szerezzetek szép ruhaakasztót a getting-ready fotókhoz.",
      en: "Get a nice hanger for the getting-ready photos.",
    },
    hint: {
      hu: "A ruhát gyakran felakasztva fotózzák a készülődés alatt. Egy fa vagy díszes akasztó sokkal jobban mutat a műanyagnál.",
      en: "The dress is often shot hanging during getting ready. A wooden or decorative hanger looks far better than the plastic one.",
    },
    default_priority: 0,
  },
  {
    seed_key: "morning-timeline-breakfast-lunch",
    group: "morning_timeline",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Szervezzétek meg a reggelit vagy ebédet a készülődés alatt.",
      en: "Arrange breakfast or lunch during getting ready.",
    },
    hint: {
      hu: "Senki ne készülődjön éhgyomorra. Könnyű, nem zsíros, nem foltozó kaja, és sok víz a haj-smink csapatnak is.",
      en: "No one should get ready on an empty stomach. Light, non-greasy, non-staining food, and plenty of water for the hair and makeup team too.",
    },
    default_priority: 0,
  },
  {
    seed_key: "morning-timeline-printed-schedule-suppliers",
    group: "morning_timeline",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Nyomtassátok ki a napi menetrendet a szolgáltatóknak.",
      en: "Print the run sheet for the suppliers.",
    },
    hint: {
      hu: "A fotós, DJ, catering és koordinátor kapjon egy egyoldalas idővonalat helyszínekkel és telefonszámokkal. Ne csak digitálisan.",
      en: "The photographer, DJ, caterer and coordinator each get a one-page timeline with locations and phone numbers. Not just digital.",
    },
    default_priority: 1,
  },
  {
    seed_key: "morning-timeline-departure-time",
    group: "morning_timeline",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Mikor kell elindulni a készülődés helyszínéről, és ki figyeli az indulást?",
      en: "When do you leave the getting-ready location, and who watches the departure?",
    },
    hint: {
      hu: "Számoljatok rá a parkolásra, beülésre és a forgalomra. Jelöljetek ki valakit, aki 10 perccel előbb szól, hogy gyülekező.",
      en: "Account for parking, loading in and traffic. Assign someone to call the move 10 minutes early so everyone gathers.",
    },
    default_priority: 1,
  },
  {
    seed_key: "morning-timeline-trial-runtime-check",
    group: "morning_timeline",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Pontosan mennyi időt kérsz a menyasszonyi hajra és sminkre, és hányan fértek bele a reggelbe?",
      en: "Exactly how long do you need for the bridal hair and makeup, and how many others can you fit in the morning?",
    },
    hint: {
      hu: "A próbasmink alapján add meg a valós időigényt. Ha a koszorúslányok és anyukák is nálad készülnek, kell-e asszisztens.",
      en: "Base the real timing on the trial. If bridesmaids and mothers also get done with you, decide whether a second artist is needed.",
    },
    supplier_category: "hair_makeup",
    default_priority: 1,
  },
  {
    seed_key: "morning-timeline-photographer-arrival",
    group: "morning_timeline",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Hány órakor érkezel a készülődéshez, és melyik részt akarod biztosan elcsípni?",
      en: "What time will you arrive for getting ready, and which moments do you want to be sure to catch?",
    },
    hint: {
      hu: "Egyeztessétek, mire legyen kész a ruha, a kellékek és a menyasszony, hogy a fotós ne várakozzon vagy ne maradjon le a részletfotókról.",
      en: "Agree when the dress, details and bride should be ready so the photographer neither waits around nor misses the detail shots.",
    },
    supplier_category: "photo_video",
    condition: "pro_photo",
    default_priority: 0,
  },
  {
    seed_key: "dayof-money-supplier-cash-owner",
    group: "dayof_money_close",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Ki fizet a helyszínen fizetendő szolgáltatóknak az esküvő napján?",
      en: "Who pays the suppliers that settle on the wedding day?",
    },
    hint: {
      hu: "Egy konkrét nevet jelölj ki, ne titeket. A vőlegény vagy a menyasszony aznap el lesz foglalva, a felelős legyen józan, megbízható és elérhető a helyszínen.",
      en: "Name one specific person, not yourselves. You will be busy all day, so pick someone sober, reliable and present on site.",
    },
    default_priority: 2,
  },
  {
    seed_key: "dayof-money-cash-envelopes-prepared",
    group: "dayof_money_close",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Készítsétek elő a feliratozott készpénz-borítékokat szolgáltatónként",
      en: "Prepare labeled cash envelopes for each supplier",
    },
    hint: {
      hu: "Külön boríték minden szolgáltatónak, ráírva a név és a pontos összeg. A felelős előre megkapja a teljes csomagot, így aznap nem kell pénzt számolni.",
      en: "One envelope per supplier with the name and exact amount written on it. Hand the full set to your point person ahead of time so no one counts money on the day.",
    },
    default_priority: 2,
  },
  {
    seed_key: "dayof-money-tip-amounts-decided",
    group: "dayof_money_close",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Eldöntöttétek, kinek és mennyi borravalót adtok?",
      en: "Have you decided who gets a tip and how much?",
    },
    hint: {
      hu: "Általában a felszolgálók, a sofőr, a hajas-sminkes és a DJ kap. Tegyétek külön, felcímkézett borítékba, ne a nagy összegekből kelljen váltani.",
      en: "Usually the servers, driver, hair and makeup artist and the DJ. Put it in separate labeled envelopes so no one has to make change on the day.",
    },
    default_priority: 1,
  },
  {
    seed_key: "dayof-close-leftover-cake-owner",
    group: "dayof_money_close",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Ki viszi haza a maradék tortát és süteményt a végén?",
      en: "Who takes the leftover cake and desserts home at the end?",
    },
    hint: {
      hu: "Jelöljetek ki valakit, akinek van hűthető hely és hűtőtáska. A torta a buli végére könnyen ottfelejtődik, ha nincs gazdája.",
      en: "Pick someone with a cooler and fridge space. Leftover cake is the classic thing left behind when no one owns the job.",
    },
    condition: "wedding_cake",
    default_priority: 0,
  },
  {
    seed_key: "dayof-close-gifts-money-owner",
    group: "dayof_money_close",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Ki gyűjti be és viszi biztonságba a borítékokat, a perselyt és az ajándékokat?",
      en: "Who collects and secures the gift envelopes, the gift box and the presents?",
    },
    hint: {
      hu: "Egy megbízható, józan ember felelőssége legyen, és előre legyen hely (zárható autó vagy szoba). A boríték-persely a legkockázatosabb tétel a nap végén.",
      en: "Make it one trusted, sober person's job and agree where it goes (locked car or room). The money box is the riskiest item at the end of the night.",
    },
    default_priority: 2,
  },
  {
    seed_key: "dayof-close-decor-teardown-owner",
    group: "dayof_money_close",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Ki bontja le és pakolja össze a saját dekoráciotokat a buli után?",
      en: "Who takes down and packs up your own decorations after the party?",
    },
    hint: {
      hu: "A bérelt dekort a szolgáltató viszi, de a saját gyertyák, fotók, táblák, vázák a tieitek. Jelöljetek ki 2-3 embert, mert fáradtan senki sem önként vállalkozik rá.",
      en: "Rented decor goes back with the supplier, but your own candles, photos, signs and vases are yours. Assign two or three people, because no one volunteers for it tired.",
    },
    condition: "own_decor",
    default_priority: 0,
  },
  {
    seed_key: "dayof-close-rented-items-return",
    group: "dayof_money_close",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Rögzítsétek, ki és mikor adja vissza a bérelt kellékeket",
      en: "Set who returns the rented items and by when",
    },
    hint: {
      hu: "Nézzétek meg a bérleti szerződésben a visszaadás határidejét és helyét, mert a késedelem napidíjat vagy kötbért von maga után. Jelöljetek ki felelőst minden bérleményhez.",
      en: "Check the rental contract for the return deadline and place, since a late return triggers a daily fee or penalty. Assign an owner to each rented item.",
    },
    default_priority: 1,
  },
  {
    seed_key: "dayof-close-attire-return-cleaning",
    group: "dayof_money_close",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Beállítottátok a ruha visszavitelének vagy tisztításának határidejét?",
      en: "Have you set the deadline to return or clean the outfits?",
    },
    hint: {
      hu: "Bérelt öltöny vagy ruha esetén nézzétek a leadási dátumot. Saját ruhánál a foltok (bor, fű, smink) frissen jönnek ki, ne hagyjátok hetekig állni.",
      en: "For a rented suit or dress, check the drop-off date. For your own, stains like wine, grass and makeup come out fresh, so do not let them sit for weeks.",
    },
    supplier_category: "attire",
    default_priority: 0,
  },
  {
    seed_key: "dayof-close-venue-key-handover",
    group: "dayof_money_close",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Hogyan zajlik a kulcs- és eszközátadás, és ki veszi át a helyszínt a végén?",
      en: "How does the key and equipment handover work, and who checks the venue at the end?",
    },
    hint: {
      hu: "Kérdezzétek meg, kell-e közös bejárás záráskor, mit ellenőriznek (kár, tisztaság), és visszajár-e kaució. Jelöljetek ki a ti oldalatokról egy felelőst az átadásra.",
      en: "Ask whether there is a joint walkthrough at closing, what they check (damage, cleanliness) and whether a deposit is refunded. Assign one person on your side to handle it.",
    },
    supplier_category: "venue",
    default_priority: 1,
  },
  {
    seed_key: "dayof-close-lost-found-owner",
    group: "dayof_money_close",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Ki szedi össze az elhagyott tárgyakat és a vendégek kabátjait a végén?",
      en: "Who gathers the lost items and guests' coats at the end?",
    },
    hint: {
      hu: "Telefonok, kabátok, szemüvegek, ajándékok maradnak. Egy ember járja végig az asztalokat és a ruhatárat záráskor, és gyűjtse egy dobozba.",
      en: "Phones, coats, glasses and gifts get left behind. One person should sweep the tables and cloakroom at closing and put everything in one box.",
    },
    default_priority: 0,
  },
  {
    seed_key: "dayof-close-couple-ride-home",
    group: "dayof_money_close",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Lefoglaltátok, hogyan jut haza a pár a buli végén?",
      en: "Have you arranged how the two of you get home at the end?",
    },
    hint: {
      hu: "Egyikőtök sem fog vezetni. Foglaljatok előre sofőrt vagy taxit, vagy intézzetek szállást a helyszínen, ne hajnalban kelljen kapkodni.",
      en: "Neither of you will be driving. Book a driver or taxi in advance, or arrange a room on site, so you are not scrambling at dawn.",
    },
    default_priority: 1,
  },
  {
    seed_key: "dayof-close-parents-thankyou",
    group: "dayof_money_close",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Készítsetek köszönő ajándékot vagy üzenetet a szülőknek",
      en: "Prepare a thank-you gift or note for the parents",
    },
    hint: {
      hu: "Egy apró ajándék vagy kézzel írt levél, amit aznap vagy a köszöntő közben adtok át. Döntsétek el előre, ki adja oda és mikor.",
      en: "A small gift or handwritten note given on the day or during the toasts. Decide in advance who hands it over and when.",
    },
    default_priority: 0,
  },
  {
    seed_key: "dayof-close-suppliers-thankyou",
    group: "dayof_money_close",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Küldjetek köszönő üzenetet és értékelést a szolgáltatóknak az esküvő után",
      en: "Send a thank-you message and review to your suppliers after the wedding",
    },
    hint: {
      hu: "Egy rövid visszajelzés és egy online értékelés sokat számít nekik, és nektek is jól jön, ha később ajánlanátok őket. Egy hét múlva, frissen küldjétek.",
      en: "A short note and an online review means a lot to them and helps you if you recommend them later. Send it within a week while it is fresh.",
    },
    default_priority: 0,
  },
  {
    seed_key: "dayof-close-guests-thankyou",
    group: "dayof_money_close",
    prompt_kind: "todo",
    prompt_target: "couple",
    title: {
      hu: "Tervezzétek meg a vendégeknek küldött köszönő üzenetet az esküvő után",
      en: "Plan the thank-you message to your guests after the wedding",
    },
    hint: {
      hu: "Egy közös üzenet vagy kártya, amiben megköszönitek a részvételt és az ajándékokat. Döntsétek el, e-mailben, kártyán vagy a fotókkal együtt küldöd-e.",
      en: "A shared note or card thanking guests for coming and for their gifts. Decide whether it goes out by email, on a card, or together with the photos.",
    },
    default_priority: 0,
  },
  {
    seed_key: "dayof-close-photo-gallery-location",
    group: "dayof_money_close",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Hol és mikor lesz elérhető a hivatalos fotógaléria, és meddig marad fenn?",
      en: "Where and when will the official photo gallery be available, and how long does it stay up?",
    },
    hint: {
      hu: "Kérdezzétek meg a szállítási határidőt, a megosztás módját (online galéria, letöltési link) és hogy meddig elérhető, mert sok galéria pár hónap után lejár.",
      en: "Ask about the delivery time, how it is shared (online gallery, download link) and how long it stays live, since many galleries expire after a few months.",
    },
    supplier_category: "photo_video",
    condition: "pro_photo",
    default_priority: 0,
  },
  {
    seed_key: "dayof-money-vendor-meals-counted",
    group: "dayof_money_close",
    prompt_kind: "check",
    prompt_target: "supplier",
    title: {
      hu: "Be vannak kalkulálva a szolgáltatói étkezések, és ki kéri be őket aznap?",
      en: "Are the supplier meals accounted for, and who orders them on the day?",
    },
    hint: {
      hu: "A fotós, videós, DJ és a koordinátor jellemzően meleg ételt kap, gyakran kedvezményes áron. Egyeztessétek a létszámot a cateringgel, hogy ne legyen aznapi pótrendelés.",
      en: "The photographer, videographer, DJ and coordinator usually get a hot meal, often at a reduced rate. Confirm the count with catering so there is no last-minute order.",
    },
    supplier_category: "catering",
    default_priority: 0,
  },
  {
    seed_key: "dayof-close-contingency-owner",
    group: "dayof_money_close",
    prompt_kind: "decision",
    prompt_target: "couple",
    title: {
      hu: "Ki kezeli az aznapi vészforgatókönyvet, ha kulcsszemély vagy szolgáltató kiesik?",
      en: "Who handles the day-of contingency if a key person or supplier drops out?",
    },
    hint: {
      hu: "Jelölj ki egy embert (nem a párt), aki aznap dönt és telefonál, ha valami felborul. Így nektek nem kell a saját esküvőtökön tűzoltani.",
      en: "Name one person (not the couple) who decides and makes calls if something goes sideways, so you aren't firefighting at your own wedding.",
    },
    default_priority: 1,
  },
];

// ─── lookup + selection helpers ──────────────────────────────────────────────

export const PROMPTS_BY_KEY: ReadonlyMap<string, PromptSeed> = new Map(
  PROMPT_SEEDS.map((s) => [s.seed_key, s]),
);

export function promptsForGroup(group: PromptGroup): PromptSeed[] {
  return PROMPT_SEEDS.filter((s) => s.group === group);
}

/** The manual intake dimensions - the conditions NOT derivable from existing
 *  couple/guest data, surfaced as the (non-blocking) intake strip. `has_children`
 *  and `religious` are pre-answerable from data but still listed so the couple
 *  can override. Answers: "yes" | "no" | unset. */
export const INTAKE_DIMENSIONS: readonly { tag: ConditionTag; question: LocaleText }[] = [
  {
    tag: "outdoor",
    question: {
      hu: "Lesz kültéri rész (ceremónia, koktél, vacsora)?",
      en: "Any outdoor part (ceremony, cocktail, dinner)?",
    },
  },
  {
    tag: "has_children",
    question: { hu: "Jönnek gyerekek?", en: "Will children attend?" },
  },
  {
    tag: "accommodation_needed",
    question: {
      hu: "Érkeznek vidékről vagy külföldről alvós vendégek?",
      en: "Are out-of-town guests staying over?",
    },
  },
  {
    tag: "religious",
    question: {
      hu: "Lesz vallási vagy kulturális rítus a ceremóniában?",
      en: "Any religious or cultural ritual in the ceremony?",
    },
  },
  {
    tag: "has_pets",
    question: { hu: "Bevontok kisállatot az esküvőbe?", en: "Will a pet be part of the wedding?" },
  },
  {
    tag: "evening_party",
    question: {
      hu: "Lesz esti buli tánccal és zenével?",
      en: "Will there be an evening party with dancing?",
    },
  },
  {
    tag: "alcohol_served",
    question: {
      hu: "Lesz alkohol felszolgálva (bár, bor, pezsgő)?",
      en: "Will alcohol be served (bar, wine, bubbly)?",
    },
  },
  {
    tag: "wedding_cake",
    question: {
      hu: "Lesz esküvői torta vagy desszertasztal?",
      en: "Will there be a wedding cake or dessert table?",
    },
  },
  {
    tag: "pro_photo",
    question: {
      hu: "Lesz hivatásos fotós vagy videós?",
      en: "Will you have a professional photographer or videographer?",
    },
  },
  {
    tag: "own_decor",
    question: {
      hu: "Visztek saját dekort, amit nektek kell ki- és bepakolni?",
      en: "Are you bringing your own decor to set up and pack down?",
    },
  },
];

export type ManualTagAnswers = Partial<Record<ConditionTag, "yes" | "no">>;

export interface PromptContext {
  /** From couples.ceremony_kind. */
  ceremonyKind: CeremonyKind | null;
  /** Does the guest list contain at least one child/baby? */
  hasChildren: boolean;
  /** Total guests if a list exists, else null ("not built yet"). */
  guestCount: number | null;
  /** The couple's manual intake answers. */
  manual: ManualTagAnswers;
}

/** Guest-count threshold above which "large headcount" prompts apply. */
export const LARGE_GUEST_COUNT = 120;

/** Is this prompt relevant to the couple right now? Inclusive by design: a
 *  conditional prompt is hidden ONLY when we have positive evidence it does not
 *  apply (the couple said "no", or the data definitively rules it out). An
 *  unanswered dimension keeps the prompt visible - a missed rain plan is far
 *  costlier than one extra card the couple dismisses with a click. A manual
 *  answer always wins over the data-derived default. */
export function isPromptVisible(seed: PromptSeed, ctx: PromptContext): boolean {
  const cond = seed.condition;
  if (!cond) return true;

  const manual = ctx.manual[cond];
  if (manual === "no") return false;
  if (manual === "yes") return true;

  // Unanswered: fall back to the data-derived, inclusive default.
  switch (cond) {
    case "has_children":
      // Hide only when a guest list exists and has zero children.
      return !(ctx.guestCount != null && ctx.guestCount > 0 && !ctx.hasChildren);
    case "religious":
      return ctx.ceremonyKind !== "civil";
    case "civil_only":
      return ctx.ceremonyKind !== "religious" && ctx.ceremonyKind !== "both";
    case "large_guest_count":
      return ctx.guestCount == null || ctx.guestCount >= LARGE_GUEST_COUNT;
    default:
      // outdoor / has_pets / destination / multi_event / accommodation_needed /
      // evening_party / alcohol_served / wedding_cake / pro_photo / own_decor:
      // inclusive until the couple actively answers "no".
      return true;
  }
}

export function visiblePromptsForGroup(group: PromptGroup, ctx: PromptContext): PromptSeed[] {
  return promptsForGroup(group).filter((s) => isPromptVisible(s, ctx));
}
