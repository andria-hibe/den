import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// Lightweight, non-type-checked lint pass: catches unused vars, obvious mistakes,
// and React hook-rule violations without the cost of full type-aware linting.
// `npm run typecheck` already provides the type-level safety net. Build/QA
// helper scripts under scripts/ are dev tooling and are left unlinted.
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "release/**",
      "build/**",
      "node_modules/**",
      "scripts/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // den leans on `any` in a few interop spots (route bodies, gh/Linear JSON);
      // surface it as a nudge, not a build-breaking error.
      "@typescript-eslint/no-explicit-any": "warn",
      // Terminal code legitimately matches ESC/BEL control chars (OSC titles).
      "no-control-regex": "off",
    },
  },
  // Server / Electron / build config run in Node.
  {
    files: ["server/**", "electron/**", "*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
  // The web app runs in the browser.
  {
    files: ["web/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
