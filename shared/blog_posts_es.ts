// Spanish copy for every seeded blog post, keyed by the post's canonical
// (Hungarian) slug. Read by `SEED_TRANSLATIONS` in blog_posts.ts, written
// into the `es_*` columns by the boot seeder, and served to any reader whose
// UI locale is Español.
//
// Translated from the English original rather than the Hungarian, because
// the English version is the internationally framed one: it already drops
// the Hungary-only asides that only make sense to a reader in Budapest.
// Where a post IS about Hungary (the paperwork guide, the three
// "where-to-get-married" travel pieces) the country stays in — a Spanish
// reader marrying in Hungary is precisely who that article is for.

import type { BlogTranslationsBySlug } from "./blog_posts";

export const BLOG_POSTS_ES: BlogTranslationsBySlug = {
  "eskuvoi-rsvp-kerdesek": {
    category: "RSVP",
    title: "RSVP de boda: qué preguntar para que las respuestas sigan siendo manejables",
    lead: "Qué preguntas poner en el formulario de respuesta para que sea fácil para los invitados y útil para vosotros.",
    seo_title: "Preguntas del RSVP de boda · Weddly",
    seo_description:
      "Guía del RSVP de boda: qué preguntar, por qué menos campos significan más respuestas y cómo aprovechar lo que recopiláis.",
    body: [
      {
        type: "p",
        text: "El RSVP parece sencillo: queréis saber quién viene. En la práctica, las respuestas traen el número final de invitados, la elección de menú, los acompañantes y un puñado de detalles que necesitaréis durante el resto de la organización.",
      },
      {
        type: "p",
        text: "El mejor formulario de RSVP es corto, se lee bien en el móvil y solo pregunta lo que de verdad vais a usar.",
      },
      { type: "h2", text: "1. ¿Vienes o no?" },
      {
        type: "p",
        text: "Ponedlo lo primero. No lo escondáis bajo un preámbulo largo. El invitado tiene que ver de inmediato qué se le pregunta.",
      },
      { type: "p", text: "Ejemplo: «¿Nos acompañas?»" },
      { type: "ul", items: ["Sí, allí estaré.", "Lo siento, no podré ir."] },
      { type: "h2", text: "2. Acompañante" },
      {
        type: "p",
        text: "Si los acompañantes son bienvenidos, decidlo con claridad en el formulario. Si solo algunos invitados pueden traer a alguien, un enlace personal por invitado evita sin ruido el momento incómodo de que aparezca un amigo con quien no contabais.",
      },
      { type: "p", text: "Ejemplo: «¿Vienes con acompañante?»" },
      { type: "h2", text: "3. Menú y necesidades alimentarias" },
      {
        type: "p",
        text: "La cocina necesita saber pronto con qué contar, así que preguntad por la elección de menú y por cualquier necesidad alimentaria en la misma pregunta.",
      },
      { type: "p", text: "Ejemplo: «¿Tienes alguna necesidad o restricción alimentaria?»" },
      {
        type: "p",
        text: "Dejad un campo de texto libre: no todas las necesidades caben en una opción predefinida.",
      },
      { type: "h2", text: "4. Extras opcionales" },
      { type: "p", text: "No os paséis, pero algunos extras pueden ser útiles:" },
      {
        type: "ul",
        items: [
          "¿Necesitas transporte?",
          "¿Necesitas información sobre alojamiento?",
          "¿Alguna canción que quieras pedir?",
          "¿Algo más que debamos saber por adelantado?",
        ],
      },
      { type: "h2", text: "5. No preguntéis demasiado" },
      {
        type: "p",
        text: "Un RSVP largo se deja para luego. Uno bueno se responde en menos de un minuto, incluso desde el móvil en la parada del autobús.",
      },
      {
        type: "p",
        text: "En Weddly cada invitado recibe su propio enlace de RSVP, y todo lo que responde llega directamente a vuestra lista de invitados, sin copiar y pegar desde un formulario compartido.",
      },
      {
        type: "cta",
        lead: "Montad un RSVP sencillo en Weddly y recoged cada respuesta, menú, acompañante y nota en un mismo sitio.",
        href: "/signup",
        label: "Empezar a planificar",
      },
    ],
  },
  "eskuvoi-vendeglista-keszitese": {
    category: "Lista de invitados",
    title: "Cómo hacer una lista de invitados de boda que no se descontrole",
    lead: "Cómo reunir nombres, acompañantes, confirmaciones, menús y necesidades alimentarias en un solo sitio.",
    seo_title: "Lista de invitados de boda · Weddly",
    seo_description:
      "Lista de invitados sin estrés: cómo reunir nombres, acompañantes, RSVP, menús y necesidades alimentarias en un solo sitio.",
    body: [
      {
        type: "p",
        text: "La lista de invitados es uno de los cimientos de la organización y también lo primero que suele dispersarse: una hoja de cálculo aquí, unas notas allá, dos conversaciones de chat. Uno ha contestado, otro no. Uno quiere traer acompañante, otro necesita menú vegetariano, un tercero todavía no lo sabe.",
      },
      { type: "p", text: "Ese es el caos que conviene evitar desde el principio." },
      { type: "h2", text: "1. Anotad más que nombres" },
      {
        type: "p",
        text: "Una buena lista de invitados no es un listado de nombres. De cada invitado guardad:",
      },
      {
        type: "ul",
        items: [
          "nombre completo",
          "estado de la invitación",
          "respuesta al RSVP",
          "acompañante",
          "elección de menú",
          "alergias / necesidades alimentarias",
          "mesa",
          "notas",
        ],
      },
      {
        type: "p",
        text: "Os ahorra rebuscar en Messenger o en el correo la última semana para recordar quién escribió qué.",
      },
      { type: "h2", text: "2. Llevad un RSVP claro" },
      {
        type: "p",
        text: "«Ya nos lo dirán en persona» casi nunca funciona. Es mucho más fácil cuando cada invitado tiene un enlace de RSVP personal que puede responder en menos de un minuto.",
      },
      { type: "p", text: "Un buen formulario solo pide lo que de verdad necesitáis:" },
      {
        type: "ul",
        items: [
          "si vienes",
          "si traes acompañante",
          "elección de menú",
          "necesidades alimentarias",
          "cualquier otra cosa que debamos saber",
        ],
      },
      { type: "p", text: "Cuanto más corto es el formulario, antes llegan las respuestas." },
      { type: "h2", text: "3. Resolved pronto los acompañantes" },
      {
        type: "p",
        text: "Los acompañantes son donde más se descuadra todo. Decidid desde el principio quién puede traer a alguien y mantened la línea, aunque un par de conversaciones se vuelvan incómodas.",
      },
      {
        type: "p",
        text: "No es solo una cuestión de presupuesto. Cada acompañante es una silla más, un menú más y a veces otra disposición de mesas.",
      },
      { type: "h2", text: "4. Conectadla con la distribución de mesas" },
      {
        type: "p",
        text: "La información de la lista de invitados sirve de verdad cuando no está separada de las mesas. Si alguien cancela, añade acompañante o indica una necesidad alimentaria, el plano de mesas debería reflejarlo.",
      },
      {
        type: "p",
        text: "Ayuda mucho que la lista de invitados, los RSVP y las mesas vivan juntos: una cancelación o una alergia nueva solo hay que anotarla una vez. (Por eso construimos Weddly así.)",
      },
      { type: "h2", text: "Checklist breve" },
      {
        type: "ul",
        items: [
          "Un estado para cada invitado.",
          "Anotad la respuesta del RSVP por separado.",
          "Decidid pronto los acompañantes.",
          "Recoged menús y alergias en el mismo flujo.",
          "Conectad las mesas con la lista de invitados.",
        ],
      },
      {
        type: "cta",
        lead: "Weddly mantiene la lista de invitados, los RSVP, los acompañantes, los menús y las mesas en un mismo espacio de trabajo.",
        href: "/signup",
        label: "Empezar a planificar",
      },
    ],
  },
};
