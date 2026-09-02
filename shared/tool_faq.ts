// Single source of truth for the per-tool FAQ copy on the /tools/* (HU:
// /eszkozok/*) landing pages.
//
// Used in two places, exactly like shared/seo_faq.ts does for the landing FAQ:
//   1. backend/src/lib/seo_ssr.ts → emits these verbatim as the FAQPage
//      JSON-LD on each tool path. Googlebot needs the SAME Q/A strings that
//      appear on the visible page; divergence is treated as cloaking and can
//      demote the page, which is exactly why this copy cannot stay in the
//      frontend-only locale tree.
//   2. frontend/src/pages/<Tool>Page.tsx → renders these into the visible
//      <details> FAQ cards.
//
// Edit this file (not duplicates in locales/seo_ssr) when tool FAQ copy
// changes — that is the whole point of keeping it in `shared/`.

import { isUiLocale, type UiLocale } from "./locales";
import type { SeoFaqEntry } from "./seo_faq";

/** The six tools that have an FAQ block. The slug is the stable key; the two
 *  path spellings are the HU and EN canonical URLs the SSR layer matches on. */
export type ToolFaqSlug =
  | "budget_calculator"
  | "countdown"
  | "guest_list_template"
  | "seating_chart"
  | "rsvp_generator"
  | "couple_cards"
  | "wedding_checklist";

/** HU + EN canonical paths per tool, mirroring SLUG_PAIRS in seo_routes.ts. */
export const TOOL_FAQ_PATHS: Record<ToolFaqSlug, { hu: string; en: string }> = {
  budget_calculator: {
    hu: "/eszkozok/eskuvo-koltsegvetes-kalkulator",
    en: "/tools/wedding-budget-calculator",
  },
  countdown: { hu: "/eszkozok/eskuvo-visszaszamlalo", en: "/tools/wedding-countdown" },
  guest_list_template: { hu: "/eszkozok/vendeglista-sablon", en: "/tools/guest-list-template" },
  seating_chart: { hu: "/eszkozok/ultetesi-rend-keszito", en: "/tools/seating-chart-builder" },
  rsvp_generator: { hu: "/eszkozok/rsvp-szoveg-generator", en: "/tools/rsvp-text-generator" },
  couple_cards: {
    hu: "/eszkozok/100-kerdes-eskuvo-elott",
    en: "/tools/100-questions-before-marriage",
  },
  wedding_checklist: {
    hu: "/eszkozok/eskuvoi-ellenorzolista",
    en: "/tools/wedding-checklist",
  },
};

/** Canonical slug per tool for the language-prefixed `/{lang}/tools/{slug}`
 *  URLs — the existing EN slug, unified across every language rather than
 *  translated per locale (one slug set to maintain, matches the EN half of
 *  `TOOL_FAQ_PATHS` above so it can't drift from the legacy paths). */
export const TOOL_SLUG_BY_KEY: Record<ToolFaqSlug, string> = Object.fromEntries(
  (Object.keys(TOOL_FAQ_PATHS) as ToolFaqSlug[]).map((key) => [
    key,
    TOOL_FAQ_PATHS[key].en.replace(/^\/tools\//, ""),
  ]),
) as Record<ToolFaqSlug, string>;

const SLUG_TO_TOOL_KEY = new Map<string, ToolFaqSlug>(
  (Object.keys(TOOL_SLUG_BY_KEY) as ToolFaqSlug[]).map((key) => [
    TOOL_SLUG_BY_KEY[key] as string,
    key,
  ]),
);

/** `/{lang}/tools/{slug}` URL for a tool in a given UI language. */
export function toolPathFor(lang: UiLocale, key: ToolFaqSlug): string {
  return `/${lang}/tools/${TOOL_SLUG_BY_KEY[key]}`;
}

/** Parses a `/{lang}/tools/{slug}` path. Null for anything else — an
 *  unrecognised language, an unknown slug, or a path shaped differently
 *  (including the legacy `/tools/*` / `/eszkozok/*` paths, which 301 to this
 *  shape at the server edge rather than being matched here). */
export function matchToolLangPath(pathname: string): { lang: UiLocale; key: ToolFaqSlug } | null {
  const match = /^\/([a-z]{2})\/tools\/([a-z0-9-]+)$/.exec(pathname);
  if (!match) return null;
  const [, lang, slug] = match;
  if (!isUiLocale(lang)) return null;
  const key = SLUG_TO_TOOL_KEY.get(slug ?? "");
  return key ? { lang, key } : null;
}

export const TOOL_FAQ: Record<UiLocale, Record<ToolFaqSlug, ReadonlyArray<SeoFaqEntry>>> = {
  hu: {
    budget_calculator: [
      {
        q: "Mennyibe kerül átlagosan egy esküvő Magyarországon?",
        a: "Egy 80–100 fős esküvő mediánja 5–8 millió forint 2026-ban, a vidéki és fővárosi árkülönbségtől függően. A kalkulátorban kicsi és nagy létszámra is megnézheted, hogyan oszlik el a keret kategóriák szerint.",
      },
      {
        q: "Mennyit költsünk egy vendégre?",
        a: "Egy vendégre átlagosan 50 000–80 000 Ft jut a teljes keretből, ami magába foglalja a cateringet, italokat, dekort és a vendégekre eső helyszín-arányt. A Wēddly kalkulátora pontosan kiszámolja a vendégszám és a keret alapján a per-fő költést.",
      },
      {
        q: "Hogyan oszlik meg az esküvői keret kategóriák között?",
        a: "Ajánlott bontás: ~35% catering és italok, ~18% helyszín, ~13% fotó-videó, ~9% dekor és virág, ~8% öltözet és szépség, ~7% zene/DJ, ~5% ceremónia, ~2% papírárú, és ~3% biztonsági tartalék. A kalkulátorban élőben látjátok az aktuális számokra vetítve.",
      },
      {
        q: "Megőrizhetők a számok regisztráció után?",
        a: "Igen. A „Folytasd a Wēddly-ben” gombbal a vendégszám és a teljes keret bekerül a saját workspace-etek vázlatába; a regisztráció utáni onboardingnál ezekkel a számokkal indul a tervezés. Onnantól kategóriánként szerkeszthetitek és bármikor szüneteltethetitek a workspace-et.",
      },
    ],
    countdown: [
      {
        q: "Mikor érdemes kezdeni az esküvőtervezést?",
        a: "Magyar átlag: 12–18 hónappal az esküvő előtt. A helyszín és a fotós a két leghamarabb foglalandó tétel, népszerű időpontokra 18 hónappal előtte már nehéz lehet jó helyszínt találni.",
      },
      {
        q: "Hány nappal előtte küldjük ki a meghívókat?",
        a: "Klasszikusan 8–12 héttel az esküvő előtt érdemes a meghívókat kiküldeni, RSVP-határidővel ~4 héttel az esküvő előtt. Külföldről érkező vendégeknek érdemes 4–6 héttel hamarabb save-the-date-et küldeni.",
      },
      {
        q: "Mi az a save-the-date és mikor küldjük?",
        a: "A save-the-date egy rövid előzetes értesítés a dátumról és a helyszín-régióról, hogy a vendégek be tudják iktatni a naptárukba. Ideális kiküldési idő: 6–9 hónappal az esküvő előtt, főleg ha sok vidéki vagy külföldi vendég lesz.",
      },
    ],
    guest_list_template: [
      {
        q: "Hány vendéget hívjunk az esküvőre?",
        a: "Magyar átlag: 80–120 fő. A létszám közvetlenül befolyásolja a helyszínt, cateringet és a teljes keret 55%-át, érdemes a vendégszámot előbb tisztázni, mint a keretet. A Wēddly költségvetés-kalkulátora élőben mutatja a hatást.",
      },
      {
        q: "Kiket NEM kell hívni az esküvőre?",
        a: "Nincs kötelező mező. Egy érvényes elv: ha az utolsó találkozás óta több mint 2 év telt el, vagy nem érdekel hogy ott legyenek-e a nagy napon, akkor inkább ne. A „kötelességből” meghívott vendégek a leggyakoribb feszültségforrás.",
      },
      {
        q: "Mit írjak a vendéglista Excel/Google Sheets fájlomban?",
        a: "Minimum: keresztnév, vezetéknév, kapcsolattartó (e-mail vagy telefon), háztartás, RSVP-státusz. Hasznos extra oszlopok: étrend, kísérő, kapcsolat típusa (család / barát / munka / egyetem). A Wēddly-sablon mindezt tartalmazza.",
      },
    ],
    seating_chart: [
      {
        q: "Hányan üljenek egy asztalnál?",
        a: "Kerek asztal: 8–10 fő ideális, max 12. Szögletes (banketts): 6–8 fő egy oldalon, vagyis 12–16 egy asztalon. 10 fő felett a beszélgetés szétfeslik, vendégek nem hallják egymást, a Wēddly figyelmeztet, ha túl sokat raksz egy asztalra.",
      },
      {
        q: "Mikor készítsem el az ültetési rendet?",
        a: "Az RSVP-határidő (~4 héttel az esküvő előtt) után érdemes kezdeni. A végleges létszámmal lehet pontosan tervezni; addig vázlat-szinten elég. A Wēddly-ben kétféle nézet van: tervezett és végleges, így átmehetsz vázlat-módból véglegesbe.",
      },
      {
        q: "Hogyan oldjam meg a kínos vendégeket?",
        a: "A legbiztosabb módszer: külön asztal és minimum 2 asztalnyi távolság. A vendéglistádba felviszed a konfliktust mint jegyzet, a Wēddly pedig jelez, ha véletlenül egymás mellé húzod őket.",
      },
    ],
    rsvp_generator: [
      {
        q: "Mit jelent az RSVP?",
        a: "Az RSVP a francia „Répondez s'il vous plaît” rövidítése, „kérjük, válaszoljon”. Esküvős kontextusban annyit jelent: kérjük, jelezze, hogy jön-e az esküvőre. A magyar esküvőkön klasszikusan 3–4 héttel az esküvő előtt szokás összegyűjteni.",
      },
      {
        q: "Mikor küldjem ki az RSVP-kérést?",
        a: "Az RSVP-kérés a meghívóval együtt megy, magyar átlag: 8–12 héttel az esküvő előtt. RSVP-határidő: ~4 héttel az esküvő előtt, hogy a catering-nek és helyszínnek időben tudjátok jelezni a végleges létszámot.",
      },
      {
        q: "Mit írjak az RSVP-szövegbe?",
        a: "Minimum: párotok neve, az esküvő dátuma, helyszín, RSVP-határidő és egy elérhetőség (e-mail vagy telefon, vagy egy link). Hasznos extra: étrend kérdés, kísérő-mező, allergia. A Wēddly RSVP-oldala ezeket egy linken keresztül oldja meg.",
      },
    ],
    couple_cards: [
      {
        q: "Mire való ez a 100 kérdés?",
        a: "Beszélgetésindító. A kutatások szerint a tartós kapcsolatokban az számít, hogy a pár képes-e nyitottan beszélni a pénzről, a családról, a vágyról és a halálról is. A négy paklit ezek köré rendeztük, hogy a nehéz témák ne maradjanak a szőnyeg alatt.",
      },
      {
        q: "Kötelező mind a 100-at megválaszolni?",
        a: "Nem. Egy kártya egy beszélgetés. Húzzatok egyet, beszéljétek meg, és tegyétek vissza a paklit. A böngészőtök megjegyzi, melyik kártyáknál tartotok, és a következő látogatáskor onnan folytatjátok.",
      },
      {
        q: "Miért pont ez a négy pakli?",
        a: "Tíz külső szakértő (párterapeuta, pénzügyi tervező, hosszan házas párok, intimitás-coach, filozófus) szemszögéből szűrtük le a témákat. Ami mindenkinél visszatért: a család öröksége, a pénz és a hétköznapok, a test és a vágy, és a halál–krízis–értelem hármasa. Innen jött a négy pakli.",
      },
    ],
    wedding_checklist: [
      {
        q: "Hány teendő van a listán?",
        a: "Kb. 100 tétel, 11 időszakra bontva: 12–18 hónappal előtte a nagy naptól egészen az esküvő utáni teendőkig. A kültéri, gyerekes vagy alkoholt kínáló esküvőkhöz a lista automatikusan kiegészül plusz tételekkel.",
      },
      {
        q: "A dátumomhoz igazodnak a határidők?",
        a: "Ezen az oldalon még nem, mert nincs megadva esküvői dátum. Regisztráció után a Wēddly a ti dátumotokhoz igazítja minden tétel ajánlott határidejét, és a saját Tervezés felületeteken folytatódik.",
      },
      {
        q: "Elmenthetem, amit itt kipipáltam?",
        a: "Igen. Amíg csak böngésztek, semmi sem gátol; amint kipipáltok egy tételt, felajánljuk, hogy hozzatok létre egy ingyenes fiókot, ami átveszi a kipipált tételeket a saját ellenőrzőlistátokba.",
      },
      {
        q: "Ingyenes a PDF letöltése?",
        a: "Igen, regisztráció nélkül is letölthető a teljes lista PDF-ben, nyomtatható formában.",
      },
    ],
  },
  en: {
    budget_calculator: [
      {
        q: "How much does an average wedding cost?",
        a: "An 80–100 guest wedding follows the same proportional split regardless of country, catering and venue dominate, with 20–25% of the remaining budget covering attire, music, ceremony and stationery. The calculator lets you see how the budget splits for any guest count + total in your own currency.",
      },
      {
        q: "How much per guest?",
        a: "Catering, drinks, decor and the guest-share of the venue typically run together as the largest per-guest cost. The calculator computes the exact per-guest figure for the total you set, work backwards from the per-guest you can afford if that frames the budget better for you.",
      },
      {
        q: "How is a wedding budget broken down by category?",
        a: "Hungarian-typical split: ~35% catering and drinks, ~18% venue, ~13% photo / video, ~9% decor and flowers, ~8% attire and beauty, ~7% music / DJ, ~5% ceremony, ~2% stationery, ~3% contingency. The calculator visualises this live against your numbers.",
      },
      {
        q: "Are the numbers saved after signup?",
        a: "Yes. The “Continue in Weddly” button carries the guest count + total into your workspace draft; onboarding picks up with those numbers pre-filled. From there it's per-category editable and you can pause the workspace any time.",
      },
    ],
    countdown: [
      {
        q: "How early should we start wedding planning?",
        a: "Typical: 12–18 months out. Venue and photographer book earliest, for popular dates, 18 months is already tight in Hungary.",
      },
      {
        q: "How long before the wedding should invitations go out?",
        a: "Classic: 8–12 weeks before the wedding, with an RSVP deadline ~4 weeks out. For out-of-town guests, send save-the-dates 4–6 weeks earlier.",
      },
      {
        q: "What is a save-the-date and when should we send it?",
        a: "A save-the-date is a short heads-up about the date and venue region so guests can block calendars. Ideal: 6–9 months out, especially if many guests are travelling.",
      },
    ],
    guest_list_template: [
      {
        q: "How many guests should we invite?",
        a: "Hungarian typical: 80–120 guests. Headcount drives venue, catering and ~55% of the total budget, pin the guest count before pinning the budget. The Weddly budget calculator shows the impact live.",
      },
      {
        q: "Who NOT to invite?",
        a: "No mandatory column. A simple rule: if you haven't seen them in 2+ years and don't actively want them on the big day, skip. Obligation invites are the most common source of stress.",
      },
      {
        q: "What columns should a wedding guest list spreadsheet have?",
        a: "Minimum: first name, last name, contact (email or phone), household, RSVP status. Useful extras: diet, plus-one, relationship (family / friends / work / uni). The Weddly template covers all of these.",
      },
    ],
    seating_chart: [
      {
        q: "How many guests per table?",
        a: "Round: 8–10 ideal, max 12. Rectangular (banquet): 6–8 per side, so 12–16 per table. Above 10 conversation breaks; Weddly warns if you over-pack a table.",
      },
      {
        q: "When should we make the seating chart?",
        a: "After the RSVP deadline (~4 weeks out). Draft modes are fine before then; finalize once headcount is locked. Weddly has draft + final modes so you don't lose the in-between work.",
      },
      {
        q: "How do we handle awkward guests?",
        a: "Safest move: separate tables, at least 2 tables apart. Add the conflict to your notes and Weddly will flag if you accidentally drag them next to each other.",
      },
    ],
    rsvp_generator: [
      {
        q: "What does RSVP mean?",
        a: "RSVP comes from the French “Répondez s'il vous plaît”, “please respond”. In a wedding context: please let us know whether you can attend. Classic: collect RSVPs 3–4 weeks before the wedding.",
      },
      {
        q: "When should we send the RSVP request?",
        a: "The RSVP request goes with the invitation, typically 8–12 weeks out. RSVP deadline: ~4 weeks before the wedding so you can lock final headcount with the venue and caterer.",
      },
      {
        q: "What should the RSVP wording include?",
        a: "Minimum: your names, the wedding date, venue, RSVP deadline, and one contact channel (email / phone / link). Helpful extras: a dietary question, a plus-one field, an allergy line. Weddly's RSVP page covers all of these via a single link.",
      },
    ],
    couple_cards: [
      {
        q: "What's the point of these 100 questions?",
        a: "Conversation starters. Long-term relationships research keeps pointing to the same thing: couples who can talk openly about money, family, desire and death tend to last. The four decks are organised around those topics, so the hard ones don't stay under the rug.",
      },
      {
        q: "Do we have to answer all 100?",
        a: "No. One card is one conversation. Pull one, talk it through, put the deck down. Your browser remembers where you are in each deck, so the next visit picks up from there.",
      },
      {
        q: "Why these four decks specifically?",
        a: "We took the synthesis of ten different perspectives (a couples therapist, a long-married couple, an intimacy coach, a financial planner, a philosopher) and the themes that surfaced in all of them: family inheritance, money and the everyday, body and desire, and the death–crisis–meaning cluster. That's how we landed on four.",
      },
    ],
    wedding_checklist: [
      {
        q: "How many tasks are on the checklist?",
        a: "About 100 items across 11 phases, from 12–18 months out to after the wedding. Outdoor, alcohol-serving or family-friendly weddings automatically get a few extra items.",
      },
      {
        q: "Are the deadlines based on my wedding date?",
        a: "Not on this page — there's no date to work from here. After signing up, Weddly maps every item's recommended deadline to your actual date and continues in your own Planning workspace.",
      },
      {
        q: "Can I save what I check off here?",
        a: "Yes. Browsing is always free; the moment you check an item off, we offer a free account that carries your checked items straight into your own checklist.",
      },
      {
        q: "Is the PDF download free?",
        a: "Yes, the full checklist downloads as a printable PDF with no signup needed.",
      },
    ],
  },
  // es/hr/de blocks below adapt the EN copy (the international-neutral
  // master, not the HU text, which carries Hungary-specific figures that
  // don't belong on a Spanish/Croatian/German page) into real, idiomatic
  // copy — same question count and order as EN so nothing reads as thinner
  // in translation.
  es: {
    budget_calculator: [
      {
        q: "¿Cuánto cuesta de media una boda?",
        a: "Una boda de 80-100 invitados sigue el mismo reparto proporcional en casi cualquier país: catering y lugar dominan el presupuesto, y el 20-25% restante cubre vestuario, música, ceremonia y papelería. La calculadora muestra el reparto para cualquier número de invitados y presupuesto, en vuestra propia moneda.",
      },
      {
        q: "¿Cuánto se gasta por invitado?",
        a: "El catering, las bebidas, la decoración y la parte proporcional del lugar suelen ser el mayor coste por invitado. La calculadora obtiene la cifra exacta por invitado a partir del presupuesto total que fijéis, o al revés, partiendo de lo que podéis gastar por invitado.",
      },
      {
        q: "¿Cómo se reparte el presupuesto de una boda por categorías?",
        a: "Reparto orientativo: ~35% catering y bebidas, ~18% lugar, ~13% foto y vídeo, ~9% decoración y flores, ~8% vestuario y belleza, ~7% música/DJ, ~5% ceremonia, ~2% papelería, ~3% imprevistos. La calculadora lo muestra en vivo sobre vuestras cifras.",
      },
      {
        q: "¿Se guardan las cifras después de registrarse?",
        a: "Sí. El botón «Continuar en Wēddly» lleva el número de invitados y el presupuesto total al borrador de vuestro espacio de trabajo; el proceso de bienvenida arranca ya con esas cifras. A partir de ahí se edita por categoría y podéis pausar el espacio de trabajo cuando queráis.",
      },
    ],
    countdown: [
      {
        q: "¿Con cuánta antelación hay que empezar a organizar la boda?",
        a: "Lo habitual es 12-18 meses antes. El lugar y el fotógrafo se reservan primero; para fechas populares, 18 meses ya puede ir justo.",
      },
      {
        q: "¿Con cuánta antelación se envían las invitaciones?",
        a: "Lo clásico: 8-12 semanas antes de la boda, con fecha límite de confirmación ~4 semanas antes. Para invitados que viajan, enviad el save-the-date 4-6 semanas antes de eso.",
      },
      {
        q: "¿Qué es un save-the-date y cuándo se envía?",
        a: "Un save-the-date es un aviso breve con la fecha y la zona del lugar para que los invitados reserven hueco en su agenda. Momento ideal: 6-9 meses antes, sobre todo si muchos invitados van a viajar.",
      },
    ],
    guest_list_template: [
      {
        q: "¿Cuántos invitados deberíamos tener?",
        a: "Cifra habitual: 80-120 invitados. El número marca el lugar, el catering y en torno al 55% del presupuesto total, conviene fijar el número de invitados antes que el presupuesto. La calculadora de presupuesto de Wēddly muestra el efecto en vivo.",
      },
      {
        q: "¿A quién NO invitar?",
        a: "No hay una columna obligatoria. Una regla sencilla: si no os habéis visto en más de 2 años y no os importa de verdad que estén ese día, no los invitéis. Los invitados «por compromiso» son la fuente de tensión más habitual.",
      },
      {
        q: "¿Qué columnas debería tener la hoja de la lista de invitados?",
        a: "Mínimo: nombre, apellidos, contacto (email o teléfono), hogar, estado de RSVP. Extras útiles: dieta, acompañante, tipo de relación (familia / amigos / trabajo / universidad). La plantilla de Wēddly incluye todo esto.",
      },
    ],
    seating_chart: [
      {
        q: "¿Cuántos invitados por mesa?",
        a: "Mesa redonda: 8-10 ideal, máximo 12. Rectangular (banquete): 6-8 por lado, es decir 12-16 por mesa. Por encima de 10 la conversación se fragmenta; Wēddly avisa si sobrecargáis una mesa.",
      },
      {
        q: "¿Cuándo hacer el plano de mesas?",
        a: "Después de la fecha límite de RSVP (~4 semanas antes). Antes de eso el modo borrador es suficiente; finalizad cuando el número de invitados esté cerrado. Wēddly tiene modo borrador y final para no perder el trabajo intermedio.",
      },
      {
        q: "¿Cómo gestionar a invitados que no se llevan bien?",
        a: "Lo más seguro: mesas separadas, al menos 2 mesas de distancia. Añadid el conflicto como nota y Wēddly avisará si por error los arrastráis a mesas contiguas.",
      },
    ],
    rsvp_generator: [
      {
        q: "¿Qué significa RSVP?",
        a: "RSVP viene del francés «Répondez s'il vous plaît», «responded, por favor». En una boda significa: por favor, decidnos si podéis venir. Lo clásico es recoger las confirmaciones 3-4 semanas antes de la boda.",
      },
      {
        q: "¿Cuándo enviar la solicitud de confirmación?",
        a: "La solicitud de RSVP va con la invitación, normalmente 8-12 semanas antes. Fecha límite: ~4 semanas antes de la boda, para poder dar el número definitivo al lugar y al catering a tiempo.",
      },
      {
        q: "¿Qué debe incluir el texto de RSVP?",
        a: "Mínimo: vuestros nombres, la fecha de la boda, el lugar, la fecha límite y un contacto (email, teléfono o un enlace). Extras útiles: pregunta sobre dieta, campo de acompañante, alergias. La página de RSVP de Wēddly recoge todo esto a través de un único enlace.",
      },
    ],
    couple_cards: [
      {
        q: "¿Para qué sirven estas 100 preguntas?",
        a: "Para empezar conversaciones. La investigación sobre relaciones duraderas señala siempre lo mismo: las parejas que hablan con franqueza de dinero, familia, deseo y muerte suelen durar. Los cuatro mazos están organizados alrededor de esos temas, para que lo difícil no se quede sin hablar.",
      },
      {
        q: "¿Hay que responder a las 100?",
        a: "No. Cada carta es una conversación. Sacad una, habladla, y dejad el mazo. Vuestro navegador recuerda por dónde vais en cada mazo, así que la próxima visita continúa desde ahí.",
      },
      {
        q: "¿Por qué precisamente estos cuatro mazos?",
        a: "Partimos de la síntesis de diez perspectivas distintas (una terapeuta de pareja, una pareja con muchos años juntos, una coach de intimidad, un planificador financiero, un filósofo) y de los temas que aparecían en todas ellas: la herencia familiar, el dinero y el día a día, el cuerpo y el deseo, y el grupo muerte-crisis-sentido. De ahí salieron los cuatro mazos.",
      },
    ],
    wedding_checklist: [
      {
        q: "¿Cuántas tareas tiene la lista?",
        a: "Unos 100 elementos repartidos en 11 fases, desde 12-18 meses antes hasta después de la boda. Las bodas al aire libre, con alcohol o con niños suman automáticamente algunas tareas extra.",
      },
      {
        q: "¿Las fechas límite se ajustan a nuestra boda?",
        a: "En esta página no, porque aquí no hay una fecha de boda indicada. Tras registraros, Wēddly ajusta la fecha límite recomendada de cada tarea a vuestra fecha real y continúa en vuestro propio espacio de Planificación.",
      },
      {
        q: "¿Puedo guardar lo que marco aquí?",
        a: "Sí. Mientras solo consultéis la lista no hay ninguna restricción; en cuanto marquéis una tarea, os ofrecemos crear una cuenta gratuita que lleva lo marcado directamente a vuestra propia checklist.",
      },
      {
        q: "¿La descarga en PDF es gratis?",
        a: "Sí, la lista completa se descarga en PDF listo para imprimir, sin necesidad de registro.",
      },
    ],
  },
  hr: {
    budget_calculator: [
      {
        q: "Koliko prosječno košta vjenčanje?",
        a: "Vjenčanje s 80-100 gostiju u gotovo svakoj zemlji slijedi isti omjer: catering i prostor dominiraju proračunom, a preostalih 20-25% pokriva odjeću, glazbu, ceremoniju i tiskovine. Kalkulator prikazuje raspodjelu za bilo koji broj gostiju i ukupni iznos, u vašoj valuti.",
      },
      {
        q: "Koliko potrošiti po gostu?",
        a: "Catering, piće, dekor i udio prostora po gostu obično zajedno čine najveći trošak po gostu. Kalkulator izračunava točan iznos po gostu za zadani ukupni proračun, ili obrnuto, polazeći od iznosa po gostu koji si možete priuštiti.",
      },
      {
        q: "Kako se proračun za vjenčanje dijeli po kategorijama?",
        a: "Uobičajena raspodjela: ~35% catering i piće, ~18% prostor, ~13% foto/video, ~9% dekor i cvijeće, ~8% odjeća i uljepšavanje, ~7% glazba/DJ, ~5% ceremonija, ~2% tiskovine, ~3% rezerva. Kalkulator to prikazuje uživo na temelju vaših brojki.",
      },
      {
        q: "Čuvaju li se brojke nakon registracije?",
        a: "Da. Gumb „Nastavi u Wēddlyju” prenosi broj gostiju i ukupni proračun u skicu vašeg radnog prostora; uvodni proces kreće s tim brojkama već popunjenima. Odatle se sve uređuje po kategorijama, a radni prostor možete pauzirati kad god želite.",
      },
    ],
    countdown: [
      {
        q: "Koliko unaprijed treba početi planirati vjenčanje?",
        a: "Uobičajeno: 12-18 mjeseci unaprijed. Prostor i fotograf se rezerviraju prvi; za popularne datume 18 mjeseci već zna biti tijesno.",
      },
      {
        q: "Koliko prije vjenčanja treba poslati pozivnice?",
        a: "Klasično: 8-12 tjedana prije vjenčanja, s rokom za RSVP ~4 tjedna prije. Gostima koji putuju pošaljite najavu datuma (save-the-date) 4-6 tjedana ranije.",
      },
      {
        q: "Što je save-the-date i kada se šalje?",
        a: "Save-the-date je kratka najava datuma i regije vjenčanja kako bi gosti mogli rezervirati taj dan u kalendaru. Idealno vrijeme: 6-9 mjeseci unaprijed, pogotovo ako mnogo gostiju putuje.",
      },
    ],
    guest_list_template: [
      {
        q: "Koliko gostiju pozvati na vjenčanje?",
        a: "Uobičajeno: 80-120 gostiju. Broj gostiju određuje prostor, catering i oko 55% ukupnog proračuna, stoga prvo odredite broj gostiju, a tek onda proračun. Wēddlyjev kalkulator proračuna uživo prikazuje taj utjecaj.",
      },
      {
        q: "Koga NE pozvati?",
        a: "Nema obveznog stupca. Jednostavno pravilo: ako se niste vidjeli više od 2 godine i stvarno vam nije stalo da budu tu taj dan, preskočite ih. Gosti pozvani „iz obaveze” najčešći su izvor napetosti.",
      },
      {
        q: "Koje stupce treba imati tablica s popisom gostiju?",
        a: "Minimum: ime, prezime, kontakt (e-mail ili telefon), kućanstvo, status RSVP-a. Korisni dodaci: prehrana, pratnja, vrsta veze (obitelj / prijatelji / posao / fakultet). Wēddlyjev predložak sadrži sve ovo.",
      },
    ],
    seating_chart: [
      {
        q: "Koliko gostiju po stolu?",
        a: "Okrugli stol: idealno 8-10, najviše 12. Pravokutni (banket): 6-8 po strani, dakle 12-16 po stolu. Iznad 10 razgovor se raspada; Wēddly upozorava ako pretrpate stol.",
      },
      {
        q: "Kada napraviti raspored sjedenja?",
        a: "Nakon roka za RSVP (~4 tjedna prije). Do tada je dovoljan skica-način; finalizirajte kad je konačan broj gostiju poznat. Wēddly ima način skice i konačni način, tako da se međukorak ne gubi.",
      },
      {
        q: "Kako riješiti goste koji se ne slažu?",
        a: "Najsigurnije: odvojeni stolovi, razmak od najmanje 2 stola. Dodajte sukob kao bilješku, a Wēddly će upozoriti ako ih greškom povučete jedno do drugog.",
      },
    ],
    rsvp_generator: [
      {
        q: "Što znači RSVP?",
        a: "RSVP dolazi od francuskog „Répondez s'il vous plaît”, „molimo odgovorite”. Na vjenčanju znači: javite nam hoćete li moći doći. Klasično se RSVP odgovori prikupljaju 3-4 tjedna prije vjenčanja.",
      },
      {
        q: "Kada poslati zahtjev za RSVP?",
        a: "Zahtjev za RSVP ide uz pozivnicu, obično 8-12 tjedana prije. Rok za RSVP: ~4 tjedna prije vjenčanja, kako biste na vrijeme mogli javiti konačan broj gostiju prostoru i cateringu.",
      },
      {
        q: "Što bi trebao sadržavati RSVP tekst?",
        a: "Minimum: vaša imena, datum vjenčanja, mjesto, rok za RSVP i jedan kontakt (e-mail, telefon ili poveznica). Korisni dodaci: pitanje o prehrani, polje za pratnju, alergije. Wēddlyjeva RSVP stranica sve to rješava putem jedne poveznice.",
      },
    ],
    couple_cards: [
      {
        q: "Čemu služi ovih 100 pitanja?",
        a: "Pokretanju razgovora. Istraživanja o dugotrajnim vezama stalno pokazuju isto: parovi koji otvoreno razgovaraju o novcu, obitelji, želji i smrti obično ostaju zajedno dulje. Četiri špila su organizirana oko tih tema, kako teške stvari ne bi ostale nerečene.",
      },
      {
        q: "Moramo li odgovoriti na svih 100?",
        a: "Ne. Jedna kartica je jedan razgovor. Izvucite jednu, porazgovarajte o njoj, i odložite špil. Preglednik pamti dokle ste stigli u svakom špilu, pa sljedeći posjet nastavljate odande.",
      },
      {
        q: "Zašto baš ova četiri špila?",
        a: "Krenuli smo od sinteze deset različitih perspektiva (terapeutkinje za parove, dugogodišnjeg bračnog para, coachice za intimnost, financijskog planera, filozofa) i tema koje su se pojavljivale u svima njima: obiteljsko naslijeđe, novac i svakodnevica, tijelo i želja, te cjelina smrt-kriza-smisao. Tako smo došli do četiri špila.",
      },
    ],
    wedding_checklist: [
      {
        q: "Koliko zadataka ima na popisu?",
        a: "Oko 100 stavki raspoređenih u 11 faza, od 12-18 mjeseci unaprijed do razdoblja nakon vjenčanja. Vjenčanja na otvorenom, s alkoholom ili s djecom automatski dobivaju nekoliko dodatnih stavki.",
      },
      {
        q: "Prilagođavaju li se rokovi našem datumu vjenčanja?",
        a: "Ne na ovoj stranici, jer ovdje nije unesen datum vjenčanja. Nakon registracije Wēddly prilagođava preporučeni rok svake stavke vašem stvarnom datumu i nastavlja u vašem vlastitom prostoru za planiranje.",
      },
      {
        q: "Mogu li spremiti što sam ovdje označio/la?",
        a: "Da. Dok samo pregledavate, ništa vas ne ograničava; čim označite prvu stavku, ponudit ćemo vam besplatan račun koji označene stavke izravno prenosi u vaš vlastiti popis.",
      },
      {
        q: "Je li preuzimanje PDF-a besplatno?",
        a: "Da, cijeli popis preuzima se kao PDF spreman za ispis, bez potrebe za registracijom.",
      },
    ],
  },
  de: {
    budget_calculator: [
      {
        q: "Was kostet eine Hochzeit im Durchschnitt?",
        a: "Eine Hochzeit mit 80-100 Gästen folgt fast überall derselben anteiligen Aufteilung: Catering und Location dominieren das Budget, die restlichen 20-25% entfallen auf Kleidung, Musik, Zeremonie und Papeterie. Der Rechner zeigt die Aufteilung für jede Gästezahl und jedes Budget, in eurer eigenen Währung.",
      },
      {
        q: "Wie viel pro Gast?",
        a: "Catering, Getränke, Dekoration und der Gästeanteil an der Location machen meist zusammen den größten Kostenblock pro Gast aus. Der Rechner ermittelt den genauen Betrag pro Gast für das von euch gesetzte Gesamtbudget, oder umgekehrt, ausgehend davon, was ihr euch pro Gast leisten könnt.",
      },
      {
        q: "Wie teilt sich ein Hochzeitsbudget nach Kategorien auf?",
        a: "Typische Aufteilung: ~35% Catering und Getränke, ~18% Location, ~13% Foto/Video, ~9% Deko und Blumen, ~8% Kleidung und Beauty, ~7% Musik/DJ, ~5% Zeremonie, ~2% Papeterie, ~3% Puffer. Der Rechner visualisiert das live anhand eurer Zahlen.",
      },
      {
        q: "Werden die Zahlen nach der Anmeldung gespeichert?",
        a: "Ja. Der Button „Weiter in Wēddly” übernimmt Gästezahl und Gesamtbudget in den Entwurf eures Arbeitsbereichs; das Onboarding startet bereits mit diesen Zahlen. Von dort lässt sich alles pro Kategorie bearbeiten, und ihr könnt den Arbeitsbereich jederzeit pausieren.",
      },
    ],
    countdown: [
      {
        q: "Wie früh sollte man mit der Hochzeitsplanung anfangen?",
        a: "Üblich: 12-18 Monate vorher. Location und Fotograf werden am frühesten gebucht, bei beliebten Terminen sind 18 Monate schon knapp.",
      },
      {
        q: "Wie lange vor der Hochzeit sollten die Einladungen raus?",
        a: "Klassisch: 8-12 Wochen vor der Hochzeit, mit einer RSVP-Frist ~4 Wochen vorher. Für anreisende Gäste schickt Save-the-Dates 4-6 Wochen früher.",
      },
      {
        q: "Was ist ein Save-the-Date und wann verschickt man es?",
        a: "Ein Save-the-Date ist ein kurzer Hinweis auf Datum und Region der Hochzeit, damit Gäste sich den Termin freihalten können. Idealer Zeitpunkt: 6-9 Monate vorher, besonders wenn viele Gäste anreisen müssen.",
      },
    ],
    guest_list_template: [
      {
        q: "Wie viele Gäste sollten wir einladen?",
        a: "Üblich: 80-120 Gäste. Die Gästezahl bestimmt Location, Catering und rund 55% des Gesamtbudgets, legt daher die Gästezahl fest, bevor ihr das Budget festlegt. Der Wēddly-Budgetrechner zeigt die Auswirkung live.",
      },
      {
        q: "Wen sollte man NICHT einladen?",
        a: "Es gibt keine Pflichtspalte. Eine einfache Regel: Wenn ihr euch seit über 2 Jahren nicht gesehen habt und es euch nicht wirklich wichtig ist, dass die Person dabei ist, lasst sie weg. Pflichtgäste sind die häufigste Quelle für Spannungen.",
      },
      {
        q: "Welche Spalten sollte eine Hochzeitsgästeliste haben?",
        a: "Minimum: Vorname, Nachname, Kontakt (E-Mail oder Telefon), Haushalt, RSVP-Status. Nützliche Extras: Ernährung, Begleitung, Beziehung (Familie / Freunde / Arbeit / Studium). Die Wēddly-Vorlage deckt all das ab.",
      },
    ],
    seating_chart: [
      {
        q: "Wie viele Gäste pro Tisch?",
        a: "Rund: ideal 8-10, maximal 12. Rechteckig (Bankett): 6-8 pro Seite, also 12-16 pro Tisch. Über 10 Personen zerfällt das Gespräch; Wēddly warnt, wenn ihr einen Tisch überladet.",
      },
      {
        q: "Wann sollte man den Sitzplan erstellen?",
        a: "Nach der RSVP-Frist (~4 Wochen vorher). Davor reicht der Entwurfsmodus; finalisiert, sobald die Gästezahl feststeht. Wēddly hat einen Entwurfs- und einen finalen Modus, damit die Zwischenarbeit nicht verloren geht.",
      },
      {
        q: "Wie geht man mit Gästen um, die sich nicht vertragen?",
        a: "Am sichersten: getrennte Tische, mindestens 2 Tische Abstand. Tragt den Konflikt als Notiz ein, Wēddly warnt euch, wenn ihr sie versehentlich nebeneinander zieht.",
      },
    ],
    rsvp_generator: [
      {
        q: "Was bedeutet RSVP?",
        a: "RSVP kommt vom französischen „Répondez s'il vous plaît”, „bitte antworten Sie”. Bei einer Hochzeit heißt das: bitte sagt uns, ob ihr kommen könnt. Klassisch werden RSVPs 3-4 Wochen vor der Hochzeit eingesammelt.",
      },
      {
        q: "Wann sollte man die RSVP-Bitte verschicken?",
        a: "Die RSVP-Bitte geht mit der Einladung raus, typischerweise 8-12 Wochen vorher. RSVP-Frist: ~4 Wochen vor der Hochzeit, damit ihr die endgültige Gästezahl rechtzeitig an Location und Catering weitergeben könnt.",
      },
      {
        q: "Was sollte im RSVP-Text stehen?",
        a: "Minimum: eure Namen, das Hochzeitsdatum, die Location, die RSVP-Frist und ein Kontaktweg (E-Mail, Telefon oder ein Link). Nützliche Extras: eine Frage zur Ernährung, ein Begleitungs-Feld, Allergien. Die Wēddly-RSVP-Seite deckt all das über einen einzigen Link ab.",
      },
    ],
    couple_cards: [
      {
        q: "Wofür sind diese 100 Fragen gut?",
        a: "Als Gesprächseinstieg. Die Forschung zu langfristigen Beziehungen zeigt immer wieder dasselbe: Paare, die offen über Geld, Familie, Verlangen und Tod sprechen können, halten meist länger zusammen. Die vier Decks sind um genau diese Themen herum aufgebaut, damit das Schwierige nicht unter den Tisch fällt.",
      },
      {
        q: "Müssen wir alle 100 beantworten?",
        a: "Nein. Eine Karte ist ein Gespräch. Zieht eine, sprecht darüber, und legt das Deck weg. Euer Browser merkt sich, wo ihr in jedem Deck steht, sodass ihr beim nächsten Besuch dort weitermacht.",
      },
      {
        q: "Warum genau diese vier Decks?",
        a: "Wir haben die Synthese aus zehn verschiedenen Perspektiven gezogen (eine Paartherapeutin, ein langjähriges Ehepaar, eine Intimitäts-Coachin, ein Finanzplaner, ein Philosoph) und die Themen herausgefiltert, die bei allen wiederkehrten: familiäres Erbe, Geld und Alltag, Körper und Verlangen, sowie der Dreiklang Tod-Krise-Sinn. So kamen wir auf vier Decks.",
      },
    ],
    wedding_checklist: [
      {
        q: "Wie viele Aufgaben stehen auf der Liste?",
        a: "Rund 100 Punkte verteilt auf 11 Phasen, von 12-18 Monaten vorher bis nach der Hochzeit. Hochzeiten im Freien, mit Alkohol oder mit Kindern bekommen automatisch ein paar zusätzliche Punkte.",
      },
      {
        q: "Richten sich die Fristen nach unserem Hochzeitsdatum?",
        a: "Auf dieser Seite nicht, weil hier kein Hochzeitsdatum hinterlegt ist. Nach der Anmeldung passt Wēddly die empfohlene Frist jedes Punkts an euer tatsächliches Datum an und geht in eurem eigenen Planungsbereich weiter.",
      },
      {
        q: "Kann ich speichern, was ich hier abgehakt habe?",
        a: "Ja. Solange ihr nur stöbert, hindert euch nichts; sobald ihr den ersten Punkt abhakt, bieten wir ein kostenloses Konto an, das die abgehakten Punkte direkt in eure eigene Checkliste übernimmt.",
      },
      {
        q: "Ist der PDF-Download kostenlos?",
        a: "Ja, die komplette Checkliste lässt sich ohne Anmeldung als druckfertiges PDF herunterladen.",
      },
    ],
  },
};

/** Resolve a request path — the new `/{lang}/tools/{slug}` shape, or either
 *  locale's legacy spelling (with or without a trailing slash) — to its tool
 *  slug, or null when the path isn't a tool page. */
export function toolFaqSlugForPath(pathname: string): ToolFaqSlug | null {
  const langMatch = matchToolLangPath(pathname);
  if (langMatch) return langMatch.key;
  const clean = pathname.replace(/\/+$/, "") || "/";
  for (const slug of Object.keys(TOOL_FAQ_PATHS) as ToolFaqSlug[]) {
    const pair = TOOL_FAQ_PATHS[slug];
    if (pair.hu === clean || pair.en === clean) return slug;
  }
  return null;
}

/** The FAQ entries for a request path in the given UI locale, or null. */
export function toolFaqForPath(
  pathname: string,
  locale: UiLocale,
): ReadonlyArray<SeoFaqEntry> | null {
  const slug = toolFaqSlugForPath(pathname);
  return slug ? TOOL_FAQ[locale][slug] : null;
}
