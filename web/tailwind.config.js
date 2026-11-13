/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        nearBlack: "#0A0A0A",
        nearCharcoal: "#141414",
        nearSurface: "#1C1C1C",
        nearBorder: "#2A2A2A",
        nearGreen: "#00EC97",
        nearTeal: "#17D9D4",
      },
      keyframes: {
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        floatSlow: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-8px)" },
        },
        pulseRing: {
          "0%": { transform: "scale(0.95)", opacity: "0.7" },
          "70%": { transform: "scale(1.15)", opacity: "0" },
          "100%": { transform: "scale(1.15)", opacity: "0" },
        },
      },
      animation: {
        fadeInUp: "fadeInUp 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        floatSlow: "floatSlow 6s ease-in-out infinite",
        pulseRing: "pulseRing 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};
