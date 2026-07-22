// Template content for the /app/planning wand + dice helpers. Strings live
// outside the locale tree because (a) they're content data, not UI labels,
// and (b) adding 50+ keys to keys.ts triples the i18n maintenance per item.
// Pattern mirrors `domain/suppliers_data.ts` on the backend: HU + EN inline.

import { contentLocale, type Locale } from "./i18n";

export type LocaleText = { hu: string; en: string };

export function localizeText(text: LocaleText, locale: Locale): string {
  return text[contentLocale(locale)];
}

/** Category tag carried by a creative idea so the Ideas tab can render and
 *  filter by type. Mirrors the same literal union the backend defines in
 *  shared/types.ts, keep the string values in sync. */
export type IdeaTag = "program" | "decor" | "surprise" | "keepsake" | "experience";

/** A creative idea card. `tag` is optional for backward compatibility, older
 *  pool entries simply render untagged. */
export type Idea = { title: LocaleText; body: LocaleText; tag?: IdeaTag };

/** Personalization intake "yes" answers the "Nektek ajánljuk" recommender
 *  matches on. Canonical condition tags, kept in sync with the personalization
 *  questions and the backend union. */
export type ConditionTag =
  | "evening_party"
  | "pro_photo"
  | "has_children"
  | "guest_keepsakes"
  | "printed_stationery"
  | "religious";

/** Task starter set, organised into two sections the wand renders as
 *  separate groups: the universally-applicable wedding bookings + decisions
 *  every Hungarian couple makes, followed by the honeymoon trip-prep set
 *  (passport, flights, insurance…) added once the couple sets a honeymoon
 *  destination. Groups stay distinct in the modal so the wedding list isn't
 *  drowned by trip items. */
export type TaskTemplateGroupId = "wedding" | "honeymoon";

export const TASK_TEMPLATE_GROUPS: {
  id: TaskTemplateGroupId;
  label: LocaleText;
  items: { title: LocaleText; deadline_days: number }[];
}[] = [
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
export const TASK_TEMPLATE: { title: LocaleText; deadline_days: number }[] =
  TASK_TEMPLATE_GROUPS.flatMap((g) => g.items);

/** Reserve honeymoon trip-prep tasks. NOT part of the base pack above, these
 *  are the backfill the honeymoon wand pulls from: for every base item a couple
 *  has already added (shown as "already on the list"), one fresh suggestion from
 *  here is appended to the bottom of the dialog so the pack always offers a full
 *  set of things still worth doing. Same HU + EN inline pattern as the groups.
 *  All real, broadly useful pre-departure tasks (no filler). */
export const HONEYMOON_EXTRA_TASKS: { title: LocaleText }[] = [
  { title: { hu: "Roaming vagy eSIM beállítása", en: "Set up roaming or an eSIM" } },
  {
    title: {
      hu: "Oltások és utazási egészségügy ellenőrzése",
      en: "Check vaccinations and travel health",
    },
  },
  {
    title: { hu: "Online check-in emlékeztető beállítása", en: "Set an online check-in reminder" },
  },
  {
    title: {
      hu: "Útiterv és foglalások mentése offline",
      en: "Save the itinerary and bookings offline",
    },
  },
  {
    title: {
      hu: "Fontos dokumentumok másolata (felhő + papír)",
      en: "Copies of key documents (cloud + paper)",
    },
  },
  {
    title: {
      hu: "Vészhelyzeti elérhetőségek és nagykövetség elmentése",
      en: "Save emergency contacts and the embassy",
    },
  },
  {
    title: {
      hu: "Hálózati adapter és töltő a célországhoz",
      en: "Power adapter and charger for the destination",
    },
  },
  { title: { hu: "Alap útipatika összeállítása", en: "Pack a basic travel first-aid kit" } },
  {
    title: {
      hu: "Otthoni teendők: növények, posta, kulcs",
      en: "Home prep: plants, mail, spare key",
    },
  },
  { title: { hu: "Reptéri parkolás vagy transzfer foglalása", en: "Book airport parking" } },
  {
    title: {
      hu: "Nemzetközi vezetői engedélyt igényelni",
      en: "Apply for an international driving permit",
    },
  },
  {
    title: {
      hu: "Pénznem és időeltolódás megnézése",
      en: "Check the currency and time difference",
    },
  },
];

/** Light starter set of "what to consider adding" ideas, the obvious-but-
 *  easy-to-forget options. The Wand button drops these in as starting points
 *  the couple can dismiss or refine. */
export const IDEA_TEMPLATE: { title: LocaleText; body?: LocaleText }[] = [
  {
    title: { hu: "Polaroid vendégkönyv", en: "Polaroid guest book" },
    body: {
      hu: "Polaroid fotó + üzenet minden vendégtől, egy közös albumba ragasztva.",
      en: "Each guest leaves a Polaroid + message, pasted into a shared album.",
    },
  },
  {
    title: { hu: "Saját koktél a nevetekkel", en: "Signature cocktail named after you" },
  },
  { title: { hu: "Esküvői honlap", en: "Wedding website" } },
  { title: { hu: "Csillagszórós kivonulás éjfél után", en: "Sparkler send-off after midnight" } },
  { title: { hu: "Élő zene a koktélórán", en: "Live music at the cocktail hour" } },
  { title: { hu: "Drónvideó a násznépről", en: "Drone shot from above" } },
  {
    title: {
      hu: "Magyar népi tánc betét a buliban",
      en: "Folk-music dance segment in the party",
    },
  },
  { title: { hu: "Második esküvői ruha az estére", en: "Second outfit for the evening party" } },
  { title: { hu: "Vendégeknek apró asztali ajándék", en: "Small table favours for the guests" } },
];

// --- Tagged, reusable idea objects -------------------------------------------
// These power both the dice pool below and the "Nektek ajánljuk" recommender.
// Defining each idea once keeps a single source of truth, so the same card
// never appears twice with diverging copy. Ideas referenced by the recommender
// live here; the rest stay inline in the pool array.

// Ceremony
const IDEA_UNITY_CANDLE: Idea = {
  title: {
    hu: "Közös gyertyagyújtás a szertartás végén",
    en: "Unity candle at the close of the ceremony",
  },
  body: {
    hu: "Szimbolikus, vizuálisan erős pillanat: két láng eggyé válik a szertartás végén.",
    en: "A symbolic, visually striking moment: two flames become one as the ceremony ends.",
  },
  tag: "program",
};
const IDEA_LIVE_PROCESSIONAL: Idea = {
  title: { hu: "Hangszeres élő zene a bevonuláshoz", en: "Live instruments for the processional" },
  body: {
    hu: "Vonós vagy akusztikus gitár a DJ helyett, a bevonulás sokkal meghittebb lesz.",
    en: "Strings or an acoustic guitar instead of the DJ, the entrance turns far warmer.",
  },
  tag: "program",
};
const IDEA_UNPLUGGED: Idea = {
  title: { hu: "Unplugged szertartás bejelentése", en: "Announce an unplugged ceremony" },
  body: {
    hu: "A fotós minden arcot megtart, nem a felemelt telefonok erdejét.",
    en: "The photographer keeps every face, not a forest of raised phones.",
  },
  tag: "program",
};
const IDEA_RING_BEARER_BASKET: Idea = {
  title: { hu: "Gyerek-gyűrűvivő kis kosárral", en: "Child ring-bearer with a little basket" },
  body: {
    hu: "Az egyik legjobban sikerülő, legaranyosabb pillanat a szertartáson.",
    en: "One of the sweetest, most reliably charming moments of the whole ceremony.",
  },
  tag: "program",
};

// Guests & atmosphere
const IDEA_TABLE_SIGN: Idea = {
  title: {
    hu: "Személyre szabott ültető-tábla minden asztalhoz",
    en: "A personalised sign for every table",
  },
  body: {
    hu: "Minden asztal kap egy témát, idézetet vagy közös emléket a párral.",
    en: "Each table gets a theme, a quote, or a shared memory with the couple.",
  },
  tag: "decor",
};
const IDEA_POLAROID_WALL: Idea = {
  title: { hu: "Polaroid-fal a vendégeknek", en: "A Polaroid wall for the guests" },
  body: {
    hu: "Mindenki ragaszt egy fotót az emléküzenete mellé, a fal estére megtelik.",
    en: "Everyone pins a photo beside their note, and the wall fills up by evening.",
  },
  tag: "experience",
};
const IDEA_WELCOME_DRINK_NAMED: Idea = {
  title: { hu: "Welcome drink különleges névvel", en: "A welcome drink with a name of its own" },
  body: {
    hu: "Pl. „Andor & Sári Spritz”, nem csak sima pezsgő a recepción.",
    en: 'Say the "Andor & Sári Spritz", not just plain bubbles at check-in.',
  },
  tag: "experience",
};
const IDEA_INTERACTIVE_GUESTBOOK: Idea = {
  title: { hu: "Interaktív vendégkönyv kérdésekkel", en: "An interactive guest book with prompts" },
  body: {
    hu: "Kérdések, mint „Legjobb tanács a párnak” vagy „Jóslat 10 évre”.",
    en: 'Prompts like "Best advice for the couple" or "A prediction for ten years out".',
  },
  tag: "experience",
};

// Entertainment & surprises
const IDEA_SECRET_SONG_SWITCH: Idea = {
  title: { hu: "Titkos első tánc-dallam csere", en: "Secret first-dance song switch" },
  body: {
    hu: "A vendégek nem tudják, mi szól el az első pár másodperc után, óriási a hatás.",
    en: "Guests have no idea what kicks in after the first few bars, the payoff is huge.",
  },
  tag: "surprise",
};
const IDEA_SPARKLER_EXIT: Idea = {
  title: {
    hu: "Sparkler-folyosó vagy tűzijáték a kivonulásnál",
    en: "Sparkler corridor or fireworks at the send-off",
  },
  body: {
    hu: "Három perc, de örökre emlékezetes, és minden fotós imádja.",
    en: "Three minutes long, unforgettable forever, and every photographer loves it.",
  },
  tag: "surprise",
};
const IDEA_WITNESS_STANDUP: Idea = {
  title: { hu: "Stand-up rész a tanúktól", en: "A stand-up bit from the witnesses" },
  body: {
    hu: "Öt perc, előre egyeztetve és időkorláttal, hogy ne fusson el.",
    en: "Five minutes, agreed in advance and time-boxed so it never runs away.",
  },
  tag: "program",
};
const IDEA_MIDNIGHT_SNACK: Idea = {
  title: {
    hu: "Éjféli hot dog vagy lángos meglepetés",
    en: "A midnight hot dog or lángos surprise",
  },
  body: {
    hu: "A vendégek bent maradnak és meglepődnek, amikor előkerül a meleg étel.",
    en: "Guests stay on and light up when warm food suddenly arrives.",
  },
  tag: "surprise",
};
const IDEA_COUPLE_QUIZ: Idea = {
  title: { hu: "Kahoot-kvíz rólatok a vacsoránál", en: "Couple-quiz Kahoot at dinner" },
  body: {
    hu: "Mobilon játszott kvíz a kapcsolatotokról, a közönség szavazza meg, melyikőtök hazudik nagyobbat.",
    en: "A phone-based quiz about your relationship, the room votes on who's bluffing harder.",
  },
  tag: "experience",
};

// Details & keepsakes
const IDEA_NAPKIN_RINGS: Idea = {
  title: {
    hu: "Személyre szabott szalvétagyűrűk a vendég nevével",
    en: "Personalised napkin rings with each guest's name",
  },
  body: {
    hu: "A vendégek hazaviszik őket emlékként, kettős szerepben: névkártya és ajándék.",
    en: "Guests take them home as a keepsake, doubling as both a place card and a favour.",
  },
  tag: "keepsake",
};
const IDEA_WEDDING_NEWSPAPER: Idea = {
  title: { hu: "Saját esküvői újság a vendégasztalon", en: "Your own wedding newspaper" },
  body: {
    hu: "Nyolcoldalas újság a tervezésetekről, közös fotókról, az aznapi programról, minden asztalra kettő.",
    en: "An eight-page paper covering your story, photos, and the day's schedule, two on every table.",
  },
  tag: "decor",
};
const IDEA_SCENT_CANDLE: Idea = {
  title: {
    hu: "Saját illatgyertya esküvői illattal",
    en: "A signature scent candle from the wedding",
  },
  body: {
    hu: "Kis üvegbe töltve, köszönő-ajándékként, a vendégek hazaviszik az esküvő illatát.",
    en: "Poured into a little jar as a thank-you favour, guests take home the scent of the day.",
  },
  tag: "keepsake",
};

// Photography extras
const IDEA_GUEST_SLIDESHOW: Idea = {
  title: { hu: "Diavetítés a vendégekről, nem rólatok", en: "Slideshow of your guests, not you" },
  body: {
    hu: "Egy közeli barát szervezi titokban, fotó minden vendégről, mosolyok a falon vacsora közben.",
    en: "A close friend collects photos in secret, every guest's face on the wall during dinner.",
  },
  tag: "surprise",
};
const IDEA_FIRST_LOOK_WITNESSES: Idea = {
  title: { hu: "First look a két tanúval", en: "A first look with the two witnesses" },
  body: {
    hu: "Nem csak a párnak, a legjobb barátnők és barátok reakciója is megörökíthető.",
    en: "Not just for the couple, you capture the best friends' reactions too.",
  },
  tag: "program",
};
const IDEA_QR_PHOTO_ALBUM: Idea = {
  title: { hu: "Vendég-fotófüzet QR-kóddal", en: "A guest photo album behind a QR code" },
  body: {
    hu: "Mindenki feltölti a saját képeit, a pár megkapja a komplett albumot a nap végén.",
    en: "Everyone uploads their own shots, and the couple gets the complete album by night's end.",
  },
  tag: "keepsake",
};

// Recommender-only ideas (curated for "Nektek ajánljuk", not in the dice pool)
const IDEA_LED_DANCEFLOOR: Idea = {
  title: {
    hu: "LED-tánctér vagy fényshow a buli csúcspontján",
    en: "An LED dance floor or light show at the peak",
  },
  body: {
    hu: "A buli csúcspontján a tér életre kel, a fotók és a hangulat is felrobban.",
    en: "At the peak of the party the room comes alive, photos and energy both spike.",
  },
  tag: "experience",
};
const IDEA_FIRST_LOOK_COUPLE: Idea = {
  title: {
    hu: "First look fotózás a szertartás előtt kettesben",
    en: "A first-look photo session before the ceremony",
  },
  body: {
    hu: "Egy meghitt pillanat csak kettőtöknek, mielőtt a nap igazán beindul.",
    en: "A private moment for just the two of you before the day truly kicks off.",
  },
  tag: "program",
};
const IDEA_DRONE_GOLDEN_HOUR: Idea = {
  title: {
    hu: "Drónfelvétel a helyszínről napkeltekor vagy naplementekor",
    en: "A drone shot of the venue at sunrise or sunset",
  },
  body: {
    hu: "Aranyórában a helyszín és a násznép madártávlatból, filmes nyitókép.",
    en: "The venue and the crowd from above in golden hour, a cinematic opening shot.",
  },
  tag: "program",
};
const IDEA_VIDEO_TIME_CAPSULE: Idea = {
  title: {
    hu: "Időkapszula videóüzenet a jövőnek",
    en: "A video time-capsule message to the future",
  },
  body: {
    hu: "A fotós rögzíti, ahogy üzentek a 10 év múlvai magatoknak, évfordulón nézitek vissza.",
    en: "The videographer records your message to your future selves, replayed on an anniversary.",
  },
  tag: "keepsake",
};
const IDEA_KIDS_CORNER: Idea = {
  title: {
    hu: "Gyerek-sarok rajzolással és mesével",
    en: "A kids' corner with drawing and stories",
  },
  body: {
    hu: "Rajzolás, meséskönyv, matrica-album, a szülők nyugodtan ünnepelhetnek.",
    en: "Drawing, picture books, sticker albums, so the parents can actually celebrate.",
  },
  tag: "experience",
};
const IDEA_KIDS_FAVOUR: Idea = {
  title: { hu: "Apró ajándék a gyerekeknek", en: "A small gift for the children" },
  body: {
    hu: "Buborékfújó vagy kis táska a névvel, a legkisebb vendégek is kapnak meglepetést.",
    en: "Bubbles or a little name-tagged bag, the smallest guests get a surprise too.",
  },
  tag: "keepsake",
};
const IDEA_KIDS_MENU: Idea = {
  title: { hu: "Külön gyerek-menü kreatív névvel", en: "A separate kids' menu with playful names" },
  body: {
    hu: "Saját, gyerekbarát fogások viccesen elnevezve, nem a felnőtt menü kicsinyítve.",
    en: "Their own child-friendly dishes with fun names, not just the adult menu shrunk down.",
  },
  tag: "experience",
};
const IDEA_PLACE_CARD: Idea = {
  title: {
    hu: "Személyre szabott ültetőkártya vendégenként",
    en: "A personalised place card for every guest",
  },
  body: {
    hu: "Minden vendég a saját nevével és helyével, rendezett, igényes belépő a vacsorához.",
    en: "Each guest with their own name and seat, a tidy, polished start to dinner.",
  },
  tag: "decor",
};
const IDEA_HANDWRITTEN_THANKYOU: Idea = {
  title: { hu: "Személyes köszönőlap kézírással", en: "A handwritten thank-you note" },
  body: {
    hu: "Minden vendégnek pár saját mondat kézzel írva, a legszemélyesebb gesztus.",
    en: "A few handwritten lines for every guest, the most personal gesture there is.",
  },
  tag: "keepsake",
};
const IDEA_SAND_CEREMONY: Idea = {
  title: {
    hu: "Homokszertartás a két szín összeöntésével",
    en: "A sand ceremony blending two colours",
  },
  body: {
    hu: "Két szín egy üvegbe öntve elválaszthatatlanná válik, szép szimbóluma a frigynek.",
    en: "Two colours poured into one jar become inseparable, a lovely symbol of the union.",
  },
  tag: "program",
};
const IDEA_SHARED_BLESSING: Idea = {
  title: {
    hu: "Közös áldás vagy ima a vendégekkel",
    en: "A shared blessing or prayer with the guests",
  },
  body: {
    hu: "A vendégek is bekapcsolódnak egy közös áldásba, mély, összetartó pillanat.",
    en: "Guests join in a collective blessing, a deep, unifying moment.",
  },
  tag: "program",
};

/** Creative-bold idea pool for the 🎲 randomizer. Mix of intimate, surprising,
 *  Hungarian-traditional-with-a-twist, sensory, and just plain delightful. The
 *  dialog picks 3 at random from this pool; the user accepts the ones that
 *  resonate. Keep the titles short (chips); body gives the why/how. */
export const DICE_CREATIVE_IDEAS: Idea[] = [
  {
    title: { hu: "Saját esküt írni és felolvasni", en: "Write and read your own vows" },
    body: {
      hu: "A standard polgári szöveg után pár saját mondat, a vendégek mindenki sírni fog.",
      en: "A few personal lines on top of the standard registrar text, guaranteed tears.",
    },
  },
  {
    title: { hu: "Időkapszula vendégek leveleivel", en: "Time capsule of guest letters" },
    body: {
      hu: "Minden vendég ír egy levelet, közösen elzárjátok, és a 10. évfordulón felbontjátok.",
      en: "Every guest writes a letter, you seal it together, and open it on your 10th anniversary.",
    },
    tag: "keepsake",
  },
  {
    title: { hu: "Élő festő dokumentál benneteket", en: "Live painter captures the wedding" },
    body: {
      hu: "Valós időben fest egy festményt a koktélóra alatt, egyedi „fotó” a falra.",
      en: "Paints the scene in real time during cocktail hour, a one-of-a-kind keepsake.",
    },
  },
  {
    title: { hu: "Kérjetek fel egy barátot meglepetés-beszédre", en: "Secret friend speech" },
    body: {
      hu: "A párod nem tud róla, felkéred a legjobb barátját, hogy mondjon róla egy beszédet.",
      en: "Your partner doesn't know, recruit their best friend to give a surprise toast.",
    },
  },
  {
    title: { hu: "Anonim házassági tanácsok", en: "Anonymous marriage advice jar" },
    body: {
      hu: "Mindenki ír egy névtelen tanácsot egy üvegbe; az 1. évfordulón olvassátok fel együtt.",
      en: "Every guest drops an anonymous note in a jar; read them together on year one.",
    },
  },
  {
    title: { hu: "Filmkockák rólatok a vacsora előtt", en: "Your story as a short film" },
    body: {
      hu: "Pár perces vágott film a közös életetekről, vetítve a vacsora kezdetén.",
      en: "Two-minute edit of your story together, projected as dinner begins.",
    },
  },
  {
    title: { hu: "Levél magatoknak az 1. évfordulóra", en: "Letter to your future selves" },
    body: {
      hu: "Külön-külön írtok egyet egymásnak; közösen bontjátok fel a következő évfordulón.",
      en: "Each write one to the other; open them together a year later.",
    },
  },
  {
    title: { hu: "Hajnali lángos vagy pizza a buli végén", en: "Dawn lángos / pizza at closing" },
    body: {
      hu: "A vendégek egy órával a tervezettnél tovább maradnak, ha tudják, hogy lesz lángos.",
      en: "Guests will hang on an hour longer if they know hot food is coming at dawn.",
    },
  },
  {
    title: { hu: "Karikatúra-rajzoló a koktélórán", en: "Caricature artist at cocktails" },
    body: {
      hu: "Mindenki visz haza egy mosolyos rajzot magáról, ajándék vendégkönyv helyett.",
      en: "Every guest takes home a smiling sketch, better than a polite guestbook signature.",
    },
  },
  {
    title: {
      hu: "Selyemszalagok rizs helyett a kivonulásnál",
      en: "Silk ribbon wands for the send-off",
    },
    body: {
      hu: "A vendégek lobogó szalagokkal kísérnek ki, fotózás közben sokkal szebb a rizsnél.",
      en: "Guests wave streaming ribbons as you leave, way more photogenic than rice.",
    },
  },
  {
    title: { hu: "Élő népdalének a szertartáson", en: "Live folk song at the ceremony" },
    body: {
      hu: "Egy közeli barát vagy népdalénekes a polgári után, meghittebb, mint a CD.",
      en: "A friend or folk singer right after the registrar, beats canned music every time.",
    },
  },
  {
    title: { hu: "Csak ti ketten, 10 perc a vacsora előtt", en: "Ten minutes alone before dinner" },
    body: {
      hu: "Tudatosan kiszöktök egy szobába, leültök egy tányér ételhez, csak ti ketten.",
      en: "Steal a private room with a plate of food before the toasts, just the two of you.",
    },
  },
  {
    title: { hu: "Saját termésű bor a vacsorához", en: "Your own homemade wine" },
    body: {
      hu: "Egy szülő vagy nagybácsi által palackozott bor a saját címkétekkel.",
      en: "Wine bottled by a parent or uncle, with your custom label on every bottle.",
    },
  },
  {
    title: {
      hu: "Falra vetített gyerekkori fotók",
      en: "Childhood photos projected during dinner",
    },
    body: {
      hu: "Néma slideshow a falon, a vendégek nézhetik miközben esznek, beszélgetnek.",
      en: "Silent slideshow on a wall, guests watch as they eat and chat.",
    },
  },
  {
    title: { hu: "Vendégek által ajánlott DJ-szám", en: "Guest-curated DJ requests" },
    body: {
      hu: "RSVP-vel együtt mindenki beír egy számot, a DJ a saját listája mellett ezeket is játssza.",
      en: "Guests submit one song with their RSVP; the DJ weaves them through the night.",
    },
  },
  {
    title: { hu: "Egy fát ültettek a vendégekkel", en: "Plant a tree with your guests" },
    body: {
      hu: "Mindenki hoz egy maréknyi földet a saját kertjéből, közös szimbolikus mozdulat.",
      en: "Each guest brings a handful of soil from their own garden, symbolic and grounding.",
    },
  },
  {
    title: { hu: "Cipő-játék a tanúkkal", en: "Shoe game with the witnesses" },
    body: {
      hu: "Hátul ülve, cipő fel-le: a tanúk feltett kérdéseire ti egymás cipőjével válaszoltok.",
      en: "Back-to-back, shoes raised: answer the witnesses' questions about each other.",
    },
  },
  {
    title: {
      hu: "Polaroid „Hello, my name is” a vendégeknek",
      en: "Polaroid name-tags for guests",
    },
    body: {
      hu: "Mindenkit lefotóztok a recepción + ráírja a kezét, keverednek a felek családjai.",
      en: "Snap each guest at check-in + they write their name, breaks the two-family ice.",
    },
  },
  {
    title: { hu: "Élő hegedűszó a kiállás közben", en: "Live violin during the recessional" },
    body: {
      hu: "Egy hegedűs kísér ki titeket a szertartásról, filmes pillanat lesz.",
      en: "A solo violinist walks you out of the ceremony, instant cinematic moment.",
    },
  },
  {
    title: { hu: "Titkos koreográfia a nyitótáncon", en: "Secret choreographed first dance" },
    body: {
      hu: "Pár hónapig titokban gyakoroltok; klasszikus lassú dal után átvált gyors számba.",
      en: "Practise in secret for months; a slow ballad suddenly flips into a fast routine.",
    },
  },
  {
    title: { hu: "„Mr & Mrs” játék a tanúkkal", en: "Mr & Mrs game with the witnesses" },
    body: {
      hu: "A tanúk kérdezik tőletek, mit gondol a másik; két csapatra szakad a terem.",
      en: "Witnesses quiz you on what the other would say; guests pick sides and cheer.",
    },
  },
  {
    title: { hu: "Vendégek üzenőfala időskálával", en: "Wish wall by milestone" },
    body: {
      hu: "Cetlik a falon: 1 év, 5 év, 10 év, a vendégek odaírják, mit kívánnak akkorra.",
      en: "Sticky notes on a wall: year 1, year 5, year 10, each guest writes a wish for that date.",
    },
  },
  {
    title: {
      hu: "Egyedi monogram poharakon, szalvétán",
      en: "Custom monogram on glassware, napkins",
    },
    body: {
      hu: "Egy közös motívum végigvonul mindenen, komolyabbnak hat, fele annyiba kerül, mint hisztek.",
      en: "One motif on everything ties the day together, looks pricier than it actually is.",
    },
  },
  {
    title: { hu: "Vendégek földajándékai egy bonsaihoz", en: "Bonsai built from guest gifts" },
    body: {
      hu: "Egy közeli barát visszaadja a bonsait évek múlva, élő emlék, nem fal-dekoráció.",
      en: "A close friend grows the bonsai for years and gifts it back, a living, breathing memory.",
    },
  },
  {
    title: { hu: "Karaoke duett a szülőkkel", en: "Karaoke duet with the parents" },
    body: {
      hu: "Az anyukáddal egy szám, az apósoddal egy másik, fél órán át mindenki sír és nevet.",
      en: "One song with your mum, another with your father-in-law, half an hour of joyful tears.",
    },
  },
  {
    title: { hu: "Vacsoraasztal saját családi recepttel", en: "Family-recipe dish at the dinner" },
    body: {
      hu: "Egy fogás a párod nagymamájának receptje alapján, a séf nevével rátok hangolva.",
      en: "One course made from your partner's grandmother's recipe, printed on the menu in her name.",
    },
  },
  {
    title: { hu: "Saját pálinka a vacsora utáni koccintáshoz", en: "Custom pálinka for the toast" },
    body: {
      hu: "Címkével együtt, a vendégek hazaviszik mint nászajándékot.",
      en: "Label included, guests take it home as a wedding favour.",
    },
  },
  {
    title: {
      hu: "Élő rajzoló a vendégkönyvet készíti",
      en: "Live illustrator draws the guest book",
    },
    body: {
      hu: "Egy művész egy hatalmas papírlapra felrajzol mindenkit, keret + fal otthon.",
      en: "An artist sketches every guest onto one big sheet, frame it for your wall later.",
    },
  },
  {
    title: { hu: "Csillagszórós kapu a bevonuláshoz", en: "Sparkler arch at the entrance" },
    body: {
      hu: "A vendégek két oldalt csillagszórót tartanak; ti kéz a kézben átsétáltok.",
      en: "Guests hold sparklers in two lines; you walk through hand in hand.",
    },
  },
  {
    title: { hu: "Köszönő-videó másnap a vendégeknek", en: "Thank-you video the next day" },
    body: {
      hu: "Reggel egy gyors videó tőletek, a fáradt, boldog ti, minden vendégnek elküldve.",
      en: "A quick morning-after video, tired but glowing, sent out to every guest.",
    },
  },
  {
    title: {
      hu: "Pillangó vagy galamb röptetése a szertartás végén",
      en: "Butterfly or dove release",
    },
    body: {
      hu: "Kétperces kép, minden fotós imádja, és minden vendég emlékezni fog rá.",
      en: "Two minutes of pure spectacle, photographers adore it, guests never forget it.",
    },
  },
  {
    title: { hu: "Néma diszkó éjféltől", en: "Silent disco from midnight" },
    body: {
      hu: "Fejhallgatós party három csatornával, a vendégek külön zenét hallgatnak, kívülről néma a tánc.",
      en: "Headphones-only party with three channels, guests dance to different music while the room stays silent.",
    },
  },
  {
    title: { hu: "Recept-vendégkönyv", en: "Recipe guest book" },
    body: {
      hu: "Minden vendég beírja a saját kedvenc receptjét, házassági szakácskönyvként hazaviszitek.",
      en: "Each guest writes in a favourite recipe, you take home a marriage cookbook.",
    },
  },
  {
    title: { hu: "Vendégek visznek haza palántát", en: "Take-home plant favours" },
    body: {
      hu: "Apró cserepes palánta névkártyával, nő veletek párhuzamosan, sokkal jobb mint a műanyag emléktárgy.",
      en: "A small potted seedling with a name card, grows alongside you, beats plastic favours.",
    },
  },
  {
    title: { hu: "Reggeli hangüzenet a párodtól", en: "Morning-of voice note from your partner" },
    body: {
      hu: "A párod előző este felvesz egy 30 másodperces üzenetet, készülődés közben hallgatod meg, sírni fogsz.",
      en: "Your partner records a 30-second message the night before, play it while you get ready, expect tears.",
    },
  },
  IDEA_WEDDING_NEWSPAPER,
  {
    title: { hu: "Esküvő-bingó kártyák a vendégeknek", en: "Wedding bingo cards for guests" },
    body: {
      hu: "Tipikus pillanatok (nagybácsi sír, mikrofon visszahangzik, valaki a tortába dől), aki kitölti, kap egy pálinkát.",
      en: "Classic moments (uncle cries, mic feedback, someone falls into the cake), first to fill a row wins a shot.",
    },
  },
  {
    title: { hu: "Lufi-engedés napnyugtakor", en: "Sunset balloon release" },
    body: {
      hu: "Lebomló latex-lufi, mindegyiken egy vendég üzenete, napnyugta pillanatában mindenki egyszerre engedi el.",
      en: "Biodegradable balloons with messages from each guest, released together as the sun drops.",
    },
  },
  {
    title: { hu: "Tanúk rögtönzött rapje a vacsoránál", en: "Witnesses' freestyle rap at dinner" },
    body: {
      hu: "A tanúk egy hete megírják, vacsoránál előadják, sokkal viccesebb mint a klasszikus tanúbeszéd.",
      en: "Witnesses write it a week ahead and perform at dinner, funnier than any conventional speech.",
    },
  },
  {
    title: { hu: "QR-kód a vendég-Spotify-listához", en: "QR to a guest-curated Spotify playlist" },
    body: {
      hu: "A vendégek RSVP-kor küldenek egy-egy számot; a teljes lista QR-kódján mindenki hazaviheti.",
      en: "Guests submit one song each at RSVP; the full playlist's QR code goes home with everyone.",
    },
  },
  {
    title: { hu: "Pizsamás brunch a vendégekkel másnap", en: "Pyjama brunch the next morning" },
    body: {
      hu: "A maradék vendégeknek tojás, bacon, mimóza-koktél pizsamában, a fáradt nevetés a legjobb fotó.",
      en: "Eggs, bacon, mimosas in pyjamas for whoever stayed, the tired laughter makes the best photo.",
    },
  },
  {
    title: {
      hu: "Élő tüzes előadás az első tánc előtt",
      en: "Live fire show before the first dance",
    },
    body: {
      hu: "5 perces profi tüzes performansz a kerten vagy teraszon, közvetlenül a nyitótánc előtt.",
      en: "Five-minute professional fire performance in the garden, right before the first dance.",
    },
  },
  {
    title: { hu: "Páros-keresős ültetés", en: "Pair-matching seat hunt" },
    body: {
      hu: "Mindenki egy páros tárgy egyik felét kapja, meg kell keresnie a vendéget a teremben, akkor talál helyet.",
      en: "Each guest gets half of a pair, find the matching guest to find your seat.",
    },
  },
  {
    title: {
      hu: "Nagyszülők esküvői fotója kivetítve",
      en: "Grandparents' wedding photos on display",
    },
    body: {
      hu: "Mindkét család nagyszüleinek esküvői fotói nagyméretben a bejáratnál, generációk a teremben.",
      en: "Large prints of both families' grandparents' wedding photos by the entrance, generations in the room.",
    },
  },
  {
    title: {
      hu: "Másnaposság-túlélő csomag a szállodaszobákban",
      en: "Hangover survival kit in hotel rooms",
    },
    body: {
      hu: "Víz, fájdalomcsillapító, fogkefe, csoki, papír zsebkendő, minden vidéki vendég áldani fog érte.",
      en: "Water, painkillers, toothbrush, chocolate, tissues, every out-of-town guest will thank you.",
    },
  },
  {
    title: { hu: "Csak gyertyafényes első fogás", en: "Candlelight-only first course" },
    body: {
      hu: "Az első fogásra lekapcsoljátok a villanyt, csak gyertyaláng marad, egy pillanat, ami megmarad mindenkinek.",
      en: "Lights off for the opening course, only candles. One frozen moment everyone remembers.",
    },
  },
  {
    title: {
      hu: "Pénzes-tánc közös élmény-céllal",
      en: "Money dance funding a shared experience",
    },
    body: {
      hu: "A hagyomány marad, de a pénz egy közös élményre megy, pl. egy nászúti hétvégére, élőben jelezve a térképen.",
      en: "Tradition stays, but the pot funds a shared experience, a honeymoon weekend tracked live on a map.",
    },
  },
  IDEA_GUEST_SLIDESHOW,
  IDEA_COUPLE_QUIZ,
  {
    title: {
      hu: "Hangüzenetes vendégkönyv régi telefonnal",
      en: "Voicemail guest book on an old phone",
    },
    body: {
      hu: "Régi telefonkagyló mikrofonja, a vendégek üzenetet hagynak, 1 év múlva újrahallgatjátok.",
      en: "An old phone receiver as a mic, guests leave voicemails you replay on year one.",
    },
  },
  {
    title: {
      hu: "Saját illat-keverés a szertartás részeként",
      en: "Custom scent blending in the ceremony",
    },
    body: {
      hu: "Két illóolajat összekevertek a polgári részeként, a végén lesz egy saját parfümötök, ami a napotokat idézi.",
      en: "Blend two essential oils together during the registrar, you walk out with your own signature scent of the day.",
    },
  },
  {
    title: { hu: "Gyertyaláng-átadás a vendégeknek", en: "Candle-passing ceremony" },
    body: {
      hu: "A pár meggyújtja a saját gyertyáját, a fény szétterjed a teremben, pillanatra mindenki tart fényt.",
      en: "You light your candle first; the flame travels through the room, for a beat, everyone holds light.",
    },
  },
  {
    title: { hu: "Saját limonádé-bár különleges ízekkel", en: "Signature lemonade bar" },
    body: {
      hu: "4-5 különleges íz (levendula, áfonya, kakukkfű) saját címkével, a gyerekek és a nem-iszók is ünnepelnek.",
      en: "Four or five unusual flavours (lavender, blueberry, thyme) with your label, kids and non-drinkers get to celebrate too.",
    },
  },
  // Tagged additions (see the named consts above).
  IDEA_UNITY_CANDLE,
  IDEA_LIVE_PROCESSIONAL,
  IDEA_UNPLUGGED,
  IDEA_RING_BEARER_BASKET,
  IDEA_TABLE_SIGN,
  IDEA_POLAROID_WALL,
  IDEA_WELCOME_DRINK_NAMED,
  IDEA_INTERACTIVE_GUESTBOOK,
  IDEA_SECRET_SONG_SWITCH,
  IDEA_SPARKLER_EXIT,
  IDEA_WITNESS_STANDUP,
  IDEA_MIDNIGHT_SNACK,
  IDEA_NAPKIN_RINGS,
  IDEA_SCENT_CANDLE,
  IDEA_FIRST_LOOK_WITNESSES,
  IDEA_QR_PHOTO_ALBUM,
];

/** "Nektek ajánljuk" map: each personalization intake "yes" answer points at a
 *  curated, stable (non-random) shortlist of ideas. Objects are reused from the
 *  tagged consts above so a card stays consistent wherever it appears. */
export const RECOMMENDED_BY_TAG: Record<ConditionTag, Idea[]> = {
  evening_party: [
    IDEA_SPARKLER_EXIT,
    IDEA_SECRET_SONG_SWITCH,
    IDEA_LED_DANCEFLOOR,
    IDEA_MIDNIGHT_SNACK,
    IDEA_COUPLE_QUIZ,
  ],
  pro_photo: [
    IDEA_FIRST_LOOK_COUPLE,
    IDEA_GUEST_SLIDESHOW,
    IDEA_DRONE_GOLDEN_HOUR,
    IDEA_VIDEO_TIME_CAPSULE,
  ],
  has_children: [IDEA_KIDS_CORNER, IDEA_KIDS_FAVOUR, IDEA_KIDS_MENU, IDEA_RING_BEARER_BASKET],
  guest_keepsakes: [IDEA_INTERACTIVE_GUESTBOOK, IDEA_POLAROID_WALL, IDEA_QR_PHOTO_ALBUM],
  printed_stationery: [IDEA_PLACE_CARD, IDEA_WEDDING_NEWSPAPER, IDEA_HANDWRITTEN_THANKYOU],
  religious: [IDEA_UNITY_CANDLE, IDEA_SAND_CEREMONY, IDEA_SHARED_BLESSING],
};

/** Given the set of "yes" intake tags, produce a deduplicated (by HU title)
 *  shortlist of recommended idea cards, capped at `max` (default 6). Unknown
 *  tags are ignored. Order follows the input tag order, then the per-tag list. */
export function recommendedIdeas(yesTags: string[], max = 6): Idea[] {
  const seen = new Set<string>();
  const out: Idea[] = [];
  for (const tag of yesTags) {
    const ideas = RECOMMENDED_BY_TAG[tag as ConditionTag] as Idea[] | undefined;
    if (!ideas) continue;
    for (const idea of ideas) {
      if (out.length >= max) return out;
      if (seen.has(idea.title.hu)) continue;
      seen.add(idea.title.hu);
      out.push(idea);
    }
  }
  return out;
}

/** Pull `count` distinct items from a pool, uniformly at random. */
export function rollDice<T>(pool: readonly T[], count: number): T[] {
  const copy = [...pool];
  const out: T[] = [];
  for (let i = 0; i < count && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy[idx]!);
    copy.splice(idx, 1);
  }
  return out;
}
