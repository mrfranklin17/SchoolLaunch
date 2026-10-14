import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // One-off analysis scripts from the V11 Cedar Grove validation, kept as a record of how
    // its numbers were produced. Not part of the app or the test suites, and never run again.
    "tests/audit/v11-cedar-grove/session2/scripts/**",
  ]),
  // CommonJS build scripts (e.g. scripts/gen-engine-version.cjs) load modules with require().
  {
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);

export default eslintConfig;
