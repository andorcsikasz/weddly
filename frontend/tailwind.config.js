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
        // Chalk — near-white surface used by the public-facing landing/vendors surface.
        chalk: {
          50: "#fafaf7",
          100: "#f1f0ea",
          200: "#e7e5dc",
          300: "#d9d6cc",
          400: "#b6b1a3",
          500: "#8a857a",
        },
        // Terracotta — single confident accent for the public surface (CTAs, accent marks).
        terracotta: {
          50: "#fbf2ed",
          100: "#f4ddd0",
          200: "#e8b89f",
          300: "#dc916d",
          400: "#d27754",
          500: "#c76a4a",
          600: "#a85530",
          700: "#854127",
          800: "#5f3220",
        },
      },
      fontFamily: {
        // h1 / h2 in the in-app workspace use the warm display serif. Body is the clean sans.
        serif: ['"Cormorant Garamond"', "Georgia", "serif"],
        sans: ['"Inter Variable"', "Inter", "system-ui", "sans-serif"],
        // High-contrast display serif used by the public-facing landing/vendors surface.
        display: ['"Instrument Serif"', "Cormorant Garamond", "Georgia", "serif"],
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
