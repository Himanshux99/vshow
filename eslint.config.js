import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["build/", ".react-router/", "node_modules/", "drizzle/", "coverage/", ".agents/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node scripts and config files: Node globals, console output is intentional.
    files: ["scripts/**", "tests/**", "*.config.{js,ts}", "app/db/**"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly" } },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
