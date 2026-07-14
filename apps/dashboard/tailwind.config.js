/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: "#FFF9F5",
        kavya: {
          cream: "#F5F2EC",
          light: "#FAF8F5",
          sand: "#D4C8B8",
          dark: "#2C2824",
          charcoal: "#3D3833",
          brown: "#6B5E50",
          accent: "#A0937D",
          gold: "#C4A882",
          linen: "#F0EDE6",
          taupe: "#B5A899",
          espresso: "#4A3F35",
          red: "#E74C3C"
        }
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        serif: ["Playfair Display", "Georgia", "serif"]
      }
    }
  },
  plugins: []
};
