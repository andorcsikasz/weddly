// 100 questions for engaged couples, organised into 4 decks of 25.
// Pure static data, no backend, no auth. Rendered by CoupleCardsPage.tsx
// as a one-card-at-a-time conversation tool on /eszkozok/100-kerdes-eskuvo-elott
// (HU) and /tools/100-questions-before-marriage (EN).
//
// Each deck is independent: deck order is fixed in this array, but card
// order within a deck is randomised on first open and cached in
// localStorage so a returning visitor doesn't get the same shuffle twice
// in a session.

export type DeckId = "firstdate" | "roots" | "everyday" | "closeness" | "deepwater" | "lemonade";

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
  "Milyen pénzzel kapcsolatos mondat ismétlődött sokat a családodban, amit ma is hallasz a fejedben?",
  "Mit csinált apád, amikor anyád sírt? És fordítva?",
  "Ki volt az, akit feltétel nélkül szerettek a családodban, és kinek kellett kiérdemelnie a szeretetet?",
  "Melyik érzelem volt tiltott nálatok otthon?",
  "Mit örököltél anyádtól, amit nem szeretnél továbbadni?",
  "Mit örököltél apádtól, amit nem szeretnél továbbadni?",
  "Hogyan kértek bocsánatot nálatok otthon, ha egyáltalán kértek?",
  "Milyen veszekedési mintát hoztál magaddal felnőttkorodra, amin még dolgoznod kell?",
  "Volt válás, különköltözés vagy kimondatlan eltávolodás a családodban? Hogyan formált ez téged?",
  "Volt valaki a családodban, aki miatt gyerekként jó volt hazamenni? Mi volt benne ilyen?",
  "Volt olyan rokonod, akinek a házassága csendben szétesett, miközben kifelé minden rendben lévőnek tűnt?",
  "Mit hallottál gyerekként arról, milyennek 'kellene lennie' egy férfinak, egy nőnek vagy egy társnak?",
  "Ki volt az első ember a családodban, akinek a halálára emlékszel, és kitől tanultad meg, hogyan 'kell' gyászolni?",
  "Hogyan ünnepelték nálatok a sikert, és hogyan kezelték a kudarcot?",
  "Milyen családi titkot tudsz, amit nem kellett volna tudnod?",
  "Volt olyan pillanat, veszteség vagy változás, ami átrendezte a családodat, még ha senki nem is nevezte így?",
  "Milyen szülőd volt, és te milyen szülő szeretnél lenni?",
  "Milyen kapcsolatot szeretnél a szüleimmel: közeli, tiszteletteljes, formális, önálló? Mi érződik természetesnek, és mi erőltetettnek?",
  "Milyen ünnepi asztal mellett nőttél fel: csendes, hangos, veszekedős, imádságos, tévézős, kaotikus, meleg?",
  "Kire haragszol még mindig a családodban, még ha ritkán vallod is be?",
  "Miről nem lehetett kérdezni nálatok otthon? Mit kérdeznél meg most, ha senki nem sértődne meg?",
  "Melyik családi vacsorára mosolyogsz még ma is visszagondolva, és miért pont arra?",
  "Hogyan döntjük el igazságosan, hol töltjük az ünnepeket, főleg ha mindkét család számít ránk?",
  "Mit kérdeznél meg a szüleinktől, amit eddig sosem mertél?",
  "Melyik gyerekkori hagyományodat hoznád át a közös életünkbe, és melyiket hagynád szándékosan magad mögött?",
];

const ROOTS_EN: readonly string[] = [
  "What sentence about money kept repeating in your family that you still hear in your head today?",
  "What did your father do when your mother cried? And the other way around?",
  "Who was loved unconditionally in your family, and who had to earn it?",
  "What emotion was forbidden in your home?",
  "What did you inherit from your mother that you do not want to pass on?",
  "What did you inherit from your father that you do not want to pass on?",
  "How did people apologise in your family, if at all?",
  "What argument pattern did you carry into adulthood that you still need to work on?",
  "Was there a divorce, separation, or quiet distance in your family, and how did it shape you?",
  "Was there someone in your family whose company made you want to come home as a child? What was it about them?",
  "Was there a relative whose marriage quietly fell apart while they kept up appearances?",
  "What did you grow up hearing about men, women, and what a partner is supposed to be?",
  "Who was the first person in your family to die that you remember, and who taught you how you are supposed to grieve?",
  "How was success celebrated at home, and how was failure handled?",
  "What family secret do you know that you were not supposed to?",
  "Was there a moment, loss, or change that rearranged your family, even if no one named it that way?",
  "What kind of parent did you have, and what kind of parent do you want to be?",
  "How do you want to relate to my parents: close, respectful, formal, independent? What feels natural, and what feels forced?",
  "What kind of holiday table did you grow up at: silent, shouting, prayerful, TV on, chaotic, warm?",
  "Who in your family are you still angry with, even if you rarely admit it?",
  "What could you not ask about at home? What would you ask now, if no one would get upset?",
  "Which family dinner do you still smile about today, and why that one?",
  "How do we decide holidays fairly, especially when both families expect us?",
  "What would you ask of our parents that you have never dared to ask?",
  "Which tradition from your childhood would you carry into our life together, and which one would you deliberately leave behind?",
];

const EVERYDAY_HU: readonly string[] = [
  "Mekkora az az összeg havonta, amit bármelyikünk szabadon elkölthet anélkül, hogy egyeztetne a másikkal?",
  "Tudod pontosan, mennyi a nettó fizetésem? Én tudom a tiédet?",
  "Közös számla, külön számlák, vagy a kettő keveréke? Miért pont így?",
  "Mi volt az utolsó vásárlásod, amit megbántál?",
  "Van bármilyen tartozás, pénzügyi kötelezettség vagy pénzzel kapcsolatos aggodalom, amit őszintén ki kellene tennünk az asztalra a házasság előtt?",
  "Mit éreznél, ha én többet keresnék nálad? És fordítva?",
  "Mekkora megtakarítás az az összeg, amitől nyugodtan alszol?",
  "Mit éreznél, ha valamelyik szülőnk anyagilag segítene minket egy otthon megteremtésében?",
  "Ki dönti el, hol élünk, és mi történik, ha mást szeretnénk?",
  "Mennyi időt töltsünk a saját szüleinkkel? Mennyi az, ami már túl sok?",
  "Mik a határaink egymás szüleivel kapcsolatban: látogatások, tanácsok, pénz, kulcsok, vélemények?",
  "Hány gyereket szeretnél, és mi van akkor, ha nem jönnek?",
  "Egy baba után ki marad otthon, és mennyi ideig?",
  "Hol fogunk élni öt év múlva, ha teljesen őszinte vagy?",
  "Elköltöznél külföldre az én karrierem miatt? Én elköltöznék a tiéd miatt?",
  "Mit teszünk, ha egyikünk egy évre elveszíti a munkáját?",
  "Ki vásárol, ki főz, ki takarít, ki intézi az időpontokat, és ki viszi orvoshoz a beteg szülőt?",
  "Mennyi rendetlenség visel meg fizikailag?",
  "Volt olyan vásárlásod, amit nehéz volt elmondanod nekem? Miért volt nehéz megosztani?",
  "Van bármilyen számla, megtakarítás, tartozás, előfizetés vagy pénzügyi szokás, amiről még nem beszéltünk teljesen nyíltan?",
  "Melyik álmodat tetted már félre a közös életünk miatt úgy, hogy még sosem mondtad ki?",
  "Van olyan barátság az életünkben, ami neked nehéz? Hogyan beszéljünk róla úgy, hogy egyikünk se védekezzen azonnal?",
  "Mit tennénk, ha hirtelen jelentős összeget örökölnénk?",
  "Mi számít magánszférának, és mi számít titkolózásnak, ha telefonokról, üzenetekről és közösségi médiáról van szó?",
  "Az életünkből mennyit vagyunk hajlandók odaadni munkára, ambícióra vagy valami nagyobb építésére?",
];

const EVERYDAY_EN: readonly string[] = [
  "What monthly amount can either of us spend freely without checking with the other?",
  "Do you know my exact take-home salary? Do I know yours?",
  "Joint account, separate accounts, or a mix of both? Why exactly that?",
  "What was the last purchase you regretted?",
  "Is there any debt, financial obligation, or money-related worry we should honestly put on the table before marriage?",
  "How would you feel if I earned more than you? And the other way around?",
  "How much savings is the number that lets you sleep at night?",
  "How would you feel if one of our parents helped us financially with a home?",
  "Who decides where we live, and what happens if our wishes are different?",
  "How much time should we spend with our own parents? How much is too much?",
  "What are our boundaries with each other's parents: visits, advice, money, keys, opinions?",
  "How many children do you want, and what if they do not come?",
  "After a baby, who stays home, and for how long?",
  "Where will we live five years from now, if you are honest?",
  "Would you move abroad for my career? Would I move for yours?",
  "What do we do if one of us loses their job for a year?",
  "Who shops, who cooks, who cleans, who books appointments, and who takes a sick parent to the doctor?",
  "How much mess physically gets to you?",
  "Has there been a purchase you felt hesitant to tell me about? What made it difficult to share?",
  "Are there any accounts, savings, debts, subscriptions, or financial habits we have not fully talked about yet?",
  "Which dream of yours have you already set aside for our shared life, without ever mentioning it?",
  "Are there any friendships in our life that feel difficult for you, and how should we talk about them without becoming defensive?",
  "What would we do if we suddenly inherited a sizable amount of money?",
  "What counts as privacy, and what counts as secrecy, when it comes to phones, messages, and social media?",
  "How much of our life are we willing to give to work, ambition, or building something bigger?",
];

const CLOSENESS_HU: readonly string[] = [
  "Mikor érezted először, hogy nemcsak szerelmes vagy belém, hanem engem választasz?",
  "Mi az a közös belső poénunk, amit senkinek nem mernél elmagyarázni, mert úgysem értené?",
  "Melyik közös pillanatunk jut néha eszedbe úgy, hogy egyedül is elmosolyodsz tőle?",
  "Mi az a furcsaságom, amit mások talán különösnek tartanának, de te megszeretted?",
  "Melyik apró mozdulatomat vagy szokásomat vetted át észrevétlenül?",
  "Mit jelent neked, amikor leülök melléd a konyhában, és csak csendben ott maradok?",
  "Van olyan csend köztünk, ami otthonos, és olyan, ami feszít? Hol van a kettő között a határ?",
  "Honnan érzed meg, hogy valami baj van velem, még mielőtt én meg tudnám nevezni?",
  "Mit jelent neked az 'otthon' szó: helyet, embert, ritmust vagy valami mást?",
  "Mi az a kis közös rituálénk, amitől egy sima hétköznap is apró ünneppé válik?",
  "Mit jelent számodra pontosan a hűség, és hol húzod meg a határt: a gondolatnál, a beszélgetésnél, az érintésnél vagy a tetténél?",
  "Mit teszünk, ha egy ideig eltér a vágyunk: egyikünk többet szeretne, a másik kevesebbet?",
  "Mi az a kérdés, amit szeretnéd, hogy feltegyek neked, de sosem teszem?",
  "Mi az, amit szeretnéd, hogy észrevegyek rajtad, de még nem merted hangosan kimondani?",
  "Ha egyikünk eltávolodik az intimitástól, elutasításként értelmezzük, vagy először megpróbáljuk megérteni, mi lehet mögötte?",
  "Melyik gyerekkori történetedet mesélnéd el ma este vacsora közben, amit eddig magadban tartottál?",
  "Mi az a vád, amit dühből hozzám vágtál, de később tudtad, hogy valójában nem rólam szólt?",
  "Mi az első mondat, amit hallani szeretnél tőlem egy veszekedés után?",
  "Mit szeretnél, mit tegyek, amikor sírsz és nem akarsz beszélni: üljek melléd, fogjam meg a kezed, kérdezzek, vagy hagyjalak békén?",
  "Mi az, amit szavakban már megbocsátottál nekem, de néha még mindig régi sebként visszatér?",
  "Mi az a kérdés, amit talán félek feltenni neked, mert nem tudom, mit kezdenék a válasszal?",
  "Melyik részedről érzed azt, hogy talán tíz év múlva sem fogom teljesen ismerni?",
  "Mit kezdtél el másképp csinálni miattam úgy, hogy én sosem kértem?",
  "Hogyan jelezzük egymásnak, ha többre vagy valami másra vágyunk az ágyban: szavakkal, érintéssel vagy más módon?",
  "Mi az, amire a mostani kettőnkből húsz év múlva is mosolyogva fogunk visszanézni?",
];

const CLOSENESS_EN: readonly string[] = [
  "When did you realise you were not just in love with me, but choosing me?",
  "What is our private joke that you would not dare explain to anyone, because they would not get it anyway?",
  "Which shared moment of ours still makes you laugh on your own, driving or in the shower?",
  "What is a quirk of mine others might find strange, but you have grown to love?",
  "Which small gesture of mine have you picked up without noticing?",
  "What does it mean to you when I sit down next to you in the kitchen and just stay quiet?",
  "Is there a silence between us that feels like home, and one that tightens? Where is the line?",
  "How do you sense something is wrong with me before I have even named it to myself?",
  "What does the word 'home' mean to you: a place, a person, a rhythm, or something else?",
  "What is a small ritual of ours that turns an ordinary weekday into a tiny celebration?",
  "What does faithfulness mean to you exactly, and where do you draw the line: the thought, the conversation, the touch, or the act itself?",
  "What do we do if our levels of desire diverge for a while: one of us wants more, the other less?",
  "What is a question you wish I would ask you, but I never do?",
  "What is something you wish I would notice about you that you have not dared say out loud?",
  "If one of us withdraws from intimacy, do you read it as rejection, or do you look first for what might be behind it?",
  "Which childhood story of yours would you tell me tonight over dinner, one you have kept to yourself until now?",
  "What is an accusation you threw at me in anger that you later knew was not really about me?",
  "What is the first sentence you want to hear from me after a fight?",
  "What do you want me to do when you are crying and will not speak: sit beside you, hold your hand, ask questions, or leave you be?",
  "What have you forgiven me for in words, but still sometimes feel like an old scar?",
  "What is a question I might be afraid to ask you, because I do not know what I would do with the answer?",
  "Which part of you do you feel I may still not fully know, even ten years from now?",
  "What did you start doing differently because of me, without me ever asking?",
  "How do we let each other know when we want more, or something different, in bed: with words, with touch, or some other way?",
  "What about us right now will we still look back on with a smile in twenty years?",
];

const DEEPWATER_HU: readonly string[] = [
  "Mi az a seb benned, amiről úgy érzed, talán sosem fogom igazán megérteni?",
  "Mit tegyek, ha depresszióba esel? Konkrétan az első héten.",
  "Mit szeretnél, hogy a gyerekeink tőled halljanak rólad először, mielőtt bárki más mesélne nekik?",
  "Mit jelent számodra ma az, hogy valami szent?",
  "Hiszel valamiben, amit nem tudsz bizonyítani?",
  "Mit tudnál megbocsátani, és mit nem tudnál soha?",
  "Mit jelentene neked, ha hosszú ideig nem lehetne gyerekünk?",
  "Mit teszünk, ha egyikünk még fiatalon súlyosan megbetegszik?",
  "Hogyan gyászolsz? Honnan fogom tudni, mire van szükséged, amikor gyászolsz?",
  "Mit teszünk, ha egyikünk megcsalná a másikat? Megbocsátható lenne, és ha igen, milyen feltételekkel?",
  "Mit éreznél azzal kapcsolatban, ha párterápiára mennénk, amikor elakadunk?",
  "Hol van az a határ, ami után elhagynál?",
  "Mi az, amit biztosan tudsz rólam, és mi az, ami még csak remény?",
  "Mi ijeszt meg jobban: hogy ez rossz döntés, vagy hogy jó döntés, és most már felelősek vagyunk érte?",
  "Mi volt eddig a legmélyebb kudarcod, és elmondtad már nekem az egészet, vagy csak részletekben?",
  "Hogyan ünnepelnénk a tizedik házassági évfordulónkat, ha most kellene megterveznünk?",
  "Min fogunk nevetni három év múlva, amikor visszagondolunk az esküvőnkre?",
  "Mit teszünk, ha a házasság alatt megváltozik a hited, az értékrended vagy a világnézeted, az enyém pedig nem?",
  "Hogyan döntjük el, ha valamelyik szülőnknek olyan gondoskodásra van szüksége, ami megváltoztatja az életünket?",
  "Mit teszünk, ha a gyerekünk olyan döntést hoz, amellyel egyikünk mélyen nem ért egyet?",
  "Volt olyan pillanat köztünk, amit még nem rendeztél el teljesen magadban?",
  "Mikor érzed magad a legkevésbé egyedül mellettem?",
  "Milyen értékekről szeretnéd, hogy az otthonunk ismert legyen, akár azok számára is, akik csak egyszer járnak nálunk?",
  "Mit ígérnél meg most, amit harminc év múlva is meg szeretnél tartani?",
  "Mit szeretnéd, hogy újra és újra elmondjak neked, még akkor is, amikor azt hiszem, már úgyis tudod?",
];

const DEEPWATER_EN: readonly string[] = [
  "What is the wound of yours you feel I may never truly understand?",
  "What should I do if you fall into depression? Specifically, in the first week.",
  "What do you want our children to hear about you from you first, before anyone else tells them?",
  "What does sacred mean to you today?",
  "Do you believe in something you cannot prove?",
  "What could you forgive, and what could you never forgive?",
  "What would it mean to you if we could not have children for a long time?",
  "What do we do if one of us becomes seriously ill while we are still young?",
  "How do you grieve? How will I know what you need from me when you do?",
  "What do we do if one of us cheats? Is it forgivable, and on what terms?",
  "How would you feel about going to therapy if we got stuck?",
  "What is the line past which you would leave me?",
  "What is something you know for sure about me, and what is still only a hope?",
  "Which scares you more: that this is the wrong choice, or that it is the right one and now you are responsible for it?",
  "What is your deepest failure so far, and have you told me the whole of it, or only in pieces?",
  "How would we celebrate our tenth anniversary if we had to plan it right now?",
  "What will we laugh about three years from now when we look back at our wedding?",
  "What do we do if your faith, values, or worldview changes during the marriage and mine does not?",
  "How do we decide if one of our parents needs care that changes our life?",
  "What do we do if our child makes a choice one of us deeply disagrees with?",
  "Has there been a moment between us you still have not fully settled inside?",
  "When do you feel the least alone while being with me?",
  "Which values do you want our home to be known for, even by people who only visit once?",
  "What would you promise now that you still want to keep thirty years from now?",
  "What do you want me to keep telling you, even when I assume you already know?",
];

const LEMONADE_HU: readonly string[] = [
  "Milyen lenne a tökéletes közös szombat reggelünk?",
  "Melyik film lenne a tökéletes bekuckózós filmünk?",
  "Melyik dalt adnánk elő hibátlanul karaokén?",
  "Melyik étel íze jelenti nekünk leginkább az otthont, amikor együtt főzzük?",
  "Ha lehetne egy közös szupererőnk, mi lenne az?",
  "Te milyen állat lennél a kapcsolatunkban, és én milyen állat lennék?",
  "Milyen lenne a tökéletes randiesténk?",
  "Melyik furcsa szokásomat szeretted meg idővel?",
  "Ha holnap mindketten szabadok lennénk, hogyan töltenénk a napot?",
  "Melyik illat juttat mindig engem eszedbe?",
  "Min nevettünk mostanában a legnagyobbat?",
  "Ha együtt mennénk jelmezbálba, minek öltöznénk?",
  "Melyik apró hétköznapi pillanatunk a legromantikusabb?",
  "Hová szöknénk el egy hétvégére, csak mi ketten?",
  "Melyik évszak illik hozzánk a legjobban?",
  "Melyik apró reggeli szokásunkat nem szeretnéd soha elveszíteni?",
  "Mi a kedvenc bekuckózós kajarendelésünk?",
  "Melyik sorozatot kezdenéd el velem újra az elejétől?",
  "Gyerekkorod melyik részét mutatnád meg nekem legszívesebben?",
  "Mi a kedvenc emléked az első közös utazásunkról?",
  "Ha lehetne egy kis közös helyünk bárhol a világon, hol lenne?",
  "Melyik közös fotónk a leginkább mi?",
  "Ha örökbe fogadnánk egy kutyát vagy macskát, hogy neveznénk el?",
  "Mi az a hülyeség, amit csak mi ketten értünk?",
  "Mi volt a legbutább vitánk, amin még mindig nevetünk?",
];

const LEMONADE_EN: readonly string[] = [
  "What would our perfect Saturday morning look like?",
  "Which film feels like the perfect cozy-night movie for us?",
  "What song would we absolutely nail at karaoke?",
  "What meal tastes most like home when we cook it together?",
  "If we could have one shared superpower, what would it be?",
  "What animal are you in this relationship, and what animal am I?",
  "What would our perfect date night look like?",
  "What quirky habit of mine did you secretly grow to love?",
  "If we both had tomorrow off, how would we spend the day?",
  "What scent always reminds you of me?",
  "What made us laugh the hardest recently?",
  "If we had to go to a costume party together, what would we dress as?",
  "What everyday moment with me feels quietly romantic?",
  "Where would we run away for a weekend, just the two of us?",
  "What season feels most like us?",
  "What little morning ritual of ours would you never want to lose?",
  "What's our ultimate comfort-food order?",
  "What series would you love for us to start from the beginning?",
  "What part of your childhood would you love to show me?",
  "What's your favourite memory from our first trip together?",
  "If we had a little place anywhere in the world, where would it be?",
  "Which photo of us feels the most like us?",
  "If we adopted a dog or a cat, what would we name them?",
  "What's the silly thing only the two of us understand?",
  "What's the dumbest argument we've ever had and still laugh about?",
];

// Hidden easter-egg deck tucked off the LEFT edge of the mini-deck row,
// the mirror of lemonade on the right. The "First Date" pack: a deep blue
// card, revealed after a left-swipe. Easy, curious openers for the very
// beginning of a relationship.
const FIRSTDATE_HU: readonly string[] = [
  "Mi az az apróság, amitől rögtön jobb kedved lesz?",
  "Felébredsz, és semmi dolgod aznap. Hogyan töltenéd a napot?",
  "Mi az, amitől egy első randin azt érzed: na, ez green flag?",
  "Mi az a komfortkaja, ami mindig jólesik, és miért pont az?",
  "Te inkább azonnal válaszolsz, átgondolod az üzeneteidet, vagy a „bocsi, elfelejtettem, hogy van telefonom” típus vagy?",
  "Ha az életed most egy film lenne, milyen zene szólna alatta?",
  "Mi az az egyszerű randiötlet, amit szerinted többen is értékelhetnének?",
  "Milyen humorral lehet téged a legkönnyebben megnevettetni?",
  "Neked milyen egy igazán kuckózós este?",
  "Mi az a teljesen random képesség vagy furán specifikus dolog, amiben meglepően jó vagy?",
  "Utazásnál inkább előre megtervezel mindent, vagy szereted, ha alakulnak a dolgok?",
  "Milyen bók esik neked igazán jól?",
  "Van olyan kis napi vagy heti szokásod, amitől jobb lesz a heted?",
  "Egy pörgős hét után hogyan töltődsz fel leginkább: egyedül, közeli barátokkal vagy valami aktív programmal?",
  "Te választasz filmet egy nyugis otthoni estére. Mit nézünk?",
  "Mi az az apró kedvesség, amit mindig észreveszel másokban?",
  "Mi az, amit gyerekként imádtál, és valahol még most is ugyanúgy szeretsz?",
  "Mit értenek félre veled kapcsolatban az emberek elsőre?",
  "Mi az az apróság, ami érezhetően jobbá tette a mindennapjaidat?",
  "Mitől lesz valaki úgy igazán sármos anélkül, hogy erőlködne?",
  "Három szóban: milyen a zenei ízlésed?",
  "Városnézés, természetközeli elvonulás, lusta otthoni hétvége vagy spontán road trip? Melyiket választanád, és miért?",
  "Milyen tulajdonságot értékelsz igazán azokban, akikkel szívesen vagy együtt?",
  "Mi az az ártalmatlan véleményed, ami mellett meglepően lelkesen tudsz érvelni?",
  "Ha lenne második randi, szerinted mi lenne egy jó közös program?",
];
const FIRSTDATE_EN: readonly string[] = [
  "What is one small thing that instantly improves your mood?",
  "You wake up with a completely free day and no responsibilities. What do you do?",
  "What is something someone can do on a first date that feels like a green flag to you?",
  "What meal feels like comfort to you, and why?",
  "Are you a fast replier, a thoughtful replier, or a “sorry, I forgot I own a phone” person?",
  "What song would play in the background of your life right now?",
  "What is a simple date idea that you think is underrated?",
  "What kind of humor gets you every time?",
  "What does a cozy evening look like for you?",
  "What is a random skill, talent, or oddly specific thing you are good at?",
  "Are you more of a planned-itinerary traveler or a “let’s see what happens” traveler?",
  "What kind of compliment actually means something to you?",
  "Do you have a daily or weekly ritual that makes life better?",
  "After a busy week, do you recharge alone, with close friends, or by doing something active?",
  "You get to choose the movie for a relaxed night in. What are we watching?",
  "What is a small act of kindness you notice in other people?",
  "What is something you loved as a kid that you still secretly love now?",
  "What do people often misunderstand about you at first?",
  "What is one small thing that made your life noticeably better?",
  "What is something charming that someone can do without trying too hard?",
  "What three words describe your music taste?",
  "City trip, nature escape, lazy home weekend, or spontaneous road trip? Choose one and explain.",
  "What is a quality you really appreciate in people you spend time with?",
  "What harmless opinion are you weirdly passionate about?",
  "After tonight, what would be a fun second-date idea?",
];

export const COUPLE_CARD_DECKS: readonly Deck[] = [
  {
    id: "firstdate",
    titleKey: "tools.couple_cards.deck_firstdate_title",
    blurbKey: "tools.couple_cards.deck_firstdate_blurb",
    questionsHu: FIRSTDATE_HU,
    questionsEn: FIRSTDATE_EN,
  },
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
  // Hidden easter-egg deck: a 5th pack of light, playful questions, only
  // revealed after the visitor swipes horizontally across the mini-deck
  // row. Stays in this array unconditionally so the data shape stays
  // simple; the gating lives in CoupleCardsPage state.
  {
    id: "lemonade",
    titleKey: "tools.couple_cards.deck_lemonade_title",
    blurbKey: "tools.couple_cards.deck_lemonade_blurb",
    questionsHu: LEMONADE_HU,
    questionsEn: LEMONADE_EN,
  },
];

export const DECK_SIZE = 25;

// The numbered "Level 1-4" red decks, in fixed order. Accent decks
// (firstdate, lemonade) sit outside this set: firstdate is the hidden
// first-date pack tucked off the LEFT edge of the deck row, lemonade the
// playful pack off the RIGHT. Both render with their own palette
// and a name instead of a Level number.
export const RED_DECK_ORDER: readonly DeckId[] = ["roots", "everyday", "closeness", "deepwater"];

export function isAccentDeck(id: DeckId): boolean {
  return id === "firstdate" || id === "lemonade";
}

/** 1-based Level number for a red deck; 0 for accent decks. */
export function redLevel(id: DeckId): number {
  return RED_DECK_ORDER.indexOf(id) + 1;
}

/** Easter-egg lemonade reveal is intentionally session-ephemeral: every
 *  fresh page load starts back at "hidden" so the visitor has to re-
 *  discover the swipe. We keep the load/save helpers exported and the
 *  legacy localStorage key around so both surfaces (landing teaser +
 *  tool page) share the same wiring, but persistence is now a no-op.
 *  If we ever want a one-time discovery (visit-A unlocks → visit-B sees
 *  it), wiring it back into localStorage is the obvious place. */
export const LEMONADE_REVEAL_KEY = "weddly.couple_cards.lemonade_revealed";

export function loadLemonadeRevealed(): boolean {
  // Always start hidden: the swipe is the unlock. No-op localStorage
  // read keeps the easter egg feeling like an easter egg.
  if (typeof window !== "undefined") {
    try {
      // Clear any leftover persisted flag from the previous behaviour so
      // returning visitors actually re-experience the hidden state.
      window.localStorage.removeItem(LEMONADE_REVEAL_KEY);
    } catch {
      // localStorage blocked: nothing to clean up anyway.
    }
  }
  return false;
}

export function saveLemonadeRevealed(): void {
  // Intentionally a no-op: reveals don't persist across reloads, see
  // `loadLemonadeRevealed` for the why.
}
