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
  /** Inline figure. `src` is an http(s) image URL (e.g. a Wikimedia Commons
   *  `Special:FilePath` link) or a local `/uploads/...` path; `alt` is the
   *  accessibility text. `caption` shows below the image (venue name etc.);
   *  `credit` + `creditHref` carry photographer/licence attribution, with
   *  `creditHref` linking to the source page (helps SEO + satisfies CC-BY). */
  | {
      type: "img";
      src: string;
      alt: string;
      caption?: string;
      credit?: string;
      creditHref?: string;
    }
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
  /** EN slug for bilingual URL support. Undefined when the post is EN-primary
   *  (e.g. the "where-to-get-married-*" series), in which case `slug` already
   *  carries the EN-readable URL. */
  en_slug?: string;
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

/** Cover photo per seed slug. The image bytes are committed under
 *  `frontend/public/blog-covers/<slug>.jpg`, which Vite copies to
 *  `frontend/dist/blog-covers/<slug>.jpg`; the backend's direct-file-hit
 *  handler serves them at `/blog-covers/<slug>.jpg` in prod, and Vite serves
 *  the same path from `public/` in dev. This map is the single source of
 *  truth for seed covers — the boot seeder (`seedBlogPostsIfEmpty`) applies a
 *  slug's cover on insert and backfills it onto any existing row whose
 *  `cover_image_url` is still NULL (admin uploads, being non-null, are never
 *  overwritten). Keep keys in sync with the slugs in SEED_BLOG_POSTS. */
export const SEED_COVER_BY_SLUG: Record<string, string> = {
  "miert-hazasodunk-a-biblia-szerint": "/blog-covers/miert-hazasodunk-a-biblia-szerint.jpg",
  "bibliai-idezetek-eskuvore": "/blog-covers/bibliai-idezetek-eskuvore.jpg",
  "eskuvoi-koltsegvetes-keszitese": "/blog-covers/eskuvoi-koltsegvetes-keszitese.jpg",
  "eskuvoi-vendeglista-keszitese": "/blog-covers/eskuvoi-vendeglista-keszitese.jpg",
  "eskuvoi-ultetesi-rend-keszitese": "/blog-covers/eskuvoi-ultetesi-rend-keszitese.jpg",
  "eskuvoi-rsvp-kerdesek": "/blog-covers/eskuvoi-rsvp-kerdesek.jpg",
  "eskuvoszervezesi-checklist-12-honapra": "/blog-covers/eskuvoszervezesi-checklist-12-honapra.jpg",
  "digitalis-eskuvoi-meghivo-vagy-papir-meghivo":
    "/blog-covers/digitalis-eskuvoi-meghivo-vagy-papir-meghivo.jpg",
  "eskuvoi-hagyomanyok-praktikusan": "/blog-covers/eskuvoi-hagyomanyok-praktikusan.jpg",
  "eskuvoi-szertartas-menete": "/blog-covers/eskuvoi-szertartas-menete.jpg",
  "eskuvoszervezesi-checklist-6-honapra": "/blog-covers/eskuvoszervezesi-checklist-6-honapra.jpg",
  "eskuvoi-ugyintezes-lepesrol-lepesre": "/blog-covers/eskuvoi-ugyintezes-lepesrol-lepesre.jpg",
  "where-to-get-married-in-hungary": "/blog-covers/where-to-get-married-in-hungary.jpg",
  "where-to-get-married-in-austria": "/blog-covers/where-to-get-married-in-austria.jpg",
  "where-to-get-married-in-slovakia": "/blog-covers/where-to-get-married-in-slovakia.jpg",
};

/** EN slug for each HU-primary seed post. Posts that are already EN-primary
 *  (the "where-to-get-married-*" series) are omitted — their `slug` already
 *  carries a readable English URL and does not need a separate `en_slug`. */
export const SEED_EN_SLUG_BY_SLUG: Record<string, string> = {
  "miert-hazasodunk-a-biblia-szerint": "why-marry-according-to-the-bible",
  "bibliai-idezetek-eskuvore": "bible-verses-for-weddings",
  "eskuvoi-koltsegvetes-keszitese": "how-to-build-a-wedding-budget",
  "eskuvoi-vendeglista-keszitese": "wedding-guest-list-guide",
  "eskuvoi-ultetesi-rend-keszitese": "wedding-seating-chart-guide",
  "eskuvoi-rsvp-kerdesek": "wedding-rsvp-questions",
  "eskuvoszervezesi-checklist-12-honapra": "wedding-planning-checklist-12-months",
  "digitalis-eskuvoi-meghivo-vagy-papir-meghivo": "digital-vs-paper-wedding-invitations",
  "eskuvoi-hagyomanyok-praktikusan": "wedding-traditions-guide",
  "eskuvoi-szertartas-menete": "wedding-ceremony-step-by-step",
  "eskuvoszervezesi-checklist-6-honapra": "wedding-planning-checklist-6-months",
  "eskuvoi-ugyintezes-lepesrol-lepesre": "wedding-paperwork-guide",
};

export const SEED_BLOG_POSTS: BlogPost[] = [
  // ── 0a. Miért házasodunk a Biblia szerint? ─────────────────────────
  {
    slug: "miert-hazasodunk-a-biblia-szerint",
    published_at: "2026-05-27",
    read_minutes: 7,
    category: { hu: "Hit", en: "Faith" },
    hu: {
      title: "Miért házasodunk a Biblia szerint?",
      lead: "Teremtési rend, szövetség, Jézus tanítása és a hétköznapok programja: így olvassa a Biblia a házasság értelmét.",
      seo_title: "Miért házasodunk a Biblia szerint? · Wēddly",
      seo_description:
        "Mit mond a Biblia a házasság értelméről? Teremtési rend, szövetség, Jézus tanítása és Pál apostol gyakorlati programja bibliai idézetekkel.",
      body: [
        {
          type: "p",
          text: "Sokan az esküvőszervezés közben jutnak el a kérdéshez: mi az, ami miatt egyáltalán házasodunk? Hagyomány? Romantika? Adminisztrációs döntés? A Biblia ennél többet ajánl: a házasságot nem társadalmi kelléknek látja, hanem a teremtésbe írt ajándéknak, amelynek belső szerkezete van.",
        },
        {
          type: "p",
          text: "Nem dogmát szeretnénk kibontani, csak együtt végiggondolni, mit mond a Szentírás a házasság értelméről, és miért szólhat ez ma is, akár hívő, akár csak kereső szívvel olvasod.",
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
          text: "Az ézer kenegdó, így hangzik héberül a „segítő társ”, nem asszisztenst sejtet, hanem szembenálló, egyenrangú társat. Olyat, aki kiegészít, tükröt tart, finoman korrigál. A házasság itt nem rangsor, hanem találkozás.",
        },
        {
          type: "blockquote",
          text: "Annakokáért elhagyja a férfiú az ő atyját és az ő anyját, és ragaszkodik feleségéhez: és lesznek egy testté.",
          cite: "1Mózes 2,24",
        },
        {
          type: "p",
          text: "Három mozzanat egymás után: elhagyás, ragaszkodás, eggyé válás. A házasság a Biblia szerint új családot hoz létre, nem leváltja a régit, de elsődlegessé teszi az új köteléket. Ez a sorrend az, amit a Szentírás újra és újra visszahoz a házasság gyökereként.",
        },
        { type: "h2", text: "2. A házasság szövetség, nem szerződés" },
        {
          type: "p",
          text: "A Biblia újra és újra ugyanahhoz a szóhoz tér vissza, amikor a házasságról beszél: szövetség (héberül berít). Ez nem szerződés, ami a felek érdekét védi, hanem feltétel nélküli elköteleződés Isten színe előtt. A szerződés megszűnik, ha a másik fél megszegi. A szövetség akkor is áll, ha az egyik fél hibázik, mert a hűség nem a teljesítményhez, hanem a személyhez szól.",
        },
        {
          type: "blockquote",
          text: "Mert az Úr volt bizonyság közted és a te ifjúságod felesége közt, akit te megcsaltál; pedig ő a társad és szövetséges feleséged.",
          cite: "Malakiás 2,14",
        },
        {
          type: "p",
          text: "Malakiás itt kimondja, hogy a házasság előtt Isten áll tanúként. A „szövetséges feleség” (béríthekha) ugyanaz a szó, amelyet a Biblia Isten és népe kapcsolatára használ, és ehhez méri a házasságot is. Nem csak kettőtök ügye, hanem nyilvánosan, harmadik szem előtt kimondott elköteleződés.",
        },
        {
          type: "p",
          text: "Ebből érthető meg, miért tartja fontosnak a Szentírás az ünnepélyes esküt és a tanúk jelenlétét. Nem hivatali aktusként, hanem a szövetség természetéből fakadóan.",
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
          text: "Jézus tehát nem új tanítást ad, hanem az eredeti teremtési rendet erősíti meg: a házasság szövetség, amit Isten köt össze. Az „egy test” kifejezés nem csak testi egységet jelent, hanem a teljes élet összekapcsolódását.",
        },
        {
          type: "p",
          text: "Nem véletlen, hogy a templomi esküvőkön ezt a részt szokták felolvasni: arról szól, hogy a házasság nem a semmiből születik, hanem belesimul valami régebbi, nagyobb rendbe.",
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
          text: "A nyitány adja a kulcsot: engedelmeskedjetek egymásnak. Csak ezután szól külön a férjekhez, és náluk sem uralomról, hanem áldozati szeretetről beszél Krisztus mintájára, aki „önmagát adta” az egyházért. Ha ez a sorrend elcsúszik, a szakasz egészen másról kezd szólni.",
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
          text: "A Biblia nem szépíti meg a házasságot. Számol vele, hogy két ember között lesznek súrlódások, sebek, fáradtság. Nem azt ígéri, hogy ezek elkerülhetők, hanem azt, hogy van mód átmenni rajtuk.",
        },
        {
          type: "blockquote",
          text: "Ám haragudjatok, de ne vétkezzetek: a nap le ne menjen a ti haragotokon.",
          cite: "Efézus 4,26",
        },
        {
          type: "p",
          text: "Pál nem azt mondja, hogy ne haragudjunk, hanem azt, hogy ne hagyjuk elmérgesedni. Ne menjen le a nap a haragunkon: ne vigyük át holnapra azt, ami ma még helyrehozható egy kimondott szóval, egy bocsánatkéréssel.",
        },
        {
          type: "p",
          text: "A megbocsátás a Biblia szerint nem érzés, hanem döntés. Nem azt jelenti, hogy elfelejtjük a sérelmet, hanem azt, hogy nem ezen építjük tovább a kapcsolatot.",
        },
        { type: "h2", text: "6. A közös út: Isten harmadik fonalként" },
        {
          type: "p",
          text: "A Prédikátor egyik legszebb szakasza nem szól közvetlenül a házasságról, mégis a hagyomány régóta annak a képeként hallja.",
        },
        {
          type: "blockquote",
          text: "Sokkal jobban van dolga a kettőnek, hogynem az egynek; mert azoknak jó jutalmok van az ő munkájokból.\n\nMert ha elesnek is, az egyik felemeli a társát.\n\nÉs ha az egyiket megtámadja is valaki, ketten ellene állhatnak annak; és a hármas kötél nem hamar szakad el.",
          cite: "Prédikátor 4,9-12",
        },
        {
          type: "p",
          text: "A „hármas kötél” képében a keresztény olvasat a pár és Isten összefonódó szálát látja. A házasság így nem két ember magánügye, hanem három szálból szövődő közös jövő, és éppen ezért bírja ki a húzást.",
        },
        {
          type: "p",
          text: "Ez magyarázza, miért tartják sokan a templomi esküvőt nem ünnepi formaságnak, hanem a szövetségbe való belépésnek: az eskü Isten színe előtt hangzik el, és az ő jelenlétét hívja be a közös életbe.",
        },
        { type: "h2", text: "7. Mit jelent ez a gyakorlatban?" },
        {
          type: "p",
          text: "Akár hitből élitek meg a házasságot, akár csak gondolkodtok ezekről a kérdéseken, három dolog talán így is megáll.",
        },
        { type: "h3", text: "A házasság nem csak két emberre tartozik" },
        {
          type: "p",
          text: "A Biblia szerint a házasság szövetség, és szövetséget mindig harmadik fél előtt kötünk. Ezért kell hozzá a nyilvános eskü, a tanúk és, hívő szemmel, Isten jelenléte.",
        },
        { type: "h3", text: "A szeretet döntés, nem hangulat" },
        {
          type: "p",
          text: "A szeretet, amiről a Biblia beszél (héberül cheszed, görögül agapé) nem hangulat, hanem hűséges döntés. És ez különös módon felszabadító: a házasságnak nem kell minden reggel azon múlnia, hogy „érzitek”-e. Áll azon a döntésen, amit reggelente újra meghoztok.",
        },
        { type: "h3", text: "A megbocsátás napi gyakorlat" },
        {
          type: "p",
          text: "Két ember együttélése folyamatos kis sebek és kis bocsánatkérések sora. A Biblia nem azt kéri, hogy ne legyen konfliktus, hanem azt, hogy ne aludjatok rá. „Ne menjen le a nap a ti haragotokon”, talán ennél földhözragadtabb tanácsot nem is ad a Szentírás a házasságról.",
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
          text: "A szövetség nem szerződés. A szerződés a felek érdekét védi, és felbontható, ha a másik megszegi. A szövetség nyilvános, harmadik fél előtt tett elköteleződés, amely a hűséget nem a teljesítményhez, hanem a személyhez köti.",
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
          text: "Magyarországon a polgári szertartás a jogi szempontból elismert házasságkötés. Az egyházi szertartás hiten alapuló meggyőződés és a szövetség nyilvános, Isten előtti kimondása. A kettő nem zárja ki egymást: sokan ugyanazon a napon tartják mindkettőt.",
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
          text: "Not dogma, then, just a slow walk through what Scripture says about the meaning of marriage, and why it can still speak today, whether you come with faith or only with curiosity.",
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
          text: 'The Hebrew behind "help meet", ezer kenegdo, carries more weight than the word "assistant" suggests. It means an equal counterpart, someone who stands across from you, completes, mirrors, gently corrects. Marriage here isn\'t a hierarchy; it\'s an encounter.',
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
          text: "The Bible keeps returning to one word when it speaks of marriage: covenant (Hebrew berit). A contract protects each side's interest and dissolves on breach. A covenant is unconditional commitment in the presence of God, faithfulness bound to a person, not to performance.",
        },
        {
          type: "blockquote",
          text: "Because the Lord hath been witness between thee and the wife of thy youth, against whom thou hast dealt treacherously: yet is she thy companion, and the wife of thy covenant.",
          cite: "Malachi 2:14",
        },
        {
          type: "p",
          text: "Malachi roots marriage in God's witness. \"Wife of thy covenant\", the very word Scripture uses for God's bond with his people. By that measure, marriage isn't only between you two; it's a vow made in the open, before a third presence.",
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
          text: "Jesus offers no new teaching here, he reinforces the creation order. Marriage is a covenant God joins together. \"One flesh\" isn't only physical: it's a fusion of two whole lives.",
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
          text: "The opening line sets the key: mutual submission. Only then does Paul turn to husbands, and even there, it's sacrificial love modelled on Christ, not domination. If that order slips, the passage starts to say something else entirely.",
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
          text: "The Bible doesn't pretty up marriage. It assumes there will be conflict, hurt, tiredness. It doesn't promise you can avoid these, only that there is a way through them.",
        },
        {
          type: "blockquote",
          text: "Be ye angry, and sin not: let not the sun go down upon your wrath.",
          cite: "Ephesians 4:26",
        },
        {
          type: "p",
          text: "Paul doesn't say \"don't be angry\". He says don't let it fester. Don't let the sun go down on it, don't carry into tomorrow what could still be put right today with a word, a forgiveness.",
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
          text: "In the Christian reading, that \"threefold cord\" is the two of you plus God, three strands twisted into one. Marriage here isn't a private bond between two; it's a shared future woven of three. Which is why so many couples step into a church ceremony not as formality, but as stepping into the covenant itself.",
        },
        { type: "h2", text: "7. Practical takeaways" },
        { type: "h3", text: "Marriage is not only between two people" },
        {
          type: "p",
          text: "Marriage, in Scripture, is a covenant, and every covenant is made before a third. That's why the public vow, the witnesses and, for those who believe, God's presence are not extras but the heart of the thing.",
        },
        { type: "h3", text: "Love is a decision, not a mood" },
        {
          type: "p",
          text: "The love Scripture talks about (Hebrew chesed, Greek agape) isn't a mood; it's a faithful choice. And that is quietly freeing: marriage doesn't have to stand or fall on whether you both \"feel it\" today. It stands on the choice you renew each morning.",
        },
        { type: "h3", text: "Forgiveness is a daily practice" },
        {
          type: "p",
          text: "Two lives together means a steady drip of small hurts and small mendings. The Bible doesn't ask for no conflict, only that you don't sleep on it. \"Don't let the sun go down on your wrath\", perhaps the most down-to-earth piece of marriage advice Scripture ever gives.",
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
          text: "Scripture doesn't deny conflict. It gives a framework: speak truthfully (Eph 4:25), reconcile quickly (Eph 4:26), forgive each other (Col 3:13). Conflict isn't marriage's flaw, it's its maintenance ground.",
        },
        { type: "h3", text: "Do you have to have a church ceremony?" },
        {
          type: "p",
          text: "Civil ceremonies handle the legal side. A church ceremony is a faith decision and a public vow before God. The two aren't exclusive, many couples have both on the same day.",
        },
      ],
    },
  },
  // ── 0. Bibliai idézetek ────────────────────────────────────────────
  {
    slug: "bibliai-idezetek-eskuvore",
    published_at: "2026-05-25",
    read_minutes: 9,
    category: { hu: "Igék", en: "Verses" },
    hu: {
      title: "Bibliai idézetek esküvőre: igék szeretetről, házasságról és közös útról",
      lead: "A legszebb bibliai igék esküvőre: szeretetről, házasságról, hűségről, megbocsátásról és a közös útról.",
      seo_title: "Bibliai idézetek esküvőre: 30+ ige szeretetről és házasságról",
      seo_description:
        "A legszebb bibliai idézetek esküvőre: igék szeretetről, házasságról, hűségről, megbocsátásról és közös útról.",
      body: [
        {
          type: "p",
          text: "Sokan keresnek esküvőre bibliai idézetet, amelyet beleírnak a meghívóba, kitesznek az esküvői weboldalra vagy beemelnek a fogadalom mellé: egyetlen mondatban szeretnék kimondani azt, ami a legmélyebb az életükben. A Szentírás bőven kínál ilyen mondatokat: igéket szeretetről, házasságról, közös útról, tiszteletről és megbocsátásról.",
        },
        {
          type: "p",
          text: "A klasszikus, ünnepélyes magyar fordításnak van a leghagyományosabb esküvői hangulata, ezért az alábbi igék ebből szólalnak meg. Ha modernebb nyelvezet áll közelebb hozzátok, az új fordítások hasonló mélységgel beszélnek, csak közérthetőbb stílusban.",
        },
        { type: "h2", text: "Rövid bibliai idézetek esküvői meghívóra" },
        {
          type: "p",
          text: "Egy rövid ige önmagában is megáll a meghívón, az ültetőkártyán, az esküvői weboldal nyitólapján vagy a vendégkönyv mottójaként.",
        },
        {
          type: "ul",
          items: [
            "„Ezek között pedig legnagyobb a szeretet.”, 1Korinthus 13,13",
            "„Minden dolgotok szeretetben menjen végbe!”, 1Korinthus 16,14",
            "„Szeretteim, szeressük egymást.”, 1János 4,7",
            "„Az Isten szeretet.”, 1János 4,8",
            "„A szeretetben nincsen félelem.”, 1János 4,18",
            "„Nem jó az embernek egyedül lenni.”, 1Mózes 2,18",
            "„Lesznek ketten egy testté.”, Márk 10,8",
            "„Amit az Isten egybe szerkesztett, ember el ne válassza.”, Márk 10,9",
            "„A hármas kötél nem hamar szakad el.”, Prédikátor 4,12",
            "„Az én szerelmesem enyém, és én az övé.”, Énekek éneke 2,16",
            "„Erős a szeretet, mint a halál.”, Énekek éneke 8,6",
            "„Sok vizek el nem olthatnák e szeretetet.”, Énekek éneke 8,7",
            "„A tiszteletadásban egymást megelőzők legyetek.”, Róma 12,10",
            "„Legyetek pedig egymáshoz jóságosak, irgalmasok.”, Efézus 4,32",
            "„Öltözzétek föl a szeretetet.”, Kolossé 3,14",
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
          text: "Pál itt szinte lebontja a szeretetet: nem érzésként, hanem mozdulatokként mutatja meg. Türelem, jóság, alázat, kitartás, olyan szavak, amelyeket csak a hétköznapokban lehet megtanulni. A görög szöveg végig az agapé (ἀγάπη) szót használja, ami nem a vágy (éros) és nem is a barátság (philía) szeretete, hanem akaratlagos, feltétlen jóindulat. A házasság éppen ezt a lassú iskolát kínálja: napról napra gyakorolni azt, ami soha el nem fogy.",
        },
        { type: "h3", text: "1Korinthus 13,11-13" },
        {
          type: "blockquote",
          text: "Mikor gyermek valék, úgy szóltam, mint gyermek, úgy gondolkodtam, mint gyermek, úgy értettem, mint gyermek: minekutána pedig férfiúvá lettem, elhagytam a gyermekhez illő dolgokat.\n\nMert most tükör által homályosan látunk, akkor pedig színről színre; most rész szerint van bennem az ismeret, akkor pedig úgy ismerek majd, amint én is megismertettem.\n\nMost azért megmarad a hit, remény, szeretet, e három; ezek között pedig legnagyobb a szeretet.",
          cite: "1Korinthus 13,11-13",
        },
        {
          type: "p",
          text: "Pál saját felnőtté válásáról vall: van, amit csak idővel értünk meg igazán. A szeretet sem áll meg a kezdeti rajongásnál, érlelődik, mélyül, és lassan megtanul látni a homályon át. A házasság ennek a növekedésnek ad teret: együtt indulni el gyermeki örömmel, és együtt érkezni meg a hűség csendesebb, érettebb szeretetébe.",
        },
        { type: "h3", text: "1János 4,7-8" },
        {
          type: "blockquote",
          text: "Szeretteim, szeressük egymást: mert a szeretet az Istentől van; és mindaz, aki szeret, az Istentől született, és ismeri az Istent.\n\nAki nem szeret, nem ismerte meg az Istent; mert az Isten szeretet.",
          cite: "1János 4,7-8",
        },
        {
          type: "p",
          text: "János egészen mélyre megy: ahol szeretet van, ott Isten van, még akkor is, ha nem nevezzük néven. A görög szöveg úgy fogalmaz: ho theos agapé estin (ὁ θεὸς ἀγάπη ἐστίν), vagyis nem azt mondja, hogy Isten szeret (igeként), hanem hogy a lényege ez (főnévként). A szeretet nem a mi találmányunk, hanem valami nagyobbnak a visszhangja. Két ember egymáshoz fordulása így mindig több önmagánál: az Istentől kapott szeretetet adjuk tovább, valahányszor szelíden választjuk a másikat.",
        },
        { type: "h3", text: "1János 4,11-12" },
        {
          type: "blockquote",
          text: "Szeretteim, ha így szeretett minket az Isten, nekünk is szeretnünk kell egymást.\n\nAz Istent soha senki nem látta: Ha szeretjük egymást, az Isten bennünk marad, és az ő szeretete teljessé lett bennünk.",
          cite: "1János 4,11-12",
        },
        {
          type: "p",
          text: "János itt valami megrendítőt mond: Istent senki nem látta, de ha szeretjük egymást, mégis láthatóvá lesz közöttünk. A házasság így titkos szolgálat is, a házastárs felé kinyújtott kéz, a meghallgatott panasz, az újra és újra kimondott „bocsáss meg” mind kis ablakok arra, hogy Isten szeretete bennünk lakást vesz.",
        },
        { type: "h3", text: "1János 4,16-18" },
        {
          type: "blockquote",
          text: "És mi megismertük és elhittük az Istennek irántunk való szeretetét.\n\nAz Isten szeretet; és aki a szeretetben marad, az Istenben marad, és az Isten is ő benne.\n\nA szeretetben nincsen félelem; sőt a teljes szeretet kiűzi a félelmet.",
          cite: "1János 4,16-18",
        },
        {
          type: "p",
          text: "A szeretetben nincs félelem, nem mert nincsenek nehézségek, hanem mert van valaki, akiben végre megnyughatunk. János azt mondja, ez a megnyugvás végül Istenből árad. A házasságban ez a tapasztalat formát kap: van otthon, ahol nem kell védekezni, és van társ, aki előtt nem kell tökéletesnek látszani.",
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
          text: "Az egész teremtésben ez az első dolog, amiről Isten azt mondja: „nem jó”. Nem jó egyedül. Nem hiány, nem hiba, egyszerűen az ember természete, hogy társra van szabva. A házasság ennek a vágynak ad nevet és helyet: két élet azért fordul egymás felé, mert egyikünk sem teljes magában.",
        },
        { type: "h3", text: "1Mózes 2,21-24" },
        {
          type: "blockquote",
          text: "Bocsáta tehát az Úr Isten mély álmot az emberre, és ez elaluvék. Akkor kivőn egyet annak oldalbordái közül, és hússal tölté be annak helyét.\n\nÉs alkotá az Úr Isten azt az oldalbordát, amelyet kivett vala az emberből, asszonynyá, és vivé az emberhez.\n\nÉs monda az ember: Ez már csontomból való csont, és testemből való test.\n\nAnnakokáért elhagyja a férfiú az ő atyját és az ő anyját, és ragaszkodik feleségéhez: és lesznek egy testté.",
          cite: "1Mózes 2,21-24",
        },
        {
          type: "p",
          text: "Megrendítő kép: a társ nem kívülről érkezik, hanem az ember legmélyebb belsejéből vétetik. Ezért szól a felismerés is így: „csontomból való csont”. A héber szöveg az „egy testté lesznek” helyén a baszar echád (בָּשָׂר אֶחָד) kifejezést használja, ami szó szerint „egy hús”, de nem csak testi egységet jelent, hanem az egész lényt érintő összeforrottságot. A házasság nem két idegen találkozása, hanem két élet egymásra ismerése: az elhagyás, ragaszkodás, eggyé válás mozdulatában új otthon születik.",
        },
        { type: "h3", text: "Máté 19,4-6" },
        {
          type: "blockquote",
          text: "Ő pedig felelvén, monda: Nem olvastátok-é, hogy a teremtő kezdettől fogva férfiúvá és asszonynyá teremté őket,\n\nÉs ezt mondá: Annak okáért elhagyja a férfiú atyját és anyját; és ragaszkodik feleségéhez, és lesznek ketten egy testté.\n\nÚgy hogy többé nem kettő, hanem egy test. Amit azért az Isten egybeszerkesztett, ember el ne válassza.",
          cite: "Máté 19,4-6",
        },
        {
          type: "p",
          text: "Jézus a kezdetekhez nyúl vissza: a házasság nem emberi szerződés, hanem Isten összeszerkesztése. A görögben a synzeugnymi (συζεύγνυμι) szót használja, ami „közös igába fogni” jelentésű: két ökör egy iga alatt, egyenlő terhet vinni. Ez a szó gyengéd és kemény egyszerre: nem két különálló élet összetolása, hanem egy új egész készítése. Ezért szólal meg a folytatás komolyan: amit Ő szerkesztett egybe, azt ne bontsa szét emberi kéz.",
        },
        { type: "h3", text: "Márk 10,6-9" },
        {
          type: "blockquote",
          text: "De a teremtés kezdete óta férfiúvá és asszonnyá teremté őket az Isten.\n\nAnnakokáért elhagyja az ember az ő atyját és anyját; és ragaszkodik a feleségéhez,\n\nÉs lesznek ketten egy testté! Azért többé nem két, hanem egy test.\n\nAnnakokáért amit az Isten egybe szerkesztett, ember el ne válassza.",
          cite: "Márk 10,6-9",
        },
        {
          type: "p",
          text: "Márknál Jézus szinte ugyanazokkal a szavakkal beszél, mintha külön nyomatékot kapna: a házasság nem újkori találmány, hanem ott áll a teremtés kezdeténél. Férfi és nő egymás felé fordulása Isten szándékának része, és ez a szándék azóta is hordozza azokat a párokat, akik egymásnak igent mondanak.",
        },
        { type: "h3", text: "Efézus 5,21" },
        {
          type: "blockquote",
          text: "Engedelmesek legyetek egymásnak Isten félelmében.",
          cite: "Efézus 5,21",
        },
        {
          type: "p",
          text: "Pál egyetlen mondatban felforgatja a házasságról szóló gondolatokat: egymásnak engedelmeskedjetek. Nem egyikőtök a másiknak, hanem mindketten, és ezt nem külső kényszerből, hanem Isten iránti tiszteletből. Ez a kölcsönös meghajlás a házasság csendes alapja: nincs benne győztes és vesztes, csak két ember, aki naponta odafigyel a másikra.",
        },
        { type: "h3", text: "Efézus 5,25" },
        {
          type: "blockquote",
          text: "Ti férfiak, szeressétek a ti feleségeteket, miképpen a Krisztus is szerette az egyházat, és Önmagát adta azért.",
          cite: "Efézus 5,25",
        },
        {
          type: "p",
          text: "Pál Krisztus mércéjéhez köti a férj szeretetét: úgy, ahogy ő szerette az egyházat, vagyis önmagát adva. Ebben nincs hatalom, csak odaajándékozás. Aki így szeret, nem azt nézi, mit kap a társától, hanem azt, mit ad oda magából. Ez a fajta szeretet nem teljesítmény, hanem napról napra megújuló döntés.",
        },
        { type: "h3", text: "Efézus 5,28-33" },
        {
          type: "blockquote",
          text: "Úgy kell a férfiaknak szeretni az ő feleségöket, mint az ő tulajdon testöket. Aki szereti az ő feleségét, önmagát szereti.\n\nMert soha senki az ő tulajdon testét nem gyűlölte; hanem táplálgatja és ápolgatja azt, miképpen az Úr is az egyházat.\n\nAnnakokáért elhagyja az ember atyját és anyját, és ragaszkodik az ő feleségéhez; és lesznek ketten egy testté.\n\nHanem azért ti is egyen-egyen, ki-ki az ő feleségét úgy szeresse, mint önmagát.",
          cite: "Efézus 5,28-33",
        },
        {
          type: "p",
          text: "Pál egyszerű képpel beszél: a társadat úgy szereted, mint a saját testedet, táplálod, ápolod, óvod. Nem hősies áldozatról van szó, hanem a hétköznapi gondoskodásról: észrevenni, ha fáradt, lassítani, ha túl gyorsan élünk. A házasságban így lesz a szeretet láthatóvá: nem szavakban, hanem abban, ahogy egymással bánunk.",
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
          text: "A Prédikátor józanul beszél: az életben elesünk. Nem ha, hanem amikor. És ebben a tényben rejlik a társ ajándéka, nem azért jó kettesben, mert így minden könnyebb, hanem mert van, aki a porból felemel. A házasság ezt a hűséget vállalja: ott lenni, amikor a másik a földön van.",
        },
        { type: "h3", text: "Prédikátor 4,11-12" },
        {
          type: "blockquote",
          text: "Hogyha együtt feküsznek is ketten, megmelegszenek; az egyedülvaló pedig mimódon melegedhetik meg?\n\nÉs ha az egyiket megtámadja is valaki, ketten ellene állhatnak annak; és a hármas kötél nem hamar szakad el.",
          cite: "Prédikátor 4,11-12",
        },
        {
          type: "p",
          text: "A hármas kötél képe meghitt és erős egyszerre: két szál önmagában könnyen elszakad, három már kitart. Sokan úgy olvassák, hogy a házasság sem csupán két ember dolga, Isten a harmadik szál, aki a kötést tartja, amikor a mi erőnk fogytán van. A meleg, az oltalom, a kitartás mind innen ered.",
        },
        { type: "h3", text: "Ruth 1,16-17" },
        {
          type: "blockquote",
          text: "Ne unszolj engem, hogy elhagyjalak, hogy visszaforduljak tőled. Mert ahová te mégy, oda megyek, és ahol te megszállsz, ott szállok meg; néped az én népem, és Istened az én Istenem.\n\nAhol te meghalsz, ott halok meg, ott temessenek el engem is.",
          cite: "Ruth 1,16-17",
        },
        {
          type: "p",
          text: "Ruth szavai egy idős asszony mellé szegődő fiatalasszony szájából hangzanak el, mégis a házassági fogadalom legszebb visszhangja él bennük. Nemcsak hozzád megyek, a néped, az Istened, az életed is az enyém lesz. Ez a teljes odakötődés a házasság szíve: nem feltételek mellett, hanem a sors közös vállalásában.",
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
          text: "„Kösd a nyakadra, írd a szíved táblájára”, gyengéd, mégis komoly kép. A bölcs nem érzelmet ajánl, hanem mindennap viselt ékszert: az irgalmasságot és az igazságot. A házasság éppen ilyen viselet, nem ünneplő ruha, hanem a szívre írt szövetség, amiben végül mind kedvesebbé válunk Isten és ember előtt.",
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
          text: "Pál a megbocsátást nem érzelemnek tartja, hanem öltözéknek: levetni a haragot, fölvenni a jóságot. És a mérce nem az, hogy a másik megérdemli-e, hanem hogy Krisztus is megengedett nekünk. A házasságban itt dől el sok minden: meddig hordozzuk a sérelmet, és mikor merjük letenni azzal, hogy mi is kaptunk kegyelmet.",
        },
        { type: "h3", text: "Róma 12,9-10" },
        {
          type: "blockquote",
          text: "A szeretet képmutatás nélkül való legyen. Iszonyodjatok a gonosztól, ragaszkodjatok a jóhoz.\n\nAtyafiúi szeretettel egymás iránt gyöngédek; a tiszteletadásban egymást megelőzők legyetek.",
          cite: "Róma 12,9-10",
        },
        {
          type: "p",
          text: "Pál egy mondatban két olyan dolgot köt össze, amit könnyű szétválasztani: szeretet és tisztelet. „A tiszteletadásban egymást megelőzők legyetek”, vagyis ne azt várjuk, hogy minket vegyenek észre, hanem mi vegyük észre a másikat először. A házasságban ez a gyengédség óvja a szeretetet attól, hogy egy idő után megszokássá fakuljon.",
        },
        { type: "h3", text: "Kolossé 3,12-14" },
        {
          type: "blockquote",
          text: "Öltözzétek föl azért mint az Istennek választottai, szentek és szeretettek, könyörületes szívet, jóságosságot, alázatosságot, szelídséget, hosszútűrést;\n\nElszenvedvén egymást és megbocsátván kölcsönösen egymásnak, ha valakinek valaki ellen panasza volna; miképen a Krisztus is megbocsátott néktek, akképen ti is;\n\nMindezeknek fölébe pedig öltözzétek föl a szeretetet, mint amely a tökéletességnek kötele.",
          cite: "Kolossé 3,12-14",
        },
        {
          type: "p",
          text: "Pál öltözködésről beszél: a hívő ember mindennap fölveszi a könyörületet, a jóságot, az alázatot, a szelídséget, a türelmet, és mindezek fölé a szeretetet, mint köpenyt. A házasság sem máshogy működik: nem érzelmi állapot, amit megkapunk, hanem ruha, amit reggelente magunkra veszünk, és amiben a másikhoz fordulunk.",
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
          text: "„Kelj fel, én mátkám, és jöjj”, a Vőlegény hangja hív, és a tél, az eső, a sötétség elmúlt. Az Énekek éneke itt valami nagyobbat is sejtet: nem csak a szerelmesek tavasza ez, hanem minden új kezdet képe. A házasság is ilyen hívás, a régi magány tele véget ér, és kezdődik az énekek és virágok ideje.",
        },
        { type: "h3", text: "Énekek éneke 2,16" },
        {
          type: "blockquote",
          text: "Az én szerelmesem enyém, és én az övé.",
          cite: "Énekek éneke 2,16",
        },
        {
          type: "p",
          text: "Az egész szövetséget egyetlen mondatba sűríti: az enyém, és én az övé. A héberben dodi li va-ani lo (דּוֹדִי לִי וַאֲנִי לוֹ), egyszerű, ritmusos szerkezet, mintha esküt mondanának. Nincs feltétel, nincs magyarázkodás, csak ez a kölcsönös odatartozás. A házasság szíve is ez: nem birtoklás, hanem örömteli kimondása annak, hogy életünk innentől már nem két külön történet.",
        },
        { type: "h3", text: "Énekek éneke 4,7" },
        {
          type: "blockquote",
          text: "Mindenestől szép vagy, én mátkám, és semmi szeplő nincs benned!",
          cite: "Énekek éneke 4,7",
        },
        {
          type: "p",
          text: "„Mindenestől szép vagy, én mátkám”, a Vőlegény tekintete nem hibakeresőn néz, hanem szerelmesen. A szeretet ilyen: nem becsukja a szemét a valóság előtt, de a másikat egészében, szeplőtlenül látja. A házasságban újra és újra ezt a tekintetet ajándékozzuk egymásnak, ezt a fajta szépséget, amit csak a szerető szem lát meg.",
        },
        { type: "h3", text: "Énekek éneke 8,6-7" },
        {
          type: "blockquote",
          text: "Tégy engem mint egy pecsétet a te szívedre, mint egy pecsétet a te karodra; mert erős a szeretet, mint a halál.\n\nSok vizek el nem olthatnák e szeretetet, a folyóvizek sem boríthatnák el azt.",
          cite: "Énekek éneke 8,6-7",
        },
        {
          type: "p",
          text: "„Tégy engem pecsétként a szívedre”, a szerelmes nem szóbeli ígéretet kér, hanem maradandó nyomot. A héberben a chotam (חוֹתָם) pecsétet jelent: az ókorban személyes aláírást, tulajdonjogot, kötelező érvényű jelet hordozott. A szerelmes tehát nem csak emléket kér, hanem teljes és visszavonhatatlan elköteleződést. A szeretet ereje pedig olyan, mint a halálé: nem múlik el, nem oltják el a vizek, nem mossák el az árvizek. A házasság ezt a mély, kitartó szeretetet vállalja, olyat, ami nem a könnyebb napoktól lesz erős, hanem attól, hogy a nehezeken is megmarad.",
        },
        { type: "h2", text: "Melyik bibliai idézet illik hozzátok?" },
        {
          type: "p",
          text: "A választáshoz érdemes arra figyelni, milyen hangulatot szeretnétek megütni. A klasszikus, ünnepélyes szöveg illik a templomi esküvőhöz, az Énekek éneke költőibb, közelebb áll egy szabadtéri, romantikus szertartáshoz. Rövid meghívóra az 1Korinthus 13,13 vagy az Énekek éneke 2,16 csendesen, de erősen szólal meg.",
        },
        {
          type: "p",
          text: "Ha vegyes meggyőződésű vendégkör jön, érdemes egy olyan igét választani, amely Istentől függetlenül is érthető emberközeli üzenetet hordoz: például a Prédikátor 4 vagy a Kolossé 3.",
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
        { type: "h3", text: "Klasszikus vagy modern fordítású idézetet válasszunk?" },
        {
          type: "p",
          text: "A klasszikus magyar fordítás ünnepélyesebb, archaikus hangulatú. A modernebb fordítások közérthetőbbek és könnyedebbek. Esküvőhöz általában a klasszikus változat közelebb áll a hagyományhoz, és a saját szavakkal írt rövid magyarázat segít, hogy a vendégeknek is megnyíljon a jelentése.",
        },
      ],
    },
    en: {
      title: "Bible verses for your wedding: love, marriage and shared life",
      lead: "A curated set of Bible verses for invitations, ceremonies and vows: love, marriage, faithfulness and forgiveness.",
      seo_title: "Bible verses for weddings: passages on love and marriage · Weddly",
      seo_description:
        "A curated set of Bible verses for weddings: love, marriage, faithfulness, forgiveness and shared life.",
      body: [
        {
          type: "p",
          text: "Many couples want a Bible verse on the invitation, on the wedding website, or as part of the vows. Below is a curated set, grouped by theme: love, marriage, shared life, respect and forgiveness.",
        },
        { type: "h2", text: "Short verses for invitations" },
        {
          type: "ul",
          items: [
            '"The greatest of these is love.", 1 Corinthians 13:13',
            '"Let all your things be done with charity.", 1 Corinthians 16:14',
            '"Beloved, let us love one another.", 1 John 4:7',
            '"God is love.", 1 John 4:8',
            '"There is no fear in love.", 1 John 4:18',
            '"It is not good that the man should be alone.", Genesis 2:18',
            '"They twain shall be one flesh.", Mark 10:8',
            '"What God hath joined together, let not man put asunder.", Mark 10:9',
            '"A threefold cord is not quickly broken.", Ecclesiastes 4:12',
            '"I am my beloved\'s, and my beloved is mine.", Song of Solomon 2:16',
            '"Love is strong as death.", Song of Solomon 8:6',
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
          text: "Paul almost dismantles love here: not as a feeling, but as a series of small, daily motions, patience, kindness, humility, endurance. These are not words you can perform on a single day; they are learned slowly, in ordinary life. Marriage is exactly that classroom: practising, day by day, the kind of love that never ends.",
        },
        { type: "h3", text: "1 John 4:7-8" },
        {
          type: "blockquote",
          text: "Beloved, let us love one another: for love is of God; and every one that loveth is born of God, and knoweth God.\n\nHe that loveth not knoweth not God; for God is love.",
          cite: "1 John 4:7-8",
        },
        {
          type: "p",
          text: "John goes to the root: wherever love is, God is, even when we do not name him. Love is not our invention but an echo of something larger. So when two people turn toward each other, they are doing more than they know: they are passing on a love that was first given to them.",
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
          text: "In the whole story of creation, this is the first thing God calls not good: aloneness. Not a flaw, not a failing, simply the shape of being human. We are made to be received by another, and marriage gives this longing a name and a home: two lives turning toward each other because neither is complete in itself.",
        },
        { type: "h3", text: "Mark 10:6-9" },
        {
          type: "blockquote",
          text: "But from the beginning of the creation God made them male and female.\n\nFor this cause shall a man leave his father and mother, and cleave to his wife;\n\nAnd they twain shall be one flesh: so then they are no more twain, but one flesh.\n\nWhat therefore God hath joined together, let not man put asunder.",
          cite: "Mark 10:6-9",
        },
        {
          type: "p",
          text: "Jesus reaches back to the beginning: marriage is not a private arrangement but something God himself joins together. That phrase, joined together, is gentle and weighty at once: not two lives glued side by side, but knit into one. And what God knits, he asks us to handle with care.",
        },
        { type: "h3", text: "Ephesians 5:21, 25" },
        {
          type: "blockquote",
          text: "Submitting yourselves one to another in the fear of God.\n\nHusbands, love your wives, even as Christ also loved the church, and gave himself for it.",
          cite: "Ephesians 5:21, 25",
        },
        {
          type: "p",
          text: "Paul begins with mutual submission and ends with a husband loving as Christ loved, a love that gave itself away. The picture is not hierarchy but kneeling: each partner bending toward the other, willing to be the first to serve. Marriage lives in that shared lowering, where neither tries to win and both are quietly held.",
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
          text: "The Preacher is sober: in life, we fall. Not if, but when. And in that simple fact lies the gift of a companion, someone to reach down and lift the other up. The threefold cord, often taken as the couple and God, names the deeper hope: that the bond holding two people together is stronger than either of them alone.",
        },
        { type: "h3", text: "Ruth 1:16-17" },
        {
          type: "blockquote",
          text: "Intreat me not to leave thee, or to return from following after thee: for whither thou goest, I will go; and where thou lodgest, I will lodge: thy people shall be my people, and thy God my God:\n\nWhere thou diest, will I die, and there will I be buried.",
          cite: "Ruth 1:16-17",
        },
        {
          type: "p",
          text: "Ruth speaks these words to an older woman, yet they carry the very heart of a wedding vow. Not just I will come with you, but your people will be my people, your God my God. It is the full self, handed over without conditions, the kind of belonging that marriage learns to live out, day after day, in the ordinary places.",
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
          text: "Paul does not hand out grand words; he hands out the everyday clothing of a shared life: lowliness, meekness, longsuffering, bearing one another in love. None of these glitter, yet these are what keep peace alive when two lives rub against each other. The big yes of a wedding is held in place by countless small yeses afterward.",
        },
        { type: "h3", text: "Colossians 3:12-14" },
        {
          type: "blockquote",
          text: "Put on therefore, as the elect of God, holy and beloved, bowels of mercies, kindness, humbleness of mind, meekness, longsuffering;\n\nForbearing one another, and forgiving one another, if any man have a quarrel against any: even as Christ forgave you, so also do ye.\n\nAnd above all these things put on charity, which is the bond of perfectness.",
          cite: "Colossians 3:12-14",
        },
        {
          type: "p",
          text: "Paul speaks of getting dressed: each morning, put on mercy, kindness, humility, gentleness, patience, and over all of these, love, like a coat that holds everything else together. Marriage is not a feeling we wait to feel; it is a garment we put on, day after day, and quietly wear toward the other.",
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
          text: '"Rise up, my love, and come away", the Beloved calls, and winter, rain and darkness are already past. The Song hints at something larger than two lovers: every true beginning sounds like this. Marriage, too, is such a call, the long season of being alone draws to an end, and the time of singing comes.',
        },
        { type: "h3", text: "Song of Solomon 8:6-7" },
        {
          type: "blockquote",
          text: "Set me as a seal upon thine heart, as a seal upon thine arm: for love is strong as death;\n\nMany waters cannot quench love, neither can the floods drown it.",
          cite: "Song of Solomon 8:6-7",
        },
        {
          type: "p",
          text: '"Set me as a seal upon your heart", the lover asks not for a passing promise but for a lasting mark. And the strength of love is named in the same breath as death: many waters cannot quench it, no flood can sweep it away. Marriage takes on this kind of love, not strong because the days are easy, but strong because it remains through the hard ones.',
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
        "Esküvői költségvetés egyszerűen: hogyan osszátok fel a keretet, hogyan számoljatok vendégszámmal, és hogyan kerülhetitek el a túlköltést.",
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
          text: "Ezért nem elég annyit írni, hogy „kb. 90 fő”. Érdemes több verzióval számolni:",
        },
        {
          type: "ul",
          items: ["szűk esküvő: 50 fő", "közepes esküvő: 80 fő", "nagyobb esküvő: 120 fő"],
        },
        { type: "p", text: "Így hamar látszik, melyik forgatókönyv fér bele kényelmesen." },
        { type: "h2", text: "3. Ne csak a végösszeget nézzétek" },
        {
          type: "p",
          text: "Könnyű csak azt nézni, hogy a teljes költségvetés még belefér-e. Sokkal többet segít, ha kategóriánként is látjátok, hol csúsztatok el.",
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
          text: "Sokat segít, ha a költségvetés, a vendéglista és az ültetés ugyanazon a felületen él, így amikor mozdul a vendégszám, nem kell három külön helyen átírni.",
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
          text: "It's tempting to watch only the grand total. What helps more is seeing, category by category, where you've quietly slipped over.",
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
          text: "It helps a lot when the budget, guest list and seating sit in one workspace, so a change in guest count doesn't mean tracking the knock-on effects in three different files. (That's why we built Weddly the way we did.)",
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
      title: "Esküvői vendéglista készítése: hogyan legyen végre átlátható",
      lead: "Így gyűjtsétek egy helyre a neveket, kísérőket, RSVP-válaszokat, ételválasztásokat és speciális igényeket.",
      seo_title: "Esküvői vendéglista készítése · Wēddly",
      seo_description:
        "Esküvői vendéglista stressz nélkül: így gyűjtsétek össze a neveket, plus one-okat, RSVP válaszokat, ételválasztásokat és speciális igényeket.",
      body: [
        {
          type: "p",
          text: "A vendéglista az esküvőszervezés egyik legfontosabb alapja, és mégis ez az, ami a leghamarabb széthullik: pár táblázat, néhány jegyzet, egy-két üzenetváltás. Valaki már visszajelzett, valaki még nem. Az egyik hozna kísérőt, a másik vegetáriánus menüt kér, a harmadik még nem biztos benne, hogy jön.",
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
          text: "A „majd szóban jelzik” ritkán működik jól. Sokkal egyszerűbb, ha minden vendég kap egy saját RSVP linket, ahol gyorsan vissza tud jelezni.",
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
          text: "A kísérők kérdése az, ami a legtöbbször elcsúszik. Érdemes előre eldönteni, kik hozhatnak plus one-t, és utána ehhez tartani magatokat, még akkor is, ha kínos egy-két helyzet.",
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
          text: "Sokat ér, ha a vendéglista, az RSVP és az ültetés ugyanott él, mert így egy lemondást vagy egy új ételérzékenységet elég egyszer beírni.",
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
          text: "The guest list is one of the foundations of planning, and it's also the first thing that tends to scatter, a spreadsheet here, a few notes there, two chat threads. Someone has replied, someone hasn't. One wants a plus-one, another needs a vegetarian menu, a third still isn't sure.",
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
          text: "Plus-ones are where things slip most often. Decide upfront who can bring one, and then hold the line, even if it makes one or two conversations awkward.",
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
          text: "It helps a lot when the guest list, RSVPs and seating live together, a cancellation or a new dietary need only has to be written down once. (That's exactly why we built Weddly this way.)",
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
          text: "Egy jól átgondolt ültetés nemcsak szépen mutat, hanem mindenkinek könnyebbé teszi a napot, a vendégeknek, a felszolgálóknak és nektek is.",
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
        { type: "p", text: "Ezután jöhet a székek pontos kiosztása." },
        { type: "h2", text: "2. Vegyétek figyelembe a helyszín logikáját" },
        {
          type: "p",
          text: "Nem mindegy, hol van a tánctér, a kijárat, a mosdó, a büfé vagy a zenekar. Az idősebb vendégeknek kényelmesebb lehet egy nyugodtabb asztal. A baráti társaságoknak jobb lehet a tánctér közelében.",
        },
        {
          type: "p",
          text: "Egy jó ültetés nem csak embereket tesz egymás mellé, figyel arra is, ki hol érzi majd jól magát a teremben.",
        },
        { type: "h2", text: "3. Legyen nyomtatható verzió" },
        { type: "p", text: "Az ültetési rend nem ér véget a képernyőn. Szükség lehet:" },
        {
          type: "ul",
          items: [
            "nagy ültetési táblára a bejárathoz",
            "asztalszámokra",
            "ültetőkártyákra",
            "konyhai listára",
            "a helyszíni segítőknek szóló példányra",
          ],
        },
        {
          type: "p",
          text: "Ezért éri meg már a tervezésnél átgondolni, hogyan néznek majd ki kinyomtatva, kézbe véve.",
        },
        { type: "h2", text: "4. Készüljetek az utolsó pillanatban érkező változásokra" },
        {
          type: "p",
          text: "Szinte mindig lesz valaki, aki az utolsó héten mondja le, vagy akkor jelzi, hogy mégis jönne. Ha az ültetés kézzel rajzolt PDF-ekben él, minden változás fájdalmas.",
        },
        {
          type: "p",
          text: "Ezért érdemes olyan eszközt választani, ahol a vendégeket egyszerűen tudjátok mozgatni, és a végén A4-es, A6-os vagy A3-as méretben is nyomtatható lesz minden, amire szükségetek van.",
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
          text: "A well-thought-out seating plan isn't just pretty, it quietly makes the day easier for your guests, the people running the venue, and the two of you.",
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
        { type: "p", text: "Once those feel right, you can move on to who sits exactly where." },
        { type: "h2", text: "2. Respect the venue layout" },
        {
          type: "p",
          text: "Position matters: the dance floor, the bar, the entrance, the band. Older guests prefer quieter corners. Friend groups belong near the dance floor.",
        },
        {
          type: "p",
          text: "A good seating plan isn't only about who sits next to whom, it also thinks about where people will feel most at home in the room.",
        },
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
        {
          type: "p",
          text: "Which is why it's worth planning early for how it'll look once it's actually printed and pinned up.",
        },
        { type: "h2", text: "4. Plan for last-minute changes" },
        {
          type: "p",
          text: "Someone always cancels in the final week, or confirms after being unsure. If the chart only lives in a hand-drawn PDF, every change is painful.",
        },
        {
          type: "p",
          text: "That's exactly why we built Weddly's seating canvas the way we did, drag a guest, drop them somewhere new, and when you're ready it prints in A4, A6 or A3.",
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
        { type: "p", text: "Példa: „Részt tudsz venni az esküvőnkön?”" },
        {
          type: "ul",
          items: ["Igen, ott leszek.", "Sajnos nem tudok menni."],
        },
        { type: "h2", text: "2. Kísérő kérdése" },
        {
          type: "p",
          text: "Ha lehet kísérőt hozni, érdemes ezt rögtön tisztázni az űrlapon. Ha viszont nem mindenki kap plus one-t, a személyre szabott RSVP linkek elejét veszik a kínos félreértéseknek.",
        },
        { type: "p", text: "Példa: „Kísérővel érkezel?”" },
        { type: "h2", text: "3. Menü és ételérzékenység" },
        {
          type: "p",
          text: "A konyhának időben kell tudnia, mire számítson, úgyhogy érdemes előre megkérdezni az ételválasztást és a speciális igényeket is.",
        },
        { type: "p", text: "Példa: „Van ételérzékenységed vagy speciális étrended?”" },
        {
          type: "p",
          text: "Itt jó, ha van szabadon kitölthető mező is, mert nem minden igény fér bele az előre megadott válaszok közé.",
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
          text: "Ha az RSVP túl hosszú, a vendégek elhalasztják a kitöltését. A cél az, hogy egy perc alatt kitölthető legyen.",
        },
        {
          type: "p",
          text: "Ezért segít, ha minden vendég saját RSVP linket kap, és a válaszaik egyenesen oda kerülnek, ahol használjátok őket: a vendéglistába.",
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
          text: "If plus-ones are welcome, say so plainly on the form. If only some guests get one, per-guest links quietly avoid the awkward moment of someone bringing a friend you weren't expecting.",
        },
        { type: "p", text: 'Example: "Bringing a plus-one?"' },
        { type: "h2", text: "3. Meal and dietary needs" },
        {
          type: "p",
          text: "The kitchen needs to know early what to plan for, so ask about meal choice and any dietary needs in the same breath.",
        },
        { type: "p", text: 'Example: "Any dietary needs or restrictions?"' },
        { type: "p", text: "Leave a free-text field, not every need fits a preset option." },
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
          text: "Long RSVPs get put off. A good one should take under a minute, even on a phone at the bus stop.",
        },
        {
          type: "p",
          text: "In Weddly each guest gets their own RSVP link, and whatever they answer lands straight in your guest list, no copy-pasting from a shared form.",
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
      lead: "Lépésről lépésre, mit érdemes intézni egy évvel, fél évvel és egy hónappal az esküvő előtt.",
      seo_title: "Esküvőszervezési checklist 12 hónapra · Wēddly",
      seo_description:
        "Esküvőszervezési checklist 12 hónapra: lépésről lépésre, mit érdemes intézni egy évvel, fél évvel és egy hónappal az esküvő előtt.",
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
        {
          type: "p",
          text: "Itt már arról szól minden, hogy ami eddig terv volt, az most kapja meg a végleges formáját, válaszok jönnek vissza, a részletek a helyükre csúsznak.",
        },
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
          text: "Ha ekkor még minden külön táblázatban szétszórva van, nagyon könnyű kihagyni egy-egy részletet. Sokkal nyugodtabb, ha mindketten ugyanazt az egy listát nézitek.",
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
          text: "Ebben a hónapban már nem az új ötletek számítanak, hanem az, hogy mindenki ugyanazt tudja, a szüleitek, a tanúitok és a szolgáltatók is.",
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
          text: "Igen, a pihenés is teendő. Az esküvő nem egy lezáró feladat, hanem egy közös nap, amit meg kell élni.",
        },
        { type: "h2", text: "Rövid összefoglaló" },
        {
          type: "p",
          text: "Az esküvőszervezés akkor lesz kezelhető, ha nem akartok mindent egyszerre megoldani. Egy közös checklist, egy friss vendéglista, egy költségvetés, ami együtt mozog veletek, és egy hely, ahol mindketten ugyanazt látjátok. Ennyi elég.",
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
          text: "Ideális esetben 9-12 hónappal az esküvő előtt, de kisebb esküvőnél rövidebb idő is elég lehet.",
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
          text: "The good news: it doesn't have to be solved in one go. Take it in waves, and the whole thing gets a lot calmer.",
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
          text: "If everything still lives in scattered spreadsheets, it's easy to drop a detail. Much calmer if both of you are looking at the same list.",
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
          text: "Less about new ideas, more about everyone, you two, your parents, your vendors, actually knowing the same thing.",
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
          text: "Planning gets manageable the moment you stop trying to solve everything at once. A shared checklist, a guest list that stays current, a budget that moves with you, and one spot you both look at. That's enough.",
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
          text: "Az esküvői meghívó az első dolog, amivel a vendégek találkoznak. Megadja az esküvő alaphangulatát és stílusát, és tartalmazza a legfontosabb információkat. Ma már nem csak az a kérdés, milyen papírra készüljön, hanem az is, hogy kell-e egyáltalán papír.",
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
          text: "A digitális meghívó gyors, könnyen javítható, és a visszajelzést is ugyanott lehet kezelni. Ha változik az időpont, a helyszín vagy a menü, nem kell semmit újranyomtatni, egy kattintással elintézitek.",
        },
        { type: "p", text: "Előnyei:" },
        {
          type: "ul",
          items: [
            "gyorsan elküldhető",
            "mobilon könnyen megnyitható",
            "összeköthető RSVP-vel",
            "tartalma bármikor frissíthető",
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
          text: "A digitális meghívó legnagyobb előnye, hogy a visszajelzés ott van rögtön mellette. Nem kell külön üzeneteket olvasgatni, telefonálgatni, táblázatot frissíteni.",
        },
        {
          type: "p",
          text: "A vendég megnyitja a linket, válaszol pár kérdésre, ti pedig már látjátok is, ki jön és ki nem.",
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
          text: "Digital is fast, easy to fix, and the reply lands right next to it. If the date, venue or menu changes, nothing has to be reprinted, one edit and everyone sees the new version.",
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
          text: "Digital's real advantage: the reply sits right next to the invitation. No separate messages, no phone calls, no spreadsheet to keep alive.",
        },
        {
          type: "p",
          text: "The guest opens the link, answers a few questions, and you can already see who's coming and who isn't.",
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
  // ── 9. Esküvői hagyományok praktikusan ─────────────────────────────
  {
    slug: "eskuvoi-hagyomanyok-praktikusan",
    published_at: "2026-05-23",
    read_minutes: 7,
    category: { hu: "Hagyományok", en: "Traditions" },
    hu: {
      title: "Esküvői hagyományok érthetően: ki, mikor és hova húzza a gyűrűt?",
      lead: "Jegygyűrű, karikagyűrű, menyasszonytánc, dobócsokor: mit érdemes megtartani, mit lehet átalakítani, mit elhagyni.",
      seo_title: "Esküvői hagyományok praktikusan · Wēddly",
      seo_description:
        "Jegygyűrű, karikagyűrű, ki húzza fel először, menyasszonytánc, dobócsokor: gyakorlati végigvezetés a klasszikus esküvői hagyományokon.",
      body: [
        {
          type: "p",
          text: "Az esküvői hagyományok sokszor egyszerre szépek, meghatóak és kissé zavarba ejtőek. Ki húzza fel először a gyűrűt? Melyik kézen kell viselni a jegygyűrűt? Mi történik a karikagyűrűvel a szertartás alatt? És vajon kötelező minden régi szokást megtartani?",
        },
        {
          type: "p",
          text: "A jó hír, hogy az esküvői hagyományok ma már inkább lehetőségek, mint szigorú szabályok. A legtöbb klasszikus szokást nyugodtan a saját elképzelésetekhez igazíthatjátok.",
        },
        { type: "h2", text: "1. Jegygyűrű vagy karikagyűrű? Mi a különbség?" },
        {
          type: "p",
          text: "A jegygyűrű általában az eljegyzéskor kerül a menyasszony ujjára. Sok esetben ez egy köves gyűrű, például gyémánttal vagy más drágakővel.",
        },
        {
          type: "p",
          text: "A karikagyűrű az esküvői szertartás része. Ezt a pár tagjai a házasságkötéskor húzzák egymás ujjára, és ez jelképezi a házassági szövetséget.",
        },
        { type: "h3", text: "Pro tipp" },
        {
          type: "p",
          text: "Sokan az esküvő után együtt viselik a jegygyűrűt és a karikagyűrűt. Ilyenkor gyakori, hogy a karikagyűrű kerül közelebb a szívhez, vagyis először a karikagyűrűt húzzák fel az ujjra, majd mellé kerül a jegygyűrű.",
        },
        { type: "h2", text: "2. Melyik kézen viseljük a gyűrűket?" },
        {
          type: "p",
          text: "Magyarországon hagyományosan az eljegyzési gyűrűt a bal kéz gyűrűsujján viselik az esküvőig, az esküvői karikagyűrűt pedig a szertartás után általában a jobb kéz gyűrűsujján hordják.",
        },
        {
          type: "p",
          text: "Ez azonban nem kőbe vésett szabály. Vannak párok, akik kényelmi, családi vagy személyes okból máshogy viselik a gyűrűket.",
        },
        { type: "h3", text: "Pro tipp" },
        {
          type: "p",
          text: "Az esküvő előtt érdemes eldönteni, mit szeretne a menyasszony kezdeni az eljegyzési gyűrűvel a szertartás alatt. Három gyakori megoldás van: a jegygyűrű a bal kézen marad és a karikagyűrű a jobb kézre kerül; a jegygyűrűt a szertartás előtt átveszi a menyasszony a másik kezére; vagy a szertartás idejére leveszi, és utána visszateszi a karikagyűrű mellé.",
        },
        { type: "h2", text: "3. Ki húzza fel először a gyűrűt?" },
        {
          type: "p",
          text: "A polgári és egyházi szertartásokon is gyakori, hogy először a vőlegény húzza fel a gyűrűt a menyasszony ujjára, majd a menyasszony a vőlegényére. Ez nem mindenhol kötelező sorrend, de a legtöbb ceremónián így szokott történni.",
        },
        { type: "p", text: "A gyűrűhúzás előtt érdemes ellenőrizni:" },
        {
          type: "ul",
          items: [
            "jó méretűek-e a gyűrűk,",
            "ki adja oda őket a szertartásvezetőnek,",
            "lesz-e gyűrűpárna, doboz vagy kis tálka,",
            "a tanúk vagy a gyűrűvivő gyermek hozzák-e be őket.",
          ],
        },
        { type: "h3", text: "Pro tipp" },
        {
          type: "p",
          text: "A nagy napon a stressz, a meleg vagy az izgalom miatt az ujjak picit bedagadhatnak. Nem baj, ha a gyűrű nem csúszik fel tökéletesen egy mozdulattal. A lényeg a pillanat, nem a hibátlan koreográfia.",
        },
        { type: "h2", text: "4. Mi legyen a gyűrűkkel a szertartás előtt?" },
        {
          type: "p",
          text: "A gyűrűket általában a vőlegény, a tanú, a ceremóniamester vagy a szertartásvezető őrzi a gyűrűhúzásig.",
        },
        {
          type: "p",
          text: "Ne az utolsó pillanatban dőljön el, kinél vannak. Legyen kijelölve egy felelős személy, aki tudja, hol vannak, időben átadja őket, és ellenőrzi, hogy mindkét gyűrű megvan-e. Apróságnak tűnik, de az esküvő napján rengeteg ilyen kis részlet fut egyszerre.",
        },
        { type: "h2", text: "5. Valami régi, valami új, valami kölcsön és valami kék" },
        {
          type: "p",
          text: "A „valami régi, valami új, valami kölcsön és valami kék” hagyománya sok esküvőn megjelenik. Nem kötelező, de kedves szimbolikus elem lehet.",
        },
        {
          type: "ul",
          items: [
            "régi: családi ékszer, nagymama zsebkendője,",
            "új: menyasszonyi ruha, cipő vagy ékszer,",
            "kölcsön: barátnőtől kapott hajdísz,",
            "kék: harisnyakötő, hímzés, szalag vagy apró kiegészítő.",
          ],
        },
        {
          type: "p",
          text: "Nem kell látványosnak lennie. Egy apró kék varrás a ruhában vagy egy családi medál is tökéletesen működik.",
        },
        { type: "h2", text: "6. Menyasszonytánc és menyecsketánc" },
        {
          type: "p",
          text: "A menyasszonytánc általában éjfél előtt történik, amikor a vendégek pénzért táncolhatnak a menyasszonnyal. A menyecsketánc sokszor éjfél után következik, amikor a menyasszony már átöltözött menyecskeruhába.",
        },
        {
          type: "p",
          text: "Ma már sok pár alakítja a saját ízlésére ezt a hagyományt. Van, aki megtartja, van, aki rövidíti, van, aki teljesen elhagyja.",
        },
        {
          type: "p",
          text: "Ha lesz menyasszonytánc, előre gondoljátok át, ki konferálja fel, hova kerül a pénzgyűjtő tál vagy kosár, mennyi ideig tartson, milyen zenére, és hogy komfortos-e a menyasszonynak.",
        },
        { type: "h2", text: "7. Dobócsokor és csokordobás" },
        {
          type: "p",
          text: "A csokordobás klasszikus esküvői program, de nem mindenki szereti. Ha a menyasszony nem szeretné eldobni a saját csokrát, készülhet külön dobócsokor.",
        },
        { type: "p", text: "A klasszikus dobás helyett több alternatíva is működik:" },
        {
          type: "ul",
          items: [
            "szalagkihúzós csokorjáték,",
            "közös fotó a hajadon vendégekkel,",
            "a csokor átadása egy fontos személynek,",
            "a hagyomány teljes elhagyása, ha nem illik a pár stílusához.",
          ],
        },
        {
          type: "cta",
          lead: "Az esküvői hagyományok akkor működnek igazán jól, ha a pár saját történetéhez és személyiségéhez illenek. Válasszátok ki azokat az elemeket, amelyek számotokra jelentéssel bírnak, és alakítsátok őket úgy, ahogy nektek természetes.",
          href: "/signup",
          label: "Tervezzetek átláthatóan a Wēddly-vel",
        },
        { type: "h2", text: "Gyakori kérdések" },
        { type: "h3", text: "Melyik kézen viseljük a karikagyűrűt Magyarországon?" },
        {
          type: "p",
          text: "Hagyományosan a jobb kéz gyűrűsujján. A jegygyűrűt sok pár közvetlenül mellé teszi, vagy a bal kézen hagyja.",
        },
        { type: "h3", text: "Kötelező-e menyasszonytáncot tartani?" },
        {
          type: "p",
          text: "Nem. Egyre több pár hagyja el, rövidíti vagy alakítja át, ha nem illik a stílusukhoz.",
        },
        { type: "h3", text: "Mit jelent a „valami kölcsön”?" },
        {
          type: "p",
          text: "Egy szerencsehozó tárgy egy szeretett személytől, amit a nap után visszaadtok. Bármi lehet: hajdísz, fátyol, kis ékszer.",
        },
        { type: "h3", text: "Hányszor lehet átöltözni az esküvőn?" },
        {
          type: "p",
          text: "Annyiszor, ahányszor szeretnétek. A klasszikus a menyecskeruhába való átöltözés, de sok pár megelégszik egyetlen menyasszonyi ruhával is.",
        },
      ],
    },
    en: {
      title: "Wedding traditions, practically: who puts the ring on, and where?",
      lead: "Engagement ring, wedding band, bride's dance, bouquet toss: what to keep, what to reshape, what to skip.",
      seo_title: "Wedding traditions, practically · Weddly",
      seo_description:
        "Engagement ring, wedding band, bride's dance, bouquet toss: a practical walkthrough of the classic Hungarian wedding customs.",
      body: [
        {
          type: "p",
          text: "Wedding traditions are sometimes lovely, sometimes confusing. Who puts the ring on first? Which hand carries the wedding band? What happens to the engagement ring during the ceremony? And is every old custom actually required?",
        },
        {
          type: "p",
          text: "The good news: today's wedding traditions are mostly options, not rules. A practical pass through the most common ones.",
        },
        { type: "h2", text: "1. Engagement ring vs. wedding band" },
        {
          type: "p",
          text: "The engagement ring is usually given at the proposal, often with a centre stone such as a diamond. The wedding band goes on during the ceremony and represents the marriage covenant.",
        },
        { type: "h3", text: "Pro tip" },
        {
          type: "p",
          text: "Many couples wear both after the wedding. A common pattern is to slip the wedding band on first (closer to the heart), then the engagement ring on top.",
        },
        { type: "h2", text: "2. Which hand?" },
        {
          type: "p",
          text: "In Hungary the engagement ring traditionally sits on the left ring finger until the wedding, then the band takes the right ring finger. This isn't a hard rule though; family, comfort or personal preference often dictate.",
        },
        { type: "h3", text: "Pro tip" },
        {
          type: "p",
          text: "Decide before the day what the bride wants to do with the engagement ring during the ceremony. Three common options: leave it on the left hand and add the band to the right; move it to the other hand just before the ceremony; or remove it for the ceremony and put it back on next to the band afterwards.",
        },
        { type: "h2", text: "3. Who puts the ring on first?" },
        {
          type: "p",
          text: "On most civil and church ceremonies, the groom places the ring on the bride first, then the bride does the same. Not universal, but the most common order.",
        },
        { type: "p", text: "Before the ceremony, check that:" },
        {
          type: "ul",
          items: [
            "the rings fit,",
            "someone knows who hands them to the officiant,",
            "a ring cushion, box or small dish is ready,",
            "the witnesses or ring bearer know their cue.",
          ],
        },
        { type: "h3", text: "Pro tip" },
        {
          type: "p",
          text: "Stress, heat or excitement can swell fingers slightly. It's fine if the ring doesn't slide on perfectly the first time. The moment is what counts, not the choreography.",
        },
        { type: "h2", text: "4. Who holds the rings before the ceremony?" },
        {
          type: "p",
          text: "Usually the groom, a witness, the wedding planner or the officiant. Decide early, and have one designated person who knows where the rings are, hands them over on time, and double-checks both are present.",
        },
        { type: "h2", text: "5. Something old, new, borrowed, blue" },
        {
          type: "p",
          text: 'The "something old, something new, something borrowed, something blue" tradition turns up at many weddings. Not required, but a nice symbolic touch.',
        },
        {
          type: "ul",
          items: [
            "old: family jewellery, grandmother's handkerchief,",
            "new: dress, shoes or jewellery,",
            "borrowed: a hair piece from a close friend,",
            "blue: a garter, embroidery, ribbon or a small accent.",
          ],
        },
        {
          type: "p",
          text: "It doesn't have to be flashy. A small blue stitch or a family pendant works perfectly.",
        },
        { type: "h2", text: "6. Bride's dance" },
        {
          type: "p",
          text: "In Hungary the bride's dance (menyasszonytánc) traditionally happens before midnight: guests pay for a dance with the bride. After midnight comes the menyecsketánc, when the bride has changed into a second outfit.",
        },
        {
          type: "p",
          text: "Couples increasingly modify the custom: keep it, shorten it, or skip it entirely.",
        },
        {
          type: "p",
          text: "If you keep it, agree in advance who announces it, where the basket goes, how long it lasts, what music, and whether the bride is comfortable with the tradition at all.",
        },
        { type: "h2", text: "7. Bouquet toss" },
        {
          type: "p",
          text: "A classic, but not for everyone. If the bride doesn't want to throw her actual bouquet, a separate toss bouquet can be prepared.",
        },
        { type: "p", text: "Alternatives:" },
        {
          type: "ul",
          items: [
            "ribbon-pull bouquet game,",
            "a group photo with the single guests,",
            "presenting the bouquet to a meaningful person,",
            "skipping the toss entirely.",
          ],
        },
        {
          type: "cta",
          lead: "Wedding traditions work best when they fit the couple's story. Keep what means something to you, and shape the rest so it feels natural.",
          href: "/signup",
          label: "Plan it clearly with Weddly",
        },
        { type: "h2", text: "FAQ" },
        { type: "h3", text: "Which hand for the wedding band in Hungary?" },
        {
          type: "p",
          text: "Traditionally the right ring finger. The engagement ring often sits next to it, or stays on the left hand.",
        },
        { type: "h3", text: "Is the bride's dance required?" },
        {
          type: "p",
          text: "No. More and more couples drop, shorten, or restyle it if it doesn't suit them.",
        },
        { type: "h3", text: 'What does "something borrowed" mean?' },
        {
          type: "p",
          text: "A lucky item from someone you love, returned after the day. It can be a hair piece, a veil, a piece of jewellery, anything small.",
        },
        { type: "h3", text: "How many outfit changes during the wedding?" },
        {
          type: "p",
          text: "As many as you want. The classic is a single change into the menyecske dress, but plenty of couples wear one outfit the whole evening.",
        },
      ],
    },
  },
  // ── 10. Esküvői szertartás menete ──────────────────────────────────
  {
    slug: "eskuvoi-szertartas-menete",
    published_at: "2026-05-21",
    read_minutes: 8,
    category: { hu: "Szertartás", en: "Ceremony" },
    hu: {
      title: "Az esküvői szertartás menete lépésről lépésre",
      lead: "Polgári, egyházi és szertartásvezetős esküvő: mire számítsatok, mit egyeztessetek előre, milyen sorrendben történik minden.",
      seo_title: "Esküvői szertartás menete lépésről lépésre · Wēddly",
      seo_description:
        "Polgári, egyházi és szertartásvezetős esküvő menete lépésről lépésre: bevonulás, fogadalom, gyűrűhúzás, aláírás, szimbolikus elemek és esőterv.",
      body: [
        {
          type: "p",
          text: "Az esküvő egyik legfontosabb része maga a szertartás. Itt hangzik el az igen, itt történik a gyűrűhúzás, és sok pár számára ez az a pillanat, amikor igazán megérkezik az érzés: mostantól házastársak vagyunk.",
        },
        {
          type: "p",
          text: "Mégis sok jegyespár csak nagyjából tudja, mire számítson. Mikor vonul be a menyasszony? Mikor jön a gyűrűhúzás? Mikor kell aláírni? És mi történik egy szertartásvezetős esküvőn? Érdemes előre tisztázni a sorrendet, hogy a nap ne legyen meglepetés.",
        },
        { type: "h2", text: "A polgári szertartás menete" },
        {
          type: "p",
          text: "A polgári szertartás a hivatalos házasságkötés. Ezt anyakönyvvezető tartja, és jogilag ez teszi érvényessé a házasságot.",
        },
        {
          type: "ul",
          items: [
            "1. Vendégek érkezése: az első sorokba általában a szülők, nagyszülők és közeli családtagok ülnek.",
            "2. A pár bevonulása: lehet együtt, külön, szülőkkel vagy tanúkkal. A menyasszonyt gyakran az édesapja vagy egy fontos családtag kíséri.",
            "3. Köszöntő: az anyakönyvvezető üdvözli a párt és a vendégeket.",
            "4. Hivatalos kérdések: elhangzanak a házasságkötéshez szükséges kérdések, amelyekre a pár igennel válaszol.",
            "5. Fogadalom vagy személyes szöveg: lehetőség saját fogadalomra, idézetre vagy rövid beszédre.",
            "6. Gyűrűhúzás: a pár egymás ujjára húzza a karikagyűrűt.",
            "7. Aláírás: a házassági anyakönyvet a pár és a tanúk írják alá.",
            "8. Gratuláció és kivonulás: a pár házastársakként vonul ki, jöhet a gratuláció, pezsgőzés vagy csoportfotó.",
          ],
        },
        { type: "h3", text: "Pro tipp" },
        {
          type: "p",
          text: "A polgári szertartás általában rövidebb, mint sokan gondolják. Ha szeretnétek személyesebbé tenni, kérjetek be egyedi zenéket, idézetet, személyes történetet vagy saját fogadalmat.",
        },
        { type: "h2", text: "Az egyházi szertartás menete" },
        {
          type: "p",
          text: "Az egyházi szertartás hiten alapuló meggyőződés keretein belül történik, templomban vagy más megszentelt helyszínen. A pontos menet felekezetenként eltérő, de vannak közös elemek.",
        },
        {
          type: "ul",
          items: [
            "bevonulás,",
            "köszöntés,",
            "imádság vagy áldás,",
            "szentírási részlet vagy tanítás,",
            "házassági ígéret,",
            "gyűrűmegáldás,",
            "gyűrűhúzás,",
            "közös ima,",
            "áldás,",
            "kivonulás.",
          ],
        },
        { type: "p", text: "Az egyházi szertartás előtt mindenképpen egyeztessetek:" },
        {
          type: "ul",
          items: [
            "milyen dokumentumokra van szükség,",
            "kell-e jegyesoktatás,",
            "lehet-e saját zenét választani,",
            "ki díszítheti a templomot,",
            "lehet-e fotózni vagy videózni,",
            "mikor kell érkezni a párnak és a tanúknak.",
          ],
        },
        { type: "h3", text: "Pro tipp" },
        {
          type: "p",
          text: "A templomi szertartásnál különösen fontos a fotóssal és videóssal való előzetes egyeztetés. Vannak helyek, ahol csak bizonyos pontokról lehet felvételt készíteni.",
        },
        { type: "h2", text: "Szertartásvezetős vagy szimbolikus ceremónia" },
        {
          type: "p",
          text: "A szertartásvezetős esküvő nem helyettesíti a hivatalos polgári házasságkötést, de nagyon személyes és rugalmas forma lehet. Sok pár előbb hivatalosan összeházasodik az anyakönyvvezető előtt, majd az esküvő napján tart egy szimbolikus, megható ceremóniát.",
        },
        { type: "p", text: "Miért szeretik sokan?" },
        {
          type: "ul",
          items: [
            "lehet kültéren,",
            "lehet naplementében,",
            "lehet személyes történetekkel, humorral vagy meghatottsággal,",
            "nincs annyi hivatalos kötöttség,",
            "a pár stílusára szabható.",
          ],
        },
        { type: "p", text: "Egy tipikus menete:" },
        {
          type: "ul",
          items: [
            "1. Vendégek érkezése",
            "2. Bevonulás",
            "3. Szertartásvezető köszöntője",
            "4. A pár történetének elmesélése",
            "5. Fogadalmak",
            "6. Gyűrűhúzás",
            "7. Szimbolikus elem",
            "8. Csók",
            "9. Kivonulás",
          ],
        },
        { type: "h2", text: "Szimbolikus elemek a szertartásban" },
        { type: "h3", text: "Homoköntés" },
        {
          type: "p",
          text: "A pár két különböző színű homokot önt egy közös üvegbe, ami az összetartozást jelképezi.",
        },
        { type: "h3", text: "Gyertyagyújtás" },
        {
          type: "p",
          text: "Két külön gyertyáról meggyújtanak egy közöset. Elegáns, klasszikus választás, főleg beltéri szertartáshoz.",
        },
        { type: "h3", text: "Borceremónia" },
        {
          type: "p",
          text: "A pár közösen tölt vagy iszik bort, ami az élet örömeit és a közös pillanatokat szimbolizálja.",
        },
        { type: "h3", text: "Időkapszula" },
        {
          type: "p",
          text: "A pár levelet ír egymásnak, amit egy dobozba zárnak, és például az első, ötödik vagy tizedik házassági évfordulón nyitnak ki.",
        },
        { type: "h3", text: "Pro tipp" },
        {
          type: "p",
          text: "Kültéri esküvőn a gyertyagyújtás szél miatt kockázatos lehet. Ilyenkor jobb választás a homoköntés, az időkapszula vagy a borceremónia.",
        },
        { type: "h2", text: "Bevonulási sorrend" },
        {
          type: "p",
          text: "Nincs egyetlen kötelező sorrend, de a klasszikus verzió így néz ki:",
        },
        {
          type: "ul",
          items: [
            "1. a vendégek elfoglalják a helyüket,",
            "2. a vőlegény érkezik a tanúval vagy szülővel,",
            "3. koszorúslányok, gyerekek bevonulnak,",
            "4. a menyasszony bevonul kísérővel,",
            "5. szertartás kezdete.",
          ],
        },
        {
          type: "p",
          text: "A pár bevonulhat együtt is. Ez modern, bensőséges és nagyon szép megoldás lehet, különösen akkor, ha nem szeretnétek a klasszikus „átadás” jellegű bevonulást.",
        },
        { type: "h2", text: "Milyen zenék kellenek a szertartáshoz?" },
        { type: "p", text: "Általában ezekhez a pillanatokhoz érdemes zenét választani:" },
        {
          type: "ul",
          items: [
            "vendégvárás,",
            "bevonulás,",
            "aláírás vagy szimbolikus elem,",
            "kivonulás,",
            "gratuláció alatti háttérzene.",
          ],
        },
        { type: "h3", text: "Pro tipp" },
        {
          type: "p",
          text: "A bevonulási zene legyen elég hosszú. Inkább legyen belőle több, mint hogy a legfontosabb pillanat közben hirtelen véget érjen.",
        },
        { type: "h2", text: "Mikor legyen a szertartás?" },
        {
          type: "p",
          text: "Kültéri esküvőnél különösen fontos az időzítés. Nyári esküvőn a délután 2-3 óra gyakran túl meleg lehet, főleg árnyék nélküli helyszínen.",
        },
        {
          type: "p",
          text: "Nyáron a késő délutáni, kora esti szertartás sokkal kényelmesebb: szebb fények a fotókhoz, kellemesebb hőmérséklet, romantikusabb hangulat, kevesebb hunyorgás a képeken.",
        },
        { type: "h2", text: "Esőterv: nem csak kültéri esküvőknél fontos" },
        {
          type: "p",
          text: "Ha kültéri szertartást terveztek, mindig legyen B terv. Ez lehet fedett terasz, sátor, beltéri terem vagy gyorsan átrendezhető vacsorahelyszín.",
        },
        { type: "h3", text: "Pro tipp" },
        {
          type: "p",
          text: "Az esőtervet ne csak fejben tartsátok. Legyen előre megbeszélve, ki dönt az áthelyezésről, mikor születik meg a döntés, ki pakolja át a dekorációt, hova kerülnek a vendégek és hol lesz a hangosítás.",
        },
        { type: "h2", text: "Szertartás előtti ellenőrzőlista" },
        { type: "p", text: "Mielőtt elkezdődne, érdemes tisztázni:" },
        {
          type: "ul",
          items: [
            "kinél vannak a gyűrűk,",
            "kik a tanúk,",
            "hol ülnek a szülők,",
            "milyen sorrendben vonultok be,",
            "milyen zenék szólnak,",
            "van-e mikrofon,",
            "lesz-e asztal az aláíráshoz,",
            "ki hozza a szimbolikus kellékeket,",
            "fotós-videós tudja-e a menetrendet,",
            "van-e víz a párnak a közelben.",
          ],
        },
        {
          type: "cta",
          lead: "A szertartás akkor lesz igazán szép, ha nem csak formailag működik, hanem rólatok szól. A hagyományos elemek, a hivatalos részek és a személyes pillanatok jól megférnek egymás mellett.",
          href: "/signup",
          label: "Tervezzétek meg pontosan a Wēddly-vel",
        },
        { type: "h2", text: "Gyakori kérdések" },
        { type: "h3", text: "Mennyi ideig tart egy polgári szertartás?" },
        {
          type: "p",
          text: "Általában 15 és 30 perc között. Az ünnepélyes, személyre szabott változat hosszabb lehet, ha sok zenét vagy idézetet kértek.",
        },
        { type: "h3", text: "Lehet-e szabadtéri polgári szertartást tartani?" },
        {
          type: "p",
          text: "Igen, ha az illetékes anyakönyvvezető vállal külső helyszínt. Ezt mindenképpen előre egyeztetni kell, mert nem mindenhol lehetséges.",
        },
        { type: "h3", text: "Kötelező-e a tanúknak rokonnak lenniük?" },
        {
          type: "p",
          text: "Nem. A tanú lehet bárki, aki betöltötte a 18. életévét és cselekvőképes. Sok pár közeli barátot vagy testvért választ.",
        },
        { type: "h3", text: "Mi történik, ha esik az eső a kültéri szertartás napján?" },
        {
          type: "p",
          text: "Akkor lép életbe az esőterv. Ezért is fontos, hogy előre megbeszéljétek a helyszínnel, kinek a feladata a döntés és az átrendezés.",
        },
      ],
    },
    en: {
      title: "The wedding ceremony, step by step",
      lead: "Civil, church and celebrant-led ceremonies: what to expect, what to settle in advance, what order things happen in.",
      seo_title: "The wedding ceremony, step by step · Weddly",
      seo_description:
        "Civil, church and celebrant-led wedding ceremonies step by step: processional, vows, ring exchange, signing, symbolic elements, weather plan.",
      body: [
        {
          type: "p",
          text: "The ceremony is one of the most important parts of the wedding. The vow happens here, the ring exchange happens here, and for many couples this is the moment when it finally lands: we are married.",
        },
        {
          type: "p",
          text: "Yet most couples only have a rough sense of what to expect. When does the bride walk in? When does the ring exchange happen? When is the signing? And what changes if you use a celebrant?",
        },
        { type: "h2", text: "Civil ceremony" },
        {
          type: "p",
          text: "The civil ceremony is the legally binding part. It's led by a registrar.",
        },
        {
          type: "ul",
          items: [
            "1. Guests arrive and take their seats. Family in the front rows.",
            "2. The couple enters, together, separately, or with parents or witnesses.",
            "3. The registrar greets the couple and the guests.",
            "4. The required legal questions are asked, the couple answers yes.",
            "5. Optional personal vows, readings or short speeches.",
            "6. The couple exchanges rings.",
            "7. The marriage register is signed by the couple and the witnesses.",
            "8. The couple exits as a married pair; congratulations, champagne, group photos.",
          ],
        },
        { type: "h3", text: "Pro tip" },
        {
          type: "p",
          text: "Civil ceremonies are usually shorter than couples expect. If you want it to feel personal, request custom music, a reading, a personal story or your own vows.",
        },
        { type: "h2", text: "Church ceremony" },
        {
          type: "p",
          text: "A church ceremony happens within a faith-based framework, in a church or another consecrated space. The exact flow depends on the denomination, but common elements include:",
        },
        {
          type: "ul",
          items: [
            "processional,",
            "greeting,",
            "prayer or blessing,",
            "scripture reading or homily,",
            "marriage vows,",
            "blessing of the rings,",
            "ring exchange,",
            "shared prayer,",
            "final blessing,",
            "recessional.",
          ],
        },
        { type: "p", text: "Settle in advance with the parish:" },
        {
          type: "ul",
          items: [
            "what documents are required,",
            "whether pre-marriage classes are needed,",
            "whether you can choose your own music,",
            "who can decorate the church,",
            "whether photo and video are allowed,",
            "when the couple and witnesses should arrive.",
          ],
        },
        { type: "h3", text: "Pro tip" },
        {
          type: "p",
          text: "For church ceremonies, brief the photographer and videographer in advance. Some venues only allow filming from specific positions.",
        },
        { type: "h2", text: "Celebrant-led or symbolic ceremony" },
        {
          type: "p",
          text: "A celebrant-led ceremony doesn't replace the legal civil registration, but it can be a deeply personal, flexible form. Many couples sign the legal paperwork separately and then hold a symbolic ceremony on the wedding day.",
        },
        { type: "p", text: "Why couples choose it:" },
        {
          type: "ul",
          items: [
            "can be outdoors,",
            "can be at sunset,",
            "can include personal stories, humour or emotion,",
            "fewer formal constraints,",
            "shaped to the couple's style.",
          ],
        },
        { type: "p", text: "A typical flow:" },
        {
          type: "ul",
          items: [
            "1. Guests arrive",
            "2. Processional",
            "3. Celebrant's welcome",
            "4. The couple's story",
            "5. Vows",
            "6. Ring exchange",
            "7. Symbolic element",
            "8. Kiss",
            "9. Recessional",
          ],
        },
        { type: "h2", text: "Symbolic elements" },
        { type: "h3", text: "Sand pouring" },
        {
          type: "p",
          text: "Two different-coloured sands are poured into one shared vessel, symbolising the joining of two lives.",
        },
        { type: "h3", text: "Unity candle" },
        {
          type: "p",
          text: "Two separate candles are used to light one shared flame. Elegant, classic, best for indoor settings.",
        },
        { type: "h3", text: "Wine ceremony" },
        {
          type: "p",
          text: "The couple shares a pour of wine, symbolising the joys and shared moments of the life ahead.",
        },
        { type: "h3", text: "Time capsule" },
        {
          type: "p",
          text: "The couple writes letters to each other, seals them in a box and opens it on a future anniversary, like the first, fifth or tenth.",
        },
        { type: "h3", text: "Pro tip" },
        {
          type: "p",
          text: "Outdoor unity candles are risky in any breeze. Sand pouring, time capsule or wine ceremony are safer outdoor choices.",
        },
        { type: "h2", text: "Processional order" },
        {
          type: "p",
          text: "There's no single required order, but the classic version goes like this:",
        },
        {
          type: "ul",
          items: [
            "1. guests take their seats,",
            "2. the groom arrives with witness or parent,",
            "3. bridesmaids and children walk in,",
            "4. the bride enters with her companion,",
            "5. the ceremony begins.",
          ],
        },
        {
          type: "p",
          text: 'Walking in together is also lovely: modern, intimate, and well suited to couples who don\'t want the classic "giving away" framing.',
        },
        { type: "h2", text: "Music for the ceremony" },
        { type: "p", text: "Plan music for these moments:" },
        {
          type: "ul",
          items: [
            "guest arrival,",
            "processional,",
            "signing or symbolic element,",
            "recessional,",
            "background music during congratulations.",
          ],
        },
        { type: "h3", text: "Pro tip" },
        {
          type: "p",
          text: "Pick a long enough processional track. Better to have more than to have the most important moment cut off mid-bar.",
        },
        { type: "h2", text: "When should the ceremony start?" },
        {
          type: "p",
          text: "Timing matters most outdoors. A summer ceremony at 2-3 p.m. can be punishingly hot, especially without shade.",
        },
        {
          type: "p",
          text: "Late afternoon or early evening is much kinder in summer: softer light for the photos, more comfortable temperature, more romantic atmosphere, less squinting in the pictures.",
        },
        { type: "h2", text: "Weather plan" },
        {
          type: "p",
          text: "For any outdoor ceremony, always have a plan B: covered terrace, tent, indoor room, or a quickly rearranged dinner space.",
        },
        { type: "h3", text: "Pro tip" },
        {
          type: "p",
          text: "Don't keep the rain plan only in your heads. Agree in advance who calls the move, when, who repositions the décor, where the guests go, where the sound system ends up.",
        },
        { type: "h2", text: "Pre-ceremony checklist" },
        { type: "p", text: "Before the doors open, settle:" },
        {
          type: "ul",
          items: [
            "who has the rings,",
            "who the witnesses are,",
            "where the parents sit,",
            "the processional order,",
            "the music cues,",
            "the microphone setup,",
            "the signing table,",
            "who brings the symbolic-element props,",
            "the photographer and videographer's run-of-show,",
            "a glass of water for the couple within reach.",
          ],
        },
        {
          type: "cta",
          lead: "The ceremony is at its best when it doesn't just work in form, but feels like you. Traditional elements, legal steps and personal moments all fit together.",
          href: "/signup",
          label: "Plan it precisely with Weddly",
        },
        { type: "h2", text: "FAQ" },
        { type: "h3", text: "How long does a civil ceremony take?" },
        {
          type: "p",
          text: "Typically 15-30 minutes. The longer, more personalised version can run longer if you've chosen plenty of music or readings.",
        },
        { type: "h3", text: "Can the civil ceremony be outdoors?" },
        {
          type: "p",
          text: "Yes, if the registrar agrees to officiate outdoors. Confirm this early; not every authority offers it.",
        },
        { type: "h3", text: "Do witnesses have to be family?" },
        {
          type: "p",
          text: "No. A witness can be anyone over 18 with legal capacity. Most couples pick close friends or siblings.",
        },
        { type: "h3", text: "What happens if it rains on an outdoor wedding day?" },
        {
          type: "p",
          text: "The rain plan kicks in. Decide in advance with the venue who makes the call and who handles the rearrangement.",
        },
      ],
    },
  },
  // ── 10b. Esküvőszervezési checklist 6 hónapra ──────────────────────
  {
    slug: "eskuvoszervezesi-checklist-6-honapra",
    published_at: "2026-04-30",
    read_minutes: 6,
    category: { hu: "Tervezés", en: "Planning" },
    hu: {
      title: "Esküvőszervezési checklist 6 hónapra: mit mikor intézzetek?",
      lead: "Ha fél évetek van az esküvőig: tömör menetrend a nagy döntésektől a finomhangolásig, hogy ne torlódjon össze minden az utolsó hetekre.",
      seo_title: "Esküvőszervezési checklist 6 hónapra · Wēddly",
      seo_description:
        "Esküvőszervezési checklist 6 hónapra: lépésről lépésre, mit érdemes intézni hat, négy, kettő és egy hónappal az esküvő előtt.",
      body: [
        {
          type: "p",
          text: "Ha hat hónap van az esküvőig, az még bőven kezelhető. Több párnak ennyi ideje van, és gyakran ettől még fókuszáltabb, kevésbé szétfutó lesz a szervezés. A trükk: ami egy 12 hónapos checklist elején még ráérős döntés, az itt már sürgős. Ha az első néhány hét rendben telik, a többi rész megnyugszik magától.",
        },
        {
          type: "p",
          text: "A hat hónap minden szakaszában más-más teendők kerülnek előtérbe, így nem torlódik össze minden az utolsó hetekre.",
        },
        { type: "h2", text: "6 hónappal az esküvő előtt" },
        {
          type: "p",
          text: "Ezek azok a döntések, amelyek nélkül a többi nem indulhat. Több időnél ezeket akár három hónapra is el lehet osztani, hat hónapos időkereten belül viszont egy-két hét alatt érdemes túl lenni rajtuk.",
        },
        {
          type: "ul",
          items: [
            "dátum kiválasztása,",
            "esküvői stílus meghatározása,",
            "költségvetési keret,",
            "vendégszám-becslés,",
            "helyszín leszerződése,",
            "fő szolgáltatók (fotós, zene) lefoglalása,",
            "házasságkötési szándék bejelentése az anyakönyvvezetőnél.",
          ],
        },
        { type: "h3", text: "Pro tipp" },
        {
          type: "p",
          text: "Az első hét csak a helyszínről és a dátumról szóljon. Ne keverjétek össze a dekoros, ruhás, ültetéses gondolatokkal, amíg ez a kettő nincs lefoglalva. A többi minden ehhez igazodik.",
        },
        { type: "h2", text: "4 hónappal az esküvő előtt" },
        {
          type: "p",
          text: "A nagy döntések után jönnek azok a részletek, amelyek időt és próbát igényelnek.",
        },
        {
          type: "ul",
          items: [
            "vendéglista első verziója,",
            "meghívók megtervezése,",
            "RSVP folyamat előkészítése,",
            "ruha és öltöny próba megkezdése,",
            "dekorációs irány véglegesítése,",
            "ceremóniamester vagy szertartásvezető lefoglalása,",
            "menü- és italajánlatok bekérése.",
          ],
        },
        {
          type: "p",
          text: "A költségvetést ekkor már nem becslésekkel, hanem valós ajánlatokkal érdemes frissíteni. Sok pár itt veszi észre először, hogy egy-két tételen szorítani kell.",
        },
        { type: "h2", text: "2-3 hónappal az esküvő előtt" },
        {
          type: "p",
          text: "Itt indul a válaszok és pontosítások időszaka. Ami eddig terv volt, az most kapja meg a végleges formáját.",
        },
        {
          type: "ul",
          items: [
            "meghívók kiküldése,",
            "RSVP határidő meghatározása (a hat hónapos időkereten belül érdemes 4-5 héttel az esküvő elé tenni),",
            "menüválasztások gyűjtése,",
            "szállás és transzfer egyeztetése,",
            "első ültetési verzió elkészítése,",
            "nyomtatványok (asztalszámok, ültetőkártyák) megtervezése,",
            "tanúk értesítése a hivatalos teendőkről.",
          ],
        },
        { type: "h3", text: "Pro tipp" },
        {
          type: "p",
          text: "A meghívót ne hagyjátok az utolsó pillanatra. Egy hat hónapos időkereten belül a kiküldés legkésőbb a harmadik hónap végén legyen, mert a vendégek többségének kell pár hét a válaszadáshoz.",
        },
        { type: "h2", text: "1 hónappal az esküvő előtt" },
        {
          type: "p",
          text: "Ez már a véglegesítés időszaka. Új ötletek helyett az számít, hogy mindenki ugyanazt az aktuális információt lássa.",
        },
        {
          type: "ul",
          items: [
            "végleges vendégszám leadása,",
            "ültetési rend véglegesítése,",
            "asztalszámok és ültetőkártyák nyomtatása,",
            "szolgáltatói napi forgatókönyv egyeztetése,",
            "fizetési határidők ellenőrzése,",
            "családi és tanúi tájékoztatás (érkezés, szerep, időzítés).",
          ],
        },
        { type: "h2", text: "1 héttel az esküvő előtt" },
        {
          type: "p",
          text: "Itt már csak a finomhangolás maradjon.",
        },
        {
          type: "ul",
          items: [
            "utolsó vendégváltozások kezelése,",
            "nyomtatott anyagok ellenőrzése,",
            "szolgáltatók visszaigazolása,",
            "vészcsomag összeállítása,",
            "pihenés.",
          ],
        },
        {
          type: "p",
          text: "Igen, a pihenés is teendő. Hat hónap kondenzált szervezés után az utolsó hét legyen lassabb, mint az előzőek.",
        },
        { type: "h2", text: "Rövid összefoglaló" },
        {
          type: "p",
          text: "Hat hónap elég. A trükk, hogy az első két-három hét fókuszált legyen: helyszín, dátum, fő szolgáltatók. Ha ez megvan, a többi a kondenzált, de áttekinthető ütemterv szerint halad. Egy közös checklist, egy friss vendéglista, egy költségvetés, ami együtt mozog veletek, és egy hely, ahol mindketten ugyanazt látjátok. Ennyi elég.",
        },
        {
          type: "cta",
          lead: "A Wēddly segít egy helyen tartani a költségvetést, vendéglistát, RSVP válaszokat és ültetési rendet, hogy ne külön táblázatokból kelljen szerveznetek az esküvőt.",
          href: "/signup",
          label: "Tegyétek a helyére ingyen",
        },
        { type: "h2", text: "Gyakori kérdések" },
        { type: "h3", text: "Lehet-e 6 hónap alatt megszervezni egy esküvőt?" },
        {
          type: "p",
          text: "Igen, ha az első néhány hét fókuszált. A legtöbb pár hat hónap alatt is szépen összerakja, főleg ha a vendégszám nem extrém nagy.",
        },
        { type: "h3", text: "Mikor küldjük ki a meghívót 6 hónapos időkereten belül?" },
        {
          type: "p",
          text: "Legkésőbb az esküvő előtt 8-12 héttel, hogy a vendégeknek legyen idejük válaszolni, és a végleges vendégszámra is maradjon idő a véglegesítésre.",
        },
        { type: "h3", text: "Mit nem érdemes 6 hónap alatt vállalni?" },
        {
          type: "p",
          text: "Egyedi szabású menyasszonyi ruhát, ha az adott szabónak hosszú a várólistája. Niche fotós vagy zenekar, akik egy évvel előre be vannak táblázva. Sok külföldi vendéggel járó esküvőt, ahol a meghívóra valódi save-the-date előzmény kellene. Ezekre 8-12 hónap reálisabb.",
        },
        { type: "h3", text: "Mikor legyen végleges az ültetési rend?" },
        {
          type: "p",
          text: "A végleges RSVP válaszok után, jellemzően az esküvő előtti 2-3 hétben.",
        },
      ],
    },
    en: {
      title: "Wedding planning checklist for 6 months: what to handle, when",
      lead: "If you've got six months until the wedding: a compressed timeline from the big decisions to the final week, so nothing piles up at the end.",
      seo_title: "Wedding planning checklist for 6 months · Weddly",
      seo_description:
        "A practical 6-month wedding planning checklist: what to handle six, four, two and one month before the wedding, and the final week.",
      body: [
        {
          type: "p",
          text: "Six months until the wedding is plenty manageable. Plenty of couples have exactly that, and the tighter window often makes planning more focused, less sprawling. The trick: what's still a leisurely decision on a 12-month checklist becomes urgent here. If the first weeks go well, the rest tends to settle by itself.",
        },
        {
          type: "p",
          text: "Below: what to handle at each stage so nothing piles up at the end.",
        },
        { type: "h2", text: "6 months out" },
        {
          type: "p",
          text: "These are the decisions everything else depends on. On a 12-month plan you'd spread them across the first quarter; here you want them settled in a week or two.",
        },
        {
          type: "ul",
          items: [
            "pick the date,",
            "decide the style,",
            "set a budget ceiling,",
            "estimate guest count,",
            "sign the venue,",
            "book the key vendors (photo, music),",
            "file the notice of marriage with the registrar.",
          ],
        },
        { type: "h3", text: "Pro tip" },
        {
          type: "p",
          text: "Let the first week be only about the venue and the date. Don't mix in dress, decor or seating thoughts until those two are locked. Everything else lines up against them.",
        },
        { type: "h2", text: "4 months out" },
        {
          type: "p",
          text: "After the big calls, the details that need lead time and fittings.",
        },
        {
          type: "ul",
          items: [
            "first guest-list draft,",
            "invitation design,",
            "RSVP flow setup,",
            "first dress and suit fittings,",
            "decor direction,",
            "officiant or celebrant booked,",
            "menu and bar quotes requested.",
          ],
        },
        {
          type: "p",
          text: "Update the budget from real quotes now, not estimates. This is usually where one or two lines start needing to be trimmed.",
        },
        { type: "h2", text: "2-3 months out" },
        {
          type: "p",
          text: "Replies and refinements. What was a plan turns into the final form.",
        },
        {
          type: "ul",
          items: [
            "invitations sent,",
            "RSVP deadline set (with a 6-month window, aim for 4-5 weeks before the wedding),",
            "collect meal choices,",
            "lock accommodation and transport,",
            "first seating draft,",
            "design printed pieces (table numbers, place cards),",
            "brief witnesses on their official tasks.",
          ],
        },
        { type: "h3", text: "Pro tip" },
        {
          type: "p",
          text: "Don't leave the invitation to the last minute. On a 6-month timeline, send no later than the end of month three; most guests need a few weeks to reply.",
        },
        { type: "h2", text: "1 month out" },
        {
          type: "p",
          text: "Finalisation phase. Less about new ideas, more about everyone reading the same current information.",
        },
        {
          type: "ul",
          items: [
            "submit final headcount,",
            "lock the seating chart,",
            "print table numbers and place cards,",
            "agree the vendor run-of-show,",
            "check payment deadlines,",
            "brief family and witnesses on arrival, role and timing.",
          ],
        },
        { type: "h2", text: "1 week out" },
        {
          type: "p",
          text: "Only fine-tuning left.",
        },
        {
          type: "ul",
          items: [
            "handle last guest changes,",
            "review printed pieces,",
            "vendor confirmations,",
            "pack the emergency kit,",
            "rest.",
          ],
        },
        {
          type: "p",
          text: "Yes, rest is on the list. After six months of compressed planning, the last week should be slower than the ones before.",
        },
        { type: "h2", text: "Summary" },
        {
          type: "p",
          text: "Six months is enough. The trick is to make the first two or three weeks focused: venue, date, key vendors. With those locked, the rest moves along a tighter but still readable timeline. A shared checklist, a guest list that stays current, a budget that moves with you, and one spot you both look at. That's enough.",
        },
        {
          type: "cta",
          lead: "Weddly keeps your budget, guest list, RSVPs and seating chart together, so you don't have to plan from disconnected spreadsheets.",
          href: "/signup",
          label: "Set it up for free",
        },
        { type: "h2", text: "FAQ" },
        { type: "h3", text: "Can a wedding be planned in 6 months?" },
        {
          type: "p",
          text: "Yes, if the first few weeks are focused. Most couples can pull it off in six months, especially if the guest count isn't extreme.",
        },
        { type: "h3", text: "When should invitations go out on a 6-month timeline?" },
        {
          type: "p",
          text: "No later than 8-12 weeks before the wedding, so guests have time to reply and you have time to finalise the headcount.",
        },
        { type: "h3", text: "What's harder to pull off in 6 months?" },
        {
          type: "p",
          text: "A custom-tailored bridal dress where the maker has a long waitlist. Niche photographers or bands booked a year out. Big international weddings where save-the-dates would normally precede the invitation. For those, 8-12 months is more realistic.",
        },
        { type: "h3", text: "When should the seating chart be final?" },
        {
          type: "p",
          text: "After the final RSVPs, typically 2-3 weeks before the wedding.",
        },
      ],
    },
  },
  // ── 11. Esküvői ügyintézés lépésről lépésre ───────────────────────
  {
    slug: "eskuvoi-ugyintezes-lepesrol-lepesre",
    published_at: "2026-05-17",
    read_minutes: 9,
    category: { hu: "Ügyintézés", en: "Paperwork" },
    hu: {
      title: "Esküvői ügyintézés lépésről lépésre: így néz ki a hivatalos rész",
      lead: "Házasságkötési szándék, 30 napos várakozás, tanúk, külső helyszín és külföldi okiratok: mit, mikor és hol kell intézni.",
      seo_title: "Esküvői ügyintézés lépésről lépésre · Wēddly",
      seo_description:
        "Magyar esküvői ügyintézés gyakorlatban: házasságkötési szándék bejelentése, 30 napos várakozás, iratok, tanúk, külső helyszín, külföldi okiratok.",
      body: [
        {
          type: "p",
          text: "Az esküvőszervezés egyik kevésbé romantikus, de annál fontosabb része a hivatalos ügyintézés. Ruha, helyszín, dekoráció és fotós mellett van egy pont, amit nem lehet kihagyni: a házasságkötési szándék bejelentése az anyakönyvvezetőnél.",
        },
        {
          type: "p",
          text: "Ez az a bürokratikus lépés, amely nélkül Magyarországon nem lehet hivatalosan házasságot kötni. A jó hír, hogy ha időben nekikezdtek, az egész folyamat átlátható és kezelhető.",
        },
        { type: "h2", text: "1. Mi az első hivatalos lépés?" },
        {
          type: "p",
          text: "Az első fontos teendő a házasságkötési szándék bejelentése. Ezt személyesen kell megtennetek annál az önkormányzatnál, illetve anyakönyvvezetőnél, ahol a házasságot szeretnétek megkötni.",
        },
        {
          type: "p",
          text: "A bejelentést legalább 30 nappal a tervezett esküvői dátum előtt kell megtenni. Külföldi állampolgár esetén legalább 60 nappal korábban érdemes számolni.",
        },
        { type: "h2", text: "2. Mit jelent a 30 napos várakozási idő?" },
        {
          type: "p",
          text: "A házasságkötést az anyakönyvvezető főszabály szerint csak a bejelentést követő 30 nap utáni időpontra tűzheti ki. Ez a kötelező várakozási idő a hivatalos folyamat része. Indokolt esetben a jegyző adhat felmentést, de erre nem érdemes automatikusan számítani.",
        },
        { type: "h3", text: "Gyakorlati példa" },
        {
          type: "p",
          text: "Ha május 10-én jelentitek be a házasságkötési szándékot, az időpont főszabály szerint csak a 30 nap letelte után lehet. Ezért a népszerű nyári és kora őszi dátumoknál különösen fontos, hogy ne az utolsó pillanatban kezdjetek időpontot keresni.",
        },
        { type: "h2", text: "3. Hol kell bejelenteni a házasságkötési szándékot?" },
        {
          type: "p",
          text: "A szándékot annál az anyakönyvvezetőnél kell bejelenteni, ahol a házasságot szeretnétek megkötni. Budapesten ez jellemzően azt a kerületet jelenti, ahol a szertartás lesz. A párok lakóhelytől függetlenül is köthetnek házasságot, tehát nem kötelező a saját lakóhelyetek szerinti hivatal.",
        },
        { type: "h3", text: "Pro tipp" },
        {
          type: "p",
          text: "Ha külső helyszínen, például kastélyban, étteremben vagy szabadtéren szeretnétek polgári szertartást, először nézzétek meg, melyik önkormányzathoz tartozik a helyszín. Nem mindegy, melyik anyakönyvvezető illetékes, és az sem, milyen feltételekkel vállalja a külső helyszínt.",
        },
        { type: "h2", text: "4. Mikor érdemes időpontot foglalni?" },
        {
          type: "p",
          text: "Bár a törvényi minimum 30 nap, esküvőszervezési szempontból ez nagyon kevés. A népszerű dátumok, például a nyári szombatok, hosszú hétvégék vagy könnyen megjegyezhető napok hamar betelhetnek.",
        },
        { type: "p", text: "Érdemes már hónapokkal korábban érdeklődni az önkormányzatnál:" },
        {
          type: "ul",
          items: [
            "mikor lehet bejelenteni a házasságkötési szándékot,",
            "milyen időpontok szabadok,",
            "vállalnak-e külső helyszínt,",
            "milyen díjakra kell számítani,",
            "milyen iratokat kérnek pontosan.",
          ],
        },
        {
          type: "p",
          text: "A bejelentéshez kapcsolódó jegyzőkönyv érvényességére is figyelni kell: több önkormányzat szerint ez a kiállítástól számított 1 évig érvényes, vagyis nem lehet évekkel korábban hivatalosan elindítani a folyamatot.",
        },
        { type: "h2", text: "5. Milyen iratokra lesz szükség?" },
        {
          type: "p",
          text: "A pontos iratlista önkormányzatonként és élethelyzettől függően eltérhet, ezért mindig az adott hivatal tájékoztatása az irányadó. Általában ezekre érdemes készülni:",
        },
        {
          type: "ul",
          items: [
            "érvényes személyazonosító igazolvány vagy útlevél,",
            "lakcímkártya,",
            "születési anyakönyvi kivonat, ha kérik,",
            "elvált fél esetén a válás igazolása,",
            "özvegy családi állapot esetén a korábbi házastárs halotti anyakönyvi kivonata,",
            "külföldi állampolgár esetén további okiratok, fordítások vagy igazolások.",
          ],
        },
        { type: "h3", text: "Pro tipp" },
        {
          type: "p",
          text: "Ne csak azt kérdezzétek meg, milyen irat kell, hanem azt is, hogy eredetiben kell-e bemutatni, szükséges-e hiteles fordítás, és elfogadnak-e külföldi dokumentumot apostille vagy diplomáciai felülhitelesítés nélkül. Ezeken könnyen csúszhat az ügyintézés.",
        },
        { type: "h2", text: "6. Személyesen kell menni?" },
        {
          type: "p",
          text: "Igen, a házasságkötési szándék bejelentése személyes megjelenést igényel. Az anyakönyvvezető felveszi a szükséges adatokat, egyezteti a házasságkötés feltételeit, és több fontos kérdésben is nyilatkoznotok kell.",
        },
        { type: "h2", text: "7. Milyen kérdésekre számíthattok az anyakönyvvezetőnél?" },
        {
          type: "p",
          text: "A bejelentés során nem csak az időpontot egyeztetitek. Az anyakönyvvezető több hivatalos és szertartással kapcsolatos kérdést is feltehet:",
        },
        {
          type: "ul",
          items: [
            "milyen nevet viseltek a házasság után,",
            "kik lesznek a tanúk,",
            "hol lesz a szertartás,",
            "milyen időpontban szeretnétek házasodni,",
            "lesz-e külső helyszín,",
            "kértek-e ünnepélyes szertartást,",
            "lesz-e zene, vers, gyűrűhúzás vagy egyéb ceremóniaelem,",
            "szükség lesz-e tolmácsra.",
          ],
        },
        { type: "h3", text: "Gyakorlati tanács" },
        {
          type: "p",
          text: "A névválasztást ne az ügyintézés pillanatában kezdjétek el kitalálni. Beszéljétek át előre, ki milyen nevet szeretne viselni a házasság után, mert ez hivatalos nyilatkozat.",
        },
        { type: "h2", text: "8. Mi a helyzet a tanúkkal?" },
        {
          type: "p",
          text: "A házasságkötéshez két tanú szükséges. A tanúk adatait általában előre meg kell adni, ezért időben kérjétek el tőlük:",
        },
        {
          type: "ul",
          items: [
            "teljes név,",
            "születési név,",
            "lakcím,",
            "személyazonosító okmány adatai,",
            "esetenként születési hely és idő.",
          ],
        },
        { type: "h3", text: "Pro tipp" },
        {
          type: "p",
          text: "A tanú ne csak „díszvendég” legyen. Olyan személyt válasszatok, aki biztosan ott lesz időben, tudja a feladatát, és a szertartás előtt is elérhető. Egy elkéső tanú felesleges stresszt okozhat.",
        },
        { type: "h2", text: "9. Külső helyszíni polgári szertartás" },
        {
          type: "p",
          text: "Sok pár szeretné, ha az anyakönyvvezető nem a hivatalban, hanem az esküvő helyszínén adná őket össze. Ez nagyon szép megoldás lehet, de több adminisztrációval és gyakran többletköltséggel jár.",
        },
        { type: "p", text: "Érdemes előre egyeztetni:" },
        {
          type: "ul",
          items: [
            "vállal-e az adott önkormányzat külső helyszínt,",
            "mely napokon és időpontokban elérhető az anyakönyvvezető,",
            "van-e külön díja a külső helyszínnek,",
            "milyen feltételeket kell biztosítani,",
            "kell-e asztal, szék, árnyékolás, hangosítás,",
            "mi történik rossz idő esetén.",
          ],
        },
        { type: "h3", text: "Pro tipp" },
        {
          type: "p",
          text: "Kültéri szertartásnál ne csak a dekorációra gondoljatok. Az anyakönyvvezetőnek is szüksége van megfelelő körülményekre: stabil asztalra, ülőhelyre, jól hallható hangosításra, eső- vagy napvédelemre és rendezett környezetre.",
        },
        { type: "h2", text: "10. Mennyibe kerül a polgári szertartás?" },
        {
          type: "p",
          text: "A költségek önkormányzatonként eltérhetnek. Más díjszabás vonatkozhat a hivatali helyiségben tartott egyszerű szertartásra, az ünnepélyes szertartásra, a munkaidőn kívüli időpontra vagy a külső helyszínre. Mindig az adott önkormányzat aktuális díjtáblázatát kérjétek el.",
        },
        { type: "h2", text: "11. Mi történik, ha külföldi állampolgár az egyik fél?" },
        {
          type: "p",
          text: "Külföldi állampolgár esetén hosszabb ügyintézéssel kell számolni. Ilyenkor legalább 60 nappal a tervezett házasságkötés előtt kell bejelenteni a házasságkötési szándékot.",
        },
        { type: "p", text: "Szükség lehet többek között:" },
        {
          type: "ul",
          items: [
            "külföldi okiratokra,",
            "családi állapot igazolására,",
            "hiteles magyar fordításra,",
            "tolmácsra, ha valamelyik fél nem érti és nem beszéli a magyar nyelvet.",
          ],
        },
        { type: "h3", text: "Pro tipp" },
        {
          type: "p",
          text: "Külföldi állampolgár esetén ne elégedjetek meg általános internetes listákkal. Írjatok vagy telefonáljatok közvetlenül az illetékes anyakönyvi hivatalnak, és kérjetek konkrét iratlistát az adott országra és élethelyzetre vonatkozóan.",
        },
        { type: "h2", text: "12. Lehet gyorsítani a folyamatot?" },
        {
          type: "p",
          text: "A 30 napos várakozási idő alól indokolt esetben a jegyző adhat felmentést. Ez azonban nem automatikus, és az indokot hitelt érdemlően igazolni kell. Sokkal biztonságosabb időben elindítani a folyamatot, mint felmentésre építeni.",
        },
        { type: "h2", text: "Esküvő előtti bürokrácia ellenőrzőlista" },
        {
          type: "ul",
          items: [
            "kiválasztottátok a házasságkötés helyszínét,",
            "tudjátok, melyik anyakönyvi hivatal illetékes,",
            "egyeztettetek időpontot a bejelentésre,",
            "ellenőriztétek a 30 napos határidőt,",
            "külföldi állampolgár esetén számoltatok a hosszabb ügyintézéssel,",
            "összekészítettétek a személyes okmányokat,",
            "eldöntöttétek a házasság utáni névviselést,",
            "kiválasztottátok a tanúkat,",
            "elkértétek a tanúk adatait,",
            "rákérdeztetek a szertartás díjaira,",
            "tisztáztátok, hogy hivatali vagy külső helyszíni szertartás lesz,",
            "megkérdeztétek, milyen technikai feltételeket kell biztosítani.",
          ],
        },
        { type: "h2", text: "Gyakori hibák, amiket érdemes elkerülni" },
        { type: "h3", text: "Túl későn kezditek az ügyintézést" },
        {
          type: "p",
          text: "A 30 napos szabály miatt az utolsó pillanatos szervezés kockázatos. Népszerű dátumoknál különösen igaz, hogy a hivatal és az anyakönyvvezető naptára hamar betelhet.",
        },
        { type: "h3", text: "Nem nézitek meg a helyszín szerinti illetékességet" },
        {
          type: "p",
          text: "Ha külső helyszínen lesz az esküvő, nem biztos, hogy a lakóhelyetek szerinti hivatal lesz az illetékes. Mindig a házasságkötés helye alapján tájékozódjatok.",
        },
        { type: "h3", text: "Nem egyeztettek a tanúkkal időben" },
        {
          type: "p",
          text: "A tanúk adataira szükség lehet, és a szertartáson személyesen jelen kell lenniük. Ne az esküvő előtti héten derüljön ki, hogy valaki mégsem ér rá.",
        },
        { type: "h3", text: "Nem számoltok a külföldi iratok átfutási idejével" },
        {
          type: "p",
          text: "Ha bármelyik fél külföldi állampolgár, vagy külföldi okiratokat kell bemutatni, több időre lehet szükség. Ez a teljes esküvői menetrendet befolyásolhatja.",
        },
        {
          type: "cta",
          lead: "A bürokrácia nem a legromantikusabb része az esküvőnek, de ha időben elintézitek, sok stressztől kímélhetitek meg magatokat. Így a nagy napra már tényleg az marad, ami a legfontosabb: az igen, a közös pillanat és az ünneplés.",
          href: "/signup",
          label: "Vezessétek a teendőket a Wēddly-vel",
        },
        { type: "h2", text: "Gyakori kérdések" },
        { type: "h3", text: "Mennyi idő kell az ügyintézés befejezéséhez?" },
        {
          type: "p",
          text: "Magyar állampolgárok esetén legalább 30 nap a szándék bejelentése és az esküvő között. Külföldi fél esetén minimum 60 nap. Reálisan 3-6 hónapra érdemes előre dolgozni, főleg ha népszerű dátumot szeretnétek.",
        },
        { type: "h3", text: "Bárhol bejelenthetjük a szándékot?" },
        {
          type: "p",
          text: "Annál az anyakönyvvezetőnél kell, ahol a házasságkötés lesz. Külső helyszínnél az illetékes önkormányzatot kell felkeresni.",
        },
        { type: "h3", text: "Lehet-e szombaton házasodni?" },
        {
          type: "p",
          text: "Igen, de a munkaidőn kívüli időpont általában külön díjat jelent, és a hivatal naptárától is függ. Érdemes előre időpontot kérni.",
        },
        { type: "h3", text: "Kell-e jegyesoktatás?" },
        {
          type: "p",
          text: "Polgári szertartáshoz nem. Egyházi szertartáshoz több felekezet kéri, de a részleteket az adott egyházközségnél érdemes egyeztetni.",
        },
      ],
    },
    en: {
      title: "Wedding paperwork in Hungary: how the official side works",
      lead: "Notice of marriage, 30-day waiting period, documents, witnesses, off-site ceremony and foreign citizens: what, when, and where.",
      seo_title: "Wedding paperwork in Hungary, step by step · Weddly",
      seo_description:
        "Practical Hungarian wedding paperwork: notice of marriage, the 30-day waiting period, documents, witnesses, off-site ceremonies and foreign citizens.",
      body: [
        {
          type: "p",
          text: "One of the less romantic but more important parts of planning a Hungarian wedding is the paperwork. Alongside the dress, venue, decor and photographer, one step can't be skipped: filing the notice of marriage with the registrar.",
        },
        {
          type: "p",
          text: "Without this step, you can't legally marry in Hungary. The good news: started in time, the process is straightforward.",
        },
        { type: "h2", text: "1. The first official step" },
        {
          type: "p",
          text: "The first task is filing the notice of marriage, in person, at the registrar of the municipality where you'll marry.",
        },
        {
          type: "p",
          text: "The notice must be filed at least 30 days before the wedding. If either party is a foreign citizen, allow at least 60 days.",
        },
        { type: "h2", text: "2. What the 30-day wait actually means" },
        {
          type: "p",
          text: "The registrar can only set the wedding date for after the 30-day waiting period. This is a legal requirement. In specific circumstances the notary can grant an exemption, but you shouldn't count on it.",
        },
        { type: "h3", text: "A practical example" },
        {
          type: "p",
          text: "If you file on May 10, the earliest legal wedding date is after the 30 days expire. For popular summer or early-autumn dates this means don't leave it to the last minute.",
        },
        { type: "h2", text: "3. Where to file" },
        {
          type: "p",
          text: "File the notice with the registrar of the municipality where the wedding will take place. In Budapest this is the district where the ceremony happens. You aren't tied to your residence; you can marry anywhere.",
        },
        { type: "h3", text: "Pro tip" },
        {
          type: "p",
          text: "If you're marrying off-site at a castle, restaurant or outdoor venue, check which municipality the venue belongs to. The registrar's office it belongs to, and whether they'll officiate off-site at all, both matter.",
        },
        { type: "h2", text: "4. When to book the date" },
        {
          type: "p",
          text: "Legally the minimum is 30 days, but in practice that's nowhere near enough. Popular dates fill up months ahead.",
        },
        { type: "p", text: "Ask the municipality early:" },
        {
          type: "ul",
          items: [
            "when notices of marriage can be filed,",
            "what slots are still open,",
            "whether they officiate off-site,",
            "what the fees are,",
            "what documents they expect.",
          ],
        },
        {
          type: "p",
          text: "The notice itself is typically valid for one year from issue, so you can't start the process years in advance.",
        },
        { type: "h2", text: "5. Documents you'll likely need" },
        {
          type: "p",
          text: "The exact list varies by municipality and personal situation. As a general guide, prepare:",
        },
        {
          type: "ul",
          items: [
            "valid ID card or passport,",
            "address card,",
            "birth certificate, if requested,",
            "divorce certificate if either of you was previously married,",
            "death certificate of the previous spouse if widowed,",
            "for foreign citizens: additional documents, translations, certifications.",
          ],
        },
        { type: "h3", text: "Pro tip" },
        {
          type: "p",
          text: "Don't only ask what documents you need. Ask whether you must present originals, whether certified translation is required, and whether they accept foreign documents without apostille or diplomatic legalisation.",
        },
        { type: "h2", text: "6. In-person requirement" },
        {
          type: "p",
          text: "Yes, both of you must appear in person to file the notice. The registrar records the data, confirms the conditions, and asks you to declare a number of things.",
        },
        { type: "h2", text: "7. What the registrar will ask" },
        {
          type: "p",
          text: "More than just the date. Expect questions about:",
        },
        {
          type: "ul",
          items: [
            "which surname each of you will use after the wedding,",
            "who the witnesses will be,",
            "where the ceremony will be,",
            "what time you want,",
            "off-site or in-office,",
            "formal or simple ceremony,",
            "music, readings, ring exchange, other ceremony elements,",
            "whether an interpreter will be needed.",
          ],
        },
        { type: "h3", text: "A practical note" },
        {
          type: "p",
          text: "Don't decide the surname question on the spot. Talk it through in advance; this is an official declaration on the record.",
        },
        { type: "h2", text: "8. Witnesses" },
        {
          type: "p",
          text: "Two witnesses are required. Collect their details in advance:",
        },
        {
          type: "ul",
          items: [
            "full name,",
            "birth name,",
            "address,",
            "ID document data,",
            "sometimes place and date of birth.",
          ],
        },
        { type: "h3", text: "Pro tip" },
        {
          type: "p",
          text: "Don't pick a witness purely for the honour. Pick someone reliable, who'll be there on time, knows what's expected, and is reachable in the week before.",
        },
        { type: "h2", text: "9. Off-site civil ceremonies" },
        {
          type: "p",
          text: "Plenty of couples want the registrar to officiate at the wedding venue rather than at the office. That's possible, but it means more paperwork and usually extra fees.",
        },
        { type: "p", text: "Settle in advance:" },
        {
          type: "ul",
          items: [
            "whether the municipality offers off-site officiating,",
            "available days and time slots,",
            "the off-site fee,",
            "what setup you need to provide,",
            "table, seating, shade, sound system,",
            "the bad-weather fallback.",
          ],
        },
        { type: "h3", text: "Pro tip" },
        {
          type: "p",
          text: "Outdoor planning isn't only about decor. The registrar needs a stable table, a seat, working sound, weather protection and a tidy setting.",
        },
        { type: "h2", text: "10. How much does the civil ceremony cost?" },
        {
          type: "p",
          text: "Fees vary by municipality. The simple in-office ceremony, the formal ceremony, an out-of-hours slot and an off-site ceremony are usually priced separately. Always check the current fee schedule of the specific municipality.",
        },
        { type: "h2", text: "11. What if one of you is a foreign citizen?" },
        {
          type: "p",
          text: "Allow more time. The notice should be filed at least 60 days before the wedding. You'll likely need:",
        },
        {
          type: "ul",
          items: [
            "foreign-issued documents,",
            "proof of marital status,",
            "certified Hungarian translation,",
            "an interpreter if one party doesn't speak Hungarian.",
          ],
        },
        { type: "h3", text: "Pro tip" },
        {
          type: "p",
          text: "Don't rely on general online lists. Contact the specific registrar's office and ask for a document list tailored to your country and situation.",
        },
        { type: "h2", text: "12. Can the process be sped up?" },
        {
          type: "p",
          text: "In specific cases the notary can waive the 30-day wait. It isn't automatic; you have to substantiate the reason credibly. Far safer to start on time than to count on a waiver.",
        },
        { type: "h2", text: "Pre-wedding paperwork checklist" },
        {
          type: "ul",
          items: [
            "you've chosen the wedding location,",
            "you know which registrar's office is in charge,",
            "you've booked the notice appointment,",
            "you've factored in the 30-day wait,",
            "if foreign citizen, you've factored in the longer process,",
            "you've gathered the personal documents,",
            "you've decided on surnames,",
            "you've chosen the witnesses,",
            "you've collected the witnesses' details,",
            "you've asked about the ceremony fees,",
            "you've confirmed in-office or off-site,",
            "you've checked the technical setup required.",
          ],
        },
        { type: "h2", text: "Common mistakes" },
        { type: "h3", text: "Starting too late" },
        {
          type: "p",
          text: "Last-minute organising is risky because of the 30-day rule. For popular dates the office's calendar and the registrar's availability fill up quickly.",
        },
        { type: "h3", text: "Not checking jurisdiction" },
        {
          type: "p",
          text: "For an off-site wedding the registrar of your residence isn't necessarily the one in charge. Always check based on the wedding location.",
        },
        { type: "h3", text: "Not coordinating witnesses early" },
        {
          type: "p",
          text: "You'll need their details up front, and they have to be there in person. Don't discover the week before that someone can't make it.",
        },
        { type: "h3", text: "Ignoring foreign-document timing" },
        {
          type: "p",
          text: "If foreign documents are involved, lead times grow. This affects the whole wedding timeline.",
        },
        {
          type: "cta",
          lead: "Paperwork isn't the romantic part of a wedding, but starting on time saves a lot of stress. Then the big day really is about what matters: the yes, the shared moment, the celebration.",
          href: "/signup",
          label: "Track every task with Weddly",
        },
        { type: "h2", text: "FAQ" },
        { type: "h3", text: "How long does the whole process take?" },
        {
          type: "p",
          text: "At least 30 days between notice and wedding for Hungarian citizens; at least 60 days if either party is a foreign citizen. Realistically plan 3-6 months ahead, especially for popular dates.",
        },
        { type: "h3", text: "Can we file anywhere?" },
        {
          type: "p",
          text: "Only at the registrar of the municipality where the wedding will be held. For off-site weddings, the municipality where the venue is located.",
        },
        { type: "h3", text: "Can we marry on a Saturday?" },
        {
          type: "p",
          text: "Yes, but out-of-hours dates usually carry an extra fee and depend on the office's calendar. Book early.",
        },
        { type: "h3", text: "Do we need pre-marriage classes?" },
        {
          type: "p",
          text: "No for civil ceremonies. Some denominations require it for church weddings; check with the parish.",
        },
      ],
    },
  },

  // ── Where to get married in Hungary ────────────────────────────────
  {
    slug: "where-to-get-married-in-hungary",
    published_at: "2026-05-30",
    read_minutes: 9,
    category: { hu: "Helyszínek", en: "Venues" },
    hu: {
      title: "Hol házasodjunk Magyarországon? 6 mesés esküvői helyszín",
      lead: "Barokk kastélyoktól a Balaton-parti apátságig: a legszebb magyar esküvői helyszínek régióról régióra, képekkel és gyakorlati tippekkel.",
      seo_title: "Hol házasodjunk Magyarországon? 6 mesés esküvői helyszín · Wēddly",
      seo_description:
        "A legszebb esküvői helyszínek Magyarországon: Festetics-kastély, Gödöllő, Vajdahunyad vára, Tihany, Villány, Eszterháza. Stílusok, befogadóképesség, tippek.",
      body: [
        {
          type: "p",
          text: "Magyarország meglepően sok mesés esküvői helyszínt zsúfol egy kis országba: barokk kastélyokat, amelyek egykor császárokat láttak vendégül, dombtetői apátságot a Balaton felett, mesebeli várat Budapest szívében és vörösboros vidéket a meleg déli tájon. Akár nagy, 200 fős lakodalmat terveztek, akár szűk körű szertartást, íme hat helyszín, ahol érdemes igent mondani, régióról régióra.",
        },
        { type: "h2", text: "1. Festetics-kastély, Keszthely" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Festetics_Palace,_Keszthely,_Hungary.jpg",
          alt: "A keszthelyi Festetics-kastély fehér barokk homlokzata",
          caption: "Festetics-kastély, Keszthely",
          credit: "Fotó: Sandor Somkuti / CC BY-SA 4.0, Wikimedia Commons",
          creditHref:
            "https://commons.wikimedia.org/wiki/File:Festetics_Palace,_Keszthely,_Hungary.jpg",
        },
        {
          type: "p",
          text: "Magyarország harmadik legnagyobb és leglátogatottabb kastélya a Balaton nyugati partján áll. Az aranyozott csillárokkal díszített tükörterem, a híres történelmi könyvtár és a védett kastélypark francia és angol kertje a romantikus, nagyszabású esküvők klasszikus díszlete. A kastélyban külön szárnyat alakítottak ki szertartásokhoz és bálokhoz, így a polgári ceremónia és a fogadás egy helyen, ünnepi környezetben tartható meg.",
        },
        { type: "h2", text: "2. Gödöllői Királyi Kastély" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Hungria_-_Palacio_de_Sisi_en_G%C3%B6d%C3%B6ll%C3%B6_-_panoramio.jpg",
          alt: "A gödöllői Királyi Kastély barokk épülete és parkja",
          caption: "Gödöllői Királyi Kastély",
          credit: "Fotó: isol / CC BY-SA 3.0, Wikimedia Commons",
          creditHref:
            "https://commons.wikimedia.org/wiki/File:Hungria_-_Palacio_de_Sisi_en_G%C3%B6d%C3%B6ll%C3%B6_-_panoramio.jpg",
        },
        {
          type: "p",
          text: "Magyarország legnagyobb barokk kastélya alig 30 kilométerre fekszik Budapesttől, és örökre összeforrt Sisi, vagyis Erzsébet királyné nevével, akinek kedvenc nyári rezidenciája volt. Az aranyozott dísztermek és a formás kertek a fővároshoz közeli, mégis történelmi hangulatú esküvők ideális helyszínévé teszik, ha a vendégeknek nem kell messzire utazniuk.",
        },
        { type: "h2", text: "3. Vajdahunyad vára, Budapest" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Budapest_Burg_Vajdahunyad.JPG",
          alt: "A budapesti Vajdahunyad vára a Városligetben, tó tükröződésével",
          caption: "Vajdahunyad vára, Városliget, Budapest",
          credit: "Fotó: Elelicht / CC BY-SA 3.0, Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Budapest_Burg_Vajdahunyad.JPG",
        },
        {
          type: "p",
          text: "Ha a vőlegény és a menyasszony Budapesthez ragaszkodik, a Városligetben álló Vajdahunyad vára a város egyik legfotogénebb háttere. Az 1896-os millenniumi kiállításra emelt, gótikát, reneszánszt és romanikát ötvöző épület tóparti tükörképe és mesekönyvbe illő sziluettje a belvárosban kínál intim szertartáshoz és fényképezéshez is tökéletes díszletet.",
        },
        { type: "h2", text: "4. Tihanyi Apátság, Balaton" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Tihanycivertanlegi1.jpg",
          alt: "A Tihanyi Apátság kéttornyú temploma a Balaton felett, légi felvétel",
          caption: "Tihanyi Bencés Apátság, Tihany",
          credit: "Fotó: Civertan Grafikai Stúdió / CC BY-SA 2.5, Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Tihanycivertanlegi1.jpg",
        },
        {
          type: "p",
          text: "Az 1055-ben alapított apátság okkersárga, kéttornyú barokk temploma a tihanyi félsziget tetejéről néz le a Balatonra, és az ország egyik leglátványosabb tóparti helyszíne. Az alapítólevél őrzi a legrégebbi fennmaradt magyar szavakat, így a hely történelmi súlya is hozzáad a szertartás hangulatához. A panoráma a naplementés fotókat is emlékezetessé teszi.",
        },
        { type: "h2", text: "5. Villányi borvidék" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Villany,_wine.jpg",
          alt: "Szőlőültetvények a Villányi borvidéken a Szársomlyó hegy alatt",
          caption: "Villányi borvidék, Baranya",
          credit: "Fotó: Cserlajos / CC BY-SA 3.0, Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Villany,_wine.jpg",
        },
        {
          type: "p",
          text: "Ha a kastélyok helyett lazább, déli hangulatra vágytok, Villány az ország vezető vörösboros vidéke a Szársomlyó természetvédelmi terület alatt. A szubmediterrán éghajlat, a szőlősorok és a modern pincészetek teraszai elegáns, mégis kötetlen, szabadtéri esküvői hangulatot kínálnak, jó borral és hosszú nyári estékkel.",
        },
        { type: "h2", text: "6. Eszterháza, a magyar Versailles, Fertőd" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Esterh%C3%A1zy_Palace,_Fert%C5%91d,_20220426_1053_5444.jpg",
          alt: "Az Esterházy-kastély rokokó homlokzata Fertődön",
          caption: "Esterházy-kastély (Eszterháza), Fertőd",
          credit: "Fotó: Jakub Hałun / CC BY-SA 4.0, Wikimedia Commons",
          creditHref:
            "https://commons.wikimedia.org/wiki/File:Esterh%C3%A1zy_Palace,_Fert%C5%91d,_20220426_1053_5444.jpg",
        },
        {
          type: "p",
          text: "A magyar Versailles néven is emlegetett fertődi Esterházy-kastély az ország legnagyobb barokk-rokokó palotája, amely egykor Haydnnak és zenekarának adott otthont. A díszes termek a szűk körű szertartásokhoz, a formás kastélypark pedig a nagyobb, szabadtéri kerti esküvőkhöz és koncertekhez is illik, Sopron közelében.",
        },
        { type: "h2", text: "Gyakorlati tudnivalók" },
        {
          type: "p",
          text: "Magyarországon a jogilag érvényes házasságot anyakönyvvezető köti, és sok kastély, valamint helyszín ki tudja hozni az anyakönyvvezetőt a helyszínre egy hivatalon kívüli ceremóniához. Adjatok magatoknak legalább egy hónapot a papírmunkára, a keresett dátumokat pedig érdemes akár egy évvel előre lefoglalni, főleg a nyári hétvégékre. Gondoljatok a vendégek utazására és szállására is, ha a helyszín Budapesten kívül van.",
        },
        {
          type: "cta",
          lead: "Megvan a helyszín? A többit mi egyszerűsítjük. A Weddlyvel egy helyen vezetheted a vendéglistát, az ültetési rendet, a költségvetést és a teendőket.",
          href: "/signup",
          label: "Kezdjétek el ingyen",
        },
      ],
    },
    en: {
      title: "Where to get married in Hungary: 6 fairy-tale wedding venues",
      lead: "From baroque palaces to a hilltop abbey above Lake Balaton, here are the most beautiful places to get married in Hungary, region by region, with photos and practical tips.",
      seo_title: "Where to get married in Hungary: 6 fairy-tale venues · Weddly",
      seo_description:
        "The best wedding venues in Hungary: Festetics Palace, Gödöllő, Vajdahunyad Castle, Tihany Abbey, Villány wine country and Eszterháza. Styles, capacity, tips.",
      body: [
        {
          type: "p",
          text: "Hungary packs an improbable number of fairy-tale wedding settings into a small country: baroque palaces that once hosted emperors, a hilltop abbey above Lake Balaton, a storybook castle in the middle of Budapest, and red-wine country in the warm south. Whether you are planning a grand 200-guest celebration or an intimate ceremony, here are six places worth saying I do, region by region.",
        },
        { type: "h2", text: "1. Festetics Palace, Keszthely" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Festetics_Palace,_Keszthely,_Hungary.jpg",
          alt: "The white baroque facade of Festetics Palace in Keszthely",
          caption: "Festetics Palace, Keszthely",
          credit: "Photo: Sandor Somkuti / CC BY-SA 4.0, via Wikimedia Commons",
          creditHref:
            "https://commons.wikimedia.org/wiki/File:Festetics_Palace,_Keszthely,_Hungary.jpg",
        },
        {
          type: "p",
          text: "Hungary's third-largest and most-visited palace stands on the western shore of Lake Balaton. The mirrored ballroom with its gilded chandeliers, the famous historic library and the protected palace park with its French and English gardens make it a classic setting for grand, romantic weddings. A dedicated wing was created for ceremonies and balls, so the civil ceremony and the reception can happen in one festive place.",
        },
        { type: "h2", text: "2. Royal Palace of Gödöllő" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Hungria_-_Palacio_de_Sisi_en_G%C3%B6d%C3%B6ll%C3%B6_-_panoramio.jpg",
          alt: "The baroque Royal Palace of Gödöllő and its grounds",
          caption: "Royal Palace of Gödöllő",
          credit: "Photo: isol / CC BY-SA 3.0, via Wikimedia Commons",
          creditHref:
            "https://commons.wikimedia.org/wiki/File:Hungria_-_Palacio_de_Sisi_en_G%C3%B6d%C3%B6ll%C3%B6_-_panoramio.jpg",
        },
        {
          type: "p",
          text: "Hungary's largest baroque palace sits barely 30 kilometres from Budapest and is forever tied to Empress Elisabeth, beloved Sisi, whose favourite summer residence it was. The gilded state rooms and formal gardens make it an ideal choice for a wedding that feels historic and grand yet keeps guests close to the capital, with no long journey involved.",
        },
        { type: "h2", text: "3. Vajdahunyad Castle, Budapest" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Budapest_Burg_Vajdahunyad.JPG",
          alt: "Vajdahunyad Castle in Budapest's City Park reflected in the lake",
          caption: "Vajdahunyad Castle, City Park, Budapest",
          credit: "Photo: Elelicht / CC BY-SA 3.0, via Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Budapest_Burg_Vajdahunyad.JPG",
        },
        {
          type: "p",
          text: "If you want to stay in Budapest, Vajdahunyad Castle in the City Park is one of the city's most photogenic backdrops. Built for the 1896 Millennium Exhibition and blending Gothic, Renaissance and Romanesque styles, its lakeside reflection and storybook silhouette offer a setting perfect for both an intimate ceremony and photographs, right in the heart of the city.",
        },
        { type: "h2", text: "4. Tihany Abbey, Lake Balaton" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Tihanycivertanlegi1.jpg",
          alt: "The twin-towered church of Tihany Abbey above Lake Balaton, aerial view",
          caption: "Tihany Benedictine Abbey, Tihany",
          credit: "Photo: Civertan Grafikai Stúdió / CC BY-SA 2.5, via Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Tihanycivertanlegi1.jpg",
        },
        {
          type: "p",
          text: "Founded in 1055, the abbey's ochre, twin-towered baroque church looks down on Lake Balaton from the top of the Tihany peninsula, making it one of the country's most spectacular lakeside locations. Its founding charter holds the oldest surviving Hungarian words, so the sheer history of the place adds weight to the day, while the panorama makes sunset photographs unforgettable.",
        },
        { type: "h2", text: "5. Villány wine region" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Villany,_wine.jpg",
          alt: "Vineyards in the Villány wine region below the Szársomlyó hill",
          caption: "Villány wine region, southern Hungary",
          credit: "Photo: Cserlajos / CC BY-SA 3.0, via Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Villany,_wine.jpg",
        },
        {
          type: "p",
          text: "If you prefer a relaxed southern mood to a palace, Villány is the country's leading red-wine region, set below the Szársomlyó nature reserve. The sub-Mediterranean climate, the rows of vines and the terraces of its modern wineries make for an elegant yet easygoing outdoor wedding atmosphere, with great wine and long summer evenings.",
        },
        { type: "h2", text: "6. Eszterháza, the Hungarian Versailles, Fertőd" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Esterh%C3%A1zy_Palace,_Fert%C5%91d,_20220426_1053_5444.jpg",
          alt: "The rococo facade of Esterházy Palace in Fertőd",
          caption: "Esterházy Palace (Eszterháza), Fertőd",
          credit: "Photo: Jakub Hałun / CC BY-SA 4.0, via Wikimedia Commons",
          creditHref:
            "https://commons.wikimedia.org/wiki/File:Esterh%C3%A1zy_Palace,_Fert%C5%91d,_20220426_1053_5444.jpg",
        },
        {
          type: "p",
          text: "Known as the Hungarian Versailles, the Esterházy Palace at Fertőd is the country's largest baroque-rococo palace and once home to the composer Joseph Haydn and his orchestra. The ornate state rooms suit intimate ceremonies, while the formal palace park works for larger outdoor garden weddings and concerts, all near the historic town of Sopron.",
        },
        { type: "h2", text: "Practical notes" },
        {
          type: "p",
          text: "In Hungary a legally binding marriage is performed by a registrar, and many palaces and venues can bring the registrar on site for an off-premises ceremony. Give yourselves at least a month for the paperwork, and book sought-after dates up to a year ahead, especially summer weekends. Factor in guest travel and accommodation too if the venue sits outside Budapest.",
        },
        {
          type: "cta",
          lead: "Found your venue? We make the rest simple. With Weddly you can run your guest list, seating chart, budget and to-dos in one place.",
          href: "/signup",
          label: "Start free",
        },
      ],
    },
  },

  // ── Where to get married in Austria ────────────────────────────────
  {
    slug: "where-to-get-married-in-austria",
    published_at: "2026-05-31",
    read_minutes: 9,
    category: { hu: "Helyszínek", en: "Venues" },
    hu: {
      title: "Hol házasodjunk Ausztriában? 7 romantikus esküvői helyszín",
      lead: "Császári palotáktól az alpesi panorámáig: a legszebb osztrák esküvői helyszínek Bécstől Salzburgon át a Wachau borvidékéig, képekkel.",
      seo_title: "Hol házasodjunk Ausztriában? 7 romantikus helyszín · Wēddly",
      seo_description:
        "A legszebb esküvői helyszínek Ausztriában: Schönbrunn, Mirabell-kastély, Leopoldskron, Hallstatt, Schloss Hof, Wachau, alpesi panoráma. Stílusok és tippek.",
      body: [
        {
          type: "p",
          text: "Ausztria a romantikus, mégis elegáns esküvők egyik európai fellegvára: császári barokk paloták, Sound of Music-hangulatú salzburgi termek, smaragdzöld tavak, szőlősorok a Duna mentén és alpesi panoráma egyetlen országban. Akár nagyszabású bécsi ceremóniáról, akár hegytetői szertartásról álmodtok, íme hét helyszín, ahol érdemes igent mondani.",
        },
        { type: "h2", text: "1. Schönbrunn Orangerie, Bécs" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Orangerie_(Sch%C3%B6nbrunn)_20080216.jpg",
          alt: "A bécsi Schönbrunn-palota Orangerie épülete",
          caption: "Schönbrunn Orangerie, Bécs",
          credit: "Fotó: Wolfgang H. Wögerer / CC BY 3.0, Wikimedia Commons",
          creditHref:
            "https://commons.wikimedia.org/wiki/File:Orangerie_(Sch%C3%B6nbrunn)_20080216.jpg",
        },
        {
          type: "p",
          text: "A világ egyik leghosszabb barokk narancsháza a Schönbrunn-palota kertjében áll, ahol egykor Mária Terézia és Mozart udvari koncertjei zajlottak. Az ünnepi termek és az előcsarnok a kertre nyíló teraszra vezetnek, így nagyszabású, akár több száz fős esküvők díszletét adják a császári Bécs szívében.",
        },
        { type: "h2", text: "2. Mirabell-kastély, Salzburg" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/2150_-_Salzburg_-_Schloss_Mirabell.JPG",
          alt: "A salzburgi Mirabell-kastély és kertje",
          caption: "Mirabell-kastély, Salzburg",
          credit: "Fotó: Andrew Bossi / CC BY-SA 2.5, Wikimedia Commons",
          creditHref:
            "https://commons.wikimedia.org/wiki/File:2150_-_Salzburg_-_Schloss_Mirabell.JPG",
        },
        {
          type: "p",
          text: "A Mirabell-kastély Márványterme a világ egyik legszebb és legkeresettebb polgári esküvői terme, márvánnyal és aranyozott stukkóval díszítve, ahol egykor Mozart is játszott. A terem inkább a meghittebb, mintegy 100 fős szertartásokhoz illik, a Mirabell-kertek pedig a Sound of Music ikonikus forgatási helyszínei.",
        },
        { type: "h2", text: "3. Schloss Leopoldskron, Salzburg" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Aerial_image_of_Schloss_Leopoldskron_(view_from_the_southwest).jpg",
          alt: "A Schloss Leopoldskron tóparti rokokó palotája légi felvételen",
          caption: "Schloss Leopoldskron, Salzburg",
          credit: "Fotó: Carsten Steger / CC BY-SA 4.0, Wikimedia Commons",
          creditHref:
            "https://commons.wikimedia.org/wiki/File:Aerial_image_of_Schloss_Leopoldskron_(view_from_the_southwest).jpg",
        },
        {
          type: "p",
          text: "Az 1736-ban épült rokokó palota saját tava partján fekszik, az Untersberg és a salzburgi vár panorámájával, és a Sound of Music egyik fő külső forgatási helyszíne volt. Ma szállodaként és rendezvényhelyszínként működik, így a tóparti szertartástól a dísztermi fogadásig egy helyen szervezhető meg a nagy nap.",
        },
        { type: "h2", text: "4. Hallstatt, Salzkammergut" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Hallstatt_Panorama.jpg",
          alt: "Hallstatt tóparti faluja a Dachstein hegyei alatt",
          caption: "Hallstatt, Salzkammergut",
          credit: "Fotó: Sergey / CC BY-SA 2.0, Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Hallstatt_Panorama.jpg",
        },
        {
          type: "p",
          text: "A világörökségi Hallstatt a világ egyik legfotózottabb tóparti faluja: smaragdzöld tó a Dachstein sziklái alatt. A szertartás megtartható a tóparton vagy akár hajón is, a parti szállodák pedig teraszos fogadásoknak adnak otthont. Egyetlen figyelmeztetés: a falu rendkívül látogatott, ezért az intim hangulathoz az alacsony szezon ajánlott.",
        },
        { type: "h2", text: "5. Schloss Hof, Alsó-Ausztria" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Schloss_hof_2023.jpg",
          alt: "A Schloss Hof barokk kastélya és teraszos kertje",
          caption: "Schloss Hof, Marchfeld",
          credit: "Fotó: Ekrem Canli / CC BY-SA 4.0, Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Schloss_hof_2023.jpg",
        },
        {
          type: "p",
          text: "Savoyai Jenő herceg egykori vidéki rezidenciája a szlovák határ közelében, mintegy 50 hektáros teraszos barokk kerttel. Az eredeti kastélykápolnát ma is használják szertartásokhoz, a dísztermek, a lovaglócsarnok és a barokk istállók pedig többféle fogadási helyszínt kínálnak egy nagyobb ünnephez.",
        },
        { type: "h2", text: "6. Wachau-völgy, Dürnstein" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Vineyards_along_the_Danube_in_Wachau.jpg",
          alt: "Teraszos szőlősorok a Duna mentén a Wachau-völgyben",
          caption: "Wachau borvidék, Dürnstein",
          credit: "Fotó: jay8085 / CC BY 2.0, Wikimedia Commons",
          creditHref:
            "https://commons.wikimedia.org/wiki/File:Vineyards_along_the_Danube_in_Wachau.jpg",
        },
        {
          type: "p",
          text: "A világörökségi Wachau teraszos szőlősorai a Duna mentén húzódnak, Dürnstein kék barokk apátsági tornyával és dombtetői várromjával a háttérben. A nyári szőlőskerti szertartások és a közeli vár- és apátsági helyszínek a klasszikus osztrák borvidéki esküvő díszletét adják, jó fehérborral kísérve.",
        },
        { type: "h2", text: "7. Hohe Mut Alm, Tirol" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Hohe_Mut_Alm.jpg",
          alt: "A Hohe Mut Alm magashegyi panorámája Tirolban",
          caption: "Hohe Mut Alm, Obergurgl, Tirol",
          credit: "Fotó: Tiia Monto / CC BY-SA 3.0, Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Hohe_Mut_Alm.jpg",
        },
        {
          type: "p",
          text: "Ha alpesi esküvőről álmodtok, a Hohe Mut Alm magasan az Ötztali-Alpokban fekszik, és kabinos felvonóval érhető el. A helyszínre akár saját esküvői gondola is felviszi a párt, a gleccserek és csúcsok panorámája pedig páratlan hátteret ad egy tiroli hegyi szertartáshoz.",
        },
        { type: "h2", text: "Gyakorlati tudnivalók" },
        {
          type: "p",
          text: "Ausztriában a polgári házasságot az anyakönyvi hivatal (Standesamt) köti, és sok kastély, illetve hegyi helyszín együttműködik a helyi hivatallal a helyszíni szertartáshoz. Külföldi párként számoljatok a dokumentumok hitelesítésével és fordításával, ezért kezdjétek a papírmunkát jó előre. A keresett salzburgi és bécsi termeket érdemes akár egy évvel korábban lefoglalni.",
        },
        {
          type: "cta",
          lead: "Megvan a helyszín? A Weddlyvel egy helyen vezetheted a vendéglistát, az ültetési rendet, a költségvetést és a teendőket, akár határon átnyúló esküvőhöz is.",
          href: "/signup",
          label: "Kezdjétek el ingyen",
        },
      ],
    },
    en: {
      title: "Where to get married in Austria: 7 romantic wedding venues",
      lead: "From imperial palaces to an alpine panorama, here are the most beautiful places to get married in Austria, from Vienna through Salzburg to the Wachau wine country, with photos.",
      seo_title: "Where to get married in Austria: 7 romantic venues · Weddly",
      seo_description:
        "The best wedding venues in Austria: Schönbrunn, Mirabell Palace, Leopoldskron, Hallstatt, Schloss Hof, the Wachau and an alpine panorama. Styles, capacity, tips.",
      body: [
        {
          type: "p",
          text: "Austria is one of Europe's great strongholds of the romantic-yet-elegant wedding: imperial baroque palaces, Sound of Music halls in Salzburg, emerald lakes, rows of vines along the Danube and alpine panoramas, all in one country. Whether you dream of a grand Vienna ceremony or a mountaintop vow, here are seven places worth saying I do.",
        },
        { type: "h2", text: "1. Schönbrunn Orangerie, Vienna" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Orangerie_(Sch%C3%B6nbrunn)_20080216.jpg",
          alt: "The Orangery building in the gardens of Schönbrunn Palace, Vienna",
          caption: "Schönbrunn Orangerie, Vienna",
          credit: "Photo: Wolfgang H. Wögerer / CC BY 3.0, via Wikimedia Commons",
          creditHref:
            "https://commons.wikimedia.org/wiki/File:Orangerie_(Sch%C3%B6nbrunn)_20080216.jpg",
        },
        {
          type: "p",
          text: "One of the world's longest baroque orangeries sits in the gardens of Schönbrunn Palace, where Maria Theresa and Mozart once held court concerts. The festive rooms and foyer open onto a terrace in the Orangery garden, making it a setting for grand weddings of several hundred guests in the heart of imperial Vienna.",
        },
        { type: "h2", text: "2. Mirabell Palace, Salzburg" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/2150_-_Salzburg_-_Schloss_Mirabell.JPG",
          alt: "Mirabell Palace and its gardens in Salzburg",
          caption: "Mirabell Palace, Salzburg",
          credit: "Photo: Andrew Bossi / CC BY-SA 2.5, via Wikimedia Commons",
          creditHref:
            "https://commons.wikimedia.org/wiki/File:2150_-_Salzburg_-_Schloss_Mirabell.JPG",
        },
        {
          type: "p",
          text: "The Marble Hall of Mirabell Palace is billed as one of the most beautiful and most-booked civil-wedding rooms in the world, clad in marble and gilded stucco, where Mozart once performed. The hall suits more intimate ceremonies of around 100 guests, while the Mirabell Gardens are an iconic Sound of Music filming location.",
        },
        { type: "h2", text: "3. Schloss Leopoldskron, Salzburg" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Aerial_image_of_Schloss_Leopoldskron_(view_from_the_southwest).jpg",
          alt: "Aerial view of the lakeside rococo palace Schloss Leopoldskron",
          caption: "Schloss Leopoldskron, Salzburg",
          credit: "Photo: Carsten Steger / CC BY-SA 4.0, via Wikimedia Commons",
          creditHref:
            "https://commons.wikimedia.org/wiki/File:Aerial_image_of_Schloss_Leopoldskron_(view_from_the_southwest).jpg",
        },
        {
          type: "p",
          text: "Built in 1736, this rococo palace sits beside its own lake with views of the Untersberg and Salzburg's fortress, and it was a primary exterior filming location for The Sound of Music. Today it runs as a hotel and event venue, so everything from a lakeside ceremony to a grand-room reception can be arranged in one place.",
        },
        { type: "h2", text: "4. Hallstatt, Salzkammergut" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Hallstatt_Panorama.jpg",
          alt: "The lakeside village of Hallstatt below the Dachstein mountains",
          caption: "Hallstatt, Salzkammergut",
          credit: "Photo: Sergey / CC BY-SA 2.0, via Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Hallstatt_Panorama.jpg",
        },
        {
          type: "p",
          text: "A UNESCO World Heritage site, Hallstatt is one of the most photographed lakeside villages in the world: an emerald lake framed by the cliffs of the Dachstein. Ceremonies can be held on the lakeshore or even on a boat, and the lakeside hotels host terrace receptions. One caveat: the village is intensely touristed, so off-season timing is best for an intimate feel.",
        },
        { type: "h2", text: "5. Schloss Hof, Lower Austria" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Schloss_hof_2023.jpg",
          alt: "The baroque palace and terraced garden of Schloss Hof",
          caption: "Schloss Hof, Marchfeld",
          credit: "Photo: Ekrem Canli / CC BY-SA 4.0, via Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Schloss_hof_2023.jpg",
        },
        {
          type: "p",
          text: "Once the country residence of Prince Eugene of Savoy, near the Slovak border, Schloss Hof comes with a roughly 50-hectare terraced baroque garden. The original palace chapel is still used for ceremonies, while the grand halls, riding hall and baroque stables provide several reception sites for a larger celebration.",
        },
        { type: "h2", text: "6. Wachau Valley, Dürnstein" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Vineyards_along_the_Danube_in_Wachau.jpg",
          alt: "Terraced vineyards along the Danube in the Wachau valley",
          caption: "Wachau wine region, Dürnstein",
          credit: "Photo: jay8085 / CC BY 2.0, via Wikimedia Commons",
          creditHref:
            "https://commons.wikimedia.org/wiki/File:Vineyards_along_the_Danube_in_Wachau.jpg",
        },
        {
          type: "p",
          text: "The UNESCO World Heritage terraced vineyards of the Wachau run along the Danube, with Dürnstein's blue baroque abbey tower and hilltop castle ruin behind. Summer vineyard ceremonies and nearby castle and abbey venues make for the classic Austrian wine-country wedding, paired with excellent white wine.",
        },
        { type: "h2", text: "7. Hohe Mut Alm, Tyrol" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Hohe_Mut_Alm.jpg",
          alt: "The high-alpine panorama of Hohe Mut Alm in Tyrol",
          caption: "Hohe Mut Alm, Obergurgl, Tyrol",
          credit: "Photo: Tiia Monto / CC BY-SA 3.0, via Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Hohe_Mut_Alm.jpg",
        },
        {
          type: "p",
          text: "If you dream of an alpine wedding, Hohe Mut Alm sits high in the Ötztal Alps and is reached by cable car. Couples can even ride a private wedding gondola up the mountain, and the glacier-and-peak panorama gives an unbeatable backdrop for a Tyrolean mountain ceremony.",
        },
        { type: "h2", text: "Practical notes" },
        {
          type: "p",
          text: "In Austria the civil marriage is performed by the registry office (Standesamt), and many palaces and mountain venues work with the local office for an on-site ceremony. As an international couple, allow time for document authentication and translation, so start the paperwork well ahead. Book sought-after Salzburg and Vienna halls up to a year in advance.",
        },
        {
          type: "cta",
          lead: "Found your venue? With Weddly you can run your guest list, seating chart, budget and to-dos in one place, even for a cross-border wedding.",
          href: "/signup",
          label: "Start free",
        },
      ],
    },
  },

  // ── Where to get married in Slovakia ───────────────────────────────
  {
    slug: "where-to-get-married-in-slovakia",
    published_at: "2026-06-01",
    read_minutes: 9,
    category: { hu: "Helyszínek", en: "Venues" },
    hu: {
      title: "Hol házasodjunk Szlovákiában? 7 mesés esküvői helyszín",
      lead: "Mesebeli váraktól a Magas-Tátra tópartjáig: a legszebb szlovák esküvői helyszínek, képekkel és gyakorlati tippekkel.",
      seo_title: "Hol házasodjunk Szlovákiában? 7 mesés helyszín · Wēddly",
      seo_description:
        "A legszebb esküvői helyszínek Szlovákiában: Bajmóci vár, Szomolány, Vöröskő, Pozsonyi vár, Château Béla, Csorba-tó, Bazin. Stílusok, befogadóképesség, tippek.",
      body: [
        {
          type: "p",
          text: "Szlovákia tele van romantikus esküvői helyszínekkel, amelyek meglepően közel vannak Magyarországhoz: mesebeli várak a Loire-völgy kastélyainak mintájára, reneszánsz erődök, a Duna fölé magasodó pozsonyi vár, a Magas-Tátra tóparti panorámája és a Kis-Kárpátok borvidéke. Íme hét helyszín, ahol érdemes igent mondani.",
        },
        { type: "h2", text: "1. Bajmóci vár (Bojnice)" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Bojnice_(Bojnitz)_Castle_(by_Pudelek).jpg",
          alt: "A bajmóci vár tornyos, mesebeli sziluettje",
          caption: "Bajmóci vár (Bojnický zámok), Bajmóc",
          credit: "Fotó: Pudelek (Marcin Szala) / CC BY-SA 3.0, Wikimedia Commons",
          creditHref:
            "https://commons.wikimedia.org/wiki/File:Bojnice_(Bojnitz)_Castle_(by_Pudelek).jpg",
        },
        {
          type: "p",
          text: "Szlovákia legismertebb mesebeli vára a Loire-völgy francia kastélyai mintájára épült át a 19. és 20. század fordulóján, középkori alapokon. Tornyos sziluettje, tava és kertjei az ország legromantikusabb helyszínévé teszik, amely gyakori forgatási helyszín is, így a tündérmese-hangulatú esküvők klasszikus választása.",
        },
        { type: "h2", text: "2. Szomolányi kastély (Smolenice)" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Smolenice_zamok.jpg",
          alt: "A szomolányi kastély neogótikus tornya a Kis-Kárpátokban",
          caption: "Szomolányi kastély (Smolenický zámok), Szomolány",
          credit: "Fotó: Kamil Gašparík / közkincs, Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Smolenice_zamok.jpg",
        },
        {
          type: "p",
          text: "A Kis-Kárpátok keleti lejtőin álló neogótikus kastély a bécsi Kreuzenstein vár mintájára épült újjá egy 15. századi erőd helyén. Ma a Szlovák Tudományos Akadémia kongresszusi központja, erdős dombok fölött, toronnyal és parkkal, ami az esküvőknek exkluzív, zárt hangulatot ad.",
        },
        { type: "h2", text: "3. Vöröskő vára (Červený Kameň)" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Cerveny_Kamen_z_Kukly_02.jpg",
          alt: "A Vöröskő reneszánsz erődje a Kis-Kárpátok erdei fölött",
          caption: "Vöröskő vára (Hrad Červený Kameň), Častá",
          credit: "Fotó: Teslaton / CC BY 3.0, Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Cerveny_Kamen_z_Kukly_02.jpg",
        },
        {
          type: "p",
          text: "A 16. században erőddé átépített, később a Pálffy család nemesi rezidenciájaként szolgáló Vöröskő ma jól megőrzött múzeum, díszes belső termekkel és Európa egyik legnagyobb várpince-rendszerével. A Kis-Kárpátok borvidékének erdei veszik körül, így ideális azoknak, akik történelmi, nemesi környezetre vágynak.",
        },
        { type: "h2", text: "4. Pozsonyi vár (Bratislava)" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Bratislava_-_Burg_(b).JPG",
          alt: "A pozsonyi vár négy saroktornyos barokk palotája a Duna fölött",
          caption: "Pozsonyi vár (Bratislavský hrad), Pozsony",
          credit: "Fotó: C.Stadler/Bwag / CC BY-SA 4.0, Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Bratislava_-_Burg_(b).JPG",
        },
        {
          type: "p",
          text: "A négy saroktornyával a Duna és az óváros fölé magasodó pozsonyi vár a szlovák főváros meghatározó sziluettje. Barokk kertjei és panorámája a városi esküvő ideális kiindulópontja azoknak a pároknak, akiknek Pozsony a háttér, jó közlekedéssel és sok közeli szálláshellyel.",
        },
        { type: "h2", text: "5. Château Béla, Dél-Szlovákia" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Ka%C5%A1tie%C4%BE_Bel%C3%A1_1.jpg",
          alt: "A Château Béla barokk kúriája és parkja",
          caption: "Château Béla (Kaštieľ Belá), Béla",
          credit: "Fotó: Mlevicky / CC BY-SA 3.0, Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Ka%C5%A1tie%C4%BE_Bel%C3%A1_1.jpg",
        },
        {
          type: "p",
          text: "A 18. századi barokk kúriát 2008-ban öt csillagos butikhotellé újították fel, Esztergom és Párkány közelében. A 28 hektáros birtokon francia kert, szökőkút, kápolna és a freskós szalon várja a szertartást, az Orangerie terem pedig akár 140 fős fogadásnak is helyet ad, a birtok saját boraival kísérve.",
        },
        { type: "h2", text: "6. Csorba-tó, Magas-Tátra" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/StrbskePlesoSommer.jpg",
          alt: "A Csorba-tó és a Magas-Tátra csúcsai nyáron",
          caption: "Csorba-tó (Štrbské Pleso), Magas-Tátra",
          credit: "Fotó: Molch-Entertainment / CC0, Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:StrbskePlesoSommer.jpg",
        },
        {
          type: "p",
          text: "Ha hegyi esküvőről álmodtok, a Magas-Tátra Csorba-tava mintegy 1350 méter magasan fekszik, a tóban tükröződő tátrai csúcsokkal. A tóparti szálloda kertjében tartott szertartások, valamint a panorámás báltermek az ország legkülönlegesebb hegyi és tóparti esküvői helyszínét adják.",
        },
        { type: "h2", text: "7. Bazini kastély (Pezinok), Kis-Kárpátok" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Pezinok_Castle_2019.jpg",
          alt: "A bazini kastély a Kis-Kárpátok borvidékén",
          caption: "Bazini kastély (Zámok Pezinok), Bazin",
          credit: "Fotó: Bratislavský kraj / CC BY 2.0, Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Pezinok_Castle_2019.jpg",
        },
        {
          type: "p",
          text: "A Pozsonytól mintegy 20 kilométerre, a Kis-Kárpátok borútján fekvő, 13. századi alapokon újjáépített bazini kastély ma hotel saját pincészettel, angolkert közepén. A rugalmas rendezvénytermek, a házias gasztronómia és a helyszíni borászat a borvidéki tematikájú esküvők természetes választásává teszik.",
        },
        { type: "h2", text: "Gyakorlati tudnivalók" },
        {
          type: "p",
          text: "Szlovákiában a polgári házasságot az anyakönyvi hivatal (matrika) köti, és sok vár, illetve kastély szervez helyszíni szertartást a helyi hivatallal. Magyar párként számoljatok a dokumentumok hitelesítésével és fordításával, ezért indítsátok a papírmunkát időben. A déli helyszínek, mint a Château Béla, autóval könnyen elérhetők Budapestről, így határon átnyúló esküvőhöz is jó választás.",
        },
        {
          type: "cta",
          lead: "Megvan a helyszín? A Weddlyvel egy helyen vezetheted a vendéglistát, az ültetési rendet, a költségvetést és a teendőket.",
          href: "/signup",
          label: "Kezdjétek el ingyen",
        },
      ],
    },
    en: {
      title: "Where to get married in Slovakia: 7 fairy-tale wedding venues",
      lead: "From storybook castles to a High Tatras lakeshore, here are the most beautiful places to get married in Slovakia, with photos and practical tips.",
      seo_title: "Where to get married in Slovakia: 7 fairy-tale venues · Weddly",
      seo_description:
        "The best wedding venues in Slovakia: Bojnice Castle, Smolenice, Červený Kameň, Bratislava Castle, Château Béla, Štrbské Pleso and Pezinok. Styles, capacity, tips.",
      body: [
        {
          type: "p",
          text: "Slovakia is full of romantic wedding settings that sit surprisingly close to Hungary: storybook castles modelled on the châteaux of the Loire, Renaissance fortresses, a castle towering over the Danube in Bratislava, the lakeside panorama of the High Tatras and the vineyards of the Little Carpathians. Here are seven places worth saying I do.",
        },
        { type: "h2", text: "1. Bojnice Castle" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Bojnice_(Bojnitz)_Castle_(by_Pudelek).jpg",
          alt: "The spired, fairy-tale silhouette of Bojnice Castle",
          caption: "Bojnice Castle (Bojnický zámok), Bojnice",
          credit: "Photo: Pudelek (Marcin Szala) / CC BY-SA 3.0, via Wikimedia Commons",
          creditHref:
            "https://commons.wikimedia.org/wiki/File:Bojnice_(Bojnitz)_Castle_(by_Pudelek).jpg",
        },
        {
          type: "p",
          text: "Slovakia's most famous fairy-tale castle was rebuilt at the turn of the 20th century on medieval foundations, modelled on the French châteaux of the Loire Valley. Its spired silhouette, lake and gardens make it the country's most romantic landmark, and a frequent film location, so it is the classic choice for a storybook wedding.",
        },
        { type: "h2", text: "2. Smolenice Castle" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Smolenice_zamok.jpg",
          alt: "The neo-Gothic tower of Smolenice Castle in the Little Carpathians",
          caption: "Smolenice Castle (Smolenický zámok), Smolenice",
          credit: "Photo: Kamil Gašparík / public domain, via Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Smolenice_zamok.jpg",
        },
        {
          type: "p",
          text: "Set on the eastern slopes of the Little Carpathians, this neo-Gothic castle was rebuilt on the site of a 15th-century fortress, modelled on Burg Kreuzenstein near Vienna. Today it is a congress centre of the Slovak Academy of Sciences, sitting above forested hills with a tower and landscaped grounds that give weddings an exclusive, private feel.",
        },
        { type: "h2", text: "3. Červený Kameň Castle" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Cerveny_Kamen_z_Kukly_02.jpg",
          alt: "The Renaissance fortress of Červený Kameň above the Little Carpathians forests",
          caption: "Červený Kameň Castle (Hrad Červený Kameň), Častá",
          credit: "Photo: Teslaton / CC BY 3.0, via Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Cerveny_Kamen_z_Kukly_02.jpg",
        },
        {
          type: "p",
          text: "Rebuilt as a fortress in the 16th century and later a stately Pálffy family residence, Červený Kameň is now a well-preserved museum with grand decorated interiors and one of Europe's largest castle cellar systems. It is surrounded by the forests of the Little Carpathians wine country, ideal for couples who want a historic, noble setting.",
        },
        { type: "h2", text: "4. Bratislava Castle" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Bratislava_-_Burg_(b).JPG",
          alt: "The four-towered baroque palace of Bratislava Castle above the Danube",
          caption: "Bratislava Castle (Bratislavský hrad), Bratislava",
          credit: "Photo: C.Stadler/Bwag / CC BY-SA 4.0, via Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Bratislava_-_Burg_(b).JPG",
        },
        {
          type: "p",
          text: "With its four corner towers rising above the Danube and the Old Town, Bratislava Castle is the defining silhouette of Slovakia's capital. Its baroque gardens and panorama make it the ideal anchor for a city wedding for couples who want Bratislava as their backdrop, with good transport and plenty of accommodation nearby.",
        },
        { type: "h2", text: "5. Château Béla, southern Slovakia" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Ka%C5%A1tie%C4%BE_Bel%C3%A1_1.jpg",
          alt: "The baroque manor house and park of Château Béla",
          caption: "Château Béla (Kaštieľ Belá), Belá",
          credit: "Photo: Mlevicky / CC BY-SA 3.0, via Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Ka%C5%A1tie%C4%BE_Bel%C3%A1_1.jpg",
        },
        {
          type: "p",
          text: "This 18th-century baroque manor was restored into a five-star boutique hotel in 2008, near Štúrovo and the Hungarian border. The 28-hectare estate offers a French garden, a fountain, an on-site chapel and the Fresco Salon for ceremonies, while the Orangerie hall hosts receptions of up to about 140 guests, paired with the estate's own wines.",
        },
        { type: "h2", text: "6. Štrbské Pleso, High Tatras" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/StrbskePlesoSommer.jpg",
          alt: "The alpine lake Štrbské Pleso and the High Tatras peaks in summer",
          caption: "Štrbské Pleso, High Tatras",
          credit: "Photo: Molch-Entertainment / CC0, via Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:StrbskePlesoSommer.jpg",
        },
        {
          type: "p",
          text: "If you dream of a mountain wedding, the High Tatras lake of Štrbské Pleso sits at around 1,350 metres, with the Tatra peaks reflected in the water. Garden ceremonies by the lakeside hotel and panoramic ballrooms with mountain-and-lake views make for the country's most striking mountain-and-lake wedding setting.",
        },
        { type: "h2", text: "7. Pezinok Castle, Little Carpathians" },
        {
          type: "img",
          src: "https://commons.wikimedia.org/wiki/Special:FilePath/Pezinok_Castle_2019.jpg",
          alt: "Pezinok Castle in the Little Carpathians wine country",
          caption: "Pezinok Castle (Zámok Pezinok), Pezinok",
          credit: "Photo: Bratislavský kraj / CC BY 2.0, via Wikimedia Commons",
          creditHref: "https://commons.wikimedia.org/wiki/File:Pezinok_Castle_2019.jpg",
        },
        {
          type: "p",
          text: "About 20 kilometres from Bratislava on the Little Carpathians wine route, this castle rebuilt on 13th-century foundations is now a hotel with its own winery, set in an English-style park. Flexible event halls, in-house gastronomy and an on-site winery make it the natural choice for a vineyard-themed wedding.",
        },
        { type: "h2", text: "Practical notes" },
        {
          type: "p",
          text: "In Slovakia the civil marriage is performed by the registry office (matrika), and many castles arrange on-site ceremonies with the local office. As an international couple, allow time for document authentication and translation, so begin the paperwork early. Southern venues like Château Béla are an easy drive from Budapest, making them a good pick for a cross-border wedding too.",
        },
        {
          type: "cta",
          lead: "Found your venue? With Weddly you can run your guest list, seating chart, budget and to-dos in one place.",
          href: "/signup",
          label: "Start free",
        },
      ],
    },
  },
];
