/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      fontFamily: { sans: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"] },
      colors: {
        ink: { DEFAULT: "#0f1222", soft: "#5b6078" },
        lidl: { DEFAULT: "#0050AA", accent: "#FFE500" },
        biedronka: { DEFAULT: "#E30613", accent: "#1a1a1a" },
        aldi: { DEFAULT: "#00186B", accent: "#F58220" },
        brand: { DEFAULT: "#7c3aed", 2: "#ec4899" },
      },
      boxShadow: { card: "0 1px 2px rgba(16,18,34,.04), 0 8px 24px -12px rgba(16,18,34,.18)" },
    },
  },
  plugins: [],
};
