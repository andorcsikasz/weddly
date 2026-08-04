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
      {
        type: "ul",
        items: ["Traje", "Camisa", "Corbata o pajarita", "Cinturón", "Calcetines", "Zapatos"],
      },
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
  "eskuvoi-ugyintezes-lepesrol-lepesre": {
    category: "Trámites",
    title: "Trámites para casarse en Hungría: cómo funciona la parte oficial",
    lead: "Declaración de intención de matrimonio, plazo de espera de 30 días, documentos, testigos, ceremonia fuera del registro y ciudadanos extranjeros: qué, cuándo y dónde.",
    seo_title: "Trámites para casarse en Hungría, paso a paso · Weddly",
    seo_description:
      "Trámites prácticos para casarse en Hungría: la declaración de intención de matrimonio, el plazo de 30 días, documentos, testigos, ceremonias fuera del registro y ciudadanos extranjeros.",
    body: [
      {
        type: "p",
        text: "Una de las partes menos románticas y más importantes de organizar una boda en Hungría son los trámites. Junto al vestido, el sitio, la decoración y el fotógrafo hay un paso que no se puede saltar: presentar la declaración de intención de matrimonio (házassági szándék bejelentése) ante el registro civil.",
      },
      {
        type: "p",
        text: "Sin ese paso no os podéis casar legalmente en Hungría. La buena noticia: empezado a tiempo, el proceso es sencillo.",
      },
      { type: "h2", text: "1. El primer paso oficial" },
      {
        type: "p",
        text: "Lo primero es presentar la declaración de intención de matrimonio, en persona, ante el registro civil del municipio donde os vais a casar.",
      },
      {
        type: "p",
        text: "La declaración debe presentarse al menos 30 días antes de la boda. Si alguno de los dos es ciudadano extranjero, contad con al menos 60 días.",
      },
      { type: "h2", text: "2. Qué significa de verdad el plazo de 30 días" },
      {
        type: "p",
        text: "El registro solo puede fijar la fecha de la boda para después de que pasen los 30 días de espera. Es un requisito legal. En circunstancias concretas el notario puede conceder una dispensa, pero no conviene contar con ella.",
      },
      { type: "h3", text: "Un ejemplo práctico" },
      {
        type: "p",
        text: "Si presentáis la declaración el 10 de mayo, la primera fecha legal posible es la que quede después de esos 30 días. Para las fechas populares de verano o principios de otoño esto significa que no lo dejéis para el último momento.",
      },
      { type: "h2", text: "3. Dónde se presenta" },
      {
        type: "p",
        text: "La declaración se presenta ante el registro civil del municipio donde se celebre la boda. En Budapest es el distrito donde tenga lugar la ceremonia. No estáis atados a vuestro domicilio: podéis casaros en cualquier lugar.",
      },
      { type: "h3", text: "Consejo" },
      {
        type: "p",
        text: "Si os casáis fuera del registro, en un castillo, un restaurante o al aire libre, comprobad a qué municipio pertenece el sitio. Importan tanto la oficina que le corresponde como si acepta oficiar fuera de sus dependencias.",
      },
      { type: "h2", text: "4. Cuándo reservar la fecha" },
      {
        type: "p",
        text: "Legalmente el mínimo son 30 días, pero en la práctica eso no basta ni de lejos. Las fechas populares se llenan con meses de antelación.",
      },
      { type: "p", text: "Preguntad pronto al ayuntamiento:" },
      {
        type: "ul",
        items: [
          "cuándo se pueden presentar las declaraciones,",
          "qué huecos siguen libres,",
          "si oficia fuera de sus dependencias,",
          "cuáles son las tasas,",
          "qué documentos espera.",
        ],
      },
      {
        type: "p",
        text: "La declaración suele tener validez de un año desde su presentación, así que tampoco se puede empezar el trámite con años de antelación.",
      },
      { type: "h2", text: "5. Documentos que probablemente os pedirán" },
      {
        type: "p",
        text: "La lista exacta varía según el municipio y la situación personal. Como guía general, preparad:",
      },
      {
        type: "ul",
        items: [
          "documento de identidad o pasaporte en vigor,",
          "tarjeta de domicilio,",
          "certificado de nacimiento, si lo piden,",
          "sentencia de divorcio si alguno estuvo casado antes,",
          "certificado de defunción del cónyuge anterior en caso de viudedad,",
          "para ciudadanos extranjeros: documentos adicionales, traducciones y legalizaciones.",
        ],
      },
      { type: "h3", text: "Consejo" },
      {
        type: "p",
        text: "No preguntéis solo qué documentos hacen falta. Preguntad si hay que presentar originales, si se exige traducción jurada y si aceptan documentos extranjeros sin apostilla o sin legalización diplomática.",
      },
      { type: "h2", text: "6. Hay que ir en persona" },
      {
        type: "p",
        text: "Sí, los dos tenéis que presentaros en persona para hacer la declaración. El registro toma los datos, comprueba que se cumplen las condiciones y os pide que declaréis varias cosas.",
      },
      { type: "h2", text: "7. Qué os va a preguntar el registro" },
      { type: "p", text: "Bastante más que la fecha. Contad con preguntas sobre:" },
      {
        type: "ul",
        items: [
          "qué apellido va a usar cada uno después de la boda,",
          "quiénes serán los testigos,",
          "dónde será la ceremonia,",
          "a qué hora la queréis,",
          "dentro o fuera de sus dependencias,",
          "ceremonia solemne o sencilla,",
          "música, lecturas, intercambio de anillos y otros elementos,",
          "si hará falta un intérprete.",
        ],
      },
      { type: "h3", text: "Una nota práctica" },
      {
        type: "p",
        text: "No decidáis el asunto de los apellidos sobre la marcha. Habladlo antes: es una declaración oficial que queda registrada.",
      },
      { type: "h2", text: "8. Los testigos" },
      { type: "p", text: "Hacen falta dos testigos. Reunid sus datos con antelación:" },
      {
        type: "ul",
        items: [
          "nombre completo,",
          "nombre de nacimiento,",
          "domicilio,",
          "datos del documento de identidad,",
          "a veces también lugar y fecha de nacimiento.",
        ],
      },
      { type: "h3", text: "Consejo" },
      {
        type: "p",
        text: "No elijáis un testigo solo por el honor. Elegid a alguien de fiar, que llegue a su hora, que sepa qué se espera de él y a quien podáis localizar la semana previa.",
      },
      { type: "h2", text: "9. Ceremonias civiles fuera del registro" },
      {
        type: "p",
        text: "Muchas parejas quieren que el registro oficie en el propio sitio de la boda y no en la oficina. Es posible, pero implica más papeleo y normalmente tasas adicionales.",
      },
      { type: "p", text: "Cerrad de antemano:" },
      {
        type: "ul",
        items: [
          "si el municipio oficia fuera de sus dependencias,",
          "qué días y franjas hay disponibles,",
          "cuánto cuesta esa opción,",
          "qué montaje tenéis que proporcionar,",
          "mesa, silla, sombra, equipo de sonido,",
          "la alternativa por mal tiempo.",
        ],
      },
      { type: "h3", text: "Consejo" },
      {
        type: "p",
        text: "Planificar al aire libre no va solo de decoración. Quien oficia necesita una mesa estable, una silla, sonido que funcione, protección del tiempo y un entorno ordenado.",
      },
      { type: "h2", text: "10. ¿Cuánto cuesta la ceremonia civil?" },
      {
        type: "p",
        text: "Las tasas varían según el municipio. La ceremonia sencilla en la oficina, la ceremonia solemne, una franja fuera del horario habitual y la ceremonia fuera del registro suelen tener precios distintos. Consultad siempre el cuadro de tasas vigente del municipio concreto.",
      },
      { type: "h2", text: "11. ¿Y si uno de los dos es ciudadano extranjero?" },
      {
        type: "p",
        text: "Contad con más tiempo, y probablemente sea vuestro caso si estáis leyendo esto en español. La declaración debería presentarse al menos 60 días antes de la boda. Es probable que necesitéis:",
      },
      {
        type: "ul",
        items: [
          "documentos expedidos en el extranjero,",
          "acreditación del estado civil,",
          "traducción jurada al húngaro,",
          "un intérprete si una de las partes no habla húngaro.",
        ],
      },
      { type: "h3", text: "Consejo" },
      {
        type: "p",
        text: "No os fiéis de listas generales de internet. Contactad con la oficina de registro concreta y pedid una lista de documentos hecha para vuestro país y vuestra situación.",
      },
      { type: "h2", text: "12. ¿Se puede acelerar el trámite?" },
      {
        type: "p",
        text: "En casos concretos el notario puede levantar la espera de 30 días. No es automático: hay que justificar el motivo de forma creíble. Es mucho más seguro empezar a tiempo que contar con una dispensa.",
      },
      { type: "h2", text: "Checklist de trámites previos a la boda" },
      {
        type: "ul",
        items: [
          "habéis elegido el lugar de la boda,",
          "sabéis qué oficina de registro es la competente,",
          "tenéis cita para la declaración,",
          "habéis contado con el plazo de 30 días,",
          "si hay ciudadanía extranjera, habéis contado con el proceso más largo,",
          "habéis reunido los documentos personales,",
          "habéis decidido los apellidos,",
          "habéis elegido a los testigos,",
          "habéis recogido los datos de los testigos,",
          "habéis preguntado por las tasas de la ceremonia,",
          "habéis confirmado si es en la oficina o fuera,",
          "habéis comprobado qué montaje técnico hace falta.",
        ],
      },
      { type: "h2", text: "Errores habituales" },
      { type: "h3", text: "Empezar demasiado tarde" },
      {
        type: "p",
        text: "Organizarlo a última hora es arriesgado por la regla de los 30 días. Para las fechas populares, la agenda de la oficina y la disponibilidad de quien oficia se llenan deprisa.",
      },
      { type: "h3", text: "No comprobar la competencia" },
      {
        type: "p",
        text: "Para una boda fuera del registro, la oficina de vuestro domicilio no es necesariamente la competente. Comprobadlo siempre a partir del lugar de la boda.",
      },
      { type: "h3", text: "No coordinar pronto a los testigos" },
      {
        type: "p",
        text: "Vais a necesitar sus datos por adelantado y tienen que estar allí en persona. No descubráis la semana antes que uno no puede ir.",
      },
      { type: "h3", text: "Ignorar los plazos de los documentos extranjeros" },
      {
        type: "p",
        text: "Si hay documentos extranjeros por medio, los plazos se alargan. Eso afecta al calendario completo de la boda.",
      },
      {
        type: "cta",
        lead: "Los trámites no son la parte romántica de una boda, pero empezarlos a tiempo ahorra mucho estrés. Así el gran día trata de verdad de lo que importa: el sí, el momento compartido y la celebración.",
        href: "/signup",
        label: "Seguid cada tarea con Weddly",
      },
      { type: "h2", text: "Preguntas frecuentes" },
      { type: "h3", text: "¿Cuánto dura todo el proceso?" },
      {
        type: "p",
        text: "Al menos 30 días entre la declaración y la boda para ciudadanos húngaros, y al menos 60 si alguno de los dos es extranjero. De forma realista, contad con entre 3 y 6 meses, sobre todo para fechas populares.",
      },
      { type: "h3", text: "¿Podemos presentarla en cualquier sitio?" },
      {
        type: "p",
        text: "Solo ante el registro del municipio donde se celebre la boda. Para bodas fuera del registro, el municipio donde esté el espacio.",
      },
      { type: "h3", text: "¿Nos podemos casar un sábado?" },
      {
        type: "p",
        text: "Sí, pero las fechas fuera del horario habitual suelen llevar una tasa adicional y dependen de la agenda de la oficina. Reservad pronto.",
      },
      { type: "h3", text: "¿Hace falta un cursillo prematrimonial?" },
      {
        type: "p",
        text: "Para la ceremonia civil no. Algunas confesiones lo exigen para la boda religiosa; consultadlo con la parroquia.",
      },
    ],
  },
  "where-to-get-married-in-hungary": {
    category: "Espacios",
    title: "Dónde casarse en Hungría: 6 escenarios de cuento",
    lead: "De los palacios barrocos a una abadía sobre el lago Balatón, estos son los lugares más bonitos para casarse en Hungría, región por región, con fotos y consejos prácticos.",
    seo_title: "Dónde casarse en Hungría: 6 escenarios de cuento · Weddly",
    seo_description:
      "Los mejores espacios para bodas en Hungría: el palacio Festetics, Gödöllő, el castillo de Vajdahunyad, la abadía de Tihany, la región vinícola de Villány y Eszterháza. Estilos, capacidad y consejos.",
    body: [
      {
        type: "p",
        text: "Hungría concentra en un país pequeño una cantidad improbable de escenarios de cuento: palacios barrocos que alojaron emperadores, una abadía en lo alto sobre el lago Balatón, un castillo de libro de cuentos en pleno Budapest y tierra de vino tinto en el cálido sur. Tanto si preparáis una gran celebración de 200 invitados como una ceremonia íntima, aquí van seis lugares donde vale la pena decir sí, región por región.",
      },
      { type: "h2", text: "1. Palacio Festetics, Keszthely" },
      {
        type: "img",
        src: "https://commons.wikimedia.org/wiki/Special:FilePath/Festetics_Palace,_Keszthely,_Hungary.jpg",
        alt: "La fachada barroca blanca del palacio Festetics en Keszthely",
        caption: "Palacio Festetics, Keszthely",
        credit: "Foto: Sandor Somkuti / CC BY-SA 4.0, vía Wikimedia Commons",
        creditHref:
          "https://commons.wikimedia.org/wiki/File:Festetics_Palace,_Keszthely,_Hungary.jpg",
      },
      {
        type: "p",
        text: "El tercer palacio más grande de Hungría, y el más visitado, se alza en la orilla occidental del lago Balatón. El salón de baile de espejos con sus lámparas doradas, la célebre biblioteca histórica y el parque protegido con sus jardines francés e inglés lo convierten en un escenario clásico para bodas grandes y románticas. Un ala entera se destinó a ceremonias y bailes, así que la ceremonia civil y el banquete pueden ocurrir en un mismo lugar de fiesta.",
      },
      { type: "h2", text: "2. Palacio Real de Gödöllő" },
      {
        type: "img",
        src: "https://commons.wikimedia.org/wiki/Special:FilePath/Hungria_-_Palacio_de_Sisi_en_G%C3%B6d%C3%B6ll%C3%B6_-_panoramio.jpg",
        alt: "El palacio real barroco de Gödöllő y sus jardines",
        caption: "Palacio Real de Gödöllő",
        credit: "Foto: isol / CC BY-SA 3.0, vía Wikimedia Commons",
        creditHref:
          "https://commons.wikimedia.org/wiki/File:Hungria_-_Palacio_de_Sisi_en_G%C3%B6d%C3%B6ll%C3%B6_-_panoramio.jpg",
      },
      {
        type: "p",
        text: "El mayor palacio barroco de Hungría está a apenas 30 kilómetros de Budapest y queda ligado para siempre a la emperatriz Isabel, la querida Sisi, cuya residencia de verano favorita fue. Los salones dorados y los jardines de trazado formal lo hacen ideal para una boda que se sienta histórica y solemne sin alejar a los invitados de la capital ni obligarles a un viaje largo.",
      },
      { type: "h2", text: "3. Castillo de Vajdahunyad, Budapest" },
      {
        type: "img",
        src: "https://commons.wikimedia.org/wiki/Special:FilePath/Budapest_Burg_Vajdahunyad.JPG",
        alt: "El castillo de Vajdahunyad reflejado en el lago del Parque de la Ciudad de Budapest",
        caption: "Castillo de Vajdahunyad, Parque de la Ciudad, Budapest",
        credit: "Foto: Elelicht / CC BY-SA 3.0, vía Wikimedia Commons",
        creditHref: "https://commons.wikimedia.org/wiki/File:Budapest_Burg_Vajdahunyad.JPG",
      },
      {
        type: "p",
        text: "Si queréis quedaros en Budapest, el castillo de Vajdahunyad, en el Parque de la Ciudad, es uno de los fondos más fotogénicos de la capital. Construido para la Exposición del Milenio de 1896 y mezcla de gótico, renacimiento y románico, su reflejo en el lago y su silueta de cuento ofrecen un marco perfecto tanto para una ceremonia íntima como para las fotos, en pleno corazón de la ciudad.",
      },
      { type: "h2", text: "4. Abadía de Tihany, lago Balatón" },
      {
        type: "img",
        src: "https://commons.wikimedia.org/wiki/Special:FilePath/Tihanycivertanlegi1.jpg",
        alt: "La iglesia de dos torres de la abadía de Tihany sobre el lago Balatón, vista aérea",
        caption: "Abadía benedictina de Tihany, Tihany",
        credit: "Foto: Civertan Grafikai Stúdió / CC BY-SA 2.5, vía Wikimedia Commons",
        creditHref: "https://commons.wikimedia.org/wiki/File:Tihanycivertanlegi1.jpg",
      },
      {
        type: "p",
        text: "Fundada en 1055, la iglesia barroca ocre de dos torres de la abadía mira al Balatón desde lo alto de la península de Tihany, lo que la convierte en uno de los emplazamientos junto al agua más espectaculares del país. Su acta fundacional conserva las palabras húngaras más antiguas que se conservan, así que la sola historia del lugar da peso al día, y el panorama hace inolvidables las fotos al atardecer.",
      },
      { type: "h2", text: "5. Región vinícola de Villány" },
      {
        type: "img",
        src: "https://commons.wikimedia.org/wiki/Special:FilePath/Villany,_wine.jpg",
        alt: "Viñedos de la región de Villány bajo el monte Szársomlyó",
        caption: "Región vinícola de Villány, sur de Hungría",
        credit: "Foto: Cserlajos / CC BY-SA 3.0, vía Wikimedia Commons",
        creditHref: "https://commons.wikimedia.org/wiki/File:Villany,_wine.jpg",
      },
      {
        type: "p",
        text: "Si preferís un ambiente sureño y relajado a un palacio, Villány es la principal región de vino tinto del país, a los pies de la reserva natural de Szársomlyó. El clima submediterráneo, las hileras de vides y las terrazas de sus bodegas modernas dan una atmósfera de boda al aire libre elegante y sin rigidez, con buen vino y noches largas de verano.",
      },
      { type: "h2", text: "6. Eszterháza, el Versalles húngaro, Fertőd" },
      {
        type: "img",
        src: "https://commons.wikimedia.org/wiki/Special:FilePath/Esterh%C3%A1zy_Palace,_Fert%C5%91d,_20220426_1053_5444.jpg",
        alt: "La fachada rococó del palacio Esterházy en Fertőd",
        caption: "Palacio Esterházy (Eszterháza), Fertőd",
        credit: "Foto: Jakub Hałun / CC BY-SA 4.0, vía Wikimedia Commons",
        creditHref:
          "https://commons.wikimedia.org/wiki/File:Esterh%C3%A1zy_Palace,_Fert%C5%91d,_20220426_1053_5444.jpg",
      },
      {
        type: "p",
        text: "Conocido como el Versalles húngaro, el palacio Esterházy de Fertőd es el mayor palacio barroco-rococó del país y fue casa del compositor Joseph Haydn y de su orquesta. Los salones ornamentados encajan con ceremonias íntimas, mientras que el parque de trazado formal sirve para bodas de jardín más grandes y para conciertos, todo cerca de la histórica ciudad de Sopron.",
      },
      { type: "h2", text: "Notas prácticas" },
      {
        type: "p",
        text: "En Hungría el matrimonio con validez legal lo celebra el registro civil, y muchos palacios y espacios pueden traer a quien oficia para una ceremonia fuera de sus dependencias. Dejaos al menos un mes para los trámites y reservad las fechas más buscadas con hasta un año de antelación, sobre todo los fines de semana de verano. Contad también con el viaje y el alojamiento de los invitados si el sitio queda fuera de Budapest.",
      },
      {
        type: "cta",
        lead: "¿Ya tenéis sitio? Nosotros hacemos fácil lo demás. Con Weddly la lista de invitados, el plano de mesas, el presupuesto y las tareas viven en un mismo lugar.",
        href: "/signup",
        label: "Empezar a planificar",
      },
    ],
  },
  "where-to-get-married-in-austria": {
    category: "Espacios",
    title: "Dónde casarse en Austria: 7 escenarios románticos",
    lead: "De los palacios imperiales al panorama alpino, estos son los lugares más bonitos para casarse en Austria, de Viena a Salzburgo y a la región vinícola del Wachau, con fotos.",
    seo_title: "Dónde casarse en Austria: 7 escenarios románticos · Weddly",
    seo_description:
      "Los mejores espacios para bodas en Austria: Schönbrunn, el palacio Mirabell, Leopoldskron, Hallstatt, Schloss Hof, el Wachau y un panorama alpino. Estilos, capacidad y consejos.",
    body: [
      {
        type: "p",
        text: "Austria es uno de los grandes bastiones europeos de la boda romántica y elegante a la vez: palacios barrocos imperiales, salones de Sonrisas y lágrimas en Salzburgo, lagos esmeralda, hileras de vides junto al Danubio y panoramas alpinos, todo en un mismo país. Tanto si soñáis con una gran ceremonia vienesa como con un sí en la cima de una montaña, aquí van siete lugares donde vale la pena decirlo.",
      },
      { type: "h2", text: "1. Orangerie de Schönbrunn, Viena" },
      {
        type: "img",
        src: "https://commons.wikimedia.org/wiki/Special:FilePath/Orangerie_(Sch%C3%B6nbrunn)_20080216.jpg",
        alt: "El edificio de la Orangerie en los jardines del palacio de Schönbrunn, Viena",
        caption: "Orangerie de Schönbrunn, Viena",
        credit: "Foto: Wolfgang H. Wögerer / CC BY 3.0, vía Wikimedia Commons",
        creditHref:
          "https://commons.wikimedia.org/wiki/File:Orangerie_(Sch%C3%B6nbrunn)_20080216.jpg",
      },
      {
        type: "p",
        text: "Una de las orangeries barrocas más largas del mundo está en los jardines del palacio de Schönbrunn, donde María Teresa y Mozart dieron conciertos de corte. Las salas de fiesta y el vestíbulo se abren a una terraza del jardín de la Orangerie, lo que la convierte en escenario de bodas grandes de varios cientos de invitados en pleno corazón de la Viena imperial.",
      },
      { type: "h2", text: "2. Palacio Mirabell, Salzburgo" },
      {
        type: "img",
        src: "https://commons.wikimedia.org/wiki/Special:FilePath/2150_-_Salzburg_-_Schloss_Mirabell.JPG",
        alt: "El palacio Mirabell y sus jardines en Salzburgo",
        caption: "Palacio Mirabell, Salzburgo",
        credit: "Foto: Andrew Bossi / CC BY-SA 2.5, vía Wikimedia Commons",
        creditHref:
          "https://commons.wikimedia.org/wiki/File:2150_-_Salzburg_-_Schloss_Mirabell.JPG",
      },
      {
        type: "p",
        text: "La Sala de Mármol del palacio Mirabell está considerada una de las salas de boda civil más bonitas y más reservadas del mundo: mármol, estuco dorado y un lugar donde tocó Mozart. La sala encaja con ceremonias más íntimas, de unos 100 invitados, mientras que los jardines Mirabell son una de las localizaciones más reconocibles de Sonrisas y lágrimas.",
      },
      { type: "h2", text: "3. Schloss Leopoldskron, Salzburgo" },
      {
        type: "img",
        src: "https://commons.wikimedia.org/wiki/Special:FilePath/Aerial_image_of_Schloss_Leopoldskron_(view_from_the_southwest).jpg",
        alt: "Vista aérea del palacio rococó de Leopoldskron junto a su lago",
        caption: "Schloss Leopoldskron, Salzburgo",
        credit: "Foto: Carsten Steger / CC BY-SA 4.0, vía Wikimedia Commons",
        creditHref:
          "https://commons.wikimedia.org/wiki/File:Aerial_image_of_Schloss_Leopoldskron_(view_from_the_southwest).jpg",
      },
      {
        type: "p",
        text: "Construido en 1736, este palacio rococó se levanta junto a su propio lago con vistas al Untersberg y a la fortaleza de Salzburgo, y fue una de las principales localizaciones exteriores de Sonrisas y lágrimas. Hoy funciona como hotel y espacio para eventos, así que todo, desde una ceremonia a orillas del lago hasta un banquete en los salones nobles, se puede resolver en un mismo sitio.",
      },
      { type: "h2", text: "4. Hallstatt, Salzkammergut" },
      {
        type: "img",
        src: "https://commons.wikimedia.org/wiki/Special:FilePath/Hallstatt_Panorama.jpg",
        alt: "El pueblo de Hallstatt junto al lago, bajo el macizo del Dachstein",
        caption: "Hallstatt, Salzkammergut",
        credit: "Foto: Sergey / CC BY-SA 2.0, vía Wikimedia Commons",
        creditHref: "https://commons.wikimedia.org/wiki/File:Hallstatt_Panorama.jpg",
      },
      {
        type: "p",
        text: "Patrimonio de la Humanidad de la UNESCO, Hallstatt es uno de los pueblos junto a un lago más fotografiados del mundo: agua esmeralda enmarcada por las paredes del Dachstein. Las ceremonias pueden celebrarse en la orilla o incluso en una barca, y los hoteles del lago acogen banquetes en terraza. Una advertencia: el pueblo recibe muchísimo turismo, así que para un ambiente íntimo lo mejor es la temporada baja.",
      },
      { type: "h2", text: "5. Schloss Hof, Baja Austria" },
      {
        type: "img",
        src: "https://commons.wikimedia.org/wiki/Special:FilePath/Schloss_hof_2023.jpg",
        alt: "El palacio barroco de Schloss Hof y su jardín en terrazas",
        caption: "Schloss Hof, Marchfeld",
        credit: "Foto: Ekrem Canli / CC BY-SA 4.0, vía Wikimedia Commons",
        creditHref: "https://commons.wikimedia.org/wiki/File:Schloss_hof_2023.jpg",
      },
      {
        type: "p",
        text: "Antigua residencia de campo del príncipe Eugenio de Saboya, cerca de la frontera eslovaca, Schloss Hof viene con unas 50 hectáreas de jardín barroco en terrazas. La capilla original del palacio se sigue usando para ceremonias, mientras que los salones nobles, el picadero y las caballerizas barrocas ofrecen varios sitios para el banquete de una celebración grande.",
      },
      { type: "h2", text: "6. Valle del Wachau, Dürnstein" },
      {
        type: "img",
        src: "https://commons.wikimedia.org/wiki/Special:FilePath/Vineyards_along_the_Danube_in_Wachau.jpg",
        alt: "Viñedos en terrazas junto al Danubio, en el valle del Wachau",
        caption: "Región vinícola del Wachau, Dürnstein",
        credit: "Foto: jay8085 / CC BY 2.0, vía Wikimedia Commons",
        creditHref:
          "https://commons.wikimedia.org/wiki/File:Vineyards_along_the_Danube_in_Wachau.jpg",
      },
      {
        type: "p",
        text: "Los viñedos en terrazas del Wachau, Patrimonio de la Humanidad, siguen el curso del Danubio, con la torre barroca azul de la abadía de Dürnstein y la ruina del castillo sobre el pueblo al fondo. Las ceremonias de verano entre viñas y los espacios de castillo y abadía cercanos componen la boda clásica del país del vino austriaco, acompañada de un vino blanco excelente.",
      },
      { type: "h2", text: "7. Hohe Mut Alm, Tirol" },
      {
        type: "img",
        src: "https://commons.wikimedia.org/wiki/Special:FilePath/Hohe_Mut_Alm.jpg",
        alt: "El panorama de alta montaña de Hohe Mut Alm, en el Tirol",
        caption: "Hohe Mut Alm, Obergurgl, Tirol",
        credit: "Foto: Tiia Monto / CC BY-SA 3.0, vía Wikimedia Commons",
        creditHref: "https://commons.wikimedia.org/wiki/File:Hohe_Mut_Alm.jpg",
      },
      {
        type: "p",
        text: "Si soñáis con una boda alpina, Hohe Mut Alm está en lo alto de los Alpes de Ötztal y se llega en teleférico. La pareja puede incluso subir en una cabina reservada para la boda, y el panorama de glaciares y cumbres da un fondo insuperable a una ceremonia de montaña tirolesa.",
      },
      { type: "h2", text: "Notas prácticas" },
      {
        type: "p",
        text: "En Austria el matrimonio civil lo celebra la oficina del registro (Standesamt), y muchos palacios y espacios de montaña trabajan con la oficina local para oficiar in situ. Como pareja internacional, contad con tiempo para legalizar y traducir los documentos, así que empezad pronto con los trámites. Las salas más buscadas de Salzburgo y Viena se reservan con hasta un año de antelación.",
      },
      {
        type: "cta",
        lead: "¿Ya tenéis sitio? Con Weddly la lista de invitados, el plano de mesas, el presupuesto y las tareas viven en un mismo lugar, aunque la boda cruce una frontera.",
        href: "/signup",
        label: "Empezar a planificar",
      },
    ],
  },
  "where-to-get-married-in-slovakia": {
    category: "Espacios",
    title: "Dónde casarse en Eslovaquia: 7 escenarios de cuento",
    lead: "De los castillos de libro de cuentos a la orilla de un lago en los Altos Tatras, estos son los lugares más bonitos para casarse en Eslovaquia, con fotos y consejos prácticos.",
    seo_title: "Dónde casarse en Eslovaquia: 7 escenarios de cuento · Weddly",
    seo_description:
      "Los mejores espacios para bodas en Eslovaquia: el castillo de Bojnice, Smolenice, Červený Kameň, el castillo de Bratislava, Château Béla, Štrbské Pleso y Pezinok. Estilos, capacidad y consejos.",
    body: [
      {
        type: "p",
        text: "Eslovaquia está llena de escenarios románticos que quedan sorprendentemente cerca de Hungría: castillos de libro de cuentos inspirados en los châteaux del Loira, fortalezas renacentistas, un castillo que domina el Danubio en Bratislava, el panorama junto al lago de los Altos Tatras y los viñedos de los Pequeños Cárpatos. Aquí van siete lugares donde vale la pena decir sí.",
      },
      { type: "h2", text: "1. Castillo de Bojnice" },
      {
        type: "img",
        src: "https://commons.wikimedia.org/wiki/Special:FilePath/Bojnice_(Bojnitz)_Castle_(by_Pudelek).jpg",
        alt: "La silueta de cuento, llena de torres, del castillo de Bojnice",
        caption: "Castillo de Bojnice (Bojnický zámok), Bojnice",
        credit: "Foto: Pudelek (Marcin Szala) / CC BY-SA 3.0, vía Wikimedia Commons",
        creditHref:
          "https://commons.wikimedia.org/wiki/File:Bojnice_(Bojnitz)_Castle_(by_Pudelek).jpg",
      },
      {
        type: "p",
        text: "El castillo de cuento más famoso de Eslovaquia se reconstruyó a comienzos del siglo XX sobre cimientos medievales, tomando como modelo los châteaux franceses del valle del Loira. Su silueta de torres, el lago y los jardines lo convierten en el monumento más romántico del país y en una localización de rodaje habitual, así que es la elección clásica para una boda de libro de cuentos.",
      },
      { type: "h2", text: "2. Castillo de Smolenice" },
      {
        type: "img",
        src: "https://commons.wikimedia.org/wiki/Special:FilePath/Smolenice_zamok.jpg",
        alt: "La torre neogótica del castillo de Smolenice, en los Pequeños Cárpatos",
        caption: "Castillo de Smolenice (Smolenický zámok), Smolenice",
        credit: "Foto: Kamil Gašparík / dominio público, vía Wikimedia Commons",
        creditHref: "https://commons.wikimedia.org/wiki/File:Smolenice_zamok.jpg",
      },
      {
        type: "p",
        text: "En la ladera oriental de los Pequeños Cárpatos, este castillo neogótico se levantó sobre una fortaleza del siglo XV siguiendo el modelo del Burg Kreuzenstein, cerca de Viena. Hoy es el centro de congresos de la Academia Eslovaca de Ciencias y se alza sobre colinas boscosas, con una torre y jardines cuidados que dan a las bodas un aire exclusivo y privado.",
      },
      { type: "h2", text: "3. Castillo de Červený Kameň" },
      {
        type: "img",
        src: "https://commons.wikimedia.org/wiki/Special:FilePath/Cerveny_Kamen_z_Kukly_02.jpg",
        alt: "La fortaleza renacentista de Červený Kameň sobre los bosques de los Pequeños Cárpatos",
        caption: "Castillo de Červený Kameň (Hrad Červený Kameň), Častá",
        credit: "Foto: Teslaton / CC BY 3.0, vía Wikimedia Commons",
        creditHref: "https://commons.wikimedia.org/wiki/File:Cerveny_Kamen_z_Kukly_02.jpg",
      },
      {
        type: "p",
        text: "Reconstruido como fortaleza en el siglo XVI y más tarde residencia señorial de la familia Pálffy, Červený Kameň es hoy un museo muy bien conservado, con interiores decorados de gran porte y uno de los sistemas de bodegas de castillo más grandes de Europa. Está rodeado por los bosques de la comarca vinícola de los Pequeños Cárpatos, ideal para quien quiera un marco histórico y noble.",
      },
      { type: "h2", text: "4. Castillo de Bratislava" },
      {
        type: "img",
        src: "https://commons.wikimedia.org/wiki/Special:FilePath/Bratislava_-_Burg_(b).JPG",
        alt: "El palacio barroco de cuatro torres del castillo de Bratislava sobre el Danubio",
        caption: "Castillo de Bratislava (Bratislavský hrad), Bratislava",
        credit: "Foto: C.Stadler/Bwag / CC BY-SA 4.0, vía Wikimedia Commons",
        creditHref: "https://commons.wikimedia.org/wiki/File:Bratislava_-_Burg_(b).JPG",
      },
      {
        type: "p",
        text: "Con sus cuatro torres de esquina asomadas al Danubio y al casco antiguo, el castillo de Bratislava es la silueta que define la capital eslovaca. Sus jardines barrocos y el panorama lo hacen el ancla perfecta para una boda urbana, para quien quiera Bratislava de fondo, con buenas conexiones y alojamiento de sobra cerca.",
      },
      { type: "h2", text: "5. Château Béla, sur de Eslovaquia" },
      {
        type: "img",
        src: "https://commons.wikimedia.org/wiki/Special:FilePath/Ka%C5%A1tie%C4%BE_Bel%C3%A1_1.jpg",
        alt: "La casa señorial barroca de Château Béla y su parque",
        caption: "Château Béla (Kaštieľ Belá), Belá",
        credit: "Foto: Mlevicky / CC BY-SA 3.0, vía Wikimedia Commons",
        creditHref: "https://commons.wikimedia.org/wiki/File:Ka%C5%A1tie%C4%BE_Bel%C3%A1_1.jpg",
      },
      {
        type: "p",
        text: "Esta casa señorial barroca del siglo XVIII se restauró en 2008 como hotel boutique de cinco estrellas, cerca de Štúrovo y de la frontera húngara. La finca de 28 hectáreas ofrece un jardín francés, una fuente, una capilla propia y el Salón de los Frescos para las ceremonias, mientras que la sala Orangerie acoge banquetes de hasta unos 140 invitados, acompañados por los vinos de la propia finca.",
      },
      { type: "h2", text: "6. Štrbské Pleso, Altos Tatras" },
      {
        type: "img",
        src: "https://commons.wikimedia.org/wiki/Special:FilePath/StrbskePlesoSommer.jpg",
        alt: "El lago alpino de Štrbské Pleso y las cumbres de los Altos Tatras en verano",
        caption: "Štrbské Pleso, Altos Tatras",
        credit: "Foto: Molch-Entertainment / CC0, vía Wikimedia Commons",
        creditHref: "https://commons.wikimedia.org/wiki/File:StrbskePlesoSommer.jpg",
      },
      {
        type: "p",
        text: "Si soñáis con una boda de montaña, el lago de Štrbské Pleso, en los Altos Tatras, está a unos 1.350 metros, con las cumbres reflejadas en el agua. Las ceremonias en el jardín del hotel junto al lago y los salones panorámicos con vistas a la montaña y al agua componen el escenario de boda de lago y montaña más impactante del país.",
      },
      { type: "h2", text: "7. Castillo de Pezinok, Pequeños Cárpatos" },
      {
        type: "img",
        src: "https://commons.wikimedia.org/wiki/Special:FilePath/Pezinok_Castle_2019.jpg",
        alt: "El castillo de Pezinok, en la comarca vinícola de los Pequeños Cárpatos",
        caption: "Castillo de Pezinok (Zámok Pezinok), Pezinok",
        credit: "Foto: Bratislavský kraj / CC BY 2.0, vía Wikimedia Commons",
        creditHref: "https://commons.wikimedia.org/wiki/File:Pezinok_Castle_2019.jpg",
      },
      {
        type: "p",
        text: "A unos 20 kilómetros de Bratislava, en la ruta del vino de los Pequeños Cárpatos, este castillo reconstruido sobre cimientos del siglo XIII es hoy un hotel con bodega propia, rodeado de un parque de estilo inglés. Las salas flexibles, la cocina de la casa y la bodega en la misma finca lo hacen la elección natural para una boda con el vino como hilo conductor.",
      },
      { type: "h2", text: "Notas prácticas" },
      {
        type: "p",
        text: "En Eslovaquia el matrimonio civil lo celebra la oficina del registro (matrika), y muchos castillos organizan ceremonias in situ con la oficina local. Como pareja internacional, contad con tiempo para legalizar y traducir los documentos, así que empezad pronto con los trámites. Los espacios del sur, como Château Béla, quedan a un trayecto cómodo en coche desde Budapest, lo que los hace una buena opción también para una boda entre dos países.",
      },
      {
        type: "cta",
        lead: "¿Ya tenéis sitio? Con Weddly la lista de invitados, el plano de mesas, el presupuesto y las tareas viven en un mismo lugar.",
        href: "/signup",
        label: "Empezar a planificar",
      },
    ],
  },
  "miert-hazasodunk-a-biblia-szerint": {
    category: "Fe",
    title: "¿Por qué casarse, según la Biblia?",
    lead: "Orden de la creación, pacto, la enseñanza de Jesús y el programa de cada día: así lee la Escritura el sentido del matrimonio.",
    seo_title: "¿Por qué casarse según la Biblia? · Weddly",
    seo_description:
      "¿Qué dice la Biblia sobre el sentido del matrimonio? El orden de la creación, el pacto, la enseñanza de Jesús y el programa práctico de Pablo.",
    body: [
      {
        type: "p",
        text: "Muchas parejas llegan a la pregunta en mitad de la organización: ¿para qué sirve en realidad el matrimonio? ¿Tradición? ¿Romanticismo? ¿Papeleo? La Biblia ofrece algo más: ve el matrimonio como un don inscrito en la creación, con una estructura interna que vale la pena entender.",
      },
      {
        type: "p",
        text: "No es un tratado de dogma, entonces, sino un paseo tranquilo por lo que dice la Escritura sobre el sentido del matrimonio, y por qué puede seguir hablando hoy, tanto si venís con fe como solo con curiosidad.",
      },
      { type: "h2", text: "1. La creación: no es bueno estar solo" },
      {
        type: "p",
        text: "El Génesis no empieza por el matrimonio, pero llega pronto a él. El capítulo 2 dice sin rodeos que estar solo no es plenitud, sino carencia.",
      },
      {
        type: "blockquote",
        cite: "Génesis 2:18",
        text: "Y dijo Jehová Dios: No es bueno que el hombre esté solo; le haré ayuda idónea para él.",
      },
      {
        type: "p",
        text: "El hebreo que hay detrás de «ayuda idónea», ezer kenegdo, pesa más de lo que sugiere la palabra ayudante. Significa una contraparte igual, alguien que se pone enfrente, completa, refleja y corrige con suavidad. Aquí el matrimonio no es una jerarquía: es un encuentro.",
      },
      {
        type: "blockquote",
        cite: "Génesis 2:24",
        text: "Por tanto, dejará el hombre a su padre y a su madre, y se unirá a su mujer, y serán una sola carne.",
      },
      {
        type: "p",
        text: "Tres movimientos en orden: dejar, unirse, ser uno. El matrimonio forma una familia nueva; no sustituye a la anterior, pero pasa al primer lugar. La Escritura vuelve una y otra vez a esta secuencia como fundamento del matrimonio.",
      },
      { type: "h2", text: "2. El matrimonio es un pacto, no un contrato" },
      {
        type: "p",
        text: "La Biblia vuelve siempre a una palabra cuando habla del matrimonio: pacto (en hebreo berit). Un contrato protege el interés de cada parte y se disuelve si se incumple. Un pacto es un compromiso incondicional en presencia de Dios, una fidelidad atada a una persona y no a su rendimiento.",
      },
      {
        type: "blockquote",
        cite: "Malaquías 2:14",
        text: "Porque Jehová ha sido testigo entre ti y la mujer de tu juventud, contra la cual has sido desleal, siendo ella tu compañera, y la mujer de tu pacto.",
      },
      {
        type: "p",
        text: "Malaquías enraíza el matrimonio en el testimonio de Dios. «La mujer de tu pacto»: la misma palabra que la Escritura usa para el vínculo de Dios con su pueblo. Con esa medida, el matrimonio no es solo cosa de dos: es una promesa hecha en público, ante una tercera presencia.",
      },
      { type: "h2", text: "3. Jesús confirma el orden original" },
      {
        type: "p",
        text: "Cuando preguntan a Jesús por el divorcio, su respuesta no empieza por el divorcio. Apunta hacia atrás, hacia la creación.",
      },
      {
        type: "blockquote",
        cite: "Mateo 19:4-6",
        text: "¿No habéis leído que el que los hizo al principio, varón y hembra los hizo,\n\ny dijo: Por esto el hombre dejará padre y madre, y se unirá a su mujer, y los dos serán una sola carne?\n\nPor tanto, lo que Dios juntó, no lo separe el hombre.",
      },
      {
        type: "p",
        text: "Jesús no da aquí una enseñanza nueva: refuerza el orden de la creación. El matrimonio es un pacto que Dios une. «Una sola carne» no es solo lo físico: es la fusión de dos vidas enteras.",
      },
      { type: "h2", text: "4. El programa de cada día: las cartas de Pablo" },
      {
        type: "p",
        text: "Efesios 5 es el pasaje clave que las parejas suelen leer mal al quedarse con un solo versículo. La primera línea enmarca todo lo demás.",
      },
      {
        type: "blockquote",
        cite: "Efesios 5:21, 25",
        text: "Someteos unos a otros en el temor de Dios.\n\nMaridos, amad a vuestras mujeres, así como Cristo amó a la iglesia, y se entregó a sí mismo por ella.",
      },
      {
        type: "p",
        text: "La primera línea da el tono: sumisión mutua. Solo después se dirige Pablo a los maridos, y aun ahí habla de un amor de entrega modelado en Cristo, no de dominio. Si ese orden se altera, el pasaje empieza a decir algo completamente distinto.",
      },
      { type: "p", text: "Colosenses 3 se ocupa del trabajo diario del matrimonio." },
      {
        type: "blockquote",
        cite: "Colosenses 3:12-14",
        text: "Vestíos, pues, como escogidos de Dios, santos y amados, de entrañable misericordia, de benignidad, de humildad, de mansedumbre, de paciencia;\n\nsoportándoos unos a otros, y perdonándoos unos a otros si alguno tuviere queja contra otro.\n\nY sobre todas estas cosas vestíos de amor, que es el vínculo perfecto.",
      },
      {
        type: "p",
        text: "No son momentos cumbre. Son virtudes diarias: misericordia, bondad, paciencia, perdón. La Escritura asienta el matrimonio en estas cualidades duraderas y no solo en el romanticismo.",
      },
      { type: "h2", text: "5. Conflicto y perdón" },
      {
        type: "p",
        text: "La Biblia no maquilla el matrimonio. Da por hecho que habrá conflicto, heridas y cansancio. No promete que podáis evitarlos, solo que hay una manera de atravesarlos.",
      },
      {
        type: "blockquote",
        cite: "Efesios 4:26",
        text: "Airaos, y no pequéis; no se ponga el sol sobre vuestro enojo.",
      },
      {
        type: "p",
        text: "Pablo no dice «no os enfadéis». Dice que no dejéis que se enquiste. Que no se ponga el sol sobre ello, que no llevéis a mañana lo que todavía hoy se puede arreglar con una palabra, con un perdón.",
      },
      { type: "h2", text: "6. El cordón de tres dobleces" },
      {
        type: "p",
        text: "Un pasaje clásico del Eclesiastés no habla directamente del matrimonio, pero desde hace siglos se lee como imagen del pacto.",
      },
      {
        type: "blockquote",
        cite: "Eclesiastés 4:9-12",
        text: "Mejores son dos que uno; porque tienen mejor paga de su trabajo.\n\nPorque si cayeren, el uno levantará a su compañero.\n\nY si alguno prevaleciere contra uno, dos le resistirán; y cordón de tres dobleces no se rompe pronto.",
      },
      {
        type: "p",
        text: "En la lectura cristiana, ese «cordón de tres dobleces» sois los dos más Dios: tres hebras trenzadas en una. Aquí el matrimonio no es un vínculo privado entre dos, sino un futuro compartido tejido de tres. Por eso tantas parejas entran en una ceremonia religiosa no como formalidad, sino como quien entra en el pacto mismo.",
      },
      { type: "h2", text: "7. Ideas para llevarse" },
      { type: "h3", text: "El matrimonio no es solo cosa de dos" },
      {
        type: "p",
        text: "En la Escritura el matrimonio es un pacto, y todo pacto se hace ante un tercero. Por eso la promesa pública, los testigos y, para quien cree, la presencia de Dios no son añadidos, sino el corazón del asunto.",
      },
      { type: "h3", text: "El amor es una decisión, no un estado de ánimo" },
      {
        type: "p",
        text: "El amor del que habla la Escritura (en hebreo chesed, en griego agape) no es un estado de ánimo: es una elección fiel. Y eso libera en silencio: el matrimonio no tiene que sostenerse sobre si hoy los dos «lo sentís». Se sostiene sobre la elección que renováis cada mañana.",
      },
      { type: "h3", text: "El perdón es una práctica diaria" },
      {
        type: "p",
        text: "Dos vidas juntas significan un goteo constante de pequeñas heridas y pequeñas reparaciones. La Biblia no pide que no haya conflicto, solo que no os durmáis encima. «Que no se ponga el sol sobre vuestro enojo» quizá sea el consejo matrimonial más terrenal que da la Escritura.",
      },
      {
        type: "cta",
        lead: "Si además queréis llevar en un solo sitio la parte práctica de la boda (lista de invitados, presupuesto, RSVP, mesas), empezad con Weddly.",
        href: "/signup",
        label: "Empezar a planificar",
      },
      { type: "h2", text: "Preguntas frecuentes" },
      { type: "h3", text: "¿Qué significa que el matrimonio es un pacto?" },
      {
        type: "p",
        text: "Un pacto no es un contrato. Los contratos protegen el interés de cada parte y se disuelven al incumplirse. Un pacto es un compromiso público, ante un tercero, que ata la fidelidad a una persona y no a su rendimiento.",
      },
      { type: "h3", text: "¿Qué significa la sumisión en el matrimonio?" },
      {
        type: "p",
        text: "La clave es Efesios 5:21: sumisión mutua. No una subordinación en un solo sentido, sino atención, humildad y respeto del uno hacia el otro. Lo que se pide al marido (Ef 5:25) es amor de entrega, no dominio.",
      },
      { type: "h3", text: "¿Qué dice la Biblia sobre el conflicto?" },
      {
        type: "p",
        text: "La Escritura no niega el conflicto. Da un marco: hablar con verdad (Ef 4:25), reconciliarse pronto (Ef 4:26), perdonarse (Col 3:13). El conflicto no es el defecto del matrimonio: es su terreno de mantenimiento.",
      },
      { type: "h3", text: "¿Hay que casarse por la iglesia?" },
      {
        type: "p",
        text: "La ceremonia civil resuelve la parte legal. La religiosa es una decisión de fe y una promesa pública ante Dios. Las dos no se excluyen: muchas parejas celebran ambas el mismo día.",
      },
    ],
  },
  "bibliai-idezetek-eskuvore": {
    category: "Versículos",
    title: "Versículos bíblicos para la boda: amor, matrimonio y vida en común",
    lead: "Una selección de versículos para invitaciones, ceremonias y votos: amor, matrimonio, fidelidad y perdón.",
    seo_title: "Versículos bíblicos para bodas: amor y matrimonio · Weddly",
    seo_description:
      "Una selección de versículos bíblicos para bodas: amor, matrimonio, fidelidad, perdón y vida en común.",
    body: [
      {
        type: "p",
        text: "Muchas parejas quieren un versículo bíblico en la invitación, en la web de la boda o dentro de los votos. Abajo tenéis una selección agrupada por temas: amor, matrimonio, vida en común, respeto y perdón.",
      },
      { type: "h2", text: "Versículos breves para invitaciones" },
      {
        type: "ul",
        items: [
          "„El mayor de ellos es el amor.”, 1 Corintios 13,13",
          "„Todas vuestras cosas sean hechas con amor.”, 1 Corintios 16,14",
          "„Amados, amémonos unos a otros.”, 1 Juan 4,7",
          "„Dios es amor.”, 1 Juan 4,8",
          "„En el amor no hay temor.”, 1 Juan 4,18",
          "„No es bueno que el hombre esté solo.”, Génesis 2,18",
          "„Los dos serán una sola carne.”, Marcos 10,8",
          "„Lo que Dios juntó, no lo separe el hombre.”, Marcos 10,9",
          "„Cordón de tres dobleces no se rompe pronto.”, Eclesiastés 4,12",
          "„Yo soy de mi amado, y mi amado es mío.”, Cantares 2,16",
          "„Fuerte es como la muerte el amor.”, Cantares 8,6",
        ],
      },
      { type: "h2", text: "Sobre el amor" },
      { type: "h3", text: "1 Corintios 13:4-8" },
      {
        type: "blockquote",
        cite: "1 Corintios 13:4-8",
        text: "El amor es sufrido, es benigno; el amor no tiene envidia, el amor no es jactancioso, no se envanece;\n\nno hace nada indebido, no busca lo suyo, no se irrita, no guarda rencor;\n\nno se goza de la injusticia, mas se goza de la verdad.\n\nTodo lo sufre, todo lo cree, todo lo espera, todo lo soporta.\n\nEl amor nunca deja de ser.",
      },
      {
        type: "p",
        text: "Pablo casi desmonta aquí el amor: no como sentimiento, sino como una serie de gestos pequeños y diarios, paciencia, bondad, humildad, aguante. No son palabras que se puedan interpretar en un solo día; se aprenden despacio, en la vida corriente. El matrimonio es justo esa escuela: practicar, día tras día, la clase de amor que nunca se acaba.",
      },
      { type: "h3", text: "1 Juan 4:7-8" },
      {
        type: "blockquote",
        cite: "1 Juan 4:7-8",
        text: "Amados, amémonos unos a otros; porque el amor es de Dios. Todo aquel que ama, es nacido de Dios, y conoce a Dios.\n\nEl que no ama, no ha conocido a Dios; porque Dios es amor.",
      },
      {
        type: "p",
        text: "Juan va a la raíz: donde hay amor, está Dios, incluso cuando no lo nombramos. El amor no es un invento nuestro, sino el eco de algo más grande. Así que cuando dos personas se vuelven la una hacia la otra, hacen más de lo que saben: transmiten un amor que antes les fue dado.",
      },
      { type: "h2", text: "Sobre el matrimonio" },
      { type: "h3", text: "Génesis 2:18, 24" },
      {
        type: "blockquote",
        cite: "Génesis 2:18, 24",
        text: "Y dijo Jehová Dios: No es bueno que el hombre esté solo; le haré ayuda idónea para él.\n\nPor tanto, dejará el hombre a su padre y a su madre, y se unirá a su mujer, y serán una sola carne.",
      },
      {
        type: "p",
        text: "En todo el relato de la creación, esto es lo primero que Dios llama no bueno: la soledad. No un defecto ni un fallo, simplemente la forma de ser humano. Estamos hechos para ser acogidos por otro, y el matrimonio da a ese anhelo un nombre y una casa: dos vidas que se vuelven la una hacia la otra porque ninguna se basta a sí misma.",
      },
      { type: "h3", text: "Marcos 10:6-9" },
      {
        type: "blockquote",
        cite: "Marcos 10:6-9",
        text: "Pero al principio de la creación, varón y hembra los hizo Dios.\n\nPor esto dejará el hombre a su padre y a su madre, y se unirá a su mujer,\n\ny los dos serán una sola carne; así que no son ya más dos, sino uno.\n\nPor tanto, lo que Dios juntó, no lo separe el hombre.",
      },
      {
        type: "p",
        text: "Jesús se remonta al principio: el matrimonio no es un arreglo privado, sino algo que une Dios mismo. Esa expresión, lo que Dios juntó, es suave y grave a la vez: no dos vidas pegadas una al lado de la otra, sino entretejidas en una. Y lo que Dios teje, nos pide que lo tratemos con cuidado.",
      },
      { type: "h3", text: "Efesios 5:21, 25" },
      {
        type: "blockquote",
        cite: "Efesios 5:21, 25",
        text: "Someteos unos a otros en el temor de Dios.\n\nMaridos, amad a vuestras mujeres, así como Cristo amó a la iglesia, y se entregó a sí mismo por ella.",
      },
      {
        type: "p",
        text: "Pablo empieza con la sumisión mutua y termina con un marido que ama como amó Cristo, un amor que se entregó del todo. La imagen no es de jerarquía, sino de rodillas en el suelo: cada uno inclinándose hacia el otro, dispuesto a servir primero. El matrimonio vive en ese descenso compartido, donde ninguno intenta ganar y los dos quedan sostenidos.",
      },
      { type: "h2", text: "Sobre la vida en común y el aguante" },
      { type: "h3", text: "Eclesiastés 4:9-12" },
      {
        type: "blockquote",
        cite: "Eclesiastés 4:9-12",
        text: "Mejores son dos que uno; porque tienen mejor paga de su trabajo.\n\nPorque si cayeren, el uno levantará a su compañero; pero ¡ay del solo! que cuando cayere, no habrá segundo que lo levante.\n\nY si alguno prevaleciere contra uno, dos le resistirán; y cordón de tres dobleces no se rompe pronto.",
      },
      {
        type: "p",
        text: "El Predicador es sobrio: en la vida uno se cae. No es un si, es un cuando. Y en ese hecho simple está el regalo de tener compañía, alguien que se agacha y levanta al otro. El cordón de tres dobleces, leído a menudo como la pareja y Dios, nombra la esperanza de fondo: que el vínculo que sostiene a dos personas es más fuerte que cualquiera de ellas por separado.",
      },
      { type: "h3", text: "Rut 1:16-17" },
      {
        type: "blockquote",
        cite: "Rut 1:16-17",
        text: "No me ruegues que te deje, y me aparte de ti; porque a dondequiera que tú fueres, iré yo, y dondequiera que vivieres, viviré. Tu pueblo será mi pueblo, y tu Dios mi Dios.\n\nDonde tú murieres, moriré yo, y allí seré sepultada.",
      },
      {
        type: "p",
        text: "Rut dice estas palabras a una mujer mayor y, aun así, llevan dentro el corazón de un voto matrimonial. No solo iré contigo, sino tu pueblo será mi pueblo, tu Dios mi Dios. Es la entrega entera, sin condiciones, la clase de pertenencia que el matrimonio aprende a vivir día tras día, en los lugares corrientes.",
      },
      { type: "h2", text: "Sobre el respeto, la paciencia y el perdón" },
      { type: "h3", text: "Efesios 4:1-3" },
      {
        type: "blockquote",
        cite: "Efesios 4:1-3",
        text: "Yo pues, preso en el Señor, os ruego que andéis como es digno de la vocación con que fuisteis llamados,\n\ncon toda humildad y mansedumbre, soportándoos con paciencia los unos a los otros en amor,\n\nsolícitos en guardar la unidad del Espíritu en el vínculo de la paz.",
      },
      {
        type: "p",
        text: "Pablo no reparte palabras grandiosas: reparte la ropa de diario de una vida compartida. Humildad, mansedumbre, paciencia, soportarse en amor. Ninguna de ellas brilla, y sin embargo son las que mantienen viva la paz cuando dos vidas rozan. El gran sí de una boda se sostiene sobre incontables síes pequeños posteriores.",
      },
      { type: "h3", text: "Colosenses 3:12-14" },
      {
        type: "blockquote",
        cite: "Colosenses 3:12-14",
        text: "Vestíos, pues, como escogidos de Dios, santos y amados, de entrañable misericordia, de benignidad, de humildad, de mansedumbre, de paciencia;\n\nsoportándoos unos a otros, y perdonándoos unos a otros si alguno tuviere queja contra otro: de la manera que Cristo os perdonó, así también hacedlo vosotros.\n\nY sobre todas estas cosas vestíos de amor, que es el vínculo perfecto.",
      },
      {
        type: "p",
        text: "Pablo habla de vestirse: cada mañana ponerse la misericordia, la bondad, la humildad, la mansedumbre, la paciencia, y sobre todas ellas el amor, como un abrigo que sujeta el resto. El matrimonio no es un sentimiento que se espera sentir: es una prenda que uno se pone, día tras día, y lleva puesta en dirección al otro.",
      },
      { type: "h2", text: "Pasajes románticos del Cantar de los Cantares" },
      { type: "h3", text: "Cantares 2:10-13" },
      {
        type: "blockquote",
        cite: "Cantares 2:10-13",
        text: "Mi amado habló, y me dijo: Levántate, oh amiga mía, hermosa mía, y ven.\n\nPorque he aquí ha pasado el invierno, se ha mudado, la lluvia se fue;\n\nse han mostrado las flores en la tierra, el tiempo de la canción ha venido.",
      },
      {
        type: "p",
        text: "«Levántate, amada mía, y ven», llama el amado, y el invierno, la lluvia y la oscuridad ya han quedado atrás. El Cantar apunta a algo más grande que dos enamorados: todo comienzo verdadero suena así. También el matrimonio es una llamada de este tipo: la larga estación de estar solo toca a su fin y llega el tiempo de la canción.",
      },
      { type: "h3", text: "Cantares 8:6-7" },
      {
        type: "blockquote",
        cite: "Cantares 8:6-7",
        text: "Ponme como un sello sobre tu corazón, como una marca sobre tu brazo; porque fuerte es como la muerte el amor.\n\nLas muchas aguas no podrán apagar el amor, ni lo ahogarán los ríos.",
      },
      {
        type: "p",
        text: "«Ponme como un sello sobre tu corazón»: quien ama no pide una promesa pasajera, sino una marca que dure. Y la fuerza del amor se nombra en el mismo aliento que la muerte: muchas aguas no pueden apagarlo, ninguna riada puede llevárselo. El matrimonio asume esa clase de amor, fuerte no porque los días sean fáciles, sino porque permanece en los difíciles.",
      },
      { type: "h2", text: "Cómo elegir" },
      {
        type: "p",
        text: "Haced que el versículo case con el tono. Una ceremonia clásica y formal pide 1 Corintios 13 o Efesios 5; una ceremonia al aire libre y poética encaja mejor con el Cantar de los Cantares. Para una invitación, un versículo corto (1 Corintios 13,13 o Cantares 2,16) funciona casi siempre.",
      },
      {
        type: "p",
        text: "Si vuestra lista de invitados es variada, elegid un pasaje de mensaje humano y comprensible para todos, como Eclesiastés 4 o Colosenses 3.",
      },
      {
        type: "cta",
        lead: "Si además queréis organizar en un solo sitio la parte práctica de la boda (lista de invitados, presupuesto, RSVP, mesas), probad Weddly.",
        href: "/signup",
        label: "Empezar a planificar",
      },
      { type: "h2", text: "Preguntas frecuentes" },
      { type: "h3", text: "¿Cuál es el pasaje bíblico más conocido en las bodas?" },
      {
        type: "p",
        text: "1 Corintios 13, sobre todo el pasaje del «el amor es sufrido, es benigno» y la línea final: «el mayor de ellos es el amor».",
      },
      { type: "h3", text: "¿Qué versículo corto sirve para una invitación?" },
      {
        type: "p",
        text: "Buenas opciones breves: 1 Corintios 13,13, 1 Juan 4,7, Eclesiastés 4,12 y Cantares 2,16.",
      },
      { type: "h3", text: "¿Qué pasaje encaja mejor con los votos?" },
      {
        type: "p",
        text: "Génesis 2,24, Marcos 10,6-9 y Efesios 5 son los anclajes bíblicos más sólidos para el carácter de pacto del matrimonio.",
      },
    ],
  },
};
