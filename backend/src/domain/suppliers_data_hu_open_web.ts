// Hungarian open-web research batch, August 2026. Every row was verified
// against the supplier's own public website: the website, service, location
// and contact details below are first-party published data. Descriptions are
// original summaries, not imported profile copy. Unknown prices stay null.

import type { RawDirectoryEntry } from "./suppliers_data";

const noContact = {
  contact_email: null,
  contact_phone: null,
  lat: null,
  lng: null,
} as const;

export const HUNGARY_OPEN_WEB_2026_08: RawDirectoryEntry[] = [
  // ── Furniture and equipment rental ──────────────────────────────────────
  {
    id: "tavolo-events",
    name: "Tavolo Events",
    category: "rental_equipment",
    city: "Budapest",
    address: null,
    capacity_min: null,
    capacity_max: 150,
    blurb_hu:
      "Természetközeli esküvőkhöz bérelhető fa asztalok, székek, könyöklők, nyugágyak, lenabroszok és fényfüzérek, helyszíni szállítással és összeszereléssel.",
    blurb_en:
      "Natural wood tables, chairs, poseur tables, deckchairs, linen and festoon lighting for outdoor and country weddings, delivered and assembled on site.",
    website: "https://www.tavoloevents.com/",
    ...noContact,
    contact_email: "kapcsolat@tavoloevents.com",
    contact_phone: "+36 70 609 5770",
    source: "curated",
    price_band: null,
  },
  {
    id: "party-caesar",
    name: "Party Caesar",
    category: "rental_equipment",
    city: "Budapest",
    address: "1045 Budapest, Chinoin utca 20.",
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Országos rendezvényeszköz-kiszállítás bútorokkal, sátrakkal, textilekkel, porcelánnal, poharakkal és esküvői dekorációs kellékekkel.",
    blurb_en:
      "Nationwide event-equipment delivery covering furniture, tents, linen, tableware, glassware and wedding decor accessories.",
    website: "https://partycaesar.hu/",
    ...noContact,
    contact_email: "info@party.info.hu",
    contact_phone: "+36 70 702 1513",
    contact_phone_alt: "+36 1 354 0883",
    source: "curated",
    price_band: null,
  },
  {
    id: "konnexio",
    name: "Konnexio",
    category: "rental_equipment",
    city: "Budapest",
    address: "1211 Budapest, II. Rákóczi Ferenc út 195–197.",
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Kültéri és beltéri rendezvényeszközök a konferenciaszéktől és Thonet-bútortól a különböző méretű rendezvénysátrakig, szállítással, építéssel és bontással.",
    blurb_en:
      "Indoor and outdoor event equipment, from seating and Thonet furniture to party tents in several sizes, with delivery, setup and dismantling.",
    website: "https://www.konnexio.hu/",
    ...noContact,
    contact_email: "konnexio@konnexio.hu",
    contact_phone: "+36 30 629 5090",
    contact_phone_alt: "+36 20 249 9200",
    source: "curated",
    price_band: null,
  },

  // ── Mobile food and wedding catering ────────────────────────────────────
  {
    id: "chill-wedding-catering",
    name: "Chill Wedding Catering",
    category: "food_trucks",
    city: "Budapest",
    address: "1125 Budapest, Városkúti út 17.",
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Food- és drink truckokra épülő esküvői catering, helyszínre szabott étel- és italcsomagokkal, vegán és mentes választékkal, szükség esetén mobil infrastruktúrával.",
    blurb_en:
      "Food- and drink-truck wedding catering with venue-specific menus, vegan and free-from options, plus mobile infrastructure for off-grid locations when needed.",
    website: "https://www.chillweddingcatering.hu/",
    ...noContact,
    contact_email: "chillweddingcatering@gmail.com",
    contact_phone: "+36 30 440 8043",
    source: "curated",
    price_band: null,
  },
  {
    id: "kanalgep-foodtruck-catering",
    name: "Kanálgép Foodtruck & Catering",
    category: "food_trucks",
    city: "Magyarország",
    address: null,
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Díjnyertes food truck háttérrel működő mobil catering, esküvőre szabott menüvel és helyben készülő street food fogásokkal.",
    blurb_en:
      "Mobile wedding catering built on an award-winning food-truck operation, with tailored menus and street-food dishes prepared on site.",
    website: "https://www.kanalgepcatering.hu/",
    ...noContact,
    contact_email: "info@kanalgepcatering.hu",
    contact_phone: "+36 30 146 7792",
    source: "curated",
    price_band: null,
  },
  {
    id: "sefkereken-food-truck-catering",
    name: "Séfkeréken Food Truck & Catering",
    category: "food_trucks",
    city: "Magyarország",
    address: null,
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Vintage megjelenésű mobil catering esküvőkre és rendezvényekre, BBQ-, street food-, mediterrán és tapas kínálattal, országos kitelepüléssel.",
    blurb_en:
      "Vintage mobile catering for weddings and events, offering BBQ, street food, Mediterranean and tapas menus with nationwide service.",
    website: "https://sefkereken.hu/",
    ...noContact,
    contact_email: "info@sefkereken.hu",
    contact_phone: "+36 30 208 2122",
    source: "curated",
    price_band: null,
  },
  {
    id: "pizza-o-sole-mio-catering",
    name: "Pizza ’O Sole Mio Catering",
    category: "food_trucks",
    city: "Budapest",
    address: null,
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Mobil kemencés nápolyi pizza esküvőkre és szabadtéri rendezvényekre, eredeti olasz alapanyagokkal és az eseményhez összeállított egyedi étlappal.",
    blurb_en:
      "Mobile-oven Neapolitan pizza for weddings and outdoor events, made with Italian ingredients and a menu tailored to the occasion.",
    website: "https://pizzaosolemio.hu/catering/",
    ...noContact,
    contact_email: "hello@pizzaosolemio.hu",
    source: "curated",
    price_band: null,
  },

  // ── Photo booths ────────────────────────────────────────────────────────
  {
    id: "fotomomentum-selfiebox",
    name: "FotoMomentum.hu",
    category: "photo_booth",
    city: "Ercsi",
    address: "2451 Ercsi, Semmelweis utca 30.",
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Országosan bérelhető szelfibox korlátlan nyomtatással, egyedi képsablonnal és háttérrel, kellékekkel és helyszíni asszisztenciával.",
    blurb_en:
      "Nationwide selfie-box hire with unlimited printing, custom layouts and backdrops, props and an on-site attendant.",
    website: "https://www.photomomentum.hu/",
    ...noContact,
    contact_email: "info@fotomomentum.hu",
    contact_phone: "+36 70 326 6068",
    source: "curated",
    price_band: null,
  },
  {
    id: "selfiebox-magyarorszag",
    name: "SelfieBox Magyarország",
    category: "photo_booth",
    city: "Göd",
    address: "2131 Göd, Nyírfa utca 19.",
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Esküvői fotóautomata azonnali nyomtatással, QR-kódos és e-mailes képmegosztással, egyedi grafikával, kellékekkel és személyes asszisztenciával.",
    blurb_en:
      "Wedding photo booth with instant prints, QR and email sharing, custom graphics, props and an on-site attendant.",
    website: "https://selfiebox.hu/",
    ...noContact,
    contact_email: "info@selfiebox.hu",
    contact_phone: "+36 70 433 8323",
    source: "curated",
    price_band: null,
  },

  // ── Wedding videography ─────────────────────────────────────────────────
  {
    id: "fogel-film",
    name: "Fogel Film",
    category: "videography",
    city: "Budapest",
    address: "1037 Budapest, Lestyán utca 3.",
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Több mint húsz éve készít esküvői filmeket, a készülődéstől a lakodalomig dokumentarista pillanatokkal; külön életútfilm is kérhető az esküvői vetítéshez.",
    blurb_en:
      "Wedding films shaped by more than twenty years of experience, covering preparations through the reception with documentary moments; a separate life-story film is also available for screening on the day.",
    website: "https://www.eskuvoi.video.hu/",
    ...noContact,
    contact_email: "info@eskuvoi.video.hu",
    contact_phone: "+36 30 297 7420",
    source: "curated",
    price_band: null,
  },
  {
    id: "imation-wedding",
    name: "Imation Wedding",
    category: "videography",
    city: "Budapest",
    address: null,
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Egész napos esküvői videózás Budapesten és országszerte, történetközpontú vágással, online filmátadással és legfeljebb hathetes utómunkával.",
    blurb_en:
      "Full-day wedding videography in Budapest and across Hungary, with story-led editing, online delivery and post-production within six weeks.",
    website: "https://eskuvovideos.hu/",
    ...noContact,
    contact_email: "hello@imationwedding.hu",
    source: "curated",
    price_band: null,
  },
  {
    id: "eventfilm",
    name: "Eventfilm",
    category: "videography",
    city: "Budapest",
    address: "1223 Budapest, Kistétény utca 6/A.",
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Diszkrét, dokumentarista esküvői filmezés spontán reakciókkal, tiszta helyszíni hanggal és drónfelvételekkel, több mint húsz év tapasztalattal.",
    blurb_en:
      "Discreet documentary wedding films built around spontaneous reactions, clean location sound and drone footage, backed by more than twenty years of experience.",
    website: "https://www.eventfilm.hu/",
    ...noContact,
    contact_email: "hello@eventfilm.hu",
    contact_phone: "+36 30 531 1851",
    source: "curated",
    price_band: null,
  },

  // ── Live wedding music ──────────────────────────────────────────────────
  {
    id: "andante-eskuvoi-partyzenekar",
    name: "Andante Esküvői és Partyzenekar",
    category: "live_music",
    city: "Magyarország",
    address: null,
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "1999 óta működő esküvői és partyzenekar élőzenei és DJ-szolgáltatással, az örökzöldektől a pop-, rock-, disco- és mulatós dalokig terjedő repertoárral.",
    blurb_en:
      "Wedding and party band active since 1999, combining live music and DJ service across evergreen, pop, rock, disco and Hungarian party repertoires.",
    website: "https://andantemusic.hu/",
    ...noContact,
    contact_email: "info@andantemusic.hu",
    contact_phone: "+36 70 223 7576",
    source: "curated",
    price_band: null,
  },
  {
    id: "night-band",
    name: "Night Band",
    category: "live_music",
    city: "Nyíregyháza",
    address: "4400 Nyíregyháza, Hősök tere 7.",
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Esküvői és rendezvényzenekar élőzene–DJ show-val, magyar és nemzetközi slágerekkel, valamint saját hang- és fénytechnikai háttérrel.",
    blurb_en:
      "Wedding and event band offering a combined live-music and DJ show, Hungarian and international hits, plus its own sound and lighting setup.",
    website: "https://nightband.hu/",
    ...noContact,
    contact_email: "info@nightband.hu",
    contact_phone: "+36 30 437 7955",
    source: "curated",
    price_band: null,
  },
  {
    id: "ngr-music-group",
    name: "NGR Music Group",
    category: "live_music",
    city: "Mohács",
    address: null,
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Mohács és Pécs térségéből induló esküvői és partyzenekar, amely több mint húsz éve játszik száz százalékban élő tánczenét elektronikus zenei alapok nélkül.",
    blurb_en:
      "Wedding and party band serving the Mohács and Pécs region, with more than twenty years of fully live dance music and no electronic backing tracks.",
    website: "https://eskuvoizenekar.ngr.hu/",
    ...noContact,
    source: "curated",
    price_band: null,
  },
  {
    id: "change-party-band",
    name: "Change Party Band",
    category: "live_music",
    city: "Magyarország",
    address: null,
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Két–nyolc fős formációkban kérhető élő zenekar esküvőkre és rendezvényekre, rock and roll, disco, mulatós, szerelmes és nemzetközi slágerekkel.",
    blurb_en:
      "Live wedding and event band available in line-ups of two to eight musicians, covering rock and roll, disco, Hungarian party music, love songs and international hits.",
    website: "https://change-party-band.hu/",
    ...noContact,
    contact_email: "changepartyband@gmail.com",
    contact_phone: "+36 30 667 1026",
    source: "curated",
    price_band: null,
  },
  {
    id: "2plusz1-zenekar",
    name: "2plusz1 Zenekar",
    category: "live_music",
    city: "Magyarország",
    address: null,
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Esküvői és partyzenekar közönségközeli, improvizatív és teljesen élő előadással; igény szerint templomi zenével és helyszíni hangosítással.",
    blurb_en:
      "Wedding and party band focused on interactive, improvised and fully live performance, with optional church music and on-site sound reinforcement.",
    website: "https://2plusz1.hu/",
    ...noContact,
    contact_phone: "+36 30 278 6564",
    source: "curated",
    price_band: null,
  },
  {
    id: "alibi-egyuttes",
    name: "Alibi Együttes",
    category: "live_music",
    city: "Magyarország",
    address: null,
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Hatfős, teljesen élőben játszó esküvői zenekar közel három évtizedes tapasztalattal, magyar és nemzetközi slágerekkel, DJ-vel és saját technikai csapattal.",
    blurb_en:
      "Six-piece fully live wedding band with nearly three decades of experience, Hungarian and international hits, optional DJ service and its own technical crew.",
    website: "https://www.alibiegyuttes.hu/",
    ...noContact,
    contact_email: "alibiegyuttes@gmail.com",
    contact_phone: "+36 70 382 7803",
    source: "curated",
    price_band: null,
  },

  // ── Sound and lighting technology ──────────────────────────────────────
  {
    id: "colmtech-audio-event",
    name: "Colmtech Audio & Event",
    category: "sound_tech",
    city: "Nyugat-Dunántúl",
    address: null,
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Kis és közepes rendezvények hang-, fény- és DJ-technikája elsősorban a Nyugat-Dunántúlon, helyszíni szállítással, építéssel, kezeléssel és bontással.",
    blurb_en:
      "Sound, lighting and DJ technology for small and medium events, primarily in Western Transdanubia, including delivery, setup, operation and dismantling.",
    website: "https://colmtech.com/",
    ...noContact,
    contact_email: "rendezveny@colmtech.com",
    contact_phone: "+36 30 178 9889",
    source: "curated",
    price_band: null,
  },
  {
    id: "tg-audio",
    name: "TG Audio",
    category: "sound_tech",
    city: "Kunfehértó",
    address: "6413 Kunfehértó, Kinizsi utca 7.",
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Kis és közepes rendezvényekhez méretezett hangosítás, fénytechnika, rendszerbemérés és eszközbérlés, teljes telepítéssel és helyszíni üzemeltetéssel.",
    blurb_en:
      "Sound reinforcement, lighting, system calibration and equipment hire for small and medium events, with complete installation and on-site operation.",
    website: "https://hangesfeny.hu/home",
    ...noContact,
    contact_email: "info@hangesfeny.hu",
    contact_phone: "+36 30 503 7373",
    source: "curated",
    price_band: null,
  },

  // ── Wedding dance lessons ──────────────────────────────────────────────
  {
    id: "eskuvoitanc-hu",
    name: "EsküvőiTánc.hu",
    category: "dance_lessons",
    city: "Budapest",
    address: null,
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Budapesti esküvőitánc-oktatás személyre szabott koreográfiával, klasszikus keringőkkel, latin táncokkal, rockyval és egyedi mixekkel, kezdő pároknak is.",
    blurb_en:
      "Budapest wedding-dance lessons with personalised choreography, classic waltzes, Latin styles, rock and roll and custom mixes, including complete beginners.",
    website: "https://eskuvoitanc.hu/",
    ...noContact,
    contact_email: "info@eskuvoitanc.hu",
    contact_phone: "+36 20 966 5152",
    source: "curated",
    price_band: null,
  },
  {
    id: "eskuvoi-tancoktatas-goldance",
    name: "Esküvői Táncoktatás – Goldance",
    category: "dance_lessons",
    city: "Budapest",
    address: null,
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Több budapesti helyszínen elérhető, egyéni időbeosztású esküvőitánc-oktatás több mint tíz tanárral, személyre szabott zenével, stílussal és koreográfiával.",
    blurb_en:
      "Wedding-dance tuition at several Budapest locations with flexible scheduling, more than ten instructors, and music, style and choreography tailored to each couple.",
    website: "https://eskuvoitancoktatas.hu/",
    ...noContact,
    contact_email: "mail@goldance.hu",
    contact_phone: "+36 30 442 7902",
    source: "curated",
    price_band: null,
  },
  {
    id: "broadway-dance-center-eskuvoi-tanc",
    name: "Broadway Dance Center – Esküvői tánc",
    category: "dance_lessons",
    city: "Budapest",
    address: "1146 Budapest, Kerepesi út 26. I. emelet",
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Személyre szabott elsőtánc-oktatás teljesen kezdőknek is, zeneválasztási és zenevágási segítséggel, otthoni gyakorlóvideóval és igény szerint angol nyelven.",
    blurb_en:
      "Personalised first-dance lessons suitable for complete beginners, with music selection and editing help, home-practice video and English-language tuition on request.",
    website: "https://dancecenter.hu/eskuvoi-tancoktatas/",
    ...noContact,
    contact_email: "broadway@dance-center.hu",
    contact_phone: "+36 20 571 9050",
    source: "curated",
    price_band: null,
  },
  {
    id: "eskuvoi-kikepzok-tanc",
    name: "Esküvői Kiképzők – Erdélyi Kata",
    category: "dance_lessons",
    city: "Budapest",
    address: null,
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "Húszéves oktatói tapasztalatra épülő, személyre szabott nyitótánc- és csoportos koreográfia, örömszülőtánccal, flashmobbal és igény szerinti zenevágással.",
    blurb_en:
      "Personalised first-dance and group choreography backed by twenty years of teaching experience, including parent dances, flash mobs and optional music editing.",
    website: "https://eskuvoikikepzok.hu/cpg/626907/Eskuvoi-tanctanitas",
    ...noContact,
    contact_email: "eskuvoi.kikepzok@gmail.com",
    contact_phone: "+36 20 773 7467",
    source: "curated",
    price_band: null,
  },
];
