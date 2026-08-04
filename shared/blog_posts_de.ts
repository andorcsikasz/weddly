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
  "eskuvoszervezesi-checklist-6-honapra": {
    category: "Planung",
    title: "Hochzeits-Checkliste für 6 Monate: was wann drankommt",
    lead: "Wenn bis zur Hochzeit sechs Monate bleiben: ein gestraffter Zeitplan von den großen Entscheidungen bis zur letzten Woche, damit sich am Ende nichts staut.",
    seo_title: "Hochzeits-Checkliste für 6 Monate · Weddly",
    seo_description:
      "Praktische 6-Monats-Checkliste: was sechs, vier, zwei und einen Monat vor der Hochzeit ansteht, und was in der letzten Woche.",
    body: [
      {
        type: "p",
        text: "Sechs Monate bis zur Hochzeit sind gut zu schaffen. Viele Paare haben genau so viel, und das engere Fenster macht die Planung oft konzentrierter statt ausufernder. Der Haken: Was auf einer 12-Monats-Liste eine gemütliche Entscheidung ist, wird hier dringend. Wenn die ersten Wochen gut laufen, ordnet sich der Rest meist von selbst.",
      },
      {
        type: "p",
        text: "Im Folgenden: was in welcher Phase drankommt, damit sich am Ende nichts staut.",
      },
      { type: "h2", text: "6 Monate vorher" },
      {
        type: "p",
        text: "Das sind die Entscheidungen, von denen alles andere abhängt. In einem 12-Monats-Plan würdet ihr sie über das erste Quartal verteilen, hier sollten sie in ein, zwei Wochen stehen.",
      },
      {
        type: "ul",
        items: [
          "Datum festlegen,",
          "Stil klären,",
          "Budgetobergrenze setzen,",
          "Gästezahl schätzen,",
          "Location unterschreiben,",
          "die wichtigsten Dienstleister buchen (Foto, Musik),",
          "die Eheschließung beim Standesamt anmelden.",
        ],
      },
      { type: "h3", text: "Tipp" },
      {
        type: "p",
        text: "Lasst die erste Woche nur um Location und Datum gehen. Mischt weder Kleid noch Deko noch Tischordnung hinein, solange diese beiden nicht stehen. Alles andere richtet sich danach.",
      },
      { type: "h2", text: "4 Monate vorher" },
      {
        type: "p",
        text: "Nach den großen Entscheidungen die Details, die Vorlauf und Anproben brauchen.",
      },
      {
        type: "ul",
        items: [
          "erster Entwurf der Gästeliste,",
          "Gestaltung der Einladungen,",
          "RSVP aufsetzen,",
          "erste Anproben für Kleid und Anzug,",
          "Richtung der Deko,",
          "Trauredner gebucht,",
          "Angebote für Menü und Bar angefragt.",
        ],
      },
      {
        type: "p",
        text: "Aktualisiert das Budget jetzt mit echten Angeboten statt mit Schätzungen. Meist zeigt sich hier, dass ein, zwei Posten gekürzt werden müssen.",
      },
      { type: "h2", text: "2 bis 3 Monate vorher" },
      { type: "p", text: "Rückmeldungen und Feinschliff. Aus dem Plan wird die endgültige Form." },
      {
        type: "ul",
        items: [
          "Einladungen verschickt,",
          "RSVP-Frist gesetzt (bei sechs Monaten: 4 bis 5 Wochen vor der Hochzeit),",
          "Menüwahl einsammeln,",
          "Übernachtung und Transport festzurren,",
          "erster Entwurf der Tischordnung,",
          "Drucksachen gestalten (Tischnummern, Platzkarten),",
          "Trauzeugen über ihre offiziellen Aufgaben informieren.",
        ],
      },
      { type: "h3", text: "Tipp" },
      {
        type: "p",
        text: "Schiebt die Einladung nicht auf. Bei sechs Monaten geht sie spätestens Ende des dritten Monats raus; die meisten Gäste brauchen ein paar Wochen zum Antworten.",
      },
      { type: "h2", text: "1 Monat vorher" },
      {
        type: "p",
        text: "Die Phase des Festzurrens. Weniger neue Ideen, mehr davon, dass alle denselben aktuellen Stand lesen.",
      },
      {
        type: "ul",
        items: [
          "endgültige Personenzahl durchgeben,",
          "Tischordnung schließen,",
          "Tischnummern und Platzkarten drucken,",
          "Ablaufplan mit den Dienstleistern abstimmen,",
          "Zahlungsfristen prüfen,",
          "Familie und Trauzeugen über Ankunft, Rolle und Zeiten informieren.",
        ],
      },
      { type: "h2", text: "1 Woche vorher" },
      { type: "p", text: "Es bleibt nur noch Feinjustierung." },
      {
        type: "ul",
        items: [
          "letzte Änderungen bei den Gästen einarbeiten,",
          "Drucksachen durchsehen,",
          "Bestätigungen der Dienstleister,",
          "Notfallkoffer packen,",
          "ausruhen.",
        ],
      },
      {
        type: "p",
        text: "Ja, Ausruhen steht auf der Liste. Nach sechs Monaten gestraffter Planung sollte die letzte Woche langsamer sein als die davor.",
      },
      { type: "h2", text: "Fazit" },
      {
        type: "p",
        text: "Sechs Monate reichen. Der Trick ist, die ersten zwei, drei Wochen konzentriert zu halten: Location, Datum, die wichtigsten Dienstleister. Stehen die, läuft der Rest auf einem engeren, aber immer noch lesbaren Zeitplan. Eine gemeinsame Checkliste, eine Gästeliste, die aktuell bleibt, ein Budget, das sich mitbewegt, und ein Ort, auf den ihr beide schaut. Mehr braucht es nicht.",
      },
      {
        type: "cta",
        lead: "Weddly hält Budget, Gästeliste, RSVPs und Tischordnung zusammen, damit ihr nicht aus voneinander getrennten Tabellen heraus planen müsst.",
        href: "/signup",
        label: "Jetzt loslegen",
      },
      { type: "h2", text: "Häufige Fragen" },
      { type: "h3", text: "Lässt sich eine Hochzeit in 6 Monaten planen?" },
      {
        type: "p",
        text: "Ja, wenn die ersten Wochen konzentriert sind. Die meisten Paare schaffen es in sechs Monaten, vor allem wenn die Gästezahl nicht extrem ist.",
      },
      { type: "h3", text: "Wann sollten die Einladungen bei sechs Monaten raus?" },
      {
        type: "p",
        text: "Spätestens 8 bis 12 Wochen vor der Hochzeit, damit die Gäste Zeit zum Antworten haben und ihr Zeit, die Zahl festzuzurren.",
      },
      { type: "h3", text: "Was ist in 6 Monaten schwerer zu bekommen?" },
      {
        type: "p",
        text: "Ein maßgeschneidertes Brautkleid, wenn das Atelier eine lange Warteliste hat. Gefragte Fotografinnen oder Bands, die ein Jahr im Voraus ausgebucht sind. Große internationale Hochzeiten, bei denen sonst ein Save-the-Date vor der Einladung läuft. Dafür sind 8 bis 12 Monate realistischer.",
      },
      { type: "h3", text: "Wann sollte die Tischordnung endgültig sein?" },
      {
        type: "p",
        text: "Nach den letzten Zusagen, typischerweise 2 bis 3 Wochen vor der Hochzeit.",
      },
    ],
  },
  "eskuvoi-hagyomanyok-praktikusan": {
    category: "Bräuche",
    title: "Hochzeitsbräuche, praktisch: Wer steckt den Ring an, und an welche Hand?",
    lead: "Verlobungsring, Ehering, Brauttanz, Brautstrauß: was ihr behalten, was ihr umbauen und was ihr weglassen könnt.",
    seo_title: "Hochzeitsbräuche, praktisch · Weddly",
    seo_description:
      "Verlobungsring, Ehering, Brauttanz, Brautstraußwurf: ein praktischer Durchgang durch die klassischen ungarischen Hochzeitsbräuche.",
    body: [
      {
        type: "p",
        text: "Hochzeitsbräuche sind mal wunderschön, mal verwirrend. Wer steckt den Ring zuerst an? An welcher Hand sitzt der Ehering? Was passiert während der Trauung mit dem Verlobungsring? Und muss man wirklich jeden alten Brauch mitmachen?",
      },
      {
        type: "p",
        text: "Die gute Nachricht: Hochzeitsbräuche sind heute größtenteils Angebote, keine Vorschriften. Ein praktischer Durchgang durch die häufigsten.",
      },
      { type: "h2", text: "1. Verlobungsring und Ehering" },
      {
        type: "p",
        text: "Der Verlobungsring wird meist beim Antrag überreicht, oft mit einem Stein in der Mitte, etwa einem Diamanten. Der Ehering kommt während der Trauung an den Finger und steht für das Eheversprechen.",
      },
      { type: "h3", text: "Tipp" },
      {
        type: "p",
        text: "Viele tragen nach der Hochzeit beide. Üblich ist, den Ehering zuerst anzustecken (näher am Herzen) und den Verlobungsring darüber.",
      },
      { type: "h2", text: "2. Welche Hand?" },
      {
        type: "p",
        text: "Im deutschsprachigen Raum sitzt der Ehering traditionell am rechten Ringfinger, der Verlobungsring bis zur Hochzeit am linken. In Ungarn ist es genauso. Eine harte Regel ist das nicht: Familie, Bequemlichkeit oder der eigene Geschmack entscheiden oft.",
      },
      { type: "h3", text: "Tipp" },
      {
        type: "p",
        text: "Klärt vor dem Tag, was die Braut während der Trauung mit dem Verlobungsring machen möchte. Drei übliche Wege: an der einen Hand lassen und den Ehering an die andere stecken; ihn kurz vor der Trauung wechseln; oder ihn für die Trauung abnehmen und danach neben den Ehering stecken.",
      },
      { type: "h2", text: "3. Wer steckt den Ring zuerst an?" },
      {
        type: "p",
        text: "Bei den meisten standesamtlichen und kirchlichen Trauungen steckt der Bräutigam der Braut den Ring zuerst an, danach sie ihm. Nicht überall, aber das ist die häufigste Reihenfolge.",
      },
      { type: "p", text: "Prüft vor der Trauung, dass:" },
      {
        type: "ul",
        items: [
          "die Ringe passen,",
          "jemand weiß, wer sie der Traurednerin überreicht,",
          "ein Ringkissen, eine Schachtel oder ein Schälchen bereitliegt,",
          "die Trauzeugen oder das Ringkind ihren Einsatz kennen.",
        ],
      },
      { type: "h3", text: "Tipp" },
      {
        type: "p",
        text: "Aufregung, Hitze oder Nervosität lassen Finger leicht anschwellen. Es macht nichts, wenn der Ring nicht beim ersten Versuch rutscht. Der Moment zählt, nicht die Choreografie.",
      },
      { type: "h2", text: "4. Wer hat die Ringe vor der Trauung?" },
      {
        type: "p",
        text: "Meist der Bräutigam, ein Trauzeuge, die Hochzeitsplanerin oder die Traurednerin. Entscheidet früh, und benennt eine Person, die weiß, wo die Ringe sind, sie rechtzeitig übergibt und prüft, dass beide da sind.",
      },
      { type: "h2", text: "5. Etwas Altes, Neues, Geliehenes, Blaues" },
      {
        type: "p",
        text: "Der Brauch „etwas Altes, etwas Neues, etwas Geliehenes, etwas Blaues” taucht auf vielen Hochzeiten auf. Pflicht ist er nicht, aber ein schöner symbolischer Zug.",
      },
      {
        type: "ul",
        items: [
          "alt: Familienschmuck, das Taschentuch der Großmutter,",
          "neu: Kleid, Schuhe oder Schmuck,",
          "geliehen: ein Haarschmuck von einer engen Freundin,",
          "blau: ein Strumpfband, eine Stickerei, ein Band oder ein kleiner Akzent.",
        ],
      },
      {
        type: "p",
        text: "Es muss nicht auffallen. Eine kleine blaue Naht oder ein Anhänger aus der Familie reicht vollkommen.",
      },
      { type: "h2", text: "6. Der Brauttanz" },
      {
        type: "p",
        text: "In Ungarn findet der Brauttanz (menyasszonytánc) traditionell vor Mitternacht statt: Die Gäste zahlen für einen Tanz mit der Braut. Nach Mitternacht folgt der menyecsketánc, wenn die Braut in ein zweites Kleid gewechselt hat.",
      },
      {
        type: "p",
        text: "Immer mehr Paare bauen den Brauch um: behalten, kürzen oder ganz weglassen.",
      },
      {
        type: "p",
        text: "Wenn ihr ihn behaltet, klärt vorher, wer ihn ansagt, wo der Korb steht, wie lange er dauert, welche Musik läuft und ob der Braut damit überhaupt wohl ist.",
      },
      { type: "h2", text: "7. Der Brautstraußwurf" },
      {
        type: "p",
        text: "Ein Klassiker, aber nicht für jede. Wenn die Braut ihren echten Strauß nicht werfen möchte, lässt sich ein zweiter Wurfstrauß vorbereiten.",
      },
      { type: "p", text: "Alternativen:" },
      {
        type: "ul",
        items: [
          "das Bänderspiel mit dem Strauß,",
          "ein Gruppenfoto mit den unverheirateten Gästen,",
          "den Strauß an einen bestimmten Menschen überreichen,",
          "den Wurf ganz weglassen.",
        ],
      },
      {
        type: "cta",
        lead: "Hochzeitsbräuche funktionieren am besten, wenn sie zur Geschichte des Paares passen. Behaltet, was euch etwas bedeutet, und formt den Rest so, dass er sich natürlich anfühlt.",
        href: "/signup",
        label: "In Weddly planen",
      },
      { type: "h2", text: "Häufige Fragen" },
      { type: "h3", text: "An welcher Hand sitzt der Ehering?" },
      {
        type: "p",
        text: "In Deutschland, Österreich und Ungarn traditionell am rechten Ringfinger. Der Verlobungsring sitzt oft daneben oder bleibt links.",
      },
      { type: "h3", text: "Ist der Brauttanz Pflicht?" },
      {
        type: "p",
        text: "Nein. Immer mehr Paare lassen ihn weg, kürzen ihn oder gestalten ihn um, wenn er nicht zu ihnen passt.",
      },
      { type: "h3", text: "Was bedeutet „etwas Geliehenes”?" },
      {
        type: "p",
        text: "Ein Glücksstück von einem Menschen, den ihr liebt, das nach dem Tag zurückgeht. Ein Haarschmuck, ein Schleier, ein Schmuckstück, irgendetwas Kleines.",
      },
      { type: "h3", text: "Wie viele Outfitwechsel während der Hochzeit?" },
      {
        type: "p",
        text: "So viele ihr wollt. Klassisch ist ein einziger Wechsel, aber viele Paare tragen den ganzen Abend dasselbe.",
      },
    ],
  },
  "eskuvoi-szertartas-menete": {
    category: "Trauung",
    title: "Die Trauung, Schritt für Schritt",
    lead: "Standesamtlich, kirchlich oder frei: was euch erwartet, was ihr vorher klären solltet und in welcher Reihenfolge alles läuft.",
    seo_title: "Die Trauung, Schritt für Schritt · Weddly",
    seo_description:
      "Standesamtliche, kirchliche und freie Trauungen Schritt für Schritt: Einzug, Eheversprechen, Ringtausch, Unterschrift, symbolische Elemente, Regenplan.",
    body: [
      {
        type: "p",
        text: "Die Trauung ist einer der wichtigsten Teile der Hochzeit. Hier fällt das Jawort, hier werden die Ringe getauscht, und für viele Paare ist das der Moment, in dem es endlich ankommt: Wir sind verheiratet.",
      },
      {
        type: "p",
        text: "Trotzdem haben die meisten Paare nur eine ungefähre Vorstellung davon, was passiert. Wann zieht die Braut ein? Wann kommt der Ringtausch? Wann wird unterschrieben? Und was ändert sich bei einer freien Trauung?",
      },
      { type: "h2", text: "Standesamtliche Trauung" },
      {
        type: "p",
        text: "Die standesamtliche Trauung ist der rechtlich bindende Teil. Sie wird von einer Standesbeamtin geleitet.",
      },
      {
        type: "ul",
        items: [
          "1. Die Gäste kommen an und setzen sich. Familie in die ersten Reihen.",
          "2. Das Paar zieht ein, gemeinsam, getrennt oder mit Eltern beziehungsweise Trauzeugen.",
          "3. Die Standesbeamtin begrüßt Paar und Gäste.",
          "4. Die vorgeschriebenen Fragen werden gestellt, das Paar sagt Ja.",
          "5. Persönliche Eheversprechen, Lesungen oder kurze Reden, wenn ihr sie wollt.",
          "6. Das Paar tauscht die Ringe.",
          "7. Das Paar und die Trauzeugen unterschreiben die Niederschrift.",
          "8. Das Paar geht als Eheleute hinaus: Gratulationen, Sekt, Gruppenfotos.",
        ],
      },
      { type: "h3", text: "Tipp" },
      {
        type: "p",
        text: "Standesamtliche Trauungen sind meist kürzer, als Paare erwarten. Wenn es persönlich werden soll, fragt nach eigener Musik, einer Lesung, einer persönlichen Geschichte oder euren eigenen Worten.",
      },
      { type: "h2", text: "Kirchliche Trauung" },
      {
        type: "p",
        text: "Die kirchliche Trauung findet in einem Glaubensrahmen statt, in einer Kirche oder einem anderen geweihten Raum. Der genaue Ablauf hängt von der Konfession ab, üblich sind aber:",
      },
      {
        type: "ul",
        items: [
          "Einzug,",
          "Begrüßung,",
          "Gebet oder Segen,",
          "Lesung oder Predigt,",
          "Eheversprechen,",
          "Segnung der Ringe,",
          "Ringtausch,",
          "gemeinsames Gebet,",
          "Schlusssegen,",
          "Auszug.",
        ],
      },
      { type: "p", text: "Klärt vorher mit der Gemeinde:" },
      {
        type: "ul",
        items: [
          "welche Unterlagen nötig sind,",
          "ob ein Ehevorbereitungskurs erwartet wird,",
          "ob ihr eure eigene Musik wählen dürft,",
          "wer die Kirche schmücken darf,",
          "ob Foto und Video erlaubt sind,",
          "wann Paar und Trauzeugen da sein sollen.",
        ],
      },
      { type: "h3", text: "Tipp" },
      {
        type: "p",
        text: "Bei einer kirchlichen Trauung solltet ihr Fotografin und Videograf vorher briefen. Manche Kirchen erlauben Aufnahmen nur von bestimmten Positionen.",
      },
      { type: "h2", text: "Freie oder symbolische Trauung" },
      {
        type: "p",
        text: "Eine freie Trauung ersetzt die standesamtliche Eheschließung nicht, kann aber eine sehr persönliche und flexible Form sein. Viele Paare erledigen den rechtlichen Teil separat und feiern am Hochzeitstag eine freie Zeremonie.",
      },
      { type: "p", text: "Warum Paare sie wählen:" },
      {
        type: "ul",
        items: [
          "kann draußen stattfinden,",
          "kann im Sonnenuntergang liegen,",
          "verträgt persönliche Geschichten, Humor und Emotion,",
          "hat weniger formale Vorgaben,",
          "wird auf den Stil des Paares zugeschnitten.",
        ],
      },
      { type: "p", text: "Ein typischer Ablauf:" },
      {
        type: "ul",
        items: [
          "1. Die Gäste kommen an",
          "2. Einzug",
          "3. Begrüßung durch die Rednerin",
          "4. Die Geschichte des Paares",
          "5. Eheversprechen",
          "6. Ringtausch",
          "7. Symbolisches Element",
          "8. Kuss",
          "9. Auszug",
        ],
      },
      { type: "h2", text: "Symbolische Elemente" },
      { type: "h3", text: "Sandzeremonie" },
      {
        type: "p",
        text: "Zwei verschiedenfarbige Sande werden in ein gemeinsames Gefäß gegossen, als Bild für zwei Leben, die sich verbinden.",
      },
      { type: "h3", text: "Hochzeitskerze" },
      {
        type: "p",
        text: "Zwei getrennte Kerzen entzünden eine gemeinsame Flamme. Elegant, klassisch, drinnen am schönsten.",
      },
      { type: "h3", text: "Weinzeremonie" },
      {
        type: "p",
        text: "Das Paar teilt sich ein Glas Wein, als Zeichen für die Freuden und gemeinsamen Momente des Lebens, das beginnt.",
      },
      { type: "h3", text: "Zeitkapsel" },
      {
        type: "p",
        text: "Das Paar schreibt sich Briefe, versiegelt sie in einer Kiste und öffnet sie an einem späteren Jahrestag, dem ersten, fünften oder zehnten.",
      },
      { type: "h3", text: "Tipp" },
      {
        type: "p",
        text: "Kerzen im Freien sind bei jedem Lüftchen ein Risiko. Sand, Zeitkapsel oder Wein sind draußen die sicherere Wahl.",
      },
      { type: "h2", text: "Reihenfolge beim Einzug" },
      { type: "p", text: "Eine vorgeschriebene Reihenfolge gibt es nicht, die klassische geht so:" },
      {
        type: "ul",
        items: [
          "1. die Gäste nehmen Platz,",
          "2. der Bräutigam kommt mit Trauzeuge oder einem Elternteil,",
          "3. Brautjungfern und Kinder ziehen ein,",
          "4. die Braut zieht in Begleitung ein,",
          "5. die Trauung beginnt.",
        ],
      },
      {
        type: "p",
        text: "Gemeinsam einzuziehen ist ebenso schön: modern, intim und gut geeignet für Paare, denen das klassische Übergeben der Braut nicht liegt.",
      },
      { type: "h2", text: "Musik für die Trauung" },
      { type: "p", text: "Plant Musik für diese Momente:" },
      {
        type: "ul",
        items: [
          "Ankunft der Gäste,",
          "Einzug,",
          "Unterschrift oder symbolisches Element,",
          "Auszug,",
          "Hintergrundmusik beim Gratulieren.",
        ],
      },
      { type: "h3", text: "Tipp" },
      {
        type: "p",
        text: "Wählt ein ausreichend langes Stück für den Einzug. Lieber zu viel als der wichtigste Moment, der mitten im Takt abbricht.",
      },
      { type: "h2", text: "Wann sollte die Trauung beginnen?" },
      {
        type: "p",
        text: "Die Uhrzeit zählt vor allem draußen. Eine Sommertrauung um 14 oder 15 Uhr kann gnadenlos heiß werden, erst recht ohne Schatten.",
      },
      {
        type: "p",
        text: "Der späte Nachmittag oder der frühe Abend ist im Sommer viel freundlicher: weicheres Licht für die Fotos, angenehmere Temperatur, romantischere Stimmung und weniger zusammengekniffene Augen auf den Bildern.",
      },
      { type: "h2", text: "Regenplan" },
      {
        type: "p",
        text: "Für jede Trauung im Freien braucht es einen Plan B: überdachte Terrasse, Zelt, ein Raum drinnen oder ein Speisesaal, der sich schnell umbauen lässt.",
      },
      { type: "h3", text: "Tipp" },
      {
        type: "p",
        text: "Behaltet den Regenplan nicht im Kopf. Klärt vorher, wer die Entscheidung trifft und wann, wer die Deko umstellt, wohin die Gäste gehen und wo die Technik landet.",
      },
      { type: "h2", text: "Checkliste vor der Trauung" },
      { type: "p", text: "Bevor die Türen aufgehen, sollte feststehen:" },
      {
        type: "ul",
        items: [
          "wer die Ringe hat,",
          "wer die Trauzeugen sind,",
          "wo die Eltern sitzen,",
          "die Einzugsreihenfolge,",
          "die Musikeinsätze,",
          "der Mikrofonaufbau,",
          "der Tisch zum Unterschreiben,",
          "wer die Requisiten fürs symbolische Element mitbringt,",
          "der Ablaufplan für Fotografin und Videograf,",
          "ein Glas Wasser in Reichweite des Paares.",
        ],
      },
      {
        type: "cta",
        lead: "Eine Trauung ist dann am schönsten, wenn sie nicht nur formal funktioniert, sondern nach euch klingt. Traditionelle Elemente, rechtliche Schritte und persönliche Momente passen alle zusammen.",
        href: "/signup",
        label: "In Weddly planen",
      },
      { type: "h2", text: "Häufige Fragen" },
      { type: "h3", text: "Wie lange dauert eine standesamtliche Trauung?" },
      {
        type: "p",
        text: "Meist 15 bis 30 Minuten. Die längere, persönlichere Variante kann darüber hinausgehen, wenn ihr viel Musik oder mehrere Lesungen gewählt habt.",
      },
      { type: "h3", text: "Kann die standesamtliche Trauung draußen stattfinden?" },
      {
        type: "p",
        text: "Ja, wenn das Standesamt einen Außentrauort anbietet und dort traut. Klärt das früh, nicht jedes Amt hat einen.",
      },
      { type: "h3", text: "Müssen Trauzeugen aus der Familie kommen?" },
      {
        type: "p",
        text: "Nein. In Deutschland sind Trauzeugen beim Standesamt seit 1998 sogar freiwillig, in Österreich sind zwei vorgeschrieben. Benennen könnt ihr jede volljährige, geschäftsfähige Person, meist enge Freunde oder Geschwister.",
      },
      { type: "h3", text: "Was passiert, wenn es am Tag einer Trauung im Freien regnet?" },
      {
        type: "p",
        text: "Der Regenplan greift. Klärt vorher mit der Location, wer entscheidet und wer den Umbau übernimmt.",
      },
    ],
  },
  "eskuvo-napi-checklist": {
    category: "Hochzeitstag",
    title: "Checkliste für den Hochzeitstag: was ihr nicht zu Hause lassen dürft",
    lead: "Die vollständige Liste für den Abend davor: Unterlagen, Ringe, die Taschen von Braut und Bräutigam, die Details fürs Fotoshooting, ein Notfallkoffer, die Dienstleister und die Location, alles an einem Ort.",
    seo_title: "Checkliste für den Hochzeitstag · Weddly",
    seo_description:
      "Die vollständige Hochzeitstag-Checkliste von Planerinnen und Fotografen: Unterlagen, Ringe, die Taschen der Brautleute, Notfallkoffer, Dienstleister und Location. Speichern und am Abend davor abhaken.",
    body: [
      {
        type: "p",
        text: "Euer Hochzeitstag soll nicht davon handeln, das Handy zu suchen, den Ringen hinterherzulaufen oder sich zu fragen, ob der Ausweis in der Tasche gelandet ist.",
      },
      {
        type: "p",
        text: "Hochzeiten, die gut laufen, haben nicht gemeinsam, dass alles perfekt klappt. Sie haben gemeinsam, dass das Wichtige lange vorher stand.",
      },
      {
        type: "p",
        text: "Die Liste unten sammelt die Punkte, die Planerinnen, Fotografen, Traurednerinnen und Locations vor dem großen Tag immer wieder durchgehen. Speichert sie, druckt sie aus, oder hakt sie am Abend davor ab.",
      },
      { type: "h2", text: "Die wichtigsten Unterlagen" },
      {
        type: "p",
        text: "Ohne die kann sogar die standesamtliche Trauung platzen, also packt diesen Abschnitt zuerst.",
      },
      {
        type: "ul",
        items: [
          "Personalausweis oder Reisepass (für euch beide)",
          "Meldebescheinigung, falls verlangt",
          "Reisepass bei einer Hochzeit im Ausland",
          "Die für die Eheschließung nötigen Unterlagen",
          "Bankkarte",
          "Bargeld für Kleinigkeiten und Trinkgeld",
        ],
      },
      { type: "h2", text: "Die Ringe" },
      {
        type: "p",
        text: "Auf den meisten Hochzeiten ist das das Erste, was alle suchen. Bestimmt eine Person, die bis zur Trauung dafür zuständig ist.",
      },
      {
        type: "ul",
        items: [
          "Die Eheringe",
          "Ringkissen oder Ringschachtel",
          "Eine benannte Person, die sie bis zur Trauung hat",
          "Für die Detailaufnahmen der Fotografin bereitlegen",
        ],
      },
      { type: "h2", text: "Die Tasche der Braut" },
      { type: "h3", text: "Kleidung" },
      {
        type: "ul",
        items: [
          "Brautkleid",
          "Schleier",
          "Zweites (Party-)Kleid und die passenden Accessoires",
          "Stola oder Bolero",
          "Morgenmantel fürs Getting-ready",
        ],
      },
      { type: "h3", text: "Schuhe" },
      { type: "ul", items: ["Brautschuhe", "Ersatzschuhe", "Flache Schuhe für den Abend"] },
      { type: "h3", text: "Schmuck" },
      { type: "ul", items: ["Ohrringe", "Kette", "Armband", "Haarschmuck"] },
      { type: "h3", text: "Make-up" },
      {
        type: "ul",
        items: [
          "Lippenstift",
          "Puder",
          "Make-up zum Nachlegen",
          "Make-up-Entferner",
          "Handspiegel",
        ],
      },
      { type: "h3", text: "Haare" },
      { type: "ul", items: ["Haargummis", "Haarklammern", "Haarspray", "Kamm"] },
      { type: "h2", text: "Die Tasche des Bräutigams" },
      { type: "h3", text: "Kleidung" },
      { type: "ul", items: ["Anzug", "Hemd", "Krawatte oder Fliege", "Gürtel", "Socken", "Schuhe"] },
      { type: "h3", text: "Accessoires" },
      { type: "ul", items: ["Manschettenknöpfe", "Einstecktuch", "Anstecker", "Uhr"] },
      { type: "h3", text: "Pflege" },
      { type: "ul", items: ["Deo", "Parfum", "Kamm"] },
      { type: "h2", text: "Die Details, die die Fotografin braucht" },
      {
        type: "p",
        text: "Die meisten Hochzeitsfotografen nehmen sie früh am Tag auf. Sammelt sie in einer Kiste, dann liegt alles an einer Stelle.",
      },
      {
        type: "ul",
        items: [
          "Die Einladung",
          "Eheringe und Ringschachtel",
          "Die Schuhe",
          "Parfum",
          "Schmuck",
          "Der Brautstrauß",
          "Das Heft mit den Eheversprechen",
          "Der Anstecker",
          "Ein Erbstück oder andere persönliche Dinge",
        ],
      },
      { type: "h2", text: "Der Notfallkoffer" },
      {
        type: "p",
        text: "Das ist die Tasche, die ihr hoffentlich nie öffnet. Wenn doch, sind alle froh, dass es sie gibt.",
      },
      { type: "h3", text: "Gesundheit" },
      {
        type: "ul",
        items: [
          "Pflaster",
          "Desinfektionsmittel",
          "Schmerzmittel",
          "Allergiemedikament",
          "Etwas für einen verstimmten Magen",
        ],
      },
      { type: "h3", text: "Schnelle Reparaturen" },
      {
        type: "ul",
        items: [
          "Mini-Nähset (weißes und schwarzes Garn)",
          "Sicherheitsnadeln",
          "Kleine Schere",
          "Doppelseitiges Modeklebeband und Textilkleber",
          "Farbloser Nagellack",
        ],
      },
      { type: "h3", text: "Kleinkram" },
      {
        type: "ul",
        items: [
          "Taschentücher",
          "Feuchttücher",
          "Fleckentferner-Tuch",
          "Ein Trinkhalm (damit der Lippenstift hält)",
          "Eine kleine Rolle Klebeband",
        ],
      },
      { type: "h2", text: "Elektronik" },
      {
        type: "ul",
        items: [
          "Handy",
          "Handy-Ladegerät",
          "Powerbank",
          "Ladegerät für die Smartwatch",
          "Bluetooth-Lautsprecher, falls nötig",
        ],
      },
      { type: "h2", text: "Das gehört ins Auto" },
      {
        type: "ul",
        items: [
          "Wasserflaschen",
          "Ein Riegel oder ein schneller Snack",
          "Regenschirm",
          "Sonnencreme",
          "Taschentücher",
          "Ersatzschuhe",
          "Handy-Ladegerät",
          "Bargeld",
        ],
      },
      { type: "h2", text: "Requisiten für die Trauung" },
      {
        type: "ul",
        items: [
          "Stift für die Unterschrift",
          "Die Ringe",
          "Kerzen",
          "Material für die Sand- oder Bänderzeremonie",
          "Reis oder Seifenblasen",
          "Konfetti, wenn die Location es erlaubt",
          "Sekt und Gläser",
        ],
      },
      { type: "h2", text: "Wenn ihr draußen feiert" },
      { type: "p", text: "Habt immer einen Plan B: Das Wetter ist der unberechenbarste Gast." },
      {
        type: "ul",
        items: [
          "Regenschirme",
          "Sonnenschirme",
          "Fächer für die Gäste",
          "Insektenschutz",
          "Sonnencreme",
          "Decken für den Abend",
          "Genug Wasser für alle",
        ],
      },
      { type: "h2", text: "Für eine Hochzeit mit Kindern" },
      {
        type: "ul",
        items: [
          "Malbücher und Stifte",
          "Seifenblasen",
          "Ein Gesellschaftsspiel und kleines Spielzeug",
          "Snacks für die Kinder",
          "Feuchttücher",
        ],
      },
      { type: "h2", text: "Wenn der Hund mitkommt" },
      {
        type: "ul",
        items: [
          "Leine und Halsband",
          "Napf und Wasser",
          "Leckerlis",
          "Handtuch",
          "Kotbeutel",
          "Eine benannte Person, die für den Hund zuständig ist",
        ],
      },
      { type: "h2", text: "Letzte Abstimmung mit den Dienstleistern" },
      {
        type: "p",
        text: "In den 48 Stunden vor der Hochzeit bestätigt ihr mit jedem Dienstleister die Details noch einmal.",
      },
      {
        type: "ul",
        items: [
          "Ankunftszeit",
          "Name und Telefonnummer der Ansprechperson",
          "Parken und wo abgeladen wird",
          "Zahlungsweise",
          "Zeitfenster",
          "Plan B bei schlechtem Wetter",
        ],
      },
      { type: "h2", text: "Was mit der Location zu klären ist" },
      {
        type: "ul",
        items: [
          "Ankunft von Deko, Torte und Blumen",
          "Ankunft von DJ oder Band",
          "Ankunft von Fotografin und Videograf",
          "Parkplätze für die Gäste",
          "Zimmerübergabe",
          "Mitternachtsimbiss",
          "Abbau am nächsten Tag",
        ],
      },
      { type: "h2", text: "Die Aufgaben der Trauzeugen" },
      { type: "p", text: "Wissen eure Trauzeugen genau, wofür sie zuständig sind?" },
      {
        type: "ul",
        items: [
          "Ringe und Unterlagen im Blick behalten",
          "Den Gästen helfen",
          "Die Fotos koordinieren",
          "Den Ablauf des Tages kennen",
          "Die Nummer der Traurednerin haben",
        ],
      },
      { type: "h2", text: "Die Tasche für den Tag danach" },
      {
        type: "p",
        text: "Wenn ihr im Hotel bleibt oder am nächsten Tag weiterreist, packt sie am Abend davor.",
      },
      {
        type: "ul",
        items: [
          "Bequeme Kleidung und Schlafsachen",
          "Kulturbeutel",
          "Handy-Ladegerät",
          "Medikamente",
          "Kontaktlinsen und Brille",
          "Reisepass und die Unterlagen für die Flitterwochen",
        ],
      },
      { type: "h2", text: "Die Checkliste für den Abend davor" },
      { type: "p", text: "Geht vor dem Einschlafen diese paar Punkte durch:" },
      {
        type: "ul",
        items: [
          "Jeder Dienstleister hat seine Ankunft bestätigt.",
          "Ihr habt die Wettervorhersage gelesen.",
          "Alle Handys und die Powerbank sind geladen.",
          "Die Ringe sind bei der benannten Person.",
          "Die Unterlagen liegen in der Tasche.",
          "Kleidung und Schuhe liegen bereit.",
          "Die Tasche für den Tag danach ist gepackt.",
          "Alle wichtigen Nummern sind griffbereit.",
          "Der Wecker ist gestellt.",
        ],
      },
      { type: "h2", text: "Ein paar Dinge, die Paare erst hinterher erwähnen" },
      { type: "h3", text: "Versucht nicht, alles selbst zu regeln" },
      {
        type: "p",
        text: "Es sollte an dem Tag eine benannte Person geben, eine Planerin, die Traurednerin, ein Trauzeuge oder jemand aus der Familie, an die jede Frage gehen kann. Die Gäste wissen, wen sie fragen, die Dienstleister, wen sie anrufen, und ihr müsst nicht ständig aufs Handy schauen.",
      },
      { type: "h3", text: "Lasst Luft für Verzögerungen" },
      {
        type: "p",
        text: "Eine Runde Gratulationen, ein Familienfoto oder ein kurzes Gespräch verschieben den Zeitplan mühelos. Mit 10 bis 15 Minuten Puffer zwischen den Blöcken wirkt der ganze Tag ruhiger.",
      },
      { type: "h3", text: "Esst und trinkt" },
      {
        type: "p",
        text: "Einer der häufigsten Sätze hinterher lautet, dass den Brautleuten am Abend auffiel, den ganzen Tag kaum etwas gegessen zu haben. Bittet eure Trauzeugen oder die Traurednerin, euch ab und zu an ein Glas Wasser oder ein paar Bissen zu erinnern.",
      },
      { type: "h3", text: "Verschwindet für ein paar Minuten" },
      {
        type: "p",
        text: "Vor dem Essen oder zum Sonnenuntergang: zehn Minuten weg. Kein Handy, keine Gäste. Das sind oft genau die Minuten, an die Paare sich Jahre später am liebsten erinnern.",
      },
      { type: "h2", text: "Was am meisten zählt, steht auf keiner Liste" },
      {
        type: "p",
        text: "Jemand kommt vielleicht fünf Minuten zu spät. Ein Sommerregen zieht auf. Ein Knopf geht ab, oder der Schleier verrutscht. Nichts davon ruiniert eine Hochzeit.",
      },
      {
        type: "p",
        text: "Die Gäste werden sich daran erinnern, wie es sich angefühlt hat. Wie ihr euch während der Trauung angesehen habt. Dass ihr frei lachen und feiern konntet.",
      },
      {
        type: "p",
        text: "Die schönsten Hochzeiten sind nicht makellos. Es sind die, bei denen die Planung fertig ist und das Feiern endlich anfangen darf.",
      },
      {
        type: "cta",
        lead: "Mit Weddly müsst ihr nicht in getrennten Tabellen, Notizen und Nachrichten suchen. Gästeliste, RSVPs, Budget, Tischordnung, Zeitplan für den Tag, Dienstleister und Aufgaben liegen in einem gemeinsamen Arbeitsbereich.",
        href: "/signup",
        label: "Jetzt loslegen",
      },
    ],
  },
};
