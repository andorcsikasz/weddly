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
};
