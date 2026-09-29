import type { RawDirectoryEntry } from "./suppliers_data";

/**
 * Győr–Sopron wedding venues curated from Esküvő Fotó Győr's venue guide.
 * Contact details, addresses, capacities, and images were cross-checked against
 * the venues' own sites and current specialist directory profiles in 2026-09.
 */
export const HUNGARY_GYOR_VENUES_2026_09: RawDirectoryEntry[] = [
  {
    id: "eventgarden-agfalva",
    name: "Eventgarden",
    category: "venue",
    city: "Ágfalva",
    address: "9423 Ágfalva, Magyar utca 25.",
    lat: 47.6869,
    lng: 16.504435,
    blurb_hu:
      "Természetközeli esküvői és rendezvényhelyszín Ágfalván, Sopron mellett, tágas kerttel és fedett rendezvénytérrel. A helyszín akár 220 fős ünnepléshez is használható, így nagyobb lagzik számára is kényelmes választás. A zöld környezet kültéri szertartáshoz és helyszíni fotózáshoz is hangulatos hátteret ad.",
    blurb_en:
      "A nature-led wedding and event venue in Ágfalva near Sopron, with a spacious garden and covered event space. It can host celebrations of up to 220 guests, making it suitable for larger weddings. The green setting also provides an atmospheric backdrop for outdoor ceremonies and on-site portraits.",
    website: "https://www.eventgarden.hu/",
    contact_email: "info@eventgarden.hu",
    contact_phone: "+36 20 355 5390",
    contact_phone_alt: null,
    venue_style: "event_hall",
    price_band: null,
    capacity_min: null,
    capacity_max: 220,
    gallery_urls: [
      "https://d7ce8d4175.clvaw-cdnwnd.com/f1d87b35d427dee11ea244367dc7575d/200000649-ce771ce773/700/15045521_1336127813067093_469421338_o.jpeg?ph=d7ce8d4175",
      "https://www.visitsopron.com/media/thumbs/45/30/34/453034868_896678012488681_1597927057575927545_n-7b7e168c-1580066.jpg",
    ],
    source: "curated",
  },
  {
    id: "aranyhal-etterem-gyor",
    name: "Aranyhal Étterem",
    category: "venue",
    city: "Győr",
    address: "9019 Győr-Gyirmót, Ménfői út 83–85.",
    lat: 47.6321231,
    lng: 17.596108,
    blurb_hu:
      "Gyirmóti étterem és rendezvényhelyszín halastóval, zöld környezettel és könnyű győri megközelítéssel. A különterem és a szabadtéri adottságok polgári szertartáshoz, vacsorához és lakodalomhoz is rugalmasan alakíthatók. A közzétett teremkapacitás alapján körülbelül 180 fős esküvők is tarthatók itt.",
    blurb_en:
      "A restaurant and event venue in Gyirmót with a fishing lake, green surroundings, and easy access from Győr. Its private room and outdoor areas can be arranged for civil ceremonies, dinner, and dancing. Published venue information indicates capacity for weddings of around 180 guests.",
    website: "https://aranyhaletterem.com/",
    contact_email: "info@aranyhaletterem.com",
    contact_phone: "+36 96 556 141",
    contact_phone_alt: "+36 20 417 6310",
    venue_style: "restaurant",
    price_band: null,
    capacity_min: null,
    capacity_max: 180,
    gallery_urls: [
      "https://www.programturizmus.hu/media/image/show/partner/gasztronomia/etelek/etterem/ettermek/4/1078-aranyhal-sportcentrum-es-halasto-gyor-gyirmot.jpg",
    ],
    source: "curated",
  },
  {
    id: "panorama-etterem-balf",
    name: "Panoráma Étterem Balf",
    category: "venue",
    city: "Sopron",
    address: "9494 Sopron-Balf, Fürdő sor 25.",
    lat: 47.64985,
    lng: 16.660633,
    blurb_hu:
      "Családias étterem és esküvői helyszín Balfon, kilátással a Fertő-táj felé. A panorámás terasz és a vendégtér meghitt vacsorákhoz, szertartásokhoz és közepes létszámú lakodalmakhoz kínál kellemes környezetet. A nyilvánosan közölt adatok szerint a helyszín nagyjából 120 vendég fogadására alkalmas.",
    blurb_en:
      "A welcoming restaurant and wedding venue in Balf with views across the Fertő landscape. Its panoramic terrace and dining spaces suit intimate dinners, ceremonies, and medium-sized receptions. Public venue information indicates room for approximately 120 guests.",
    website: "https://balfpanorama.hu/",
    contact_email: "balf@t-online.hu",
    contact_phone: "+36 99 339 141",
    contact_phone_alt: null,
    venue_style: "restaurant",
    price_band: null,
    capacity_min: null,
    capacity_max: 120,
    gallery_urls: [
      "https://fw.photos/QmMou2IUUC1y2NM_lYsTdrQNPgg%3D/600x401/https%3A%2F%2Fwww.fertotaj.hu%2Fuploads%2Ffiles%2F277795888_400614918733338_5394431349370617369_n.jpg",
      "https://assets.steadyhq.com/production/post/72c87d1d-0d9c-4130-88a8-559b67c74729/uploads/images/y2zr7x7fxs/322991233_1380367772710518_4890359772420098780_n%281%29.jpg?auto=format&crop=faces&fit=crop&fm=jpg&h=864&w=1536",
    ],
    source: "curated",
  },
  {
    id: "solo-il-grande-sopron",
    name: "Solo Restaurant & Il Grande",
    category: "venue",
    city: "Sopron",
    address: "9400 Sopron, Lackner Kristóf utca 33/A.",
    lat: 47.694842,
    lng: 16.580996,
    blurb_hu:
      "Soproni étterem és nagy rendezvénytér, ahol a Solo gasztronómiája az Il Grande tágas esküvői termével kapcsolódik össze. A modern, városi helyszín vacsorához, zenekarhoz és nagy létszámú lakodalomhoz is jól alakítható. Legnagyobb összeállításában körülbelül 300 vendéget képes fogadni.",
    blurb_en:
      "A Sopron restaurant and large event venue combining Solo's catering with Il Grande's spacious reception hall. The contemporary city setting can be configured for dinner, live music, and larger celebrations. Its largest published setup accommodates approximately 300 guests.",
    website: "https://solorestaurant.hu/",
    contact_email: "solosopron@gmail.com",
    contact_phone: "+36 99 900 901",
    contact_phone_alt: "+36 70 884 1216",
    venue_style: "event_hall",
    price_band: null,
    capacity_min: null,
    capacity_max: 300,
    gallery_urls: [
      "https://www.eskuvoihelyszinkereso.hu/uploads/location/0/423/legszebb.png",
      "https://www.eskuvoihelyszinkereso.hu/uploads/location/0/423/helyszin-kivulrol.png",
    ],
    source: "curated",
  },
  {
    id: "vineyard-wedding-sopron",
    name: "Vineyard Wedding Sopron",
    category: "venue",
    city: "Sopron",
    address: "9400 Sopron, Présház telep (Fényes Pince).",
    lat: 47.679621,
    lng: 16.668113,
    blurb_hu:
      "Szabadtéri esküvőhelyszín a Soproni borvidék szőlősorai között, panorámás szertartási ponttal és rendezvénysátorral. Ötven főig a fedett terasz, nagyobb létszámnál a sátor ad helyet a vacsorának és a táncnak. A rendezvénysátor közzétett befogadóképessége 200 fő.",
    blurb_en:
      "An outdoor wedding venue among the vineyards of the Sopron wine region, with a panoramic ceremony spot and event marquee. The covered terrace serves celebrations of up to 50 guests, while larger receptions move into the marquee. Its published seated capacity is 200 guests.",
    website: "https://eskuvosopron.hu/",
    contact_email: "info@vineyardweddingsopron.hu",
    contact_phone: "+36 20 291 1976",
    contact_phone_alt: null,
    venue_style: "estate",
    price_band: null,
    capacity_min: null,
    capacity_max: 200,
    gallery_urls: [
      "https://eskuvohelyszin.hu/uploads/provider/3498/images/2955302854970445620878767497394268478530593n_-1200x1200x100.jpg",
      "https://eskuvohelyszin.hu/uploads/provider/3498/images/2953841454970628054193852432076275742528008n_-1200x1200x100.jpg",
      "https://eskuvohelyszin.hu/uploads/provider/3498/images/2498972743140711070518902218768257697265153n_-1200x1200x100.jpg",
    ],
    source: "curated",
  },
  {
    id: "fagus-hotel-sopron",
    name: "Fagus Hotel Conference & Spa",
    category: "venue",
    city: "Sopron",
    address: "9400 Sopron, Ojtózi fasor 3.",
    lat: 47.666533,
    lng: 16.580337,
    blurb_hu:
      "Négycsillagos soproni erdei hotel modern rendezvényterekkel, wellnessrészleggel és helyszíni szállással. A különböző termek, teraszok és a zöld környezet egy helyen teszik lehetővé a szertartást, a vacsorát és a násznép elszállásolását. Esküvői rendezvényen a közzétett kapacitás szerint akár 240 vendég fogadható.",
    blurb_en:
      "A four-star forest hotel in Sopron with contemporary event rooms, spa facilities, and on-site accommodation. Its halls, terraces, and green surroundings allow the ceremony, dinner, and guest stay to take place in one location. Published wedding capacity reaches up to 240 guests.",
    website: "https://fagus.adventorhotels.hu/",
    contact_email: "reservation@fagushotel.hu",
    contact_phone: "+36 99 886 010",
    contact_phone_alt: null,
    venue_style: "hotel",
    price_band: null,
    capacity_min: null,
    capacity_max: 240,
    gallery_urls: [
      "https://zcms.hu/fagusadventorhotelshu/img/slider/176ea897ac0db942f8e7ee9539fabd6a.jpg",
      "https://zcms.hu/fagusadventorhotelshu/tartalom/elmenyajanlo/8n1a5934-hdr_2.jpg",
      "https://zcms.hu/fagusadventorhotelshu/img/slider/fe0d0e1142559c115a04aac254db506a.jpg",
    ],
    source: "curated",
  },
];

/** Existing directory rows matched to the same businesses and enriched in place. */
export const HUNGARY_GYOR_VENUE_ENRICHMENTS_2026_09: Record<string, Partial<RawDirectoryEntry>> = {
  "achilles-park-gyor": {
    name: "Achilles Park",
    category: "venue",
    city: "Győr",
    address: "9012 Győr, Gyirmóti Tájvédelmi Körzet.",
    lat: 47.645722,
    lng: 17.6022,
    blurb_hu:
      "Tóparti esküvői helyszín Győr-Gyirmóton, parkos környezettel, saját rendezvényterekkel és szálláslehetőséggel. A vízpart szabadtéri szertartáshoz és fotózáshoz is karakteres hátteret ad, míg a fedett terek rossz időben is biztonságot nyújtanak. A különböző helyszínrészek körülbelül 80–150 fős ünneplésekhez használhatók.",
    blurb_en:
      "A lakeside wedding venue in Győr-Gyirmót with landscaped grounds, dedicated event spaces, and accommodation. The waterfront provides a distinctive setting for outdoor ceremonies and portraits, while covered spaces offer a reliable wet-weather option. Its different areas suit celebrations of approximately 80 to 150 guests.",
    website: "https://www.achilleseskuvo.hu/",
    contact_email: "info@achilles.hu",
    contact_phone: "+36 20 225 1094",
    contact_phone_alt: "+36 96 556 011",
    venue_style: "waterfront",
    capacity_min: 80,
    capacity_max: 150,
    gallery_urls: [
      "https://eskuvohelyszin.hu/uploads/provider/2920/images/120732222_3464008246998102_5276225224684744131_o_-1200x1200x100.jpg",
      "https://queeneskuvo.hu/upload/account/1562/achilles2.jpg",
      "https://topeskuvohelyszinek.hu/wp-content/uploads/achilles-park-eskuvohelyszin-gyor-19.jpg",
    ],
    source: "curated",
  },
  "dudits-kastely": {
    name: "Dudits Kastély",
    category: "venue",
    city: "Sobor",
    address: "9315 Sobor, Kossuth Lajos utca 7.",
    lat: 47.47687,
    lng: 17.37172,
    blurb_hu:
      "Felújított klasszicista kastély Sobor központjában, romantikus parkkal és kizárólagosan bérelhető esküvői terekkel. A történelmi épület és a kert a szertartásnak, vacsorának és fotózásnak is egységes, elegáns hátteret ad. A közzétett teremadatok alapján legfeljebb körülbelül 100 fős esküvőkhöz ajánlható.",
    blurb_en:
      "A restored neoclassical manor in the centre of Sobor, with a romantic park and wedding spaces available for exclusive use. The historic building and garden create one coherent, elegant setting for ceremonies, dinner, and photography. Published room information makes it best suited to weddings of up to roughly 100 guests.",
    website: "https://dudits.eu/",
    contact_email: "dfd@dudits.eu",
    contact_phone: "+36 30 737 7063",
    contact_phone_alt: null,
    venue_style: "castle",
    capacity_min: null,
    capacity_max: 100,
    gallery_urls: [
      "https://eskuvohelyszin.hu/uploads/provider/2101/images/zsofiferieskuvoje0274_-1200x1200x100-1080w.webp",
      "https://eskuvohelyszin.hu/uploads/provider/2101/images/kingaadam12_-1200x1200x100.jpg",
      "https://www.eskuvoihelyszinkereso.hu/uploads/location/0/347/kreativ.png",
    ],
    source: "curated",
  },
  "hu-scale-panorama-birtok-wellness-panzio-konferencia-es-rendezvenykozpont-gyorujbarat-4dc5dc28":
    {
      name: "Panoráma Birtok",
      category: "venue",
      city: "Győrújbarát",
      address: "9081 Győrújbarát, Vendégfogadó utca 4.",
      blurb_hu:
        "Panorámás domboldali esküvői birtok Győrújbaráton, rendezvénytermekkel, wellnesszel és nagy kapacitású helyszíni szállással. A fő rendezvényterem ültetve körülbelül 140 főt, a kisebb villa pedig mintegy 80 főt fogad. A természetközeli környezetben a szertartás, a vacsora és a vendégek elszállásolása is egy helyen szervezhető. A teraszok és a tájra nyíló kilátás kültéri programokhoz és fotózáshoz is karakteres hátteret adnak.",
      blurb_en:
        "A panoramic hillside wedding estate in Győrújbarát with event halls, wellness facilities, and substantial on-site accommodation. The main hall seats approximately 140 guests, while the smaller villa suits events of around 80. The ceremony, reception, and guest stay can all be arranged within the same nature-led property. Its terraces and broad landscape views also provide a distinctive setting for outdoor moments and portraits.",
      website: "https://panoramabirtok.hu/",
      venue_style: "venue_with_stay",
      capacity_min: null,
      capacity_max: 140,
      source: "curated",
    },
  "hu-scale-szidonia-kastelyszalloda-rojtokmuzsaj-a1344134": {
    name: "Szidónia Kastélyszálloda",
    category: "venue",
    city: "Röjtökmuzsaj",
    address: "9451 Röjtökmuzsaj, Röjtöki út 37.",
    blurb_hu:
      "Történelmi kastélyszálloda Röjtökmuzsajon, nagy parkkal, elegáns rendezvénytermekkel, wellnesszel és helyszíni szállással. A polgári szertartás a parkban, az ünnepi vacsora pedig a kastély hangulatos belső tereiben is megtartható. A hivatalos rendezvényadatok szerint esküvőn legfeljebb körülbelül 110 vendég fogadható. A kastély és a park együtt egész hétvégés, egy helyszínen maradó ünneplést is lehetővé tesz.",
    blurb_en:
      "A historic castle hotel in Röjtökmuzsaj with extensive parkland, elegant function rooms, spa facilities, and on-site accommodation. Civil ceremonies can take place in the grounds, followed by dinner in the atmospheric interiors. Official event information indicates wedding capacity of up to approximately 110 guests. The castle and park also make it practical to keep a full wedding weekend in one place.",
    website: "https://www.szidonia.hu/hu",
    venue_style: "castle",
    capacity_min: null,
    capacity_max: 110,
    source: "curated",
  },
  "hu-scale-sopronbanfalvi-palos-kesobb-karmelita-kolostor-sopron-b44bb27d": {
    name: "Sopronbánfalvi Kolostor Hotel és Étterem",
    category: "venue",
    city: "Sopron",
    address: "9400 Sopron, Kolostorhegy utca 1.",
    lat: 47.67742,
    lng: 16.552015,
    blurb_hu:
      "Műemléki kolostorból kialakított különleges hotel és étterem Sopron-Bánfalván, erdei környezetben és belső udvarral. A történelmi terek bensőséges szertartásokhoz, vacsorákhoz és teljes hétvégés esküvőkhöz is egyedi hangulatot adnak. A jelenleg közölt éttermi befogadóképesség körülbelül 50 fő, ezért elsősorban kisebb ünneplésekhez illik. A helyszíni szobák révén a pár és a vendégek az esemény után is a kolostorban maradhatnak.",
    blurb_en:
      "A distinctive hotel and restaurant created within a listed former monastery in Sopron-Bánfalva, surrounded by forest and centred on an inner courtyard. Its historic spaces lend a memorable atmosphere to intimate ceremonies, dinners, and full wedding weekends. Current published restaurant capacity is around 50 guests, making it best suited to smaller celebrations. On-site rooms allow the couple and guests to remain at the monastery after the event.",
    website: "https://www.banfalvakolostor.hu/",
    venue_style: "venue_with_stay",
    capacity_min: null,
    capacity_max: 50,
    source: "curated",
  },
};
