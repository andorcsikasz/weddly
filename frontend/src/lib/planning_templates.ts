// Template content for the /app/planning wand + dice helpers. Strings live
// outside the locale tree because (a) they're content data, not UI labels,
// and (b) adding 50+ keys to keys.ts triples the i18n maintenance per item.
// Pattern mirrors `domain/suppliers_data.ts` on the backend: HU + EN inline.

import type { Locale } from "./i18n";

export type LocaleText = { hu: string; en: string };

export function localizeText(text: LocaleText, locale: Locale): string {
  return text[locale];
}

/** Wedding-task starter set — covers the universally-applicable bookings +
 *  decisions every Hungarian couple makes. Couples add specifics on top. */
export const TASK_TEMPLATE: { title: LocaleText }[] = [
  { title: { hu: "Helyszínt foglalni", en: "Book the venue" } },
  { title: { hu: "Anyakönyvvezetőt egyeztetni", en: "Confirm registrar" } },
  { title: { hu: "Meghívókat megrendelni", en: "Order invitations" } },
  { title: { hu: "Fotóst lefoglalni", en: "Book photographer" } },
  { title: { hu: "Zenekart vagy DJ-t lefoglalni", en: "Book band or DJ" } },
  { title: { hu: "Virágost egyeztetni", en: "Confirm florist" } },
  { title: { hu: "Tortát megrendelni", en: "Order wedding cake" } },
  { title: { hu: "Menyasszonyi ruhát kiválasztani", en: "Choose wedding dress" } },
  { title: { hu: "Vőlegény öltönyt kiválasztani", en: "Choose groom's suit" } },
  { title: { hu: "Karikagyűrűket beszerezni", en: "Buy wedding rings" } },
  { title: { hu: "Tanúkat felkérni", en: "Ask the witnesses" } },
  { title: { hu: "Esküvői próbát egyeztetni", en: "Schedule wedding rehearsal" } },
];

/** Light starter set of "what to consider adding" ideas — the obvious-but-
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
  { title: { hu: "Csillagszórós exit éjfél után", en: "Sparkler send-off after midnight" } },
  { title: { hu: "Élő zene a fogadóórán", en: "Live music at the cocktail hour" } },
  { title: { hu: "Drónvideó a násznéprol", en: "Drone shot from above" } },
  {
    title: {
      hu: "Magyar népi tánc segment a buliban",
      en: "Folk-music dance segment in the party",
    },
  },
  { title: { hu: "Második esküvői ruha az estére", en: "Second outfit for the evening party" } },
  { title: { hu: "Vendégeknek apró asztali ajándék", en: "Small table favours for the guests" } },
];

/** Creative-bold idea pool for the 🎲 randomizer. Mix of intimate, surprising,
 *  Hungarian-traditional-with-a-twist, sensory, and just plain delightful. The
 *  dialog picks 3 at random from this pool; the user accepts the ones that
 *  resonate. Keep the titles short (chips); body gives the why/how. */
export const DICE_CREATIVE_IDEAS: { title: LocaleText; body: LocaleText }[] = [
  {
    title: { hu: "Saját esküt írni és felolvasni", en: "Write and read your own vows" },
    body: {
      hu: "A standard polgári szöveg után pár saját mondat — a vendégek mindenki sírni fog.",
      en: "A few personal lines on top of the standard registrar text — guaranteed tears.",
    },
  },
  {
    title: { hu: "Időkapszula vendégek leveleivel", en: "Time capsule of guest letters" },
    body: {
      hu: "Minden vendég ír egy levelet, közösen elzárjátok, és a 10. évfordulón felbontjátok.",
      en: "Every guest writes a letter, you seal it together, and open it on your 10th anniversary.",
    },
  },
  {
    title: { hu: "Élő festő dokumentál benneteket", en: "Live painter captures the wedding" },
    body: {
      hu: "Valós időben fest egy festményt a fogadóóra alatt — egyedi „fotó” a falra.",
      en: "Paints the scene in real time during cocktail hour — a one-of-a-kind keepsake.",
    },
  },
  {
    title: { hu: "Kérjetek fel egy barátot meglepetés-beszédre", en: "Secret friend speech" },
    body: {
      hu: "A párod nem tud róla — felkéred a legjobb barátját, hogy mondjon róla egy beszédet.",
      en: "Your partner doesn't know — recruit their best friend to give a surprise toast.",
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
    title: { hu: "Karikatúra-rajzoló a fogadóórán", en: "Caricature artist at cocktails" },
    body: {
      hu: "Mindenki visz haza egy mosolyos rajzot magáról — ajándék vendégkönyv helyett.",
      en: "Every guest takes home a smiling sketch — better than a polite guestbook signature.",
    },
  },
  {
    title: {
      hu: "Selyemszalagok rizs helyett az exitnél",
      en: "Silk ribbon wands for the send-off",
    },
    body: {
      hu: "A vendégek lobogó szalagokkal kísérnek ki — fotózás közben sokkal szebb a rizsnél.",
      en: "Guests wave streaming ribbons as you leave — way more photogenic than rice.",
    },
  },
  {
    title: { hu: "Élő népdalének a szertartáson", en: "Live folk song at the ceremony" },
    body: {
      hu: "Egy közeli barát vagy népdalénekes a polgári után — meghittebb, mint a CD.",
      en: "A friend or folk singer right after the registrar — beats canned music every time.",
    },
  },
  {
    title: { hu: "Csak ti ketten, 10 perc a vacsora előtt", en: "Ten minutes alone before dinner" },
    body: {
      hu: "Tudatosan kiszöktök egy szobába, leültök egy tányér ételhez — csak ti ketten.",
      en: "Steal a private room with a plate of food before the toasts — just the two of you.",
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
      hu: "Pajzsra vetített gyerekkori fotók",
      en: "Childhood photos projected during dinner",
    },
    body: {
      hu: "Néma slideshow a falon — a vendégek nézhetik miközben esznek, beszélgetnek.",
      en: "Silent slideshow on a wall — guests watch as they eat and chat.",
    },
  },
  {
    title: { hu: "Vendégek által ajánlott DJ-szám", en: "Guest-curated DJ requests" },
    body: {
      hu: "RSVP-vel együtt mindenki beír egy számot — a DJ a saját listája mellett ezeket is játssza.",
      en: "Guests submit one song with their RSVP; the DJ weaves them through the night.",
    },
  },
  {
    title: { hu: "Egy fát ültettek a vendégekkel", en: "Plant a tree with your guests" },
    body: {
      hu: "Mindenki hoz egy maréknyi földet a saját kertjéből — közös szimbolikus mozdulat.",
      en: "Each guest brings a handful of soil from their own garden — symbolic and grounding.",
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
      hu: "Mindenkit lefotóztok a recepción + ráírja a kezét — keverednek a felek családjai.",
      en: "Snap each guest at check-in + they write their name — breaks the two-family ice.",
    },
  },
  {
    title: { hu: "Élő hegedűszó a kiállás közben", en: "Live violin during the recessional" },
    body: {
      hu: "Egy hegedűs kísér ki titeket a szertartásról — filmes pillanat lesz.",
      en: "A solo violinist walks you out of the ceremony — instant cinematic moment.",
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
      hu: "Cetlik a falon: 1 év, 5 év, 10 év — a vendégek odaírják, mit kívánnak akkorra.",
      en: "Sticky notes on a wall: year 1, year 5, year 10 — each guest writes a wish for that date.",
    },
  },
  {
    title: {
      hu: "Egyedi monogram poharakon, szalvétán",
      en: "Custom monogram on glassware, napkins",
    },
    body: {
      hu: "Egy közös motívum végigvonul mindenen — komolyabbnak hat, fele annyiba kerül, mint hisztek.",
      en: "One motif on everything ties the day together — looks pricier than it actually is.",
    },
  },
  {
    title: { hu: "Vendégek földajándékai egy bonsaihoz", en: "Bonsai built from guest gifts" },
    body: {
      hu: "Egy közeli barát visszaadja a bonsait évek múlva — élő emlék, nem fal-dekoráció.",
      en: "A close friend grows the bonsai for years and gifts it back — a living, breathing memory.",
    },
  },
  {
    title: { hu: "Karaoke duett a szülőkkel", en: "Karaoke duet with the parents" },
    body: {
      hu: "Az anyukáddal egy szám, az apósoddal egy másik — fél órán át mindenki sír és nevet.",
      en: "One song with your mum, another with your father-in-law — half an hour of joyful tears.",
    },
  },
  {
    title: { hu: "Vacsoraasztal saját családi recepttel", en: "Family-recipe dish at the dinner" },
    body: {
      hu: "Egy fogás a párod nagymamájának receptje alapján — a séf nevével rátok hangolva.",
      en: "One course made from your partner's grandmother's recipe — printed on the menu in her name.",
    },
  },
  {
    title: { hu: "Saját pálinka a vacsora utáni koccintáshoz", en: "Custom pálinka for the toast" },
    body: {
      hu: "Címkével együtt — a vendégek hazaviszik mint nászajándékot.",
      en: "Label included — guests take it home as a wedding favour.",
    },
  },
  {
    title: {
      hu: "Élő rajzoló a vendégkönyvet készíti",
      en: "Live illustrator draws the guest book",
    },
    body: {
      hu: "Egy művész egy hatalmas papírlapra felrajzol mindenkit — keret + fal otthon.",
      en: "An artist sketches every guest onto one big sheet — frame it for your wall later.",
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
      hu: "Reggel egy gyors videó tőletek — a fáradt, boldog ti — minden vendégnek elküldve.",
      en: "A quick morning-after video — tired but glowing — sent out to every guest.",
    },
  },
  {
    title: {
      hu: "Pillangó vagy galamb röptetése a szertartás végén",
      en: "Butterfly or dove release",
    },
    body: {
      hu: "Kétperces kép — minden fotós imádja, és minden vendég emlékezni fog rá.",
      en: "Two minutes of pure spectacle — photographers adore it, guests never forget it.",
    },
  },
];

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
