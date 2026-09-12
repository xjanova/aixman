import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The same files eslint-config-next registers the react-hooks plugin for;
    // outside them the rule would name a plugin that is not loaded.
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      // eslint-config-next leaves this off, and it is the only rule that
      // reports React Compiler *giving up* on a component (a `finally`, or a
      // `throw` / `||` / `?.` / ternary inside try/catch). Without it the
      // compiler bails silently: the component loses memoization and every
      // compiler-based rule below stops checking it. Fix a hit by moving the
      // try/catch into a module-level helper that returns errors as values
      // (see src/lib/client-actions.ts).
      "react-hooks/todo": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Claude Code's isolated worktrees: other checkouts of this repo, each
    // with its own .next build output (25k+ findings that are not this tree).
    ".claude/**",
  ]),
]);

export default eslintConfig;
