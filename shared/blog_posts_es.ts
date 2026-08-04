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
  "eskuvoi-ultetesi-rend-keszitese": {
    category: "Distribución de mesas",
    title: "Cómo diseñar un plano de mesas lógico y listo para imprimir",
    lead: "Qué tener en cuenta con las familias, los amigos, los niños y la impresión.",
    seo_title: "Plano de mesas para la boda · Weddly",
    seo_description:
      "Cómo planificar una distribución de mesas que resista a las familias, los amigos, los niños y los cambios de última hora, y que se imprima bien.",
    body: [
      {
        type: "p",
        text: "La distribución de mesas suele aparecer en las últimas semanas antes de la boda, aunque condiciona muchas decisiones. ¿Quién se sienta en la mesa presidencial? ¿Dónde van las familias? ¿Los grupos de amigos deben quedarse juntos? ¿Y los invitados que no conocen a nadie?",
      },
      {
        type: "p",
        text: "Un plano de mesas bien pensado no es solo bonito: hace el día más fácil, sin ruido, a vuestros invitados, al equipo del sitio y a vosotros dos.",
      },
      { type: "h2", text: "1. No lo cerréis demasiado pronto" },
      {
        type: "p",
        text: "Planificad pronto, pero no lo deis por definitivo hasta que hayan llegado suficientes confirmaciones. Si muchos invitados están en duda, el plano cambiará una y otra vez.",
      },
      { type: "p", text: "Empezad por grupos a nivel de mesa:" },
      {
        type: "ul",
        items: [
          "familia cercana",
          "familia extensa",
          "amigos",
          "compañeros de trabajo",
          "familias con niños",
          "invitados mayores",
        ],
      },
      {
        type: "p",
        text: "Cuando esos grupos encajen, ya podéis pasar a quién se sienta exactamente dónde.",
      },
      { type: "h2", text: "2. Respetad el espacio del sitio" },
      {
        type: "p",
        text: "La posición importa: la pista de baile, la barra, la entrada, el grupo de música. Los invitados mayores prefieren los rincones tranquilos. Los grupos de amigos van cerca de la pista.",
      },
      {
        type: "p",
        text: "Un buen plano no trata solo de quién se sienta al lado de quién: también piensa en dónde se sentirá cada uno más a gusto dentro de la sala.",
      },
      { type: "h2", text: "3. Acertad con la versión impresa" },
      {
        type: "p",
        text: "La distribución de mesas no termina en la pantalla. Seguramente necesitaréis:",
      },
      {
        type: "ul",
        items: [
          "un panel grande en la entrada",
          "números de mesa",
          "tarjetas de sitio",
          "una lista útil para el catering",
          "una copia de mano para el equipo del día",
        ],
      },
      {
        type: "p",
        text: "Por eso conviene pensar pronto en cómo se verá una vez impreso y colgado.",
      },
      { type: "h2", text: "4. Contad con los cambios de última hora" },
      {
        type: "p",
        text: "Siempre hay alguien que cancela la última semana, o que confirma después de estar en duda. Si el plano solo vive en un PDF dibujado a mano, cada cambio duele.",
      },
      {
        type: "p",
        text: "Justo por eso hicimos así el lienzo de mesas de Weddly: arrastráis a un invitado, lo soltáis en otro sitio, y cuando queráis se imprime en A4, A6 o A3.",
      },
      { type: "h2", text: "Checklist breve" },
      {
        type: "ul",
        items: [
          "Primero agrupad, después sentad.",
          "Cerradlo cuando los RSVP se asienten.",
          "Usad el plano real de la sala.",
          "Pensad la versión impresa.",
          "Dejad margen para cambios tardíos.",
        ],
      },
      {
        type: "cta",
        lead: "Diseñad las mesas visualmente en Weddly y exportad a A4 / A6 / A3 para el panel de entrada, las tarjetas de sitio y la carpeta del coordinador.",
        href: "/signup",
        label: "Probarlo",
      },
    ],
  },
  "eskuvoszervezesi-checklist-12-honapra": {
    category: "Planificación",
    title: "Checklist de boda a 12 meses: qué resolver y cuándo",
    lead: "Paso a paso: qué cerrar un año, seis meses y un mes antes de la boda.",
    seo_title: "Checklist de boda a 12 meses · Weddly",
    seo_description:
      "Checklist práctica de 12 meses: qué resolver un año, nueve meses, seis, tres, uno y una semana antes de la boda.",
    body: [
      {
        type: "p",
        text: "Organizar una boda solo abruma cuando todo cae encima a la vez. Sitio, lista de invitados, fotografía, música, invitaciones, ropa, mesas, menú, decoración, papelería. Es fácil perder el hilo.",
      },
      {
        type: "p",
        text: "La buena noticia: no hay que resolverlo de una sentada. Por oleadas, todo se vuelve mucho más tranquilo.",
      },
      { type: "h2", text: "12 meses antes" },
      { type: "p", text: "Este es el momento de las decisiones grandes." },
      {
        type: "ul",
        items: [
          "elegir la fecha",
          "decidir el estilo",
          "esbozar un presupuesto",
          "estimar el número de invitados",
          "buscar sitios",
          "preseleccionar los proveedores clave",
        ],
      },
      { type: "p", text: "Todavía no hacen falta todos los detalles, solo límites claros." },
      { type: "h2", text: "9 meses antes" },
      { type: "p", text: "Hora de empezar a reservar." },
      {
        type: "ul",
        items: [
          "contrato del sitio",
          "foto / vídeo",
          "grupo o DJ",
          "oficiante / maestro de ceremonias",
          "primer borrador de la lista de invitados",
          "web de boda o flujo de RSVP",
        ],
      },
      {
        type: "p",
        text: "La lista de invitados seguirá moviéndose, pero poned una primera versión por escrito.",
      },
      { type: "h2", text: "6 meses antes" },
      { type: "p", text: "Ahora, los detalles." },
      {
        type: "ul",
        items: [
          "diseño de las invitaciones",
          "fecha límite del RSVP",
          "dirección de la decoración",
          "vestido y traje",
          "presupuestos de menú",
          "plan de alojamiento y transporte",
        ],
      },
      {
        type: "p",
        text: "A estas alturas el presupuesto debería actualizarse con precios reales, no con estimaciones.",
      },
      { type: "h2", text: "3 meses antes" },
      { type: "p", text: "Respuestas y ajustes." },
      {
        type: "ul",
        items: [
          "seguir los RSVP",
          "actualizar la lista de invitados",
          "recoger la elección de menú",
          "cerrar los detalles con los proveedores",
          "primer borrador de mesas",
          "diseñar la papelería",
        ],
      },
      {
        type: "p",
        text: "Si todo sigue viviendo en hojas de cálculo dispersas, es fácil que se caiga un detalle. Es mucho más tranquilo si los dos miráis la misma lista.",
      },
      { type: "h2", text: "1 mes antes" },
      { type: "p", text: "Fase de cierre." },
      {
        type: "ul",
        items: [
          "dar el número final de comensales",
          "cerrar el plano de mesas",
          "imprimir números de mesa y tarjetas de sitio",
          "escaleta para los proveedores",
          "revisar los plazos de pago",
          "montar el horario del día",
        ],
      },
      {
        type: "p",
        text: "Menos ideas nuevas y más que todo el mundo, vosotros, vuestros padres, vuestros proveedores, sepa de verdad lo mismo.",
      },
      { type: "h2", text: "1 semana antes" },
      { type: "p", text: "Solo quedan los ajustes finos." },
      {
        type: "ul",
        items: [
          "resolver los últimos cambios de invitados",
          "revisar la papelería",
          "confirmaciones de los proveedores",
          "preparar el kit de emergencia",
          "descansar",
        ],
      },
      {
        type: "p",
        text: "Sí, descansar está en la lista. Una boda no es el cierre de un proyecto: es un día que hay que vivir.",
      },
      { type: "h2", text: "Resumen" },
      {
        type: "p",
        text: "La organización se vuelve manejable en cuanto dejáis de intentar resolverlo todo a la vez. Una checklist compartida, una lista de invitados al día, un presupuesto que se mueve con vosotros y un solo sitio que los dos miráis. Con eso basta.",
      },
      {
        type: "cta",
        lead: "Weddly mantiene juntos vuestro presupuesto, la lista de invitados, los RSVP y el plano de mesas, para que no tengáis que organizar desde hojas de cálculo desconectadas.",
        href: "/signup",
        label: "Empezar a planificar",
      },
      { type: "h2", text: "Preguntas frecuentes" },
      { type: "h3", text: "¿Cuándo deberíamos empezar a organizar la boda?" },
      {
        type: "p",
        text: "Lo ideal es entre 9 y 12 meses antes. Una boda pequeña se puede organizar más rápido.",
      },
      { type: "h3", text: "¿Cuándo hay que enviar las invitaciones?" },
      {
        type: "p",
        text: "Normalmente entre 3 y 6 meses antes de la boda, según cuántos invitados tengan que viajar.",
      },
      { type: "h3", text: "¿Cuándo debería estar cerrado el plano de mesas?" },
      {
        type: "p",
        text: "Después de los últimos RSVP, normalmente entre 2 y 4 semanas antes de la boda.",
      },
    ],
  },
  "eskuvoi-koltsegvetes-keszitese": {
    category: "Presupuesto",
    title: "Cómo hacer un presupuesto de boda que no se os vaya de las manos",
    lead: "Cómo fijar el total, cómo contar con el número de invitados y cómo evitar gastar de más sin daros cuenta.",
    seo_title: "Cómo hacer un presupuesto de boda · Weddly",
    seo_description:
      "Guía práctica del presupuesto de boda: cómo fijar el total, repartirlo por categorías, contar con el número de invitados y evitar los desvíos silenciosos.",
    body: [
      {
        type: "p",
        text: "Lo más difícil de organizar una boda no es decidir qué queréis. Es que quepa en el presupuesto. Sitio, catering, decoración, ropa, fotografía, música y papelería parecen manejables por separado, pero suman rápido.",
      },
      {
        type: "p",
        text: "Tratad el presupuesto como un plan vivo, no como una hoja de cálculo que se rellena una vez. Si cambia el número de invitados, el menú o el precio del sitio, el presupuesto entero tiene que seguirlo.",
      },
      { type: "h2", text: "1. Empezad por el total" },
      {
        type: "p",
        text: "No empecéis por las categorías. Primero poneos de acuerdo en la cantidad total que podéis destinar a la boda con tranquilidad.",
      },
      { type: "p", text: "Después repartidla entre las categorías principales:" },
      {
        type: "ul",
        items: [
          "sitio",
          "catering y bebidas",
          "foto y vídeo",
          "decoración",
          "vestido y traje",
          "música",
          "invitaciones y papelería",
          "reserva",
        ],
      },
      {
        type: "p",
        text: "No os saltéis la reserva. Casi toda boda acaba recogiendo un gasto que no estaba en la lista inicial.",
      },
      { type: "h2", text: "2. El número de invitados lo mueve todo" },
      {
        type: "p",
        text: "El número de invitados no cambia solo la línea del catering. Mueve las bebidas, el número de mesas, la distribución, la papelería, los detalles y, a menudo, el consumo mínimo del sitio.",
      },
      { type: "p", text: "«Unos 90 invitados» no basta. Contad con varios escenarios:" },
      {
        type: "ul",
        items: [
          "boda pequeña: 50 invitados",
          "boda media: 80 invitados",
          "boda grande: 120 invitados",
        ],
      },
      { type: "p", text: "Enseguida se ve qué escenario cabe de verdad en el total." },
      { type: "h2", text: "3. No miréis solo la suma final" },
      {
        type: "p",
        text: "Es tentador mirar solo el total. Ayuda mucho más ver, categoría por categoría, dónde os habéis pasado sin ruido.",
      },
      {
        type: "p",
        text: "Puede que en conjunto vayáis bien mientras la decoración se ha comido parte del presupuesto de fotografía. Mejor darse cuenta pronto que correr las últimas semanas.",
      },
      { type: "h2", text: "4. El presupuesto tiene que ser común" },
      {
        type: "p",
        text: "Si uno actualiza una hoja de cálculo y el otro lee cifras viejas, los malentendidos vienen solos. Organizar a dos exige un único presupuesto compartido y siempre al día.",
      },
      {
        type: "p",
        text: "Ayuda mucho que el presupuesto, la lista de invitados y las mesas vivan en un mismo espacio: un cambio en el número de invitados no obliga a perseguir sus efectos en tres archivos distintos. (Por eso construimos Weddly así.)",
      },
      { type: "h2", text: "Checklist breve" },
      {
        type: "ul",
        items: [
          "Acordad primero un presupuesto total.",
          "Desglosadlo por categorías.",
          "Contad con varios escenarios de invitados.",
          "Apartad una reserva.",
          "Que los dos leáis la misma versión viva.",
        ],
      },
      {
        type: "cta",
        lead: "¿Queréis un presupuesto de boda más transparente? En Weddly el presupuesto, la lista de invitados, los RSVP y las mesas viven en un mismo espacio compartido.",
        href: "/signup",
        label: "Empezar a planificar",
      },
    ],
  },
  "digitalis-eskuvoi-meghivo-vagy-papir-meghivo": {
    category: "Invitaciones",
    title: "Invitaciones de boda digitales o en papel: ¿cuál elegir?",
    lead: "Ventajas, inconvenientes, costes y cómo afecta cada opción al flujo de RSVP.",
    seo_title: "Invitaciones de boda digitales o en papel · Weddly",
    seo_description:
      "Comparativa de invitaciones digitales y en papel: ventajas, inconvenientes, costes y cómo se conecta cada una con el proceso de RSVP.",
    body: [
      {
        type: "p",
        text: "La invitación es lo primero que ven vuestros invitados. Marca el tono y lleva la información esencial. Hoy la pregunta no es solo qué papel usar, sino si hace falta papel.",
      },
      {
        type: "p",
        text: "Digital y papel no son opuestos. Para muchas parejas, la combinación funciona mejor.",
      },
      { type: "h2", text: "Invitaciones en papel: cuándo brillan" },
      {
        type: "p",
        text: "El papel resulta personal, elegante y tangible. Encaja si os importa la experiencia clásica o si muchos invitados prefieren la forma tradicional.",
      },
      { type: "p", text: "A favor:" },
      {
        type: "ul",
        items: [
          "se convierte en un recuerdo",
          "elegante y formal",
          "encaja con un estilo clásico",
          "se siente más personal",
        ],
      },
      { type: "p", text: "En contra:" },
      {
        type: "ul",
        items: [
          "más caras",
          "plazos de imprenta y correo",
          "difíciles de actualizar si cambia algo",
          "el RSVP hay que gestionarlo aparte",
        ],
      },
      { type: "h2", text: "Invitaciones digitales: cuándo son más prácticas" },
      {
        type: "p",
        text: "Lo digital es rápido, fácil de corregir, y la respuesta llega justo al lado. Si cambia la fecha, el sitio o el menú, no hay que reimprimir nada: una edición y todo el mundo ve la versión nueva.",
      },
      { type: "p", text: "A favor:" },
      {
        type: "ul",
        items: [
          "se envían rápido",
          "se abren bien en el móvil",
          "se conectan con el RSVP",
          "se pueden actualizar",
          "salen más económicas",
        ],
      },
      { type: "p", text: "En contra:" },
      {
        type: "ul",
        items: [
          "pueden parecer menos formales",
          "no todos los invitados las prefieren",
          "se pierden fácil en una conversación",
        ],
      },
      { type: "h2", text: "El híbrido suele ganar" },
      {
        type: "p",
        text: "Muchas parejas envían papel a la familia cercana y a unos pocos invitados especiales, mientras el resto recibe una invitación digital o un enlace de RSVP.",
      },
      {
        type: "p",
        text: "Es práctico si queréis la experiencia de la invitación elegante sin ir anotando cada respuesta a mano.",
      },
      { type: "h2", text: "Qué debe incluir una invitación digital" },
      { type: "p", text: "Una buena invitación digital es bonita y útil a la vez. Incluid:" },
      {
        type: "ul",
        items: [
          "vuestros nombres",
          "la fecha",
          "el sitio y la dirección",
          "el horario",
          "el código de vestimenta (si lo hay)",
          "la fecha límite del RSVP",
          "preguntas de menú y alergias",
          "un contacto",
        ],
      },
      { type: "p", text: "Lo más importante: que el invitado pueda responder rápido." },
      { type: "h2", text: "Dónde encaja el RSVP" },
      {
        type: "p",
        text: "La verdadera ventaja de lo digital: la respuesta está junto a la invitación. Sin mensajes aparte, sin llamadas, sin una hoja de cálculo que mantener viva.",
      },
      {
        type: "p",
        text: "El invitado abre el enlace, contesta unas preguntas y vosotros ya veis quién viene y quién no.",
      },
      { type: "h2", text: "Ayuda rápida para decidir" },
      { type: "h3", text: "Elegid papel si…" },
      {
        type: "ul",
        items: [
          "queréis la experiencia clásica",
          "tenéis muchos invitados mayores",
          "queréis un recuerdo físico",
        ],
      },
      { type: "h3", text: "Elegid digital si…" },
      {
        type: "ul",
        items: [
          "queréis algo rápido y práctico",
          "necesitáis recoger muchos detalles",
          "os importa automatizar el RSVP",
          "queréis reducir costes",
        ],
      },
      { type: "h3", text: "Elegid híbrido si…" },
      {
        type: "ul",
        items: [
          "queréis belleza y comodidad a la vez",
          "papel para la familia, digital para el resto",
          "queréis el recuerdo sin llevar el RSVP a mano",
        ],
      },
      {
        type: "cta",
        lead: "Con Weddly cada invitado responde en su propio enlace de RSVP, y vosotros veis cada respuesta, acompañante, menú y nota en un solo sitio.",
        href: "/signup",
        label: "Probarlo",
      },
      { type: "h2", text: "Preguntas frecuentes" },
      { type: "h3", text: "¿Basta con la invitación digital?" },
      {
        type: "p",
        text: "Sí, siempre que vuestra lista de invitados se maneje bien con ella y toda la información importante esté a mano.",
      },
      { type: "h3", text: "¿Sigue haciendo falta una invitación en papel?" },
      {
        type: "p",
        text: "No es obligatorio, pero es un buen gesto para la familia o para quien valore la forma tradicional.",
      },
      { type: "h3", text: "¿Cuál es el contenido más importante?" },
      {
        type: "p",
        text: "Fecha, sitio, hora, fecha límite del RSVP y todo lo que ayude al invitado a decidir.",
      },
    ],
  },
  "eskuvoszervezesi-checklist-6-honapra": {
    category: "Planificación",
    title: "Checklist de boda en 6 meses: qué resolver y cuándo",
    lead: "Si os quedan seis meses hasta la boda: un calendario comprimido, desde las decisiones grandes hasta la última semana, para que nada se acumule al final.",
    seo_title: "Checklist de boda en 6 meses · Weddly",
    seo_description:
      "Checklist práctica de 6 meses: qué resolver seis, cuatro, dos y un mes antes de la boda, y en la última semana.",
    body: [
      {
        type: "p",
        text: "Seis meses hasta la boda es de sobra manejable. Muchísimas parejas tienen exactamente eso, y la ventana más corta suele hacer la organización más enfocada y menos dispersa. El truco: lo que en una checklist de 12 meses es una decisión tranquila, aquí se vuelve urgente. Si las primeras semanas van bien, el resto tiende a colocarse solo.",
      },
      {
        type: "p",
        text: "A continuación, qué resolver en cada etapa para que nada se acumule al final.",
      },
      { type: "h2", text: "6 meses antes" },
      {
        type: "p",
        text: "Estas son las decisiones de las que depende todo lo demás. En un plan de 12 meses las repartiríais durante el primer trimestre; aquí conviene cerrarlas en una o dos semanas.",
      },
      {
        type: "ul",
        items: [
          "elegir la fecha,",
          "decidir el estilo,",
          "fijar un techo de presupuesto,",
          "estimar el número de invitados,",
          "firmar el sitio,",
          "reservar los proveedores clave (foto, música),",
          "presentar los papeles en el registro civil.",
        ],
      },
      { type: "h3", text: "Consejo" },
      {
        type: "p",
        text: "Que la primera semana trate solo del sitio y de la fecha. No mezcléis vestido, decoración ni mesas hasta que esos dos estén cerrados. Todo lo demás se ordena a partir de ellos.",
      },
      { type: "h2", text: "4 meses antes" },
      {
        type: "p",
        text: "Después de las decisiones grandes, los detalles que necesitan plazo y pruebas.",
      },
      {
        type: "ul",
        items: [
          "primer borrador de la lista de invitados,",
          "diseño de las invitaciones,",
          "montar el flujo de RSVP,",
          "primeras pruebas de vestido y traje,",
          "dirección de la decoración,",
          "oficiante o maestro de ceremonias reservado,",
          "pedir presupuestos de menú y barra.",
        ],
      },
      {
        type: "p",
        text: "Actualizad ya el presupuesto con precios reales, no con estimaciones. Suele ser aquí donde una o dos partidas empiezan a necesitar recorte.",
      },
      { type: "h2", text: "2-3 meses antes" },
      { type: "p", text: "Respuestas y ajustes. Lo que era un plan toma su forma final." },
      {
        type: "ul",
        items: [
          "invitaciones enviadas,",
          "fecha límite del RSVP fijada (con seis meses por delante, apuntad a 4-5 semanas antes de la boda),",
          "recoger la elección de menú,",
          "cerrar alojamiento y transporte,",
          "primer borrador de mesas,",
          "diseñar la papelería (números de mesa, tarjetas de sitio),",
          "explicar a los testigos sus tareas oficiales.",
        ],
      },
      { type: "h3", text: "Consejo" },
      {
        type: "p",
        text: "No dejéis la invitación para el último momento. Con seis meses, enviadla como muy tarde a final del tercer mes: la mayoría de los invitados necesita unas semanas para contestar.",
      },
      { type: "h2", text: "1 mes antes" },
      {
        type: "p",
        text: "Fase de cierre. Menos ideas nuevas y más que todo el mundo lea la misma información actualizada.",
      },
      {
        type: "ul",
        items: [
          "dar el número final de comensales,",
          "cerrar el plano de mesas,",
          "imprimir números de mesa y tarjetas de sitio,",
          "acordar la escaleta con los proveedores,",
          "revisar los plazos de pago,",
          "explicar a la familia y a los testigos la hora de llegada, su papel y los tiempos.",
        ],
      },
      { type: "h2", text: "1 semana antes" },
      { type: "p", text: "Solo quedan los ajustes finos." },
      {
        type: "ul",
        items: [
          "resolver los últimos cambios de invitados,",
          "revisar la papelería,",
          "confirmaciones de los proveedores,",
          "preparar el kit de emergencia,",
          "descansar.",
        ],
      },
      {
        type: "p",
        text: "Sí, descansar está en la lista. Después de seis meses de organización comprimida, la última semana debería ir más despacio que las anteriores.",
      },
      { type: "h2", text: "Resumen" },
      {
        type: "p",
        text: "Seis meses bastan. El truco es que las primeras dos o tres semanas estén enfocadas: sitio, fecha, proveedores clave. Con eso cerrado, el resto avanza por un calendario más apretado pero aún legible. Una checklist compartida, una lista de invitados al día, un presupuesto que se mueve con vosotros y un solo sitio que los dos miráis. Con eso basta.",
      },
      {
        type: "cta",
        lead: "Weddly mantiene juntos vuestro presupuesto, la lista de invitados, los RSVP y el plano de mesas, para que no tengáis que organizar desde hojas de cálculo desconectadas.",
        href: "/signup",
        label: "Empezar a planificar",
      },
      { type: "h2", text: "Preguntas frecuentes" },
      { type: "h3", text: "¿Se puede organizar una boda en 6 meses?" },
      {
        type: "p",
        text: "Sí, si las primeras semanas están enfocadas. La mayoría de las parejas lo consigue en seis meses, sobre todo si el número de invitados no es desmesurado.",
      },
      { type: "h3", text: "¿Cuándo hay que enviar las invitaciones con seis meses por delante?" },
      {
        type: "p",
        text: "Como muy tarde entre 8 y 12 semanas antes de la boda, para que los invitados tengan tiempo de contestar y vosotros de cerrar el número final.",
      },
      { type: "h3", text: "¿Qué es más difícil de conseguir en 6 meses?" },
      {
        type: "p",
        text: "Un vestido de novia hecho a medida cuando el taller tiene lista de espera larga. Fotógrafos o grupos muy demandados que se reservan con un año. Bodas internacionales grandes, donde lo normal es enviar un aviso de reserva antes de la invitación. Para eso, entre 8 y 12 meses es más realista.",
      },
      { type: "h3", text: "¿Cuándo debería estar cerrado el plano de mesas?" },
      {
        type: "p",
        text: "Después de los últimos RSVP, normalmente entre 2 y 3 semanas antes de la boda.",
      },
    ],
  },
  "eskuvoi-hagyomanyok-praktikusan": {
    category: "Tradiciones",
    title: "Tradiciones de boda, en la práctica: ¿quién pone el anillo y dónde?",
    lead: "Anillo de pedida, alianza, baile de la novia, ramo: qué conservar, qué reformular y qué dejar fuera.",
    seo_title: "Tradiciones de boda, en la práctica · Weddly",
    seo_description:
      "Anillo de pedida, alianza, baile de la novia, lanzamiento del ramo: un recorrido práctico por las costumbres clásicas de la boda húngara.",
    body: [
      {
        type: "p",
        text: "Las tradiciones de boda a veces son preciosas y a veces confusas. ¿Quién pone el anillo primero? ¿En qué mano va la alianza? ¿Qué pasa con el anillo de pedida durante la ceremonia? ¿Y de verdad hay que cumplir todas las costumbres antiguas?",
      },
      {
        type: "p",
        text: "La buena noticia: hoy las tradiciones de boda son casi todas opciones, no reglas. Un repaso práctico a las más habituales.",
      },
      { type: "h2", text: "1. Anillo de pedida y alianza" },
      {
        type: "p",
        text: "El anillo de pedida se entrega normalmente en la petición, a menudo con una piedra central como un diamante. La alianza se pone durante la ceremonia y representa el compromiso del matrimonio.",
      },
      { type: "h3", text: "Consejo" },
      {
        type: "p",
        text: "Muchas parejas llevan los dos después de la boda. Un orden habitual es ponerse primero la alianza (más cerca del corazón) y encima el anillo de pedida.",
      },
      { type: "h2", text: "2. ¿En qué mano?" },
      {
        type: "p",
        text: "En Hungría el anillo de pedida se lleva tradicionalmente en el anular izquierdo hasta la boda, y después la alianza pasa al anular derecho. En España la alianza también suele ir en la mano derecha, aunque en Cataluña y en buena parte de Latinoamérica se lleva en la izquierda. En ningún caso es una regla rígida: la familia, la comodidad o el gusto personal suelen decidir.",
      },
      { type: "h3", text: "Consejo" },
      {
        type: "p",
        text: "Decidid antes del día qué quiere hacer la novia con el anillo de pedida durante la ceremonia. Tres opciones habituales: dejarlo en una mano y poner la alianza en la otra; cambiarlo de mano justo antes de la ceremonia; o quitárselo para la ceremonia y volver a ponérselo después junto a la alianza.",
      },
      { type: "h2", text: "3. ¿Quién pone el anillo primero?" },
      {
        type: "p",
        text: "En la mayoría de ceremonias civiles y religiosas, el novio pone primero el anillo a la novia y después ella hace lo mismo. No es universal, pero sí el orden más común.",
      },
      { type: "p", text: "Antes de la ceremonia comprobad que:" },
      {
        type: "ul",
        items: [
          "los anillos entran bien,",
          "alguien sabe quién se los entrega al oficiante,",
          "hay un cojín, una caja o un platillo preparado,",
          "los testigos o quien lleva los anillos conocen su momento.",
        ],
      },
      { type: "h3", text: "Consejo" },
      {
        type: "p",
        text: "Los nervios, el calor o la emoción pueden hinchar un poco los dedos. No pasa nada si el anillo no entra a la primera. Lo que cuenta es el momento, no la coreografía.",
      },
      { type: "h2", text: "4. ¿Quién guarda los anillos antes de la ceremonia?" },
      {
        type: "p",
        text: "Normalmente el novio, un testigo, la persona que organiza la boda o el oficiante. Decididlo pronto y que haya alguien designado que sepa dónde están los anillos, los entregue a tiempo y compruebe que están los dos.",
      },
      { type: "h2", text: "5. Algo viejo, algo nuevo, algo prestado, algo azul" },
      {
        type: "p",
        text: "La tradición de «algo viejo, algo nuevo, algo prestado y algo azul» aparece en muchas bodas. No es obligatoria, pero es un detalle simbólico bonito.",
      },
      {
        type: "ul",
        items: [
          "viejo: una joya de familia, el pañuelo de la abuela,",
          "nuevo: el vestido, los zapatos o una joya,",
          "prestado: un adorno del pelo de una amiga cercana,",
          "azul: una liga, un bordado, una cinta o un pequeño detalle.",
        ],
      },
      {
        type: "p",
        text: "No hace falta que llame la atención. Una puntada azul pequeña o un colgante de familia funcionan perfectamente.",
      },
      { type: "h2", text: "6. El baile de la novia" },
      {
        type: "p",
        text: "En Hungría el baile de la novia (menyasszonytánc) se hace tradicionalmente antes de medianoche: los invitados pagan por bailar con la novia. Después de medianoche llega el menyecsketánc, cuando la novia ya se ha cambiado a un segundo vestido.",
      },
      {
        type: "p",
        text: "Cada vez más parejas adaptan la costumbre: la mantienen, la acortan o la dejan fuera del todo.",
      },
      {
        type: "p",
        text: "Si la mantenéis, acordad de antemano quién la anuncia, dónde se pone la cesta, cuánto dura, qué música suena y si la novia está cómoda con la tradición.",
      },
      { type: "h2", text: "7. El lanzamiento del ramo" },
      {
        type: "p",
        text: "Un clásico, pero no para todo el mundo. Si la novia no quiere lanzar su ramo, se puede preparar un ramo aparte para el lanzamiento.",
      },
      { type: "p", text: "Alternativas:" },
      {
        type: "ul",
        items: [
          "el juego del ramo con cintas,",
          "una foto de grupo con los invitados solteros,",
          "entregar el ramo a una persona que signifique algo,",
          "no hacer el lanzamiento.",
        ],
      },
      {
        type: "cta",
        lead: "Las tradiciones de boda funcionan mejor cuando encajan con la historia de la pareja. Conservad lo que significa algo para vosotros y dad al resto la forma que os salga natural.",
        href: "/signup",
        label: "Organizadlo con Weddly",
      },
      { type: "h2", text: "Preguntas frecuentes" },
      { type: "h3", text: "¿En qué mano va la alianza?" },
      {
        type: "p",
        text: "En Hungría y en la mayor parte de España, en el anular derecho; en Cataluña y en gran parte de Latinoamérica, en el izquierdo. El anillo de pedida suele ir al lado, o se queda en la otra mano.",
      },
      { type: "h3", text: "¿El baile de la novia es obligatorio?" },
      {
        type: "p",
        text: "No. Cada vez más parejas lo quitan, lo acortan o lo reinventan si no les encaja.",
      },
      { type: "h3", text: "¿Qué significa «algo prestado»?" },
      {
        type: "p",
        text: "Un objeto de buena suerte de alguien a quien queréis, que se devuelve después del día. Puede ser un adorno del pelo, un velo, una joya, cualquier cosa pequeña.",
      },
      { type: "h3", text: "¿Cuántos cambios de vestido durante la boda?" },
      {
        type: "p",
        text: "Los que queráis. Lo clásico es un único cambio, pero muchas parejas llevan el mismo conjunto toda la noche.",
      },
    ],
  },
  "eskuvoi-szertartas-menete": {
    category: "Ceremonia",
    title: "La ceremonia de boda, paso a paso",
    lead: "Civil, religiosa o con oficiante: qué esperar, qué cerrar por adelantado y en qué orden pasa todo.",
    seo_title: "La ceremonia de boda, paso a paso · Weddly",
    seo_description:
      "Ceremonias civiles, religiosas y con oficiante paso a paso: entrada, votos, intercambio de anillos, firma, elementos simbólicos y plan de lluvia.",
    body: [
      {
        type: "p",
        text: "La ceremonia es una de las partes más importantes de la boda. Aquí se pronuncia el sí, aquí se intercambian los anillos y, para muchas parejas, este es el momento en que por fin aterriza: estamos casados.",
      },
      {
        type: "p",
        text: "Aun así, la mayoría llega con una idea aproximada de lo que va a pasar. ¿Cuándo entra la novia? ¿Cuándo se intercambian los anillos? ¿Cuándo se firma? ¿Y qué cambia si hay un oficiante?",
      },
      { type: "h2", text: "Ceremonia civil" },
      {
        type: "p",
        text: "La ceremonia civil es la parte con valor legal. La dirige la persona encargada del registro civil.",
      },
      {
        type: "ul",
        items: [
          "1. Los invitados llegan y se sientan. La familia, en las primeras filas.",
          "2. La pareja entra: juntos, por separado o con los padres o los testigos.",
          "3. Quien oficia saluda a la pareja y a los invitados.",
          "4. Se hacen las preguntas legales obligatorias y la pareja responde que sí.",
          "5. Votos personales, lecturas o breves discursos, si los queréis.",
          "6. La pareja intercambia los anillos.",
          "7. La pareja y los testigos firman el acta matrimonial.",
          "8. La pareja sale ya casada: felicitaciones, brindis, fotos de grupo.",
        ],
      },
      { type: "h3", text: "Consejo" },
      {
        type: "p",
        text: "Las ceremonias civiles suelen ser más cortas de lo que la gente espera. Si queréis que se sienta personal, pedid música elegida por vosotros, una lectura, una historia personal o vuestros propios votos.",
      },
      { type: "h2", text: "Ceremonia religiosa" },
      {
        type: "p",
        text: "La ceremonia religiosa se celebra dentro de un marco de fe, en un templo o en otro espacio consagrado. El orden exacto depende de la confesión, pero los elementos habituales son:",
      },
      {
        type: "ul",
        items: [
          "entrada,",
          "saludo,",
          "oración o bendición,",
          "lectura o homilía,",
          "votos matrimoniales,",
          "bendición de los anillos,",
          "intercambio de anillos,",
          "oración común,",
          "bendición final,",
          "salida.",
        ],
      },
      { type: "p", text: "Cerrad de antemano con la parroquia:" },
      {
        type: "ul",
        items: [
          "qué documentos hacen falta,",
          "si hay que hacer un cursillo prematrimonial,",
          "si podéis elegir vuestra música,",
          "quién puede decorar el templo,",
          "si se permiten foto y vídeo,",
          "a qué hora deben llegar la pareja y los testigos.",
        ],
      },
      { type: "h3", text: "Consejo" },
      {
        type: "p",
        text: "Para las ceremonias religiosas, informad de antemano al fotógrafo y al videógrafo. Algunos templos solo permiten grabar desde puntos concretos.",
      },
      { type: "h2", text: "Ceremonia con oficiante o simbólica" },
      {
        type: "p",
        text: "Una ceremonia con oficiante no sustituye al registro civil, pero puede ser una forma profundamente personal y flexible. Muchas parejas firman los papeles legales por separado y celebran una ceremonia simbólica el día de la boda.",
      },
      { type: "p", text: "Por qué la eligen:" },
      {
        type: "ul",
        items: [
          "puede ser al aire libre,",
          "puede ser al atardecer,",
          "admite historias personales, humor y emoción,",
          "tiene menos ataduras formales,",
          "se adapta al estilo de la pareja.",
        ],
      },
      { type: "p", text: "Un orden habitual:" },
      {
        type: "ul",
        items: [
          "1. Llegan los invitados",
          "2. Entrada",
          "3. Bienvenida del oficiante",
          "4. La historia de la pareja",
          "5. Votos",
          "6. Intercambio de anillos",
          "7. Elemento simbólico",
          "8. Beso",
          "9. Salida",
        ],
      },
      { type: "h2", text: "Elementos simbólicos" },
      { type: "h3", text: "Ceremonia de la arena" },
      {
        type: "p",
        text: "Se vierten dos arenas de distinto color en un mismo recipiente, símbolo de dos vidas que se unen.",
      },
      { type: "h3", text: "Vela de la unidad" },
      {
        type: "p",
        text: "Dos velas separadas encienden una llama común. Elegante, clásica y mejor en interiores.",
      },
      { type: "h3", text: "Ceremonia del vino" },
      {
        type: "p",
        text: "La pareja comparte una copa de vino, símbolo de las alegrías y los momentos compartidos de la vida que empieza.",
      },
      { type: "h3", text: "Cápsula del tiempo" },
      {
        type: "p",
        text: "La pareja se escribe una carta, la guarda en una caja sellada y la abre en un aniversario futuro: el primero, el quinto o el décimo.",
      },
      { type: "h3", text: "Consejo" },
      {
        type: "p",
        text: "Las velas al aire libre son un riesgo con cualquier brisa. La arena, la cápsula del tiempo o el vino son apuestas más seguras en exterior.",
      },
      { type: "h2", text: "Orden de entrada" },
      { type: "p", text: "No hay un orden obligatorio, pero el clásico es este:" },
      {
        type: "ul",
        items: [
          "1. los invitados ocupan sus sitios,",
          "2. entra el novio con su testigo o con un progenitor,",
          "3. entran las damas de honor y los niños,",
          "4. entra la novia acompañada,",
          "5. empieza la ceremonia.",
        ],
      },
      {
        type: "p",
        text: "Entrar juntos también es precioso: moderno, íntimo y muy apropiado para quienes no quieren el marco clásico de «entregar» a la novia.",
      },
      { type: "h2", text: "La música de la ceremonia" },
      { type: "p", text: "Preparad música para estos momentos:" },
      {
        type: "ul",
        items: [
          "la llegada de los invitados,",
          "la entrada,",
          "la firma o el elemento simbólico,",
          "la salida,",
          "el fondo durante las felicitaciones.",
        ],
      },
      { type: "h3", text: "Consejo" },
      {
        type: "p",
        text: "Elegid una pieza de entrada suficientemente larga. Mejor que sobre a que el momento más importante se corte a media frase.",
      },
      { type: "h2", text: "¿A qué hora empezar?" },
      {
        type: "p",
        text: "La hora importa sobre todo al aire libre. Una ceremonia de verano a las 14:00 o 15:00 puede ser un castigo, sobre todo sin sombra.",
      },
      {
        type: "p",
        text: "El final de la tarde o el principio de la noche es mucho más amable en verano: luz más suave para las fotos, temperatura más cómoda, ambiente más romántico y menos ojos entrecerrados en las imágenes.",
      },
      { type: "h2", text: "Plan de lluvia" },
      {
        type: "p",
        text: "Para cualquier ceremonia al aire libre, tened siempre un plan B: una terraza cubierta, una carpa, una sala interior o un comedor que se recoloque rápido.",
      },
      { type: "h3", text: "Consejo" },
      {
        type: "p",
        text: "No dejéis el plan de lluvia solo en vuestra cabeza. Acordad de antemano quién decide el cambio y cuándo, quién mueve la decoración, adónde van los invitados y dónde acaba el equipo de sonido.",
      },
      { type: "h2", text: "Checklist previa a la ceremonia" },
      { type: "p", text: "Antes de que se abran las puertas, dejad cerrado:" },
      {
        type: "ul",
        items: [
          "quién lleva los anillos,",
          "quiénes son los testigos,",
          "dónde se sientan los padres,",
          "el orden de entrada,",
          "las entradas de música,",
          "el montaje de micrófonos,",
          "la mesa de la firma,",
          "quién trae los materiales del elemento simbólico,",
          "la escaleta del fotógrafo y del videógrafo,",
          "un vaso de agua al alcance de la pareja.",
        ],
      },
      {
        type: "cta",
        lead: "La ceremonia está en su mejor momento cuando no solo funciona en la forma, sino que se os parece. Los elementos tradicionales, los pasos legales y los momentos personales caben todos juntos.",
        href: "/signup",
        label: "Prepararlo con Weddly",
      },
      { type: "h2", text: "Preguntas frecuentes" },
      { type: "h3", text: "¿Cuánto dura una ceremonia civil?" },
      {
        type: "p",
        text: "Normalmente entre 15 y 30 minutos. La versión más larga y personalizada puede alargarse si habéis elegido mucha música o varias lecturas.",
      },
      { type: "h3", text: "¿Se puede celebrar la ceremonia civil al aire libre?" },
      {
        type: "p",
        text: "Sí, si quien oficia acepta hacerlo fuera. Confirmadlo pronto: no todos los ayuntamientos lo ofrecen.",
      },
      { type: "h3", text: "¿Los testigos tienen que ser de la familia?" },
      {
        type: "p",
        text: "No. Puede ser cualquier persona mayor de edad con capacidad legal, y en España la boda civil pide dos. La mayoría elige amigos cercanos o hermanos.",
      },
      { type: "h3", text: "¿Qué pasa si llueve el día de una boda al aire libre?" },
      {
        type: "p",
        text: "Se activa el plan de lluvia. Decidid de antemano con el sitio quién toma la decisión y quién se encarga del cambio.",
      },
    ],
  },
  "eskuvo-napi-checklist": {
    category: "El día de la boda",
    title: "Checklist del día de la boda: lo que no hay que dejarse en casa",
    lead: "La lista completa para repasar la noche anterior: documentos, anillos, el neceser de la novia y el del novio, los detalles para el fotógrafo, el kit de emergencia, los proveedores y el sitio, todo en un mismo lugar.",
    seo_title: "Checklist del día de la boda · Weddly",
    seo_description:
      "La checklist completa del día de la boda según wedding planners y fotógrafos: documentos, anillos, neceseres, kit de emergencia, proveedores y sitio. Guardadla y repasadla la noche antes.",
    body: [
      {
        type: "p",
        text: "El día de vuestra boda no va de buscar el móvil, perseguir los anillos ni preguntaros si el DNI acabó en el bolso.",
      },
      {
        type: "p",
        text: "Las bodas que salen bien no tienen en común que todo funcione a la perfección. Tienen en común que lo importante ya estaba resuelto con antelación.",
      },
      {
        type: "p",
        text: "La lista de abajo recoge los puntos que wedding planners, fotógrafos, oficiantes y espacios repasan una y otra vez antes del gran día. Guardadla, imprimidla o id tachándola la tarde anterior.",
      },
      { type: "h2", text: "Los documentos más importantes" },
      {
        type: "p",
        text: "Sin esto, hasta la ceremonia civil puede irse al traste, así que preparad esta sección la primera.",
      },
      {
        type: "ul",
        items: [
          "Documento de identidad (los dos)",
          "Certificado de empadronamiento, si os lo piden",
          "Pasaporte, si os casáis fuera",
          "Los documentos oficiales que exige el matrimonio",
          "Tarjeta bancaria",
          "Efectivo para gastos pequeños y propinas",
        ],
      },
      { type: "h2", text: "Los anillos" },
      {
        type: "p",
        text: "En casi todas las bodas es lo primero que todo el mundo busca. Asignad a una persona responsable de ellos hasta la ceremonia.",
      },
      {
        type: "ul",
        items: [
          "Las alianzas",
          "Cojín o caja de anillos",
          "Una persona designada que los custodie hasta la ceremonia",
          "Apartadlos para los planos de detalle del fotógrafo",
        ],
      },
      { type: "h2", text: "El neceser de la novia" },
      { type: "h3", text: "Ropa" },
      {
        type: "ul",
        items: [
          "Vestido de novia",
          "Velo",
          "Segundo vestido (de fiesta) y sus complementos",
          "Chal o bolero",
          "Bata para la preparación",
        ],
      },
      { type: "h3", text: "Zapatos" },
      {
        type: "ul",
        items: ["Zapatos de novia", "Zapatos de repuesto", "Zapato plano para la noche"],
      },
      { type: "h3", text: "Joyas" },
      { type: "ul", items: ["Pendientes", "Collar", "Pulsera", "Adorno para el pelo"] },
      { type: "h3", text: "Maquillaje" },
      {
        type: "ul",
        items: [
          "Barra de labios",
          "Polvos",
          "Maquillaje para retoques",
          "Desmaquillante",
          "Espejo de mano",
        ],
      },
      { type: "h3", text: "Pelo" },
      { type: "ul", items: ["Gomas", "Horquillas", "Laca", "Peine"] },
      { type: "h2", text: "El neceser del novio" },
      { type: "h3", text: "Ropa" },
      { type: "ul", items: ["Traje", "Camisa", "Corbata o pajarita", "Cinturón", "Calcetines", "Zapatos"] },
      { type: "h3", text: "Complementos" },
      { type: "ul", items: ["Gemelos", "Pañuelo de bolsillo", "Flor de solapa", "Reloj"] },
      { type: "h3", text: "Aseo" },
      { type: "ul", items: ["Desodorante", "Colonia", "Peine"] },
      { type: "h2", text: "Los detalles preparados para el fotógrafo" },
      {
        type: "p",
        text: "La mayoría de fotógrafos de boda los fotografía a primera hora. Reunidlos en una caja para que esté todo en el mismo sitio.",
      },
      {
        type: "ul",
        items: [
          "La invitación",
          "Las alianzas y la caja de anillos",
          "Los zapatos",
          "Colonia y perfume",
          "Joyas",
          "El ramo",
          "El cuadernillo de los votos",
          "La flor de solapa",
          "Una joya de familia u otros objetos personales",
        ],
      },
      { type: "h2", text: "Kit de emergencia" },
      {
        type: "p",
        text: "Es la bolsa que ojalá no abráis. Pero si la abrís, todo el mundo agradecerá que exista.",
      },
      { type: "h3", text: "Salud" },
      {
        type: "ul",
        items: [
          "Tiritas",
          "Antiséptico",
          "Analgésico",
          "Antihistamínico",
          "Algo para el malestar de estómago",
        ],
      },
      { type: "h3", text: "Arreglos rápidos" },
      {
        type: "ul",
        items: [
          "Costurero mínimo (hilo blanco y negro)",
          "Imperdibles",
          "Tijeras pequeñas",
          "Cinta de doble cara para tela y pegamento textil",
          "Esmalte transparente",
        ],
      },
      { type: "h3", text: "Varios" },
      {
        type: "ul",
        items: [
          "Pañuelos de papel",
          "Toallitas húmedas",
          "Toallita quitamanchas",
          "Una pajita (para no estropear el labial)",
          "Un rollo pequeño de cinta adhesiva",
        ],
      },
      { type: "h2", text: "Electrónica" },
      {
        type: "ul",
        items: [
          "Móvil",
          "Cargador del móvil",
          "Batería externa",
          "Cargador del reloj",
          "Altavoz bluetooth, si hace falta",
        ],
      },
      { type: "h2", text: "Dejad esto en el coche" },
      {
        type: "ul",
        items: [
          "Agua embotellada",
          "Una barrita o algo rápido de comer",
          "Paraguas",
          "Protector solar",
          "Pañuelos",
          "Zapatos de repuesto",
          "Cargador del móvil",
          "Efectivo",
        ],
      },
      { type: "h2", text: "Material para la ceremonia" },
      {
        type: "ul",
        items: [
          "Bolígrafo para el acta",
          "Los anillos",
          "Velas",
          "Material de la ceremonia de la arena o de las cintas",
          "Arroz o pompas de jabón",
          "Confeti, si el sitio lo permite",
          "Cava y copas",
        ],
      },
      { type: "h2", text: "Si la boda es al aire libre" },
      {
        type: "p",
        text: "Tened siempre un plan B: el tiempo es el invitado menos previsible.",
      },
      {
        type: "ul",
        items: [
          "Paraguas",
          "Sombrillas",
          "Abanicos para los invitados",
          "Repelente de insectos",
          "Protector solar",
          "Mantas para la noche",
          "Agua suficiente para todos",
        ],
      },
      { type: "h2", text: "Para una boda con niños" },
      {
        type: "ul",
        items: [
          "Cuadernos para colorear y lápices",
          "Pompas de jabón",
          "Un juego de mesa y juguetes pequeños",
          "Comida para los niños",
          "Toallitas húmedas",
        ],
      },
      { type: "h2", text: "Si también viene el perro" },
      {
        type: "ul",
        items: [
          "Correa y collar",
          "Cuenco y agua",
          "Premios",
          "Toalla",
          "Bolsas para los excrementos",
          "Una persona designada que se encargue de él",
        ],
      },
      { type: "h2", text: "Última confirmación con los proveedores" },
      {
        type: "p",
        text: "En las 48 horas previas a la boda, confirmad los detalles una vez más con cada proveedor.",
      },
      {
        type: "ul",
        items: [
          "Hora de llegada",
          "Persona de contacto y teléfono",
          "Aparcamiento y por dónde se descarga",
          "Forma de pago",
          "Horario",
          "Plan B si hace mal tiempo",
        ],
      },
      { type: "h2", text: "Qué confirmar con el sitio" },
      {
        type: "ul",
        items: [
          "Llegada de la decoración, la tarta y las flores",
          "Llegada del DJ o del grupo",
          "Llegada del fotógrafo y del videógrafo",
          "Aparcamiento de los invitados",
          "Entrega de las habitaciones",
          "Recena",
          "Desmontaje del día siguiente",
        ],
      },
      { type: "h2", text: "Las tareas de los testigos" },
      { type: "p", text: "¿Saben vuestros testigos exactamente de qué se encargan?" },
      {
        type: "ul",
        items: [
          "Custodiar los anillos y los documentos",
          "Ayudar a los invitados",
          "Coordinar las fotos",
          "Conocer el orden del día",
          "Tener el teléfono del oficiante",
        ],
      },
      { type: "h2", text: "La bolsa del día siguiente" },
      {
        type: "p",
        text: "Si dormís en un hotel o viajáis al día siguiente, preparadla la tarde anterior.",
      },
      {
        type: "ul",
        items: [
          "Ropa cómoda y pijama",
          "Neceser",
          "Cargador del móvil",
          "Medicación",
          "Lentillas y gafas",
          "Pasaporte y documentos de la luna de miel",
        ],
      },
      { type: "h2", text: "La checklist de la última noche" },
      { type: "p", text: "Antes de dormir, repasad estos pocos puntos:" },
      {
        type: "ul",
        items: [
          "Todos los proveedores han confirmado su llegada.",
          "Habéis mirado la previsión del tiempo.",
          "Los móviles y la batería externa están cargados.",
          "Los anillos están con la persona designada.",
          "Los documentos están en el bolso.",
          "La ropa y los zapatos están preparados.",
          "La bolsa del día siguiente está hecha y esperando.",
          "Tenéis a mano todos los teléfonos importantes.",
          "El despertador está puesto.",
        ],
      },
      { type: "h2", text: "Algunas cosas que las parejas solo cuentan después" },
      { type: "h3", text: "No intentéis ocuparos vosotros de todo" },
      {
        type: "p",
        text: "Que haya ese día una persona designada (planner, oficiante, testigo o alguien de la familia) a quien pueda ir cualquier pregunta. Los invitados saben a quién preguntar, los proveedores saben a quién llamar y vosotros no tenéis que estar pendientes del móvil.",
      },
      { type: "h3", text: "Dejad margen para los retrasos" },
      {
        type: "p",
        text: "Una ronda de felicitaciones, una foto de familia o una conversación rápida desplazan el horario con facilidad. Con 10 o 15 minutos de colchón entre bloques, el día entero se siente más tranquilo.",
      },
      { type: "h3", text: "Comed y bebed" },
      {
        type: "p",
        text: "Una de las cosas que más se repiten después es que al llegar la noche se dieron cuenta de que apenas habían comido en todo el día. Pedid a vuestros testigos o al oficiante que os recuerden de vez en cuando beber un vaso de agua o dar unos bocados.",
      },
      { type: "h3", text: "Escapaos unos minutos" },
      {
        type: "p",
        text: "Antes de la cena o al atardecer, desapareced diez minutos. Sin móvil y sin invitados. Suelen ser los minutos que las parejas recuerdan con más cariño años después.",
      },
      { type: "h2", text: "Lo que más importa nunca cabe en una lista" },
      {
        type: "p",
        text: "Alguien puede llegar cinco minutos tarde. Puede caer una tormenta de verano. Puede saltar un botón del traje o torcerse el velo. Nada de eso arruina una boda.",
      },
      {
        type: "p",
        text: "Los invitados recordarán cómo se sintieron. Cómo os mirasteis durante la ceremonia. Que pudisteis reír y celebrar sin ataduras.",
      },
      {
        type: "p",
        text: "Las mejores bodas no son impecables. Son aquellas en las que la organización ya está hecha y la celebración por fin puede empezar.",
      },
      {
        type: "cta",
        lead: "Con Weddly no hay que rebuscar en hojas de cálculo, notas y mensajes por separado. La lista de invitados, los RSVP, el presupuesto, el plano de mesas, el horario del día, los proveedores y las tareas viven en un mismo espacio compartido.",
        href: "/signup",
        label: "Empezar a planificar",
      },
    ],
  },
};
