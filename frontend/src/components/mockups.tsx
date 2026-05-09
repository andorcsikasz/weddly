/**
 * Inline-SVG product mockups for the public surface. These are
 * stylised renderings of the actual app — dashboard, budget, guest
 * list, seating canvas, vendor listing — used as feature illustrations
 * on the landing and vendors pages, plus three couple-portrait avatars
 * for the testimonials block.
 *
 * All colours come from design tokens: each colour group is wrapped in
 * a `<g className="text-…">` and inner shapes use `currentColor`. SVG
 * text inherits the parent's `font-family`, so we set `font-display` /
 * `font-sans` on group wrappers to keep typography in step with the
 * surrounding page.
 */

type Common = { className?: string };

const NAV_ITEMS = ["Guests", "Budget", "Seating", "Suppliers"] as const;
const TABLE_DEGS = [0, 60, 120, 180, 240, 300] as const;
const HEAD_TABLE_X = [-22, -10, 2, 14] as const;
const STATUS_DOT_OFFSETS = [0, 16, 32, 48, 64] as const;

/** Hero centrepiece — a stylised dashboard view of the app. Sidebar +
 *  main area with three live-looking cards (Budget, Guests, Seating).
 *  ~640×440 viewBox, scales to fit the column. */
export function WorkspaceMockup({ className }: Common) {
  return (
    <svg
      viewBox="0 0 640 440"
      role="img"
      aria-label="Weddly dashboard preview"
      className={className}
    >
      {/* Drop-shadow simulator */}
      <g className="text-ink-900" opacity="0.06">
        <rect x="6" y="14" width="640" height="440" rx="20" fill="currentColor" />
      </g>
      {/* Card frame */}
      <g className="text-chalk-200">
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
      <g className="text-chalk-100">
        <path
          d="M 0 20 Q 0 0 20 0 L 140 0 L 140 440 L 20 440 Q 0 440 0 420 Z"
          fill="currentColor"
        />
      </g>
      <g className="text-chalk-200">
        <line x1="140" y1="0" x2="140" y2="440" stroke="currentColor" strokeWidth="1" />
      </g>

      {/* Brand wordmark */}
      <g className="font-display text-ink-900">
        <text x="20" y="36" fontSize="20" fill="currentColor">
          Weddly
        </text>
      </g>

      {/* Active nav item */}
      <g className="text-terracotta-100">
        <rect x="12" y="78" width="116" height="32" rx="8" fill="currentColor" />
      </g>
      <g className="text-terracotta-700 font-sans">
        <circle cx="26" cy="94" r="3" fill="currentColor" />
        <text x="40" y="98" fontSize="11" fontWeight="600" fill="currentColor">
          Overview
        </text>
      </g>

      {/* Inactive nav items */}
      {NAV_ITEMS.map((label, i) => {
        const y = 124 + i * 32;
        return (
          <g key={label}>
            <g className="text-ink-300">
              <circle cx="26" cy={y + 16} r="3" fill="currentColor" />
            </g>
            <g className="text-ink-600 font-sans">
              <text x="40" y={y + 20} fontSize="11" fill="currentColor">
                {label}
              </text>
            </g>
          </g>
        );
      })}

      {/* Sidebar footer chip */}
      <g className="text-chalk-300">
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
      <g className="font-display text-ink-900">
        <text x="168" y="48" fontSize="26" fill="currentColor">
          Anna &amp; Bence
        </text>
      </g>
      <g className="text-terracotta-300">
        <rect
          x="476"
          y="26"
          width="140"
          height="28"
          rx="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
      </g>
      <g className="text-terracotta-700 font-sans">
        <circle cx="490" cy="40" r="3" fill="currentColor" />
        <text x="500" y="44" fontSize="11" fill="currentColor">
          June 14, 2026 · 142 days
        </text>
      </g>

      {/* Budget card */}
      <g className="text-chalk-200">
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
      <g className="text-ink-500 font-sans">
        <text x="184" y="104" fontSize="9" fontWeight="600" fill="currentColor" letterSpacing="1">
          BUDGET
        </text>
      </g>
      <g className="font-display text-ink-900">
        <text x="184" y="140" fontSize="22" fill="currentColor">
          2,8M
        </text>
      </g>
      <g className="font-sans text-ink-500">
        <text x="232" y="140" fontSize="14" fill="currentColor">
          / 3,5M Ft
        </text>
      </g>
      <g className="text-chalk-200">
        <rect x="184" y="156" width="184" height="8" rx="4" fill="currentColor" />
      </g>
      <g className="text-terracotta-500">
        <rect x="184" y="156" width="148" height="8" rx="4" fill="currentColor" />
      </g>
      <g className="text-chalk-300">
        <rect x="184" y="178" width="84" height="3" rx="1.5" fill="currentColor" />
        <rect x="184" y="188" width="120" height="3" rx="1.5" fill="currentColor" />
        <rect x="184" y="198" width="60" height="3" rx="1.5" fill="currentColor" />
      </g>

      {/* Guests card */}
      <g className="text-chalk-200">
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
      <g className="text-ink-500 font-sans">
        <text x="416" y="104" fontSize="9" fontWeight="600" fill="currentColor" letterSpacing="1">
          GUESTS
        </text>
      </g>
      <g className="font-display text-ink-900">
        <text x="416" y="140" fontSize="22" fill="currentColor">
          98
        </text>
      </g>
      <g className="font-sans text-ink-500">
        <text x="446" y="140" fontSize="14" fill="currentColor">
          / 120
        </text>
      </g>
      {/* Avatar stack */}
      {STATUS_DOT_OFFSETS.map((dx, i) => (
        <g key={dx} className={i % 2 === 0 ? "text-terracotta-300" : "text-terracotta-200"}>
          <circle cx={424 + dx} cy="172" r="9" fill="currentColor" stroke="white" strokeWidth="2" />
        </g>
      ))}
      <g className="text-ink-500 font-sans">
        <text x="500" y="176" fontSize="10" fill="currentColor">
          +93
        </text>
      </g>
      {/* RSVP status pills */}
      <g className="text-terracotta-100">
        <rect x="416" y="192" width="64" height="14" rx="7" fill="currentColor" />
      </g>
      <g className="text-terracotta-700 font-sans">
        <text x="424" y="202" fontSize="8" fontWeight="600" fill="currentColor">
          87 yes
        </text>
      </g>
      <g className="text-chalk-200">
        <rect x="486" y="192" width="68" height="14" rx="7" fill="currentColor" />
      </g>
      <g className="text-ink-700 font-sans">
        <text x="494" y="202" fontSize="8" fontWeight="600" fill="currentColor">
          11 pending
        </text>
      </g>

      {/* Seating card */}
      <g className="text-chalk-200">
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
      <g className="text-ink-500 font-sans">
        <text x="184" y="260" fontSize="9" fontWeight="600" fill="currentColor" letterSpacing="1">
          SEATING
        </text>
      </g>
      <g className="font-display text-ink-900">
        <text x="184" y="290" fontSize="16" fill="currentColor">
          16 tables · 98 seats
        </text>
      </g>
      {/* Mini tables (3 round + 1 head) */}
      <g transform="translate(204, 360)">
        {[
          { tx: 0, ty: 0 },
          { tx: 100, ty: 0 },
          { tx: 200, ty: 0 },
        ].map((t) => (
          <g key={`tbl-${t.tx}`} transform={`translate(${t.tx}, ${t.ty})`}>
            <g className="text-chalk-200">
              <circle cx="0" cy="0" r="20" fill="currentColor" />
            </g>
            <g className="text-ink-700">
              <circle cx="0" cy="0" r="20" fill="none" stroke="currentColor" strokeWidth="1" />
            </g>
            <g className="text-terracotta-300">
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
          <g className="text-chalk-200">
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
          <g className="text-terracotta-300">
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
      <g className="text-terracotta-300">
        <circle cx="608" cy="14" r="3" fill="currentColor" />
        <circle cx="620" cy="32" r="2" fill="currentColor" />
      </g>
      <g className="text-ink-300">
        <circle cx="592" cy="22" r="2" fill="currentColor" />
      </g>
    </svg>
  );
}

const BUDGET_CATS: { label: string; spent: number; total: number; tone: "primary" | "muted" }[] = [
  { label: "Catering", spent: 132, total: 168, tone: "primary" },
  { label: "Venue", spent: 96, total: 96, tone: "primary" },
  { label: "Photo", spent: 22, total: 36, tone: "primary" },
  { label: "Music", spent: 14, total: 24, tone: "muted" },
  { label: "Decor", spent: 18, total: 32, tone: "muted" },
  { label: "Other", spent: 8, total: 24, tone: "muted" },
];

/** Budget feature mockup — a focused panel with headcount slider,
 *  six category bars, and a total summary line. */
export function BudgetMockup({ className }: Common) {
  return (
    <svg viewBox="0 0 480 360" role="img" aria-label="Live budget mockup" className={className}>
      <g className="text-ink-900" opacity="0.06">
        <rect x="4" y="10" width="480" height="360" rx="16" fill="currentColor" />
      </g>
      <g className="text-chalk-200">
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
      <g className="text-ink-500 font-sans">
        <text x="24" y="34" fontSize="9" fontWeight="600" fill="currentColor" letterSpacing="1">
          BUDGET
        </text>
      </g>
      <g className="font-display text-ink-900">
        <text x="24" y="60" fontSize="18" fill="currentColor">
          Live budget · 120 guests
        </text>
      </g>

      {/* Slider */}
      <g className="text-chalk-300">
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
      <g className="text-terracotta-500">
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
          <g key={cat.label}>
            <g className="text-ink-700 font-sans">
              <text x="24" y={y + 4} fontSize="11" fill="currentColor">
                {cat.label}
              </text>
            </g>
            <g className="text-chalk-200">
              <rect x="120" y={y - 5} width="280" height="9" rx="4.5" fill="currentColor" />
            </g>
            <g className={cat.tone === "primary" ? "text-terracotta-500" : "text-terracotta-300"}>
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
      <g className="text-chalk-200">
        <line x1="24" y1="324" x2="456" y2="324" stroke="currentColor" strokeWidth="1" />
      </g>
      <g className="text-ink-700 font-sans">
        <text x="24" y="346" fontSize="11" fill="currentColor">
          Total spend
        </text>
      </g>
      <g className="font-display text-ink-900">
        <text x="456" y="348" fontSize="16" fill="currentColor" textAnchor="end">
          2,8M / 3,5M Ft
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

/** Guest list mockup — search + 5 guest rows with status pills and
 *  meal-choice column. */
export function GuestListMockup({ className }: Common) {
  return (
    <svg
      viewBox="0 0 480 360"
      role="img"
      aria-label="Guest list and RSVP mockup"
      className={className}
    >
      <g className="text-ink-900" opacity="0.06">
        <rect x="4" y="10" width="480" height="360" rx="16" fill="currentColor" />
      </g>
      <g className="text-chalk-200">
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

      <g className="font-display text-ink-900">
        <text x="24" y="40" fontSize="18" fill="currentColor">
          Guests · 98 of 120
        </text>
      </g>

      {/* Search bar */}
      <g className="text-chalk-300">
        <rect
          x="24"
          y="58"
          width="280"
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
          Search guests…
        </text>
      </g>
      {/* Filter chips */}
      <g className="text-terracotta-100">
        <rect x="316" y="58" width="56" height="28" rx="14" fill="currentColor" />
      </g>
      <g className="text-terracotta-700 font-sans">
        <text x="324" y="76" fontSize="10" fontWeight="600" fill="currentColor">
          All · 120
        </text>
      </g>
      <g className="text-chalk-200">
        <rect x="380" y="58" width="76" height="28" rx="14" fill="currentColor" />
      </g>
      <g className="text-ink-700 font-sans">
        <text x="388" y="76" fontSize="10" fill="currentColor">
          Pending · 11
        </text>
      </g>

      {/* Header row */}
      <g className="text-ink-400 font-sans">
        <text x="24" y="112" fontSize="9" fontWeight="600" fill="currentColor" letterSpacing="1">
          NAME
        </text>
        <text x="240" y="112" fontSize="9" fontWeight="600" fill="currentColor" letterSpacing="1">
          STATUS
        </text>
        <text x="370" y="112" fontSize="9" fontWeight="600" fill="currentColor" letterSpacing="1">
          MEAL
        </text>
      </g>

      {GUEST_ROWS.map((row, i) => {
        const y = 132 + i * 40;
        const statusColor =
          row.status === "yes"
            ? "text-terracotta-500"
            : row.status === "pending"
              ? "text-chalk-400"
              : "text-ink-300";
        const statusBg =
          row.status === "yes"
            ? "text-terracotta-100"
            : row.status === "pending"
              ? "text-chalk-200"
              : "text-ink-100";
        const statusText =
          row.status === "yes" ? "Yes" : row.status === "pending" ? "Pending" : "No";
        const statusFg =
          row.status === "yes"
            ? "text-terracotta-700"
            : row.status === "pending"
              ? "text-ink-700"
              : "text-ink-500";
        const avatarTones = {
          1: "text-terracotta-300",
          2: "text-terracotta-200",
          3: "text-chalk-300",
          4: "text-ink-200",
          5: "text-chalk-400",
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
              <rect x="240" y={y - 9} width="78" height="18" rx="9" fill="currentColor" />
            </g>
            <g className={statusColor}>
              <circle cx="252" cy={y} r="3" fill="currentColor" />
            </g>
            <g className={`${statusFg} font-sans`}>
              <text x="262" y={y + 3} fontSize="10" fontWeight="600" fill="currentColor">
                {statusText}
              </text>
            </g>
            <g className="text-ink-700 font-sans">
              <text x="370" y={y + 4} fontSize="10" fill="currentColor">
                {row.meal}
              </text>
            </g>
            {i < GUEST_ROWS.length - 1 && (
              <g className="text-chalk-200">
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

const SEATING_TABLES: { x: number; y: number; label: string }[] = [
  { x: 110, y: 200, label: "Family" },
  { x: 220, y: 180, label: "Friends" },
  { x: 330, y: 200, label: "Plus ones" },
  { x: 160, y: 290, label: "Work" },
  { x: 280, y: 290, label: "Uni" },
];

/** Seating canvas mockup — top-down venue with five round tables, a
 *  head table, and a guest card being dragged. */
export function SeatingMockup({ className }: Common) {
  return (
    <svg viewBox="0 0 480 360" role="img" aria-label="Seating canvas mockup" className={className}>
      <g className="text-ink-900" opacity="0.06">
        <rect x="4" y="10" width="480" height="360" rx="16" fill="currentColor" />
      </g>
      <g className="text-chalk-200">
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
          SEATING CANVAS · A4 · A6 · A3
        </text>
      </g>
      {/* Add table chip */}
      <g className="text-terracotta-500">
        <rect x="368" y="20" width="88" height="22" rx="11" fill="currentColor" />
      </g>
      <g className="text-white font-sans">
        <text x="412" y="35" fontSize="10" fontWeight="600" fill="currentColor" textAnchor="middle">
          + Add table
        </text>
      </g>

      {/* Floor / grid */}
      <g className="text-chalk-100">
        <rect x="24" y="60" width="432" height="276" rx="8" fill="currentColor" />
      </g>
      <g className="text-chalk-300">
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
        <g className="text-chalk-50">
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
        <g className="text-terracotta-500">
          <text x="0" y="6" fontSize="9" fontWeight="600" fill="currentColor" textAnchor="middle">
            Head table
          </text>
        </g>
        <g className="text-terracotta-300">
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
      {SEATING_TABLES.map((tbl) => (
        <g key={tbl.label} transform={`translate(${tbl.x}, ${tbl.y})`}>
          <g className="text-chalk-50">
            <circle cx="0" cy="0" r="22" fill="currentColor" />
          </g>
          <g className="text-ink-700">
            <circle cx="0" cy="0" r="22" fill="none" stroke="currentColor" strokeWidth="1" />
          </g>
          <g className="text-terracotta-500 font-sans">
            <text x="0" y="3" fontSize="8" fontWeight="600" fill="currentColor" textAnchor="middle">
              {tbl.label}
            </text>
          </g>
          <g className="text-terracotta-300">
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
        <g className="text-chalk-300">
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
        <g className="text-terracotta-300">
          <circle cx="14" cy="16" r="6" fill="currentColor" />
        </g>
        <g className="text-ink-800 font-sans">
          <text x="24" y="14" fontSize="9" fontWeight="600" fill="currentColor">
            Dóra N.
          </text>
        </g>
        <g className="text-ink-500 font-sans">
          <text x="24" y="24" fontSize="8" fill="currentColor">
            Veg · Plus 1
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
  return (
    <svg
      viewBox="0 0 360 220"
      role="img"
      aria-label="Vendor listing card preview"
      className={className}
    >
      <g className="text-ink-900" opacity="0.06">
        <rect x="4" y="10" width="360" height="220" rx="16" fill="currentColor" />
      </g>
      <g className="text-chalk-200">
        <rect
          x="0"
          y="0"
          width="360"
          height="220"
          rx="16"
          fill="white"
          stroke="currentColor"
          strokeWidth="1"
        />
      </g>

      {/* Cover image area */}
      <g className="text-terracotta-100">
        <path d="M 0 0 L 360 0 L 360 92 L 0 92 Z" fill="currentColor" />
      </g>
      <g className="text-terracotta-300">
        <ellipse cx="80" cy="92" rx="80" ry="36" fill="currentColor" opacity="0.6" />
        <ellipse cx="280" cy="84" rx="60" ry="28" fill="currentColor" opacity="0.5" />
      </g>

      {/* Logo badge */}
      <g className="text-white">
        <circle cx="40" cy="92" r="22" fill="currentColor" />
      </g>
      <g className="text-chalk-300">
        <circle cx="40" cy="92" r="22" fill="none" stroke="currentColor" strokeWidth="1" />
      </g>
      <g className="font-display text-terracotta-700">
        <text x="40" y="98" fontSize="18" fill="currentColor" textAnchor="middle">
          F
        </text>
      </g>

      {/* Bookmark */}
      <g className="text-white">
        <circle cx="328" cy="20" r="14" fill="currentColor" />
      </g>
      <g className="text-terracotta-500">
        <path
          d="M 322 14 L 334 14 L 334 28 L 328 24 L 322 28 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </g>

      {/* Name + category */}
      <g className="font-display text-ink-900">
        <text x="20" y="142" fontSize="18" fill="currentColor">
          Florea Studio
        </text>
      </g>
      <g className="text-ink-500 font-sans">
        <text x="20" y="160" fontSize="10" fill="currentColor">
          Floral design · Budapest, HU
        </text>
      </g>

      {/* Stars */}
      <g className="text-terracotta-500">
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
          4.9 · 23 reviews
        </text>
      </g>

      {/* CTA */}
      <g className="text-terracotta-500">
        <rect x="240" y="170" width="100" height="28" rx="14" fill="currentColor" />
      </g>
      <g className="text-white font-sans">
        <text
          x="290"
          y="188"
          fontSize="11"
          fontWeight="600"
          fill="currentColor"
          textAnchor="middle"
        >
          View profile
        </text>
      </g>
    </svg>
  );
}

/** Reusable couple-portrait avatar used in testimonials. Two stylised
 *  heads in a circular frame; each instance picks a colour palette so
 *  the three testimonials feel like distinct people. */
export function CouplePortrait({ variant, className }: Common & { variant: 1 | 2 | 3 }) {
  const palette =
    variant === 1
      ? { left: "text-terracotta-400", right: "text-ink-700", bg: "text-terracotta-100" }
      : variant === 2
        ? { left: "text-ink-600", right: "text-terracotta-300", bg: "text-chalk-200" }
        : { left: "text-terracotta-700", right: "text-chalk-400", bg: "text-terracotta-50" };
  return (
    <svg viewBox="0 0 96 96" aria-hidden="true" className={className}>
      <g className={palette.bg}>
        <circle cx="48" cy="48" r="46" fill="currentColor" />
      </g>
      <g className="text-chalk-300">
        <circle cx="48" cy="48" r="46" fill="none" stroke="currentColor" strokeWidth="1" />
      </g>
      {/* Left figure */}
      <g className={palette.left}>
        {/* Hair */}
        <path d="M 26 40 C 26 30, 36 26, 40 30 C 44 28, 48 32, 46 38" fill="currentColor" />
        {/* Head */}
        <circle cx="36" cy="40" r="10" fill="currentColor" />
        {/* Body / shoulder */}
        <path d="M 20 80 C 22 64, 32 58, 36 58 C 40 58, 50 64, 52 80 Z" fill="currentColor" />
      </g>
      {/* Right figure */}
      <g className={palette.right}>
        {/* Hair (shorter) */}
        <path d="M 52 36 C 52 28, 64 26, 66 32 C 68 30, 72 34, 70 40" fill="currentColor" />
        {/* Head */}
        <circle cx="60" cy="42" r="10" fill="currentColor" />
        {/* Body / shoulder */}
        <path d="M 44 80 C 46 66, 56 60, 60 60 C 64 60, 74 66, 76 80 Z" fill="currentColor" />
      </g>
      {/* Subtle facial hint — eyes */}
      <g className="text-ink-900" opacity="0.7">
        <circle cx="33" cy="40" r="1" fill="currentColor" />
        <circle cx="38" cy="40" r="1" fill="currentColor" />
        <circle cx="57" cy="42" r="1" fill="currentColor" />
        <circle cx="62" cy="42" r="1" fill="currentColor" />
      </g>
    </svg>
  );
}
