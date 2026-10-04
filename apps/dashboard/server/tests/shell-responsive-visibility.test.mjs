import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../src/", import.meta.url);

const shellCss = await readFile(new URL("components/ui/shell.css", root), "utf8");
const appShell = await readFile(new URL("components/ui/AppShell.tsx", root), "utf8");

/*
 * The rail is one JSX fragment rendered twice -- once into the desktop aside,
 * once into the drawer aside. Every button in it therefore exists in the DOM
 * twice, and `is-desktop-only` / `is-mobile-only` are the only thing telling
 * the reader which copy is live.
 *
 * Those two class names had their default inverted: the stylesheet hid
 * `is-desktop-only` outside any media query. The visible button on a desktop
 * screen was therefore the drawer close -- an `X` wired to `setDrawerOpen(false)`
 * while no drawer was open, so pressing it did nothing at all -- and the
 * collapse button that actually works there was missing. Under 1023px both
 * classes were restated inside the media query, which is why a phone looked
 * fine and only the desktop rail was broken.
 */

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Index of the `}` closing the block that opens at `open`. */
function closingBrace(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** Splits a stylesheet into declarations at the top level and inside @media. */
function splitStyles(css) {
  const text = stripComments(css);
  const media = [];
  let base = "";
  let index = 0;

  for (;;) {
    const at = text.indexOf("@media", index);
    if (at === -1) {
      base += text.slice(index);
      break;
    }
    base += text.slice(index, at);
    const open = text.indexOf("{", at);
    const close = closingBrace(text, open);
    if (open === -1 || close === -1) throw new Error("unbalanced @media block in shell.css");
    media.push({ query: text.slice(at, open).trim(), body: text.slice(open + 1, close) });
    index = close + 1;
  }

  return { base, media };
}

/** Every `display` value declared for `className` inside `scope`. */
function displaysFor(scope, className) {
  const found = [];
  for (const [, selector, declarations] of scope.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!new RegExp(`\\.${className}\\b`).test(selector)) continue;
    const declaration = declarations.match(/(?:^|;)\s*display\s*:\s*([^;]+)/);
    if (declaration) found.push(declaration[1].trim());
  }
  return found;
}

/** The @media block whose query matches `pattern`, or undefined. */
function mediaBlock(pattern) {
  return splitStyles(shellCss).media.find((entry) => pattern.test(entry.query));
}

test("outside any media query the mobile-only button is the hidden one", async () => {
  const { base } = splitStyles(shellCss);

  assert.deepEqual(
    displaysFor(base, "is-mobile-only"),
    ["none"],
    "the drawer close must be hidden by default, or it shows on desktop where it does nothing",
  );
  assert.deepEqual(
    displaysFor(base, "is-desktop-only"),
    [],
    "the collapse button needs no default rule -- hiding it is what broke the desktop rail",
  );
});

test("the drawer breakpoint swaps the two back", async () => {
  const narrow = mediaBlock(/max-width:\s*1023px/);
  assert.ok(narrow, "the 1023px breakpoint is what the drawer and the two rail buttons flip on");

  assert.deepEqual(displaysFor(narrow.body, "is-mobile-only"), ["inline-grid"]);
  assert.deepEqual(displaysFor(narrow.body, "is-desktop-only"), ["none"]);
});

test("each rail button is labelled for the action it performs", async () => {
  // Names alone do not keep the two straight: a reader has to be able to see
  // that the X closes the drawer and the other one collapses the sidebar,
  // because swapping the classes is exactly the bug this file guards.
  const rail = appShell.slice(
    appShell.indexOf("const rail = ("),
    appShell.indexOf("<div className=\"ui-shell-workspace\">"),
  );
  assert.ok(rail.length > 0, "could not find the rail fragment");

  const closeButton = rail.slice(
    rail.indexOf("is-mobile-only"),
    rail.indexOf("is-mobile-only") + 300,
  );
  assert.match(closeButton, /aria-label="Tutup menu"/);
  assert.match(closeButton, /setDrawerOpen\(false\)/);

  const collapseButton = rail.slice(0, rail.indexOf("is-mobile-only"));
  assert.match(collapseButton, /aria-label=\{collapsed \? "Perbesar sidebar" : "Perkecil sidebar"\}/);
  assert.match(collapseButton, /setCollapsed\(\(value\) => !value\)/);
});

test("the rail fragment is rendered into both asides", async () => {
  // The reason this bug reached a desktop user at all. One fragment, two
  // mount points, so neither copy of a button can be removed from the DOM --
  // only hidden. That is what the two visibility classes are for.
  assert.match(appShell, /<aside className="ui-shell-sidebar is-desktop">\{rail\}<\/aside>/);
  assert.match(appShell, /<aside className="ui-shell-sidebar is-drawer"[^>]*>\s*\{rail\}/);
});
