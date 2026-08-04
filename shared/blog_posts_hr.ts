// Croatian copy for every seeded blog post, keyed by the post's canonical
// (Hungarian) slug. Read by `SEED_TRANSLATIONS` in blog_posts.ts, written
// into the `hr_*` columns by the boot seeder, and served to any reader whose
// UI locale is Hrvatski.
//
// Translated by hand rather than through the DeepL integration, which has no
// Croatian at all — the same gap that leaves a Croatian vendor without the
// "Fordítás" button on their own listing description.

import type { BlogTranslationsBySlug } from "./blog_posts";

export const BLOG_POSTS_HR: BlogTranslationsBySlug = {
  "eskuvoi-rsvp-kerdesek": {
    category: "RSVP",
    title: "Vjenčani RSVP: što pitati goste da odgovori ostanu pregledni",
    lead: "Koja pitanja staviti u obrazac za odgovor da bude jednostavno gostima i korisno vama.",
    seo_title: "Pitanja za vjenčani RSVP · Weddly",
    seo_description:
      "Vodič za vjenčani RSVP: što pitati, zašto manje polja donosi više odgovora i kako iskoristiti ono što prikupite.",
    body: [
      {
        type: "p",
        text: "RSVP izgleda jednostavno: želite znati tko dolazi. U praksi odgovori nose konačan broj gostiju, izbor menija, broj pratnji i niz detalja koji će vam trebati do kraja priprema.",
      },
      {
        type: "p",
        text: "Najbolji RSVP obrazac kratak je, dobro se otvara na mobitelu i pita samo ono što ćete stvarno upotrijebiti.",
      },
      { type: "h2", text: "1. Dolaziš ili ne?" },
      {
        type: "p",
        text: "Stavite to prvo. Nemojte to zatrpati dugim uvodom. Gost mora odmah vidjeti što ga pitate.",
      },
      { type: "p", text: "Primjer: „Hoćeš li nam se pridružiti?”" },
      { type: "ul", items: ["Da, bit ću tamo.", "Nažalost, ne mogu doći."] },
      { type: "h2", text: "2. Pratnja" },
      {
        type: "p",
        text: "Ako je pratnja dobrodošla, recite to jasno u obrascu. Ako pratnju smije dovesti samo dio gostiju, osobne poveznice po gostu tiho izbjegavaju neugodan trenutak kad netko dovede prijatelja s kojim niste računali.",
      },
      { type: "p", text: "Primjer: „Dolaziš li s pratnjom?”" },
      { type: "h2", text: "3. Meni i prehrambene potrebe" },
      {
        type: "p",
        text: "Kuhinja mora rano znati s čime računa, pa u istom dahu pitajte za izbor menija i za prehrambene potrebe.",
      },
      { type: "p", text: "Primjer: „Imaš li kakvu prehrambenu potrebu ili ograničenje?”" },
      {
        type: "p",
        text: "Ostavite polje za slobodan tekst: ne stane svaka potreba u ponuđenu opciju.",
      },
      { type: "h2", text: "4. Neobavezni dodaci" },
      { type: "p", text: "Nemojte pretjerati, ali nekoliko dodatnih pitanja može koristiti:" },
      {
        type: "ul",
        items: [
          "Treba li ti prijevoz?",
          "Trebaju li ti informacije o smještaju?",
          "Želiš li zaželjeti neku pjesmu?",
          "Ima li još nešto što bismo trebali znati unaprijed?",
        ],
      },
      { type: "h2", text: "5. Ne pitajte previše" },
      {
        type: "p",
        text: "Dugačak RSVP odgađa se za poslije. Dobar se ispuni za manje od minute, i to na mobitelu na stanici.",
      },
      {
        type: "p",
        text: "U Weddlyju svaki gost dobiva svoju RSVP poveznicu, a sve što odgovori sleti ravno na vaš popis uzvanika, bez prepisivanja iz zajedničkog obrasca.",
      },
      {
        type: "cta",
        lead: "Postavite jednostavan RSVP u Weddlyju i skupite svaki odgovor, meni, pratnju i bilješku na jednom mjestu.",
        href: "/signup",
        label: "Počnite planirati",
      },
    ],
  },
  "eskuvoi-vendeglista-keszitese": {
    category: "Popis uzvanika",
    title: "Kako složiti popis uzvanika koji stvarno ostaje pregledan",
    lead: "Kako na jednom mjestu skupiti imena, pratnje, potvrde dolaska, izbor menija i prehrambene potrebe.",
    seo_title: "Popis uzvanika za vjenčanje · Weddly",
    seo_description:
      "Popis uzvanika bez stresa: kako na jednom mjestu skupiti imena, pratnje, RSVP, menije i prehrambene potrebe.",
    body: [
      {
        type: "p",
        text: "Popis uzvanika jedan je od temelja priprema i ujedno prva stvar koja se obično razleti: tablica ovdje, par bilježaka ondje, dva razgovora u chatu. Netko je odgovorio, netko nije. Jedan želi pratnju, drugi treba vegetarijanski meni, treći još ne zna.",
      },
      { type: "p", text: "Upravo taj kaos vrijedi spriječiti od početka." },
      { type: "h2", text: "1. Bilježite više od imena" },
      { type: "p", text: "Dobar popis uzvanika nije spisak imena. Za svakog gosta vodite:" },
      {
        type: "ul",
        items: [
          "puno ime",
          "status pozivnice",
          "odgovor na RSVP",
          "pratnju",
          "izbor menija",
          "alergije / prehrambene potrebe",
          "stol",
          "bilješke",
        ],
      },
      {
        type: "p",
        text: "Time si štedite kopanje po Messengeru i mailovima zadnji tjedan, da se prisjetite tko je što napisao.",
      },
      { type: "h2", text: "2. Vodite jasan RSVP" },
      {
        type: "p",
        text: "„Javit će nam uživo” rijetko funkcionira. Puno je lakše kad svaki gost ima osobnu RSVP poveznicu koju riješi za manje od minute.",
      },
      { type: "p", text: "Dobar obrazac traži samo ono što vam stvarno treba:" },
      {
        type: "ul",
        items: [
          "dolaziš li",
          "dovodiš li pratnju",
          "izbor menija",
          "prehrambene potrebe",
          "ima li još nečega što bismo trebali znati",
        ],
      },
      { type: "p", text: "Što je obrazac kraći, to odgovori brže stižu." },
      { type: "h2", text: "3. Riješite pratnje na vrijeme" },
      {
        type: "p",
        text: "Pratnje su mjesto gdje najčešće sve iskoči iz okvira. Odlučite unaprijed tko smije dovesti nekoga i onda se toga držite, čak i ako jedan-dva razgovora budu neugodna.",
      },
      {
        type: "p",
        text: "Nije to samo pitanje budžeta. Svaka pratnja je još jedno mjesto, još jedan meni, a ponekad i drugačiji raspored stolova.",
      },
      { type: "h2", text: "4. Povežite ga s rasporedom sjedenja" },
      {
        type: "p",
        text: "Podaci s popisa uzvanika najkorisniji su kad nisu odvojeni od rasporeda sjedenja. Ako netko otkaže, doda pratnju ili navede prehrambenu potrebu, raspored bi to trebao odraziti.",
      },
      {
        type: "p",
        text: "Puno pomaže kad popis uzvanika, RSVP i raspored sjedenja žive zajedno: otkazivanje ili nova alergija upisuju se samo jednom. (Točno zato smo Weddly i složili ovako.)",
      },
      { type: "h2", text: "Kratka lista" },
      {
        type: "ul",
        items: [
          "Status za svakog gosta.",
          "Odgovor na RSVP vodite zasebno.",
          "Pratnje riješite rano.",
          "Menije i alergije skupljajte u istom koraku.",
          "Povežite raspored sjedenja s popisom uzvanika.",
        ],
      },
      {
        type: "cta",
        lead: "Weddly drži popis uzvanika, RSVP, pratnje, menije i raspored sjedenja u jednom radnom prostoru.",
        href: "/signup",
        label: "Počnite planirati",
      },
    ],
  },
  "eskuvoi-ultetesi-rend-keszitese": {
    category: "Raspored sjedenja",
    title: "Kako složiti raspored sjedenja koji ima logiku i dobro se ispiše",
    lead: "Na što pripaziti kod obitelji, prijatelja, djece i ispisa.",
    seo_title: "Raspored sjedenja za vjenčanje · Weddly",
    seo_description:
      "Kako isplanirati raspored sjedenja koji podnosi obitelj, prijatelje, djecu i promjene u zadnji čas, a uredno se ispiše.",
    body: [
      {
        type: "p",
        text: "Raspored sjedenja obično se pojavi u zadnjih nekoliko tjedana prije vjenčanja, iako oblikuje mnoge odluke. Tko sjedi za mladenačkim stolom? Gdje idu obitelji? Trebaju li društva ostati zajedno? A gosti koji ne poznaju nikoga?",
      },
      {
        type: "p",
        text: "Dobro promišljen raspored nije samo lijep: tiho olakšava dan vašim gostima, ljudima koji vode prostor i vama dvoma.",
      },
      { type: "h2", text: "1. Nemojte ga prerano zaključati" },
      {
        type: "p",
        text: "Planirajte rano, ali nemojte ga smatrati konačnim dok ne stigne dovoljno potvrda. Ako je puno gostiju neodlučno, raspored će se mijenjati iznova.",
      },
      { type: "p", text: "Krenite od skupina na razini stola:" },
      {
        type: "ul",
        items: [
          "uža obitelj",
          "šira obitelj",
          "prijatelji",
          "kolege s posla",
          "obitelji s djecom",
          "stariji gosti",
        ],
      },
      {
        type: "p",
        text: "Kad te skupine sjednu na svoje mjesto, možete prijeći na to tko točno sjedi gdje.",
      },
      { type: "h2", text: "2. Poštujte raspored prostora" },
      {
        type: "p",
        text: "Položaj je bitan: plesni podij, šank, ulaz, bend. Stariji gosti vole mirnije kutove. Društva idu blizu podija.",
      },
      {
        type: "p",
        text: "Dobar raspored nije samo pitanje tko sjedi kraj koga: misli i o tome gdje će se tko u prostoru osjećati najbolje.",
      },
      { type: "h2", text: "3. Napravite kako treba verziju za ispis" },
      { type: "p", text: "Raspored sjedenja ne završava na ekranu. Vjerojatno će vam trebati:" },
      {
        type: "ul",
        items: [
          "veliki pano na ulazu",
          "brojevi stolova",
          "kartice s imenima",
          "popis prilagođen cateringu",
          "primjerak za osoblje na sam dan",
        ],
      },
      {
        type: "p",
        text: "Zato se isplati rano razmisliti kako će sve to izgledati kad se ispiše i objesi.",
      },
      { type: "h2", text: "4. Računajte na promjene u zadnji čas" },
      {
        type: "p",
        text: "Netko uvijek otkaže zadnji tjedan ili potvrdi nakon što je dugo bio neodlučan. Ako raspored živi samo u ručno crtanom PDF-u, svaka promjena boli.",
      },
      {
        type: "p",
        text: "Upravo zato smo Weddlyjevo platno za sjedenje složili ovako: povučete gosta, spustite ga na novo mjesto, a kad ste spremni, ispisuje se u formatu A4, A6 ili A3.",
      },
      { type: "h2", text: "Kratka lista" },
      {
        type: "ul",
        items: [
          "Prvo skupine, pa mjesta.",
          "Zaključajte ga kad se potvrde slegnu.",
          "Koristite stvarni tlocrt prostora.",
          "Isplanirajte ispis.",
          "Ostavite prostora za kasne promjene.",
        ],
      },
      {
        type: "cta",
        lead: "Složite raspored sjedenja vizualno u Weddlyju i izvezite ga u A4 / A6 / A3 za pano na ulazu, kartice s imenima i mapu koordinatora.",
        href: "/signup",
        label: "Isprobajte",
      },
    ],
  },
  "eskuvoszervezesi-checklist-12-honapra": {
    category: "Planiranje",
    title: "Popis zadataka za 12 mjeseci: što riješiti i kada",
    lead: "Korak po korak: što zaključiti godinu, šest mjeseci i mjesec dana prije vjenčanja.",
    seo_title: "Plan priprema za vjenčanje u 12 mjeseci · Weddly",
    seo_description:
      "Praktičan plan priprema za 12 mjeseci: što riješiti godinu, devet mjeseci, šest, tri, mjesec i tjedan dana prije vjenčanja.",
    body: [
      {
        type: "p",
        text: "Pripreme za vjenčanje djeluju neizvedivo samo kad sve padne na vas odjednom. Prostor, popis uzvanika, fotograf, glazba, pozivnice, odjeća, raspored sjedenja, meni, dekoracija, tiskani materijali. Lako je izgubiti nit.",
      },
      {
        type: "p",
        text: "Dobra vijest: ne mora se riješiti u jednom naletu. U valovima sve postane mnogo mirnije.",
      },
      { type: "h2", text: "12 mjeseci prije" },
      { type: "p", text: "Ovo je razdoblje velikih odluka." },
      {
        type: "ul",
        items: [
          "odredite datum",
          "dogovorite stil",
          "skicirajte okvirni budžet",
          "procijenite broj gostiju",
          "tražite prostor",
          "napravite uži izbor ključnih dobavljača",
        ],
      },
      { type: "p", text: "Ne trebaju vam još svi detalji, samo jasne granice." },
      { type: "h2", text: "9 mjeseci prije" },
      { type: "p", text: "Vrijeme je za rezervacije." },
      {
        type: "ul",
        items: [
          "ugovor za prostor",
          "foto / video",
          "bend ili DJ",
          "voditelj obreda / vođa programa",
          "prva verzija popisa uzvanika",
          "web stranica vjenčanja ili RSVP",
        ],
      },
      {
        type: "p",
        text: "Popis uzvanika još će se mijenjati, ali stavite prvu verziju na papir.",
      },
      { type: "h2", text: "6 mjeseci prije" },
      { type: "p", text: "Sada detalji." },
      {
        type: "ul",
        items: [
          "dizajn pozivnica",
          "rok za RSVP",
          "smjer dekoracije",
          "odjeća",
          "ponude za meni",
          "plan smještaja i prijevoza",
        ],
      },
      {
        type: "p",
        text: "Do sada bi se budžet trebao osvježavati stvarnim ponudama, a ne procjenama.",
      },
      { type: "h2", text: "3 mjeseca prije" },
      { type: "p", text: "Odgovori i dorada." },
      {
        type: "ul",
        items: [
          "pratite potvrde dolaska",
          "osvježite popis uzvanika",
          "prikupite izbor menija",
          "dogovorite detalje s dobavljačima",
          "prva skica rasporeda sjedenja",
          "dizajn tiskanih materijala",
        ],
      },
      {
        type: "p",
        text: "Ako sve i dalje živi u razbacanim tablicama, lako je ispustiti detalj. Puno je mirnije kad oboje gledate isti popis.",
      },
      { type: "h2", text: "Mjesec dana prije" },
      { type: "p", text: "Faza zaključivanja." },
      {
        type: "ul",
        items: [
          "javite konačan broj gostiju",
          "zaključajte raspored sjedenja",
          "ispišite brojeve stolova i kartice s imenima",
          "razradite plan dana s dobavljačima",
          "provjerite rokove plaćanja",
          "složite satnicu dana",
        ],
      },
      {
        type: "p",
        text: "Manje novih ideja, više toga da svi, vas dvoje, vaši roditelji, vaši dobavljači, doista znaju istu stvar.",
      },
      { type: "h2", text: "Tjedan dana prije" },
      { type: "p", text: "Ostalo je samo fino podešavanje." },
      {
        type: "ul",
        items: [
          "riješite zadnje promjene među gostima",
          "pregledajte tiskane materijale",
          "potvrde dobavljača",
          "spakirajte komplet za hitne slučajeve",
          "odmorite se",
        ],
      },
      {
        type: "p",
        text: "Da, odmor je na popisu. Vjenčanje nije zatvaranje projekta, nego dan koji treba proživjeti.",
      },
      { type: "h2", text: "Sažetak" },
      {
        type: "p",
        text: "Pripreme postaju izvedive onog trena kad prestanete pokušavati riješiti sve odjednom. Zajednički popis zadataka, popis uzvanika koji je uvijek svjež, budžet koji se mijenja s vama i jedno mjesto u koje oboje gledate. To je dovoljno.",
      },
      {
        type: "cta",
        lead: "Weddly drži vaš budžet, popis uzvanika, potvrde dolaska i raspored sjedenja na okupu, da ne morate planirati iz nepovezanih tablica.",
        href: "/signup",
        label: "Počnite planirati",
      },
      { type: "h2", text: "Česta pitanja" },
      { type: "h3", text: "Kada bismo trebali početi planirati vjenčanje?" },
      {
        type: "p",
        text: "Idealno 9 do 12 mjeseci unaprijed. Manja vjenčanja mogu se isplanirati brže.",
      },
      { type: "h3", text: "Kada treba poslati pozivnice?" },
      {
        type: "p",
        text: "Obično 3 do 6 mjeseci prije vjenčanja, ovisno o tome koliko gostiju putuje.",
      },
      { type: "h3", text: "Kada raspored sjedenja treba biti konačan?" },
      {
        type: "p",
        text: "Nakon zadnjih potvrda dolaska, obično 2 do 4 tjedna prije vjenčanja.",
      },
    ],
  },
  "eskuvoi-koltsegvetes-keszitese": {
    category: "Budžet",
    title: "Kako složiti budžet za vjenčanje koji ostaje pod kontrolom",
    lead: "Kako odrediti ukupni iznos, kako računati s brojem gostiju i kako izbjeći tiho probijanje okvira.",
    seo_title: "Kako složiti budžet za vjenčanje · Weddly",
    seo_description:
      "Praktičan vodič za budžet vjenčanja: kako odrediti ukupni iznos, rasporediti ga po kategorijama, računati s brojem gostiju i izbjeći tiho probijanje.",
    body: [
      {
        type: "p",
        text: "Najteži dio priprema nije odlučiti što želite. Teško je držati to unutar budžeta. Prostor, catering, dekoracija, odjeća, fotograf, glazba i tiskani materijali svaki za sebe djeluju izvedivo, ali brzo se zbroje.",
      },
      {
        type: "p",
        text: "Budžet gledajte kao živ plan, a ne kao tablicu koju ispunite jednom. Kad se promijeni broj gostiju, meni ili cijena prostora, cijeli budžet mora krenuti za tim.",
      },
      { type: "h2", text: "1. Krenite od ukupnog iznosa" },
      {
        type: "p",
        text: "Nemojte krenuti od kategorija. Prvo se dogovorite koliko ukupno mirne duše možete izdvojiti za vjenčanje.",
      },
      { type: "p", text: "Zatim taj iznos razdijelite na glavne kategorije:" },
      {
        type: "ul",
        items: [
          "prostor",
          "catering i piće",
          "foto i video",
          "dekoracija",
          "odjeća",
          "glazba",
          "pozivnice i tiskani materijali",
          "rezerva",
        ],
      },
      {
        type: "p",
        text: "Nemojte preskočiti rezervu. Gotovo svako vjenčanje pokupi trošak kojeg na početnom popisu nije bilo.",
      },
      { type: "h2", text: "2. Broj gostiju pomiče sve" },
      {
        type: "p",
        text: "Broj gostiju ne mijenja samo stavku cateringa. Pomiče piće, broj stolova, raspored sjedenja, tiskane materijale, poklone gostima, a često i minimalnu potrošnju u prostoru.",
      },
      { type: "p", text: "„Otprilike 90 ljudi” nije dovoljno. Računajte s više scenarija:" },
      {
        type: "ul",
        items: [
          "manje vjenčanje: 50 gostiju",
          "srednje vjenčanje: 80 gostiju",
          "veće vjenčanje: 120 gostiju",
        ],
      },
      { type: "p", text: "Brzo postane jasno koji scenarij zaista stane u ukupni iznos." },
      { type: "h2", text: "3. Nemojte gledati samo konačni zbroj" },
      {
        type: "p",
        text: "Primamljivo je gledati samo ukupan iznos. Puno više pomaže vidjeti, kategoriju po kategoriju, gdje ste tiho iskočili.",
      },
      {
        type: "p",
        text: "Možda ste u cjelini još u okviru, a dekoracija je već pojela dio novca predviđenog za fotografa. Bolje to uhvatiti rano nego krpati zadnjih tjedana.",
      },
      { type: "h2", text: "4. Budžet mora biti zajednički" },
      {
        type: "p",
        text: "Ako jedno od vas osvježava tablicu, a drugo gleda stare brojke, nesporazum je pitanje vremena. Zajedničke pripreme traže jedan zajednički budžet koji je uvijek svjež.",
      },
      {
        type: "p",
        text: "Puno pomaže kad budžet, popis uzvanika i raspored sjedenja žive u istom prostoru, pa promjena broja gostiju ne znači praćenje posljedica u tri odvojene datoteke. (Zato smo Weddly i složili ovako.)",
      },
      { type: "h2", text: "Kratka lista" },
      {
        type: "ul",
        items: [
          "Prvo se dogovorite o ukupnom iznosu.",
          "Razdijelite ga po kategorijama.",
          "Računajte s više scenarija broja gostiju.",
          "Odvojite rezervu.",
          "Oboje gledajte istu, živu verziju.",
        ],
      },
      {
        type: "cta",
        lead: "Želite pregledniji budžet vjenčanja? U Weddlyju budžet, popis uzvanika, potvrde dolaska i raspored sjedenja žive u jednom zajedničkom prostoru.",
        href: "/signup",
        label: "Počnite planirati",
      },
    ],
  },
  "digitalis-eskuvoi-meghivo-vagy-papir-meghivo": {
    category: "Pozivnice",
    title: "Digitalne pozivnice ili one na papiru: što odabrati?",
    lead: "Prednosti, nedostaci, troškovi i kako svaka opcija utječe na prikupljanje potvrda.",
    seo_title: "Digitalne ili papirnate pozivnice za vjenčanje · Weddly",
    seo_description:
      "Usporedba digitalnih i papirnatih pozivnica: prednosti, nedostaci, troškovi i kako se svaka povezuje s prikupljanjem potvrda dolaska.",
    body: [
      {
        type: "p",
        text: "Pozivnica je prvo što vaši gosti vide. Postavlja ton i nosi ključne informacije. Danas pitanje nije samo koji papir odabrati, nego treba li papir uopće.",
      },
      {
        type: "p",
        text: "Digitalno i papirnato nisu suprotnosti. Mnogim parovima kombinacija najbolje leži.",
      },
      { type: "h2", text: "Papirnate pozivnice: kad su prava stvar" },
      {
        type: "p",
        text: "Papir djeluje osobno, elegantno je i opipljivo. Dobro pristaje ako vam je stalo do klasičnog doživljaja ili ako mnogi gosti vole tradicionalni oblik.",
      },
      { type: "p", text: "Za:" },
      {
        type: "ul",
        items: [
          "postaje uspomena",
          "elegantno i svečano",
          "pristaje klasičnom stilu",
          "djeluje osobnije",
        ],
      },
      { type: "p", text: "Protiv:" },
      {
        type: "ul",
        items: [
          "skuplje je",
          "traži vrijeme za tisak i poštu",
          "teško se mijenja ako se detalji promijene",
          "potvrde dolaska morate voditi zasebno",
        ],
      },
      { type: "h2", text: "Digitalne pozivnice: kad su praktičnije" },
      {
        type: "p",
        text: "Digitalno je brzo, lako se ispravlja, a odgovor stiže odmah uz pozivnicu. Ako se promijeni datum, prostor ili meni, ništa se ne mora ponovno tiskati: jedna izmjena i svi vide novu verziju.",
      },
      { type: "p", text: "Za:" },
      {
        type: "ul",
        items: [
          "brzo se šalju",
          "lako se otvaraju na mobitelu",
          "povezuju se s potvrdama dolaska",
          "mogu se mijenjati",
          "povoljnije su",
        ],
      },
      { type: "p", text: "Protiv:" },
      {
        type: "ul",
        items: [
          "mogu djelovati manje svečano",
          "ne vole ih svi gosti",
          "lako se izgube u nizu poruka",
        ],
      },
      { type: "h2", text: "Kombinacija često pobjeđuje" },
      {
        type: "p",
        text: "Mnogi parovi šalju papir užoj obitelji i nekolicini važnih gostiju, dok ostali dobivaju digitalnu pozivnicu ili poveznicu za potvrdu dolaska.",
      },
      {
        type: "p",
        text: "Praktično je ako želite doživljaj elegantne pozivnice bez ručnog praćenja svakog odgovora.",
      },
      { type: "h2", text: "Što digitalna pozivnica treba sadržavati" },
      {
        type: "p",
        text: "Dobra digitalna pozivnica lijepa je i korisna u isto vrijeme. Uključite:",
      },
      {
        type: "ul",
        items: [
          "vaša imena",
          "datum",
          "prostor i adresu",
          "satnicu",
          "kod odijevanja (ako ga ima)",
          "rok za potvrdu dolaska",
          "pitanja o meniju i prehrani",
          "kontakt",
        ],
      },
      { type: "p", text: "Najvažnije: da gost može brzo odgovoriti." },
      { type: "h2", text: "Gdje se tu uklapa RSVP" },
      {
        type: "p",
        text: "Prava prednost digitalnog: odgovor stoji odmah uz pozivnicu. Bez zasebnih poruka, bez telefoniranja, bez tablice koju treba održavati na životu.",
      },
      {
        type: "p",
        text: "Gost otvori poveznicu, odgovori na nekoliko pitanja, a vi već vidite tko dolazi, a tko ne.",
      },
      { type: "h2", text: "Brza pomoć pri odluci" },
      { type: "h3", text: "Odaberite papir ako…" },
      {
        type: "ul",
        items: [
          "želite klasičan doživljaj",
          "imate puno starijih gostiju",
          "želite opipljivu uspomenu",
        ],
      },
      { type: "h3", text: "Odaberite digitalno ako…" },
      {
        type: "ul",
        items: [
          "želite brzo i praktično rješenje",
          "morate prikupiti puno detalja",
          "važno vam je da se potvrde skupljaju same",
          "želite smanjiti troškove",
        ],
      },
      { type: "h3", text: "Odaberite kombinaciju ako…" },
      {
        type: "ul",
        items: [
          "želite i ljepotu i praktičnost",
          "papir za obitelj, digitalno za ostale",
          "želite uspomenu bez ručnog vođenja potvrda",
        ],
      },
      {
        type: "cta",
        lead: "U Weddlyju svaki gost odgovara na svojoj RSVP poveznici, a vi vidite svaki odgovor, pratnju, meni i bilješku na jednom mjestu.",
        href: "/signup",
        label: "Isprobajte",
      },
      { type: "h2", text: "Česta pitanja" },
      { type: "h3", text: "Je li dovoljno poslati samo digitalnu pozivnicu?" },
      {
        type: "p",
        text: "Jest, dok god se vaš popis uzvanika s time dobro snalazi i dok su sve ključne informacije lako dostupne.",
      },
      { type: "h3", text: "Treba li nam uopće papirnata pozivnica?" },
      {
        type: "p",
        text: "Nije obavezna, ali je lijepa gesta prema obitelji i prema svima kojima je tradicionalni oblik važan.",
      },
      { type: "h3", text: "Koji je najvažniji sadržaj?" },
      {
        type: "p",
        text: "Datum, prostor, vrijeme, rok za potvrdu dolaska i sve ostalo što gostu pomaže da odluči.",
      },
    ],
  },
  "eskuvoszervezesi-checklist-6-honapra": {
    category: "Planiranje",
    title: "Plan priprema u 6 mjeseci: što riješiti i kada",
    lead: "Ako do vjenčanja imate šest mjeseci: sažeta vremenska crta od velikih odluka do zadnjeg tjedna, da se ništa ne nagomila na kraju.",
    seo_title: "Plan priprema za vjenčanje u 6 mjeseci · Weddly",
    seo_description:
      "Praktičan plan priprema za 6 mjeseci: što riješiti šest, četiri, dva i mjesec dana prije vjenčanja, te u zadnjem tjednu.",
    body: [
      {
        type: "p",
        text: "Šest mjeseci do vjenčanja sasvim je izvedivo. Puno parova ima točno toliko, a uži prozor pripreme često učini usredotočenijima i manje raspršenima. Kvaka je u tome što ono što je na popisu za 12 mjeseci mirna odluka, ovdje postaje hitno. Ako prvi tjedni prođu dobro, ostatak se obično posloži sam.",
      },
      {
        type: "p",
        text: "U nastavku: što riješiti u kojoj fazi da se ništa ne nagomila na kraju.",
      },
      { type: "h2", text: "Šest mjeseci prije" },
      {
        type: "p",
        text: "Ovo su odluke o kojima ovisi sve ostalo. U planu za 12 mjeseci razvukli biste ih kroz prvo tromjesečje; ovdje ih želite zaključiti u tjedan ili dva.",
      },
      {
        type: "ul",
        items: [
          "odredite datum,",
          "dogovorite stil,",
          "postavite gornju granicu budžeta,",
          "procijenite broj gostiju,",
          "potpišite ugovor za prostor,",
          "rezervirajte ključne dobavljače (foto, glazba),",
          "prijavite namjeru sklapanja braka u matičnom uredu.",
        ],
      },
      { type: "h3", text: "Savjet" },
      {
        type: "p",
        text: "Neka prvi tjedan bude samo o prostoru i datumu. Nemojte u to miješati vjenčanicu, dekoraciju ni raspored sjedenja dok to dvoje ne sjedne. Sve ostalo slaže se prema njima.",
      },
      { type: "h2", text: "Četiri mjeseca prije" },
      { type: "p", text: "Nakon velikih odluka dolaze detalji kojima treba vremena i probe." },
      {
        type: "ul",
        items: [
          "prva verzija popisa uzvanika,",
          "dizajn pozivnica,",
          "postavljanje RSVP-a,",
          "prve probe vjenčanice i odijela,",
          "smjer dekoracije,",
          "rezerviran voditelj obreda,",
          "zatražene ponude za meni i šank.",
        ],
      },
      {
        type: "p",
        text: "Budžet sada osvježavajte stvarnim ponudama, ne procjenama. Obično se baš tu pokaže da jednu ili dvije stavke treba stisnuti.",
      },
      { type: "h2", text: "Dva do tri mjeseca prije" },
      { type: "p", text: "Odgovori i dorada. Ono što je bio plan poprima konačan oblik." },
      {
        type: "ul",
        items: [
          "pozivnice poslane,",
          "određen rok za potvrdu dolaska (uz šest mjeseci ciljajte 4-5 tjedana prije vjenčanja),",
          "prikupite izbor menija,",
          "zaključite smještaj i prijevoz,",
          "prva skica rasporeda sjedenja,",
          "dizajn tiskanih materijala (brojevi stolova, kartice s imenima),",
          "objasnite kumovima njihove službene zadatke.",
        ],
      },
      { type: "h3", text: "Savjet" },
      {
        type: "p",
        text: "Nemojte pozivnicu ostaviti za zadnji čas. Uz šest mjeseci pošaljite je najkasnije krajem trećeg mjeseca; većini gostiju treba nekoliko tjedana da odgovori.",
      },
      { type: "h2", text: "Mjesec dana prije" },
      {
        type: "p",
        text: "Faza zaključivanja. Manje novih ideja, više toga da svi čitaju iste, svježe informacije.",
      },
      {
        type: "ul",
        items: [
          "javite konačan broj gostiju,",
          "zaključajte raspored sjedenja,",
          "ispišite brojeve stolova i kartice s imenima,",
          "dogovorite plan dana s dobavljačima,",
          "provjerite rokove plaćanja,",
          "objasnite obitelji i kumovima dolazak, ulogu i satnicu.",
        ],
      },
      { type: "h2", text: "Tjedan dana prije" },
      { type: "p", text: "Ostalo je samo fino podešavanje." },
      {
        type: "ul",
        items: [
          "riješite zadnje promjene među gostima,",
          "pregledajte tiskane materijale,",
          "potvrde dobavljača,",
          "spakirajte komplet za hitne slučajeve,",
          "odmorite se.",
        ],
      },
      {
        type: "p",
        text: "Da, odmor je na popisu. Nakon šest mjeseci zbijenih priprema zadnji tjedan treba biti sporiji od onih prije njega.",
      },
      { type: "h2", text: "Sažetak" },
      {
        type: "p",
        text: "Šest mjeseci je dovoljno. Kvaka je u tome da prva dva-tri tjedna budu usredotočena: prostor, datum, ključni dobavljači. Kad to sjedne, ostatak ide po užoj, ali još uvijek čitljivoj vremenskoj crti. Zajednički popis zadataka, popis uzvanika koji je uvijek svjež, budžet koji se mijenja s vama i jedno mjesto u koje oboje gledate. To je dovoljno.",
      },
      {
        type: "cta",
        lead: "Weddly drži vaš budžet, popis uzvanika, potvrde dolaska i raspored sjedenja na okupu, da ne morate planirati iz nepovezanih tablica.",
        href: "/signup",
        label: "Počnite planirati",
      },
      { type: "h2", text: "Česta pitanja" },
      { type: "h3", text: "Može li se vjenčanje isplanirati u 6 mjeseci?" },
      {
        type: "p",
        text: "Može, ako su prvi tjedni usredotočeni. Većina parova to iznese u šest mjeseci, pogotovo ako broj gostiju nije ekstreman.",
      },
      { type: "h3", text: "Kada poslati pozivnice kad imate šest mjeseci?" },
      {
        type: "p",
        text: "Najkasnije 8 do 12 tjedana prije vjenčanja, da gosti imaju vremena odgovoriti, a vi zaključiti broj.",
      },
      { type: "h3", text: "Što je teže izvesti u 6 mjeseci?" },
      {
        type: "p",
        text: "Vjenčanicu po mjeri kad salon ima dugu listu čekanja. Tražene fotografe ili bendove koji se rezerviraju godinu dana unaprijed. Velika međunarodna vjenčanja, gdje se prije pozivnice obično šalje najava datuma. Za to je 8 do 12 mjeseci realnije.",
      },
      { type: "h3", text: "Kada raspored sjedenja treba biti konačan?" },
      {
        type: "p",
        text: "Nakon zadnjih potvrda dolaska, obično 2 do 3 tjedna prije vjenčanja.",
      },
    ],
  },
  "eskuvoi-hagyomanyok-praktikusan": {
    category: "Običaji",
    title: "Vjenčani običaji, praktično: tko stavlja prsten i na koju ruku?",
    lead: "Zaručnički prsten, vjenčano prstenje, ples s mladenkom, bacanje buketa: što zadržati, što preoblikovati, a što preskočiti.",
    seo_title: "Vjenčani običaji, praktično · Weddly",
    seo_description:
      "Zaručnički prsten, vjenčano prstenje, ples s mladenkom, bacanje buketa: praktičan prolaz kroz klasične mađarske vjenčane običaje.",
    body: [
      {
        type: "p",
        text: "Vjenčani običaji katkad su predivni, a katkad zbunjujući. Tko prvi stavlja prsten? Na kojoj se ruci nosi vjenčani prsten? Što se sa zaručničkim prstenom događa tijekom obreda? I mora li se doista poštovati svaki stari običaj?",
      },
      {
        type: "p",
        text: "Dobra vijest: današnji vjenčani običaji uglavnom su mogućnosti, a ne pravila. Slijedi praktičan prolaz kroz najčešće.",
      },
      { type: "h2", text: "1. Zaručnički i vjenčani prsten" },
      {
        type: "p",
        text: "Zaručnički prsten obično se daruje pri prosidbi, često s centralnim kamenom poput dijamanta. Vjenčani prsten stavlja se tijekom obreda i predstavlja bračni zavjet.",
      },
      { type: "h3", text: "Savjet" },
      {
        type: "p",
        text: "Mnogi parovi nakon vjenčanja nose oba. Uobičajeno je prvo staviti vjenčani prsten (bliže srcu), a zaručnički preko njega.",
      },
      { type: "h2", text: "2. Koja ruka?" },
      {
        type: "p",
        text: "U Mađarskoj zaručnički prsten tradicionalno stoji na lijevom prstenjaku do vjenčanja, a nakon toga vjenčani prsten preuzima desni prstenjak. U Hrvatskoj se vjenčano prstenje također najčešće nosi na desnoj ruci. Čvrsto pravilo to nije: obitelj, udobnost ili osobni ukus obično presude.",
      },
      { type: "h3", text: "Savjet" },
      {
        type: "p",
        text: "Prije samog dana dogovorite što mladenka želi sa zaručničkim prstenom tijekom obreda. Tri su uobičajene mogućnosti: ostaviti ga na jednoj ruci i vjenčani staviti na drugu; premjestiti ga neposredno prije obreda; ili ga skinuti za obred pa ga poslije vratiti uz vjenčani.",
      },
      { type: "h2", text: "3. Tko prvi stavlja prsten?" },
      {
        type: "p",
        text: "Na većini građanskih i crkvenih obreda mladoženja prvi stavlja prsten mladenki, a zatim ona njemu. Nije univerzalno, ali je najčešći redoslijed.",
      },
      { type: "p", text: "Prije obreda provjerite:" },
      {
        type: "ul",
        items: [
          "odgovaraju li prsteni,",
          "zna li netko tko ih predaje voditelju obreda,",
          "je li spreman jastučić, kutijica ili tanjurić,",
          "znaju li kumovi ili dijete s prstenjem kad je njihov trenutak.",
        ],
      },
      { type: "h3", text: "Savjet" },
      {
        type: "p",
        text: "Od uzbuđenja, vrućine ili treme prsti znaju malo nateći. Nema veze ako prsten ne klizne iz prve. Bitan je trenutak, ne koreografija.",
      },
      { type: "h2", text: "4. Tko čuva prstenje prije obreda?" },
      {
        type: "p",
        text: "Obično mladoženja, kum, organizator vjenčanja ili voditelj obreda. Odlučite rano i neka postoji jedna osoba koja zna gdje je prstenje, preda ga na vrijeme i provjeri da su oba tu.",
      },
      { type: "h2", text: "5. Nešto staro, novo, posuđeno i plavo" },
      {
        type: "p",
        text: "Običaj „nešto staro, nešto novo, nešto posuđeno i nešto plavo” pojavljuje se na mnogim vjenčanjima. Nije obavezan, ali je lijep simboličan detalj.",
      },
      {
        type: "ul",
        items: [
          "staro: obiteljski nakit, bakina maramica,",
          "novo: haljina, cipele ili nakit,",
          "posuđeno: ukras za kosu bliske prijateljice,",
          "plavo: podvezica, vez, vrpca ili sitan detalj.",
        ],
      },
      {
        type: "p",
        text: "Ne mora biti upadljivo. Mali plavi šav ili obiteljski privjesak savršeno odrađuju posao.",
      },
      { type: "h2", text: "6. Ples s mladenkom" },
      {
        type: "p",
        text: "U Mađarskoj se ples s mladenkom (menyasszonytánc) tradicionalno održava prije ponoći: gosti plaćaju ples s mladenkom. Nakon ponoći slijedi menyecsketánc, kad se mladenka presvuče u drugu odjeću. Hrvatska ima svoju inačicu istoga, uz otkup mladenke i skupljanje novca tijekom plesa.",
      },
      {
        type: "p",
        text: "Parovi sve češće prilagođavaju običaj: zadrže ga, skrate ili posve preskoče.",
      },
      {
        type: "p",
        text: "Ako ga zadržite, dogovorite unaprijed tko ga najavljuje, gdje stoji košarica, koliko traje, uz koju glazbu i je li mladenki uopće ugodno s tim običajem.",
      },
      { type: "h2", text: "7. Bacanje buketa" },
      {
        type: "p",
        text: "Klasika, ali ne za svakoga. Ako mladenka ne želi baciti svoj buket, može se pripremiti zaseban buket za bacanje.",
      },
      { type: "p", text: "Alternative:" },
      {
        type: "ul",
        items: [
          "igra s vrpcama i buketom,",
          "zajednička fotografija sa slobodnim gostima,",
          "predaja buketa osobi koja vam nešto znači,",
          "potpuno izostavljanje bacanja.",
        ],
      },
      {
        type: "cta",
        lead: "Vjenčani običaji najbolje rade kad pristaju priči para. Zadržite ono što vam nešto znači, a ostalo oblikujte tako da vam bude prirodno.",
        href: "/signup",
        label: "Složite to u Weddlyju",
      },
      { type: "h2", text: "Česta pitanja" },
      { type: "h3", text: "Na kojoj se ruci nosi vjenčani prsten?" },
      {
        type: "p",
        text: "U Hrvatskoj najčešće na desnoj ruci, kao i u Mađarskoj. Zaručnički prsten često stoji uz njega ili ostaje na lijevoj ruci.",
      },
      { type: "h3", text: "Je li ples s mladenkom obavezan?" },
      {
        type: "p",
        text: "Nije. Sve više parova ga izostavi, skrati ili preoblikuje ako im ne odgovara.",
      },
      { type: "h3", text: "Što znači „nešto posuđeno”?" },
      {
        type: "p",
        text: "Predmet za sreću od nekoga koga volite, koji se nakon vjenčanja vraća. Može biti ukras za kosu, veo, komad nakita, bilo što sitno.",
      },
      { type: "h3", text: "Koliko presvlačenja tijekom vjenčanja?" },
      {
        type: "p",
        text: "Koliko god želite. Klasika je jedno presvlačenje, ali mnogi parovi cijelu večer provedu u istoj odjeći.",
      },
    ],
  },
};
