import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import next from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "dist/**",
    "out/**",
    "build/**",
    ".vinext/**",
    ".wrangler/**",
    "vendor/**",
    "release/**",
    "outputs/**",
    "work/**",
    "next-env.d.ts",
  ]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs.flat["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  next.configs["core-web-vitals"],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      // These effects intentionally synchronize the desktop bridge and
      // persisted local application state after hydration.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      // Review media is local and may be very tall; Next Image optimization
      // would copy or transform source material and is intentionally avoided.
      "@next/next/no-img-element": "off",
      // Scrollable captions deliberately expose keyboard focus as a named
      // region; the generic rule does not recognize that desktop pattern.
      "jsx-a11y/no-noninteractive-tabindex": "off",
    },
  },
  {
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);

export default eslintConfig;
