// Is this string a name, or is it a placeholder somebody typed to get past a
// required field? One rule, shared by both sides, because the answer has to be
// the same in the onboarding wizard's inline error and in the route that
// refuses the write. A client-side check the server doesn't repeat is a
// suggestion, not a policy.
//
// Why this exists: the directory and the community are only worth something if
// the accounts in them belong to real couples. Production had "x & y",
// "XY & Z", "NŐ & FÉRFI" (WOMAN & MAN), "Asszony & Ferj" (WIFE & HUSBAND),
// "Nem & Tudom" (I & DON'T-KNOW), "Bridee & Groomy" and a run of single
// letters: every one of them a signal that nobody real is behind the row.
//
// The bias, deliberately: a false NEGATIVE (a placeholder slips through) costs
// us one junk row. A false POSITIVE costs a real couple their signup, at the
// exact moment they are deciding whether to bother with us. So every rule here
// fires on an EXACT normalised token or on a structural impossibility, never on
// a fuzzy resemblance to a blocked word. "Feri" (Ferenc) must survive a list
// that contains "férj"; "Bori" must survive one that contains "bori"-adjacent
// nothing; "Mari" must not fold into "mar". That is why the diminutive strip is
// applied to the CANDIDATE only when the stripped form lands on an exact
// blocked token, and never used to shorten a name into one.

/** Why a string was refused. The frontend maps these to its own copy. */
export type PlaceholderNameReason =
  /** Fewer than 2 letters: "x", "N", "A". */
  | "too_short"
  /** A role, not a person: bride / groom / feleség / novio / "me". */
  | "role_word"
  /** A known filler token: test, asdf, xyz, tbd, "nem tudom". */
  | "placeholder"
  /** One letter repeated: "aaa", "xxxx". */
  | "repeated"
  /** A run along the keyboard: "asdf", "qwerty", "zxcv". */
  | "keyboard"
  /** No vowel in a short string: "Kr", "xyz". Real names have vowels. */
  | "no_vowel"
  /** No letter at all: "123", "...", "@@". */
  | "no_letters";

export interface PlaceholderNameVerdict {
  reason: PlaceholderNameReason;
  /** The offending value, trimmed. Echoed back so a caller can name it. */
  value: string;
}

/** Minimum letters in a name we will accept. Two: "Jo", "Bo", "Li" and "Ed"
 *  are real, "x" and "N" are not, and a single character carries no
 *  information a human could use to address the couple. */
export const MIN_NAME_LETTERS = 2;

/**
 * Role words in every language the product speaks, plus the ones our own UI
 * puts on screen next to the field (a placeholder in the input is the single
 * likeliest thing a bored user retypes into it).
 *
 * Only unambiguous words go here, and two kinds are deliberately ABSENT:
 *
 *  - Hungarian "ara" (bride), because it is also a given name. Refusing a real
 *    Ara is worse than accepting a lazy one.
 *  - the INDUSTRY itself: wedding / esküvő / boda / marriage. Every business on
 *    this platform is a wedding business, and production carried two of them,
 *    "Esküvői Weboldalam" and "Dream Wedding Film", that this list refused.
 *    A word that appears in the product's own category names is evidence of
 *    nothing.
 */
const ROLE_WORDS = new Set<string>([
  // English
  "bride",
  "groom",
  "brides",
  "grooms",
  "thebride",
  "thegroom",
  "bridetobe",
  "groomtobe",
  "wife",
  "husband",
  "spouse",
  "partner",
  "fiance",
  "fiancee",
  "boyfriend",
  "girlfriend",
  "me",
  "myself",
  "him",
  "her",
  "man",
  "woman",
  "boy",
  "girl",
  "lady",
  "mr",
  "mrs",
  "ms",
  "sir",
  "madam",
  "couple",
  "firstname",
  "lastname",
  "surname",
  "fullname",
  "yourname",
  "myname",
  "name",
  "names",
  // Hungarian
  "menyasszony",
  "volegeny",
  "volegenyem",
  "menyasszonyom",
  "feleseg",
  "felesegem",
  "ferj",
  "ferjem",
  "asszony",
  "asszonyka",
  "no",
  "ferfi",
  "fiu",
  "lany",
  "csaj",
  "pasi",
  "parom",
  "jegyes",
  "jegyesem",
  "vezeteknev",
  "keresztnev",
  "teljesnev",
  "nev",
  "neved",
  "nevem",
  "en",
  // Spanish
  "novia",
  "novio",
  "esposa",
  "esposo",
  "marido",
  "mujer",
  "hombre",
  "chico",
  "chica",
  "pareja",
  "prometido",
  "prometida",
  "nombre",
  "apellido",
  "yo",
  "senor",
  "senora",
]);

/**
 * Filler somebody types to satisfy a required field. Distinct from role words
 * only in what the copy should say back: "that is a role, not your name" vs
 * "that looks like a placeholder".
 */
const PLACEHOLDER_WORDS = new Set<string>([
  // Alphabet soup
  "xy",
  "xz",
  "yz",
  "xyz",
  "abc",
  "abcd",
  "aa",
  "ab",
  "ba",
  "bb",
  "cc",
  "xx",
  "yy",
  "zz",
  "qq",
  "ww",
  // Test / demo
  "test",
  "tester",
  "testing",
  "teszt",
  "prueba",
  "demo",
  "sample",
  "example",
  "ejemplo",
  "pelda",
  "dummy",
  "placeholder",
  "foo",
  "bar",
  "baz",
  "lorem",
  "ipsum",
  "user",
  "felhasznalo",
  "usuario",
  "admin",
  "guest",
  "vendeg",
  "anonymous",
  "anonim",
  "anonimo",
  "someone",
  "somebody",
  "valaki",
  "akarki",
  "alguien",
  "nobody",
  "senki",
  "nadie",
  // Refusals to answer
  "na",
  "tbd",
  "tba",
  "none",
  "null",
  "nil",
  "undefined",
  "unknown",
  "nincs",
  "nem",
  "tudom",
  "nemtudom",
  "nemtudjuk",
  "megnemtudom",
  "titok",
  "secret",
  "nose",
  "ninguno",
  "desconocido",
  "whatever",
  "mindegy",
  "asd",
  "asdf",
  "asdfg",
  "qwe",
  "qwer",
  "qwerty",
  "zxc",
  "zxcv",
  "jkl",
  "hjkl",
  "blah",
  "bla",
  "hello",
  "szia",
  "hola",
]);

/** Sequences along a QWERTY row. A name that is a substring of one of these
 *  (3+ chars) was typed with the left hand without looking. */
const KEYBOARD_RUNS = [
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
  "abcdefghijk",
  "1234567890",
  "poiuytrewq",
  "lkjhgfdsa",
  "mnbvcxz",
];

const VOWELS = new Set(["a", "e", "i", "o", "u", "y"]);

/**
 * Lowercase, strip accents, drop everything that is not a letter. "Ferj" and
 * "férj" collapse to the same token; "Ádám" keeps its letters as "adam".
 *
 * `\p{L}` and not `[a-z]`, which is the difference between a rule and an
 * accident: folding to ASCII would empty out 王芳, Ольга and محمد, and every
 * one of them would then be refused as "contains no letters". Non-Latin names
 * simply match none of the blocked words, which is the correct outcome: we
 * have no evidence about them either way, so they pass.
 *
 * Note this deliberately KEEPS the letter sequence intact: no repeated-letter
 * collapsing here, because "Anna" -> "ana" and "Bettina" -> "betina" would
 * start colliding with each other for no gain.
 */
export function foldName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}]/gu, "");
}

/** True when every letter is plain a-z after folding. The structural rules
 *  (vowels, keyboard runs) only mean anything about Latin script. */
function isLatin(folded: string): boolean {
  return /^[a-z]+$/.test(folded);
}

/**
 * The forms of a candidate we test against the blocked sets. Only ever used to
 * ask "is this exactly a blocked word?": never to rewrite the name itself.
 *
 * - the fold itself:            "Ferj"   -> "ferj"
 * - repeated letters collapsed: "Bridee" -> "bride", "Grooom" -> "grom"
 * - a trailing diminutive:      "Groomy" -> "groom", "Bridey" -> "bride"
 *
 * The diminutive strip is why "Groomy"/"Bridey"/"Groomie" are caught. It is
 * safe because it only matters when the RESULT is an exact blocked word:
 * "Mari" -> "mar" is not in any set, so Mari passes untouched.
 */
function candidateForms(folded: string): string[] {
  const forms = new Set<string>([folded]);

  const collapsed = folded.replace(/(.)\1+/g, "$1");
  forms.add(collapsed);

  for (const base of [folded, collapsed]) {
    // -ie / -ee / -ey diminutives and the plural s, then the single-character
    // -y / -i / -s. Both, because they disagree and each catches what the other
    // misses: "bridey" needs the one-char strip (the two-char "ey" rule leaves
    // "brid"), "groomie" needs the two-char one.
    for (const stripped of [base.replace(/(ee|ey|ie|s)$/, ""), base.replace(/[yis]$/, "")]) {
      // Four letters minimum, and this threshold is load-bearing. Every real
      // Hungarian nickname ends in -i, so a lower bar starts eating people:
      // "Bari" -> "bar", "Eni" -> "en", "Mani" -> "man", "Ági" -> "ag". At four
      // the strip still reaches everything it was added for ("Groomy" -> groom,
      // "Bridey" -> bride, "Wifey" -> wife) and reaches no three-letter word.
      if (stripped.length >= 4) {
        forms.add(stripped);
        forms.add(stripped.replace(/(.)\1+/g, "$1"));
      }
    }
  }
  return [...forms];
}

/**
 * Verdict on ONE name field. `null` means it looks like a name.
 *
 * Applied to `bride_name`, `groom_name` and `users.full_name` alike: a person
 * called "Test" is the same problem wherever the field lives.
 */
export function checkRealName(raw: string): PlaceholderNameVerdict | null {
  const value = raw.trim();
  const folded = foldName(value);

  if (folded.length === 0) return { reason: "no_letters", value };
  if (folded.length < MIN_NAME_LETTERS) return { reason: "too_short", value };

  // A name is one or more words; test each word AND the whole thing, so
  // "Nem Tudom" is caught both typed into one field and split across two.
  //
  // A word must be THREE letters to be judged on its own, while the whole
  // string is judged at any length. That gap is deliberate: the two-letter
  // entries in the sets ("no" for Hungarian "nő", "me", "yo", "en") are only
  // placeholders when they stand alone as the entire answer. Judged per word
  // they would refuse "No Jin" and "En Hui", which are people.
  const words = value
    .split(/[\s.,\-_/&+]+/)
    .map(foldName)
    .filter((w) => w.length >= 3);
  const tokens = [folded, ...words];

  for (const token of tokens) {
    for (const form of candidateForms(token)) {
      if (ROLE_WORDS.has(form)) return { reason: "role_word", value };
      if (PLACEHOLDER_WORDS.has(form)) return { reason: "placeholder", value };
    }
  }

  // Structural impossibilities, on the whole folded string.
  if (/^(.)\1+$/.test(folded)) return { reason: "repeated", value };

  // The rest is evidence about Latin script only. "叶" has no vowel and "ㅏㅑ"
  // is a run along a keyboard, and neither fact says anything about whether a
  // person is behind it.
  if (!isLatin(folded)) return null;

  if (folded.length <= 6) {
    for (const run of KEYBOARD_RUNS) {
      if (run.includes(folded)) return { reason: "keyboard", value };
    }
  }

  // No vowel and short: "Kr", "xz", "bcd". Longer consonant clusters are left
  // alone: transliterations and non-Latin-origin names get long enough that
  // the rule stops being evidence of anything.
  if (folded.length <= 4 && ![...folded].some((c) => VOWELS.has(c))) {
    return { reason: "no_vowel", value };
  }

  return null;
}

/** True when the string passes. Convenience for call sites that don't care why. */
export function isRealName(raw: string): boolean {
  return checkRealName(raw) === null;
}

/** The couple-level question: which of the two partner names is a placeholder?
 *  Returns the offending fields in a stable order so the copy reads the same
 *  on every render. */
export function checkPartnerNames(input: {
  bride_name: string;
  groom_name: string;
}): Array<{ field: "bride_name" | "groom_name"; reason: PlaceholderNameReason }> {
  const out: Array<{ field: "bride_name" | "groom_name"; reason: PlaceholderNameReason }> = [];
  const bride = checkRealName(input.bride_name);
  if (bride) out.push({ field: "bride_name", reason: bride.reason });
  const groom = checkRealName(input.groom_name);
  if (groom) out.push({ field: "groom_name", reason: groom.reason });
  return out;
}

/** How long a couple already inside the app has to correct their names before
 *  the workspace goes read-only. Three days, as promised in the notice. */
export const NAME_REVIEW_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/** The couple-facing state of a name review. Computed from `name_flagged_at`
 *  and the CURRENT names on every read, never stored: the moment a couple
 *  types a real name the notice is gone, with no job in between. */
export interface NameReview {
  /** Which fields are the problem right now. */
  fields: Array<{ field: "bride_name" | "groom_name"; reason: PlaceholderNameReason }>;
  /** When we first noticed. */
  flagged_at: number;
  /** `flagged_at + NAME_REVIEW_GRACE_MS`. The date the notice names. */
  deadline: number;
  /** Past the deadline: the workspace is read-only until the names are real. */
  locked: boolean;
}
