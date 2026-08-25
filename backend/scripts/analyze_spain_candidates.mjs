#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const input = JSON.parse(await readFile(process.argv[2], "utf8"));

const BASE_SCORE = {
  alimentacion: 82,
  alojamiento: 100,
  "automocion-y-transporte": 18,
  belleza: 92,
  "comercio-y-tiendas": 42,
  "educacion-y-formacion": 12,
  "hosteleria-y-restauracion": 96,
  "moda-y-complementos": 88,
  "ocio-y-cultura": 72,
  "publicidad-y-marketing": 64,
  "servicios-empresariales-y-consultoria": 18,
  "servicios-para-el-hogar": 12,
  "servicios-profesionales": 8,
  "turismo-activo": 68,
};

const POSITIVE = [
  [/boda|novi[ao]s?|nupcial|wedding|ceremonia/, 120],
  [/evento|banquete|celebraci[oó]n|fiesta|recinto|sal[oó]n/, 85],
  [/fot[oó]graf|v[ií]deo|audiovisual|dron|film|content|contenido/, 80],
  [/flor|decor|interior|mobiliario|carpa|iluminaci[oó]n/, 75],
  [
    /catering|pasteler|reposter|panader|tarta|gourmet|comida|restaurante|cafeter|bar|vino|bodega|coctel|cervecer/,
    70,
  ],
  [
    /hotel|hostal|alojamiento|apartamento tur[ií]stico|casa rural|posada|albergue|resort|mas[ií]a|finca/,
    70,
  ],
  [/peluquer|maquill|belleza|est[eé]tica|manicura|pedicura|u[nñ]as|estilista|cosm[eé]tic/, 65],
  [/joyer|reloj|vestido|ropa|moda|traje|sastrer|zapater|lencer[ií]a|calzado/, 60],
  [
    /m[uú]sica|orquesta|dj|discoteca|espect[aá]culo|teatro|animaci[oó]n|baile|danza|artes esc[eé]nicas/,
    70,
  ],
  [
    /taxi|limusin|autob[uú]s|autocar|alquiler de (coches|veh[ií]culos|furgonetas)|transporte de viajeros|ch[oó]fer/,
    80,
  ],
  [
    /imprenta|impresi[oó]n|papeler|diseñ|branding|publicidad|regalo|artesan|serigraf|rotulaci[oó]n|packaging/,
    55,
  ],
  [/agencia de viajes|excursi[oó]n|turismo/, 45],
];

const NEGATIVE = [
  [
    /abogad|asesor[ií]a|jur[ií]dic|gestor[ií]a|fiscal|contable|notar[ií]|procurador|seguro|auditor|financier/,
    -220,
  ],
  [
    /construcci[oó]n|reforma|fontaner|electric|cerrajer|caldera|plaga|persiana|saneamiento|climatizaci[oó]n/,
    -180,
  ],
  [
    /taller de coche|taller mec[aá]nico|chapa y pintura|neum[aá]tico|desguace|repuesto|autoescuela|concesionario/,
    -180,
  ],
  [
    /mascota|veterin|canin|guarder[ií]a|educaci[oó]n infantil|academia de (ingl[eé]s|idiomas|oposiciones|refuerzo)|colegio/,
    -170,
  ],
  [
    /industrial|ingenier|maquinaria|laboratorio|software|inform[aá]tic|tecnolog[ií]a|energ[ií]a|qu[ií]mic|metalurgia/,
    -160,
  ],
  [
    /dental|dentista|fisioter|oste[oó]pat|farmacia|nutricion|salud|m[eé]dic|psic[oó]log|terapeuta/,
    -150,
  ],
  [
    /inmobiliaria|mudanza|almacenamiento|limpieza|coworking|recursos humanos|importaci[oó]n|exportaci[oó]n|log[ií]stica/,
    -140,
  ],
  [/bicicleta|motocicleta|n[aá]utica|barco|aventura/, -40],
];

function score(row) {
  const source = row.source_category.split(",")[0];
  const haystack = `${row.name} ${row.category_detail} ${row.website}`.toLocaleLowerCase("es");
  let value = BASE_SCORE[source] || 0;
  for (const [pattern, points] of POSITIVE) if (pattern.test(haystack)) value += points;
  for (const [pattern, points] of NEGATIVE) if (pattern.test(haystack)) value += points;
  return value;
}

const complete = input.rows
  .filter(
    (row) =>
      row.name &&
      row.website &&
      row.contact_email &&
      row.contact_phone &&
      row.image_url &&
      row.address &&
      row.city &&
      row.country === "ES",
  )
  .map((row) => ({ ...row, relevance_score: score(row) }))
  .sort((a, b) => b.relevance_score - a.relevance_score || a.name.localeCompare(b.name, "es"));

for (const threshold of [150, 120, 100, 80, 60, 40, 20, 0]) {
  console.log(
    `score >= ${threshold}: ${complete.filter((row) => row.relevance_score >= threshold).length}`,
  );
}
console.log("2000th score:", complete[1999]?.relevance_score);
console.log("selected by source:");
console.log(
  Object.entries(Object.groupBy(complete.slice(0, 2000), (row) => row.source_category))
    .map(([key, rows]) => [key, rows.length])
    .sort((a, b) => b[1] - a[1]),
);
console.log("boundary:");
for (const row of complete.slice(1970, 2020))
  console.log(row.relevance_score, row.category_detail, row.name);
