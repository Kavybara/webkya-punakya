import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

const eslintConfig = await readFile(new URL("eslint.config.js", root), "utf8");
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));

/*
 * Phase 6 turned on the type-aware lint rules. Two things about that are easy
 * to undo by accident, and neither shows up as a failing test:
 *
 *   1. Dropping `projectService`. Without it the type-aware rules stop
 *      working -- and they fail *open*. They report nothing and pass, which is
 *      the same output as a clean codebase. A gate that cannot fail is worse
 *      than no gate, because it is believed.
 *   2. Flipping an `error` back to a `warn`. A warning still prints in the
 *      terminal, where it is easy to scroll past, and the exit code stays 0.
 *
 * So this asserts the configuration itself. It does not run eslint -- the real
 * `npx eslint src` in the verification gate does that, and this file is what
 * makes the difference between that gate meaning something and not.
 */

/** Strips block and line comments so a rule named in prose is not read as set. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Regex-escapes a rule name so its `/` is a literal, not a delimiter. */
function escapeRule(rule) {
  return rule.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

const code = stripComments(eslintConfig);

test("the type-aware rules are wired to the program, not left inert", () => {
  assert.match(
    code,
    /projectService:\s*true/,
    "without projectService the type-aware rules cannot resolve types and report nothing",
  );
  assert.match(code, /tsconfigRootDir:/, "projectService needs a root to resolve the tsconfig from");

  // The plugin must be registered. A rule referencing an unregistered plugin
  // is a hard crash, so ESLint would catch this one -- but only on a run,
  // whereas this fails in the ordinary test suite.
  assert.match(code, /"@typescript-eslint":\s*tseslint\.plugin/);
});

test("every promoted rule is an error, not a warning", () => {
  const promoted = [
    "@typescript-eslint/no-floating-promises",
    "@typescript-eslint/await-thenable",
    "@typescript-eslint/no-misused-promises",
    "@typescript-eslint/no-unused-vars",
    "@typescript-eslint/no-empty-object-type",
    "@typescript-eslint/consistent-type-imports",
  ];

  for (const rule of promoted) {
    // Read the severity that follows the rule key. The value is either a bare
    // `"error"` string, or `[` + newline + `"error"` + an options object, so
    // the `[` and any whitespace between it and the word must both be allowed.
    const match = code.match(new RegExp(`"${escapeRule(rule)}"\\s*:\\s*\\[?\\s*(["'][a-z]+"?)`));
    assert.ok(match, `${rule} is no longer configured -- re-check whether it should be on`);
    assert.equal(
      match[1],
      '"error"',
      `${rule} was demoted to a warning. A warning keeps the exit code at 0, so the gate stops gating.`,
    );
  }
});

test("the promise rules that are off stay off, with the reason recorded", () => {
  // These four are off on purpose: the API layer types its boundary as
  // `unknown` and parses at runtime, so switching them on is a typing project,
  // not a config edit. If someone flips one on and it passes, the comment
  // explaining why it was off is the only thing that tells them it worked.
  for (const rule of [
    "@typescript-eslint/no-unsafe-assignment",
    "@typescript-eslint/no-unsafe-member-access",
    "@typescript-eslint/no-unsafe-call",
    "@typescript-eslint/no-unsafe-return",
  ]) {
    assert.match(
      code,
      new RegExp(`"${rule.replace("/", "\\/")}"\\s*:\\s*"off"`),
      `${rule} is no longer off -- update the comment above it to say why it is safe now`,
    );
  }

  assert.match(
    eslintConfig,
    /unknown/,
    "the reason these are off should stay in the config as prose, not just as a silent setting",
  );
});

test("the React attribute exception is deliberate and scoped", () => {
  // `attributes: false` is correct for React and wrong for a plain callback
  // parameter. Dropping the whole option would flag every async onClick;
  // dropping the `arguments: true` half would stop catching a real one.
  assert.match(code, /checksVoidReturn:\s*\{\s*attributes:\s*false,\s*arguments:\s*true\s*\}/);
});

test("the dashboard's lint script covers what the gate actually lints", () => {
  // `npm run lint` is what someone runs locally. It must not silently lint a
  // narrower set than `npx eslint src server`, which is the verification gate.
  assert.equal(pkg.scripts.lint, "eslint src");
  assert.ok(
    (pkg.devDependencies?.eslint || "").length > 0,
    "eslint must stay a devDependency of this package, not a transitive one",
  );
});