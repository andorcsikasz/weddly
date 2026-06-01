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
 * Sample names ("Mia & Lucas", supplier name) are intentionally kept
 * static — they read naturally in both locales.
 */

import { useT } from "../lib/i18n";

type Common = { className?: string };

const TABLE_DEGS = [0, 60, 120, 180, 240, 300] as const;
const HEAD_TABLE_X = [-22, -10, 2, 14] as const;
const STATUS_DOT_OFFSETS = [0, 16, 32, 48, 64] as const;

/** Hero centrepiece — a stylised dashboard view of the app. Sidebar +
 *  main area with three live-looking cards (Budget, Guests, Seating).
 *  ViewBox 656×456 — 640×440 card with a 16px right/bottom buffer so the
 *  drop-shadow rect at (6,14) doesn't clip on the edges of the hero crop. */
export function WorkspaceMockup({ className }: Common) {
  const { t } = useT();
  const navItems: { key: string; label: string }[] = [
    { key: "guests", label: t("nav.guests") },
    { key: "budget", label: t("nav.budget") },
    { key: "seating", label: t("nav.seating") },
    { key: "timeline", label: t("nav.timeline") },
    { key: "logistics", label: t("nav.logistics") },
    { key: "suppliers", label: t("nav.suppliers") },
  ];
  return (
    <svg
      viewBox="0 0 656 456"
      role="img"
      aria-label={t("landing.mockup_aria_dashboard")}
      className={className}
    >
      {/* Card frame */}
      <g className="text-paper-200">
        <rect
          x="0"
          y="0"
          width="640"
          height="440"
          rx="20"
          fill="white"
          stroke="currentColor"
          strokeWidth="1"
        />
      </g>

      {/* Sidebar */}
      <g className="text-paper-100">
        <path
          d="M 0 20 Q 0 0 20 0 L 140 0 L 140 440 L 20 440 Q 0 440 0 420 Z"
          fill="currentColor"
        />
      </g>
      <g className="text-paper-200">
        <line x1="140" y1="0" x2="140" y2="440" stroke="currentColor" strokeWidth="1" />
      </g>

      {/* Brand wordmark */}
      <g className="font-serif text-ink-900">
        <text x="20" y="36" fontSize="20" fill="currentColor">
          Weddly
        </text>
      </g>

      {/* Active nav item — Overview */}
      <g className="text-umber-100">
        <rect x="12" y="78" width="116" height="32" rx="8" fill="currentColor" />
      </g>
      <g className="text-umber-700 font-sans">
        <circle cx="26" cy="94" r="3" fill="currentColor" />
        <text x="40" y="98" fontSize="11" fontWeight="600" fill="currentColor">
          {t("nav.dashboard")}
        </text>
      </g>

      {/* Inactive nav items */}
      {navItems.map((item, i) => {
        const y = 124 + i * 32;
        return (
          <g key={item.key}>
            <g className="text-ink-300">
              <circle cx="26" cy={y + 16} r="3" fill="currentColor" />
            </g>
            <g className="text-ink-600 font-sans">
              <text x="40" y={y + 20} fontSize="11" fill="currentColor">
                {item.label}
              </text>
            </g>
          </g>
        );
      })}

      {/* Sidebar footer chip */}
      <g className="text-paper-300">
        <rect
          x="12"
          y="392"
          width="116"
          height="32"
          rx="8"
          fill="white"
          stroke="currentColor"
          strokeWidth="1"
        />
      </g>
      <g className="text-ink-700 font-sans">
        <circle cx="26" cy="408" r="6" fill="currentColor" opacity="0.18" />
        <text x="40" y="412" fontSize="10" fill="currentColor">
          A &amp; B
        </text>
      </g>

      {/* Main header */}
      <g className="font-serif text-ink-900">
        <text x="168" y="48" fontSize="26" fill="currentColor">
          Mia &amp; Lucas
        </text>
      </g>
      <g className="text-umber-300">
        <rect
          x="436"
          y="26"
          width="180"
          height="28"
          rx="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
      </g>
      <g className="text-umber-700 font-sans">
        <circle cx="450" cy="40" r="3" fill="currentColor" />
        <text x="460" y="44" fontSize="11" fill="currentColor">
          {t("landing.mockup_date")}
        </text>
      </g>

      {/* Budget card */}
      <g className="text-paper-200">
        <rect
          x="168"
          y="80"
          width="216"
          height="140"
          rx="12"
          fill="white"
          stroke="currentColor"
          strokeWidth="1"
        />
      </g>
      <g className="text-ink-500 font-sans uppercase">
        <text x="184" y="104" fontSize="9" fontWeight="600" fill="currentColor" letterSpacing="1">
          {t("nav.budget")}
        </text>
      </g>
      <g className="font-serif text-ink-900">
        <text x="184" y="140" fontSize="22" fill="currentColor">
          {t("landing.mockup_budget_spent")}
        </text>
      </g>
      <g className="font-sans text-ink-500">
        <text x="252" y="140" fontSize="14" fill="currentColor">
          {t("landing.mockup_budget_target")}
        </text>
      </g>
      <g className="text-paper-200">
        <rect x="184" y="156" width="184" height="8" rx="4" fill="currentColor" />
      </g>
      <g className="text-umber-600">
        <rect x="184" y="156" width="148" height="8" rx="4" fill="currentColor" />
      </g>
      <g className="text-paper-300">
        <rect x="184" y="178" width="84" height="3" rx="1.5" fill="currentColor" />
        <rect x="184" y="188" width="120" height="3" rx="1.5" fill="currentColor" />
        <rect x="184" y="198" width="60" height="3" rx="1.5" fill="currentColor" />
      </g>

      {/* Guests card */}
      <g className="text-paper-200">
        <rect
          x="400"
          y="80"
          width="216"
          height="140"
          rx="12"
          fill="white"
          stroke="currentColor"
          strokeWidth="1"
        />
      </g>
      <g className="text-ink-500 font-sans uppercase">
        <text x="416" y="104" fontSize="9" fontWeight="600" fill="currentColor" letterSpacing="1">
          {t("nav.guests")}
        </text>
      </g>
      <g className="font-serif text-ink-900">
        <text x="416" y="140" fontSize="22" fill="currentColor">
          98
        </text>
      </g>
      <g className="font-sans text-ink-500">
        <text x="452" y="140" fontSize="14" fill="currentColor">
          / 120
        </text>
      </g>
      {/* Avatar stack */}
      {STATUS_DOT_OFFSETS.map((dx, i) => (
        <g key={dx} className={i % 2 === 0 ? "text-umber-300" : "text-umber-200"}>
          <circle cx={424 + dx} cy="172" r="9" fill="currentColor" stroke="white" strokeWidth="2" />
        </g>
      ))}
      <g className="text-ink-500 font-sans">
        <text x="500" y="176" fontSize="10" fill="currentColor">
          +93
        </text>
      </g>
      {/* RSVP status pills */}
      <g className="text-umber-100">
        <rect x="416" y="192" width="64" height="14" rx="7" fill="currentColor" />
      </g>
      <g className="text-umber-700 font-sans">
        <text x="424" y="202" fontSize="8" fontWeight="600" fill="currentColor">
          {t("landing.mockup_yes_count", { n: 87 })}
        </text>
      </g>
      <g className="text-paper-200">
        <rect x="486" y="192" width="76" height="14" rx="7" fill="currentColor" />
      </g>
      <g className="text-ink-700 font-sans">
        <text x="494" y="202" fontSize="8" fontWeight="600" fill="currentColor">
          {t("landing.mockup_pending_count", { n: 11 })}
        </text>
      </g>

      {/* Seating card */}
      <g className="text-paper-200">
        <rect
          x="168"
          y="236"
          width="448"
          height="180"
          rx="12"
          fill="white"
          stroke="currentColor"
          strokeWidth="1"
        />
      </g>
      <g className="text-ink-500 font-sans uppercase">
        <text x="184" y="260" fontSize="9" fontWeight="600" fill="currentColor" letterSpacing="1">
          {t("nav.seating")}
        </text>
      </g>
      <g className="font-serif text-ink-900">
        <text x="184" y="290" fontSize="16" fill="currentColor">
          {t("landing.mockup_seating_summary")}
        </text>
      </g>
      {/* Mini tables (3 round + 1 head) */}
      <g transform="translate(204, 360)">
        {[
          { tx: 0, ty: 0 },
          { tx: 100, ty: 0 },
          { tx: 200, ty: 0 },
        ].map((pos) => (
          <g key={`tbl-${pos.tx}`} transform={`translate(${pos.tx}, ${pos.ty})`}>
            <g className="text-paper-200">
              <circle cx="0" cy="0" r="20" fill="currentColor" />
            </g>
            <g className="text-ink-700">
              <circle cx="0" cy="0" r="20" fill="none" stroke="currentColor" strokeWidth="1" />
            </g>
            <g className="text-umber-300">
              {TABLE_DEGS.map((deg) => {
                const rad = (deg * Math.PI) / 180;
                const cx = Math.cos(rad) * 28;
                const cy = Math.sin(rad) * 28;
                return (
                  <rect
                    key={deg}
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
        {/* Head table */}
        <g transform="translate(360, 0)">
          <g className="text-paper-200">
            <rect x="-30" y="-10" width="60" height="20" rx="4" fill="currentColor" />
          </g>
          <g className="text-ink-700">
            <rect
              x="-30"
              y="-10"
              width="60"
              height="20"
              rx="4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </g>
          <g className="text-umber-300">
            {HEAD_TABLE_X.map((x) => (
              <rect
                key={`top-${x}`}
                x={x - 3}
                y="-22"
                width="6"
                height="6"
                rx="1.5"
                fill="currentColor"
              />
            ))}
            {HEAD_TABLE_X.map((x) => (
              <rect
                key={`bot-${x}`}
                x={x - 3}
                y="16"
                width="6"
                height="6"
                rx="1.5"
                fill="currentColor"
              />
            ))}
          </g>
        </g>
      </g>

      {/* Confetti */}
      <g className="text-umber-300">
        <circle cx="608" cy="14" r="3" fill="currentColor" />
        <circle cx="620" cy="32" r="2" fill="currentColor" />
      </g>
      <g className="text-ink-300">
        <circle cx="592" cy="22" r="2" fill="currentColor" />
      </g>
    </svg>
  );
}

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
      viewBox="0 0 480 360"
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
      <g className="text-blush-500">
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
            <g className={cat.tone === "primary" ? "text-blush-500" : "text-blush-300"}>
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
  { name: "Dóra Nagy", status: "pending", meal: "—", tone: 3 },
  { name: "Marci Szabó", status: "yes", meal: "Beef", tone: 4 },
  { name: "Réka Horváth", status: "no", meal: "—", tone: 5 },
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
      viewBox="0 0 480 360"
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
      <g className="text-blush-100">
        <rect x="296" y="58" width="74" height="28" rx="14" fill="currentColor" />
      </g>
      <g className="text-blush-700 font-sans">
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
            {i < GUEST_ROWS.length - 1 && (
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
      viewBox="0 0 480 360"
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
        <text x="24" y="32" fontSize="9" fontWeight="600" fill="currentColor" letterSpacing="1">
          {t("landing.mockup_canvas_label")}
        </text>
      </g>
      {/* Add table chip */}
      <g className="text-blush-500">
        <rect x="332" y="20" width="124" height="22" rx="11" fill="currentColor" />
      </g>
      <g className="text-white font-sans">
        <text x="394" y="35" fontSize="10" fontWeight="600" fill="currentColor" textAnchor="middle">
          {t("landing.mockup_add_table")}
        </text>
      </g>

      {/* Floor / grid */}
      <g className="text-paper-100">
        <rect x="24" y="60" width="432" height="276" rx="8" fill="currentColor" />
      </g>
      <g className="text-paper-300">
        {[88, 152, 216, 280].map((y) => (
          <line
            key={`h-${y}`}
            x1="24"
            y1={y}
            x2="456"
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
            y2="336"
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
        <g className="text-blush-500 font-sans">
          <text x="0" y="6" fontSize="9" fontWeight="600" fill="currentColor" textAnchor="middle">
            {t("landing.mockup_table_head")}
          </text>
        </g>
        <g className="text-blush-300">
          {[-32, -16, 0, 16, 32].map((x) => (
            <rect
              key={`htop-${x}`}
              x={x - 3}
              y="-20"
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
          <g className="text-blush-500 font-sans">
            <text x="0" y="3" fontSize="8" fontWeight="600" fill="currentColor" textAnchor="middle">
              {tbl.label}
            </text>
          </g>
          <g className="text-blush-300">
            {TABLE_DEGS.map((deg) => {
              const rad = (deg * Math.PI) / 180;
              const cx = Math.cos(rad) * 30;
              const cy = Math.sin(rad) * 30;
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
        <g className="text-blush-300">
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
    </svg>
  );
}

/** Vendor listing mockup — a single supplier card as it appears in
 *  the directory, used on VendorsPage to show vendors what their
 *  listing will look like. */
export function VendorListingMockup({ className }: Common) {
  const { t } = useT();
  return (
    <svg
      viewBox="0 0 360 232"
      role="img"
      aria-label={t("landing.mockup_aria_vendor")}
      className={className}
    >
      <g className="text-ink-900" opacity="0.06">
        <rect x="4" y="10" width="360" height="222" rx="16" fill="currentColor" />
      </g>
      <g className="text-paper-200">
        <rect
          x="0"
          y="0"
          width="360"
          height="232"
          rx="16"
          fill="white"
          stroke="currentColor"
          strokeWidth="1"
        />
      </g>

      {/* Cover image area — pastel placeholder strip + universal photo-icon
       *  glyph centered in the strip. Earlier revs decorated this with two
       *  blush ellipses, but they read as floating blobs on mobile (the SVG
       *  scales down past where their shapes are recognisable). The image-
       *  frame glyph mirrors the production layout 1:1 — a real hero photo
       *  drops into exactly this rect — and is category-neutral, so it
       *  doesn't whisper "this product is for florists only" to caterers
       *  and photographers browsing /vendors. */}
      <g className="text-blush-100">
        <path d="M 0 0 L 360 0 L 360 92 L 0 92 Z" fill="currentColor" />
      </g>
      <g className="text-blush-400" opacity="0.55">
        <rect
          x="167"
          y="30"
          width="50"
          height="36"
          rx="3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <circle cx="178" cy="40" r="2.5" fill="currentColor" />
        <path d="M 170 60 L 184 46 L 196 56 L 213 42 L 213 64 L 170 64 Z" fill="currentColor" />
      </g>

      {/* Logo badge */}
      <g className="text-white">
        <circle cx="40" cy="92" r="22" fill="currentColor" />
      </g>
      <g className="text-paper-300">
        <circle cx="40" cy="92" r="22" fill="none" stroke="currentColor" strokeWidth="1" />
      </g>
      <g className="font-serif text-blush-700">
        <text x="40" y="98" fontSize="18" fill="currentColor" textAnchor="middle">
          F
        </text>
      </g>

      {/* Bookmark */}
      <g className="text-white">
        <circle cx="328" cy="20" r="14" fill="currentColor" />
      </g>
      <g className="text-blush-500">
        <path
          d="M 322 14 L 334 14 L 334 28 L 328 24 L 322 28 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </g>

      {/* Name + category */}
      <g className="font-serif text-ink-900">
        <text x="20" y="142" fontSize="18" fill="currentColor">
          Florea Studio
        </text>
      </g>
      <g className="text-ink-500 font-sans">
        <text x="20" y="160" fontSize="10" fill="currentColor">
          {t("landing.mockup_vendor_category")}
        </text>
      </g>

      {/* Stars */}
      <g className="text-blush-500">
        {[0, 1, 2, 3, 4].map((i) => (
          <path
            key={i}
            transform={`translate(${20 + i * 14}, 178)`}
            d="M 5 0 L 6.5 3.5 L 10 4 L 7.5 6.5 L 8 10 L 5 8 L 2 10 L 2.5 6.5 L 0 4 L 3.5 3.5 Z"
            fill="currentColor"
          />
        ))}
      </g>
      <g className="text-ink-500 font-sans">
        <text x="98" y="187" fontSize="10" fill="currentColor">
          {t("landing.mockup_vendor_reviews")}
        </text>
      </g>

      {/* CTA */}
      <g className="text-blush-500">
        <rect x="220" y="170" width="120" height="28" rx="14" fill="currentColor" />
      </g>
      <g className="text-white font-sans">
        <text
          x="280"
          y="188"
          fontSize="11"
          fontWeight="600"
          fill="currentColor"
          textAnchor="middle"
        >
          {t("landing.mockup_vendor_cta")}
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
          bg: "text-blush-100",
          ring: "text-blush-200",
          skinL: "text-blush-200",
          skinR: "text-paper-300",
          hairL: "text-ink-800",
          hairR: "text-blush-700",
          shoulderL: "text-blush-400",
          shoulderR: "text-paper-500",
        }
      : variant === 2
        ? {
            bg: "text-paper-200",
            ring: "text-paper-300",
            skinL: "text-paper-300",
            skinR: "text-blush-200",
            hairL: "text-blush-700",
            hairR: "text-ink-700",
            shoulderL: "text-ink-600",
            shoulderR: "text-blush-300",
          }
        : {
            bg: "text-blush-50",
            ring: "text-blush-200",
            skinL: "text-paper-300",
            skinR: "text-blush-200",
            hairL: "text-ink-800",
            hairR: "text-blush-700",
            shoulderL: "text-paper-500",
            shoulderR: "text-blush-400",
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
      <g className="text-blush-500">
        <circle cx="48" cy="58" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </g>
    </svg>
  );
}
