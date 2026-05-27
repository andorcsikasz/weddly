// Blog post shapes shared between the React frontend and the backend's
// SSR meta builder. The live source of truth is the `blog_posts` SQLite
// table; the `SEED_BLOG_POSTS` array below is consumed by the slug-level
// seeder in `domain/blog.ts`, which inserts any missing seed slug on
// every boot so new content reaches production without a manual migration.

import type { SeoLocale } from "./seo_routes";

export type BlogBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "ul"; items: string[] }
  /** Pulled-out quote. `text` carries the quote body (paragraphs split on
   *  `\n\n`); `cite` is the source attribution (e.g. "1Korinthus 13,4-8"). */
  | { type: "blockquote"; text: string; cite: string }
  | { type: "cta"; lead: string; href: string; label: string };

export interface BlogPostLocale {
  title: string;
  lead: string;
  body: BlogBlock[];
  seo_title: string;
  seo_description: string;
}

export interface BlogPost {
  /** Numeric primary key (admin-only; absent on seed records). */
  id?: number;
  slug: string;
  /** ISO date `YYYY-MM-DD`. Used for ordering + the visible byline. */
  published_at: string;
  /** Reading-time estimate in minutes. Hand-tuned per post, not auto. */
  read_minutes: number;
  /** Eyebrow label shown above the title (category tag). One per locale. */
  category: Record<SeoLocale, string>;
  /** Hero cover image. Either a local `/uploads/blog/...` path or an
   *  external http(s) URL the admin pasted in. Null = no image set. */
  cover_image_url?: string | null;
  /** Draft (false) vs live (true). Drafts are hidden from public lists +
   *  return 404 on /blog/:slug, but still visible in the admin index. */
  is_published?: boolean;
  hu: BlogPostLocale;
  en: BlogPostLocale;
}

export const SEED_BLOG_POSTS: BlogPost[] = [
  // ── 0a. Miért házasodunk a Biblia szerint? ─────────────────────────
  {
    slug: "miert-hazasodunk-a-biblia-szerint",
    published_at: "2026-05-24",
    read_minutes: 7,
    category: { hu: "Hit", en: "Faith" },
    hu: {
      title: "Miért házasodunk a Biblia szerint?",
      lead: "Teremtési rend, szövetség, Jézus tanítása és a hétköznapok programja: így olvassa a Biblia a házasság értelmét.",
      seo_title: "Miért házasodunk a Biblia szerint? · Wēddly",
      seo_description:
        "Mit mond a Biblia a házasság értelméről? Teremtési rend, szövetség, Jézus tanítása és Pál apostol gyakorlati programja Károli idézetekkel.",
      body: [
        {
          type: "p",
          text: "Sokan az esküvőszervezés közben jutnak el a kérdéshez: mi az, ami miatt egyáltalán házasodunk? Hagyomány? Romantika? Adminisztrációs döntés? A Biblia ennél többet ajánl: a házasságot nem társadalmi kelléknek látja, hanem a teremtésbe írt ajándéknak, amelynek belső szerkezete van.",
        },
        {
          type: "p",
          text: "Ez a poszt nem dogmatikus oktatás. Inkább annak a végiggondolása, mit mond a Szentírás a házasság értelméről, és miért lehet ez ma is segítő olvasat — akár vallásos, akár csak érdeklődő olvasónak.",
        },
        { type: "h2", text: "1. A teremtési rend: nem jó egyedül" },
        {
          type: "p",
          text: "A Biblia első könyve nem a házassággal indítja az emberi történetet, de egészen hamar eljut hozzá. A Teremtés könyve 2. fejezete egyetlen sorban kimondja, hogy az egyedüllét nem teljesedés, hanem hiány.",
        },
        {
          type: "blockquote",
          text: "És monda az Úr Isten: Nem jó az embernek egyedül lenni; szerzek néki segítő társat, hozzá illőt.",
          cite: "1Mózes 2,18",
        },
        {
          type: "p",
          text: "A „segítő társ“ kifejezés a héberben (ézer kenegdó) sokkal többet jelent, mint asszisztens vagy kiegészítő. Egyenrangú, szembenálló társat jelent, aki kiegészíti, megtükrözi, korrigálja a másikat. A házasság itt nem hierarchia, hanem találkozás.",
        },
        {
          type: "blockquote",
          text: "Annakokáért elhagyja a férfiú az ő atyját és az ő anyját, és ragaszkodik feleségéhez: és lesznek egy testté.",
          cite: "1Mózes 2,24",
        },
        {
          type: "p",
          text: "Három mozzanat egymás után: elhagyás, ragaszkodás, eggyé válás. A házasság a Biblia szerint új családot hoz létre — nem leváltja a régit, de elsődlegessé teszi az új köteléket. Ez a sorrend az, amit a Szentírás újra és újra visszahoz a házasság gyökereként.",
        },
        { type: "h2", text: "2. A házasság szövetség, nem szerződés" },
        {
          type: "p",
          text: "A Bibliában a házasság leggyakoribb kategóriája a szövetség (héberül berít). Ez nem szerződés, ami a felek érdekét védi, hanem feltétel nélküli elköteleződés Isten színe előtt. Egy szerződés akkor szűnik meg, ha a másik fél megszegi. Egy szövetség akkor is érvényben marad, ha az egyik fél hibázik — a hűség nem teljesítményhez, hanem személyhez szól.",
        },
        {
          type: "blockquote",
          text: "Mert az Úr volt bizonyság közted és a te ifjúságod felesége közt, akit te megcsaltál; pedig ő a társad és szövetséges feleséged.",
          cite: "Malakiás 2,14",
        },
        {
          type: "p",
          text: "Malakiás próféta ezzel a mondattal mondja ki, hogy a házasság előtt Isten áll bizonyságként. A „szövetséges feleség“ kifejezés (béríthekha) a Bibliában máshol Isten és népe kapcsolatára van használva. A házasság a Szentírás logikájában ehhez hasonlítható szövetség: nem csak két emberre tartozó megegyezés, hanem nyilvánosan, harmadik fél előtt tett elköteleződés.",
        },
        {
          type: "p",
          text: "Innen érthető meg, miért tartja fontosnak a Szentírás az ünnepélyes esküt és a tanúk jelenlétét. Nem hivatali aktusként, hanem a szövetség természetéből fakadóan.",
        },
        { type: "h2", text: "3. Jézus megerősíti az eredeti rendet" },
        {
          type: "p",
          text: "Az evangéliumokban a házasságról szóló legfontosabb tanítás akkor hangzik el, amikor Jézustól a válásról kérdeznek. A válasza nem a válással foglalkozik elsősorban, hanem visszamutat a teremtésre.",
        },
        {
          type: "blockquote",
          text: "Ő pedig felelvén, monda: Nem olvastátok-é, hogy a teremtő kezdettől fogva férfiúvá és asszonynyá teremté őket,\n\nÉs ezt mondá: Annak okáért elhagyja a férfiú atyját és anyját; és ragaszkodik feleségéhez, és lesznek ketten egy testté.\n\nÚgy hogy többé nem kettő, hanem egy test. Amit azért az Isten egybeszerkesztett, ember el ne válassza.",
          cite: "Máté 19,4-6",
        },
        {
          type: "p",
          text: "Jézus tehát nem új tanítást ad, hanem az eredeti teremtési rendet erősíti meg: a házasság szövetség, amit Isten köt össze. Az „egy test“ kifejezés nem csak testi egységet jelent, hanem a teljes élet összekapcsolódását.",
        },
        {
          type: "p",
          text: "Ez a szakasz a templomi esküvőkön gyakori felolvasás, és pontosan ezért: kimondja, hogy a házasság nem önállóan létrehozott, hanem belekapcsolódik egy nagyobb rendbe.",
        },
        { type: "h2", text: "4. A házasság programja: Pál apostol levelei" },
        {
          type: "p",
          text: "A teremtési és evangéliumi tanítás után az Újszövetség levelei azzal foglalkoznak, hogy ez a hétköznapokban hogyan néz ki. Pál apostol kulcsszakasza az Efézusi levél 5. fejezete, amelyet sokan félreolvasnak, mert csak egy verset emelnek ki belőle.",
        },
        {
          type: "blockquote",
          text: "Engedelmesek legyetek egymásnak Isten félelmében.\n\nTi férfiak, szeressétek a ti feleségeteket, miképpen a Krisztus is szerette az egyházat, és Önmagát adta azért.",
          cite: "Efézus 5,21.25",
        },
        {
          type: "p",
          text: "A 21. vers a teljes szakasz kulcsa: kölcsönös engedelmesség. A 25. vers a férjnek nem uralmat, hanem áldozati szeretetet ad parancsba — Krisztus mintájára, aki „önmagát adta“ az egyházért. Ez a hangsúly, ha kihagyjuk, eltorzul a szakasz.",
        },
        {
          type: "p",
          text: "A Kolossé 3 a házasság hétköznapjait írja le, dísz nélkül.",
        },
        {
          type: "blockquote",
          text: "Öltözzétek föl azért mint az Istennek választottai, szentek és szeretettek, könyörületes szívet, jóságosságot, alázatosságot, szelídséget, hosszútűrést;\n\nElszenvedvén egymást és megbocsátván kölcsönösen egymásnak, ha valakinek valaki ellen panasza volna;\n\nMindezeknek fölébe pedig öltözzétek föl a szeretetet, mint amely a tökéletességnek kötele.",
          cite: "Kolossé 3,12-14",
        },
        {
          type: "p",
          text: "Ezek nem felemelő pillanatok, hanem mindennapi minőségek: irgalom, jóság, türelem, megbocsátás. A házasság a Szentírás szerint nem a romantikán, hanem ezeken a stabil tulajdonságokon áll meg hosszú távon.",
        },
        { type: "h2", text: "5. A nehéz részek: megbocsátás és kitartás" },
        {
          type: "p",
          text: "A Biblia nem idealizálja a házasságot. Tudja, hogy a két ember között lesz konfliktus, sérelem, kifáradás. A megoldás nem a konfliktus elkerülése, hanem annak helyes kezelése.",
        },
        {
          type: "blockquote",
          text: "Ám haragudjatok, de ne vétkezzetek: a nap le ne menjen a ti haragotokon.",
          cite: "Efézus 4,26",
        },
        {
          type: "p",
          text: "Pál nem azt mondja, hogy „ne haragudjatok“ — azt mondja, hogy ne hagyjátok elmérgesedni. A „ne menjen le a nap a haragotokon“ gyakorlati tanács: a konfliktust nem érdemes magunkkal vinni a következő napba. Időben rendezni, kimondani, megbocsátani.",
        },
        {
          type: "p",
          text: "A megbocsátás a Biblia szerint nem érzés, hanem döntés. Nem azt jelenti, hogy elfelejtjük a sérelmet, hanem azt, hogy nem ezen építjük tovább a kapcsolatot.",
        },
        { type: "h2", text: "6. A közös út: Isten harmadik fonalként" },
        {
          type: "p",
          text: "A Prédikátor könyvének egy klasszikus szakasza nem közvetlenül a házasságról szól, de a magyarázók régóta a házassági szövetség képeként olvassák.",
        },
        {
          type: "blockquote",
          text: "Sokkal jobban van dolga a kettőnek, hogynem az egynek; mert azoknak jó jutalmok van az ő munkájokból.\n\nMert ha elesnek is, az egyik felemeli a társát.\n\nÉs ha az egyiket megtámadja is valaki, ketten ellene állhatnak annak; és a hármas kötél nem hamar szakad el.",
          cite: "Prédikátor 4,9-12",
        },
        {
          type: "p",
          text: "A „hármas kötél“ a keresztény értelmezésben a pár és Isten közös fonatát jelenti. A házasság ebben az olvasatban nem csak két ember kapcsolata, hanem három személyre szövődő közös jövő.",
        },
        {
          type: "p",
          text: "Ez magyarázza meg, miért tartják sokan a templomi esküvőt nem ünnepi formaiságnak, hanem a szövetségbe való beleállásnak: az eskü Isten színe előtt hangzik el, és az ő jelenlétét hívja be a közös életbe.",
        },
        { type: "h2", text: "7. Mit jelent ez a gyakorlatban?" },
        {
          type: "p",
          text: "Akár vallásosan élitek meg a házasságot, akár csak gondolkodtok ezekről a kérdéseken, három gyakorlati következtetés vehető ki belőle.",
        },
        { type: "h3", text: "A házasság nem csak két emberre tartozik" },
        {
          type: "p",
          text: "A bibliai logika szerint a házasság szövetség, és minden szövetséghez harmadik fél kell, aki előtt megkötitek. Ez magyarázza meg, miért fontos a nyilvános eskü, a tanúk és — hívő olvasatban — Isten jelenléte.",
        },
        { type: "h3", text: "A szeretet döntés, nem hangulat" },
        {
          type: "p",
          text: "A Biblia által leírt szeretet (héberül cheszed, görögül agapé) nem érzelmi állapot, hanem hűséges döntés. Ez különösen szabadító üzenet a hétköznapokban: a házasság nem áll meg azon, hogy mindketten mindig „érzitek“. Áll a döntésen, amit reggelente megújítotok.",
        },
        { type: "h3", text: "A megbocsátás napi gyakorlat" },
        {
          type: "p",
          text: "Két ember együttélése folyamatos sérelem-kezelés. A Biblia nem azt mondja, hogy ne legyen konfliktus — azt, hogy ne aludjatok rá. A „ne menjen le a nap a ti haragotokon“ a leggyakorlatibb házassági tanács, ami a Bibliában szerepel.",
        },
        {
          type: "cta",
          lead: "Ha az esküvő gyakorlati részét is szeretnétek nyugodtabban szervezni (vendéglista, költségvetés, RSVP, ültetés egy közös felületen), kezdjétek a Wēddly-ben.",
          href: "/signup",
          label: "Indítsátok el ingyen",
        },
        { type: "h2", text: "Gyakori kérdések" },
        { type: "h3", text: "Mit jelent, hogy a házasság szövetség?" },
        {
          type: "p",
          text: "A szövetség nem szerződés. A szerződés a felek érdekét védi és a másik kötelességszegésére bontható. A szövetség nyilvános, harmadik fél előtt tett elköteleződés, amely a hűséget nem a teljesítményhez, hanem a személyhez köti.",
        },
        { type: "h3", text: "Mit jelent az engedelmesség a házasságban?" },
        {
          type: "p",
          text: "Az Efézus 5,21 a kulcs: kölcsönös engedelmesség. Nem egyirányú alárendelés, hanem egymás iránti figyelem, alázat és tisztelet. A férjnek szóló parancs (Ef 5,25) sem uralmat ad, hanem áldozati szeretetet ír elő.",
        },
        { type: "h3", text: "Mit mond a Biblia a házasságon belüli konfliktusról?" },
        {
          type: "p",
          text: "A Szentírás nem tagadja a konfliktust, hanem keretet ad a kezeléséhez: őszinte beszéd (Ef 4,25), gyors megbékélés (Ef 4,26), kölcsönös megbocsátás (Kol 3,13). A konfliktus nem a házasság hibája, hanem a karbantartás terepe.",
        },
        { type: "h3", text: "Kötelező egyházi szertartást tartani?" },
        {
          type: "p",
          text: "Magyarországon a polgári szertartás a jogi szempontból elismert házasságkötés. Az egyházi szertartás vallási döntés és a szövetség nyilvános, Isten előtti kimondása. A kettő nem zárja ki egymást — sokan ugyanazon a napon tartják mindkettőt.",
        },
      ],
    },
    en: {
      title: "Why marry, according to the Bible?",
      lead: "Creation order, covenant, Jesus' teaching and the everyday programme: how Scripture reads the meaning of marriage.",
      seo_title: "Why marry according to the Bible? · Weddly",
      seo_description:
        "What does the Bible say about the meaning of marriage? Creation order, covenant, Jesus' teaching and Paul's practical programme.",
      body: [
        {
          type: "p",
          text: "Many couples reach the question mid-planning: what is marriage actually for? Tradition? Romance? Paperwork? The Bible offers more: it sees marriage as a gift built into creation, with an inner structure worth understanding.",
        },
        {
          type: "p",
          text: "This post isn't dogmatic instruction. It's a thoughtful read of what Scripture says about the meaning of marriage and why it can still help today — whether you're religious or simply curious.",
        },
        { type: "h2", text: "1. Creation: it is not good to be alone" },
        {
          type: "p",
          text: "Genesis doesn't open with marriage, but it gets there quickly. Chapter 2 states plainly that being alone is not completion but lack.",
        },
        {
          type: "blockquote",
          text: "And the Lord God said, It is not good that the man should be alone; I will make him an help meet for him.",
          cite: "Genesis 2:18",
        },
        {
          type: "p",
          text: 'The Hebrew "help meet" (ezer kenegdo) is far stronger than "assistant". It means an equal counterpart who completes, mirrors and corrects. Marriage here isn\'t hierarchy; it\'s encounter.',
        },
        {
          type: "blockquote",
          text: "Therefore shall a man leave his father and his mother, and shall cleave unto his wife: and they shall be one flesh.",
          cite: "Genesis 2:24",
        },
        {
          type: "p",
          text: "Three moves in sequence: leaving, cleaving, becoming one. Marriage forms a new family; it doesn't replace the old, but it takes primary place. Scripture returns to this sequence again and again as the foundation of marriage.",
        },
        { type: "h2", text: "2. Marriage is a covenant, not a contract" },
        {
          type: "p",
          text: "The Bible's recurring category for marriage is covenant (Hebrew berit). A contract protects each party's interest and dissolves on breach. A covenant is unconditional commitment in the presence of God — faithfulness tied to a person, not to performance.",
        },
        {
          type: "blockquote",
          text: "Because the Lord hath been witness between thee and the wife of thy youth, against whom thou hast dealt treacherously: yet is she thy companion, and the wife of thy covenant.",
          cite: "Malachi 2:14",
        },
        {
          type: "p",
          text: "Malachi anchors marriage in God's witness. \"Wife of thy covenant\" uses the same vocabulary the Bible uses for God's covenant with his people. Marriage, in this logic, is a public commitment made before a third party.",
        },
        { type: "h2", text: "3. Jesus reaffirms the original order" },
        {
          type: "p",
          text: "When Jesus is asked about divorce, his answer doesn't start with divorce. It points back to creation.",
        },
        {
          type: "blockquote",
          text: "Have ye not read, that he which made them at the beginning made them male and female,\n\nAnd said, For this cause shall a man leave father and mother, and shall cleave to his wife: and they twain shall be one flesh?\n\nWhat therefore God hath joined together, let not man put asunder.",
          cite: "Matthew 19:4-6",
        },
        {
          type: "p",
          text: "Jesus offers no new teaching here — he reinforces the creation order. Marriage is a covenant God joins together. \"One flesh\" isn't only physical: it's a fusion of two whole lives.",
        },
        { type: "h2", text: "4. The everyday programme: Paul's letters" },
        {
          type: "p",
          text: "Ephesians 5 is the key passage couples often misread by picking out one verse. The opening line frames the whole thing.",
        },
        {
          type: "blockquote",
          text: "Submitting yourselves one to another in the fear of God.\n\nHusbands, love your wives, even as Christ also loved the church, and gave himself for it.",
          cite: "Ephesians 5:21, 25",
        },
        {
          type: "p",
          text: "Verse 21 sets the tone: mutual submission. Verse 25 commands the husband to sacrificial love modelled on Christ, not domination. Without that opening framing, the passage gets distorted.",
        },
        { type: "p", text: "Colossians 3 turns to the daily work of marriage." },
        {
          type: "blockquote",
          text: "Put on therefore, as the elect of God, holy and beloved, bowels of mercies, kindness, humbleness of mind, meekness, longsuffering;\n\nForbearing one another, and forgiving one another, if any man have a quarrel against any;\n\nAnd above all these things put on charity, which is the bond of perfectness.",
          cite: "Colossians 3:12-14",
        },
        {
          type: "p",
          text: "Not peak moments. Daily virtues: mercy, kindness, patience, forgiveness. Scripture grounds marriage in these durable qualities, not in romance alone.",
        },
        { type: "h2", text: "5. Conflict and forgiveness" },
        {
          type: "p",
          text: "The Bible doesn't idealise marriage. It assumes there will be conflict, hurt, fatigue. The answer isn't avoidance but proper handling.",
        },
        {
          type: "blockquote",
          text: "Be ye angry, and sin not: let not the sun go down upon your wrath.",
          cite: "Ephesians 4:26",
        },
        {
          type: "p",
          text: "Paul doesn't say \"don't be angry\". He says don't let it fester. \"Don't carry it into tomorrow\" is one of the most practical pieces of marriage advice in Scripture. Resolve it, speak it, forgive.",
        },
        { type: "h2", text: "6. The threefold cord" },
        {
          type: "p",
          text: "A classic passage from Ecclesiastes isn't directly about marriage, but readers have long heard it as a covenant image.",
        },
        {
          type: "blockquote",
          text: "Two are better than one; because they have a good reward for their labour.\n\nFor if they fall, the one will lift up his fellow.\n\nAnd if one prevail against him, two shall withstand him; and a threefold cord is not quickly broken.",
          cite: "Ecclesiastes 4:9-12",
        },
        {
          type: "p",
          text: 'In the Christian reading, the "threefold cord" is the couple plus God. Marriage here isn\'t a two-person relationship but a three-thread shared future. This is why many couples treat the church ceremony less as formality and more as stepping into the covenant.',
        },
        { type: "h2", text: "7. Practical takeaways" },
        { type: "h3", text: "Marriage is not only between two people" },
        {
          type: "p",
          text: "Biblically, marriage is a covenant, and every covenant needs a third party. That's why the public vow, the witnesses and — in the believing reading — God's presence matter.",
        },
        { type: "h3", text: "Love is a decision, not a mood" },
        {
          type: "p",
          text: 'Biblical love (Hebrew chesed, Greek agape) is not a feeling but a faithful choice. Marriage doesn\'t stand or fall on whether you both "feel it" today. It stands on the decision you renew each morning.',
        },
        { type: "h3", text: "Forgiveness is a daily practice" },
        {
          type: "p",
          text: "Two lives together means a steady stream of small hurts. The Bible doesn't ask for no conflict — it asks you not to sleep on it. \"Don't let the sun go down on your wrath\" is the most practical marriage advice in Scripture.",
        },
        {
          type: "cta",
          lead: "If you'd also like to handle the practical side of the wedding (guest list, budget, RSVP, seating) in one place, start with Weddly.",
          href: "/signup",
          label: "Start free",
        },
        { type: "h2", text: "FAQ" },
        { type: "h3", text: "What does it mean that marriage is a covenant?" },
        {
          type: "p",
          text: "A covenant is not a contract. Contracts protect each party's interest and dissolve on breach. A covenant is a public, third-party commitment tying faithfulness to a person rather than to performance.",
        },
        { type: "h3", text: "What does submission mean in marriage?" },
        {
          type: "p",
          text: "Ephesians 5:21 is the key: mutual submission. Not one-way subordination, but attention, humility and respect for each other. The husband's command (Eph 5:25) is sacrificial love, not domination.",
        },
        { type: "h3", text: "What does the Bible say about conflict?" },
        {
          type: "p",
          text: "Scripture doesn't deny conflict. It gives a framework: speak truthfully (Eph 4:25), reconcile quickly (Eph 4:26), forgive each other (Col 3:13). Conflict isn't marriage's flaw — it's its maintenance ground.",
        },
        { type: "h3", text: "Do you have to have a church ceremony?" },
        {
          type: "p",
          text: "Civil ceremonies handle the legal side. A church ceremony is a faith decision and a public vow before God. The two aren't exclusive — many couples have both on the same day.",
        },
      ],
    },
  },
  // ── 0. Bibliai idézetek ────────────────────────────────────────────
  {
    slug: "bibliai-idezetek-eskuvore",
    published_at: "2026-05-27",
    read_minutes: 9,
    category: { hu: "Idézetek", en: "Verses" },
    hu: {
      title: "Bibliai idézetek esküvőre: Károli igék szeretetről, házasságról és közös útról",
      lead: "Összegyűjtöttük a legszebb bibliai igéket Károli nyelvezetben: szeretetről, házasságról, hűségről, megbocsátásról és közös útról.",
      seo_title: "Bibliai idézetek esküvőre: 30+ Károli ige szeretetről és házasságról",
      seo_description:
        "Összegyűjtöttük a legszebb bibliai idézeteket esküvőre Károli nyelvezetben: igék szeretetről, házasságról, hűségről, megbocsátásról és közös útról.",
      body: [
        {
          type: "p",
          text: "Sokan keresnek esküvőre bibliai idézetet, amit beleírnak a meghívóba, az esküvői weboldalra vagy a fogadalom mellé. Ez a poszt egy bővített, kategóriákra bontott Károli-gyűjtemény: igék szeretetről, házasságról, közös útról, tiszteletről és megbocsátásról.",
        },
        {
          type: "p",
          text: "A Károli fordítást azért használjuk, mert a magyar esküvői hagyományban ez a klasszikus, ünnepélyes hangulat. Ha modernebb fordítást kerestek, a Magyar Bibliatársulat új fordítása vagy az Egyszerű fordítás is jó alternatíva. A blog végén GYIK-ben kitérünk erre is.",
        },
        { type: "h2", text: "Rövid bibliai idézetek esküvői meghívóra" },
        {
          type: "p",
          text: "Ezeket a rövid igéket jól lehet használni meghívón, ültetőkártyán, esküvői weboldal nyitólapon vagy a vendégkönyv mottójaként.",
        },
        {
          type: "ul",
          items: [
            "„Ezek között pedig legnagyobb a szeretet.” — 1Korinthus 13,13",
            "„Minden dolgotok szeretetben menjen végbe!” — 1Korinthus 16,14",
            "„Szeretteim, szeressük egymást.” — 1János 4,7",
            "„Az Isten szeretet.” — 1János 4,8",
            "„A szeretetben nincsen félelem.” — 1János 4,18",
            "„Nem jó az embernek egyedül lenni.” — 1Mózes 2,18",
            "„Lesznek ketten egy testté.” — Márk 10,8",
            "„Amit az Isten egybe szerkesztett, ember el ne válassza.” — Márk 10,9",
            "„A hármas kötél nem hamar szakad el.” — Prédikátor 4,12",
            "„Az én szerelmesem enyém, és én az övé.” — Énekek éneke 2,16",
            "„Erős a szeretet, mint a halál.” — Énekek éneke 8,6",
            "„Sok vizek el nem olthatnák e szeretetet.” — Énekek éneke 8,7",
            "„A tiszteletadásban egymást megelőzők legyetek.” — Róma 12,10",
            "„Legyetek pedig egymáshoz jóságosak, irgalmasok.” — Efézus 4,32",
            "„Öltözzétek föl a szeretetet.” — Kolossé 3,14",
          ],
        },
        { type: "h2", text: "Bibliai idézetek a szeretetről" },
        { type: "h3", text: "1Korinthus 13,1-3" },
        {
          type: "blockquote",
          text: "Ha embereknek vagy angyaloknak nyelvén szólok is, szeretet pedig nincsen én bennem, olyanná lettem, mint a zengő érc vagy pengő cimbalom.\n\nÉs ha jövendőt tudok is mondani, és minden titkot és minden tudományt ismerek is; és ha egész hitem van is, úgyannyira, hogy hegyeket mozdíthatok ki helyökről, szeretet pedig nincsen én bennem, semmi vagyok.\n\nÉs ha vagyonomat mind felétetem is, és ha testemet tűzre adom is, szeretet pedig nincsen én bennem, semmi hasznom abból.",
          cite: "1Korinthus 13,1-3",
        },
        {
          type: "p",
          text: "Pál azzal nyitja a szeretet himnuszát, hogy mindent elvesz, amibe kapaszkodni szoktunk: a szavak fényét, a tudást, a hitet, sőt még az áldozatot is. Ha mindezt szeretet nélkül tesszük, csak zaj marad belőle. Kemény mérce, de épp ezért szabadító: a házasságban sem az számít majd, mennyit teljesítünk a másikért, hanem hogy az egész életünknek van-e egy szelíd, türelmes forrása.",
        },
        { type: "h3", text: "1Korinthus 13,4-8" },
        {
          type: "blockquote",
          text: "A szeretet hosszútűrő, kegyes; a szeretet nem irígykedik, a szeretet nem kérkedik, nem fuvalkodik fel.\n\nNem cselekszik éktelenül, nem keresi a maga hasznát, nem gerjed haragra, nem rójja fel a gonoszt,\n\nNem örül a hamisságnak, de együtt örül az igazsággal;\n\nMindent elfedez, mindent hiszen, mindent remél, mindent eltűr.\n\nA szeretet soha el nem fogy.",
          cite: "1Korinthus 13,4-8",
        },
        {
          type: "p",
          text: "Pál itt szinte lebontja a szeretetet: nem érzésként, hanem mozdulatokként mutatja meg. Türelem, jóság, alázat, kitartás — olyan szavak, amelyeket csak a hétköznapokban lehet megtanulni. A házasság éppen ezt a lassú iskolát kínálja: napról napra gyakorolni azt, ami soha el nem fogy.",
        },
        { type: "h3", text: "1Korinthus 13,11-13" },
        {
          type: "blockquote",
          text: "Mikor gyermek valék, úgy szóltam, mint gyermek, úgy gondolkodtam, mint gyermek, úgy értettem, mint gyermek: minekutána pedig férfiúvá lettem, elhagytam a gyermekhez illő dolgokat.\n\nMert most tükör által homályosan látunk, akkor pedig színről színre; most rész szerint van bennem az ismeret, akkor pedig úgy ismerek majd, amint én is megismertettem.\n\nMost azért megmarad a hit, remény, szeretet, e három; ezek között pedig legnagyobb a szeretet.",
          cite: "1Korinthus 13,11-13",
        },
        {
          type: "p",
          text: "Pál saját felnőtté válásával vall: van, amit csak idővel értünk meg igazán. A szeretet sem áll meg a kezdeti rajongásnál — érlelődik, mélyül, és lassan megtanul látni a homályon át. A házasság ennek a növekedésnek ad teret: együtt indulni el gyermeki örömmel, és együtt érkezni meg a hűség csendesebb, érettebb szeretetébe.",
        },
        { type: "h3", text: "1János 4,7-8" },
        {
          type: "blockquote",
          text: "Szeretteim, szeressük egymást: mert a szeretet az Istentől van; és mindaz, aki szeret, az Istentől született, és ismeri az Istent.\n\nAki nem szeret, nem ismerte meg az Istent; mert az Isten szeretet.",
          cite: "1János 4,7-8",
        },
        {
          type: "p",
          text: "János egészen mélyre megy: ahol szeretet van, ott Isten van — még akkor is, ha nem nevezzük néven. A szeretet nem a mi találmányunk, hanem visszhang valami nagyobbra. Két ember egymáshoz fordulása így mindig több önmagánál: az Istentől kapott szeretetet adjuk tovább, valahányszor szelíden választjuk a másikat.",
        },
        { type: "h3", text: "1János 4,11-12" },
        {
          type: "blockquote",
          text: "Szeretteim, ha így szeretett minket az Isten, nekünk is szeretnünk kell egymást.\n\nAz Istent soha senki nem látta: Ha szeretjük egymást, az Isten bennünk marad, és az ő szeretete teljessé lett bennünk.",
          cite: "1János 4,11-12",
        },
        {
          type: "p",
          text: "János itt valami megrendítőt mond: Istent senki nem látta, de ha szeretjük egymást, mégis láthatóvá lesz közöttünk. A házasság így titkos szolgálat is — a házastárs felé kinyújtott kéz, a meghallgatott panasz, az újra és újra kimondott „bocsáss meg" mind kis ablakok arra, hogy Isten szeretete bennünk lakást vesz.",
        },
        { type: "h3", text: "1János 4,16-18" },
        {
          type: "blockquote",
          text: "És mi megismertük és elhittük az Istennek irántunk való szeretetét.\n\nAz Isten szeretet; és aki a szeretetben marad, az Istenben marad, és az Isten is ő benne.\n\nA szeretetben nincsen félelem; sőt a teljes szeretet kiűzi a félelmet.",
          cite: "1János 4,16-18",
        },
        {
          type: "p",
          text: "A szeretetben nincs félelem — nem mert nincsenek nehézségek, hanem mert van valaki, akiben végre megnyughatunk. János azt mondja, ez a megnyugvás végül Istenből árad. A házasságban ez a tapasztalat formát kap: van otthon, ahol nem kell védekezni, és van társ, aki előtt nem kell tökéletesnek látszani.",
        },
        { type: "h2", text: "Bibliai idézetek házasságról" },
        { type: "h3", text: "1Mózes 2,18" },
        {
          type: "blockquote",
          text: "És monda az Úr Isten: Nem jó az embernek egyedül lenni; szerzek néki segítő társat, hozzá illőt.",
          cite: "1Mózes 2,18",
        },
        {
          type: "p",
          text: "Az egész teremtésben ez az első dolog, amiről Isten azt mondja: „nem jó". Nem jó egyedül. Nem hiány, nem hiba — egyszerűen az ember természete, hogy társra van szabva. A házasság ennek a vágynak ad nevet és helyet: két élet azért fordul egymás felé, mert egyikünk sem teljes magában.",
        },
        { type: "h3", text: "1Mózes 2,21-24" },
        {
          type: "blockquote",
          text: "Bocsáta tehát az Úr Isten mély álmot az emberre, és ez elaluvék. Akkor kivőn egyet annak oldalbordái közül, és hússal tölté be annak helyét.\n\nÉs alkotá az Úr Isten azt az oldalbordát, amelyet kivett vala az emberből, asszonynyá, és vivé az emberhez.\n\nÉs monda az ember: Ez már csontomból való csont, és testemből való test.\n\nAnnakokáért elhagyja a férfiú az ő atyját és az ő anyját, és ragaszkodik feleségéhez: és lesznek egy testté.",
          cite: "1Mózes 2,21-24",
        },
        {
          type: "p",
          text: "Megrendítő kép: a társ nem kívülről érkezik, hanem az ember legmélyebb belsejéből vétetik. Ezért szól a felismerés is így: „csontomból való csont". A házasság nem két idegen találkozása, hanem két élet egymásra ismerése — és az elhagyás, ragaszkodás, eggyé válás mozdulatában új otthon születik.",
        },
        { type: "h3", text: "Máté 19,4-6" },
        {
          type: "blockquote",
          text: "Ő pedig felelvén, monda: Nem olvastátok-é, hogy a teremtő kezdettől fogva férfiúvá és asszonynyá teremté őket,\n\nÉs ezt mondá: Annak okáért elhagyja a férfiú atyját és anyját; és ragaszkodik feleségéhez, és lesznek ketten egy testté.\n\nÚgy hogy többé nem kettő, hanem egy test. Amit azért az Isten egybeszerkesztett, ember el ne válassza.",
          cite: "Máté 19,4-6",
        },
        {
          type: "p",
          text: "Jézus a kezdetekhez nyúl vissza: a házasság nem emberi szerződés, hanem Isten összeszerkesztése. Ez a szó — egybeszerkeszt — gyengéd és kemény egyszerre: nem két különálló élet összetolása, hanem egy új egész készítése. Ezért szólal meg a folytatás komolyan: amit Ő szerkesztett egybe, azt ne bontsa szét emberi kéz.",
        },
        { type: "h3", text: "Márk 10,6-9" },
        {
          type: "blockquote",
          text: "De a teremtés kezdete óta férfiúvá és asszonnyá teremté őket az Isten.\n\nAnnakokáért elhagyja az ember az ő atyját és anyját; és ragaszkodik a feleségéhez,\n\nÉs lesznek ketten egy testté! Azért többé nem két, hanem egy test.\n\nAnnakokáért amit az Isten egybe szerkesztett, ember el ne válassza.",
          cite: "Márk 10,6-9",
        },
        {
          type: "p",
          text: "Márknál Jézus szinte ugyanazokkal a szavakkal beszél, mintha külön nyomatékot kapna: a házasság nem újkori találmány, hanem ott áll a teremtés kezdeténél. Férfi és nő egymás felé fordulása Isten szándékának része — és ez a szándék azóta is hordozza azokat a párokat, akik egymásnak igent mondanak.",
        },
        { type: "h3", text: "Efézus 5,21" },
        {
          type: "blockquote",
          text: "Engedelmesek legyetek egymásnak Isten félelmében.",
          cite: "Efézus 5,21",
        },
        {
          type: "p",
          text: "Pál egyetlen mondatban felforgatja a házasságról szóló gondolatokat: egymásnak engedelmeskedjetek. Nem egyikőtök a másiknak, hanem mindketten — és ezt nem külső kényszerből, hanem Isten iránti tiszteletből. Ez a kölcsönös meghajlás a házasság csendes alapja: nincs benne győztes és vesztes, csak két ember, aki naponta odafigyel a másikra.",
        },
        { type: "h3", text: "Efézus 5,25" },
        {
          type: "blockquote",
          text: "Ti férfiak, szeressétek a ti feleségeteket, miképpen a Krisztus is szerette az egyházat, és Önmagát adta azért.",
          cite: "Efézus 5,25",
        },
        {
          type: "p",
          text: "Pál Krisztus mércéjéhez köti a férj szeretetét: úgy, ahogy ő szerette az egyházat — vagyis önmagát adva. Ebben nincs hatalom, csak odaajándékozás. Aki így szeret, nem azt nézi, mit kap a társától, hanem azt, mit ad oda magából. Ez a fajta szeretet nem teljesítmény, hanem napról napra megújuló döntés.",
        },
        { type: "h3", text: "Efézus 5,28-33" },
        {
          type: "blockquote",
          text: "Úgy kell a férfiaknak szeretni az ő feleségöket, mint az ő tulajdon testöket. Aki szereti az ő feleségét, önmagát szereti.\n\nMert soha senki az ő tulajdon testét nem gyűlölte; hanem táplálgatja és ápolgatja azt, miképpen az Úr is az egyházat.\n\nAnnakokáért elhagyja az ember atyját és anyját, és ragaszkodik az ő feleségéhez; és lesznek ketten egy testté.\n\nHanem azért ti is egyen-egyen, ki-ki az ő feleségét úgy szeresse, mint önmagát.",
          cite: "Efézus 5,28-33",
        },
        {
          type: "p",
          text: "Pál egyszerű képpel beszél: a társadat úgy szereted, mint a saját testedet — táplálod, ápolod, óvod. Nem hősies áldozatról van szó, hanem a hétköznapi gondoskodásról: észrevenni, ha fáradt, lassítani, ha túl gyorsan élünk. A házasságban így lesz a szeretet láthatóvá: nem szavakban, hanem abban, ahogy egymással bánunk.",
        },
        { type: "h2", text: "Bibliai idézetek közös útról és kitartásról" },
        { type: "h3", text: "Prédikátor 4,9-10" },
        {
          type: "blockquote",
          text: "Sokkal jobban van dolga a kettőnek, hogynem az egynek; mert azoknak jó jutalmok van az ő munkájokból.\n\nMert ha elesnek is, az egyik felemeli a társát.",
          cite: "Prédikátor 4,9-10",
        },
        {
          type: "p",
          text: "A Prédikátor józanul beszél: az életben elesünk. Nem ha, hanem amikor. És ebben a tényben rejlik a társ ajándéka — nem azért jó kettesben, mert így minden könnyebb, hanem mert van, aki a porból felemel. A házasság ezt a hűséget vállalja: ott lenni, amikor a másik a földön van.",
        },
        { type: "h3", text: "Prédikátor 4,11-12" },
        {
          type: "blockquote",
          text: "Hogyha együtt feküsznek is ketten, megmelegszenek; az egyedülvaló pedig mimódon melegedhetik meg?\n\nÉs ha az egyiket megtámadja is valaki, ketten ellene állhatnak annak; és a hármas kötél nem hamar szakad el.",
          cite: "Prédikátor 4,11-12",
        },
        {
          type: "p",
          text: “A hármas kötél képe meghitt és erős egyszerre: két szál önmagában könnyen elszakad, három már kitart. Sokan úgy olvassák, hogy a házasság sem csupán két ember dolga — Isten a harmadik szál, aki a kötést tartja, amikor a mi erőnk fogytán van. A meleg, az oltalom, a kitartás mind innen ered.”,
        },
        { type: "h3", text: "Ruth 1,16-17" },
        {
          type: "blockquote",
          text: "Ne unszolj engem, hogy elhagyjalak, hogy visszaforduljak tőled. Mert ahová te mégy, oda megyek, és ahol te megszállsz, ott szállok meg; néped az én népem, és Istened az én Istenem.\n\nAhol te meghalsz, ott halok meg, ott temessenek el engem is.",
          cite: "Ruth 1,16-17",
        },
        {
          type: "p",
          text: "Ruth szavai egy idős asszony mellé szegődő fiatalasszony szájából hangzanak el, mégis a házassági fogadalom legszebb visszhangja él bennük. Nemcsak hozzád megyek — a néped, az Istened, az életed is az enyém lesz. Ez a teljes odakötődés a házasság szíve: nem feltételek mellett, hanem a sors közös vállalásában.",
        },
        { type: "h3", text: "Zsoltárok 143,8" },
        {
          type: "blockquote",
          text: "Korán hallasd velem kegyelmedet, mert bízom benned; jelentsd meg nékem az útat, melyen járjak, mert hozzád emelem lelkemet.",
          cite: "Zsoltárok 143,8",
        },
        {
          type: "p",
          text: "A zsoltáros nem tudja, merre tovább, ezért reggel azt kéri: hadd halljam meg a te kegyelmedet. Két ember közös indulásának is ez a csendes formája: nem mi tudunk mindent előre, de van Valaki, aki vezet. A bizalom nem a tisztánlátásból fakad, hanem abból, hogy felemeljük a lelkünket arra, aki ismeri az utat.",
        },
        { type: "h3", text: "Példabeszédek 3,3-4" },
        {
          type: "blockquote",
          text: "Az irgalmasság és igazság ne hagyjanak el téged: kösd azokat a te nyakadra, írd be azokat a te szívednek táblájára;\n\nÍgy nyersz kedvességet és jó értelmet Istennek és embernek szemei előtt.",
          cite: "Példabeszédek 3,3-4",
        },
        {
          type: "p",
          text: "„Kösd a nyakadra, írd a szíved táblájára" — gyengéd, mégis komoly kép. A bölcs nem érzelmet ajánl, hanem mindennap viselt ékszert: az irgalmasságot és az igazságot. A házasság éppen ilyen viselet — nem ünneplő ruha, hanem a szívre írt szövetség, amiben végül mind kedvesebbé válunk Isten és ember előtt.",
        },
        { type: "h2", text: "Bibliai idézetek tiszteletről és megbocsátásról" },
        { type: "h3", text: "Efézus 4,1-3" },
        {
          type: "blockquote",
          text: "Kérlek azért titeket én, ki fogoly vagyok az Úrban, hogy járjatok úgy, mint illik elhívatásotokhoz, melylyel elhívattatok.\n\nTeljes alázatossággal és szelídséggel, hosszútűréssel, elszenvedvén egymást szeretetben,\n\nIgyekezvén megtartani a Lélek egységét a békességnek kötelében.",
          cite: "Efézus 4,1-3",
        },
        {
          type: "p",
          text: "Pál nem ünnepi szavakat ad, hanem a közös út ruháját: alázat, szelídség, hosszú tűrés, szeretetben hordozni egymást. Ezek nem hangzatosak, mégis ezek tartják meg a békességet, amikor két élet egymáshoz csiszolódik. A házasság nagy döntései után a hétköznapi apró döntések tartják fenn ezt az egységet.",
        },
        { type: "h3", text: "Efézus 4,25-26" },
        {
          type: "blockquote",
          text: "Azért levetvén a hazugságot, szóljatok igazságot, kiki az ő felebarátjával: mert egymásnak tagjai vagyunk.\n\nÁm haragudjatok, de ne vétkezzetek: a nap le ne menjen a ti haragotokon.",
          cite: "Efézus 4,25-26",
        },
        {
          type: "p",
          text: "Pál meglepően gyakorlati: ne hazudjatok egymásnak, és ha haragudtok, ne hagyjátok ott éjszakára. Mintha tudná, milyen az, amikor két ember egy fedél alatt él. A házasság nem a konfliktus elkerülésétől szép, hanem attól, hogy az igazságot szelíden ki merjük mondani, és a békét újra meg újra megkeressük, mielőtt a nap lemegy.",
        },
        { type: "h3", text: "Efézus 4,31-32" },
        {
          type: "blockquote",
          text: "Minden mérgesség és fölgerjedés és harag és lárma és káromkodás kivettessék közületek minden gonoszsággal együtt;\n\nLegyetek pedig egymáshoz jóságosak, irgalmasok, megengedvén egymásnak, miképpen az Isten is a Krisztusban megengedett néktek.",
          cite: "Efézus 4,31-32",
        },
        {
          type: "p",
          text: "Pál a megbocsátást nem érzelemnek tartja, hanem öltözéknek: levetni a haragot, fölvenni a jóságot. És a mérce nem az, hogy a másik megérdemli-e — hanem hogy Krisztus is megengedett nekünk. A házasságban itt dől el sok minden: meddig hordozzuk a sérelmet, és mikor merjük letenni azzal, hogy mi is kaptunk kegyelmet.",
        },
        { type: "h3", text: "Róma 12,9-10" },
        {
          type: "blockquote",
          text: "A szeretet képmutatás nélkül való legyen. Iszonyodjatok a gonosztól, ragaszkodjatok a jóhoz.\n\nAtyafiúi szeretettel egymás iránt gyöngédek; a tiszteletadásban egymást megelőzők legyetek.",
          cite: "Róma 12,9-10",
        },
        {
          type: "p",
          text: "Pál egy mondatban két olyan dolgot köt össze, amit könnyű szétválasztani: szeretet és tisztelet. „A tiszteletadásban egymást megelőzők legyetek" — vagyis ne azt várjuk, hogy minket vegyenek észre, hanem mi vegyük észre a másikat először. A házasságban ez a gyengédség óvja a szeretetet attól, hogy egy idő után megszokássá fakuljon.",
        },
        { type: "h3", text: "Kolossé 3,12-14" },
        {
          type: "blockquote",
          text: "Öltözzétek föl azért mint az Istennek választottai, szentek és szeretettek, könyörületes szívet, jóságosságot, alázatosságot, szelídséget, hosszútűrést;\n\nElszenvedvén egymást és megbocsátván kölcsönösen egymásnak, ha valakinek valaki ellen panasza volna; miképen a Krisztus is megbocsátott néktek, akképen ti is;\n\nMindezeknek fölébe pedig öltözzétek föl a szeretetet, mint amely a tökéletességnek kötele.",
          cite: "Kolossé 3,12-14",
        },
        {
          type: "p",
          text: "Pál öltözködésről beszél: a hívő ember mindennap fölveszi a könyörületet, a jóságot, az alázatot, a szelídséget, a türelmet — és mindezek fölé a szeretetet, mint köpenyt. A házasság sem máshogy működik: nem érzelmi állapot, amit megkapunk, hanem ruha, amit reggelente magunkra veszünk, és amiben a másikhoz fordulunk.",
        },
        { type: "h2", text: "Romantikus bibliai idézetek az Énekek énekéből" },
        { type: "h3", text: "Énekek éneke 2,10-13" },
        {
          type: "blockquote",
          text: "Szóla az én szerelmesem, és monda nékem: Kelj fel én mátkám, én szépem, és jőjj.\n\nMert ímé a tél elmúlt, az eső elmúlt, elment.\n\nVirágok láttatnak a földön, az éneklésnek ideje eljött.",
          cite: "Énekek éneke 2,10-13",
        },
        {
          type: "p",
          text: "„Kelj fel, én mátkám, és jöjj" — a Vőlegény hangja hív, és a tél, az eső, a sötétség elmúlt. Az Énekek éneke itt valami nagyobbat is sejtet: nem csak a szerelmesek tavasza ez, hanem minden új kezdet képe. A házasság is ilyen hívás — a régi magány tele véget ér, és kezdődik az énekek és virágok ideje.",
        },
        { type: "h3", text: "Énekek éneke 2,16" },
        {
          type: "blockquote",
          text: "Az én szerelmesem enyém, és én az övé.",
          cite: "Énekek éneke 2,16",
        },
        {
          type: "p",
          text: "Az egész szövetséget egyetlen mondatba sűríti: az enyém, és én az övé. Nincs feltétel, nincs magyarázkodás — csak ez a kölcsönös odatartozás. A házasság szíve is ez: nem birtoklás, hanem örömteli kimondása annak, hogy életünk innentől már nem két külön történet.",
        },
        { type: "h3", text: "Énekek éneke 4,7" },
        {
          type: "blockquote",
          text: "Mindenestől szép vagy, én mátkám, és semmi szeplő nincs benned!",
          cite: "Énekek éneke 4,7",
        },
        {
          type: "p",
          text: "Bensőséges idézet. Inkább meghívóra, fogadalom mellé vagy kreatív esküvői weboldalra illik.",
        },
        { type: "h3", text: "Énekek éneke 8,6-7" },
        {
          type: "blockquote",
          text: "Tégy engem mint egy pecsétet a te szívedre, mint egy pecsétet a te karodra; mert erős a szeretet, mint a halál.\n\nSok vizek el nem olthatnák e szeretetet, a folyóvizek sem boríthatnák el azt.",
          cite: "Énekek éneke 8,6-7",
        },
        {
          type: "p",
          text: "Az egyik legszebb költői bibliai idézet a szeretetről. Kifejezetten jó elegáns meghívóra vagy szertartásfüzetbe.",
        },
        { type: "h2", text: "Melyik bibliai idézet illik hozzátok?" },
        {
          type: "p",
          text: "Néhány gondolat a választáshoz: gondoljatok arra, milyen hangulatot szeretnétek megütni. A klasszikus, ünnepélyes Károli-szöveg illik a templomi esküvőhöz; az Énekek éneke költőibb, jobban illik szabadtéri, romantikus szertartáshoz. Ha rövid igét akartok a meghívóra, az 1Korinthus 13,13 vagy az Énekek éneke 2,16 mindig jól mutat.",
        },
        {
          type: "p",
          text: "Ha vegyes vallású vendégkör jön, érdemes egy olyan igét választani, amely Istentől függetlenül is érthető emberközeli üzenetet hordoz — például a Prédikátor 4 vagy a Kolossé 3.",
        },
        {
          type: "cta",
          lead: "Ha az esküvőtök szervezésében is rendet szeretnétek (vendéglista, költségvetés, RSVP, ültetés egy helyen), próbáljátok ki a Wēddly-t.",
          href: "/signup",
          label: "Ingyenes indítás",
        },
        { type: "h2", text: "Gyakori kérdések" },
        { type: "h3", text: "Melyik a legismertebb bibliai idézet esküvőre?" },
        {
          type: "p",
          text: "Az egyik legismertebb az 1Korinthus 13, különösen a szeretet himnusza: „A szeretet hosszútűrő, kegyes…” és a záró gondolat: „legnagyobb a szeretet”.",
        },
        { type: "h3", text: "Melyik bibliai idézet jó esküvői meghívóra?" },
        {
          type: "p",
          text: "Rövid meghívóra jó választás az 1Korinthus 13,13, az 1János 4,7, a Prédikátor 4,12 vagy az Énekek éneke 2,16.",
        },
        { type: "h3", text: "Melyik bibliai idézet szól a házasságról?" },
        {
          type: "p",
          text: "A házasságról szóló legismertebb igék közé tartozik az 1Mózes 2,24, a Máté 19,4-6 és a Márk 10,6-9.",
        },
        { type: "h3", text: "Melyik bibliai idézet szól a szeretetről?" },
        {
          type: "p",
          text: "Az 1Korinthus 13, az 1János 4 és az Énekek éneke 8 különösen szép szakaszokat tartalmaz a szeretetről.",
        },
        { type: "h3", text: "Károli vagy új fordítású idézetet válasszunk?" },
        {
          type: "p",
          text: "A Károli ünnepélyesebb, klasszikusabb hangulatú. Az új fordítás közérthetőbb és modernebb. Esküvői blogban érdemes Károlit idézni, és mellé rövid, saját magyarázatot írni.",
        },
      ],
    },
    en: {
      title: "Bible verses for your wedding: love, marriage and shared life",
      lead: "A curated set of Bible verses (KJV) for invitations, ceremonies and vows: love, marriage, faithfulness and forgiveness.",
      seo_title: "Bible verses for weddings: KJV passages on love and marriage · Weddly",
      seo_description:
        "A curated set of Bible verses for weddings in the KJV translation: love, marriage, faithfulness, forgiveness and shared life.",
      body: [
        {
          type: "p",
          text: "Many couples want a Bible verse on the invitation, on the wedding website, or as part of the vows. Below is a curated KJV set, grouped by theme: love, marriage, shared life, respect and forgiveness.",
        },
        { type: "h2", text: "Short verses for invitations" },
        {
          type: "ul",
          items: [
            '"The greatest of these is love." — 1 Corinthians 13:13',
            '"Let all your things be done with charity." — 1 Corinthians 16:14',
            '"Beloved, let us love one another." — 1 John 4:7',
            '"God is love." — 1 John 4:8',
            '"There is no fear in love." — 1 John 4:18',
            '"It is not good that the man should be alone." — Genesis 2:18',
            '"They twain shall be one flesh." — Mark 10:8',
            '"What God hath joined together, let not man put asunder." — Mark 10:9',
            '"A threefold cord is not quickly broken." — Ecclesiastes 4:12',
            '"I am my beloved\'s, and my beloved is mine." — Song of Solomon 2:16',
            '"Love is strong as death." — Song of Solomon 8:6',
          ],
        },
        { type: "h2", text: "On love" },
        { type: "h3", text: "1 Corinthians 13:4-8" },
        {
          type: "blockquote",
          text: "Charity suffereth long, and is kind; charity envieth not; charity vaunteth not itself, is not puffed up,\n\nDoth not behave itself unseemly, seeketh not her own, is not easily provoked, thinketh no evil;\n\nRejoiceth not in iniquity, but rejoiceth in the truth;\n\nBeareth all things, believeth all things, hopeth all things, endureth all things.\n\nCharity never faileth.",
          cite: "1 Corinthians 13:4-8",
        },
        {
          type: "p",
          text: "The best-known wedding passage. It describes love not as feeling but as patience, kindness, faithfulness and endurance.",
        },
        { type: "h3", text: "1 John 4:7-8" },
        {
          type: "blockquote",
          text: "Beloved, let us love one another: for love is of God; and every one that loveth is born of God, and knoweth God.\n\nHe that loveth not knoweth not God; for God is love.",
          cite: "1 John 4:7-8",
        },
        {
          type: "p",
          text: "Roots love not in feeling but in God. A natural fit for a church or faith-led ceremony.",
        },
        { type: "h2", text: "On marriage" },
        { type: "h3", text: "Genesis 2:18, 24" },
        {
          type: "blockquote",
          text: "And the Lord God said, It is not good that the man should be alone; I will make him an help meet for him.\n\nTherefore shall a man leave his father and his mother, and shall cleave unto his wife: and they shall be one flesh.",
          cite: "Genesis 2:18, 24",
        },
        {
          type: "p",
          text: "The biblical foundation for marriage: people are created for partnership and shared life.",
        },
        { type: "h3", text: "Mark 10:6-9" },
        {
          type: "blockquote",
          text: "But from the beginning of the creation God made them male and female.\n\nFor this cause shall a man leave his father and mother, and cleave to his wife;\n\nAnd they twain shall be one flesh: so then they are no more twain, but one flesh.\n\nWhat therefore God hath joined together, let not man put asunder.",
          cite: "Mark 10:6-9",
        },
        {
          type: "p",
          text: "The strongest passage on the covenant nature of marriage. A fitting reading for a formal ceremony.",
        },
        { type: "h3", text: "Ephesians 5:21, 25" },
        {
          type: "blockquote",
          text: "Submitting yourselves one to another in the fear of God.\n\nHusbands, love your wives, even as Christ also loved the church, and gave himself for it.",
          cite: "Ephesians 5:21, 25",
        },
        {
          type: "p",
          text: "Read together, the key is mutual love and self-giving service, not hierarchy.",
        },
        { type: "h2", text: "On shared life and endurance" },
        { type: "h3", text: "Ecclesiastes 4:9-12" },
        {
          type: "blockquote",
          text: "Two are better than one; because they have a good reward for their labour.\n\nFor if they fall, the one will lift up his fellow: but woe to him that is alone when he falleth; for he hath not another to help him up.\n\nAnd if one prevail against him, two shall withstand him; and a threefold cord is not quickly broken.",
          cite: "Ecclesiastes 4:9-12",
        },
        {
          type: "p",
          text: 'Why partnership matters: someone to lift you up. The "threefold cord" is often read at Christian weddings as the couple plus God.',
        },
        { type: "h3", text: "Ruth 1:16-17" },
        {
          type: "blockquote",
          text: "Intreat me not to leave thee, or to return from following after thee: for whither thou goest, I will go; and where thou lodgest, I will lodge: thy people shall be my people, and thy God my God:\n\nWhere thou diest, will I die, and there will I be buried.",
          cite: "Ruth 1:16-17",
        },
        {
          type: "p",
          text: "Not originally a marriage vow, but the imagery of faithfulness and shared destiny makes it a wedding favourite.",
        },
        { type: "h2", text: "On respect, patience and forgiveness" },
        { type: "h3", text: "Ephesians 4:1-3" },
        {
          type: "blockquote",
          text: "I therefore, the prisoner of the Lord, beseech you that ye walk worthy of the vocation wherewith ye are called,\n\nWith all lowliness and meekness, with longsuffering, forbearing one another in love;\n\nEndeavouring to keep the unity of the Spirit in the bond of peace.",
          cite: "Ephesians 4:1-3",
        },
        {
          type: "p",
          text: "The everyday side of marriage: humility, patience, peace.",
        },
        { type: "h3", text: "Colossians 3:12-14" },
        {
          type: "blockquote",
          text: "Put on therefore, as the elect of God, holy and beloved, bowels of mercies, kindness, humbleness of mind, meekness, longsuffering;\n\nForbearing one another, and forgiving one another, if any man have a quarrel against any: even as Christ forgave you, so also do ye.\n\nAnd above all these things put on charity, which is the bond of perfectness.",
          cite: "Colossians 3:12-14",
        },
        {
          type: "p",
          text: "A beautiful programme for married life: kindness, humility, patience, forgiveness, love.",
        },
        { type: "h2", text: "Romantic passages from Song of Solomon" },
        { type: "h3", text: "Song of Solomon 2:10-13" },
        {
          type: "blockquote",
          text: "My beloved spake, and said unto me, Rise up, my love, my fair one, and come away.\n\nFor, lo, the winter is past, the rain is over and gone;\n\nThe flowers appear on the earth; the time of the singing of birds is come.",
          cite: "Song of Solomon 2:10-13",
        },
        {
          type: "p",
          text: "Poetic, spring-tinted, romantic — a natural fit for outdoor or quietly elegant ceremonies.",
        },
        { type: "h3", text: "Song of Solomon 8:6-7" },
        {
          type: "blockquote",
          text: "Set me as a seal upon thine heart, as a seal upon thine arm: for love is strong as death;\n\nMany waters cannot quench love, neither can the floods drown it.",
          cite: "Song of Solomon 8:6-7",
        },
        {
          type: "p",
          text: "One of the most beautiful poetic verses on love. Works particularly well on elegant invitations or printed orders of service.",
        },
        { type: "h2", text: "How to choose" },
        {
          type: "p",
          text: "Match the verse to the mood. A classic, formal ceremony pairs naturally with 1 Corinthians 13 or Ephesians 5; an outdoor, poetic ceremony sits better with Song of Solomon. For an invitation, a short verse (1 Corinthians 13:13, Song of Solomon 2:16) almost always works.",
        },
        {
          type: "p",
          text: "If your guest list is mixed, choose a passage with a humane, universally understandable message such as Ecclesiastes 4 or Colossians 3.",
        },
        {
          type: "cta",
          lead: "If you also want to organise the practical side of the wedding (guest list, budget, RSVP, seating) in one place, try Weddly.",
          href: "/signup",
          label: "Start free",
        },
        { type: "h2", text: "FAQ" },
        { type: "h3", text: "What's the best-known wedding Bible passage?" },
        {
          type: "p",
          text: '1 Corinthians 13, particularly the "love is patient, love is kind" passage and the closing line: "the greatest of these is love."',
        },
        { type: "h3", text: "Which short verse works for an invitation?" },
        {
          type: "p",
          text: "Good short options: 1 Corinthians 13:13, 1 John 4:7, Ecclesiastes 4:12, and Song of Solomon 2:16.",
        },
        { type: "h3", text: "Which passage best fits the marriage vows?" },
        {
          type: "p",
          text: "Genesis 2:24, Mark 10:6-9 and Ephesians 5 are the strongest scriptural anchors for the covenant nature of marriage.",
        },
      ],
    },
  },
  // ── 1. Költségvetés ────────────────────────────────────────────────
  {
    slug: "eskuvoi-koltsegvetes-keszitese",
    published_at: "2026-05-26",
    read_minutes: 6,
    category: { hu: "Költségvetés", en: "Budget" },
    hu: {
      title: "Esküvői költségvetés készítése: így marad átlátható minden döntés",
      lead: "Hogyan osszátok fel a keretet, hogyan számoljatok vendégszámmal, és hogyan kerülhetitek el a túlköltést.",
      seo_title: "Esküvői költségvetés készítése · Wēddly",
      seo_description:
        "Esküvői költségvetés egyszerűen: mutatjuk, hogyan osszátok fel a keretet, hogyan számoljatok vendégszámmal, és hogyan kerülhetitek el a túlköltést.",
      body: [
        {
          type: "p",
          text: "Az esküvőszervezés egyik legnehezebb része nem az, hogy mit szeretnétek, hanem az, hogy mi fér bele a keretbe. A helyszín, a vacsora, a dekor, a ruha, a fotós, a zene és az apró nyomtatványok külön-külön még kezelhetőnek tűnnek, együtt viszont gyorsan széteshet a kép.",
        },
        {
          type: "p",
          text: "Ezért érdemes az esküvői költségvetést nem egy egyszer kitöltött táblázatként kezelni, hanem élő tervként. Ha változik a vendégszám, a menü vagy a helyszín ára, a teljes költségvetésnek is frissülnie kell.",
        },
        { type: "h2", text: "1. Először a teljes keretet határozzátok meg" },
        {
          type: "p",
          text: "Ne kategóriákkal kezdjetek. Először azt beszéljétek meg, mennyi az a teljes összeg, amit nyugodt szívvel rá tudtok szánni az esküvőre.",
        },
        { type: "p", text: "Ezután osszátok fel a keretet főbb kategóriákra:" },
        {
          type: "ul",
          items: [
            "helyszín",
            "catering és italok",
            "fotó és videó",
            "dekor",
            "ruha és öltöny",
            "zene",
            "meghívók és nyomtatványok",
            "tartalék",
          ],
        },
        {
          type: "p",
          text: "A tartalékot ne hagyjátok ki. Egy esküvőnél szinte mindig lesz olyan költség, amire az elején nem gondoltatok.",
        },
        { type: "h2", text: "2. A vendégszám mindenre hatással van" },
        {
          type: "p",
          text: "A vendégszám nemcsak a vacsora árát befolyásolja. Hatással van az italokra, az asztalok számára, az ültetési rendre, a nyomtatványokra, a köszönőajándékokra és sokszor még a helyszín minimum fogyasztására is.",
        },
        {
          type: "p",
          text: "Ezért nem elég annyit írni, hogy „kb. 90 fő“. Érdemes több verzióval számolni:",
        },
        {
          type: "ul",
          items: ["szűk esküvő: 50 fő", "közepes esküvő: 80 fő", "nagyobb esküvő: 120 fő"],
        },
        { type: "p", text: "Így hamar látszik, melyik forgatókönyv fér bele kényelmesen." },
        { type: "h2", text: "3. Ne csak a végösszeget nézzétek" },
        {
          type: "p",
          text: "Sok pár csak azt figyeli, hogy a teljes költségvetés még belefér-e. Ennél hasznosabb, ha kategóriánként is látjátok, hol van túlköltés.",
        },
        {
          type: "p",
          text: "Lehet, hogy összességében még rendben vagytok, de a dekor már elvitte a fotósra szánt keret egy részét. Ilyenkor jobb korán dönteni, mint az esküvő előtti hetekben kapkodni.",
        },
        { type: "h2", text: "4. A költségvetés legyen közös" },
        {
          type: "p",
          text: "Ha az egyikőtök egy táblázatot frissít, a másik pedig régi számokat néz, abból könnyen félreértés lesz. A közös esküvőszervezéshez közös, mindig friss költségvetés kell.",
        },
        {
          type: "p",
          text: "A Wēddly-ben a költségvetés, a vendéglista és az ültetés egy helyen él, így ha változik a vendégszám, a kapcsolódó döntések is könnyebben átláthatók.",
        },
        { type: "h2", text: "Rövid checklist" },
        {
          type: "ul",
          items: [
            "Legyen teljes esküvői keret.",
            "Legyen kategóriánkénti bontás.",
            "Számoljatok több vendégszám-verzióval.",
            "Tegyetek félre tartalékot.",
            "Mindketten ugyanazt az aktuális verziót nézzétek.",
          ],
        },
        {
          type: "cta",
          lead: "Szeretnétek átláthatóbban kezelni az esküvői költségvetést? A Wēddly-ben egy helyen él a költségvetés, vendéglista, RSVP és ültetés.",
          href: "/signup",
          label: "Ingyenes próba indítása",
        },
      ],
    },
    en: {
      title: "How to build a wedding budget that stays under control",
      lead: "How to set the total, how to plan for guest count, and how to avoid quietly overspending.",
      seo_title: "How to build a wedding budget · Weddly",
      seo_description:
        "Practical guide to wedding budgeting: how to set the total, allocate by category, plan for guest count, and avoid quiet overspend.",
      body: [
        {
          type: "p",
          text: "The hardest part of wedding planning isn't deciding what you want. It's keeping it inside the budget. Venue, catering, decor, attire, photo, music and stationery look manageable on their own, but they add up fast.",
        },
        {
          type: "p",
          text: "Treat the budget as a living plan, not a one-time spreadsheet. When guest count, menu or venue pricing changes, the whole budget needs to follow.",
        },
        { type: "h2", text: "1. Start with the total" },
        {
          type: "p",
          text: "Don't start with categories. First agree on the total amount you can comfortably commit to the wedding.",
        },
        { type: "p", text: "Then split it across the main categories:" },
        {
          type: "ul",
          items: [
            "venue",
            "catering and drinks",
            "photo and video",
            "decor",
            "attire",
            "music",
            "invitations and stationery",
            "reserve",
          ],
        },
        {
          type: "p",
          text: "Don't skip the reserve. Almost every wedding picks up a cost that wasn't on the original list.",
        },
        { type: "h2", text: "2. Guest count drives everything" },
        {
          type: "p",
          text: "Guest count doesn't just change the catering line. It moves drinks, table count, seating, stationery, favours, and often the venue minimum spend.",
        },
        { type: "p", text: '"About 90 guests" isn\'t enough. Plan against several scenarios:' },
        {
          type: "ul",
          items: ["small: 50 guests", "medium: 80 guests", "larger: 120 guests"],
        },
        { type: "p", text: "It becomes obvious quickly which scenario actually fits the total." },
        { type: "h2", text: "3. Don't only watch the grand total" },
        {
          type: "p",
          text: "Many couples track only whether the total still fits. It's far more useful to see where, by category, you're already over.",
        },
        {
          type: "p",
          text: "You may be on track overall while decor has quietly eaten part of the photo budget. Better to catch it early than scramble in the last weeks.",
        },
        { type: "h2", text: "4. The budget has to be shared" },
        {
          type: "p",
          text: "If one of you updates a spreadsheet and the other is reading old numbers, misunderstandings will follow. Shared planning needs one shared, always-current budget.",
        },
        {
          type: "p",
          text: "In Weddly the budget, guest list and seating live in one workspace, so when guest count moves the connected decisions are easier to keep straight.",
        },
        { type: "h2", text: "Short checklist" },
        {
          type: "ul",
          items: [
            "Agree on a total budget first.",
            "Break it down by category.",
            "Plan against several guest-count scenarios.",
            "Set aside a reserve.",
            "Both of you read the same live version.",
          ],
        },
        {
          type: "cta",
          lead: "Want a more transparent wedding budget? In Weddly the budget, guest list, RSVP and seating live in one shared workspace.",
          href: "/signup",
          label: "Start free",
        },
      ],
    },
  },
  // ── 2. Vendéglista ─────────────────────────────────────────────────
  {
    slug: "eskuvoi-vendeglista-keszitese",
    published_at: "2026-05-19",
    read_minutes: 6,
    category: { hu: "Vendéglista", en: "Guest list" },
    hu: {
      title: "Esküvői vendéglista készítése: hogyan legyen végre átlátható?",
      lead: "Így gyűjtsétek össze a neveket, plus one-okat, RSVP válaszokat, ételválasztásokat és speciális igényeket egy helyre.",
      seo_title: "Esküvői vendéglista készítése · Wēddly",
      seo_description:
        "Esküvői vendéglista stressz nélkül: így gyűjtsétek össze a neveket, plus one-okat, RSVP válaszokat, ételválasztásokat és speciális igényeket.",
      body: [
        {
          type: "p",
          text: "A vendéglista az esküvőszervezés egyik legfontosabb alapja. Mégis sok párnál több táblázatban, jegyzetben és chatüzenetben él egyszerre. Valaki már visszajelzett, valaki még nem. Egy vendég hozna kísérőt, más vegetáriánus menüt kér, a harmadik pedig még nem biztos benne, hogy jön.",
        },
        { type: "p", text: "Ebből lesz az a káosz, amit jobb már az elején megelőzni." },
        { type: "h2", text: "1. Ne csak neveket írjatok össze" },
        {
          type: "p",
          text: "Egy jó esküvői vendéglista nemcsak névsor. Minden vendégnél érdemes vezetni:",
        },
        {
          type: "ul",
          items: [
            "teljes név",
            "meghívási státusz",
            "RSVP válasz",
            "kísérő",
            "ételválasztás",
            "allergia vagy étrendi igény",
            "asztal",
            "megjegyzés",
          ],
        },
        {
          type: "p",
          text: "Így nem az esküvő előtti napokban kell visszakeresni, ki mit írt Messengeren vagy e-mailben.",
        },
        { type: "h2", text: "2. Legyen egyértelmű RSVP folyamat" },
        {
          type: "p",
          text: "A „majd szóban jelzik“ ritkán működik jól. Sokkal egyszerűbb, ha minden vendég kap egy saját RSVP linket, ahol gyorsan vissza tud jelezni.",
        },
        {
          type: "p",
          text: "Egy jó RSVP űrlap nem kér túl sokat, csak azt, amire tényleg szükségetek van:",
        },
        {
          type: "ul",
          items: [
            "jön-e a vendég",
            "hoz-e kísérőt",
            "milyen menüt választ",
            "van-e ételérzékenysége",
            "van-e külön kérése",
          ],
        },
        { type: "p", text: "Minél egyszerűbb a válaszadás, annál hamarabb jönnek be a válaszok." },
        { type: "h2", text: "3. A plus one kérdést korán tisztázzátok" },
        {
          type: "p",
          text: "A kísérők kezelése az egyik leggyakoribb vendéglista-probléma. Érdemes előre eldönteni, kik hozhatnak plus one-t, és ezt következetesen vezetni.",
        },
        {
          type: "p",
          text: "Ez nemcsak költségvetési kérdés, hanem ültetési is. Egy plusz vendég új széket, új menüt, új helyet és néha új asztalkiosztást jelent.",
        },
        { type: "h2", text: "4. Kössetek össze mindent az ültetéssel" },
        {
          type: "p",
          text: "A vendéglista akkor igazán hasznos, ha nem külön életet él az ültetéstől. Ha valaki visszamondja, jelzi a kísérőjét vagy ételérzékenységet ad meg, annak az ültetési rendben is látszania kell.",
        },
        {
          type: "p",
          text: "A Wēddly-ben a vendéglista, RSVP és ültetés egy közös rendszerben van, így nem kell több helyen frissíteni ugyanazt az információt.",
        },
        { type: "h2", text: "Rövid checklist" },
        {
          type: "ul",
          items: [
            "Minden vendéghez legyen státusz.",
            "Külön vezessétek az RSVP választ.",
            "A kísérőket ne utólag találjátok ki.",
            "Gyűjtsétek az ételválasztást és allergiákat.",
            "Az ültetési rend kapcsolódjon a vendéglistához.",
          ],
        },
        {
          type: "cta",
          lead: "A Wēddly segít egy helyen kezelni a vendéglistát, RSVP válaszokat, kísérőket, menüket és ültetést.",
          href: "/signup",
          label: "Kezdjétek el ingyen",
        },
      ],
    },
    en: {
      title: "Building a wedding guest list that actually stays organised",
      lead: "How to collect names, plus-ones, RSVPs, meal choices and dietary needs in one place.",
      seo_title: "Building a wedding guest list · Weddly",
      seo_description:
        "Wedding guest list without stress: how to collect names, plus-ones, RSVPs, meals and dietary needs in one place.",
      body: [
        {
          type: "p",
          text: "The guest list is one of the foundations of planning. For most couples it ends up spread across spreadsheets, notes and chat threads. Someone has replied, someone hasn't. One wants a plus-one, another needs a vegetarian menu, a third still isn't sure.",
        },
        { type: "p", text: "That's the chaos worth preventing from the start." },
        { type: "h2", text: "1. Track more than names" },
        { type: "p", text: "A good guest list isn't a roster. For each guest, keep:" },
        {
          type: "ul",
          items: [
            "full name",
            "invitation status",
            "RSVP reply",
            "plus-one",
            "meal choice",
            "allergies / dietary need",
            "table",
            "notes",
          ],
        },
        {
          type: "p",
          text: "Saves you from digging through Messenger or email in the last week to remember who wrote what.",
        },
        { type: "h2", text: "2. Run a clear RSVP flow" },
        {
          type: "p",
          text: '"They\'ll let us know in person" rarely works. Much easier when every guest has a personal RSVP link they can use in under a minute.',
        },
        { type: "p", text: "A good RSVP form only asks for what you actually need:" },
        {
          type: "ul",
          items: [
            "are you coming",
            "any plus-one",
            "meal choice",
            "dietary need",
            "anything else we should know",
          ],
        },
        { type: "p", text: "The shorter the form, the faster the responses come in." },
        { type: "h2", text: "3. Settle plus-ones early" },
        {
          type: "p",
          text: "Plus-ones are the most common guest-list problem. Decide upfront who can bring one, and apply the rule consistently.",
        },
        {
          type: "p",
          text: "It's not just a budget question. Every plus-one is another seat, meal, sometimes another table arrangement.",
        },
        { type: "h2", text: "4. Connect it to the seating" },
        {
          type: "p",
          text: "Guest list information is most useful when it isn't separate from seating. If someone cancels, adds a plus-one or names a dietary need, the seating chart should reflect it.",
        },
        {
          type: "p",
          text: "In Weddly the guest list, RSVP and seating share one workspace, so you don't update the same information in three places.",
        },
        { type: "h2", text: "Short checklist" },
        {
          type: "ul",
          items: [
            "Status for every guest.",
            "Track the RSVP reply separately.",
            "Decide plus-ones early.",
            "Collect meals and allergies in the same flow.",
            "Connect seating to the guest list.",
          ],
        },
        {
          type: "cta",
          lead: "Weddly keeps the guest list, RSVPs, plus-ones, meals and seating in one workspace.",
          href: "/signup",
          label: "Start free",
        },
      ],
    },
  },
  // ── 3. Ültetési rend ───────────────────────────────────────────────
  {
    slug: "eskuvoi-ultetesi-rend-keszitese",
    published_at: "2026-05-12",
    read_minutes: 5,
    category: { hu: "Ültetés", en: "Seating" },
    hu: {
      title: "Esküvői ültetési rend készítése: hogyan legyen logikus és nyomtatható?",
      lead: "Mire figyeljetek családoknál, barátoknál, gyerekeknél és nyomtatásnál.",
      seo_title: "Esküvői ültetési rend készítése · Wēddly",
      seo_description:
        "Esküvői ültetési rend egyszerűen: hogyan osszátok be a vendégeket, mire figyeljetek családoknál, barátoknál, gyerekeknél és nyomtatásnál.",
      body: [
        {
          type: "p",
          text: "Az ültetési rend sokszor csak az esküvő előtti hetekben kerül elő, pedig rengeteg döntést befolyásol. Ki ül a főasztalnál? Hová kerülnek a családok? Üljenek együtt a barátok? Mi legyen azokkal, akik senkit nem ismernek?",
        },
        {
          type: "p",
          text: "Egy jó ültetési rend nemcsak szép, hanem praktikus is. Segít a vendégeknek, a helyszínnek, a cateringnek és nektek is.",
        },
        { type: "h2", text: "1. Ne kezdjétek túl korán véglegesíteni" },
        {
          type: "p",
          text: "Az ültetési rendet lehet korán tervezni, de ne tekintsétek véglegesnek, amíg nincs elég RSVP válasz. Ha sok a bizonytalan vendég, az ültetés is sokszor fog változni.",
        },
        { type: "p", text: "Érdemes először asztalcsoportokban gondolkodni:" },
        {
          type: "ul",
          items: [
            "közeli család",
            "tágabb család",
            "barátok",
            "kollégák",
            "gyerekes családok",
            "idősebb vendégek",
          ],
        },
        { type: "p", text: "Ezután jöhet a pontos székek kiosztása." },
        { type: "h2", text: "2. Vegyétek figyelembe a helyszín logikáját" },
        {
          type: "p",
          text: "Nem mindegy, hol van a tánctér, a kijárat, a mosdó, a büfé vagy a zenekar. Az idősebb vendégeknek kényelmesebb lehet egy nyugodtabb asztal. A baráti társaságoknak jobb lehet a tánctér közelében.",
        },
        {
          type: "p",
          text: "A jó ültetési rend nemcsak embereket párosít, hanem a térrel is számol.",
        },
        { type: "h2", text: "3. Legyen nyomtatható verzió" },
        { type: "p", text: "Az ültetési rend nem ér véget a képernyőn. Szükség lehet:" },
        {
          type: "ul",
          items: [
            "nagy ültetési táblára a bejárathoz",
            "asztalszámokra",
            "ültetőkártyákra",
            "catering-listára",
            "helyszíni segítői verzióra",
          ],
        },
        {
          type: "p",
          text: "Ezért fontos, hogy az ültetési rend exportálható és nyomdakész legyen.",
        },
        { type: "h2", text: "4. Készüljetek az utolsó pillanatos változásokra" },
        {
          type: "p",
          text: "Szinte mindig lesz valaki, aki az utolsó héten mondja le, vagy akkor jelzi, hogy mégis jönne. Ha az ültetés kézzel rajzolt PDF-ekben él, minden változás fájdalmas.",
        },
        {
          type: "p",
          text: "A Wēddly vizuális ültetési felületén könnyebb mozgatni a vendégeket, majd A4, A6 vagy A3 formátumban nyomtatható anyagot készíteni.",
        },
        { type: "h2", text: "Rövid checklist" },
        {
          type: "ul",
          items: [
            "Először csoportokban gondolkodjatok.",
            "Az RSVP válaszok után véglegesítsetek.",
            "Vegyétek figyelembe a helyszín adottságait.",
            "Készítsetek nyomtatható verziót.",
            "Hagyjatok mozgásteret az utolsó módosításokra.",
          ],
        },
        {
          type: "cta",
          lead: "A Wēddly-ben vizuálisan készíthettek ültetési rendet, mozgathatjátok a vendégeket, és nyomtatható verziót exportálhattok.",
          href: "/signup",
          label: "Próbáljátok ki ingyen",
        },
      ],
    },
    en: {
      title: "Designing a wedding seating chart that is logical and printable",
      lead: "What to watch for with families, friends, kids and printing.",
      seo_title: "Wedding seating chart design · Weddly",
      seo_description:
        "How to plan a seating chart that handles family, friends, kids and last-minute changes, and prints cleanly.",
      body: [
        {
          type: "p",
          text: "The seating chart usually shows up in the last few weeks before the wedding, even though it shapes many decisions. Who sits at the head table? Where do families go? Should friend groups stay together? What about guests who don't know anyone?",
        },
        {
          type: "p",
          text: "A good seating chart is not only nice, it's practical. It helps your guests, the venue, the caterer and you.",
        },
        { type: "h2", text: "1. Don't lock it in too early" },
        {
          type: "p",
          text: "Plan early, but don't treat it as final until enough RSVPs are in. If many guests are uncertain, the chart will change repeatedly.",
        },
        { type: "p", text: "Start with table-level groups:" },
        {
          type: "ul",
          items: [
            "close family",
            "extended family",
            "friends",
            "colleagues",
            "families with kids",
            "older guests",
          ],
        },
        { type: "p", text: "Once those are stable, do the exact seat assignments." },
        { type: "h2", text: "2. Respect the venue layout" },
        {
          type: "p",
          text: "Position matters: the dance floor, the bar, the entrance, the band. Older guests prefer quieter corners. Friend groups belong near the dance floor.",
        },
        { type: "p", text: "Good seating doesn't only pair people; it accounts for the space." },
        { type: "h2", text: "3. Get the printable version right" },
        { type: "p", text: "Seating doesn't end on screen. You'll likely need:" },
        {
          type: "ul",
          items: [
            "a large entrance display",
            "table numbers",
            "place cards",
            "a caterer-friendly list",
            "a runner copy for on-the-day staff",
          ],
        },
        { type: "p", text: "So the chart has to export cleanly and at print sizes." },
        { type: "h2", text: "4. Plan for last-minute changes" },
        {
          type: "p",
          text: "Someone always cancels in the final week, or confirms after being unsure. If the chart only lives in a hand-drawn PDF, every change is painful.",
        },
        {
          type: "p",
          text: "Weddly's visual seating canvas lets you move guests easily, then export to A4, A6 or A3 for print.",
        },
        { type: "h2", text: "Short checklist" },
        {
          type: "ul",
          items: [
            "Group first, seat second.",
            "Finalise after RSVPs settle.",
            "Use the venue layout.",
            "Plan the printable output.",
            "Leave room for late changes.",
          ],
        },
        {
          type: "cta",
          lead: "Plan your seating visually in Weddly and export to A4 / A6 / A3 for the entrance display, place cards and the coordinator binder.",
          href: "/signup",
          label: "Try it free",
        },
      ],
    },
  },
  // ── 4. RSVP ────────────────────────────────────────────────────────
  {
    slug: "eskuvoi-rsvp-kerdesek",
    published_at: "2026-05-05",
    read_minutes: 5,
    category: { hu: "RSVP", en: "RSVP" },
    hu: {
      title: "Esküvői RSVP: mit kérdezzetek a vendégektől, hogy ne legyen káosz?",
      lead: "Milyen kérdések kerüljenek a visszajelző űrlapra, hogy egyszerű legyen a vendégeknek és hasznos nektek.",
      seo_title: "Esküvői RSVP kérdések · Wēddly",
      seo_description:
        "Esküvői RSVP útmutató pároknak: milyen kérdések kerüljenek a visszajelző űrlapra, hogy egyszerű legyen a vendégeknek és hasznos nektek.",
      body: [
        {
          type: "p",
          text: "Az RSVP célja egyszerű: tudni szeretnétek, ki jön az esküvőre. A gyakorlatban viszont ennél sokkal többről van szó. A válaszokból derül ki a végleges vendégszám, a menüigény, a kísérők száma és sok apró részlet, ami a szervezéshez kell.",
        },
        {
          type: "p",
          text: "A legjobb RSVP űrlap rövid, mobilon is könnyen kitölthető, és csak olyan kérdéseket tartalmaz, amelyekkel tényleg kezdeni fogtok valamit.",
        },
        { type: "h2", text: "1. A legfontosabb kérdés: jössz vagy nem?" },
        {
          type: "p",
          text: "Ez legyen az első. Ne rejtőzzön hosszú szöveg vagy sok mező mögé. A vendég azonnal értse, hogy visszajelzést kértek.",
        },
        { type: "p", text: "Példa: „Részt tudsz venni az esküvőnkön?“" },
        {
          type: "ul",
          items: ["Igen, ott leszek.", "Sajnos nem tudok menni."],
        },
        { type: "h2", text: "2. Kísérő kérdése" },
        {
          type: "p",
          text: "Ha engedtek kísérőt, az RSVP-ben legyen egyértelműen kezelve. Ha nem mindenki hozhat plus one-t, akkor személyre szabott RSVP linkkel elkerülhető a félreértés.",
        },
        { type: "p", text: "Példa: „Kísérővel érkezel?“" },
        { type: "h2", text: "3. Menü és ételérzékenység" },
        {
          type: "p",
          text: "A catering miatt ezt időben érdemes bekérni. Kérdezzetek rá az ételválasztásra és a speciális igényekre is.",
        },
        { type: "p", text: "Példa: „Van ételérzékenységed vagy speciális étrended?“" },
        {
          type: "p",
          text: "Itt jó, ha van szabad szöveges mező is, mert nem minden igény fér bele előre megadott opciókba.",
        },
        { type: "h2", text: "4. Extra kérdések, amelyek hasznosak lehetnek" },
        { type: "p", text: "Nem kell túlzásba vinni, de néhány extra kérdés sokat segíthet:" },
        {
          type: "ul",
          items: [
            "Kérsz transzfert?",
            "Szükséged van szállásinformációra?",
            "Melyik zenét hallanád szívesen a buliban?",
            "Van bármi, amit jó, ha előre tudunk?",
          ],
        },
        { type: "h2", text: "5. Ne kérjetek túl sokat" },
        {
          type: "p",
          text: "Ha az RSVP túl hosszú, a vendégek halogatni fogják. A cél az, hogy egy perc alatt kitölthető legyen.",
        },
        {
          type: "p",
          text: "A Wēddly-ben minden vendég saját RSVP linket kaphat, a válaszok pedig automatikusan bekerülnek a vendéglistába.",
        },
        {
          type: "cta",
          lead: "Készítsetek egyszerű RSVP folyamatot a Wēddly-ben, és gyűjtsétek egy helyre a válaszokat, menüket, kísérőket és megjegyzéseket.",
          href: "/signup",
          label: "Indítsátok el ingyen",
        },
      ],
    },
    en: {
      title: "Wedding RSVP: what to ask guests so the responses stay manageable",
      lead: "Which questions to put on the reply form so it's easy for guests and useful for you.",
      seo_title: "Wedding RSVP questions · Weddly",
      seo_description:
        "Wedding RSVP guide: which questions to ask, why fewer fields produce higher response rates, and how to use what you collect.",
      body: [
        {
          type: "p",
          text: "RSVP looks simple: you want to know who's coming. In practice the replies carry the final headcount, meal choices, plus-one count and a handful of details you'll need across the rest of planning.",
        },
        {
          type: "p",
          text: "The best RSVP form is short, mobile-friendly, and only asks what you'll actually use.",
        },
        { type: "h2", text: "1. Coming or not?" },
        {
          type: "p",
          text: "Put this first. Don't bury it under a long preamble. The guest should see immediately what's being asked.",
        },
        { type: "p", text: 'Example: "Can you join us?"' },
        { type: "ul", items: ["Yes, I'll be there.", "Sadly I can't make it."] },
        { type: "h2", text: "2. Plus-one" },
        {
          type: "p",
          text: "If you allow plus-ones, the RSVP has to handle it cleanly. If not everyone gets one, per-guest links prevent the awkward case.",
        },
        { type: "p", text: 'Example: "Bringing a plus-one?"' },
        { type: "h2", text: "3. Meal and dietary needs" },
        {
          type: "p",
          text: "Catering needs this early. Ask for meal choice and dietary requirements together.",
        },
        { type: "p", text: 'Example: "Any dietary needs or restrictions?"' },
        { type: "p", text: "Leave a free-text field — not every need fits a preset option." },
        { type: "h2", text: "4. Optional extras" },
        { type: "p", text: "Don't overdo it, but a few extras can be useful:" },
        {
          type: "ul",
          items: [
            "Do you need transport?",
            "Do you need accommodation info?",
            "Any song requests?",
            "Anything else we should know in advance?",
          ],
        },
        { type: "h2", text: "5. Don't ask too much" },
        {
          type: "p",
          text: "Long RSVPs get postponed. Aim for under a minute to complete.",
        },
        {
          type: "p",
          text: "In Weddly every guest gets a personal RSVP link, and the replies flow straight into the guest list.",
        },
        {
          type: "cta",
          lead: "Set up a simple RSVP flow in Weddly and collect every reply, meal, plus-one and note in one place.",
          href: "/signup",
          label: "Start free",
        },
      ],
    },
  },
  // ── 5. 12-month checklist ──────────────────────────────────────────
  {
    slug: "eskuvoszervezesi-checklist-12-honapra",
    published_at: "2026-04-28",
    read_minutes: 7,
    category: { hu: "Tervezés", en: "Planning" },
    hu: {
      title: "Esküvőszervezési checklist 12 hónapra: mit mikor intézzetek?",
      lead: "Lépésről lépésre mutatjuk, mit érdemes intézni egy évvel, fél évvel és egy hónappal az esküvő előtt.",
      seo_title: "Esküvőszervezési checklist 12 hónapra · Wēddly",
      seo_description:
        "Esküvőszervezési checklist 12 hónapra: lépésről lépésre mutatjuk, mit érdemes intézni egy évvel, fél évvel és egy hónappal az esküvő előtt.",
      body: [
        {
          type: "p",
          text: "Az esküvőszervezés akkor tűnik ijesztőnek, ha minden egyszerre szakad rátok. Helyszín, vendéglista, fotós, zene, meghívó, ruha, ültetés, menü, dekor, nyomtatványok. Könnyű elveszni benne.",
        },
        {
          type: "p",
          text: "A jó hír az, hogy nem mindent kell egyszerre megoldani. Ha időrendben haladtok, sokkal nyugodtabb lesz az egész folyamat.",
        },
        { type: "h2", text: "12 hónappal az esküvő előtt" },
        { type: "p", text: "Ebben az időszakban a nagy döntéseket érdemes meghozni." },
        {
          type: "ul",
          items: [
            "dátum kiválasztása",
            "esküvői stílus meghatározása",
            "nagyságrendi költségvetés",
            "várható vendégszám",
            "helyszínkeresés",
            "fő szolgáltatók felkutatása",
          ],
        },
        {
          type: "p",
          text: "Ilyenkor még nem kell minden részletet tudnotok, de a keretek legyenek világosak.",
        },
        { type: "h2", text: "9 hónappal az esküvő előtt" },
        { type: "p", text: "Ekkor már érdemes elkezdeni konkrétan foglalni." },
        {
          type: "ul",
          items: [
            "helyszín véglegesítése",
            "fotós / videós kiválasztása",
            "zenekar vagy DJ lefoglalása",
            "ceremóniamester vagy vőfély keresése",
            "vendéglista első verziója",
            "esküvői weboldal vagy RSVP folyamat előkészítése",
          ],
        },
        {
          type: "p",
          text: "A vendéglista ilyenkor még változhat, de legyen egy első verzió, amivel számolni tudtok.",
        },
        { type: "h2", text: "6 hónappal az esküvő előtt" },
        { type: "p", text: "Itt jönnek a részletek." },
        {
          type: "ul",
          items: [
            "meghívók előkészítése",
            "RSVP határidő meghatározása",
            "dekorációs irány véglegesítése",
            "ruha és öltöny intézése",
            "menüajánlatok egyeztetése",
            "szállás és transzfer átgondolása",
          ],
        },
        {
          type: "p",
          text: "Ekkor már jó, ha a költségvetés nem csak becslés, hanem tényleges ajánlatok alapján frissül.",
        },
        { type: "h2", text: "3 hónappal az esküvő előtt" },
        { type: "p", text: "Most már a válaszok és a pontosítások időszaka jön." },
        {
          type: "ul",
          items: [
            "RSVP válaszok követése",
            "vendéglista frissítése",
            "menüválasztások gyűjtése",
            "szolgáltatói részletek véglegesítése",
            "első ültetési verzió elkészítése",
            "nyomtatványok megtervezése",
          ],
        },
        {
          type: "p",
          text: "Ha ekkor még minden külön táblázatban van, nagyon könnyű hibázni. Érdemes egy közös rendszerben vezetni az adatokat.",
        },
        { type: "h2", text: "1 hónappal az esküvő előtt" },
        { type: "p", text: "Ez már a véglegesítés időszaka." },
        {
          type: "ul",
          items: [
            "végleges vendégszám leadása",
            "ültetési rend véglegesítése",
            "asztalszámok és ültetőkártyák nyomtatása",
            "szolgáltatói időrend egyeztetése",
            "fizetési határidők ellenőrzése",
            "napi forgatókönyv elkészítése",
          ],
        },
        {
          type: "p",
          text: "Ebben a hónapban már nem az új ötletek a legfontosabbak, hanem az, hogy mindenki ugyanazt az aktuális információt lássa.",
        },
        { type: "h2", text: "1 héttel az esküvő előtt" },
        { type: "p", text: "Itt már csak a finomhangolás maradjon." },
        {
          type: "ul",
          items: [
            "utolsó vendégváltozások kezelése",
            "nyomtatott anyagok ellenőrzése",
            "szolgáltatók visszaigazolása",
            "vészcsomag összeállítása",
            "pihenés",
          ],
        },
        {
          type: "p",
          text: "Igen, a pihenés is teendő. Az esküvő nem projektzáró prezentáció, hanem egy közös nap, amit meg kell élni.",
        },
        { type: "h2", text: "Rövid összefoglaló" },
        {
          type: "p",
          text: "Az esküvőszervezés akkor lesz kezelhető, ha nem egyszerre próbáltok mindent megoldani. Legyen egy közös checklist, egy friss vendéglista, egy élő költségvetés és egy olyan rendszer, ahol mindketten ugyanazt látjátok.",
        },
        {
          type: "cta",
          lead: "A Wēddly segít egy helyen tartani a költségvetést, vendéglistát, RSVP válaszokat és ültetési rendet, hogy ne külön táblázatokból kelljen szerveznetek az esküvőt.",
          href: "/signup",
          label: "Tegyétek a helyére ingyen",
        },
        { type: "h2", text: "GYIK" },
        { type: "h3", text: "Mikor érdemes elkezdeni az esküvőszervezést?" },
        {
          type: "p",
          text: "Ideálisan 9-12 hónappal az esküvő előtt, de kisebb esküvőnél rövidebb idő is elég lehet.",
        },
        { type: "h3", text: "Mikor kell kiküldeni a meghívókat?" },
        {
          type: "p",
          text: "Általában 3-6 hónappal az esküvő előtt érdemes, attól függően, mennyi vendég utazik messzebbről.",
        },
        { type: "h3", text: "Mikor legyen végleges az ültetési rend?" },
        {
          type: "p",
          text: "A végleges RSVP válaszok után, jellemzően az esküvő előtti 2-4 hétben.",
        },
      ],
    },
    en: {
      title: "12-month wedding planning checklist: what to handle, when",
      lead: "Step by step: what to lock in a year, six months and a month before the wedding.",
      seo_title: "12-month wedding planning checklist · Weddly",
      seo_description:
        "A practical 12-month wedding planning checklist: what to handle a year, nine months, six, three, one month, and one week out.",
      body: [
        {
          type: "p",
          text: "Wedding planning only feels overwhelming when everything lands on you at once. Venue, guest list, photo, music, invites, attire, seating, menu, decor, stationery. It's easy to lose track.",
        },
        {
          type: "p",
          text: "The good news: it doesn't have to be solved in one go. Working in time-ordered phases makes it much calmer.",
        },
        { type: "h2", text: "12 months out" },
        { type: "p", text: "This is the period for the big decisions." },
        {
          type: "ul",
          items: [
            "pick the date",
            "decide the style",
            "draft a rough budget",
            "estimate guest count",
            "search for venues",
            "shortlist key vendors",
          ],
        },
        {
          type: "p",
          text: "You don't need every detail yet, just clear boundaries.",
        },
        { type: "h2", text: "9 months out" },
        { type: "p", text: "Time to start booking." },
        {
          type: "ul",
          items: [
            "venue contract",
            "photo / video",
            "band or DJ",
            "officiant / MC",
            "first guest-list draft",
            "wedding website or RSVP flow",
          ],
        },
        { type: "p", text: "The guest list will still move, but get a first version on paper." },
        { type: "h2", text: "6 months out" },
        { type: "p", text: "Now the details." },
        {
          type: "ul",
          items: [
            "invitation design",
            "RSVP deadline",
            "decor direction",
            "attire",
            "menu quotes",
            "accommodation / transport plan",
          ],
        },
        {
          type: "p",
          text: "By now your budget should be updating from real quotes, not just estimates.",
        },
        { type: "h2", text: "3 months out" },
        { type: "p", text: "Replies and refinements." },
        {
          type: "ul",
          items: [
            "track RSVPs",
            "update the guest list",
            "collect meal choices",
            "finalise vendor details",
            "first seating draft",
            "design the printed pieces",
          ],
        },
        {
          type: "p",
          text: "If everything still lives in separate spreadsheets it's easy to drop information. Keep it in one shared system.",
        },
        { type: "h2", text: "1 month out" },
        { type: "p", text: "Finalisation phase." },
        {
          type: "ul",
          items: [
            "submit final headcount",
            "lock the seating chart",
            "print table numbers and place cards",
            "vendor run-of-show",
            "check payment deadlines",
            "build the day-of timeline",
          ],
        },
        {
          type: "p",
          text: "Less about new ideas, more about everyone reading the same current information.",
        },
        { type: "h2", text: "1 week out" },
        { type: "p", text: "Only fine-tuning left." },
        {
          type: "ul",
          items: [
            "handle last guest changes",
            "review printed pieces",
            "vendor confirmations",
            "pack the emergency kit",
            "rest",
          ],
        },
        {
          type: "p",
          text: "Yes, rest is on the list. A wedding isn't a project closeout, it's a day you have to live in.",
        },
        { type: "h2", text: "Summary" },
        {
          type: "p",
          text: "Planning becomes manageable when you don't try to solve everything at once. Keep a shared checklist, a fresh guest list, a live budget, and one place where both of you see the same picture.",
        },
        {
          type: "cta",
          lead: "Weddly keeps your budget, guest list, RSVPs and seating chart together, so you don't have to plan from disconnected spreadsheets.",
          href: "/signup",
          label: "Set it up for free",
        },
        { type: "h2", text: "FAQ" },
        { type: "h3", text: "When should we start planning the wedding?" },
        {
          type: "p",
          text: "Ideally 9-12 months out. Smaller weddings can be planned faster.",
        },
        { type: "h3", text: "When should invitations go out?" },
        {
          type: "p",
          text: "Usually 3-6 months before the wedding, depending on how many guests travel.",
        },
        { type: "h3", text: "When should the seating chart be final?" },
        {
          type: "p",
          text: "After the final RSVPs, typically 2-4 weeks before the wedding.",
        },
      ],
    },
  },
  // ── 6. Digital vs paper invitation ─────────────────────────────────
  {
    slug: "digitalis-eskuvoi-meghivo-vagy-papir-meghivo",
    published_at: "2026-04-21",
    read_minutes: 6,
    category: { hu: "Meghívók", en: "Invitations" },
    hu: {
      title: "Digitális esküvői meghívó vagy papír meghívó: melyiket válasszátok?",
      lead: "Az előnyök, hátrányok, költségek és az RSVP folyamat összehasonlítása.",
      seo_title: "Digitális vagy papír esküvői meghívó · Wēddly",
      seo_description:
        "Digitális vagy papír esküvői meghívó? Összehasonlítjuk az előnyöket, hátrányokat, költségeket és azt, hogyan kapcsolódik az RSVP folyamatba.",
      body: [
        {
          type: "p",
          text: "Az esküvői meghívó az első dolog, amivel a vendégek találkoznak. Megadja az esküvő hangulatát, stílusát és a legfontosabb információkat. Ma már nem csak az a kérdés, milyen papírra készüljön, hanem az is, hogy kell-e egyáltalán papír.",
        },
        {
          type: "p",
          text: "A digitális meghívó és a klasszikus papír meghívó nem feltétlenül egymás ellentétei. Sok párnak a kettő kombinációja működik a legjobban.",
        },
        { type: "h2", text: "Papír meghívó: mikor jó választás?" },
        {
          type: "p",
          text: "A papír meghívó személyes, elegáns és kézzelfogható. Különösen akkor jó, ha fontos nektek a klasszikus esküvői élmény, vagy ha sok idősebb vendégetek van, akik jobban szeretik a hagyományos formát.",
        },
        { type: "p", text: "Előnyei:" },
        {
          type: "ul",
          items: [
            "szép emlék marad",
            "elegáns és ünnepélyes",
            "jól illik klasszikus esküvőkhöz",
            "személyesebbnek érződik",
          ],
        },
        { type: "p", text: "Hátrányai:" },
        {
          type: "ul",
          items: [
            "drágább lehet",
            "nyomtatási és postázási idővel kell számolni",
            "változás esetén nehéz frissíteni",
            "az RSVP-t külön kell kezelni",
          ],
        },
        { type: "h2", text: "Digitális meghívó: mikor praktikusabb?" },
        {
          type: "p",
          text: "A digitális meghívó gyors, könnyen frissíthető és jól kapcsolható RSVP rendszerhez. Ha változik az időpont, helyszín, menüinformáció vagy program, nem kell újranyomtatni semmit.",
        },
        { type: "p", text: "Előnyei:" },
        {
          type: "ul",
          items: [
            "gyorsan elküldhető",
            "mobilon könnyen megnyitható",
            "összeköthető RSVP-vel",
            "frissíthető információkkal",
            "költséghatékony",
          ],
        },
        { type: "p", text: "Hátrányai:" },
        {
          type: "ul",
          items: [
            "kevésbé ünnepélyesnek tűnhet",
            "nem minden vendég szereti",
            "figyelni kell arra, hogy ne vesszen el az üzenetek között",
          ],
        },
        { type: "h2", text: "A legjobb megoldás sokszor a kombináció" },
        {
          type: "p",
          text: "Sok pár úgy dönt, hogy a közeli családnak és néhány fontos vendégnek papír meghívót ad, míg a többi vendég digitális meghívót vagy RSVP linket kap.",
        },
        {
          type: "p",
          text: "Ez különösen praktikus, ha szeretnétek megőrizni az elegáns meghívó élményét, de közben nem akartok minden választ kézzel követni.",
        },
        { type: "h2", text: "Mire figyeljetek digitális meghívónál?" },
        {
          type: "p",
          text: "Egy jó digitális meghívó nem csak szép, hanem hasznos is. Tartalmazza:",
        },
        {
          type: "ul",
          items: [
            "a neveteket",
            "az esküvő dátumát",
            "helyszínt és címet",
            "programot",
            "dress code-ot, ha van",
            "RSVP határidőt",
            "menü- vagy allergiakérdéseket",
            "kapcsolattartási információt",
          ],
        },
        { type: "p", text: "A legfontosabb: a vendég tudja gyorsan jelezni, hogy jön-e." },
        { type: "h2", text: "Hogyan kapcsolódik ide az RSVP?" },
        {
          type: "p",
          text: "A digitális meghívó legnagyobb előnye, hogy azonnal összekapcsolható a visszajelzéssel. Nem kell külön üzeneteket, hívásokat és táblázatokat kezelni.",
        },
        {
          type: "p",
          text: "A vendég megnyitja a linket, válaszol néhány kérdésre, ti pedig látjátok a vendéglistában az aktuális státuszt.",
        },
        { type: "h2", text: "Rövid döntési segédlet" },
        { type: "h3", text: "Válasszatok papír meghívót, ha…" },
        {
          type: "ul",
          items: [
            "fontos az elegáns, klasszikus élmény",
            "sok idősebb vendégetek van",
            "szeretnétek kézzelfogható emléket",
          ],
        },
        { type: "h3", text: "Válasszatok digitális meghívót, ha…" },
        {
          type: "ul",
          items: [
            "gyors, praktikus megoldást szeretnétek",
            "sok adatot kell gyűjteni",
            "fontos az RSVP automatizálása",
            "szeretnétek csökkenteni a költségeket",
          ],
        },
        { type: "h3", text: "Válasszatok kombinált megoldást, ha…" },
        {
          type: "ul",
          items: [
            "szeretnétek szépet és praktikusat is",
            "a családnak adnátok papírt, másoknak digitális linket",
            "fontos az emlék, de nem akartok manuális RSVP káoszt",
          ],
        },
        {
          type: "cta",
          lead: "A Wēddly segítségével a vendégek saját RSVP linken jelezhetnek vissza, ti pedig egy helyen látjátok a válaszokat, kísérőket, menüket és megjegyzéseket.",
          href: "/signup",
          label: "Próbáljátok ki ingyen",
        },
        { type: "h2", text: "GYIK" },
        { type: "h3", text: "Elég csak digitális meghívót küldeni?" },
        {
          type: "p",
          text: "Igen, ha a vendégkörötök nyitott rá, és minden fontos információ könnyen elérhető benne.",
        },
        { type: "h3", text: "Kell papír meghívó is?" },
        {
          type: "p",
          text: "Nem kötelező, de szép gesztus lehet a családnak vagy azoknak, akik értékelik a hagyományos formát.",
        },
        { type: "h3", text: "Mi legyen a meghívóban a legfontosabb?" },
        {
          type: "p",
          text: "Dátum, helyszín, időpont, RSVP határidő és minden olyan információ, ami segíti a vendéget a döntésben.",
        },
      ],
    },
    en: {
      title: "Digital or paper wedding invitations: which should you choose?",
      lead: "Pros, cons, costs and how each affects the RSVP flow.",
      seo_title: "Digital or paper wedding invitations · Weddly",
      seo_description:
        "Compare digital and paper wedding invitations: upsides, downsides, costs, and how each connects to the RSVP process.",
      body: [
        {
          type: "p",
          text: "The invitation is the first thing your guests see. It sets the tone and carries the essential information. Today the question isn't only what paper to use, it's whether you need paper at all.",
        },
        {
          type: "p",
          text: "Digital and paper aren't opposites. For many couples the combination works best.",
        },
        { type: "h2", text: "Paper invitations: when they shine" },
        {
          type: "p",
          text: "Paper feels personal, elegant and tangible. It's a good fit if a classic experience matters to you, or if many guests prefer the traditional form.",
        },
        { type: "p", text: "Upsides:" },
        {
          type: "ul",
          items: [
            "becomes a keepsake",
            "elegant and formal",
            "fits a classic style",
            "feels more personal",
          ],
        },
        { type: "p", text: "Downsides:" },
        {
          type: "ul",
          items: [
            "more expensive",
            "print and postage lead times",
            "hard to update if details change",
            "RSVP has to be handled separately",
          ],
        },
        { type: "h2", text: "Digital invitations: when they're more practical" },
        {
          type: "p",
          text: "Digital is fast, easy to update, and connects directly to an RSVP system. If the date, venue, menu or schedule changes, nothing needs to be reprinted.",
        },
        { type: "p", text: "Upsides:" },
        {
          type: "ul",
          items: [
            "quick to send",
            "opens easily on mobile",
            "connects to RSVP",
            "updatable",
            "cost-effective",
          ],
        },
        { type: "p", text: "Downsides:" },
        {
          type: "ul",
          items: [
            "may feel less formal",
            "not every guest prefers it",
            "easy to lose in a message thread",
          ],
        },
        { type: "h2", text: "The hybrid often wins" },
        {
          type: "p",
          text: "Many couples send paper to close family and a few VIPs, while the rest of the guests get a digital invitation or RSVP link.",
        },
        {
          type: "p",
          text: "Practical if you want the elegant invitation experience without manually tracking every reply.",
        },
        { type: "h2", text: "What a digital invitation should include" },
        { type: "p", text: "A good digital invitation is both pretty and useful. Include:" },
        {
          type: "ul",
          items: [
            "your names",
            "date",
            "venue and address",
            "schedule",
            "dress code (if any)",
            "RSVP deadline",
            "meal / dietary questions",
            "contact info",
          ],
        },
        { type: "p", text: "Most important: the guest can reply quickly." },
        { type: "h2", text: "How RSVP fits in" },
        {
          type: "p",
          text: "Digital's biggest advantage is the direct link to RSVP. No separate messages, calls or spreadsheets.",
        },
        {
          type: "p",
          text: "The guest opens the link, answers a few questions, and you see live status in the guest list.",
        },
        { type: "h2", text: "Quick decision aid" },
        { type: "h3", text: "Choose paper if…" },
        {
          type: "ul",
          items: [
            "you want the classic experience",
            "you have many older guests",
            "you want a physical keepsake",
          ],
        },
        { type: "h3", text: "Choose digital if…" },
        {
          type: "ul",
          items: [
            "you want a fast, practical setup",
            "you need to collect lots of details",
            "RSVP automation matters",
            "you want to reduce costs",
          ],
        },
        { type: "h3", text: "Choose hybrid if…" },
        {
          type: "ul",
          items: [
            "you want both beauty and convenience",
            "paper for family, digital for everyone else",
            "you want the keepsake without manual RSVP",
          ],
        },
        {
          type: "cta",
          lead: "With Weddly each guest replies on their own RSVP link, and you see every reply, plus-one, meal and note in one place.",
          href: "/signup",
          label: "Try it free",
        },
        { type: "h2", text: "FAQ" },
        { type: "h3", text: "Is digital-only enough?" },
        {
          type: "p",
          text: "Yes, as long as your guest list is comfortable with it and all key information is easy to find.",
        },
        { type: "h3", text: "Do we still need a paper invitation?" },
        {
          type: "p",
          text: "Not required, but a nice gesture for family or anyone who values the traditional form.",
        },
        { type: "h3", text: "What's the most important content?" },
        {
          type: "p",
          text: "Date, venue, time, RSVP deadline, and everything else that helps the guest decide.",
        },
      ],
    },
  },
];
