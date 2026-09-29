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

test("a colour that already has a token is not spelled out again", () => {
  // The stylesheets had ten near-blacks that no person could tell apart --
  // #131419 against #111216 is a difference of two in a hundred and twenty
  // -- and six greys standing in for one. Every one of them was a decision
  // nobody was making on purpose.
  //
  // The list is read out of tokens.css rather than written here, so adding a
  // token automatically extends the rule to its value.
  const values = new Set(
    [...tokensSource.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)]
      .map(([, , value]) => value.toLowerCase()),
  );

  const offenders = [];
  for (const file of sourceFiles(SRC)) {
    if (file === TOKENS) continue;
    const text = fs.readFileSync(file, "utf8");

    for (const match of text.matchAll(/#[0-9a-f]{6}\b/gi)) {
      // A hex that is the entire content of a quoted value is an SVG
      // presentation attribute: recharts passes `stroke` and `tick.fill`
      // straight through to the element, and `var()` is only substituted in
      // CSS declarations, so a token there renders as black. The revenue
      // chart is the one place this still applies.
      const before = text[match.index - 1];
      const after = text[match.index + match[0].length];
      if ((before === '"' && after === '"') || (before === "'" && after === "'")) continue;

      // Nor a hex inside `[class~="bg-[#f2ece2]"]`. That is the reseller
      // console's legacy adapter, matching a Tailwind class name written in
      // some page's JSX; the hex is a class, not a colour being painted, and
      // it disappears with the adapter.
      const selector = text.slice(Math.max(0, match.index - 60), match.index);
      if (/\[class[~|^$*]?=["'][^"']*$/.test(selector)) continue;

      const value = match[0].toLowerCase();
      if (values.has(value)) offenders.push(`${rel(file)}: ${value}`);
    }
  }

  assert.deepEqual(offenders, [], `token value written out by hand: ${offenders.join(", ")}`);
});

test("every Tailwind colour points at a token that exists", () => {
  // A typo here is invisible. `var(--text-prmary)` is not an error to
  // Tailwind, PostCSS or the browser; it compiles, ships, and renders as
  // nothing at all, so `text-primary` would quietly stop colouring text and
  // nobody would find out until the page looked wrong.
  const config = fs.readFileSync(path.resolve("tailwind.config.js"), "utf8");
  const declared = new Set([...LIGHT, ...DARK]);
  const dangling = [...config.matchAll(/var\((--[a-z0-9-]+)\)/g)]
    .map((match) => match[1])
    .filter((name) => !declared.has(name));

  assert.deepEqual([...new Set(dangling)], [], `tailwind.config.js points at an undeclared token`);
});

test("the dark roots are declared once, as a single selector list", () => {
  // The three dark roots are the same colour: the public marketing pages, the
  // sign-in shell, and the one signed-in frame both consoles share. The moment
  // a fourth stylesheet grows its own copy we are back to four vocabularies.
  const DARK_ROOTS = [".kavya-public-dark", ".auth-shell", ".ui-shell"];

  // Comments carry no braces here, but they carry prose, and a selector
  // match that starts at the top of the file would swallow all of it.
  const declarations = tokensSource.replace(/\/\*[\s\S]*?\*\//g, "");
  const paletteRules = [...declarations.matchAll(/([^{}]+)\{([^}]*--bg-canvas:[^}]*)\}/g)]
    .map((match) => match[1].trim().split(",").map((part) => part.trim()));

  assert.deepEqual(
    paletteRules,
    [[":root"], DARK_ROOTS],
    "the palette is declared somewhere other than :root and the three dark roots",
  );
});
