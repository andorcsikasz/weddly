// RSVP wording for the public /{lang}/tools/rsvp-text-generator page.
//
// The OUTPUT language is its own choice, independent of the UI locale: a
// Hungarian couple with a German side of the family wants the German text
// while reading the tool in Hungarian. So the copy lives here as a phrase
// table per language rather than in the i18n tree.
//
// Hungarian wording avoids gluing a case suffix onto a formatted date
// ("2026. június 12.-án"), which no formatter gets right; it uses a label and
// a colon instead ("Határidő: 2026. május 1.").

import type { UiLocale } from "@shared/locales";
import { intlLocale } from "./format";

export type RsvpTone = "formal" | "casual" | "poetic";
export type RsvpFormat = "invitation" | "message" | "reminder";

export const RSVP_TONES: readonly RsvpTone[] = ["formal", "casual", "poetic"];
export const RSVP_FORMATS: readonly RsvpFormat[] = ["invitation", "message", "reminder"];

export interface RsvpInput {
  partnerA: string;
  partnerB: string;
  /** yyyy-mm-dd from `<input type="date">`, or "". */
  date: string;
  /** hh:mm from `<input type="time">`, or "". */
  time: string;
  venue: string;
  deadline: string;
  /** Where guests answer: a phone number, an email, a link. Optional. */
  contact: string;
  plusOne: boolean;
  dietary: boolean;
  adultsOnly: boolean;
}

const BLANK = "______";

interface Ctx {
  a: string;
  b: string;
  /** Names joined with the language's own "and", for formal lines. */
  couple: string;
  /** Names joined for a sign-off. */
  pair: string;
  when: string;
  venue: string;
  d: string;
}

type Line = (c: Ctx) => string;

interface Phrases {
  and: string;
  amp: string;
  whenLabel: string;
  whereLabel: string;
  contactLabel: string;
  opening: Record<RsvpTone, Line>;
  reply: Record<RsvpTone, Line>;
  sign: Record<RsvpTone, Line>;
  message: Record<RsvpTone, Line>;
  reminder: Record<RsvpTone, Line>;
  plusOne: string;
  dietary: string;
  adultsOnly: string;
}

const PHRASES: Record<UiLocale, Phrases> = {
  hu: {
    and: "és",
    amp: "&",
    whenLabel: "Időpont",
    whereLabel: "Helyszín",
    contactLabel: "Visszajelzés",
    opening: {
      formal: (c) => `${c.couple}\n\nszeretettel meghívnak esküvőjükre.`,
      casual: () => "Sziasztok!\n\nÖsszeházasodunk, és nagyon szeretnénk, ha ott lennétek velünk.",
      poetic: (c) =>
        `Két élet, egy nap, egy kezdet.\n\n${c.couple} összekötik az életüket, és ez a nap veletek lesz teljes.`,
    },
    reply: {
      formal: (c) => `Kérjük, jelezzétek, hogy számíthatunk-e rátok. Határidő: ${c.d}.`,
      casual: (c) => `Írjatok vissza, hogy jöttök-e! Határidő: ${c.d}.`,
      poetic: (c) => `Mondjátok el, ott lesztek-e mellettünk. Határidő: ${c.d}.`,
    },
    sign: {
      formal: (c) => `Szeretettel várunk benneteket:\n${c.couple}`,
      casual: (c) => `Ölelünk,\n${c.pair}`,
      poetic: (c) => `Szeretettel,\n${c.pair}`,
    },
    message: {
      formal: (c) =>
        `${c.couple} szeretettel meghívnak esküvőjükre. Időpont: ${c.when}. Helyszín: ${c.venue}. Kérjük, jelezzetek vissza eddig: ${c.d}.`,
      casual: (c) =>
        `Összeházasodunk! ${c.when}, ${c.venue}. Jöttök? Írjatok eddig: ${c.d}. ${c.pair}`,
      poetic: (c) =>
        `${c.couple} összekötik az életüket: ${c.when}, ${c.venue}. Legyetek ott velünk! Visszajelzés eddig: ${c.d}.`,
    },
    reminder: {
      formal: (c) =>
        `Kedves Vendégünk! Szeretnénk emlékeztetni, hogy esküvőnkre (${c.when}) a visszajelzési határidő: ${c.d}. Kérjük, jelezzétek, számíthatunk-e rátok. ${c.couple}`,
      casual: (c) =>
        `Sziasztok! Még nem tudjuk, jöttök-e az esküvőnkre (${c.when}). Határidő: ${c.d}. Írjatok pár szót! ${c.pair}`,
      poetic: (c) =>
        `Készül a nagy nap, és nagyon hiányoznátok róla. Kérjük, jelezzétek, ott lesztek-e. Határidő: ${c.d}. ${c.pair}`,
    },
    plusOne: "Partnereteket is szeretettel várjuk.",
    dietary: "Ha van ételallergiátok vagy étrendi kérésetek, kérjük, jelezzétek.",
    adultsOnly: "Az ünnepséget felnőttek körében tartjuk.",
  },
  en: {
    and: "and",
    amp: "&",
    whenLabel: "When",
    whereLabel: "Where",
    contactLabel: "Reply to",
    opening: {
      formal: (c) => `${c.couple}\n\nrequest the pleasure of your company at their wedding.`,
      casual: () => "Hi!\n\nWe're getting married, and we'd love for you to be there.",
      poetic: (c) =>
        `Two lives, one day, one beginning.\n\n${c.couple} are getting married, and the day would not be whole without you.`,
    },
    reply: {
      formal: (c) => `Kindly reply by ${c.d}.`,
      casual: (c) => `Let us know by ${c.d} if you can make it.`,
      poetic: (c) => `Tell us by ${c.d} whether you'll be beside us.`,
    },
    sign: {
      formal: (c) => `We look forward to celebrating with you,\n${c.couple}`,
      casual: (c) => `Hugs,\n${c.pair}`,
      poetic: (c) => `With love,\n${c.pair}`,
    },
    message: {
      formal: (c) =>
        `${c.couple} invite you to their wedding on ${c.when} at ${c.venue}. Kindly reply by ${c.d}.`,
      casual: (c) =>
        `We're getting married! ${c.when}, ${c.venue}. Can you make it? Let us know by ${c.d}. ${c.pair}`,
      poetic: (c) =>
        `${c.couple} are getting married on ${c.when} at ${c.venue}, and we'd love you there. Please reply by ${c.d}.`,
    },
    reminder: {
      formal: (c) =>
        `A gentle reminder: we would be grateful for your reply about our wedding (${c.when}) by ${c.d}. ${c.couple}`,
      casual: (c) =>
        `Hi! Quick reminder to let us know by ${c.d} if you're coming to our wedding (${c.when}). ${c.pair}`,
      poetic: (c) =>
        `The day is getting closer, and it wouldn't be the same without you. Please let us know by ${c.d}. ${c.pair}`,
    },
    plusOne: "You are welcome to bring a plus-one.",
    dietary: "Please let us know about any allergies or dietary needs.",
    adultsOnly: "We have chosen to make our celebration adults-only.",
  },
  es: {
    and: "y",
    amp: "y",
    whenLabel: "Cuándo",
    whereLabel: "Dónde",
    contactLabel: "Confirmación",
    opening: {
      formal: (c) => `${c.couple}\n\ntienen el placer de invitaros a su boda.`,
      casual: () => "¡Hola!\n\nNos casamos y nos encantaría que estuvierais con nosotros.",
      poetic: (c) =>
        `Dos vidas, un día, un comienzo.\n\n${c.couple} se casan, y el día no estaría completo sin vosotros.`,
    },
    reply: {
      formal: (c) => `Se ruega confirmación antes del ${c.d}.`,
      casual: (c) => `Decidnos antes del ${c.d} si podéis venir.`,
      poetic: (c) => `Contadnos antes del ${c.d} si estaréis a nuestro lado.`,
    },
    sign: {
      formal: (c) => `Os esperamos con cariño,\n${c.couple}`,
      casual: (c) => `Un abrazo,\n${c.pair}`,
      poetic: (c) => `Con amor,\n${c.pair}`,
    },
    message: {
      formal: (c) =>
        `${c.couple} tienen el placer de invitaros a su boda: ${c.when}, ${c.venue}. Se ruega confirmación antes del ${c.d}.`,
      casual: (c) =>
        `¡Nos casamos! ${c.when}, ${c.venue}. ¿Venís? Decidnos antes del ${c.d}. ${c.pair}`,
      poetic: (c) =>
        `${c.couple} se casan: ${c.when}, ${c.venue}. Queremos que estéis allí. Confirmad antes del ${c.d}.`,
    },
    reminder: {
      formal: (c) =>
        `Un recordatorio: os agradeceríamos la confirmación para nuestra boda (${c.when}) antes del ${c.d}. ${c.couple}`,
      casual: (c) =>
        `¡Hola! Recordad decirnos antes del ${c.d} si venís a nuestra boda (${c.when}). ${c.pair}`,
      poetic: (c) =>
        `Falta poco para el gran día y no sería lo mismo sin vosotros. Confirmad antes del ${c.d}, por favor. ${c.pair}`,
    },
    plusOne: "Podéis venir acompañados.",
    dietary: "Por favor, indicadnos cualquier alergia o necesidad alimentaria.",
    adultsOnly: "Hemos decidido que la celebración sea solo para adultos.",
  },
  de: {
    and: "und",
    amp: "&",
    whenLabel: "Wann",
    whereLabel: "Wo",
    contactLabel: "Antwort an",
    opening: {
      formal: (c) => `${c.couple}\n\nfreuen sich, euch zu ihrer Hochzeit einzuladen.`,
      casual: () =>
        "Hallo ihr Lieben!\n\nWir heiraten und würden uns riesig freuen, wenn ihr dabei seid.",
      poetic: (c) =>
        `Zwei Leben, ein Tag, ein Anfang.\n\n${c.couple} sagen Ja, und ohne euch wäre der Tag nicht vollständig.`,
    },
    reply: {
      formal: (c) => `Wir bitten um Rückmeldung bis zum ${c.d}.`,
      casual: (c) => `Sagt uns bis zum ${c.d} Bescheid, ob ihr kommt.`,
      poetic: (c) => `Verratet uns bis zum ${c.d}, ob ihr an unserer Seite seid.`,
    },
    sign: {
      formal: (c) => `Wir freuen uns auf euch,\n${c.couple}`,
      casual: (c) => `Liebe Grüße,\n${c.pair}`,
      poetic: (c) => `In Liebe,\n${c.pair}`,
    },
    message: {
      formal: (c) =>
        `${c.couple} laden euch herzlich zu ihrer Hochzeit ein: ${c.when}, ${c.venue}. Bitte gebt uns bis zum ${c.d} Bescheid.`,
      casual: (c) =>
        `Wir heiraten! ${c.when}, ${c.venue}. Seid ihr dabei? Sagt uns bis zum ${c.d} Bescheid. ${c.pair}`,
      poetic: (c) =>
        `${c.couple} sagen Ja: ${c.when}, ${c.venue}. Wir wünschen uns euch dabei. Bitte antwortet bis zum ${c.d}.`,
    },
    reminder: {
      formal: (c) =>
        `Eine kleine Erinnerung: Wir bitten um eure Rückmeldung zu unserer Hochzeit (${c.when}) bis zum ${c.d}. ${c.couple}`,
      casual: (c) =>
        `Hallo! Kurze Erinnerung: Sagt uns bis zum ${c.d}, ob ihr zu unserer Hochzeit (${c.when}) kommt. ${c.pair}`,
      poetic: (c) =>
        `Der große Tag rückt näher, und ohne euch wäre er nicht derselbe. Bitte antwortet bis zum ${c.d}. ${c.pair}`,
    },
    plusOne: "Eure Begleitung ist herzlich willkommen.",
    dietary: "Bitte teilt uns Allergien oder besondere Ernährungswünsche mit.",
    adultsOnly: "Wir feiern im Kreis der Erwachsenen, ohne Kinder.",
  },
  hr: {
    and: "i",
    amp: "i",
    whenLabel: "Kada",
    whereLabel: "Gdje",
    contactLabel: "Potvrda",
    opening: {
      formal: (c) => `${c.couple}\n\ns radošću vas pozivaju na svoje vjenčanje.`,
      casual: () => "Bok!\n\nVjenčavamo se i jako bismo voljeli da budete s nama.",
      poetic: (c) =>
        `Dva života, jedan dan, jedan početak.\n\n${c.couple} se vjenčavaju, a dan ne bi bio potpun bez vas.`,
    },
    reply: {
      formal: (c) => `Molimo potvrdite dolazak do ${c.d}.`,
      casual: (c) => `Javite nam do ${c.d} dolazite li.`,
      poetic: (c) => `Recite nam do ${c.d} hoćete li biti uz nas.`,
    },
    sign: {
      formal: (c) => `Radujemo se vašem dolasku,\n${c.couple}`,
      casual: (c) => `Grlimo vas,\n${c.pair}`,
      poetic: (c) => `S ljubavlju,\n${c.pair}`,
    },
    message: {
      formal: (c) =>
        `${c.couple} s radošću vas pozivaju na svoje vjenčanje: ${c.when}, ${c.venue}. Molimo potvrdite dolazak do ${c.d}.`,
      casual: (c) =>
        `Vjenčavamo se! ${c.when}, ${c.venue}. Dolazite? Javite nam do ${c.d}. ${c.pair}`,
      poetic: (c) =>
        `${c.couple} se vjenčavaju: ${c.when}, ${c.venue}. Želimo vas uz sebe. Potvrdite dolazak do ${c.d}.`,
    },
    reminder: {
      formal: (c) =>
        `Ljubazni podsjetnik: molimo potvrdite dolazak na naše vjenčanje (${c.when}) do ${c.d}. ${c.couple}`,
      casual: (c) =>
        `Bok! Samo podsjetnik: javite nam do ${c.d} dolazite li na naše vjenčanje (${c.when}). ${c.pair}`,
      poetic: (c) =>
        `Veliki dan se bliži i bez vas ne bi bio isti. Molimo potvrdite dolazak do ${c.d}. ${c.pair}`,
    },
    plusOne: "Slobodno povedite pratnju.",
    dietary: "Javite nam ako imate alergije ili posebne prehrambene potrebe.",
    adultsOnly: "Proslava je samo za odrasle.",
  },
};

function formatDate(iso: string, lang: UiLocale): string {
  if (!iso) return BLANK;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(intlLocale(lang), { year: "numeric", month: "long", day: "numeric" });
}

/** Builds the text for one language / format / tone. Empty fields render as a
 *  visible blank, never as a guessed value, except the names, which fall back
 *  to a sample couple so the preview reads as a real invitation. */
export function buildRsvpText(
  lang: UiLocale,
  format: RsvpFormat,
  tone: RsvpTone,
  input: RsvpInput,
): string {
  const p = PHRASES[lang];
  const a = input.partnerA.trim() || "Anna";
  const b = input.partnerB.trim() || "Bence";
  const date = formatDate(input.date, lang);
  const time = input.time.trim();
  const ctx: Ctx = {
    a,
    b,
    couple: `${a} ${p.and} ${b}`,
    pair: `${a} ${p.amp} ${b}`,
    when: time ? `${date}, ${time}` : date,
    venue: input.venue.trim() || BLANK,
    d: formatDate(input.deadline, lang),
  };
  const extras = [
    input.plusOne ? p.plusOne : null,
    input.dietary ? p.dietary : null,
    input.adultsOnly ? p.adultsOnly : null,
  ].filter((s): s is string => s !== null);
  const contact = input.contact.trim();
  const contactLine = contact ? `${p.contactLabel}: ${contact}` : null;

  let text: string;
  if (format === "invitation") {
    const blocks = [
      p.opening[tone](ctx),
      `${p.whenLabel}: ${ctx.when}\n${p.whereLabel}: ${ctx.venue}`,
      extras.length > 0 ? extras.join("\n") : null,
      [p.reply[tone](ctx), contactLine].filter(Boolean).join("\n"),
      p.sign[tone](ctx),
    ];
    text = blocks.filter(Boolean).join("\n\n");
  } else {
    const body = format === "message" ? p.message[tone](ctx) : p.reminder[tone](ctx);
    // Extras matter on the first ask, not on a nudge about a deadline.
    const withExtras =
      format === "message" && extras.length > 0 ? `${body} ${extras.join(" ")}` : body;
    // The contact gets its own line: a link or address followed by a period
    // is one a messaging app may not recognise.
    text = contactLine ? `${withExtras}\n${contactLine}` : withExtras;
  }
  // HU and HR dates end in a period ("2026. május 1."), so a sentence that
  // closes on one would print two.
  return text.replace(/(?<!\.)\.\.(?!\.)/g, ".");
}
