/**
 * The game palette, as numbers three.js can use.
 *
 * These are the SAME hexes as the `tailwind.config.js` tokens the couple app
 * uses — ivory/paper, sage, blush, umber, gold — not a second, prettier set
 * invented for the game. A runner that looks like a different brand than the
 * app it lives inside reads as an ad placed in our own product. They live here
 * as numbers only because `THREE.Color` wants components and Tailwind wants CSS;
 * `palette.test.ts` pins every value here to the token it claims to be, so the
 * two cannot drift without the suite noticing.
 *
 * Nothing here is a raw hex in a component: every colour a mesh uses comes
 * from this table, and every colour a DOM element uses comes from a Tailwind
 * token. That is the repo rule, and a 3D scene is exactly where it is easiest
 * to break by accident.
 */
export const PALETTE = {
  /** `paper` — the oat cream the path, the dress and the cake are made of. */
  paper50: "#fbfaf5",
  paper100: "#f6f2e7",
  paper200: "#efe9d9",
  paper300: "#e3d9bf",
  paper400: "#d3c69f",
  paper500: "#bfae7b",
  paper600: "#a18d5d",

  /** `sage` — the garden. Vivid forest green, used for the lawns, the hedges
   *  and the Weddly branding on the tote bags. */
  sage100: "#d6f3dd",
  sage200: "#b1e6c0",
  sage300: "#82d39c",
  sage400: "#50b873",
  sage500: "#2f9c52",
  sage600: "#237f3f",
  sage700: "#1c6633",
  sage800: "#19512b",
  sage900: "#154124",

  /** `blush` — the single warm accent: the bouquet, the arch florals, the
   *  collision flash. */
  blush100: "#fbe9e3",
  blush200: "#f5cdc1",
  blush300: "#eda997",
  blush400: "#e2826a",
  blush500: "#d35d42",
  blush600: "#bf4a30",

  /** `umber` — the warm dark: tuxedo, tree trunks, signage, the manor. */
  umber600: "#4a3a2e",
  umber700: "#3a2e22",
  umber800: "#251c14",
  umber900: "#1a1410",
  umber950: "#0f0a07",

  /** `ink` — the cool navy used for a groom's suit, where the tuxedo needs to
   *  read as tailoring rather than as a brown box in a warm garden. */
  ink700: "#243150",
  ink800: "#1a2440",
  ink900: "#101830",

  /** `moss` — the olive accent for foliage highlights. */
  moss400: "#8eac72",
  moss600: "#3c7c49",

  /** Gold. Not a Tailwind stop, because nothing in the couple app needs it;
   *  the cash, the fairylight glow and the multiplier badge all do. */
  gold: "#f0c66b",
  goldDeep: "#c9992f",
  champagne: "#f7e3b8",
  /** Pickups: a bright yellow coin and a vivid green banknote. */
  coin: "#ffd21a",
  coinDeep: "#f2a900",
  cash: "#2fd65a",
  cashDeep: "#15a03c",
  /** Power-ups: the shield bubble, the magnet's pull, and their pickup ring. */
  shield: "#8fd8f2",
  magnet: "#e2564a",

  /** The sky behind the manor — a warm late-afternoon gradient, not blue. */
  skyTop: "#bcd6e8",
  skyHorizon: "#f6e2c8",
  fog: "#e9dcc4",

  /** Pure white for the dress's highlight pass and the confetti. */
  white: "#ffffff",
  /** A hairline that reads as a printed edge on paper props. */
  ink: "#2b2620",
  /** Reads as "receipt paper" against the warm ground. */
  paper: "#fffaf0",
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** Sky and fog, as `THREE.Color` arguments. */
export const SKY_TOP = PALETTE.skyTop;
export const SKY_HORIZON = PALETTE.skyHorizon;
export const FOG_COLOR = PALETTE.fog;

/**
 * Confetti, as an ARRAY rather than four more keys.
 *
 * A burst has to cycle: four particles of one colour read as a repeated
 * projectile, and a colour per particle would need four more `PALETTE` keys to
 * exist for no other reason. Indexing this table by the particle's own spin
 * angle means the choice costs one array read and the palette stays one flat
 * table of things the scene actually paints.
 */
export const CONFETTI: readonly string[] = [
  PALETTE.blush200,
  PALETTE.blush300,
  PALETTE.champagne,
  PALETTE.paper100,
];

/** The grit kicked up by a stumble and by the runner's own feet. `paper300` is
 *  the path's own colour, so dust never introduces a tone the ground lacks. */
export const DUST = PALETTE.paper300;
