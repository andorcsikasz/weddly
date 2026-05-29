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
  "Hányadik gyerek vagy, és mennyire határoz meg?",
  "Volt a családodban olyan rokon, akinek a házassága titokban szétment, de kifelé úgy tett, mintha rendben lenne?",
  "Mit hallottál otthon a férfiakról és a nőkről?",
  "Milyen volt nálatok a csend a vacsoraasztalnál?",
  "Hogyan ünnepelték nálatok a sikert, és hogyan kezelték a kudarcot?",
  "Milyen családi titokról tudsz, amiről nem szabadna?",
  "Volt-e olyan rokon, akinek a halála megváltoztatta a családodat?",
  "Milyen szülő volt a tied, és milyen szülő akarsz lenni?",
  "Hogyan szólítod a szüleidet, és miért pont úgy?",
  "Milyen ünnepi asztalnál nőttél fel: csendben, kiabálva, imával, tévé előtt?",
  "Kire haragszol még mindig a családodból, anélkül, hogy bevallanád?",
  "Mit szeretsz a vezetéknevedben, és mit nem?",
  "Hogyan szeretnél emlékezni anyádra, amikor már nem lesz?",
  "Mit jelent neked a vasárnapi ebéd?",
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
  "Which child are you in birth order, and how much does it define you?",
  "Was there a relative whose marriage quietly fell apart while they kept up appearances?",
  "What did you grow up hearing about my gender in general?",
  "What was silence like at your dinner table?",
  "How was success celebrated at home, and how was failure handled?",
  "What family secret do you know that you weren't supposed to?",
  "Was there a relative whose death rearranged your family?",
  "What kind of parent was yours, and what kind do you want to be?",
  "How do you address my parents, and why exactly that way?",
  "What kind of holiday table did you grow up at: silent, shouting, prayerful, TV on?",
  "Who in your family are you still angry with, without admitting it?",
  "What do you love about your last name, and what don't you?",
  "How do you want to remember your mother once she's gone?",
  "What does Sunday lunch mean to you?",
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
  "Hány estét tölthetek havonta a barátaimmal?",
  "Mit posztolhatok rólunk anélkül, hogy megkérdeznélek?",
  "Van olyan exem, akit követek, és zavar téged?",
  "Melyik barátomat nem bírod, és miért nem mondtad eddig?",
  "Mit tennénk, ha váratlanul örökölnénk egy nagyobb összeget?",
  "Mi az a luxus, amiről soha nem mondanál le?",
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
  "How many evenings a month can I spend alone with my friends?",
  "What can I post about us without asking you?",
  "Is there an ex of mine I still follow, and does it bother you?",
  "Which of my friends do you not like, and why haven't you said until now?",
  "What would we do if we suddenly inherited a sizable sum?",
  "What's the one luxury you'd never give up?",
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
  "Mit jelent neked, hogy én vagyok az az ember, akinek nem kell teljesítened?",
  "Mikor érzed magad mellettem a legbiztonságosabban?",
  "Mit szeretnél, ha kérdeznék tőled, de sosem teszem?",
  "Mit szeretnél, hogy észrevegyek rajtad, amit eddig nem mertél kimondani?",
  "Mit nem osztasz meg velem, mert félted tőle a hangulatomat?",
  "Melyik gyerekkori történetedet mondanád el ma este vacsora után, amit eddig magadnak tartottál?",
  "Mi az a vád, amit kimondtál rám dühödben, és utólag tudtad, hogy nem rólam szólt?",
  "Mi az első mondat, amit egy veszekedés után szeretnél hallani tőlem?",
  "Mit szeretnél, hogy tegyek, ha sírsz és nem szólalsz meg: üljek melléd, fogjam meg a kezed, vagy hagyjalak?",
  "Mi az, amit szavakban már megbocsátottál, de néha mégis odanyúl, mint egy régi forradás?",
  "Mi az a kérdés, amit félek tőled kérdezni, mert nem tudom, mit kezdenék a válasszal?",
  "Melyik részedet érzed úgy, hogy még tíz év múlva sem fogom igazán ismerni?",
  "Mit kezdtél el másképp csinálni miattam, anélkül, hogy valaha kértem volna?",
  "Ha az unokáink megkérdezik, mitől maradtunk egymás mellett, mit mondanál nekik legelőször?",
  "Mi az kettőnk között, amit szeretnél, hogy akkor is megmaradjon, ha minden más kifordul a helyéből körülöttünk?",
];

const CLOSENESS_EN: readonly string[] = [
  "When was the last time you felt desired in my eyes?",
  "What exactly does faithfulness mean to you? Draw the line.",
  "What does touch without sex mean to you?",
  "When did I last touch you without wanting anything in return?",
  "What do you love about your own body that I haven't noticed yet?",
  "How do you tell me when something doesn't feel right in bed?",
  "Where would you like me to touch you first tonight?",
  "What's something sexual you'd want to try but feel too shy to ask for?",
  "Which of our kisses still plays in your head?",
  "What do you look at on me when you think I don't notice?",
  "What would you whisper to me tomorrow morning if you knew no one else could hear?",
  "What do you do when we haven't made love for weeks: withdraw, ask, or sulk?",
  "What does flirting with other people mean to you?",
  "Has there been a time you said yes to sex when you wanted to say no?",
  "Where do you feel most naked without taking your clothes off?",
  "If pregnancy, illness or distance kept us from sex for a year, what would hold us together?",
  "What kind of touch would you ask me for now, if you didn't have to feel shy about it?",
  "Which moment of ours still makes you laugh on your own?",
  "What's the most embarrassing thing you know about us?",
  "What would you ask me if you knew for sure I wouldn't laugh at you?",
  "Where would we slip off to for a long weekend without telling anyone?",
  "What does nakedness mean to you beyond not wearing clothes?",
  "How do you wish to grow old next to me, if you can choose?",
  "If there were no more sex between us starting tomorrow, would you stay?",
  "What's the tenderest thing anyone has ever done for you?",
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
  "Mi maradjon meg rólunk, ha minket már elfelejtettek?",
  "Mitől lesz neked értelmes az élet, a teljesítményen túl?",
  "Mit hagynál a gyerekünkre, ami pénzben nem mérhető?",
  "Mit tennél az első évben, ha én megyek el előbb?",
  "Hol szeretnéd, hogy eltemessenek?",
  "Mit teszel, ha a hited megváltozik a házasság alatt, és az enyém nem?",
  "Hogyan döntsünk, ha az egyik szülőnket otthonba kell helyezni?",
  "Mit teszel, ha a gyerekünk olyan döntést hoz, amivel mélyen nem értesz egyet?",
  "Volt olyan pillanat köztünk, amit máig nem rendeztünk le belül?",
  "Mikor érzed magad a legkevésbé egyedül velem?",
  "Mit szeretnél, ha az unokáink tudnának rólunk?",
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
  "What should people remember about us once we've been forgotten?",
  "What does a meaningful life mean to you beyond achievement?",
  "What would you leave to our child that can't be measured in money?",
  "What would you do in the first year if I went first?",
  "Where would you like us to bury you?",
  "What do you do if your faith changes during the marriage and mine does not?",
  "How do we decide if one of our parents needs to go into care?",
  "What do you do if our child makes a choice you deeply disagree with?",
  "Has there been a moment between us you still haven't settled inside?",
  "When do you feel the least alone while being with me?",
  "What would you want our grandchildren to know about us?",
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
