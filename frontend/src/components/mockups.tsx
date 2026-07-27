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

/** Hero centrepiece — a stylised dashboard view of the app. Sidebar +
 *  main area with three live-looking cards (Budget, Guests, Seating).
 *  ViewBox is offset to -8,-8 (same 656×456 size) so the 640×440 card sits
 *  with an even 8px margin on every side — the 1.5px frame stroke then
 *  renders fully instead of being clipped at the x=0 / y=0 edges. */
export function WorkspaceMockup({ className }: Common) {
  const { t, locale } = useT();
  // Hero mockup wedding date: 27 July of next year, so the badge always shows a
  // plausible future date with an exact day countdown. It rolls forward each
  // January (2027 while we're in 2026, 2028 once 2026 ends, and so on) since
  // the year is derived from the current year + 1.
  const weddingDay = new Date(new Date().getFullYear() + 1, 6, 27); // month 6 = July
  const mockupDate = new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(weddingDay);
  const mockupDays = Math.max(
    0,
    Math.round((weddingDay.setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000),
  );
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
      viewBox="-8 -8 656 456"
      role="img"
      aria-label={t("landing.mockup_aria_dashboard")}
      className={className}
    >
      {/* Card background (fill only — the border is stroked last so the
          sidebar can't cover it). */}
      <g>
        <rect x="0" y="0" width="640" height="440" rx="20" fill="white" />
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
          A &amp; N
        </text>
      </g>

      {/* Main header */}
      <g className="font-serif text-ink-900">
        <text x="168" y="48" fontSize="26" fill="currentColor">
          Allie &amp; Noah
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
          {t("landing.mockup_date", { date: mockupDate, n: mockupDays })}
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

      {/* Card frame drawn last, on top of the sidebar and all content, so the
          umber outline is an even 1.5px the whole way around. */}
      <g className="text-umber-300">
        <rect
          x="0"
          y="0"
          width="640"
          height="440"
          rx="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
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
        {/* Round crop for the profile badge. Same radius as the ring drawn on
            top of it, so the photo stops exactly under the hairline. */}
        <clipPath id="vendor-avatar-clip">
          <circle cx="40" cy="92" r="22" />
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

      {/* Profile badge. The disc underneath is the backdrop the photo lands on
          (and what shows while it loads), the photo fills it, and the hairline
          ring goes on top so the edge stays crisp in both modes.

          A portrait rather than a work shot: the badge renders at ~44px, and a
          bouquet or a venue turns to mush at that size while a face still
          resolves. Same placeholder convention as the cover above — swap the
          href for a real vendor's photo before launch. */}
      <g className="text-white dark:text-umber-700">
        <circle cx="40" cy="92" r="22" fill="currentColor" />
      </g>
      <image
        href="https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=176&h=176&fit=crop&crop=faces&q=80"
        x="18"
        y="70"
        width="44"
        height="44"
        clipPath="url(#vendor-avatar-clip)"
        preserveAspectRatio="xMidYMid slice"
      />
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
