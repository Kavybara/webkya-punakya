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

  // A confirm that says what is being confirmed. `DialogActions` takes the
  // label as a required prop rather than defaulting it, so "are you sure?" --
  // which tells the reader nothing about what they agreed to -- cannot be
  // reached by forgetting a prop, and a destructive action has to say `danger`
  // explicitly to render as one.
  assert.match(text, /export function DialogActions/);
  assert.match(text, /confirmLabel: string;/, "the confirm label must be required, not defaulted");
  assert.match(text, /weight=\{danger \? "danger" : "primary"\}/);
  assert.match(text, /\{busy \? "Memproses\.\.\." : confirmLabel\}/, "a busy confirm must not read as idle");
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
  for (const name of ["ui-shell-sidebar", "ui-shell-topbar", "ui-shell-nav-item", "ui-shell-bottom-nav", "ui-shell-page-header"]) {
    assert.match(css, new RegExp(`\\.${name}\\b`), `the kit must style .${name}`);
  }
});

test("the rail's active link is an object, not a border colour", async () => {
  // The rail used to mark the current page with a tinted border and a
  // box-shadow, which meant nothing in the markup said "you are here" -- the
  // state existed only as two computed values. It is now a child element that
  // grows down the left edge, so the assertion is on the element.
  const { css, text } = await kit();
  assert.match(text, /className="ui-shell-nav-rail"/, "each rail link must carry the lit edge");
  assert.match(css, /\.ui-shell-nav-item\.is-active \.ui-shell-nav-rail\b/, "the lit edge must be what marks the current link");

  // And the nav has to be a component, not a map inside the shell, because it
  // is rendered twice -- once into the fixed rail, once into the phone drawer.
  const shell = await readFile(new URL("../../src/components/ui/AppShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /<ShellNav\b/, "AppShell must delegate its navigation to ShellNav");
});

test("both consoles search through one palette", async () => {
  // The two palettes were the same dialog twice. The owner one asked the
  // server; the reseller one filtered data it already had. Both then
  // re-implemented the field, the three waiting states, the grouped results
  // and the dismissal -- and neither of them moved focus into the panel, so a
  // keyboard reader was typing into a dialog that had not opened.
  const [consoleSearch, resellerSearch, palette] = await Promise.all(
    [
      "src/components/console/ConsoleSearch.tsx",
      "src/components/reseller-v2/ResellerSearch.tsx",
      "src/components/ui/CommandPalette.tsx",
    ].map((path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8")),
  );

  for (const [name, source] of [["ConsoleSearch", consoleSearch], ["ResellerSearch", resellerSearch]]) {
    assert.match(source, /<CommandPalette\b/, `${name} must render the shared palette`);
    assert.match(source, /from "\.\.\/ui"/, `${name} must import the kit by its barrel`);
    // A palette built by hand is the thing being replaced. None of these class
    // names may come back.
    const strays = ["console-command", "console-search-", "reseller-v2-search"]
      .filter((className) => source.includes(className));
    assert.deepEqual(strays, [], `${name} hand-rolls palette markup: ${strays.join(", ")}`);
  }

  // The palette reuses the overlay's focus handling rather than growing a
  // third account of it.
  assert.match(palette, /useOverlayFocus\(open, onClose\)/, "the palette must trap and restore focus");
  assert.match(palette, /role="dialog"/);
  assert.match(palette, /aria-modal="true"/);
  assert.match(palette, /inputRef\.current\?\.focus\(\)/, "the palette must open to be typed into");
  // The search function is read through a ref, or a caller that builds it
  // inline would re-run the effect on every render and never settle.
  assert.match(palette, /searchRef\.current = search/);

  // And the stylesheet the two stylesheets gave up is now the kit's.
  const { css } = await kit();
  for (const name of ["ui-command", "ui-command-field", "ui-command-group", "ui-command-skeleton"]) {
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


test("every control inside a shell gets the focus ring without opting in", async () => {
  const { css } = await kit();

  // The ring used to be an allowlist of kit classes, which meant a control a
  // feature page added was invisible to a keyboard user until somebody
  // noticed, and nothing failed when it was. The two shell roots wrap every
  // control either console renders, so being inside one is enough.
  const ring = css.match(/:focus-visible[^{]*\{([\s\S]*?)\}/g)?.join("\n") || "";
  assert.match(ring, /\.ui-shell\s+:focus-visible/, "the signed-in frame must give its controls a focus ring");
  assert.match(ring, /\.auth-shell\s+:focus-visible/, "the sign-in shell must give its controls a focus ring");
  assert.match(ring, /outline:\s*2px solid/, "the ring must stay visible against the dark surfaces");
});

test("a copy that did not happen is not allowed to look like one that did", async () => {
  const { text, css } = await kit();

  // The old CopyButton caught a rejected clipboard write and reset the label to
  // "Salin" -- the same string it shows before it is ever pressed. A reseller
  // reading a sign-in code could press it, be refused by the browser, see
  // nothing change, and hand the customer a code that was never copied. The
  // three states are now named, and `failed` is one of them.
  assert.match(text, /type CopyState = "idle" \| "copied" \| "failed"/, "copy must distinguish idle from failed");
  assert.match(
    text,
    /catch\s*\{\s*\n\s*setState\("failed"\)/,
    "a rejected clipboard write must land in the failed state, not back in idle",
  );
  assert.match(
    text,
    /state === "failed" \? "Gagal"/,
    "the failure must be legible in the button, where the reader is already looking",
  );

  // And it must be visibly not-the-success. A "Gagal" in the same grey as
  // "Tersalin" reads as a copy one glance later.
  assert.match(css, /\.ui-copy\.is-failed\s*\{/, "the failed state needs its own styling");
  assert.match(
    css,
    /\.ui-copy\.is-failed\s*\{[\s\S]*?color:\s*var\(--status-danger\)/,
    "the failed state must be tinted with the danger token, not left neutral",
  );
  // Hover must not launder the failure away while the reader is still reading it.
  assert.match(
    css,
    /\.ui-copy\.is-failed:hover\s*\{[\s\S]*?color:\s*var\(--status-danger\)/,
    "hovering a failed copy must not reset it to a neutral button",
  );
});

test("the one button defaults to type=button, and has a component behind its styles", async () => {
  const { text, css } = await kit();

  // ui.css has carried a complete .ui-button styleset for a while with nothing
  // to render it, so callers assembled the class list by hand. That is how a
  // page wanting both a destructive and a quiet action in one row ends up
  // guessing at modifier names.
  assert.match(css, /\.ui-button\.is-primary\b/, "the button styles are expected to exist");
  for (const weight of ["primary", "secondary", "danger", "quiet"]) {
    assert.match(css, new RegExp(String.raw`\.ui-button\.is-${weight}\b`), `.ui-button.is-${weight} must be styled`);
  }

  // type="button" rather than the HTML default of submit: both consoles are
  // forms, and a button meant to close a panel that silently submits the form
  // behind it only misbehaves for whoever clicks it last.
  assert.match(
    text,
    /<button type="button" className=\{classes\} \{\.\.\.rest\}>/,
    "Button must set type=button before spreading, so an explicit type still wins",
  );
  assert.match(text, /weight\?: ButtonWeight/, "the weight must be part of the public props");
});
