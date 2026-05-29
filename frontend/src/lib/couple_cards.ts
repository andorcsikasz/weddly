// 100 questions for engaged couples, organised into 4 decks of 25.
// Pure static data, no backend, no auth. Rendered by CoupleCardsPage.tsx
// as a one-card-at-a-time conversation tool on /eszkozok/100-kerdes-eskuvo-elott
// (HU) and /tools/100-questions-before-marriage (EN).
//
// Each deck is independent: deck order is fixed in this array, but card
// order within a deck is randomised on first open and cached in
// localStorage so a returning visitor doesn't get the same shuffle twice
// in a session.

export type DeckId = "roots" | "everyday" | "closeness" | "deepwater";

export interface Deck {
  id: DeckId;
  /** Locale-keyed UI labels live in tools.couple_cards.*: these are the
   *  card-content strings the deck name short label maps to via t().
   *  We keep the actual titles in locales/{hu,en}.ts so the deck picker
   *  reads the same translation memory as the rest of the page. */
  titleKey: string;
  blurbKey: string;
  questionsHu: readonly string[];
  questionsEn: readonly string[];
}

const ROOTS_HU: readonly string[] = [
  "Milyen mondat ismétlődött a családodban a pénzről, amit ma is hallasz a fejedben?",
  "Mit csinált apád, amikor anyád sírt? És anyád, amikor apád?",
  "Kit szerettek nálatok feltétel nélkül, és kinek kellett kiérdemelnie?",
  "Milyen érzelmet nem volt szabad kimutatni nálatok?",
  "Mit örököltél anyádtól, amit nem akarsz továbbadni?",
  "Mit örököltél apádtól, amit nem akarsz továbbadni?",
  "Hogyan kértek nálatok bocsánatot, ha egyáltalán?",
  "Milyen veszekedési mintát hoztál magaddal, amin dolgoznod kell?",
  "Volt-e válás a családodban, és hogyan formált?",
  "Volt-e olyan pillanat a családodban, amikor valaki érzelmileg eltűnt mellőled, és te egyedül maradtál a szobában?",
  "Volt a családodban olyan rokon, akinek a házassága titokban szétment, de kifelé úgy tett, mintha rendben lenne?",
  "Mit hallottál otthon a férfiakról és a nőkről?",
  "Ki halt meg először a családodban úgy, hogy emlékszel rá, és kitől tanultad meg, hogyan kell gyászolni?",
  "Hogyan ünnepelték nálatok a sikert, és hogyan kezelték a kudarcot?",
  "Milyen családi titokról tudsz, amiről nem szabadna?",
  "Volt-e olyan rokon, akinek a halála megváltoztatta a családodat?",
  "Milyen szülő volt a tied, és milyen szülő akarsz lenni?",
  "Hogyan szólítod a szüleidet, és miért pont úgy?",
  "Milyen ünnepi asztalnál nőttél fel: csendben, kiabálva, imával, tévé előtt?",
  "Kire haragszol még mindig a családodból, anélkül, hogy bevallanád?",
  "Mi az a gyerekkori szégyened, amit a testedben még ma is érzel valahol?",
  "Hogyan szeretnél emlékezni anyádra, amikor már nem lesz?",
  "Karácsonykor melyik családnál ülünk majd? És a másik családnak mit mondunk?",
  "Mit kérnél a szüleidtől, amit eddig nem mertél?",
  "Ha húsz év múlva megkérdezné a gyerekünk, miért választottátok egymást ennyire különböző létetekre, mit válaszolnál?",
];

const ROOTS_EN: readonly string[] = [
  "What sentence about money kept repeating in your family that you still hear in your head today?",
  "What did your father do when your mother cried? And the other way around?",
  "Who was loved unconditionally in your family, and who had to earn it?",
  "What emotion was forbidden in your home?",
  "What did you inherit from your mother that you don't want to pass on?",
  "What did you inherit from your father that you don't want to pass on?",
  "How did people apologise in your family, if at all?",
  "What argument pattern did you carry into adulthood that you need to work on?",
  "Was there a divorce in your family, and how did it shape you?",
  "Was there a moment in your family when someone emotionally checked out on you, and you were left alone in the room?",
  "Was there a relative whose marriage quietly fell apart while they kept up appearances?",
  "What did you grow up hearing about my gender in general?",
  "Who was the first person in your family to die that you remember, and who taught you how you're supposed to grieve?",
  "How was success celebrated at home, and how was failure handled?",
  "What family secret do you know that you weren't supposed to?",
  "Was there a relative whose death rearranged your family?",
  "What kind of parent was yours, and what kind do you want to be?",
  "How do you address my parents, and why exactly that way?",
  "What kind of holiday table did you grow up at: silent, shouting, prayerful, TV on?",
  "Who in your family are you still angry with, without admitting it?",
  "What's a childhood shame you still feel somewhere in your body today?",
  "How do you want to remember your mother once she's gone?",
  "Whose family do we sit with on Christmas? And what do we say to the one who gets left out?",
  "What would you ask of our parents that you've never dared to?",
  "If our child asked us twenty years from now why we chose each other, as different as we are, what would you answer?",
];

const EVERYDAY_HU: readonly string[] = [
  "Mennyit költhetek el havonta kérdés nélkül?",
  "Tudod, mennyit keresek nettó? És fordítva, te tudod?",
  "Közös kassza, külön kassza, vagy a kettő keveréke? Miért pont az?",
  "Mi az utolsó vásárlás, amit megbántál?",
  "Adósságot vinnél a házasságba, amit még nem mondtál el?",
  "Mit szólnál, ha többet keresnék, mint te? És fordítva?",
  "Mennyi megtakarítás az, amitől nyugodtan alszol?",
  "Mit szólnál, ha az egyik szülő anyagilag besegítene a lakásba?",
  "Ki dönt arról, hol töltjük a karácsonyt?",
  "Mennyi időt töltsünk a saját szüleinkkel? És mennyi az, ami már sok?",
  "Mit szabad az anyádnak, és mit nem?",
  "Hány gyereket szeretnél, és mi lesz, ha nem sikerül?",
  "Gyerek után ki marad otthon, és meddig?",
  "Hol fogunk lakni öt év múlva, ha őszinte vagy?",
  "Külföldre költöznél a karrierem miatt? És én a tied miatt?",
  "Mit teszünk, ha az egyikünk elveszti a munkáját egy évre?",
  "Ki megy bevásárolni, ki főz, ki viszi orvoshoz a szüleinket, ha kell?",
  "Mekkora rendetlenségtől leszel már fizikailag rosszul?",
  "Volt-e olyan vásárlásod az elmúlt évben, amit nem mutattál meg nekem? Mit védtél vele?",
  "Van olyan számlád, kártyád, megtakarításod, amiről nem tudok? Mi tartott vissza attól, hogy elmondd?",
  "Melyik álmodat tetted már félre szó nélkül a közös életünk kedvéért?",
  "Melyik barátomat nem bírod, és miért nem mondtad eddig?",
  "Mit tennénk, ha váratlanul örökölnénk egy nagyobb összeget?",
  "Ha jövőre nagy szakmai lehetőség jönne egy másik városban, ki az, aki halkan félreáll, és miért épp ő?",
  "Mit szólnál, ha egy évre fizetés nélküli szabadságra menne valamelyikünk?",
];

const EVERYDAY_EN: readonly string[] = [
  "What's the monthly amount I can spend without asking?",
  "Do you know my exact take-home salary? Do I know yours?",
  "Joint account, separate accounts, or a mix of both? Why exactly that?",
  "What's the last purchase you regretted?",
  "Are you bringing any debt into the marriage you haven't told me about yet?",
  "How would you feel if I earned more than you? And the other way around?",
  "How much savings is the number that lets you sleep at night?",
  "How would you feel if one of our parents chipped in financially for the flat?",
  "Who decides where we spend Christmas?",
  "How much time do we spend with our own parents? How much is too much?",
  "What is my mother-in-law allowed to do, and what isn't she?",
  "How many children do you want, and what if they don't come?",
  "After the baby, who stays home, and for how long?",
  "Where will we live five years from now, if you're honest?",
  "Would you move abroad for my career? Would I move for yours?",
  "What do we do if one of us loses their job for a year?",
  "Who shops, who cooks, who takes a sick parent to the doctor?",
  "How much mess physically gets to you?",
  "Was there a purchase last year you didn't show me? What were you protecting with it?",
  "Is there an account, card, or savings I don't know about? What kept you from telling me?",
  "Which dream of yours have you already set aside for our shared life, without ever mentioning it?",
  "Which of my friends do you not like, and why haven't you said until now?",
  "What would we do if we suddenly inherited a sizable sum?",
  "If a big career opportunity came up in another city next year, who would quietly step aside, and why that one?",
  "How would you feel if one of us took a year of unpaid leave?",
];

const CLOSENESS_HU: readonly string[] = [
  "Mikor jöttél rá, hogy nem csak szerelmes vagy belém, hanem választasz is?",
  "Mi az a privát viccünk, amit nem mernél elmagyarázni senkinek, mert úgyse értenék?",
  "Melyik közös pillanatunkon nevetsz még most is egyedül, vezetés közben vagy zuhany alatt?",
  "Mi az a furcsaságom, amit más bizarrnak tartana, de neked már a kedvenced lett?",
  "Milyen apró mozdulatomat tanultad el rólam, anélkül hogy észrevetted volna?",
  "Mit jelent neked, ha leülök melléd a konyhában, és csak hallgatok?",
  "Van olyan csendünk, amiben otthon érzed magad, és van, ami feszít? Hol a kettő közti határ?",
  "Miről veszed észre, hogy baj van velem, amikor még én sem mondtam ki magamnak?",
  "Mit jelent neked az otthon szó: egy hely, egy ember, vagy a vasárnapi ebéd illata?",
  "Mikor érezted utoljára, hogy egy mozdulatommal hazaértél?",
  "Mit jelent neked pontosan a hűség, és hol van nálad a határ? A gondolat, a beszélgetés, az érintés, vagy a tett?",
  "Mit kezdünk azzal, ha hosszabb időre eltér a vágyunk: egyikünk többet szeretne, a másik kevesebbet?",
  "Mit szeretnél, ha kérdeznék tőled, de sosem teszem?",
  "Mit szeretnél, hogy észrevegyek rajtad, amit eddig nem mertél kimondani?",
  "Ha egyikünk visszahúzódik a közelségből, azt elutasításként éled meg, vagy először inkább azt nézed, mi van mögötte?",
  "Melyik gyerekkori történetedet mondanád el ma este vacsora után, amit eddig magadnak tartottál?",
  "Mi az a vád, amit kimondtál rám dühödben, és utólag tudtad, hogy nem rólam szólt?",
  "Mi az első mondat, amit egy veszekedés után szeretnél hallani tőlem?",
  "Mit szeretnél, hogy tegyek, ha sírsz és nem szólalsz meg: üljek melléd, fogjam meg a kezed, vagy hagyjalak?",
  "Mi az, amit szavakban már megbocsátottál, de néha mégis odanyúl, mint egy régi forradás?",
  "Mi az a kérdés, amit félek tőled kérdezni, mert nem tudom, mit kezdenék a válasszal?",
  "Melyik részedet érzed úgy, hogy még tíz év múlva sem fogom igazán ismerni?",
  "Mit kezdtél el másképp csinálni miattam, anélkül, hogy valaha kértem volna?",
  "Honnan fogjuk tudni, hogy baj van köztünk az ágyban, mielőtt valamelyikünk máshol keresné a megoldást?",
  "Mi az kettőnk között, amit szeretnél, hogy akkor is megmaradjon, ha minden más kifordul a helyéből körülöttünk?",
];

const CLOSENESS_EN: readonly string[] = [
  "When did you realise you weren't just in love with me, you were choosing me?",
  "What's our private joke that you wouldn't dare explain to anyone, because they wouldn't get it anyway?",
  "Which shared moment of ours still makes you laugh on your own, driving or in the shower?",
  "What's a quirk of mine others would find bizarre, but you've grown to love?",
  "Which small gesture of mine have you picked up without noticing?",
  "What does it mean to you when I sit down next to you in the kitchen and just stay quiet?",
  "Is there a silence between us that feels like home, and one that tightens? Where's the line?",
  "How do you sense something's wrong with me before I've even named it to myself?",
  "What does the word 'home' mean to you: a place, a person, or the smell of Sunday lunch?",
  "When was the last time a single gesture of mine made you feel you'd come home?",
  "What does faithfulness mean to you exactly, and where do you draw the line? The thought, the conversation, the touch, or the act itself?",
  "What do we do if our levels of desire diverge for a while: one of us wants more, the other less?",
  "What's a question you wish I'd ask you, but I never do?",
  "What's something you wish I'd notice about you that you haven't dared say out loud?",
  "If one of us withdraws from intimacy, do you read it as rejection, or do you look first for what's behind it?",
  "Which childhood story of yours would you tell me tonight over dinner, one you've kept to yourself?",
  "What's an accusation you threw at me in anger that you later knew wasn't really about me?",
  "What's the first sentence you want to hear from me after a fight?",
  "What do you want me to do when you're crying and won't speak: sit beside you, hold your hand, or leave you be?",
  "What have you forgiven me for in words, but it still reaches back sometimes like an old scar?",
  "What's a question I'm afraid to ask you, because I don't know what I'd do with the answer?",
  "Which part of you do you feel I still won't really know, even ten years from now?",
  "What did you start doing differently because of me, without me ever asking?",
  "How will we know there's something wrong between us in bed, before one of us starts looking for an answer elsewhere?",
  "What's the thing between us you'd want to last, even if everything else around us turned upside down?",
];

const DEEPWATER_HU: readonly string[] = [
  "Mi az a sebed, amiről úgy érzed, soha nem fogom igazán érteni?",
  "Mit tegyek, ha depresszióba esel? Konkrétan, az első héten.",
  "Mit szeretnél, hogy mondjanak rólad, amikor te már nem hallod?",
  "Mit jelent neked a szent ma?",
  "Hiszel-e valamiben, amit nem tudsz bizonyítani?",
  "Mi az, amit megbocsátanál, és mi az, amit biztosan nem?",
  "Mit jelentene neked, ha sokáig nem tudnánk gyereket vállalni?",
  "Mit teszel, ha az egyikünk súlyosan megbetegszik harmincévesen?",
  "Hogyan gyászolsz? Honnan tudjam, mit kérsz tőlem, amikor benne vagy?",
  "Mit teszel, ha az egyikünk megcsalja a másikat? Megbocsátható, és milyen feltételekkel?",
  "Mit szólnál ahhoz, hogy terápiára járjunk, ha megakadunk?",
  "Mi az a pont, ahol elhagynál?",
  "Van benned akár egy szemernyi kétség most, az esküvő előtt? Mondjuk ki hangosan anélkül, hogy bármit jelentene.",
  "Mitől félsz jobban: hogy rossz döntés ez, vagy hogy jó döntés, és akkor felelős vagy érte?",
  "Mi a legmélyebb kudarcod eddig, és elmondtad-e már nekem egyben, vagy mindig csak részletekben?",
  "Mit tennél az első évben, ha én megyek el előbb?",
  "Hol szeretnéd, hogy eltemessenek?",
  "Mit teszel, ha a hited megváltozik a házasság alatt, és az enyém nem?",
  "Hogyan döntsünk, ha az egyik szülőnket otthonba kell helyezni?",
  "Mit teszel, ha a gyerekünk olyan döntést hoz, amivel mélyen nem értesz egyet?",
  "Volt olyan pillanat köztünk, amit máig nem rendeztünk le belül?",
  "Mikor érzed magad a legkevésbé egyedül velem?",
  "Mit nem mertél megkérdezni a szüleidtől, amíg éltek, és most már nem tudod megkérdezni senkitől?",
  "Mit ígérnél most, amit harminc év múlva is be akarsz tartani?",
  "Miért én? Most, harminc év múlva, és minden nehéz évben kettő között: miért én?",
];

const DEEPWATER_EN: readonly string[] = [
  "What's the wound of yours you feel I'll never truly understand?",
  "What should I do if you fall into depression? Specifically, in the first week.",
  "What would you want me to say about you at your funeral?",
  "What does sacred mean to you today?",
  "Do you believe in something you cannot prove?",
  "What could you forgive, and what could you never?",
  "What would it mean to you if we couldn't have children for a long time?",
  "What do you do if one of us falls seriously ill at thirty?",
  "How do you grieve? How will I know what you need from me when you do?",
  "What do you do if one of us cheats? Is it forgivable, and on what terms?",
  "How would you feel about going to therapy if we got stuck?",
  "What is the line past which you would leave me?",
  "Is there even a sliver of doubt in you right now, this close to the wedding? Let's say it out loud, without it having to mean anything.",
  "Which scares you more: that this is the wrong choice, or that it's the right one and now you're responsible for it?",
  "What's your deepest failure so far, and have you ever told me the whole of it, or only in pieces?",
  "What would you do in the first year if I went first?",
  "Where would you like us to bury you?",
  "What do you do if your faith changes during the marriage and mine does not?",
  "How do we decide if one of our parents needs to go into care?",
  "What do you do if our child makes a choice you deeply disagree with?",
  "Has there been a moment between us you still haven't settled inside?",
  "When do you feel the least alone while being with me?",
  "What didn't you dare ask your parents while they were alive, and now there's no one left to ask?",
  "What would you promise now that you still want to keep thirty years from now?",
  "Why me? Now, thirty years from now, and in every hard year in between: why me?",
];

export const COUPLE_CARD_DECKS: readonly Deck[] = [
  {
    id: "roots",
    titleKey: "tools.couple_cards.deck_roots_title",
    blurbKey: "tools.couple_cards.deck_roots_blurb",
    questionsHu: ROOTS_HU,
    questionsEn: ROOTS_EN,
  },
  {
    id: "everyday",
    titleKey: "tools.couple_cards.deck_everyday_title",
    blurbKey: "tools.couple_cards.deck_everyday_blurb",
    questionsHu: EVERYDAY_HU,
    questionsEn: EVERYDAY_EN,
  },
  {
    id: "closeness",
    titleKey: "tools.couple_cards.deck_closeness_title",
    blurbKey: "tools.couple_cards.deck_closeness_blurb",
    questionsHu: CLOSENESS_HU,
    questionsEn: CLOSENESS_EN,
  },
  {
    id: "deepwater",
    titleKey: "tools.couple_cards.deck_deepwater_title",
    blurbKey: "tools.couple_cards.deck_deepwater_blurb",
    questionsHu: DEEPWATER_HU,
    questionsEn: DEEPWATER_EN,
  },
];

export const DECK_SIZE = 25;
