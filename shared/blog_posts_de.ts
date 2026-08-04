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
  "eskuvoi-ultetesi-rend-keszitese": {
    category: "Tischordnung",
    title: "Eine Tischordnung, die Logik hat und sich sauber ausdrucken lässt",
    lead: "Worauf ihr bei Familien, Freundeskreisen, Kindern und beim Druck achten solltet.",
    seo_title: "Tischordnung für die Hochzeit · Weddly",
    seo_description:
      "Wie ihr eine Tischordnung plant, die Familien, Freundeskreise, Kinder und kurzfristige Änderungen aushält und sauber gedruckt aussieht.",
    body: [
      {
        type: "p",
        text: "Die Tischordnung taucht meist in den letzten Wochen vor der Hochzeit auf, obwohl sie viele Entscheidungen prägt. Wer sitzt am Brauttisch? Wo kommen die Familien hin? Sollen Freundeskreise zusammenbleiben? Und die Gäste, die niemanden kennen?",
      },
      {
        type: "p",
        text: "Eine durchdachte Tischordnung ist nicht nur hübsch: Sie macht den Tag für eure Gäste, für das Team der Location und für euch beide unauffällig leichter.",
      },
      { type: "h2", text: "1. Legt sie nicht zu früh fest" },
      {
        type: "p",
        text: "Plant früh, aber betrachtet nichts als endgültig, solange nicht genug Zusagen da sind. Wenn viele Gäste unsicher sind, ändert sich der Plan immer wieder.",
      },
      { type: "p", text: "Fangt mit Gruppen auf Tischebene an:" },
      {
        type: "ul",
        items: [
          "engste Familie",
          "weitere Verwandtschaft",
          "Freundeskreis",
          "Kolleginnen und Kollegen",
          "Familien mit Kindern",
          "ältere Gäste",
        ],
      },
      {
        type: "p",
        text: "Wenn die Gruppen sitzen, könnt ihr euch fragen, wer genau wo Platz nimmt.",
      },
      { type: "h2", text: "2. Nehmt den Raum ernst" },
      {
        type: "p",
        text: "Die Position zählt: Tanzfläche, Bar, Eingang, Band. Ältere Gäste mögen die ruhigeren Ecken. Freundeskreise gehören in die Nähe der Tanzfläche.",
      },
      {
        type: "p",
        text: "Eine gute Tischordnung fragt nicht nur, wer neben wem sitzt, sondern auch, wo sich wer im Raum am wohlsten fühlt.",
      },
      { type: "h2", text: "3. Bringt die Druckfassung in Ordnung" },
      { type: "p", text: "Die Tischordnung endet nicht am Bildschirm. Ihr braucht vermutlich:" },
      {
        type: "ul",
        items: [
          "eine große Tafel am Eingang",
          "Tischnummern",
          "Platzkarten",
          "eine Liste fürs Catering",
          "ein Exemplar für das Team am Tag selbst",
        ],
      },
      {
        type: "p",
        text: "Deshalb lohnt es sich, früh zu überlegen, wie das Ganze gedruckt und aufgehängt aussieht.",
      },
      { type: "h2", text: "4. Rechnet mit Änderungen in letzter Minute" },
      {
        type: "p",
        text: "In der letzten Woche sagt immer jemand ab, oder jemand sagt nach langem Zögern doch zu. Wenn der Plan nur in einem handgezeichneten PDF lebt, tut jede Änderung weh.",
      },
      {
        type: "p",
        text: "Genau deshalb haben wir die Sitzplan-Fläche in Weddly so gebaut: Gast anfassen, woanders ablegen, und wenn ihr so weit seid, druckt sie in A4, A6 oder A3.",
      },
      { type: "h2", text: "Kurze Checkliste" },
      {
        type: "ul",
        items: [
          "Erst gruppieren, dann setzen.",
          "Festzurren, wenn die Zusagen stehen.",
          "Den echten Raumplan nutzen.",
          "Die Druckfassung mitplanen.",
          "Luft für späte Änderungen lassen.",
        ],
      },
      {
        type: "cta",
        lead: "Plant die Tischordnung in Weddly visuell und exportiert sie als A4 / A6 / A3 für die Tafel am Eingang, die Platzkarten und den Ordner der Koordination.",
        href: "/signup",
        label: "Ausprobieren",
      },
    ],
  },
  "eskuvoszervezesi-checklist-12-honapra": {
    category: "Planung",
    title: "Hochzeits-Checkliste für 12 Monate: was wann drankommt",
    lead: "Schritt für Schritt: was ein Jahr, sechs Monate und einen Monat vor der Hochzeit feststehen sollte.",
    seo_title: "Hochzeits-Checkliste für 12 Monate · Weddly",
    seo_description:
      "Praktische 12-Monats-Checkliste: was ein Jahr, neun Monate, sechs, drei, einen Monat und eine Woche vor der Hochzeit ansteht.",
    body: [
      {
        type: "p",
        text: "Hochzeitsplanung fühlt sich nur dann erdrückend an, wenn alles gleichzeitig auf euch einprasselt. Location, Gästeliste, Fotografie, Musik, Einladungen, Kleidung, Tischordnung, Menü, Deko, Papeterie. Da verliert man leicht den Faden.",
      },
      {
        type: "p",
        text: "Die gute Nachricht: Das muss nicht in einem Rutsch gelöst werden. In Wellen wird die ganze Sache deutlich ruhiger.",
      },
      { type: "h2", text: "12 Monate vorher" },
      { type: "p", text: "Das ist die Zeit der großen Entscheidungen." },
      {
        type: "ul",
        items: [
          "Datum festlegen",
          "Stil klären",
          "grobes Budget entwerfen",
          "Gästezahl schätzen",
          "Locations suchen",
          "die wichtigsten Dienstleister in die engere Wahl nehmen",
        ],
      },
      { type: "p", text: "Ihr braucht noch nicht jedes Detail, nur klare Grenzen." },
      { type: "h2", text: "9 Monate vorher" },
      { type: "p", text: "Zeit zu buchen." },
      {
        type: "ul",
        items: [
          "Vertrag mit der Location",
          "Foto / Video",
          "Band oder DJ",
          "Trauredner / Moderation",
          "erster Entwurf der Gästeliste",
          "Hochzeitswebsite oder RSVP",
        ],
      },
      {
        type: "p",
        text: "Die Gästeliste wird sich noch bewegen, aber bringt eine erste Fassung zu Papier.",
      },
      { type: "h2", text: "6 Monate vorher" },
      { type: "p", text: "Jetzt die Details." },
      {
        type: "ul",
        items: [
          "Gestaltung der Einladungen",
          "RSVP-Frist",
          "Richtung der Deko",
          "Kleidung",
          "Menü-Angebote",
          "Plan für Übernachtung und Transport",
        ],
      },
      {
        type: "p",
        text: "Ab hier sollte sich das Budget aus echten Angeboten speisen, nicht mehr aus Schätzungen.",
      },
      { type: "h2", text: "3 Monate vorher" },
      { type: "p", text: "Rückmeldungen und Feinschliff." },
      {
        type: "ul",
        items: [
          "RSVPs verfolgen",
          "Gästeliste aktualisieren",
          "Menüwahl einsammeln",
          "Details mit den Dienstleistern festzurren",
          "erster Entwurf der Tischordnung",
          "Drucksachen gestalten",
        ],
      },
      {
        type: "p",
        text: "Wenn alles weiter in verstreuten Tabellen liegt, fällt leicht ein Detail hinten runter. Viel ruhiger wird es, wenn ihr beide auf dieselbe Liste schaut.",
      },
      { type: "h2", text: "1 Monat vorher" },
      { type: "p", text: "Die Phase des Festzurrens." },
      {
        type: "ul",
        items: [
          "endgültige Personenzahl durchgeben",
          "Tischordnung schließen",
          "Tischnummern und Platzkarten drucken",
          "Ablaufplan für die Dienstleister",
          "Zahlungsfristen prüfen",
          "Zeitplan für den Tag bauen",
        ],
      },
      {
        type: "p",
        text: "Weniger neue Ideen, mehr davon, dass wirklich alle, ihr beide, eure Eltern, eure Dienstleister, dasselbe wissen.",
      },
      { type: "h2", text: "1 Woche vorher" },
      { type: "p", text: "Es bleibt nur noch Feinjustierung." },
      {
        type: "ul",
        items: [
          "letzte Änderungen bei den Gästen einarbeiten",
          "Drucksachen durchsehen",
          "Bestätigungen der Dienstleister",
          "Notfallkoffer packen",
          "ausruhen",
        ],
      },
      {
        type: "p",
        text: "Ja, Ausruhen steht auf der Liste. Eine Hochzeit ist kein Projektabschluss, sondern ein Tag, den man erleben muss.",
      },
      { type: "h2", text: "Fazit" },
      {
        type: "p",
        text: "Planung wird in dem Moment machbar, in dem ihr aufhört, alles gleichzeitig lösen zu wollen. Eine gemeinsame Checkliste, eine Gästeliste, die aktuell bleibt, ein Budget, das sich mitbewegt, und ein Ort, auf den ihr beide schaut. Mehr braucht es nicht.",
      },
      {
        type: "cta",
        lead: "Weddly hält Budget, Gästeliste, RSVPs und Tischordnung zusammen, damit ihr nicht aus voneinander getrennten Tabellen heraus planen müsst.",
        href: "/signup",
        label: "Jetzt loslegen",
      },
      { type: "h2", text: "Häufige Fragen" },
      { type: "h3", text: "Wann sollten wir mit der Hochzeitsplanung anfangen?" },
      {
        type: "p",
        text: "Idealerweise 9 bis 12 Monate vorher. Kleinere Hochzeiten lassen sich schneller planen.",
      },
      { type: "h3", text: "Wann sollten die Einladungen raus?" },
      {
        type: "p",
        text: "Meist 3 bis 6 Monate vor der Hochzeit, je nachdem, wie viele Gäste anreisen.",
      },
      { type: "h3", text: "Wann sollte die Tischordnung endgültig sein?" },
      {
        type: "p",
        text: "Nach den letzten Zusagen, typischerweise 2 bis 4 Wochen vor der Hochzeit.",
      },
    ],
  },
  "eskuvoi-koltsegvetes-keszitese": {
    category: "Budget",
    title: "Ein Hochzeitsbudget aufstellen, das nicht aus dem Ruder läuft",
    lead: "Wie ihr die Gesamtsumme festlegt, mit der Gästezahl rechnet und leises Mehrausgeben vermeidet.",
    seo_title: "Hochzeitsbudget aufstellen · Weddly",
    seo_description:
      "Praktischer Leitfaden fürs Hochzeitsbudget: Gesamtsumme festlegen, nach Kategorien aufteilen, mit der Gästezahl rechnen und stilles Überziehen vermeiden.",
    body: [
      {
        type: "p",
        text: "Das Schwierigste an der Hochzeitsplanung ist nicht, zu entscheiden, was ihr wollt. Es ist, das im Budget zu halten. Location, Catering, Deko, Kleidung, Foto, Musik und Papeterie wirken einzeln machbar, summieren sich aber schnell.",
      },
      {
        type: "p",
        text: "Behandelt das Budget als lebenden Plan, nicht als einmalig ausgefüllte Tabelle. Wenn sich Gästezahl, Menü oder Locationpreis ändern, muss das ganze Budget nachziehen.",
      },
      { type: "h2", text: "1. Fangt mit der Gesamtsumme an" },
      {
        type: "p",
        text: "Fangt nicht mit Kategorien an. Einigt euch zuerst auf den Gesamtbetrag, den ihr guten Gewissens für die Hochzeit ausgeben könnt.",
      },
      { type: "p", text: "Teilt ihn dann auf die wichtigsten Kategorien auf:" },
      {
        type: "ul",
        items: [
          "Location",
          "Catering und Getränke",
          "Foto und Video",
          "Deko",
          "Kleidung",
          "Musik",
          "Einladungen und Papeterie",
          "Reserve",
        ],
      },
      {
        type: "p",
        text: "Lasst die Reserve nicht weg. Fast jede Hochzeit sammelt einen Posten ein, der auf der ersten Liste nicht stand.",
      },
      { type: "h2", text: "2. Die Gästezahl bewegt alles" },
      {
        type: "p",
        text: "Die Gästezahl ändert nicht nur die Catering-Zeile. Sie bewegt Getränke, Tischzahl, Sitzplan, Papeterie, Gastgeschenke und oft auch den Mindestumsatz der Location.",
      },
      { type: "p", text: "„Ungefähr 90 Gäste” reicht nicht. Rechnet mehrere Szenarien durch:" },
      { type: "ul", items: ["klein: 50 Gäste", "mittel: 80 Gäste", "groß: 120 Gäste"] },
      { type: "p", text: "Es zeigt sich schnell, welches Szenario wirklich in die Summe passt." },
      { type: "h2", text: "3. Schaut nicht nur auf die Endsumme" },
      {
        type: "p",
        text: "Es ist verlockend, nur die Endsumme im Blick zu haben. Viel hilfreicher ist es, Kategorie für Kategorie zu sehen, wo ihr leise darüber geraten seid.",
      },
      {
        type: "p",
        text: "Vielleicht steht ihr insgesamt gut da, während die Deko längst einen Teil des Fotobudgets aufgefressen hat. Das früh zu merken ist besser, als in den letzten Wochen zu improvisieren.",
      },
      { type: "h2", text: "4. Das Budget muss gemeinsam sein" },
      {
        type: "p",
        text: "Wenn eine Person die Tabelle pflegt und die andere alte Zahlen liest, sind Missverständnisse programmiert. Gemeinsam planen heißt: ein gemeinsames, immer aktuelles Budget.",
      },
      {
        type: "p",
        text: "Es hilft sehr, wenn Budget, Gästeliste und Tischordnung in einem Arbeitsbereich liegen, damit eine geänderte Gästezahl nicht bedeutet, die Folgen in drei Dateien nachzuziehen. (Genau deshalb haben wir Weddly so gebaut.)",
      },
      { type: "h2", text: "Kurze Checkliste" },
      {
        type: "ul",
        items: [
          "Erst die Gesamtsumme vereinbaren.",
          "Nach Kategorien aufschlüsseln.",
          "Mehrere Gästezahl-Szenarien durchrechnen.",
          "Eine Reserve zurücklegen.",
          "Beide lesen dieselbe lebende Fassung.",
        ],
      },
      {
        type: "cta",
        lead: "Ihr wollt ein transparenteres Hochzeitsbudget? In Weddly liegen Budget, Gästeliste, RSVP und Tischordnung in einem gemeinsamen Arbeitsbereich.",
        href: "/signup",
        label: "Jetzt loslegen",
      },
    ],
  },
  "digitalis-eskuvoi-meghivo-vagy-papir-meghivo": {
    category: "Einladungen",
    title: "Digitale oder gedruckte Hochzeitseinladungen: Was solltet ihr wählen?",
    lead: "Vorteile, Nachteile, Kosten und wie sich beide auf das RSVP auswirken.",
    seo_title: "Digitale oder gedruckte Hochzeitseinladungen · Weddly",
    seo_description:
      "Digitale und gedruckte Hochzeitseinladungen im Vergleich: Vorteile, Nachteile, Kosten und wie sich beide mit dem RSVP verbinden.",
    body: [
      {
        type: "p",
        text: "Die Einladung ist das Erste, was eure Gäste sehen. Sie setzt den Ton und trägt die wichtigsten Informationen. Heute lautet die Frage nicht nur, welches Papier, sondern ob ihr überhaupt Papier braucht.",
      },
      {
        type: "p",
        text: "Digital und gedruckt sind keine Gegensätze. Für viele Paare funktioniert die Kombination am besten.",
      },
      { type: "h2", text: "Gedruckte Einladungen: wann sie glänzen" },
      {
        type: "p",
        text: "Papier wirkt persönlich, elegant und ist etwas zum Anfassen. Es passt, wenn euch das klassische Erlebnis wichtig ist oder viele Gäste die traditionelle Form bevorzugen.",
      },
      { type: "p", text: "Dafür:" },
      {
        type: "ul",
        items: [
          "wird zum Andenken",
          "elegant und förmlich",
          "passt zu einem klassischen Stil",
          "wirkt persönlicher",
        ],
      },
      { type: "p", text: "Dagegen:" },
      {
        type: "ul",
        items: [
          "teurer",
          "Vorlauf für Druck und Post",
          "schwer zu ändern, wenn sich Details verschieben",
          "das RSVP muss separat laufen",
        ],
      },
      { type: "h2", text: "Digitale Einladungen: wann sie praktischer sind" },
      {
        type: "p",
        text: "Digital ist schnell, leicht zu korrigieren, und die Antwort liegt direkt daneben. Wenn sich Datum, Location oder Menü ändern, muss nichts nachgedruckt werden: eine Änderung, und alle sehen die neue Fassung.",
      },
      { type: "p", text: "Dafür:" },
      {
        type: "ul",
        items: [
          "schnell verschickt",
          "öffnet sich gut am Handy",
          "hängt am RSVP",
          "jederzeit änderbar",
          "günstiger",
        ],
      },
      { type: "p", text: "Dagegen:" },
      {
        type: "ul",
        items: [
          "kann weniger förmlich wirken",
          "nicht jeder Gast mag es",
          "geht im Chatverlauf leicht unter",
        ],
      },
      { type: "h2", text: "Die Mischung gewinnt oft" },
      {
        type: "p",
        text: "Viele Paare schicken der engsten Familie und ein paar besonderen Gästen Papier, während alle anderen eine digitale Einladung oder einen RSVP-Link bekommen.",
      },
      {
        type: "p",
        text: "Praktisch, wenn ihr das schöne Einladungserlebnis wollt, ohne jede Antwort von Hand nachzuhalten.",
      },
      { type: "h2", text: "Was in eine digitale Einladung gehört" },
      {
        type: "p",
        text: "Eine gute digitale Einladung ist schön und nützlich zugleich. Nehmt auf:",
      },
      {
        type: "ul",
        items: [
          "eure Namen",
          "das Datum",
          "Location und Adresse",
          "den Ablauf",
          "den Dresscode (falls es einen gibt)",
          "die RSVP-Frist",
          "Fragen zu Menü und Ernährung",
          "eine Kontaktmöglichkeit",
        ],
      },
      { type: "p", text: "Das Wichtigste: Der Gast kann schnell antworten." },
      { type: "h2", text: "Wo das RSVP hineinpasst" },
      {
        type: "p",
        text: "Der echte Vorteil des Digitalen: Die Antwort sitzt direkt neben der Einladung. Keine getrennten Nachrichten, keine Anrufe, keine Tabelle, die am Leben gehalten werden muss.",
      },
      {
        type: "p",
        text: "Der Gast öffnet den Link, beantwortet ein paar Fragen, und ihr seht schon, wer kommt und wer nicht.",
      },
      { type: "h2", text: "Schnelle Entscheidungshilfe" },
      { type: "h3", text: "Nehmt Papier, wenn…" },
      {
        type: "ul",
        items: [
          "ihr das klassische Erlebnis wollt",
          "ihr viele ältere Gäste habt",
          "ihr ein Andenken zum Anfassen wollt",
        ],
      },
      { type: "h3", text: "Nehmt Digital, wenn…" },
      {
        type: "ul",
        items: [
          "ihr es schnell und praktisch wollt",
          "ihr viele Angaben einsammeln müsst",
          "euch ein automatisches RSVP wichtig ist",
          "ihr Kosten senken wollt",
        ],
      },
      { type: "h3", text: "Nehmt beides, wenn…" },
      {
        type: "ul",
        items: [
          "ihr Schönheit und Bequemlichkeit wollt",
          "Papier für die Familie, digital für alle anderen",
          "ihr das Andenken wollt, ohne das RSVP von Hand zu führen",
        ],
      },
      {
        type: "cta",
        lead: "Mit Weddly antwortet jeder Gast über seinen eigenen RSVP-Link, und ihr seht jede Antwort, Begleitung, Menüwahl und Notiz an einem Ort.",
        href: "/signup",
        label: "Ausprobieren",
      },
      { type: "h2", text: "Häufige Fragen" },
      { type: "h3", text: "Reicht eine rein digitale Einladung?" },
      {
        type: "p",
        text: "Ja, solange eure Gästeliste damit zurechtkommt und alle wichtigen Angaben leicht zu finden sind.",
      },
      { type: "h3", text: "Brauchen wir trotzdem eine gedruckte Einladung?" },
      {
        type: "p",
        text: "Nötig ist sie nicht, aber sie ist eine schöne Geste für die Familie und für alle, denen die traditionelle Form etwas bedeutet.",
      },
      { type: "h3", text: "Was ist der wichtigste Inhalt?" },
      {
        type: "p",
        text: "Datum, Location, Uhrzeit, RSVP-Frist und alles andere, was dem Gast bei der Entscheidung hilft.",
      },
    ],
  },
};
