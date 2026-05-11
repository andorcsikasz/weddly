/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
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
        // Sage — muted green used sparingly to mark couple-private "DIY"
        // supplier entries. Kept low-saturation so it sits quietly next to
        // blush CTAs and doesn't read as a status / success color.
        sage: {
          50: "#f5f7f2",
          100: "#e7ede0",
          200: "#cedcbf",
          300: "#aec496",
          400: "#8aaa6f",
          500: "#6c8f56",
          600: "#557141",
          700: "#445937",
          800: "#374731",
          900: "#2c3a28",
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
      },
      keyframes: {
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
