import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

/**
 * A shared component must be styled by a stylesheet the shared tree owns.
 *
 * This is the check that would have caught the navbar arriving on `/harga` as
 * an unstyled `<nav>`.
 *
 * Vite splits CSS per lazy route chunk, and it splits it by *importer*, not by
 * subject. `PublicNavbar` is rendered by `/` and by `/harga`, but its rules
 * lived in `pages/home/home.css`, so they were emitted into the **home page's**
 * chunk. Loading `/harga` never loads that chunk, so every `.home-nav*` rule
 * was simply absent there: no fixed positioning, no pill buttons, no mobile
 * sheet, no focus ring. The markup rendered, the page worked, every test
 * passed, and the nav was an unformatted run of text.
 *
 * Nothing in the build reports this. The CSS is not missing from the
 * application, only from one route's stylesheet list, so the bundler, the
 * linter and the type checker all have nothing to say.
 *
 * The rule: a class a component under `src/components` uses has to be defined
 * in a stylesheet outside `src/pages`, or in the same file the component is
 * rendered by. A class defined *only* in a page stylesheet is invisible to
 * every route that is not that page -- so any shared component using one is
 * broken somewhere, and the "somewhere" depends on import order.
 *
 * "Only" is the operative word. A class may legitimately be defined in both a
 * shared stylesheet and a page one; `.is-primary` and `.ui-field` both are.
 * That is duplication, not a broken route, and it is deliberately out of scope
 * here. What this test forbids is a class with no shared definition at all.
 */

const SRC = path.resolve("src");
const PAGES = path.join(SRC, "pages");
const COMPONENTS = path.join(SRC, "components");

async function filesUnder(dir, extension, found = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await filesUnder(full, extension, found);
    else if (entry.name.endsWith(extension)) found.push(full);
  }
  return found;
}

/** Class names a stylesheet defines, as `.foo` selectors at any depth. */
function classesDefinedIn(css) {
  return [...css.matchAll(/\.([a-z][\w-]+)/g)].map((match) => match[1]);
}

/** Class names a component puts in a literal `className`. */
function classesUsedIn(tsx) {
  const used = [];
  for (const match of tsx.matchAll(/className="([^"]+)"/g)) {
    used.push(...match[1].split(/\s+/).filter(Boolean));
  }
  return used;
}

const [pageStylesheets, allStylesheets, componentFiles] = await Promise.all([
  filesUnder(PAGES, ".css"),
  filesUnder(SRC, ".css"),
  filesUnder(COMPONENTS, ".tsx"),
]);

/**
 * Classes no shared stylesheet defines, mapped to the page stylesheet that
 * does. Two passes on purpose: a single pass would make the result depend on
 * directory walk order, and `.is-primary` -- defined in both
 * `components/ui/ui.css` and `pages/reseller-v2/settings/settings.css` -- would
 * be reported or not depending on which file the walker happened to reach
 * first.
 */
const sharedDefinitions = new Set();
for (const file of allStylesheets.filter((f) => !f.startsWith(PAGES))) {
  const css = await readFile(file, "utf8");
  for (const name of classesDefinedIn(css)) sharedDefinitions.add(name);
}

const pageOnly = new Map();
for (const file of pageStylesheets) {
  const css = await readFile(file, "utf8");
  for (const name of classesDefinedIn(css)) {
    if (sharedDefinitions.has(name)) continue;
    if (!pageOnly.has(name)) pageOnly.set(name, file);
  }
}

test("a shared component is never styled by a page-only stylesheet", async () => {
  const violations = [];
  for (const file of componentFiles) {
    const tsx = await readFile(file, "utf8");
    for (const name of classesUsedIn(tsx)) {
      const owner = pageOnly.get(name);
      if (owner) violations.push(`${path.relative(SRC, file)} uses .${name}, defined only in ${path.relative(SRC, owner)}`);
    }
  }
  assert.deepEqual(
    [...new Set(violations)].sort(),
    [],
    `these render unstyled on every route that is not the owning page, because CSS is emitted per route chunk:\n  ${[...new Set(violations)].sort().join("\n  ")}`,
  );
});

test("the navbar's styles travel with the navbar", async () => {
  // The specific instance, asserted directly as well as by the rule above.
  //
  // The rule catches the class only if it is used in a `className="..."`
  // literal; a `clsx` call or a composed class name would slip past it. The
  // navbar is the component every public route renders, so it is worth pinning
  // the arrangement itself: its stylesheet is a sibling of the component and
  // the component imports it. That import is what puts the CSS in the chunk
  // that contains the component, which is the whole mechanism.
  const navbar = await readFile(path.join(COMPONENTS, "feature", "PublicNavbar.tsx"), "utf8");
  assert.match(
    navbar,
    /import "\.\/PublicNavbar\.css"/,
    "PublicNavbar must import its own stylesheet; Vite emits CSS per route chunk, by importer",
  );
  const homeCss = await readFile(path.join(PAGES, "home", "home.css"), "utf8");
  const leaked = classesDefinedIn(homeCss).filter((name) => name.startsWith("home-nav"));
  assert.deepEqual(
    leaked,
    [],
    `.home-nav* rules are back in the landing page's stylesheet, where only / loads them: ${leaked.join(", ")}`,
  );
});

test("the navbar's mobile menu closes on Escape", async () => {
  // `<details>` gives you a keyboard-operable disclosure for nothing: the
  // summary takes focus and Enter opens. It does *not* give you Escape, in any
  // browser -- `<dialog>` and `<popover>` close on Escape, `<details>` does
  // not. That was assumed to be free when this menu was first written in terms
  // of `<details>` instead of `useState`, and it was wrong: verified by
  // dispatching a real Escape key to the page, which left the menu open. The
  // only ways out were tabbing back to the summary, or tapping the page.
  //
  // Focus returning to the summary is part of the same assertion. Closing a
  // disclosure while focus is inside it strands the keyboard user on `<body>`,
  // so a menu that closes on Escape but drops focus is not the fix.
  const navbar = await readFile(path.join(COMPONENTS, "feature", "PublicNavbar.tsx"), "utf8");

  assert.match(navbar, /onKeyDown=\{onMenuKeyDown\}/, "the <details> must handle keys itself");
  assert.match(navbar, /event\.key !== "Escape"/, "the handler must key off Escape");
  assert.match(navbar, /removeAttribute\("open"\)/, "Escape has to actually close the disclosure");
  assert.match(
    navbar,
    /querySelector\("summary"\)\?\.focus\(\)/,
    "focus must go back to the toggle, or it is stranded on <body>",
  );
});
