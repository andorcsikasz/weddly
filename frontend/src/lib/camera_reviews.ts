// Early-tester reviews for Weddly Camera, shown on /camera.
//
// Written by people close to the team who used the camera at a wedding, so the
// section is labelled as early testers (`camera.reviews_eyebrow`) and must stay
// labelled that way: a review from someone connected to the business has to say
// so, or it reads as an independent customer's verdict. Only add text a real
// user actually wrote.
//
// HU readers get the Hungarian set, everyone else the English one (which also
// carries a title per review).

export interface CameraReview {
  title?: string;
  body: string;
}

export const CAMERA_REVIEWS_EN: CameraReview[] = [
  {
    title: "Every candid moment in one place",
    body: "The Weddly Cam became one of our favourite parts of the wedding. We saw so many spontaneous moments the next day that we would have otherwise missed.",
  },
  {
    title: "So easy for every guest",
    body: "We placed the QR code on the tables and everyone understood it immediately. No app download, no complicated setup.",
  },
  {
    title: "Our day through our friends’ eyes",
    body: "It was so special to see the wedding from our guests’ perspective. The photos feel personal, funny and completely real.",
  },
  {
    title: "Even our grandparents used it",
    body: "We thought only our younger guests would upload photos, but even our grandparents joined in. It could not have been easier.",
  },
  {
    title: "The best post-wedding surprise",
    body: "Opening the gallery after the wedding felt like receiving another gift from everyone who celebrated with us.",
  },
  {
    title: "More than professional photos",
    body: "We love our photographer’s work, but Weddly Cam captured the energy of the party in a completely different way.",
  },
  {
    title: "So many unexpected memories",
    body: "Our guests uploaded photos all evening. We ended up with so many funny, emotional and unexpected memories.",
  },
  {
    title: "No more chasing photos afterwards",
    body: "We did not need to create a group chat or ask everyone to send their pictures afterwards. Everything was already together.",
  },
  {
    title: "Simple and beautifully made",
    body: "Weddly Cam is clean, easy to use and does exactly what it promises. It was perfect for our day.",
  },
  {
    title: "We saw the moments we missed",
    body: "There were so many moments happening at the same time. Thanks to our guests, we got to see the whole day.",
  },
  {
    title: "A fun activity for guests",
    body: "Guests genuinely enjoyed taking photos, and we received a unique collection of memories in return.",
  },
  {
    title: "Everyone joined in",
    body: "We were worried that only a few people would use it, but almost every guest uploaded at least one photo.",
  },
  {
    title: "It felt like a real camera",
    body: "The camera experience was a lovely touch. Our friends especially loved the flash and switching between cameras.",
  },
  {
    title: "One of our best wedding decisions",
    body: "We now have so many more memories from the day than we expected. We would absolutely choose it again.",
  },
  {
    title: "Natural photos, real emotions",
    body: "The best pictures were the unplanned ones: laughter, dancing, hugs and little moments between people we love.",
  },
  {
    title: "Perfect beside the guest book",
    body: "We put the QR code beside our guest book and it worked brilliantly. It was an easy way for guests to leave something behind.",
  },
  {
    title: "Everything was already collected",
    body: "Instead of spending weeks asking for photos, we had all the best moments gathered in one place.",
  },
  {
    title: "A shared story of the day",
    body: "It did not feel like just another photo album. It felt like our guests helped tell the story of our wedding.",
  },
  {
    title: "The party captured properly",
    body: "Some of our favourite photos came from the dance floor, where our photographer could not be everywhere at once.",
  },
  {
    title: "Intuitive from the first scan",
    body: "Nobody needed instructions. Guests scanned the code, took photos and were part of it instantly.",
  },
  {
    title: "Highly recommended for every couple",
    body: "If you want genuine, spontaneous wedding memories, Weddly Cam is such a lovely addition.",
  },
  {
    title: "It made the evening more fun",
    body: "By the end of the night, our friends were challenging each other to take the best photo. It added to the atmosphere.",
  },
  {
    title: "We laughed and cried looking back",
    body: "Opening the gallery was emotional in the best way. We spent hours laughing, remembering and seeing things we had missed.",
  },
  {
    title: "An irreplaceable perspective",
    body: "Weddly Cam showed us our wedding as our family and friends experienced it. That is something we will always treasure.",
  },
  {
    title: "Everyone could contribute",
    body: "Even guests who do not like being photographed enjoyed taking pictures of others and adding to the gallery.",
  },
  {
    title: "No registration made a real difference",
    body: "Because guests could use it without signing up, far more people joined than we expected.",
  },
  {
    title: "Some of our favourite photos came from guests",
    body: "Several of our absolute favourite images were taken by friends, not the official photographer.",
  },
  {
    title: "One QR code, countless memories",
    body: "It really was that simple. One QR code made everyone part of preserving the day.",
  },
  {
    title: "We got to relive the whole day",
    body: "Seeing the photos through everyone else’s eyes helped us relive every part of the wedding.",
  },
  {
    title: "We would use it again without question",
    body: "If we were planning our wedding again, Weddly Cam would be on the list from day one.",
  },
];

export const CAMERA_REVIEWS_HU: CameraReview[] = [
  "A Weddly Cam lett az egyik kedvenc emlékünk az esküvőnkről. Másnap annyi spontán, őszinte pillanatot láttunk vissza, amiről nem is tudtunk.",
  "A QR-kódot kiraktuk az asztalokra, és a vendégek azonnal értették, mit kell csinálni. Nem kellett appot letölteniük.",
  "Sokkal személyesebb képeket kaptunk, mint amire számítottunk. A barátaink szemszögéből láttuk újra a napot.",
  "A nagyszüleink is egyszerűen tudták használni, ez szerintem mindent elmond. Beolvasták, fotóztak, kész.",
  "Imádtuk, hogy a galéria csak az esküvő után nyílt meg. Olyan volt, mintha még egy ajándékot kapnánk a vendégeinktől.",
  "A profi fotós képei gyönyörűek, de a Weddly Cam adta vissza igazán a buli hangulatát.",
  "A vendégeink folyamatosan küldték a képeket egész este. Rengeteg vicces, megható és teljesen váratlan pillanat került bele.",
  "Nagyon jó, hogy nem kellett külön fotómegosztó csoportot kezelni Messengeren vagy WhatsAppon.",
  "A Weddly Cam egyszerű, szép és tényleg működik. Pont erre volt szükségünk.",
  "Külön öröm volt látni azokat a pillanatokat, amikor mi épp máshol voltunk. A készülődésről és a vacsoráról is rengeteg kép lett.",
  "A vendégeknek szórakoztató program volt, nekünk pedig egy teljesen egyedi emlékgyűjtemény.",
  "Attól féltünk, hogy kevesen fogják használni, de végül szinte mindenki feltöltött legalább egy képet.",
  "A telefonos kameraélmény nagyon jópofa volt, főleg a fiatalabb vendégek imádták a vaku és a kameraváltás funkcióját.",
  "Az egyik legjobb döntésünk volt az esküvőre. Sokkal több közös emlékünk maradt így.",
  "A képek sokkal természetesebbek lettek, mint a beállított fotók. Igazi nevetések, táncok és ölelések.",
  "A QR-kódot a vendégkönyv mellé tettük, és tökéletesen működött. Mindenki hozzá tudott tenni valamit a napunkhoz.",
  "Végre nem kellett utólag heteken át kérdezgetni a vendégeket, hogy küldjék át a képeiket.",
  "Nagyon tetszett, hogy nem csak egy fotóalbum lett, hanem egy közös történet a teljes napról.",
  "A Weddly Cam miatt olyan fotóink is lettek a buliról, amiket a fotós biztosan nem tudott volna elkapni.",
  "Letisztult, gyors és intuitív. A vendégeinknek nem kellett semmit magyarázni.",
  "Minden párnak ajánlanám, aki nem csak szép, hanem valódi, spontán esküvői emlékeket szeretne.",
  "A lagzi végére már versenyeztek a barátaink, ki készít jobb képet. Nagyon feldobta a hangulatot.",
  "A galéria megnyitása után órákig nézegettük a képeket. Rengeteget nevettünk és párszor meg is hatódtunk.",
  "A Weddly Cam megmutatta az esküvőnket úgy, ahogy a vendégeink megélték. Ez felbecsülhetetlen.",
  "Még azokat a vendégeket is bevonta, akik nem szeretnek szerepelni a kamerák előtt. Nekik is volt kedvük megörökíteni másokat.",
  "Kifejezetten jó volt, hogy a vendégek regisztráció nélkül használhatták. Ettől tényleg sokkal többen csatlakoztak.",
  "A legjobb képeink közül több nem is a hivatalos fotóstól, hanem a Weddly Camből érkezett.",
  "Egyetlen QR-kód, és máris mindenki részese lett az emlékgyűjtésnek. Ennyire egyszerű.",
  "Nem gondoltuk volna, mennyit jelent majd visszanézni a napot a családunk és a barátaink szemén keresztül.",
  "Ha újra szerveznénk az esküvőnket, a Weddly Camet biztosan újra kérnénk. A nap után is továbbadja az élményt.",
].map((body) => ({ body }));
