// Ready-made quiz rounds, so a couple starts from a full quiz instead of an
// empty builder. Same idea as the WeddlyMarket question packs
// (shared/market_packs.ts): EN and HU text, every other UI locale reads EN.
//
// `{a}` and `{b}` are the two partners' first names, filled in from the
// couple's own record when the template lands, so "Who said 'I love you'
// first?" offers their real names as the two answers. Correct answers are
// left unset on anything only the couple can know; the builder's "mark as
// correct" is one tap per slide, and an unset answer is a valid opinion
// slide rather than a broken one if they never get to it.

export interface QuizTemplateSlide {
  kind: "mcq" | "binary" | "number" | "section";
  en: string;
  hu: string;
  /** mcq/binary option text per locale; binary "who" questions use {a}/{b}. */
  options?: { en: string[]; hu: string[] };
  number?: { min: number; max: number; step: number; unit: { en: string; hu: string } | null };
}

export interface QuizTemplate {
  id: "know_us" | "wedding_day";
  emoji: string;
  slides: readonly QuizTemplateSlide[];
}

const WHO = { en: ["{a}", "{b}"], hu: ["{a}", "{b}"] };

export const QUIZ_TEMPLATES: readonly QuizTemplate[] = [
  {
    id: "know_us",
    emoji: "💞",
    slides: [
      { kind: "section", en: "How well do you know us?", hu: "Mennyire ismertek minket?" },
      {
        kind: "mcq",
        en: "Where did we first meet?",
        hu: "Hol találkoztunk először?",
        options: {
          en: ["At a party", "At work", "Online", "Through friends"],
          hu: ["Egy buliban", "A munkahelyen", "Online", "Barátokon keresztül"],
        },
      },
      {
        kind: "binary",
        en: "Who said 'I love you' first?",
        hu: "Ki mondta ki először, hogy szeretlek?",
        options: WHO,
      },
      {
        kind: "number",
        en: "How many years have we been together?",
        hu: "Hány éve vagyunk együtt?",
        number: { min: 0, max: 20, step: 1, unit: { en: "years", hu: "év" } },
      },
      { kind: "binary", en: "Who is the better cook?", hu: "Ki főz jobban?", options: WHO },
      {
        kind: "mcq",
        en: "Where was our first date?",
        hu: "Hol volt az első randink?",
        options: {
          en: ["Restaurant", "Cinema", "A walk", "Coffee"],
          hu: ["Étterem", "Mozi", "Séta", "Kávézó"],
        },
      },
      {
        kind: "binary",
        en: "Who takes longer to get ready?",
        hu: "Ki készülődik tovább?",
        options: WHO,
      },
      { kind: "section", en: "The proposal", hu: "A lánykérés" },
      {
        kind: "mcq",
        en: "Where did the proposal happen?",
        hu: "Hol történt a lánykérés?",
        options: {
          en: ["At home", "On a trip", "At a restaurant", "In nature"],
          hu: ["Otthon", "Utazáson", "Étteremben", "A természetben"],
        },
      },
      {
        kind: "binary",
        en: "Who cried during the proposal?",
        hu: "Ki sírta el magát a lánykéréskor?",
        options: WHO,
      },
      {
        kind: "number",
        en: "How many months did the wedding planning take?",
        hu: "Hány hónapig tartott az esküvőszervezés?",
        number: { min: 0, max: 36, step: 1, unit: { en: "months", hu: "hónap" } },
      },
      {
        kind: "binary",
        en: "Who is more likely to get lost?",
        hu: "Ki téved el könnyebben?",
        options: WHO,
      },
    ],
  },
  {
    id: "wedding_day",
    emoji: "🥂",
    slides: [
      { kind: "section", en: "Wedding day trivia", hu: "Esküvői kvíz" },
      {
        kind: "number",
        en: "How many guests are here today?",
        hu: "Hány vendég van ma itt?",
        number: { min: 0, max: 300, step: 5, unit: null },
      },
      {
        kind: "mcq",
        en: "Which was the hardest decision of the planning?",
        hu: "Mi volt a legnehezebb döntés a szervezésben?",
        options: {
          en: ["The venue", "The guest list", "The menu", "The music"],
          hu: ["A helyszín", "A vendéglista", "A menü", "A zene"],
        },
      },
      {
        kind: "binary",
        en: "Who picked the first dance song?",
        hu: "Ki választotta az első tánc zenéjét?",
        options: WHO,
      },
      {
        kind: "mcq",
        en: "What's on the honeymoon wishlist?",
        hu: "Mi van a nászút kívánságlistáján?",
        options: {
          en: ["Beach", "City trip", "Mountains", "Road trip"],
          hu: ["Tengerpart", "Városnézés", "Hegyek", "Autós körút"],
        },
      },
      {
        kind: "number",
        en: "How many tiers does the cake have?",
        hu: "Hány emeletes a torta?",
        number: { min: 1, max: 8, step: 1, unit: null },
      },
      {
        kind: "binary",
        en: "Who will be first on the dance floor?",
        hu: "Ki lesz az első a táncparketten?",
        options: WHO,
      },
      {
        kind: "binary",
        en: "Who will last longer at the party?",
        hu: "Ki bírja tovább a bulit?",
        options: WHO,
      },
    ],
  },
];

/** "Allie & Noah" style display names split into first names, falling back to
 *  the separate fields, then to neutral placeholders the couple will see and
 *  fix in the builder. */
export function templatePartnerNames(couple: {
  display_name?: string | null;
  bride_name?: string | null;
  groom_name?: string | null;
}): [string, string] {
  const a = couple.bride_name?.trim().split(/\s+/)[0];
  const b = couple.groom_name?.trim().split(/\s+/)[0];
  if (a && b) return [a, b];
  const parts = (couple.display_name ?? "").split(/\s*(?:&|\+|\band\b|\bés\b)\s*/i).filter(Boolean);
  if (parts.length >= 2) return [parts[0]!.trim(), parts[1]!.trim()];
  return ["A", "B"];
}

export interface QuizTemplateSlideInput {
  kind: QuizTemplateSlide["kind"];
  prompt: string;
  config: Record<string, unknown>;
}

/** The template as the slide inputs the bulk endpoint takes. */
export function instantiateQuizTemplate(
  template: QuizTemplate,
  locale: string,
  names: [string, string],
): QuizTemplateSlideInput[] {
  const lang = locale === "hu" ? "hu" : "en";
  const fill = (text: string) => text.replaceAll("{a}", names[0]).replaceAll("{b}", names[1]);
  return template.slides.map((slide) => {
    const prompt = fill(slide[lang]);
    if (slide.kind === "section") return { kind: "section", prompt, config: {} };
    if (slide.kind === "number" && slide.number) {
      return {
        kind: "number",
        prompt,
        config: {
          min: slide.number.min,
          max: slide.number.max,
          step: slide.number.step,
          correctValue: null,
          unit: slide.number.unit ? slide.number.unit[lang] : null,
          toleranceFraction: 0.05,
        },
      };
    }
    return {
      kind: slide.kind,
      prompt,
      config: { options: (slide.options?.[lang] ?? []).map(fill), correctIndex: null },
    };
  });
}
