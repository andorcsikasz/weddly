// Austrian open-web venue research, August 2026. Every row was checked against
// the venue's own public website: contact details and capacity are only set
// where the venue publishes them, descriptions are original summaries, and
// every gallery URL points back to first-party-hosted wedding imagery.

import type { RawDirectoryEntry } from "./suppliers_data";

const noContact = {
  contact_email: null,
  contact_phone: null,
  lat: null,
  lng: null,
} as const;

export const AUSTRIA_OPEN_WEB_2026_08: RawDirectoryEntry[] = [
  {
    id: "schloss-hof-estate",
    name: "Schloss Hof",
    category: "venue",
    city: "Schloßhof, AT",
    address: "Schloßhof 1, 2294 Schloßhof, Österreich",
    capacity_min: null,
    capacity_max: 970,
    venue_style: "castle",
    blurb_hu:
      "Barockes Schlossensemble im Marchfeld mit Schlosskapelle, Festsaal, historischer Reithalle, Orangerie, Tenne und weitläufigen Gartenterrassen. Je nach Raum reicht das publizierte Veranstaltungsangebot bis zu 970 Bankettgästen.",
    blurb_en:
      "A baroque palace estate in the Marchfeld with a chapel, grand hall, historic riding hall, orangery, barn and extensive garden terraces. Its published event spaces range up to 970 banquet guests, depending on the room.",
    website: "https://www.schlosshof.at/en/events/wedding",
    gallery_urls: [
      "https://www.schlosshof.at/fileadmin/_processed_/2/a/csm_Schloss_Hof_Festsaal_06931__c__Schloss_Schoenbrunn_Kultur-_und_Betriebsges.m.b.H._-_Severin_Wurnig_web_8e6cb9f5a6.jpg",
      "https://www.schlosshof.at/fileadmin/_processed_/0/7/csm_HighEmtionWeddings_7_c_Nikol_Bodnarova_via_High_Emotion_Weddings_90de3dc20b.jpg",
      "https://www.schlosshof.at/fileadmin/_processed_/b/d/csm_HighEmotionWeddings13_c_Nikol_Bodnarova_via_High_Emotion_Weddings_1544871575.jpg",
    ],
    ...noContact,
    contact_email: "office@schlosshof.at",
    contact_phone: "+43 2285 20 000",
    source: "curated",
    price_band: null,
  },
  {
    id: "burg-forchtenstein-wedding",
    name: "Burg Forchtenstein",
    category: "venue",
    city: "Forchtenstein, AT",
    address: "Melinda Esterhazy-Platz 1, 7212 Forchtenstein, Österreich",
    capacity_min: null,
    capacity_max: null,
    venue_style: "castle",
    blurb_hu:
      "Historische Burg über dem Burgenland mit barocker Kapelle, zwei Trauzimmern, Oberer Bastei und gewölbten Keller-Räumen für die Festtafel. Trauung, Sektempfang und Feier können innerhalb der Anlage stattfinden.",
    blurb_en:
      "A historic Burgenland fortress with a baroque chapel, two civil-ceremony rooms, an upper bastion and vaulted cellars for the wedding meal. The ceremony, drinks reception and celebration can all take place within the castle.",
    website:
      "https://esterhazy.at/hochzeit/hochzeitburgforchtenstein/hochzeit-auf-burg-forchtenstein",
    gallery_urls: [
      "https://esterhazy.at/user/images/a-Burg-Forchtenstein/Veranstaltungen/_1200x630_crop_center-center_82_none/190122_Hochzeiten_Artikelbild.jpg?mtime=1687161475",
      "https://www-cdn.esterhazy.at/user/images/Ihr-Event/Burg-Forchtenstein/BuFo-Hochzeitsbilder/Hochzeitsshooting_Burg_Forchtenstein_cRomanHuditsch_5.jpg?width=1536",
      "https://www-cdn.esterhazy.at/user/images/Ihr-Event/Burg-Forchtenstein/BuFo-Hochzeitsbilder/Hochzeitsshooting_Burg_Forchtenstein_cRomanHuditsch_1.jpg?width=1536",
    ],
    ...noContact,
    contact_email: "ausstellung@esterhazy.at",
    contact_phone: "+43 2682 63004 7600",
    source: "curated",
    price_band: null,
  },
  {
    id: "villa-bergzauber-rossleithen",
    name: "Villa Bergzauber",
    category: "venue",
    city: "Roßleithen, AT",
    address: "Roßleithen 31, 4575 Roßleithen, Österreich",
    capacity_min: null,
    capacity_max: 200,
    venue_style: "hotel",
    blurb_hu:
      "Jugendstilvilla von 1900 auf einem drei Hektar großen, parkähnlichen Grundstück mit Festsaal, Gartenzeremonien und Übernachtung vor Ort. Die Villa nennt Platz für bis zu 200 Veranstaltungsgäste und 86 Hotelgäste.",
    blurb_en:
      "A 1900 villa on three hectares of park-like grounds, offering a ballroom, garden ceremonies and accommodation on site. The venue publishes capacity for up to 200 event guests and 86 overnight guests.",
    website: "https://www.villabergzauber.at/de/hochzeiten/",
    gallery_urls: [
      "https://www.villabergzauber.at/assets/bilder/hochzeit/Standesamtl.Trauung_150_Pax_2022.jpg",
      "https://www.villabergzauber.at/assets/bilder/sujets/hochzeiten/hochzeit-sujet-new-003.jpg",
      "https://www.villabergzauber.at/assets/bilder/hochzeit/Trauung_Garten.jpg",
    ],
    ...noContact,
    contact_email: "info@villabergzauber.at",
    contact_phone: "+43 7562 20777",
    source: "curated",
    price_band: null,
  },
  {
    id: "beim-boeckhiasl",
    name: "Beim Böckhiasl",
    category: "venue",
    city: "Neukirchen an der Vöckla, AT",
    address: "Hauptstraße 14, 4872 Neukirchen an der Vöckla, Österreich",
    capacity_min: null,
    capacity_max: 250,
    venue_style: "guesthouse",
    blurb_hu:
      "Oberösterreichischer Hotel-Gasthof mit Wintergarten, Festsaal und Zimmern im Haus. Das Team plant Raum, Menü, Dekoration, Technik und Ablauf gemeinsam mit dem Paar; Hochzeiten sind für bis zu 250 Gäste ausgewiesen.",
    blurb_en:
      "An Upper Austrian hotel and inn with a conservatory, function hall and rooms on site. Its team coordinates the room, menu, decor, equipment and schedule with the couple, for weddings of up to 250 guests.",
    website: "https://www.boeckhiasl.at/hochzeiten-feste/",
    gallery_urls: [
      "https://www.boeckhiasl.at/wp-content/uploads/2024/09/Boeckhiasl_Hochzeiten-Feste_2.jpg",
      "https://www.boeckhiasl.at/wp-content/uploads/2024/09/Boeckhiasl_Hochzeiten-Feste_3.jpg",
      "https://www.boeckhiasl.at/wp-content/uploads/2024/09/Boeckhiasl_Hochzeiten-Feste_4.jpg",
    ],
    ...noContact,
    contact_email: "info@boeckhiasl.at",
    contact_phone: "+43 7682 7106",
    source: "curated",
    price_band: null,
  },
  {
    id: "weingarten-resort-unterlamm",
    name: "Weingarten-Resort Unterlamm Loipersdorf",
    category: "venue",
    city: "Unterlamm, AT",
    address: "Unterlamm 177, 8352 Unterlamm, Österreich",
    capacity_min: null,
    capacity_max: null,
    venue_style: "resort",
    blurb_hu:
      "Adults-only-Chaletresort in den südoststeirischen Weinbergen für intime Hochzeiten und Elopements. Angeboten werden freie oder standesamtliche Trauungen in der Natur, private WeinHÄUSER, regionale Kulinarik und eine persönliche Hochzeitsorganisation ohne Zeitdruck.",
    blurb_en:
      "An adults-only chalet resort in the south-east Styrian vineyards for intimate weddings and elopements. It offers civil or symbolic outdoor ceremonies, private wine chalets, regional food and personal planning without a production-line timetable.",
    website: "https://www.weinurlaub.at/de/hochzeit/",
    gallery_urls: [
      "https://www.weinurlaub.at/(cms)/media/resize/1024x681c/2026173",
      "https://www.weinurlaub.at/(cms)/media/resize/1024x680c/2026169",
      "https://www.weinurlaub.at/(cms)/media/resize/1024x681c/2174657",
    ],
    ...noContact,
    contact_email: "info@weinurlaub.at",
    contact_phone: "+43 676 3565651",
    source: "curated",
    price_band: null,
  },
  {
    id: "schloss-an-der-eisenstrasse",
    name: "Das Schloss an der Eisenstrasse",
    category: "venue",
    city: "Waidhofen an der Ybbs, AT",
    address: "Am Schlossplatz 1, 3340 Waidhofen an der Ybbs, Österreich",
    capacity_min: 2,
    capacity_max: 300,
    venue_style: "hotel",
    blurb_hu:
      "Schlosshotel im Mostviertel mit Restaurant für kleine Feiern, YbbSalon bis 60 Personen und großem, 600 m² umfassendem Festsaal bis 300 Gäste. Terrasse, hauseigene Küche sowie 90 Zimmer und Suiten ergänzen das Hochzeitsangebot.",
    blurb_en:
      "A Mostviertel castle hotel ranging from intimate restaurant celebrations to the YbbSalon for 60 and a 600-square-metre grand ballroom for up to 300 guests. A terrace, in-house kitchen and 90 rooms and suites complete the wedding setup.",
    website: "https://www.schlosseisenstrasse.at/de/hochzeitslocation-niederoesterreich/",
    gallery_urls: [
      "https://www.schlosseisenstrasse.at/(cms)/media/resize/1920x1080c,q70i/2522647",
      "https://www.schlosseisenstrasse.at/%28cms%29/media/resize/960x640c%2Cq70i/3253211",
      "https://www.schlosseisenstrasse.at/%28cms%29/media/resize/1500x1000c%2Cq70i/3350923",
    ],
    ...noContact,
    contact_email: "event@schlosseisenstrasse.at",
    contact_phone: "+43 7442 525 48",
    source: "curated",
    price_band: null,
  },
  {
    id: "wallhof-schwertberg",
    name: "Wallhof",
    category: "venue",
    city: "Schwertberg, AT",
    address: "Doppl 16, 4311 Schwertberg, Österreich",
    capacity_min: 40,
    capacity_max: 120,
    venue_style: "estate",
    blurb_hu:
      "Liebevoll renovierter, rund 900 Jahre alter Hof mit 200 m² großem Gewölbesaal für 40 bis 120 Hochzeitsgäste, Stadel, Trauwiese, Obstgarten und Terrasse. Der Hof ist barrierefrei, lässt freie Caterer zu und reserviert nur eine Hochzeit pro Wochenende.",
    blurb_en:
      "A carefully restored, roughly 900-year-old farm with a 200-square-metre vaulted hall for 40 to 120 wedding guests, a barn, ceremony lawn, orchard and terrace. It is accessible, allows an outside caterer and hosts only one wedding per weekend.",
    website: "https://www.wallhof.at/weddinglocation",
    gallery_urls: [
      "https://static.wixstatic.com/media/dd6263_531fadef5efa4503b707aa2b800ea53e~mv2.jpg",
      "https://static.wixstatic.com/media/5c3680_33f7a12c5cd3452fb5836b6bff8b5e02~mv2.jpg/v1/fill/w_1280,h_853,al_c,q_85,enc_avif,quality_auto/image.jpg",
      "https://static.wixstatic.com/media/5c3680_943e82a78b464545991096bca975b51a~mv2.jpg/v1/fill/w_1280,h_853,al_c,q_85,enc_avif,quality_auto/image.jpg",
    ],
    ...noContact,
    contact_email: "hochzeit@wallhof.at",
    contact_phone: "+43 699 18296889",
    contact_phone_alt: "+43 676 9285095",
    source: "curated",
    price_band: null,
  },
  {
    id: "fuerstbergergut",
    name: "Fürstbergergut",
    category: "venue",
    city: "Rohr im Kremstal, AT",
    address: "Oberrohr 9, 4532 Rohr im Kremstal, Österreich",
    capacity_min: null,
    capacity_max: null,
    venue_style: "estate",
    blurb_hu:
      "1836 erbauter und umfassend renovierter Vierkanthof mit historischem Gewölberaum, Bar, Innenhof und Garten für freie Trauungen. Das Brautpaar kann vor Ort übernachten, und die Feier darf ungestört bis in die frühen Morgenstunden dauern.",
    blurb_en:
      "An extensively restored 1836 farmstead with a historic vaulted room, bar, courtyard and garden for outdoor ceremonies. The couple can stay overnight on site, and celebrations may continue undisturbed into the early morning.",
    website: "https://fuerstbergergut.at/",
    gallery_urls: [
      "https://fuerstbergergut.at/wp-content/uploads/2021/02/WOV5385.jpg",
      "https://fuerstbergergut.at/wp-content/uploads/2021/02/DSC1029.JPG-1024x685.jpeg",
      "https://fuerstbergergut.at/wp-content/uploads/2021/02/WOV5384-1-1024x683.jpg",
    ],
    ...noContact,
    contact_email: "info@fuerstbergergut.at",
    contact_phone: "+43 670 5545468",
    source: "curated",
    price_band: null,
  },
  {
    id: "rooftop-7301",
    name: "Rooftop 7301",
    category: "venue",
    city: "Deutschkreutz, AT",
    address: "Rotweinweg 1, 7301 Deutschkreutz, Österreich",
    capacity_min: null,
    capacity_max: null,
    venue_style: "estate",
    blurb_hu:
      "Moderne Eventlocation im Weingut K+K Kirnbauer mit Dachterrasse, Panoramablick und mediterranem Interieur. Freie Trauungen im Weingarten, Agape und Feier im Rooftop lassen sich mit dem hauseigenen Eventteam planen.",
    blurb_en:
      "A modern event venue at the K+K Kirnbauer winery, with a roof terrace, panoramic views and Mediterranean interiors. Vineyard ceremonies, drinks receptions and the rooftop celebration can be planned with its in-house events team.",
    website: "https://www.rooftop7301.at/",
    gallery_urls: [
      "https://www.rooftop7301.at/wp-content/uploads/2023/01/rooftop-veranstaltunglocation-im-burgenland.jpg",
      "https://www.rooftop7301.at/wp-content/uploads/2022/09/rooftop7301_005.jpg",
      "https://www.rooftop7301.at/wp-content/uploads/2022/09/rooftop7301_029.jpg",
    ],
    ...noContact,
    contact_email: "office@rooftop7301.at",
    contact_phone: "+43 664 200 32 21",
    contact_phone_alt: "+43 2613 897 22",
    source: "curated",
    price_band: null,
  },
  {
    id: "schloss-gurhof",
    name: "Schloss Gurhof",
    category: "venue",
    city: "Gansbach, AT",
    address: "Gurhof 1, 3122 Gansbach, Österreich",
    capacity_min: null,
    capacity_max: 350,
    venue_style: "castle",
    blurb_hu:
      "Exklusiv buchbares Schloss zwischen Wachau und St. Pölten mit modernisiertem Festsaal, Orangerie, Terrasse, Kapelle, Rosenpavillon und Schlosspark. Hochzeiten sind bis 350 Gäste möglich; 15 Zimmer stehen direkt im Schloss zur Verfügung.",
    blurb_en:
      "An exclusive-use castle between the Wachau and St Pölten with a modernised ballroom, orangery, terrace, chapel, rose pavilion and park. Weddings can host up to 350 guests, with 15 rooms available in the castle itself.",
    website: "https://schloss-gurhof.at/weddings/",
    gallery_urls: [
      "https://schloss-gurhof.at/wp-content/uploads/2023/08/JenniferGruenauerFotografie_Wedding_Jungle-313-scaled-1.jpg",
      "https://schloss-gurhof.at/wp-content/uploads/2023/08/Hero-polas.png",
      "https://schloss-gurhof.at/wp-content/uploads/2023/08/DSC00509-scaled-1.jpg",
    ],
    ...noContact,
    contact_email: "info@schloss-gurhof.at",
    contact_phone: "+43 664 882 148 17",
    source: "curated",
    price_band: null,
  },
];
