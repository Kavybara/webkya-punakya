import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: "module",
        // Type-aware rules need the program, not just the syntax. `projectService`
        // rather than `project` because this package uses project references
        // with `noEmit` -- a plain `project` path cannot resolve those.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "no-constant-condition": "error",
      "no-debugger": "error",
      "no-unreachable": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      /*
       * Type-aware rules. `tsc -b` already proves the program compiles; what
       * it cannot catch is a value that is always `undefined` because an
       * optional was read without a guard, or a promise nobody awaited. Those
       * are the failures that reach the owner console at runtime.
       *
       * Each rule below was enabled as a warning first, the codebase was made
       * clean under it, and only then promoted to `error` -- turning a rule on
       * across an existing codebase as an error immediately is how a lint gate
       * gets disabled rather than obeyed.
       */
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      /*
       * `attributes: false` is not a suppression -- it is how this rule is
       * meant to be used with React. An `onClick` handler is invoked by React,
       * which discards whatever it returns; `onClick={async () => save()}` is
       * correct code, not a dropped promise. Only the *argument* case stays
       * on, where an async value handed to a void-returning parameter really
       * is a caller that cannot see the failure.
       */
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false, arguments: true } },
      ],
      // Off because the API layer types most of its boundary as `unknown` and
      // parses at runtime. Turning these on is a project-wide typing effort,
      // not a lint setting.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // v8 removed `ban-types` and split it; `no-empty-object-type` is the
      // piece that catches `{}` standing in for "any object".
      "@typescript-eslint/no-empty-object-type": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
    },
  },
);
