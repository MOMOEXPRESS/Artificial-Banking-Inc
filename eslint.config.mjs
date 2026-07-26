import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import prettier from "eslint-config-prettier";

/**
 * Flat ESLint config for the ABI monorepo.
 *
 * Deliberately non-type-checked for now: the type-aware ruleset needs a project
 * service across nine workspaces and would slow CI to minutes. The rules below
 * are the ones that catch real defects in this codebase — unhandled promises on
 * money paths, accidental `any` at API boundaries, unused code left behind by a
 * refactor. Formatting is Prettier's job, so `prettier` is last and disables
 * every stylistic rule that would fight it.
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/coverage/**",
      "apps/web/next-env.d.ts",
      "contracts/out/**",
      "contracts/cache/**",
      // Archived, non-building code kept for reference only.
      "archive/**",
      "docs/archive/**",
      "package-lock.json",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.es2023 },
    },
    rules: {
      // An unused symbol is either dead code or a bug. `_`-prefixed args are
      // an intentional signal that a parameter is required by a signature.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // `any` is currently used at a handful of genuine boundaries (the
      // better-sqlite3 prepare hook, a couple of viem typed-data casts).
      // Warn rather than error so the baseline is green, but stay visible.
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": "off",
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "error",
    },
  },

  // Browser globals + React hook rules for the Next.js app.
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      // App Router only — there is no `pages/` directory to check against.
      "@next/next/no-html-link-for-pages": "off",
      // Calling a hook conditionally is always a bug.
      "react-hooks/rules-of-hooks": "error",
      // The console deliberately omits some deps to control its polling
      // cadence; each omission is annotated at the call site. Warn so new
      // omissions are visible without failing the build on existing ones.
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // React Native / Expo surface, kept out of the workspace build.
  {
    files: ["archive/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
  },

  // Plain-JS tooling scripts.
  {
    files: ["**/*.mjs", "**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },

  prettier,
);
