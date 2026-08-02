/**
 * Inline-SVG product mockups for the public surface. These are
 * stylised renderings of the actual app — dashboard, budget, guest
 * list, seating canvas, vendor listing — used as feature illustrations
 * on the landing and vendors pages, plus three couple-portrait avatars
 * for the testimonials block.
 *
 * All colours come from design tokens: each colour group is wrapped in
 * a `<g className="text-…">` and inner shapes use `currentColor`. SVG
 * text inherits the parent's `font-family`, so we set `font-serif` /
 * `font-sans` on group wrappers to keep typography in step with the
 * surrounding page.
 *
 * Visible text is localised via `useT()` so HU users see HU labels.
 * Sample names ("Allie & Noah", supplier name) are intentionally kept
 * static — they read naturally in both locales.
 */

import { useT } from "../lib/i18n";
import { intlLocale } from "../lib/format";

type Common = { className?: string };

/** Five-point star, centred on 0,0 (outer r 6.5, inner r 2.6), so it can be
 *  dropped anywhere with a translate. Used for the rating glyph on the vendor
 *  listing card, where a lucide icon can't go: these mockups are one inline
 *  SVG each and every shape is hand-drawn. */
const STAR_PATH =
  "M 0 -6.5 L 1.53 -2.1 L 6.18 -2.01 L 2.47 0.8 L 3.82 5.26 L 0 2.6 L -3.82 5.26 L -2.47 0.8 L -6.18 -2.01 L -1.53 -2.1 Z";

const TABLE_DEGS = [0, 60, 120, 180, 240, 300] as const;
const HEAD_TABLE_X = [-18, -6, 6, 18] as const;
const STATUS_DOT_OFFSETS = [0, 16, 32, 48, 64] as const;

const BUDGET_CATS: { key: string; spent: number; total: number; tone: "primary" | "muted" }[] = [
  { key: "Catering", spent: 132, total: 168, tone: "primary" },
  { key: "Venue", spent: 96, total: 96, tone: "primary" },
  { key: "Photo", spent: 22, total: 36, tone: "primary" },
  { key: "Music", spent: 14, total: 24, tone: "muted" },
  { key: "Decor", spent: 18, total: 32, tone: "muted" },
  { key: "Other", spent: 8, total: 24, tone: "muted" },
];

const BUDGET_LABELS_HU: Record<string, string> = {
  Catering: "Catering",
  Venue: "Helyszín",
  Photo: "Fotó",
  Music: "Zene",
  Decor: "Dekor",
  Other: "Egyéb",
};

/** Budget feature mockup — a focused panel with headcount slider,
 *  six category bars, and a total summary line. */
export function BudgetMockup({ className }: Common) {
  const { t, locale } = useT();
  const labelFor = (key: string) => (locale === "hu" ? (BUDGET_LABELS_HU[key] ?? key) : key);
  return (
    <svg
      viewBox="-8 -8 496 376"
      role="img"
      aria-label={t("landing.mockup_aria_budget")}
      className={className}
    >
      <g className="text-ink-900" opacity="0.06">
        <rect x="4" y="10" width="480" height="360" rx="16" fill="currentColor" />
      </g>
      <g className="text-paper-200">
        <rect
          x="0"
          y="0"
          width="480"
          height="360"
          rx="16"
          fill="white"
          stroke="currentColor"
          strokeWidth="1"
        />
      </g>

      {/* Header */}
      <g className="text-ink-500 font-sans uppercase">
        <text x="24" y="34" fontSize="9" fontWeight="600" fill="currentColor" letterSpacing="1">
          {t("nav.budget")}
        </text>
      </g>
      <g className="font-serif text-ink-900">
        <text x="24" y="60" fontSize="18" fill="currentColor">
          {t("landing.mockup_live_budget_label")}
        </text>
      </g>

      {/* Slider */}
      <g className="text-paper-300">
        <line
          x1="24"
          y1="92"
          x2="456"
          y2="92"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
      <g className="text-umber-600">
        <line
          x1="24"
          y1="92"
          x2="324"
          y2="92"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="324" cy="92" r="8" fill="currentColor" />
        <circle cx="324" cy="92" r="4" fill="white" />
      </g>
      <g className="text-ink-500 font-sans">
        <text x="24" y="112" fontSize="10" fill="currentColor">
          80
        </text>
        <text x="448" y="112" fontSize="10" fill="currentColor" textAnchor="end">
          200
        </text>
      </g>

      {/* Category rows */}
      {BUDGET_CATS.map((cat, i) => {
        const y = 144 + i * 28;
        const pct = (cat.spent / cat.total) * 100;
        return (
          <g key={cat.key}>
            <g className="text-ink-700 font-sans">
              <text x="24" y={y + 4} fontSize="11" fill="currentColor">
                {labelFor(cat.key)}
              </text>
            </g>
            <g className="text-paper-200">
              <rect x="120" y={y - 5} width="280" height="9" rx="4.5" fill="currentColor" />
            </g>
            <g className={cat.tone === "primary" ? "text-umber-600" : "text-umber-300"}>
              <rect
                x="120"
                y={y - 5}
                width={(280 * pct) / 100}
                height="9"
                rx="4.5"
                fill="currentColor"
              />
            </g>
            <g className="text-ink-500 font-sans">
              <text x="456" y={y + 4} fontSize="10" fill="currentColor" textAnchor="end">
                {cat.spent}k / {cat.total}k
              </text>
            </g>
          </g>
        );
      })}

      {/* Total */}
      <g className="text-paper-200">
        <line x1="24" y1="324" x2="456" y2="324" stroke="currentColor" strokeWidth="1" />
      </g>
      <g className="text-ink-700 font-sans">
        <text x="24" y="346" fontSize="11" fill="currentColor">
          {t("landing.mockup_total_spend")}
        </text>
      </g>
      <g className="font-serif text-ink-900">
        <text x="456" y="348" fontSize="16" fill="currentColor" textAnchor="end">
          {t("landing.mockup_budget_total_compact")}
        </text>
      </g>
    </svg>
  );
}

const GUEST_ROWS: {
  name: string;
  status: "yes" | "pending" | "no";
  meal: string;
  tone: 1 | 2 | 3 | 4 | 5;
}[] = [
  { name: "Anna Tóth", status: "yes", meal: "Veg", tone: 1 },
  { name: "Bence Kovács", status: "yes", meal: "Beef", tone: 2 },
  { name: "Dóra Nagy", status: "pending", meal: "-", tone: 3 },
  { name: "Marci Szabó", status: "yes", meal: "Beef", tone: 4 },
  { name: "Réka Horváth", status: "no", meal: "-", tone: 5 },
];

const MEAL_LABELS_HU: Record<string, string> = { Beef: "Marha", Veg: "Vegetáriánus" };

/** Guest list mockup — search + 5 guest rows with status pills and
 *  meal-choice column. */
export function GuestListMockup({ className }: Common) {
  const { t, locale } = useT();
  const mealLabel = (m: string) => (locale === "hu" ? (MEAL_LABELS_HU[m] ?? m) : m);
  const statusLabel = (s: "yes" | "pending" | "no") =>
    s === "yes"
      ? t("common.yes")
      : s === "no"
        ? t("common.no")
        : t("landing.mockup_status_pending");
  return (
    <svg
      viewBox="-8 -8 496 376"
      role="img"
      aria-label={t("landing.mockup_aria_guests")}
      className={className}
    >
      <g className="text-ink-900" opacity="0.06">
        <rect x="4" y="10" width="480" height="360" rx="16" fill="currentColor" />
      </g>
      <g className="text-paper-200">
        <rect
          x="0"
          y="0"
          width="480"
          height="360"
          rx="16"
          fill="white"
          stroke="currentColor"
          strokeWidth="1"
        />
      </g>

      <g className="font-serif text-ink-900">
        <text x="24" y="40" fontSize="18" fill="currentColor">
          {t("nav.guests")} · 98 / 120
        </text>
      </g>

      {/* Search bar */}
      <g className="text-paper-300">
        <rect
          x="24"
          y="58"
          width="260"
          height="28"
          rx="14"
          fill="white"
          stroke="currentColor"
          strokeWidth="1"
        />
      </g>
      <g className="text-ink-400 font-sans">
        <circle cx="40" cy="72" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <line
          x1="44"
          y1="76"
          x2="48"
          y2="80"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <text x="56" y="76" fontSize="10" fill="currentColor">
          {t("landing.mockup_search_placeholder")}
        </text>
      </g>
      {/* Filter chips */}
      <g className="text-umber-100">
        <rect x="296" y="58" width="74" height="28" rx="14" fill="currentColor" />
      </g>
      <g className="text-umber-700 font-sans">
        <text x="304" y="76" fontSize="10" fontWeight="600" fill="currentColor">
          {t("landing.mockup_filter_all")} · 120
        </text>
      </g>
      <g className="text-paper-200">
        <rect x="378" y="58" width="78" height="28" rx="14" fill="currentColor" />
      </g>
      <g className="text-ink-700 font-sans">
        <text x="386" y="76" fontSize="10" fill="currentColor">
          {t("landing.mockup_filter_pending")} · 11
        </text>
      </g>

      {/* Header row */}
      <g className="text-ink-400 font-sans">
        <text x="24" y="112" fontSize="9" fontWeight="600" fill="currentColor" letterSpacing="1">
          {t("landing.mockup_col_name")}
        </text>
        <text x="240" y="112" fontSize="9" fontWeight="600" fill="currentColor" letterSpacing="1">
          {t("landing.mockup_col_status")}
        </text>
        <text x="370" y="112" fontSize="9" fontWeight="600" fill="currentColor" letterSpacing="1">
          {t("landing.mockup_col_meal")}
        </text>
      </g>

      {GUEST_ROWS.map((row, i) => {
        const y = 132 + i * 40;
        const statusColor =
          row.status === "yes"
            ? "text-sage-500"
            : row.status === "pending"
              ? "text-paper-500"
              : "text-ink-300";
        const statusBg =
          row.status === "yes"
            ? "text-sage-100"
            : row.status === "pending"
              ? "text-paper-200"
              : "text-ink-100";
        const statusFg =
          row.status === "yes"
            ? "text-sage-700"
            : row.status === "pending"
              ? "text-ink-700"
              : "text-ink-500";
        // Avatar dots cycle through calm naturals (sage / paper / ink) instead
        // of the previous loud blush tones — the page already carries blush
        // accents elsewhere; here we want the mockup to feel restful.
        const avatarTones = {
          1: "text-sage-200",
          2: "text-paper-300",
          3: "text-ink-100",
          4: "text-sage-100",
          5: "text-paper-400",
        } as const;
        return (
          <g key={row.name}>
            <g className={avatarTones[row.tone]}>
              <circle cx="36" cy={y} r="10" fill="currentColor" />
            </g>
            <g className="text-ink-800 font-sans">
              <text x="56" y={y + 4} fontSize="11" fill="currentColor">
                {row.name}
              </text>
            </g>
            <g className={statusBg}>
              <rect x="240" y={y - 9} width="86" height="18" rx="9" fill="currentColor" />
            </g>
            <g className={statusColor}>
              <circle cx="252" cy={y} r="3" fill="currentColor" />
            </g>
            <g className={`${statusFg} font-sans`}>
              <text x="262" y={y + 3} fontSize="10" fontWeight="600" fill="currentColor">
                {statusLabel(row.status)}
              </text>
            </g>
            <g className="text-ink-700 font-sans">
              <text x="370" y={y + 4} fontSize="10" fill="currentColor">
                {mealLabel(row.meal)}
              </text>
            </g>
            {/* No divider between rows 0 and 1 — they share a household. */}
            {i < GUEST_ROWS.length - 1 && i !== 0 && (
              <g className="text-paper-200">
                <line
                  x1="24"
                  y1={y + 18}
                  x2="456"
                  y2={y + 18}
                  stroke="currentColor"
                  strokeWidth="1"
                />
              </g>
            )}
          </g>
        );
      })}

      {/* Household marker — Anna Tóth + Bence Kovács are one household: the
          divider between their rows is dropped and a gold spine with a small
          home node links the two avatars on the left. */}
      <g aria-hidden>
        <g className="text-umber-300">
          <line
            x1="16"
            y1="132"
            x2="16"
            y2="172"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
        <g className="text-umber-500">
          <circle cx="16" cy="152" r="6" fill="currentColor" />
        </g>
        <g className="text-white">
          <path
            d="M 13.5 152.5 L 16 150.5 L 18.5 152.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M 14.2 152 L 14.2 154.5 L 17.8 154.5 L 17.8 152"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </g>
    </svg>
  );
}

/** Seating canvas mockup — top-down venue with five round tables, a
 *  head table, and a guest card being dragged. */
export function SeatingMockup({ className }: Common) {
  const { t } = useT();
  const tables: { x: number; y: number; key: string; label: string }[] = [
    { x: 110, y: 200, key: "family", label: t("landing.mockup_table_family") },
    { x: 220, y: 180, key: "friends", label: t("landing.mockup_table_friends") },
    { x: 330, y: 200, key: "plusOnes", label: t("landing.mockup_table_plus_ones") },
    { x: 160, y: 290, key: "work", label: t("landing.mockup_table_work") },
    { x: 280, y: 290, key: "uni", label: t("landing.mockup_table_uni") },
  ];
  return (
    <svg
      viewBox="-8 -8 496 376"
      role="img"
      aria-label={t("landing.mockup_aria_seating")}
      className={className}
    >
      <g className="text-ink-900" opacity="0.06">
        <rect x="4" y="10" width="480" height="360" rx="16" fill="currentColor" />
      </g>
      <g className="text-paper-200">
        <rect
          x="0"
          y="0"
          width="480"
          height="360"
          rx="16"
          fill="white"
          stroke="currentColor"
          strokeWidth="1"
        />
      </g>

      {/* Toolbar */}
      <g className="text-ink-500 font-sans">
        <text x="24" y="24" fontSize="9" fontWeight="600" fill="currentColor" letterSpacing="1">
          {t("landing.mockup_canvas_label")}
        </text>
      </g>
      {/* Add table chip */}
      <g className="text-umber-600">
        <rect x="332" y="12" width="124" height="22" rx="11" fill="currentColor" />
      </g>
      <g className="text-white font-sans">
        <text x="394" y="27" fontSize="10" fontWeight="600" fill="currentColor" textAnchor="middle">
          {t("landing.mockup_add_table")}
        </text>
      </g>

      {/* Canvas + tables nudged up so there's less white above the toolbar
          and the gap below it stays tight. */}
      <g transform="translate(0, -16)">
        {/* Floor / grid */}
        <g className="text-paper-100">
          <rect x="16" y="60" width="448" height="298" rx="8" fill="currentColor" />
        </g>
        <g className="text-paper-300">
          {[88, 152, 216, 280].map((y) => (
            <line
              key={`h-${y}`}
              x1="16"
              y1={y}
              x2="464"
              y2={y}
              stroke="currentColor"
              strokeWidth="0.5"
              strokeDasharray="2 4"
            />
          ))}
          {[80, 168, 256, 344, 432].map((x) => (
            <line
              key={`v-${x}`}
              x1={x}
              y1="60"
              x2={x}
              y2="346"
              stroke="currentColor"
              strokeWidth="0.5"
              strokeDasharray="2 4"
            />
          ))}
        </g>

        {/* Head table */}
        <g transform="translate(220, 92)">
          <g className="text-paper-50">
            <rect x="-50" y="-10" width="100" height="22" rx="4" fill="currentColor" />
          </g>
          <g className="text-ink-700">
            <rect
              x="-50"
              y="-10"
              width="100"
              height="22"
              rx="4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </g>
          <g className="text-umber-600 font-sans">
            <text x="0" y="6" fontSize="9" fontWeight="600" fill="currentColor" textAnchor="middle">
              {t("landing.mockup_table_head")}
            </text>
          </g>
          <g className="text-umber-300">
            {[-32, -16, 0, 16, 32].map((x) => (
              <rect
                key={`htop-${x}`}
                x={x - 3}
                y="-17"
                width="6"
                height="6"
                rx="1.5"
                fill="currentColor"
              />
            ))}
          </g>
        </g>

        {/* Round tables */}
        {tables.map((tbl) => (
          <g key={tbl.key} transform={`translate(${tbl.x}, ${tbl.y})`}>
            <g className="text-paper-50">
              <circle cx="0" cy="0" r="22" fill="currentColor" />
            </g>
            <g className="text-ink-700">
              <circle cx="0" cy="0" r="22" fill="none" stroke="currentColor" strokeWidth="1" />
            </g>
            <g className="text-umber-600 font-sans">
              {(() => {
                // Wrap multi-word labels (e.g. "Plusz egy fő") onto two lines so
                // they stay inside the table circle instead of overflowing.
                const words = tbl.label.split(" ");
                const last = words.at(-1) ?? tbl.label;
                const lines =
                  words.length <= 1 ? [tbl.label] : [words.slice(0, -1).join(" "), last];
                const y0 = lines.length === 1 ? 3 : -1.5;
                return (
                  <text fontSize="8" fontWeight="600" fill="currentColor" textAnchor="middle">
                    {lines.map((ln, i) => (
                      <tspan key={ln} x="0" y={y0 + i * 9}>
                        {ln}
                      </tspan>
                    ))}
                  </text>
                );
              })()}
            </g>
            <g className="text-umber-300">
              {TABLE_DEGS.map((deg) => {
                const rad = (deg * Math.PI) / 180;
                const cx = Math.cos(rad) * 26;
                const cy = Math.sin(rad) * 26;
                return (
                  <rect
                    key={`s-${deg}`}
                    x={cx - 4}
                    y={cy - 3}
                    width="8"
                    height="6"
                    rx="1.5"
                    fill="currentColor"
                    transform={`rotate(${deg + 90} ${cx} ${cy})`}
                  />
                );
              })}
            </g>
          </g>
        ))}

        {/* Dragged guest card */}
        <g transform="translate(380, 270)">
          <g className="text-ink-900" opacity="0.10">
            <rect x="2" y="4" width="80" height="32" rx="6" fill="currentColor" />
          </g>
          <g className="text-paper-300">
            <rect
              x="0"
              y="0"
              width="80"
              height="32"
              rx="6"
              fill="white"
              stroke="currentColor"
              strokeWidth="1"
            />
          </g>
          <g className="text-umber-300">
            <circle cx="14" cy="16" r="6" fill="currentColor" />
          </g>
          <g className="text-ink-800 font-sans">
            <text x="24" y="14" fontSize="9" fontWeight="600" fill="currentColor">
              Dóra N.
            </text>
          </g>
          <g className="text-ink-500 font-sans">
            <text x="24" y="24" fontSize="8" fill="currentColor">
              {t("landing.mockup_drag_subtitle")}
            </text>
          </g>
        </g>
      </g>
    </svg>
  );
}

/** One five-petal blossom for the vendor card's florist badge. Petals are five
 *  filled discs on a ring, which merges into a flower silhouette at any size —
 *  the shape survives the scale a 44-unit badge gets rendered at, where a
 *  stroked outline would not. The centre disc is the BADGE's black, not a hole:
 *  punching it out with a mask would also punch through the stems crossing
 *  behind, and painting it is one element instead of a mask per flower. */
function VendorMockupBlossom({ cx, cy, scale }: { cx: number; cy: number; scale: number }) {
  const petal = 1.7 * scale;
  const ring = 1.8 * scale;
  return (
    <g>
      <g className="text-white">
        {[-90, -18, 54, 126, 198].map((deg) => {
          const rad = (deg * Math.PI) / 180;
          return (
            <circle
              key={deg}
              cx={cx + Math.cos(rad) * ring}
              cy={cy + Math.sin(rad) * ring}
              r={petal}
              fill="currentColor"
            />
          );
        })}
      </g>
      <g className="text-umber-950">
        <circle cx={cx} cy={cy} r={1.05 * scale} fill="currentColor" />
      </g>
    </g>
  );
}

/** Vendor listing mockup — a single supplier card as it appears in
 *  the directory, used on VendorsPage to show vendors what their
 *  listing will look like.
 *
 *  Ride-hailing card layout: photo, then one row of name + rating, then one
 *  muted row of category, city and price band. No "view profile" button — the
 *  whole card is the affordance in the real directory, and a label under it
 *  only repeats what the card already shows.
 *
 *  Every value is a TEMPLATE the vendor fills in ("Your business",
 *  "Category · City"), including the rating: it's the shape of the field, not
 *  a claim about anyone. The review COUNT stays out, since a specific tally is
 *  the part that would read as invented proof. `$$` is the same price-band
 *  symbol the real cards use ("$".repeat(price_band)). */
export function VendorListingMockup({ className }: Common) {
  const { t } = useT();
  return (
    <svg
      viewBox="0 0 360 196"
      role="img"
      aria-label={t("landing.mockup_aria_vendor")}
      className={className}
      style={{ filter: "drop-shadow(3px 6px 14px rgba(28,25,23,0.10))" }}
    >
      <defs>
        {/* Clip the cover photo to the card's top rounded corners (r=16)
            with a straight bottom edge at y=92. */}
        <clipPath id="vendor-cover-clip">
          <path d="M 16 0 Q 0 0 0 16 L 0 92 L 360 92 L 360 16 Q 360 0 344 0 Z" />
        </clipPath>
      </defs>

      {/* Card fill — no stroke; drop-shadow filter on the SVG element provides
          the shadow, so no separate shadow rect is needed (the rect approach
          caused a corner artifact where the offset rect's rx=16 corner was
          visible through the card's own rounded corner gap). */}
      <rect
        x="0"
        y="0"
        width="360"
        height="196"
        rx="16"
        className="text-white dark:text-umber-800"
        fill="currentColor"
      />

      {/* Cover photo — real Unsplash floral/bouquet photo crops to fill the
       *  top strip. The clipPath handles the card's top rounded corners.
       *  Replace the href with the final photo URL before launch. */}
      <image
        href="https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=720&h=184&fit=crop&q=80"
        x="0"
        y="0"
        width="360"
        height="92"
        clipPath="url(#vendor-cover-clip)"
        preserveAspectRatio="xMidYMid slice"
      />

      {/* Profile badge — a white bouquet mark on a black disc.

          It used to be an illustrated portrait, and a portrait is the wrong
          object here whatever it depicts: this card is the "here's your
          listing" mockup, so any face in it is a person the page is implicitly
          claiming, and the vendor reading it has to look past somebody else's
          picture to imagine their own. A mark claims nobody. Black is the only
          fill that stays a badge rather than a smudge where the disc straddles
          the cover photo and the white card below it — and `umber-950` rather
          than `ink-900`, because the landing's black is the warm one; the cool
          navy sits wrong against a photo of a flower-dressed table.

          Drawn as paths, not an asset: it renders at 44 units in a 360-wide
          viewBox, so a bitmap either ships oversized or turns to mush, and the
          petals have to stay crisp at every scale the landing renders this at.
          Petals are FILLED with a punched-out dark centre rather than stroked —
          at this size a 1px outline of a 3px flower is a grey dot. */}
      <g className="text-umber-950">
        <circle cx="40" cy="92" r="22" fill="currentColor" />
      </g>
      {/* Geometry below is written against the badge's own centre (40, 92) and
          then scaled as a whole, so the mark's size is one number to tune
          rather than thirty. 1.18 puts it at ~60% of the disc: enough to carry
          at 44 units, with the padding a badge needs to stay a badge. */}
      <g transform="translate(40 92) scale(1.18) translate(-40 -92)">
        <g className="text-white">
          {/* Stems, gathered into the tie, then cut ends fanning below it. */}
          <g fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
            <path d="M 35.5 88.5 Q 36.5 93 40 97.5" />
            <path d="M 40 85.5 L 40 97.5" />
            <path d="M 44.5 89.5 Q 43.5 93.5 40 97.5" />
            <path d="M 40 99 L 37.6 102.2" />
            <path d="M 40 99 L 40 102.8" />
            <path d="M 40 99 L 42.4 102.2" />
          </g>
          {/* Leaves. */}
          <path d="M 37 92.6 Q 32.8 91.3 31 94.2 Q 35 96 37 92.6 Z" fill="currentColor" />
          <path d="M 43 93.8 Q 47.2 92.6 49 95.5 Q 45 97.3 43 93.8 Z" fill="currentColor" />
          {/* The tie. */}
          <path
            d="M 36.4 97.5 L 43.6 97.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </g>
        {/* Three blossoms: white petals with the disc's own black painted back
            over the middle, so each flower has an eye instead of reading as a
            blob. */}
        <VendorMockupBlossom cx={35.5} cy={86.5} scale={1} />
        <VendorMockupBlossom cx={44.5} cy={87.5} scale={0.92} />
        <VendorMockupBlossom cx={40} cy={83.5} scale={0.8} />
      </g>
      <g className="text-paper-300 dark:text-umber-600">
        <circle cx="40" cy="92" r="22" fill="none" stroke="currentColor" strokeWidth="1" />
      </g>

      {/* Row 1 — name left, rating hard right. */}
      <g className="font-serif text-ink-900 dark:text-paper-100">
        <text x="20" y="150" fontSize="18" fill="currentColor">
          {t("landing.mockup_vendor_name")}
        </text>
      </g>
      <g className="text-star">
        <path d={STAR_PATH} transform="translate(306 145)" fill="currentColor" />
      </g>
      <g className="text-ink-900 font-sans dark:text-paper-100">
        <text x="340" y="150" fontSize="13" fontWeight="600" fill="currentColor" textAnchor="end">
          {t("landing.mockup_vendor_rating")}
        </text>
      </g>

      {/* Row 2 — category, city and price band, all muted. */}
      <g className="text-ink-500 font-sans dark:text-umber-300">
        <text x="20" y="170" fontSize="10" fill="currentColor">
          {t("landing.mockup_vendor_category")}
        </text>
        <text x="340" y="170" fontSize="11" fontWeight="600" fill="currentColor" textAnchor="end">
          {t("landing.mockup_vendor_price")}
        </text>
      </g>
    </svg>
  );
}

/** Refined couple-portrait avatar used in testimonials. Each variant
 *  has its own palette plus distinct hair shapes so the three
 *  testimonials read as different people. */
export function CouplePortrait({ variant, className }: Common & { variant: 1 | 2 | 3 }) {
  const palette =
    variant === 1
      ? {
          bg: "text-umber-100",
          ring: "text-umber-200",
          skinL: "text-umber-200",
          skinR: "text-paper-300",
          hairL: "text-ink-800",
          hairR: "text-umber-700",
          shoulderL: "text-umber-500",
          shoulderR: "text-paper-500",
        }
      : variant === 2
        ? {
            bg: "text-paper-200",
            ring: "text-paper-300",
            skinL: "text-paper-300",
            skinR: "text-umber-200",
            hairL: "text-umber-700",
            hairR: "text-ink-700",
            shoulderL: "text-ink-600",
            shoulderR: "text-umber-300",
          }
        : {
            bg: "text-umber-50",
            ring: "text-umber-200",
            skinL: "text-paper-300",
            skinR: "text-umber-200",
            hairL: "text-ink-800",
            hairR: "text-umber-700",
            shoulderL: "text-paper-500",
            shoulderR: "text-umber-500",
          };
  // Variant-specific hair shapes — same anchor heads but distinct silhouettes.
  const hairLeft =
    variant === 1
      ? "M 22 38 C 22 26, 36 22, 42 26 C 46 24, 50 30, 48 38 C 46 34, 42 32, 38 32 C 34 32, 28 34, 22 38 Z"
      : variant === 2
        ? "M 24 36 C 24 24, 38 22, 44 28 L 46 38 C 42 33, 36 32, 32 33 C 28 34, 25 35, 24 36 Z"
        : "M 22 42 C 20 30, 36 20, 46 28 C 48 32, 48 36, 46 40 C 44 36, 36 34, 30 36 C 26 38, 23 40, 22 42 Z";
  const hairRight =
    variant === 1
      ? "M 50 36 C 50 28, 64 26, 68 32 C 72 32, 72 38, 70 42 C 66 38, 60 36, 56 36 C 53 36, 51 36, 50 36 Z"
      : variant === 2
        ? "M 48 38 C 50 28, 66 26, 70 34 C 71 38, 70 42, 68 44 C 64 40, 58 38, 54 39 C 51 40, 49 40, 48 38 Z"
        : "M 50 36 C 52 28, 66 28, 70 34 C 72 38, 70 42, 68 42 C 64 38, 58 36, 54 37 C 52 38, 50 38, 50 36 Z";
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true" className={className}>
      {/* Frame */}
      <g className={palette.bg}>
        <circle cx="48" cy="48" r="46" fill="currentColor" />
      </g>
      <g className={palette.ring}>
        <circle cx="48" cy="48" r="46" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </g>

      {/* Left figure — back layer */}
      <g className={palette.shoulderL}>
        <path
          d="M 14 90 C 16 70, 28 62, 36 62 C 44 62, 52 68, 54 82 L 54 96 L 14 96 Z"
          fill="currentColor"
        />
      </g>
      <g className={palette.skinL}>
        <ellipse cx="36" cy="40" rx="11" ry="12" fill="currentColor" />
        {/* Neck */}
        <path d="M 32 50 L 32 58 L 40 58 L 40 50 Z" fill="currentColor" />
      </g>
      <g className={palette.hairL}>
        <path d={hairLeft} fill="currentColor" />
      </g>

      {/* Right figure — front layer */}
      <g className={palette.shoulderR}>
        <path
          d="M 42 90 C 44 70, 56 62, 60 62 C 68 62, 80 68, 82 96 L 42 96 Z"
          fill="currentColor"
        />
      </g>
      <g className={palette.skinR}>
        <ellipse cx="60" cy="42" rx="11" ry="12" fill="currentColor" />
        <path d="M 56 52 L 56 60 L 64 60 L 64 52 Z" fill="currentColor" />
      </g>
      <g className={palette.hairR}>
        <path d={hairRight} fill="currentColor" />
      </g>

      {/* Subtle face hints — eyes and small smile arcs */}
      <g className="text-ink-900" opacity="0.78">
        <ellipse cx="33" cy="40" rx="0.9" ry="1.2" fill="currentColor" />
        <ellipse cx="39" cy="40" rx="0.9" ry="1.2" fill="currentColor" />
        <ellipse cx="57" cy="42" rx="0.9" ry="1.2" fill="currentColor" />
        <ellipse cx="63" cy="42" rx="0.9" ry="1.2" fill="currentColor" />
      </g>
      <g className="text-ink-700" opacity="0.55">
        <path
          d="M 33 46 Q 36 48, 39 46"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.8"
          strokeLinecap="round"
        />
        <path
          d="M 57 48 Q 60 50, 63 48"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.8"
          strokeLinecap="round"
        />
      </g>

      {/* Tiny ring/heart between them — wedding cue */}
      <g className="text-umber-600">
        <circle cx="48" cy="58" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </g>
    </svg>
  );
}
