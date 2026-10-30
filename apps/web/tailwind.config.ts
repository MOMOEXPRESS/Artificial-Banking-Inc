import type { Config } from "tailwindcss";

/**
 * Tailwind coexists with the hand-rolled console CSS.
 * preflight is OFF so existing button/input/card styles are not reset.
 * New shadcn/cmdk components use utility classes only.
 */
const config: Config = {
  darkMode: ["class"],
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}", "./src/lib/**/*.{ts,tsx}"],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      // Mirror the CSS design tokens (globals.css + design-system.css) so
      // utility classes and hand-rolled CSS can never drift apart.
      colors: {
        border: "var(--color-border)",
        input: "var(--color-border)",
        ring: "var(--color-ring)",
        background: "var(--color-surface)",
        foreground: "var(--color-fg)",
        primary: {
          DEFAULT: "var(--color-accent)",
          foreground: "#ffffff",
        },
        muted: {
          DEFAULT: "var(--color-surface-3)",
          foreground: "var(--color-fg-muted)",
        },
        accent: {
          DEFAULT: "var(--color-surface-3)",
          foreground: "var(--color-fg)",
        },
        popover: {
          DEFAULT: "var(--color-surface-solid)",
          foreground: "var(--color-fg)",
        },
        card: {
          DEFAULT: "var(--color-surface-2)",
          foreground: "var(--color-fg)",
        },
      },
      borderRadius: {
        lg: "var(--radius-lg)",
        md: "var(--radius-md)",
        sm: "var(--radius-sm)",
      },
      fontFamily: {
        sans: ["var(--font-sans-stack)"],
        mono: ["var(--font-mono-stack)"],
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
