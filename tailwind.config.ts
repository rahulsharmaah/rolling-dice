import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "oklch(2% 0.03 262)",
        panel: "oklch(25% 0.02 260)",
        ink: "oklch(95% 0.02 265)",
        primary: "oklch(65% 0.14 265)",
        accent: "oklch(73% 0.20 245)",
        pip: "oklch(40% 0.12 48)",
        dice: "oklch(85% 0.04 75)"
      },
      boxShadow: {
        hud: "0 10px 30px rgba(0,0,0,.35)"
      },
      borderRadius: {
        xl2: "1rem"
      }
    }
  },
  plugins: [],
} satisfies Config;
