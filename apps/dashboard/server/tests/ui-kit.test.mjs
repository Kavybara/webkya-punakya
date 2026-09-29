import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const uiDir = new URL("../../src/components/ui/", import.meta.url);

async function kit() {
  const files = await readdir(uiDir);
  const sources = await Promise.all(
    files.filter((name) => name.endsWith(".tsx")).map((name) => readFile(new URL(name, uiDir), "utf8")),
  );
  const styles = await Promise.all(
    files.filter((name) => name.endsWith(".css")).map((name) => readFile(new URL(name, uiDir), "utf8")),
  );
  return { files, text: sources.join("\n"), css: styles.join("\n") };
}

/**
 * The class names the kit is allowed to use.
 *
 * A kit component that reaches for `--console-surface` or `.reseller-v2-badge`
 * is not a kit component, it is a console component that happens to have moved
 * -- and the next thing to happen is the console it was named for being
 * deleted, taking the class with it.
 */
const OFF_PREFIX = /(?:console|reseller|kavya|auth)-/;

test("no component in the ui kit names a class after a feature", async () => {
  const { text } = await kit();
  const offenders = [...text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
    .flatMap((match) => (match[1] ?? match[2] ?? "").split(/\s+/))
    .filter((name) => name && OFF_PREFIX.test(name));
  assert.deepEqual(offenders, [], `ui/ classes must be feature-neutral, found: ${offenders.join(", ")}`);
});

test("the ui kit declares every ui- class it renders", async () => {
  // A `ui-` class the kit renders but no stylesheet defines is a silent
  // no-op: the element picks up whatever cascade rule happens to match, and
  // the bug only shows up as "it looks slightly off" in a screenshot.
  //
  // Every stylesheet the kit owns counts, not just ui.css -- the shell lives
  // in shell.css, and a check that only read ui.css would have passed while
  // the entire signed-in frame was unstyled.
  //
  // Scoped to `ui-` on purpose. A kit component may legitimately use a
  // Tailwind utility such as `sr-only`; what must never happen is the kit
  // depending on a class that its own stylesheets do not own.
  const { text, css } = await kit();
  const rendered = new Set();
  for (const match of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    for (const name of (match[1] ?? match[2] ?? "").split(/\s+/)) {
      if (/^ui-[a-z0-9-]+$/.test(name)) rendered.add(name);
    }
  }
  assert.ok(rendered.size > 20, `expected to find the kit's classes, found only ${rendered.size}`);
  const unstyled = [...rendered].filter((name) => !new RegExp(`\\.${name}\\b`).test(css));
  assert.deepEqual(unstyled.sort(), [], `ui/ classes with no stylesheet rule: ${unstyled.join(", ")}`);
});

test("the ui kit does not depend on a feature stylesheet", async () => {
  // The whole point of the kit is that it is the single answer. If a `.ui-`
  // rule still lives in console.css, then deleting the console deletes the
  // appearance of something the reseller is also using.
  const { files } = await kit();
  const [consoleCss, resellerCss] = await Promise.all([
    readFile(new URL("../../src/components/console/console.css", import.meta.url), "utf8"),
    readFile(new URL("../../src/components/reseller-v2/reseller-v2.css", import.meta.url), "utf8"),
  ]);
  for (const [name, css] of [["console.css", consoleCss], ["reseller-v2.css", resellerCss]]) {
    const strays = [...css.matchAll(/^\s*(\.ui-[a-z0-9-]+)/gm)].map((match) => match[1]);
    assert.deepEqual([...new Set(strays)], [], `${name} still owns kit rules: ${[...new Set(strays)].join(", ")}`);
  }
  // And the table, which is the most-used surface in the app, must be in there.
  assert.ok(files.includes("ui.css"), "the kit must own a stylesheet");
  assert.match(await readFile(new URL("../../src/components/ui/ui.css", import.meta.url), "utf8"), /\.ui-table-scroll/);
});

/**
 * These are the capabilities the kit exists to preserve.
 *
 * Each one was present in only one of the two consoles, which is exactly the
 * situation that produced two half-products. They are asserted here so that a
 * later "let's keep it simple" edit cannot quietly drop the focus trap or the
 * empty state and leave the other console worse off than it was.
 */
test("the ui kit keeps the capabilities only one console had", async () => {
  const { text } = await kit();

  // Keyboard accessibility for the dialog. Both the trap and the restore.
  // Matched loosely on the key comparison: `!== "Tab"` and `=== "Tab"` are the
  // same contract, and neither spelling is worth failing a build over.
  assert.match(text, /event\.key\s*[!=]==?\s*"Tab"/, "overlay must handle Tab");
  assert.match(text, /event\.shiftKey/, "overlay must trap Shift+Tab");
  assert.match(text, /restoreRef\.current\?\.focus\(\)/, "overlay must restore focus on close");
  assert.match(text, /closeRef\.current\?\.focus\(\)/, "overlay must move focus into the panel");
  assert.match(text, /event\.key === "Escape"/, "overlay must close on Escape");

  // The three data states, which the owner console was missing two of.
  assert.match(text, /export function LoadingState/);
  assert.match(text, /export function EmptyState/);
  assert.match(text, /export function ErrorState/);

  // An error the reader can act on.
  assert.match(text, /Coba Lagi/);

  // A credential that conceals itself.
  assert.match(text, /REVEAL_AFTER_MS/);
  assert.match(text, /concealAfterMs/);

  // A confirm that says what is being confirmed.
  assert.match(text, /export function ConfirmDialog/);
});

test("the empty state does not claim success or failure", async () => {
  const { text } = await kit();
  const empty = text.slice(text.indexOf("export function EmptyState"), text.indexOf("export function ErrorState"));
  // A tick on an empty region asserts that something worked. It is the most
  // common state on most pages, so a success mark there is a standing lie.
  assert.doesNotMatch(empty, /<Check\b/, "the empty state must not render a success tick");
  // And it must not announce itself as a failure either: `role="alert"` is
  // reserved for something that went wrong, and "there is nothing here yet" is
  // not that. The error state is where the alert role belongs.
  assert.doesNotMatch(empty, /role="alert"/, "an empty region is not an error and must not announce as one");
  assert.match(text, /className="ui-state is-error" role="alert"/, "the error state is where role=alert belongs");
});

/**
 * The frame must stay one frame.
 *
 * There were two, 79% identical, and they drifted: the owner console had a
 * notification centre and no bottom bar, the reseller had a bottom bar and no
 * notification centre, and they spelled the same refresh button two different
 * ways. A copy that grows back is not a style regression -- it is the second
 * arrangement returning, and it is how the two got this far apart in the
 * first place.
 */
const SHELL_CLASSES = [
  "console-sidebar", "console-topbar", "console-nav-link", "console-brand-row",
  "console-profile-menu", "console-page-header", "console-workspace",
  "reseller-v2-sidebar", "reseller-v2-topbar", "reseller-v2-nav-link",
  "reseller-v2-bottom-nav", "reseller-v2-brand-row", "reseller-v2-profile-menu",
  "reseller-v2-page-header", "reseller-v2-workspace", "kavya-console",
  "kavya-reseller-v2",
];

test("both consoles render the one shell", async () => {
  const shells = await Promise.all(
    ["console/ConsoleShell.tsx", "reseller-v2/ResellerShell.tsx"].map((path) =>
      readFile(new URL(`../../src/components/${path}`, import.meta.url), "utf8"),
    ),
  );

  shells.forEach((source, index) => {
    const name = index === 0 ? "ConsoleShell" : "ResellerShell";
    assert.match(source, /<AppShell\b/, `${name} must render the shared AppShell`);
    assert.match(source, /from "\.\.\/ui"/, `${name} must import the kit by its barrel`);

    // Any class from the old arrangements, and the wrapper divs they needed
    // in order to scope themselves to their own console.
    const strays = SHELL_CLASSES.filter((className) => source.includes(className));
    assert.deepEqual(strays, [], `${name} reintroduces shell classes: ${strays.join(", ")}`);
  });

  // And the frame it delegates to has to actually be there, or the two
  // consoles would be rendering nothing at all.
  const { css } = await kit();
  for (const name of ["ui-shell-sidebar", "ui-shell-topbar", "ui-shell-nav-link", "ui-shell-bottom-nav", "ui-shell-page-header"]) {
    assert.match(css, new RegExp(`\\.${name}\\b`), `the kit must style .${name}`);
  }
});

test("the shared shell keeps the access rule and the sign-out honest", async () => {
  const source = await readFile(new URL("../../src/components/ui/AppShell.tsx", import.meta.url), "utf8");

  // The gate is one implementation now. An owner on a reseller page and a
  // reseller on an owner page must both be turned away, and a reader with no
  // session must be sent to sign in rather than shown a frame with no data.
  assert.match(source, /readSession/, "the shell must read the session");
  assert.match(source, /navigate\(`\/login\?next=/, "no session must go to sign in, with somewhere to return to");
  assert.match(source, /navigate\(deniedPath, \{ replace: true \}\)/, "the wrong role must be redirected");
  assert.match(source, /if \(!allowed\) return null/, "nothing renders until the gate has passed");

  // Signing out clears the local session first and unconditionally, so a
  // failed request cannot leave a reader apparently still signed in.
  assert.match(
    source,
    /clearSession\(\);\s*\n\s*void api\.logout\(\)/,
    "the local session must be cleared before, and independently of, the request",
  );
  assert.match(source, /\.catch\(\(\) => undefined\)/, "a failed sign-out must not throw");

  // The keyboard and the popover, which neither console had.
  assert.match(source, /event\.key\.toLowerCase\(\) === "k"/, "Ctrl/Cmd+K must open search");
  assert.match(source, /export function useDismiss/, "popovers must dismiss on Escape and outside click");

  // Collapsing the rail is remembered, or every visit starts with a full
  // sidebar and a reader who wants more room has to reclaim it every time.
  assert.match(source, /localStorage\.setItem\(COLLAPSE_KEY/, "the collapsed width must persist");
});

