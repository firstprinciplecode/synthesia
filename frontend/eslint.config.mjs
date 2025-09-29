import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      // Ignore Next.js outputs and any backup variants
      ".next/**",
      ".next*/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    rules: {
      // Allow flexible typing in UI layers (can tighten later)
      "@typescript-eslint/no-explicit-any": "off",
      // Enforce hooks deps
      "react-hooks/exhaustive-deps": "error",
      // Enforce no unused expressions (avoid ternary side-effects)
      "@typescript-eslint/no-unused-expressions": "error",
      "no-unused-expressions": "error",
      // Re-enable alt text accessibility
      "jsx-a11y/alt-text": "error",
      // Keep allowing <img> vs next/image for now
      "@next/next/no-img-element": "off",
      // Unused vars only warn for now; ignore underscore-prefixed
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "ignoreRestSiblings": true }
      ],
  },
  },
  // Enforce reporting of unused disable directives via core linter options
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
];

export default eslintConfig;
