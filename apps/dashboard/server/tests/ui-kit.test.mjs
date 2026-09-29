import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const uiDir = new URL("../../src/components/ui/", import.meta.url);

async function kit() {
  const files = await readdir(uiDir);
  const sources = await Promise.all(
    files.filter((name) => name.endsWith(".tsx")).map((name) => readFile(new URL(name, uiDir), "utf8")),
  );
  return { files, text: sources.join("\n") };
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
  // Scoped to `ui-` on purpose. A kit component may legitimately use a
  // Tailwind utility such as `sr-only`; what must never happen is the kit
  // depending on a class that its own stylesheet does not own.
  const styles = await readFile(new URL("../../src/components/ui/ui.css", import.meta.url), "utf8");

  const { text } = await kit();
  const rendered = new Set();
  for (const match of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    for (const name of (match[1] ?? match[2] ?? "").split(/\s+/)) {
      if (/^ui-[a-z0-9-]+$/.test(name)) rendered.add(name);
    }
  }
  assert.ok(rendered.size > 20, `expected to find the kit's classes, found only ${rendered.size}`);
  const unstyled = [...rendered].filter((name) => !new RegExp(`\\.${name}\\b`).test(styles));
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
