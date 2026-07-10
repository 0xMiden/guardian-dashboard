import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "temp/**",
    "next-env.d.ts",
  ]),
  // Test files legitimately need `as any` to mock complex third-party types
  // (Clerk, SWR, etc.) — loosen the rule rather than pollute tests with casts.
  // next/image and a11y rules don't apply to test mocks.
  {
    files: ["__tests__/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@next/next/no-img-element": "off",
      "jsx-a11y/alt-text": "off",
    },
  },
]);

export default eslintConfig;
