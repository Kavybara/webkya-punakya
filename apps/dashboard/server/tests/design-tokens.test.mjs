import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * The app used to carry four private colour vocabularies -- `--kavya-*`,
 * `--console-*`, `--auth-*`, `--reseller-*` -- across four stylesheets. Three
 * held the same thirteen values under different names and the fourth was one
 * or two steps out of true, so the owner console and the reseller console
 * were not the same colour. Nine of the sixty declared tokens were read by
 * nothing, including three copies of one magenta.
 *
 * Consolidation is exactly the kind of change that a later contributor
 * undoes with a well-meaning copy-paste, so this holds the line on the two
 * ways it comes back: a component inventing its own palette, and a token
 * declared in one theme but not the other.
 */

const SRC = path.resolve("src");
const TOKENS = path.join(SRC, "styles", "tokens.css");

const tokensSource = fs.readFileSync(TOKENS, "utf8");

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(tsx|ts|css)$/.test(entry.name) ? [full] : [];
  });
}

const rel = (file) => path.relative(path.resolve(), file).replace(/\\/g, "/");

/** Every `--name` that a block inside `tokens.css` declares. */
function declaredIn(blockPattern) {
  const block = tokensSource.match(blockPattern);
  assert.ok(block, `tokens.css no longer has the block ${blockPattern}`);
  return new Set([...block[0].matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
}

const LIGHT = declaredIn(/:root\s*\{[\s\S]*?\n\}/);
const DARK = declaredIn(/\.kavya-public-dark,\s*[\s\S]*?\{[\s\S]*?\n\}/);

test("tokens.css declares the palette in one place", () => {
  const others = sourceFiles(SRC)
    .filter((file) => file !== TOKENS)
    .filter((file) => /^\s*--[a-z0-9-]+\s*:/m.test(fs.readFileSync(file, "utf8")))
    .map(rel);

  assert.deepEqual(others, [], `a stylesheet declares its own tokens: ${others.join(", ")}`);
});

test("both themes declare the same token names", () => {
  // A token present in one theme and not the other is not a theme variant,
  // it is a bug waiting for a visitor: the property falls back to `unset`.
  // The dark roots inherit the accents and status colours from `:root`, so
  // those are shared by construction and are the only permitted asymmetry.
  const INHERITED = /^--(accent|status)-/;

  const darkOnly = [...DARK].filter((name) => !LIGHT.has(name));
  const lightOnly = [...LIGHT].filter((name) => !DARK.has(name) && !INHERITED.test(name));

  assert.deepEqual(darkOnly, [], "token missing from the light theme");
  assert.deepEqual(lightOnly, [], "token missing from the dark roots");
});

test("no component reaches for a colour that is not a token", () => {
  // Tailwind's stock ramp is how a design system quietly stops being one:
  // `text-slate-500` is unanswerable to the question "what is this meant to
  // mean?". Arbitrary values are fine -- they are the escape hatch for the
  // rare one-off -- but they must name a token.
  const allowed = new Set([...LIGHT, ...DARK]);
  const offenders = [];

  for (const file of sourceFiles(SRC)) {
    if (file === TOKENS) continue;
    const text = fs.readFileSync(file, "utf8");

    for (const [, value] of text.matchAll(/\[var\((--[a-z0-9-]+)\)\]/g)) {
      if (!allowed.has(value)) offenders.push(`${rel(file)}: ${value}`);
    }
  }

  assert.deepEqual(offenders, [], `undeclared token referenced: ${offenders.join(", ")}`);
});

test("a tinted wash names its token instead of repeating the hue", () => {
  // The three feature stylesheets held 43 different violet alphas, 30 cyans
  // and 27 greens. Nobody could remember which of 0.23 and 0.25 was the active
  // nav border, so they made a new one. The alpha is a deliberate per-use
  // choice; the hue was never meant to be a choice at all, and
  // `color-mix(in srgb, var(--accent-violet) 23%, transparent)` composites to
  // exactly the same pixels as `rgba(139, 92, 246, 0.23)`.
  const HUES = ["139, 92, 246", "236, 72, 153", "56, 189, 248", "52, 211, 153", "251, 191, 36", "251, 113, 133", "96, 165, 250"];
  const hue = new RegExp(String.raw`rgba\(\s*(?:${HUES.join("|")})\s*,`, "g");
  const offenders = sourceFiles(SRC)
    .filter((file) => file !== TOKENS)
    .filter((file) => hue.test(fs.readFileSync(file, "utf8")))
    .map(rel);

  assert.deepEqual(offenders, [], `hard-coded palette hue in ${offenders.join(", ")}`);
});

test("the dark roots are declared once, as a single selector list", () => {
  // The four dark roots are the same colour. The moment a fifth stylesheet
  // grows its own copy we are back to four vocabularies.
  const DARK_ROOTS = [".kavya-public-dark", ".kavya-console", ".auth-shell", ".kavya-reseller-v2"];

  // Comments carry no braces here, but they carry prose, and a selector
  // match that starts at the top of the file would swallow all of it.
  const declarations = tokensSource.replace(/\/\*[\s\S]*?\*\//g, "");
  const paletteRules = [...declarations.matchAll(/([^{}]+)\{([^}]*--bg-canvas:[^}]*)\}/g)]
    .map((match) => match[1].trim().split(",").map((part) => part.trim()));

  assert.deepEqual(
    paletteRules,
    [[":root"], DARK_ROOTS],
    "the palette is declared somewhere other than :root and the four dark roots",
  );
});
