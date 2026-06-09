/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        paper: "#faf9f6",
        ink: "#1a1a1f",
        "paper-dark": "#141417",
        "ink-dark": "#e8e7e3",
        accent: {
          DEFAULT: "#5c5fc4",
          soft: "#8b8dd6",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};
