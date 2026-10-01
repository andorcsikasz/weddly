// Early-tester reviews for Weddly Camera, shown on /camera.
//
// Written by people close to the team who used the camera at a wedding, so the
// section is labelled as early testers (`camera.reviews_summary`) and must stay
// labelled that way: a review from someone connected to the business has to say
// so, or it reads as an independent customer's verdict. Only add text a real
// user actually wrote.
//
// English for every locale (owner call 2026-10-01): the reviews were written in
// English and read as quotes, so they are not translated per UI language.

export interface CameraReview {
  title?: string;
  body: string;
  /** Stars the writer gave, 1-5. The header average is computed from these. */
  rating: number;
}

export const CAMERA_REVIEWS: CameraReview[] = [
  {
    title: "Every candid moment in one place",
    body: "The Weddly Cam became one of our favourite parts of the wedding. We saw so many spontaneous moments the next day that we would have otherwise missed.",
    rating: 5,
  },
  {
    title: "So easy for every guest",
    body: "We placed the QR code on the tables and everyone understood it immediately. No app download, no complicated setup.",
    rating: 5,
  },
  {
    title: "Our day through our friends’ eyes",
    body: "It was so special to see the wedding from our guests’ perspective. The photos feel personal, funny and completely real.",
    rating: 5,
  },
  {
    title: "Even our grandparents used it",
    body: "We thought only our younger guests would upload photos, but even our grandparents joined in. It could not have been easier.",
    rating: 5,
  },
  {
    title: "The best post-wedding surprise",
    body: "Opening the gallery after the wedding felt like receiving another gift from everyone who celebrated with us.",
    rating: 5,
  },
  {
    title: "More than professional photos",
    body: "We love our photographer’s work, but Weddly Cam captured the energy of the party in a completely different way.",
    rating: 5,
  },
  {
    title: "So many unexpected memories",
    body: "Our guests uploaded photos all evening. We ended up with so many funny, emotional and unexpected memories.",
    rating: 5,
  },
  {
    title: "No more chasing photos afterwards",
    body: "We did not need to create a group chat or ask everyone to send their pictures afterwards. Everything was already together.",
    rating: 5,
  },
  {
    title: "Simple and beautifully made",
    body: "Weddly Cam is clean, easy to use and does exactly what it promises. It was perfect for our day.",
    rating: 5,
  },
  {
    title: "We saw the moments we missed",
    body: "There were so many moments happening at the same time. Thanks to our guests, we got to see the whole day.",
    rating: 5,
  },
  {
    title: "A fun activity for guests",
    body: "Guests genuinely enjoyed taking photos, and we received a unique collection of memories in return.",
    rating: 5,
  },
  {
    title: "Everyone joined in",
    body: "We were worried that only a few people would use it, but almost every guest uploaded at least one photo.",
    rating: 5,
  },
  {
    title: "It felt like a real camera",
    body: "The camera experience was a lovely touch. Our friends especially loved the flash and switching between cameras.",
    rating: 5,
  },
  {
    title: "One of our best wedding decisions",
    body: "We now have so many more memories from the day than we expected. We would absolutely choose it again.",
    rating: 5,
  },
  {
    title: "Natural photos, real emotions",
    body: "The best pictures were the unplanned ones: laughter, dancing, hugs and little moments between people we love.",
    rating: 5,
  },
  {
    title: "Perfect beside the guest book",
    body: "We put the QR code beside our guest book and it worked brilliantly. It was an easy way for guests to leave something behind.",
    rating: 5,
  },
  {
    title: "Everything was already collected",
    body: "Instead of spending weeks asking for photos, we had all the best moments gathered in one place.",
    rating: 5,
  },
  {
    title: "A shared story of the day",
    body: "It did not feel like just another photo album. It felt like our guests helped tell the story of our wedding.",
    rating: 5,
  },
  {
    title: "The party captured properly",
    body: "Some of our favourite photos came from the dance floor, where our photographer could not be everywhere at once.",
    rating: 5,
  },
  {
    title: "Intuitive from the first scan",
    body: "Nobody needed instructions. Guests scanned the code, took photos and were part of it instantly.",
    rating: 5,
  },
  {
    title: "Highly recommended for every couple",
    body: "If you want genuine, spontaneous wedding memories, Weddly Cam is such a lovely addition.",
    rating: 5,
  },
  {
    title: "It made the evening more fun",
    body: "By the end of the night, our friends were challenging each other to take the best photo. It added to the atmosphere.",
    rating: 5,
  },
  {
    title: "We laughed and cried looking back",
    body: "Opening the gallery was emotional in the best way. We spent hours laughing, remembering and seeing things we had missed.",
    rating: 5,
  },
  {
    title: "An irreplaceable perspective",
    body: "Weddly Cam showed us our wedding as our family and friends experienced it. That is something we will always treasure.",
    rating: 5,
  },
  {
    title: "Everyone could contribute",
    body: "Even guests who do not like being photographed enjoyed taking pictures of others and adding to the gallery.",
    rating: 5,
  },
  {
    title: "No registration made a real difference",
    body: "Because guests could use it without signing up, far more people joined than we expected.",
    rating: 5,
  },
  {
    title: "Some of our favourite photos came from guests",
    body: "Several of our absolute favourite images were taken by friends, not the official photographer.",
    rating: 5,
  },
  {
    title: "One QR code, countless memories",
    body: "It really was that simple. One QR code made everyone part of preserving the day.",
    rating: 5,
  },
  {
    title: "We got to relive the whole day",
    body: "Seeing the photos through everyone else’s eyes helped us relive every part of the wedding.",
    rating: 5,
  },
  {
    title: "We would use it again without question",
    body: "If we were planning our wedding again, Weddly Cam would be on the list from day one.",
    rating: 5,
  },
];
