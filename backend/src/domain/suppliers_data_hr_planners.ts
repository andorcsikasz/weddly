import type { RawDirectoryEntry } from "./suppliers_data";

const noContact = {
  contact_email: null,
  contact_phone: null,
  lat: null,
  lng: null,
} as const;

/** Croatian planners verified against their own contact pages in August 2026. */
export const CROATIA_PLANNERS_2026_08: RawDirectoryEntry[] = [
  {
    id: "weddings-in-split-planner",
    name: "Weddings in Split",
    category: "wedding_planner",
    city: "Split, HR",
    address: "Trumbićeva obala 4, 21000 Split, Croatia",
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "A Weddings in Split teljes körű és többnapos destination esküvőket, elopementeket és helyszíni koordinációt szervez Splitben és Dalmáciában. Három közvetlen telefonszámmal és spliti irodacímmel dolgozik.",
    blurb_en:
      "Full-service and multi-day destination weddings, elopements and on-the-day coordination in Split and Dalmatia, with a local office and three direct telephone contacts.",
    website: "https://weddingsinsplit.com/",
    gallery_urls: [
      "https://cms.weddingsinsplit.com/assets/edaefa0d-e978-4cbb-b4df-258e03bf22d5?quality=80&format=webp",
      "https://cms.weddingsinsplit.com/assets/2f91ed7f-a7fd-419a-a264-87eb6a79c929?quality=100&format=webp&width=780",
      "https://cms.weddingsinsplit.com/assets/a75d9205-b0bb-40e4-ae25-e8caecdf9c95?quality=100&format=webp&width=550",
    ],
    ...noContact,
    // Same mailbox already held back on the "Villa Dalmacija" venue listing
    // this company represents (booking-partner address, not confirmed as a
    // single vendor's own inbox).
    contact_email: "info@weddingsinsplit.com",
    contact_email_flag: "unverified",
    contact_phone: "+385 98 881 304",
    contact_phone_alt: "+385 98 974 8958",
    source: "curated",
    price_band: null,
  },
  {
    id: "promessi-weddings-events",
    name: "Promessi Weddings & Events",
    category: "wedding_planner",
    city: "Split, HR",
    address: "Fausta Vrančića 9, 21000 Split, Croatia",
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "A Promessi spliti csapata teljes destination esküvőszervezést kínál a koncepciótól a helyszíni lebonyolításig. Nemzetközi párokra és dalmát helyszínekre specializálódik.",
    blurb_en:
      "A Split-based team planning destination weddings from the first concept through on-site delivery, with an emphasis on international couples and Dalmatian venues.",
    website: "https://promessi.com.hr/",
    gallery_urls: [
      "https://promessi.com.hr/wp-content/uploads/2024/12/Wedding-services-Croatia-55.webp",
      "https://promessi.com.hr/wp-content/uploads/2024/11/Vogue-Elopement-in-Hvar-31.jpg",
      "https://promessi.com.hr/wp-content/uploads/2024/11/petra_and_henry_preview-35-1-1.jpg",
    ],
    ...noContact,
    contact_email: "info@promessi.com.hr",
    contact_phone: "+385 91 566 8171",
    source: "curated",
    price_band: null,
  },
  {
    id: "dalmatian-weddings-split",
    name: "Dalmatian Weddings",
    category: "wedding_planner",
    city: "Split, HR",
    address: "Karlovačka 1, 21000 Split, Croatia",
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "A Dalmatian Weddings spliti szervezőként személyre szabott horvát destination esküvőket tervez. A szolgáltatás a beszállítók összehangolásától a teljes esküvőnapi koordinációig terjed.",
    blurb_en:
      "Personal destination-wedding planning from Split, covering supplier coordination, logistics and delivery of the wedding day across Dalmatia.",
    website: "https://dalmatianweddings.com/",
    gallery_urls: [
      "https://dalmatianweddings.com/wp-content/uploads/2025/03/dw_web_homepage_01.png",
      "https://dalmatianweddings.com/wp-content/uploads/2025/03/dw_web_homepage_03.png",
      "https://dalmatianweddings.com/wp-content/uploads/2024/12/our_story_dw.png",
    ],
    ...noContact,
    contact_email: "hello@dalmatianweddings.com",
    contact_phone: "+385 98 9273 555",
    source: "curated",
    price_band: null,
  },
  {
    id: "laveo-weddings-porec",
    name: "LaVeo Weddings",
    category: "wedding_planner",
    city: "Poreč, HR",
    address: "Kadumi 18, 52440 Poreč, Croatia",
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "A LaVeo Isztriában esküvőszervezést, koordinációt, stylingot, virág- és dekorációs tervezést kínál egy csapaton belül. Poreč melletti címmel, helyi kapcsolatrendszerrel működik.",
    blurb_en:
      "Istrian wedding planning and coordination combined with styling, floral design and decoration from one team based just outside Poreč.",
    website: "https://laveoweddings.com/",
    gallery_urls: [
      "https://laveoweddings.com/wp-content/uploads/2025/08/IMG_0086_resized.jpg",
      "https://laveoweddings.com/wp-content/uploads/2026/07/KARLA-I-SEBA-RESIZED_6.jpg",
      "https://laveoweddings.com/wp-content/uploads/2025/09/Impala-Weddings-Mia-Josip-89_resized.jpg",
    ],
    ...noContact,
    contact_email: "info@laveoweddings.com",
    contact_phone: "+385 95 851 9394",
    source: "curated",
    price_band: null,
  },
  {
    id: "wed-our-way-croatia",
    name: "Wed Our Way Croatia",
    category: "wedding_planner",
    city: "Split, HR",
    address: "Antuna Branka Šimića 19, 21000 Split, Croatia",
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "A Wed Our Way horvát destination esküvőket szervez Dubrovnik, Split, Hvar, Cavtat és a dalmát szigetek térségében. A pár saját elképzelésének megvalósítását és a helyi logisztika átvételét helyezi középpontba.",
    blurb_en:
      "Destination-wedding planning across Dubrovnik, Split, Hvar, Cavtat and the Dalmatian islands, focused on executing the couple's own vision and carrying the local logistics.",
    website: "https://wedourway.com/croatia/wedding-planner/",
    gallery_urls: [
      "https://wedourway.com/wp-content/uploads/2025/06/wedding-planner-croatia-01-web.jpg",
      "https://wedourway.com/wp-content/uploads/2021/01/dubrovnik-wedding-planner-01.jpg",
      "https://wedourway.com/wp-content/uploads/2021/01/dubrovnik-wedding-planner-03.jpg",
    ],
    ...noContact,
    contact_email: "info@wedourway.com",
    contact_phone: "+385 98 1732 388",
    source: "curated",
    price_band: null,
  },
  {
    id: "chic-croatia-weddings",
    name: "Chic Croatia",
    category: "wedding_planner",
    city: "Selca, HR",
    address: "Marka Marulića 21, 21425 Selca, Brač, Croatia",
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "A Chic Croatia több mint húszéves rendezvényes és turisztikai háttérrel tervez prémium destination esküvőket Dubrovnik, Hvar, Split és a dalmát szigetek térségében. Brač szigetéről országos projekteket is vállal.",
    blurb_en:
      "Premium destination weddings in Dubrovnik, Hvar, Split and the Dalmatian islands, backed by more than twenty years in events and tourism and run from the island of Brač.",
    website: "https://chic-croatia.com/",
    gallery_urls: [
      "https://chic-croatia.com/wp-content/uploads/2024/11/AR-312.jpg",
      "https://chic-croatia.com/wp-content/uploads/2026/06/CarolineAndy19-manja.webp",
      "https://chic-croatia.com/wp-content/uploads/2024/10/Laura-Trevor.webp",
    ],
    ...noContact,
    contact_email: "info@chic-croatia.com",
    contact_phone: "+385 91 261 0078",
    source: "curated",
    price_band: null,
  },
  {
    id: "bloom-weddings-croatia",
    name: "Bloom Weddings Croatia",
    category: "wedding_planner",
    city: "Poreč, HR",
    address: "Musalež 6, 52440 Poreč, Croatia",
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "A Bloom Weddings isztriai esküvőszervező iroda, amely a tervezési folyamatot, a beszállítókat és a helyszíni lebonyolítást egyaránt kezeli. Angol nyelvű destination megkereséseket is fogad.",
    blurb_en:
      "An Istrian planning agency handling the planning process, local supplier team and on-site coordination, with English-language destination enquiries welcomed.",
    website: "https://www.bloomweddings.eu/",
    gallery_urls: [
      "https://www.bloomweddings.eu/img/naslovna.jpg",
      "https://www.bloomweddings.eu/img/vj%20(1).jpg",
      "https://www.bloomweddings.eu/img/vj2%20(2).jpg",
    ],
    ...noContact,
    contact_email: "info@bloomweddings.eu",
    contact_phone: "+385 91 505 4013",
    source: "curated",
    price_band: null,
  },
  {
    id: "do-you-wed-me-dubrovnik",
    name: "DoYouWed.Me",
    category: "wedding_planner",
    city: "Dubrovnik, HR",
    address: "Dubrovnik, Croatia",
    capacity_min: null,
    capacity_max: null,
    blurb_hu:
      "A DoYouWed.Me 2009 óta szervez destination esküvőket Dubrovnikban. A teljes költség- és beszállítói tervet, az időzítést, a jogi részleteket és az esküvőnapi koordinációt is kezeli.",
    blurb_en:
      "A Dubrovnik destination-wedding planner operating since 2009, covering the supplier and cost plan, timings, local formalities and coordination on the day.",
    website: "https://doyouwed.me/",
    gallery_urls: [
      "https://static.tildacdn.net/tild3738-6233-4531-a163-633061643761/2012-06-30_Carolyn_W.JPG",
      "https://static.tildacdn.net/tild6564-3837-4636-b335-303137333965/EJ_video-61.jpg",
      "https://static.tildacdn.net/tild6662-3763-4332-a232-393464323431/LA-499.jpg",
    ],
    ...noContact,
    contact_email: "info@doyouwed.me",
    contact_phone: "+385 99 3967 712",
    source: "curated",
    price_band: null,
  },
];
