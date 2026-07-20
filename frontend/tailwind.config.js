/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // The budget-donut slice colours (SpendingCharts SLICE_PALETTE) are composed
  // as `stroke-chart-*` / `bg-chart-*` from a palette array. They ARE literal
  // strings, so the content scan normally finds them — but safelisting them
  // guarantees the utilities are always emitted regardless of scan/config
  // reload timing (a stale dev-server config snapshot once dropped them and the
  // donut rendered colourless). Keep in sync with theme.extend.colors.chart.
  safelist: [
    "stroke-chart-terracotta",
    "stroke-chart-sage",
    "stroke-chart-taupe",
    "stroke-chart-rose",
    "stroke-chart-olive",
    "stroke-chart-ochre",
    "stroke-chart-sand",
    "bg-chart-terracotta",
    "bg-chart-sage",
    "bg-chart-taupe",
    "bg-chart-rose",
    "bg-chart-olive",
    "bg-chart-ochre",
    "bg-chart-sand",
  ],
  // `dark` is applied to <html> by AppShell (mount/unmount). That scopes
  // the warm-dark theme to /app/* protected routes only — public pages
  // (landing, /login, /vendors) stay on the light paper palette.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Three-color palette per BLUEPRINT.
        // Ink — deep navy, the dark accent / body text.
        ink: {
          50: "#f4f5f8",
          100: "#e0e3ec",
          200: "#bfc6d6",
          300: "#94a0b9",
          400: "#677797",
          500: "#46577a",
          600: "#314262",
          700: "#243150",
          800: "#1a2440",
          900: "#101830",
          950: "#080d1c",
        },
        // Paper — oat cream, the warm background.
        paper: {
          50: "#fbfaf5",
          100: "#f6f2e7",
          200: "#efe9d9", // hero swatch
          300: "#e3d9bf",
          400: "#d3c69f",
          500: "#bfae7b",
          600: "#a18d5d",
          700: "#7e6d49",
          800: "#5a4e36",
          900: "#3a3324",
        },
        // Celebrate — deep crimson reserved for the post-wedding celebration
        // card (white text on top). A truer, more festive red than blush, which
        // reads terracotta-orange.
        celebrate: "#B40421",
        // Blush — single warm accent for CTAs / chips.
        blush: {
          50: "#fdf5f3",
          100: "#fbe9e3",
          200: "#f5cdc1",
          300: "#eda997",
          400: "#e2826a",
          500: "#d35d42",
          600: "#bf4a30",
          700: "#9d3b27",
          800: "#7d3122",
          900: "#612821",
          // Several dark-mode surfaces already reference blush-950; without
          // this stop Tailwind silently dropped those classes and the panels
          // rendered transparent.
          950: "#401b16",
        },
        // Sage — vivid forest green. Marks couple-private "DIY" supplier
        // entries AND the page's success / notify CTAs (e.g. the date-changed
        // banner). Earlier this palette was kept olive-muted, but the muted
        // tones read as gray-brown next to blush + paper; couples explicitly
        // asked for a markánsabb green, so the palette below is built on a
        // saturated mid (~#2f9c52) that still feels natural-leaf rather than
        // neon. The pale tints (50–200) stay quiet enough to use as
        // background fills without screaming.
        sage: {
          50: "#effbf2",
          100: "#d6f3dd",
          200: "#b1e6c0",
          300: "#82d39c",
          400: "#50b873",
          500: "#2f9c52",
          600: "#237f3f",
          700: "#1c6633",
          800: "#19512b",
          900: "#154124",
        },
        // Umber — warm dark palette. The paper-inverted complement to `paper`.
        // Used exclusively for /app/* dark mode (scoped via `html.dark`).
        // 900 = page bg, 800 = surface (card), 700 = border, 600 = elevated
        // border / hover. 200–300 are bright cream variants for muted text on
        // dark surfaces. Designed so blush-400 + sage-400 sit cleanly on top.
        umber: {
          50: "#fbf7f0",
          100: "#f4ead5",
          200: "#e6d3ad",
          300: "#d2b078",
          400: "#b48a55",
          500: "#8a6841",
          600: "#4a3a2e",
          700: "#3a2e22",
          800: "#251c14",
          850: "#201812",
          900: "#1a1410",
          950: "#0f0a07",
        },
        // Eucalyptus — silvery muted teal-green. Planner workspace accent:
        // healthy status, positive KPIs, "all good" states. Sits next to
        // blush (warm) and umber (dark) without competing. Distinct from
        // sage (which is a vivid forest green used for DIY supplier tags).
        eucalyptus: {
          50: "#f0f8f5",
          100: "#d3ede6",
          200: "#a7dacf",
          300: "#73c3b2",
          400: "#44a796",
          500: "#2e8c7c",
          600: "#237165",
          700: "#1c5b52",
          800: "#184944",
          900: "#143c38",
        },
        // Steel - the cool slate-blue accent for the VENDOR portal, per user
        // direction 2026-06-29. Anchored on the two requested colours:
        // steel-100 = #C0D6DF (light powder-blue fills, hover, badges) and
        // steel-600 = #4F6D7A (dark accent for text, icon outlines, active nav,
        // links). The rest of the ramp is interpolated for borders + dark mode.
        steel: {
          50: "#eef3f5",
          100: "#C0D6DF",
          200: "#a6c3cf",
          300: "#8aafbe",
          400: "#6e94a4",
          500: "#5c8090",
          600: "#4F6D7A",
          700: "#415a65",
          800: "#344850",
          900: "#28373d",
        },
        // Verified — the Twitter/Instagram-style azure blue for the directory
        // "verified vendor" check (registered vendors with their own Weddly
        // account), per user direction 2026-07-09. Single value; reads on both
        // light paper and dark umber backgrounds.
        verified: "#1fa6e1",
        // Star — the gold used for rating stars (review picker + rating rows),
        // per user direction 2026-07-09. A truer gold than the oat paper-500 the
        // stars used before. Single value; reads on light paper + dark umber.
        star: "#FFD000",
        // Vote — the community up/down arrows on directory supplier cards. The
        // arrow fills fully in these colours once you cast your vote, per user
        // direction 2026-07-09: vote.up = green (#067D00), vote.down = red
        // (#D50000). Single saturated values; read on light paper + dark umber.
        vote: {
          up: "#067D00",
          down: "#D50000",
        },
        // Moss — the warm olive-green accent for the PLANNER portal, per user
        // direction 2026-06-29. Anchored on the three requested colours:
        // moss-100 = #DBF4AD (light fills, active-nav background, badges),
        // moss-600 = #7D8334 (mid accent for icons, links, KPI accents) and
        // moss-900 = #535723 (deep olive for active-nav text + dark-mode fills).
        // The rest of the ramp is interpolated for borders + dark mode.
        moss: {
          // Forest-green — the PLANNER accent identity, per user direction
          // 2026-07-03. Anchored on the five requested greens: moss-900 =
          // #1B3720 (Evergreen), moss-800 = #214528 (Dark Spruce), moss-700 =
          // #2E6038 (Hunter Green), moss-600 = #3C7C49 (Fern, the primary
          // accent) and moss-400 = #8EAC72 (Muted Olive). 500 + the light
          // tints (50-300) are interpolated so fills, active-nav pills and
          // dark-mode text stay legible on both paper and umber surfaces.
          50: "#f0f4e8",
          100: "#e1e8d2",
          200: "#c6d1b2",
          300: "#aaba93",
          400: "#8EAC72",
          500: "#65945d",
          600: "#3C7C49",
          700: "#2E6038",
          800: "#214528",
          900: "#1B3720",
          950: "#122415",
        },
        // WNRS-red — the saturated true red used on the couple-cards tool
        // surface (white-on-red cover card, red-on-white question card).
        // Kept out of the `blush` palette on purpose: blush is the warm
        // earthy CTA accent (still used in chips, hero, supplier branding),
        // while wnrs.red is a single product-surface token specific to the
        // conversation-cards face. Pure pop red (#D00000) per user direction
        // 2026-06-02 — louder than the earlier #cc1f28 / firebrick #b1232a,
        // sits cleaner on white than the warmer PMS-186 variants did.
        wnrs: {
          red: "#D00000",
          redInk: "#A00000",
        },
        // Lemonade — true citrus / lemon yellow for the hidden 5th
        // easter-egg deck on the couple-cards tool. Bumped from the
        // earlier muted #FFCC00 sun-yellow to a brighter lemon per user
        // direction so the card pops against the paper palette like the
        // wnrs-red one does. Revealed only after a right-swipe across
        // the mini-deck row.
        lemonade: {
          // Aureolin per user spec — softer, slightly greenish lemon
          // versus the earlier vivid #FFE600. Reads as a real lemon-peel
          // colour, not a pure RGB primary.
          yellow: "#fbe311",
          // Bistre — deep chocolate-coffee dark used for type + the
          // glass-mark icon on every lemonade surface. Matches the
          // landing hero ink so the brand line feels coherent.
          ink: "#261606",
          yellowInk: "#A16207",
        },
        // First-date deck — deep blue card paired with white type, the
        // hidden pack tucked off the LEFT edge of the couple-cards mini-row
        // (the mirror of lemonade on the right). Revealed only after a
        // left-swipe across the row. Unlike the pastel lemonade, this is a
        // dark surface, so card type is white and the on-cream accent text
        // uses the deep blue itself.
        firstdate: {
          // Rich royal-navy card face: clearly blue (not near-black) so it
          // pops against Weddly's cream world, with strong white contrast.
          blue: "#1e3a8a",
          // Same deep blue reused as ink for accent text sitting on the
          // cream page background (e.g. the card-position counter).
          ink: "#1e3a8a",
        },
        // Chart: warm "low-cortisol" categorical palette for the budget
        // distribution donut + legend (see SpendingCharts). Deliberately
        // softer and more editorial than the blush/sage/ink utility tokens,
        // which read as a finance dashboard on a pie chart. Tuned to stay
        // distinguishable on both the light paper card and the dark umber
        // surface, and ordered so no two browns sit adjacent on the ring.
        chart: {
          terracotta: "#c96f56",
          sage: "#7f9b83",
          taupe: "#a98663",
          rose: "#d9a39a",
          olive: "#5f7358",
          ochre: "#d1a15f",
          sand: "#e0c48d",
        },
      },
      fontFamily: {
        // Self-hosted/system stack — we used to pull Inter from rsms.me and
        // Cormorant Garamond from Google Fonts, but that leaked visitor IPs
        // to those CDNs. The fallbacks below are deliberately rich so the
        // page still feels editorial on macOS/iOS, Windows and Android
        // without a single third-party request. If a user happens to have
        // Inter or Cormorant installed locally, they win — otherwise we
        // ride on the OS UI sans and Georgia for the display serif.
        serif: ['"Cormorant Garamond"', "Georgia", '"Times New Roman"', "Times", "serif"],
        sans: [
          '"Inter Variable"',
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          '"Helvetica Neue"',
          "Arial",
          "system-ui",
          "sans-serif",
        ],
        // Condensed display stack for the couple-cards tool. Prefers any
        // locally-installed Helvetica Neue Bold Condensed; falls back to
        // Arial Narrow on Windows, then the regular sans stack. Self-host
        // none of these — same no-CDN policy as the other families.
        display: [
          '"Helvetica Neue"',
          "HelveticaNeue",
          '"Arial Narrow"',
          '"Inter Variable"',
          "Inter",
          "-apple-system",
          '"Segoe UI"',
          "system-ui",
          "sans-serif",
        ],
        // Neo-grotesque "speciality coffee" voice for the founding band.
        // Self-hosted General Sans (see @font-face in index.css) leads; the
        // system grotesques are fallbacks for the swap window only.
        grotesk: [
          '"General Sans"',
          '"Helvetica Neue"',
          "Helvetica",
          "Inter",
          "Arial",
          "system-ui",
          "sans-serif",
        ],
      },
      boxShadow: {
        soft: "0 1px 2px 0 rgba(16, 24, 48, 0.04), 0 1px 4px 0 rgba(16, 24, 48, 0.06)",
        // Resting card elevation — a soft drop shadow that lifts a card off the
        // cream page without a hard 1px border. One notch above `soft` so a row
        // of cards reads as floating panels, not framed boxes.
        elevated: "0 1px 2px 0 rgba(16, 24, 48, 0.04), 0 6px 16px -4px rgba(16, 24, 48, 0.10)",
        pop: "0 10px 25px -8px rgba(16, 24, 48, 0.16), 0 2px 6px -2px rgba(16, 24, 48, 0.10)",
      },
      spacing: {
        // 44px — minimum interactive tap target (WCAG / iOS HIG).
        tap: "2.75rem",
      },
      ringOffsetColor: {
        DEFAULT: "#f6f2e7", // paper.100 — focus rings sit cleanly on the warm bg
      },
      animation: {
        "fade-in": "fadeIn 200ms ease-out",
        "fade-in-up": "fadeInUp 280ms ease-out",
        // Couple-cards "next card" enter: slide in from the right + fade.
        // Pairs with the React `key={cardNumber}` remount so each new
        // card animates from scratch. 260ms matches the existing fade-up
        // cadence — fast enough to feel like a deal, slow enough to read.
        "card-deal": "cardDeal 260ms ease-out",
        // Showcase centre lift: smooth fade + small rise when a visitor
        // taps one of the four mini slots. Earlier version used a
        // spring-out overshoot (60% scale 1.02) — read as "jumpy" in
        // the redesign review, so this is the calm ease-out-quint
        // replacement: short rise (14px), tiny scale (0.97 → 1), no
        // overshoot. Paired with `key={selectedId}` for replay on swap.
        "card-lift": "cardLift 340ms cubic-bezier(0.22, 1, 0.36, 1)",
        // Skeleton/loading shimmer — a translucent highlight that sweeps
        // left-to-right across a placeholder block to signal "loading".
        // 1.6s feels lively without being hectic; longer reads as stalled.
        shimmer: "shimmer 1.6s ease-in-out infinite",
        // Checklist tick: the circle becomes a check and punches in. A single
        // small overshoot (1.25) is what sells "done" in one glance; the
        // vendor setup list plays it once per finished step.
        "tick-pop": "tickPop 260ms cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      keyframes: {
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        cardDeal: {
          "0%": { opacity: "0", transform: "translateX(16px) scale(0.985)" },
          "100%": { opacity: "1", transform: "translateX(0) scale(1)" },
        },
        cardLift: {
          "0%": { opacity: "0", transform: "translateY(14px) scale(0.97)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        tickPop: {
          "0%": { opacity: "0", transform: "scale(0.4)" },
          "60%": { opacity: "1", transform: "scale(1.25)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
    },
  },
  plugins: [],
};
