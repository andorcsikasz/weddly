// Editorial line-art stand-in for a wishlist item that has no photo.
//
// Why this exists: a wishlist row's picture comes from the item's link
// (`fetchLinkPreview` resolves the og:image server-side), and a large share of
// real product links never give one up — Booking, most Hungarian webshops and
// anything behind a bot wall answer 403 to any crawler, and plenty of pages
// simply ship no og:image. Those items used to render as a flat tinted box with
// a small gift glyph floating in the middle, which reads as a broken image, not
// as a design. So instead of a placeholder we draw a picture: hand-composed
// line motifs on a warm paper ground, in the same thin-stroke language as
// `illustrations.tsx` / `botanical.tsx`.
//
// The motif is chosen from the item's own title — keywords first (a coffee
// machine gets a cup, a letter gets an envelope), then a stable hash so two
// untitled-alike items still differ and the same item never changes motif
// between renders. Every colour comes from a token via `currentColor`; nothing
// here loads over the network, so it works offline, in email-less previews and
// inside the CSP with no image host allowlisted.

type Motif =
  | "parcel"
  | "bow"
  | "coupes"
  | "cup"
  | "trip"
  | "sprig"
  | "letter"
  | "camera"
  | "note"
  | "rings";

/** Motifs a gift falls back to when no keyword matches. Ordered so adjacent
 *  hashes look different, not just differently drawn. */
const GIFT_POOL: readonly Motif[] = ["parcel", "bow", "sprig", "coupes", "trip", "cup"];
/** Requests are gestures, not boxed things — a parcel would misdescribe them. */
const REQUEST_POOL: readonly Motif[] = ["letter", "note", "rings", "camera", "sprig"];

/** Keyword → motif, checked before the hash. Hungarian and English both, since
 *  a couple types the title in their own language. Order matters: the first
 *  match wins, so the more specific patterns come first. */
const KEYWORD_MOTIFS: ReadonlyArray<[RegExp, Motif]> = [
  [/lev[eé]l|letter|handwritten|k[eé]zzel|[íi]r[aá]s|card|k[aá]rtya/i, "letter"],
  [/fot[oó]|photo|k[eé]p|album|camera|kamera|film/i, "camera"],
  [/dal|song|zen[eé]|music|playlist|lemez|vinyl|hangszer/i, "note"],
  [/id[oő]|time|together|egy[uü]tt|[eé]lm[eé]ny|experience|randi|date/i, "rings"],
  [/k[aá]v[eé]|coffee|espresso|tea|kanna|cup|cs[eé]sze|reggeli|breakfast/i, "cup"],
  [
    /utaz|travel|trip|nyaral|h[eé]tv[eé]g|weekend|hotel|szálloda|szallas|repül|flight|n[aá]sz[uú]t|honeymoon|wellness/i,
    "trip",
  ],
  [/bor|wine|pezsg|champagne|whisk|koktél|cocktail|pohár|glass|vacsora|dinner/i, "coupes"],
  [/vir[aá]g|flower|n[oö]v[eé]ny|plant|kert|garden|tree/i, "sprig"],
  [/szalag|ribbon|meglepet|surprise|bow/i, "bow"],
];

/** Stable 32-bit hash (FNV-1a) so a title always picks the same motif. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function motifFor(seed: string, kind: "gift" | "request"): Motif {
  const pool = kind === "request" ? REQUEST_POOL : GIFT_POOL;
  for (const [re, motif] of KEYWORD_MOTIFS) {
    if (re.test(seed)) {
      // A keyword only wins when the motif suits the kind — a gift titled
      // "letter" is a stationery set, and an envelope is still the right
      // picture, so the gift pool takes request motifs too. The reverse is not
      // true: a request never becomes a parcel.
      if (kind === "gift" || REQUEST_POOL.includes(motif)) return motif;
    }
  }
  const idx = hash(seed) % pool.length;
  return pool[idx] ?? "parcel";
}

// ── Motif geometry ───────────────────────────────────────────────────────────
//
// Every motif is drawn inside a 160×160 box, composed a touch above centre so
// the hairline "shelf" below it reads as a surface the object sits on. Strokes
// only (no fills but the accents), which is what keeps it looking drawn rather
// than iconographic at card size.

const STROKE = { fill: "none", stroke: "currentColor", strokeLinecap: "round" } as const;

/** Leaves for the sprig, laid out along the stem so the code stays short. */
const SPRIG_LEAVES: ReadonlyArray<{ x: number; y: number; a: number }> = [
  { x: 70, y: 116, a: -62 },
  { x: 92, y: 106, a: 58 },
  { x: 74, y: 94, a: -54 },
  { x: 95, y: 84, a: 50 },
  { x: 79, y: 72, a: -44 },
  { x: 97, y: 62, a: 42 },
];

function MotifPaths({ motif }: { motif: Motif }) {
  switch (motif) {
    case "parcel":
      return (
        <>
          <rect x="38" y="76" width="84" height="56" rx="4" {...STROKE} strokeWidth="1.6" />
          <rect x="31" y="63" width="98" height="15" rx="4" {...STROKE} strokeWidth="1.6" />
          <path d="M74 63v69M86 63v69" {...STROKE} strokeWidth="1.6" />
          <path
            d="M80 61C67 57 58 44 66 38c8-6 14 8 14 23"
            {...STROKE}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M80 61c13-4 22-17 14-23-8-6-14 8-14 23"
            {...STROKE}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </>
      );
    case "bow":
      return (
        <>
          <path d="M80 84C52 79 37 57 51 46c14-10 27 15 29 38" {...STROKE} strokeWidth="1.6" />
          <path d="M80 84c28-5 43-27 29-38-14-10-27 15-29 38" {...STROKE} strokeWidth="1.6" />
          <ellipse cx="80" cy="87" rx="8" ry="6" {...STROKE} strokeWidth="1.6" />
          <path d="M75 93c-6 16-13 30-25 40" {...STROKE} strokeWidth="1.6" />
          <path d="M85 93c6 16 13 30 25 40" {...STROKE} strokeWidth="1.6" />
          <path d="M50 133l-9-1 4 8M110 133l9-1-4 8" {...STROKE} strokeWidth="1.4" />
        </>
      );
    case "coupes":
      return (
        <>
          <g transform="rotate(-9 62 92)">
            <path d="M48 48h28c0 21-6 33-14 33s-14-12-14-33z" {...STROKE} strokeWidth="1.6" />
            <path d="M62 81v33M51 116h22" {...STROKE} strokeWidth="1.6" />
          </g>
          <g transform="rotate(9 98 92)">
            <path d="M84 48h28c0 21-6 33-14 33s-14-12-14-33z" {...STROKE} strokeWidth="1.6" />
            <path d="M98 81v33M87 116h22" {...STROKE} strokeWidth="1.6" />
          </g>
        </>
      );
    case "cup":
      return (
        <>
          <path
            d="M50 80h58c0 24-13 38-29 38S50 104 50 80z"
            {...STROKE}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M108 86c15 0 15 18 0 18" {...STROKE} strokeWidth="1.6" />
          <ellipse cx="80" cy="124" rx="40" ry="6" {...STROKE} strokeWidth="1.6" />
          <path d="M70 66c8-6-4-11 2-19M90 68c8-6-4-11 2-19" {...STROKE} strokeWidth="1.4" />
        </>
      );
    case "trip":
      return (
        <>
          <rect x="36" y="72" width="88" height="58" rx="9" {...STROKE} strokeWidth="1.6" />
          <path d="M68 72v-9a5 5 0 015-5h14a5 5 0 015 5v9" {...STROKE} strokeWidth="1.6" />
          <path d="M58 72v58M102 72v58" {...STROKE} strokeWidth="1.4" />
          <path d="M48 130v6M112 130v6" {...STROKE} strokeWidth="1.4" />
        </>
      );
    case "sprig":
      return (
        <>
          <path d="M80 138c-3-30 2-58 16-84" {...STROKE} strokeWidth="1.6" />
          {SPRIG_LEAVES.map((l) => (
            <ellipse
              key={`${l.x}-${l.y}`}
              cx={l.x}
              cy={l.y}
              rx="13"
              ry="7"
              transform={`rotate(${l.a} ${l.x} ${l.y})`}
              {...STROKE}
              strokeWidth="1.5"
            />
          ))}
        </>
      );
    case "letter":
      return (
        <>
          <rect x="30" y="54" width="100" height="70" rx="4" {...STROKE} strokeWidth="1.6" />
          <path d="M30 59l50 39 50-39" {...STROKE} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M30 120l35-32M130 120L95 88" {...STROKE} strokeWidth="1.4" />
        </>
      );
    case "camera":
      return (
        <>
          <rect x="30" y="66" width="100" height="62" rx="10" {...STROKE} strokeWidth="1.6" />
          <path d="M62 66l6-11h24l6 11" {...STROKE} strokeWidth="1.6" strokeLinejoin="round" />
          <circle cx="80" cy="98" r="21" {...STROKE} strokeWidth="1.6" />
          <circle cx="80" cy="98" r="11" {...STROKE} strokeWidth="1.4" />
        </>
      );
    case "note":
      return (
        <>
          <path d="M28 56h104M28 66h104M28 76h104" {...STROKE} strokeWidth="1" opacity="0.45" />
          <ellipse
            cx="62"
            cy="114"
            rx="12"
            ry="8.5"
            transform="rotate(-20 62 114)"
            {...STROKE}
            strokeWidth="1.6"
          />
          <ellipse
            cx="104"
            cy="102"
            rx="12"
            ry="8.5"
            transform="rotate(-20 104 102)"
            {...STROKE}
            strokeWidth="1.6"
          />
          <path d="M73 109V54M115 97V44" {...STROKE} strokeWidth="1.6" />
          <path d="M73 54c14-6 28-9 42-10" {...STROKE} strokeWidth="1.6" />
        </>
      );
    case "rings":
      return (
        <>
          <circle cx="66" cy="94" r="30" {...STROKE} strokeWidth="1.6" />
          <circle cx="100" cy="94" r="30" {...STROKE} strokeWidth="1.6" />
        </>
      );
  }
}

/** The one arc that has to be repainted in the ground colour so the two rings
 *  interlock instead of merely overlapping. Kept out of MotifPaths because it
 *  needs the background token, not the ink one. */
function RingsOverlap() {
  return (
    <>
      <g className="text-paper-100 dark:text-umber-850">
        <path
          d="M78 68a30 30 0 000 52"
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="butt"
        />
      </g>
      <path
        d="M78 68a30 30 0 000 52"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  );
}

/** Where the accent dot sits per motif — the single warm mark that stops the
 *  drawing from reading as a wireframe. */
const ACCENT: Record<Motif, { cx: number; cy: number; r: number }> = {
  parcel: { cx: 80, cy: 62, r: 3.4 },
  bow: { cx: 80, cy: 87, r: 2.6 },
  coupes: { cx: 80, cy: 40, r: 2.8 },
  cup: { cx: 80, cy: 44, r: 2.6 },
  trip: { cx: 80, cy: 95, r: 3.4 },
  sprig: { cx: 96, cy: 52, r: 3.2 },
  letter: { cx: 114, cy: 112, r: 9 },
  camera: { cx: 111, cy: 78, r: 3.4 },
  note: { cx: 129, cy: 42, r: 3 },
  rings: { cx: 66, cy: 64, r: 3.6 },
};

/**
 * Drawn stand-in for a missing wishlist photo. Fills its positioned parent —
 * give the parent `relative` and a size, and pass `className="absolute inset-0
 * h-full w-full"` (the caller controls the frame so the same art works in a
 * 40px list thumbnail and a 4:5 card).
 *
 * `dense` drops the shelf, the stationery hatch and the accent, which is what a
 * thumbnail under ~64px wants: at that size they turn into grey mush.
 */
export function GiftArt({
  seed,
  kind = "gift",
  className = "",
  dense = false,
}: {
  seed: string;
  kind?: "gift" | "request";
  className?: string;
  dense?: boolean;
}) {
  const motif = motifFor(seed, kind);
  const accent = ACCENT[motif];
  const patternId = `giftart-hatch-${motif}${dense ? "-d" : ""}`;
  return (
    <svg
      viewBox="0 0 160 160"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
      className={className}
    >
      {!dense && (
        <>
          {/* Stationery hatch, the same 45° hairline the `.stationery` surface
              uses, at a fraction of its strength so it reads as paper tooth. */}
          <defs>
            <pattern
              id={patternId}
              width="7"
              height="7"
              patternTransform="rotate(45)"
              patternUnits="userSpaceOnUse"
            >
              <line x1="0" y1="0" x2="0" y2="7" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <g className="text-ink-900 dark:text-paper-50" opacity="0.05">
            <rect x="0" y="0" width="160" height="160" fill={`url(#${patternId})`} />
          </g>
        </>
      )}

      {/* The drawing itself. Warm oat on light, warm amber on dark — the
          "coffee" end of the palette rather than the cool ink greys. */}
      <g className="text-paper-600 dark:text-umber-400" opacity={dense ? 0.9 : 0.75}>
        <MotifPaths motif={motif} />
        {motif === "rings" && <RingsOverlap />}
      </g>

      {!dense && (
        <>
          {/* Shelf line: an object needs something to stand on to feel placed
              rather than floated. */}
          <g className="text-paper-600 dark:text-umber-400" opacity="0.35">
            <path
              d="M26 145h108"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
            />
          </g>
          <g className="text-blush-400 dark:text-blush-300" opacity="0.7">
            <circle
              cx={accent.cx}
              cy={accent.cy}
              r={accent.r}
              fill={motif === "letter" ? "none" : "currentColor"}
              stroke={motif === "letter" ? "currentColor" : "none"}
              strokeWidth="1.6"
            />
          </g>
        </>
      )}
    </svg>
  );
}

/**
 * `GiftArt` wrapped in its own framed, warm-ground tile. Most callers want
 * this: it owns the background wash that the art is composed against (and that
 * the interlocking-rings motif over-paints with), so the two can never drift
 * apart.
 */
export function GiftArtTile({
  seed,
  kind = "gift",
  className = "",
  dense = false,
}: {
  seed: string;
  kind?: "gift" | "request";
  className?: string;
  dense?: boolean;
}) {
  return (
    <span
      // The ground is the theme's SURFACE tone, not a shade below it: the tile
      // is often the only thing separating a picture-led card from the page
      // (the wishlist grid draws no border around it), and umber-850 sat close
      // enough to the umber-900 page that a drawn item read as a hole in it.
      className={`relative block overflow-hidden bg-paper-100 dark:bg-umber-800 ${className}`}
      aria-hidden
    >
      <GiftArt seed={seed} kind={kind} dense={dense} className="absolute inset-0 h-full w-full" />
    </span>
  );
}
