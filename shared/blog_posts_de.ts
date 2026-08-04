// German copy for every seeded blog post, keyed by the post's canonical
// (Hungarian) slug. Read by `SEED_TRANSLATIONS` in blog_posts.ts, written
// into the `de_*` columns by the boot seeder, and served to any reader whose
// UI locale is Deutsch.
//
// Address form: the whole German tree speaks to the couple as "ihr" (the
// plural du), matching the Hungarian original's tone and the fact that two
// people are reading. Switching to "Sie" for the blog alone would make the
// articles sound like a different product than the workspace they link to.

import type { BlogTranslationsBySlug } from "./blog_posts";

export const BLOG_POSTS_DE: BlogTranslationsBySlug = {
  "eskuvoi-rsvp-kerdesek": {
    category: "RSVP",
    title: "Hochzeits-RSVP: Was ihr fragen solltet, damit die Antworten überschaubar bleiben",
    lead: "Welche Fragen ins Antwortformular gehören, damit es für die Gäste leicht und für euch nützlich ist.",
    seo_title: "Fragen fürs Hochzeits-RSVP · Weddly",
    seo_description:
      "RSVP-Leitfaden für die Hochzeit: was ihr fragen solltet, warum weniger Felder mehr Rückmeldungen bringen und wie ihr die Antworten nutzt.",
    body: [
      {
        type: "p",
        text: "RSVP klingt einfach: Ihr wollt wissen, wer kommt. In der Praxis stecken in den Antworten die endgültige Gästezahl, die Menüwahl, die Zahl der Begleitungen und ein Dutzend Details, die ihr für den Rest der Planung braucht.",
      },
      {
        type: "p",
        text: "Das beste RSVP-Formular ist kurz, funktioniert am Handy und fragt nur ab, was ihr wirklich verwendet.",
      },
      { type: "h2", text: "1. Kommst du oder nicht?" },
      {
        type: "p",
        text: "Das gehört nach ganz oben. Vergrabt es nicht unter einer langen Einleitung. Der Gast muss sofort sehen, worum es geht.",
      },
      { type: "p", text: "Beispiel: „Bist du dabei?”" },
      { type: "ul", items: ["Ja, ich komme.", "Leider schaffe ich es nicht."] },
      { type: "h2", text: "2. Begleitung" },
      {
        type: "p",
        text: "Wenn Begleitungen willkommen sind, schreibt das klar ins Formular. Wenn nur ein Teil der Gäste jemanden mitbringen darf, verhindern persönliche Links pro Gast ganz unaufgeregt den unangenehmen Moment, in dem jemand mit einer Freundin auftaucht, mit der ihr nicht gerechnet habt.",
      },
      { type: "p", text: "Beispiel: „Bringst du jemanden mit?”" },
      { type: "h2", text: "3. Menü und Ernährung" },
      {
        type: "p",
        text: "Die Küche muss früh wissen, womit sie plant. Fragt Menüwahl und Ernährungsbedürfnisse deshalb im selben Atemzug ab.",
      },
      { type: "p", text: "Beispiel: „Gibt es etwas, das du nicht isst?”" },
      {
        type: "p",
        text: "Lasst ein Freitextfeld: Nicht jedes Bedürfnis passt in eine vorgegebene Option.",
      },
      { type: "h2", text: "4. Optionale Extras" },
      { type: "p", text: "Übertreibt es nicht, aber ein paar Zusatzfragen können sich lohnen:" },
      {
        type: "ul",
        items: [
          "Brauchst du eine Mitfahrgelegenheit?",
          "Brauchst du Infos zur Übernachtung?",
          "Hast du einen Musikwunsch?",
          "Gibt es sonst etwas, das wir vorher wissen sollten?",
        ],
      },
      { type: "h2", text: "5. Fragt nicht zu viel" },
      {
        type: "p",
        text: "Ein langes RSVP wird auf später verschoben. Ein gutes ist in unter einer Minute beantwortet, auch am Handy an der Bushaltestelle.",
      },
      {
        type: "p",
        text: "In Weddly bekommt jeder Gast seinen eigenen RSVP-Link, und alles, was er beantwortet, landet direkt in eurer Gästeliste, ohne Copy-und-paste aus einem geteilten Formular.",
      },
      {
        type: "cta",
        lead: "Richtet in Weddly ein einfaches RSVP ein und sammelt jede Antwort, Menüwahl, Begleitung und Notiz an einem Ort.",
        href: "/signup",
        label: "Jetzt loslegen",
      },
    ],
  },
  "eskuvoi-vendeglista-keszitese": {
    category: "Gästeliste",
    title: "Eine Hochzeits-Gästeliste, die wirklich übersichtlich bleibt",
    lead: "Wie ihr Namen, Begleitungen, Zusagen, Menüwahl und Ernährungsbedürfnisse an einem Ort zusammenhaltet.",
    seo_title: "Hochzeits-Gästeliste anlegen · Weddly",
    seo_description:
      "Gästeliste ohne Stress: wie ihr Namen, Begleitungen, RSVP, Menüwahl und Ernährungsbedürfnisse an einem Ort sammelt.",
    body: [
      {
        type: "p",
        text: "Die Gästeliste ist eines der Fundamente der Planung und zugleich das Erste, was sich zu verstreuen pflegt: eine Tabelle hier, ein paar Notizen dort, zwei Chatverläufe. Einer hat geantwortet, einer nicht. Einer möchte jemanden mitbringen, einer braucht ein vegetarisches Menü, ein Dritter weiß es noch nicht.",
      },
      { type: "p", text: "Genau dieses Durcheinander lohnt es sich von Anfang an zu verhindern." },
      { type: "h2", text: "1. Haltet mehr fest als Namen" },
      { type: "p", text: "Eine gute Gästeliste ist keine Namensliste. Haltet zu jedem Gast fest:" },
      {
        type: "ul",
        items: [
          "vollständiger Name",
          "Status der Einladung",
          "RSVP-Antwort",
          "Begleitung",
          "Menüwahl",
          "Allergien / Ernährungsbedürfnisse",
          "Tisch",
          "Notizen",
        ],
      },
      {
        type: "p",
        text: "Das erspart euch, in der letzten Woche Messenger und Mails zu durchsuchen, um euch zu erinnern, wer was geschrieben hat.",
      },
      { type: "h2", text: "2. Führt ein klares RSVP" },
      {
        type: "p",
        text: "„Die sagen uns das schon persönlich” geht selten gut. Viel einfacher ist es, wenn jeder Gast einen persönlichen RSVP-Link hat, den er in unter einer Minute beantwortet.",
      },
      { type: "p", text: "Ein gutes Formular fragt nur ab, was ihr wirklich braucht:" },
      {
        type: "ul",
        items: [
          "kommst du",
          "bringst du jemanden mit",
          "Menüwahl",
          "Ernährungsbedürfnisse",
          "sonst noch etwas, das wir wissen sollten",
        ],
      },
      { type: "p", text: "Je kürzer das Formular, desto schneller kommen die Antworten." },
      { type: "h2", text: "3. Klärt Begleitungen früh" },
      {
        type: "p",
        text: "Bei den Begleitungen gerät am häufigsten etwas ins Rutschen. Entscheidet von Anfang an, wer jemanden mitbringen darf, und bleibt dabei, auch wenn ein, zwei Gespräche unangenehm werden.",
      },
      {
        type: "p",
        text: "Das ist nicht nur eine Budgetfrage. Jede Begleitung ist ein weiterer Platz, ein weiteres Menü und manchmal eine andere Tischordnung.",
      },
      { type: "h2", text: "4. Verbindet sie mit der Tischordnung" },
      {
        type: "p",
        text: "Die Angaben aus der Gästeliste nützen am meisten, wenn sie nicht getrennt von der Tischordnung leben. Wenn jemand absagt, eine Begleitung nachmeldet oder ein Ernährungsbedürfnis angibt, sollte der Sitzplan das mittragen.",
      },
      {
        type: "p",
        text: "Es hilft sehr, wenn Gästeliste, RSVP und Tischordnung zusammenliegen: Eine Absage oder eine neue Allergie muss nur einmal notiert werden. (Genau deshalb haben wir Weddly so gebaut.)",
      },
      { type: "h2", text: "Kurze Checkliste" },
      {
        type: "ul",
        items: [
          "Ein Status für jeden Gast.",
          "Die RSVP-Antwort separat festhalten.",
          "Begleitungen früh entscheiden.",
          "Menüwahl und Allergien im selben Schritt abfragen.",
          "Tischordnung mit der Gästeliste verbinden.",
        ],
      },
      {
        type: "cta",
        lead: "Weddly hält Gästeliste, RSVP, Begleitungen, Menüwahl und Tischordnung in einem gemeinsamen Arbeitsbereich.",
        href: "/signup",
        label: "Jetzt loslegen",
      },
    ],
  },
};
