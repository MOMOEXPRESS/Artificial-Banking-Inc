import type { Config } from "tailwindcss";

/**
 * Tailwind coexists with the hand-rolled console CSS.
 * preflight is OFF so existing button/input/card styles are not reset.
 * New shadcn/cmdk components use utility classes only.
 */
const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        border: "rgba(255,255,255,0.1)",
        input: "rgba(255,255,255,0.1)",
        ring: "#3b82f6",
        background: "#0c0c0e",
        foreground: "#f4f4f6",
        primary: {
          DEFAULT: "#3b82f6",
          foreground: "#ffffff",
        },
        muted: {
          DEFAULT: "#1c1c20",
          foreground: "#8e8e99",
        },
        accent: {
          DEFAULT: "#1c1c20",
          foreground: "#f4f4f6",
        },
        popover: {
          DEFAULT: "#141416",
          foreground: "#f4f4f6",
        },
        card: {
          DEFAULT: "#0c0c0e",
          foreground: "#f4f4f6",
        },
      },
      borderRadius: {
        lg: "16px",
        md: "11px",
        sm: "8px",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Sora", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "monospace"],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
