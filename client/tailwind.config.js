/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        paper: "#faf8f4",
        ink: "#1c1b22",
        "paper-dark": "#131216",
        "ink-dark": "#eceae4",
        accent: {
          DEFAULT: "#5c5fc4",
          soft: "#8b8dd6",
        },
      },
      fontFamily: {
        sans: ["Inter Variable", "Inter", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        display: ["Space Grotesk Variable", "Space Grotesk", "Inter Variable", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 8px 32px -8px rgba(92, 95, 196, 0.45)",
        card: "0 1px 2px rgba(28,27,34,0.04), 0 8px 24px -12px rgba(28,27,34,0.10)",
      },
    },
  },
  plugins: [],
};
