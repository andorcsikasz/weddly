/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
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
          900: "#1a1410",
          950: "#0f0a07",
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
        // Greenflag — soft pastel mint for the hidden "first date" deck
        // tucked off the LEFT edge of the couple-cards mini-row (the
        // mirror of lemonade on the right). Revealed only after a
        // left-swipe across the row.
        greenflag: {
          // Pastel mint card face — soft, but saturated enough to read as
          // clearly green against the cream paper palette (the lighter
          // green-200 washed out almost to white on paper-50).
          green: "#86efac",
          // Deep forest green for type + flair on every greenflag surface.
          ink: "#14532d",
          greenInk: "#15803d",
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
      },
    },
  },
  plugins: [],
};
