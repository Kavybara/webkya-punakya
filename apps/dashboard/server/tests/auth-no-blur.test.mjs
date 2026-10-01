import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * The sign-in screens cannot afford a blur, and the reason is specific enough
 * to be worth a test rather than a comment somebody will optimise past.
 *
 * All three auth routes are in the router's PUBLIC_PREFIXES, so
 * `media/capybara-farm.mp4` is decoding behind them. A `backdrop-filter` is not
 * a cheap way to make glass: it is an instruction to re-read and re-blur
 * everything painted behind that element whenever any of it changes. Over a
 * static gradient the browser computes it once. Over a playing video it computes
 * it again on every frame -- thirty to sixty times a second -- across the union
 * of every filtered box on screen.
 *
 * That is what the sign-in screen did. Five filters, one of them per input
 * field, plus an infinite `filter: blur(28px)` on the brand mark. The consoles
 * had the identical bug and it was measured -- `/owner-v2/orders` went from p95
 * 276ms to p95 17.9ms when the blur came off -- but the fix shipped with a
 * `.ui-shell.ui-shell *` kill-switch, and `.auth-shell` is a sibling root, not a
 * descendant of it. So the sign-in screens kept every bit of the blur after the
 * consoles were already fast, and nothing failed, because a blur is never an
 * error. It is just slow.
 *
 * Hence two guards. This file is the source guard: no blur may be written into
 * the auth stylesheet or the auth components. `components/ui/shell.css` is the
 * runtime guard: even if one is written, `.auth-shell.auth-shell *` takes it
 * back out. The source guard exists so the author finds out; the runtime guard
 * exists so the user never pays for the gap between them.
 */

const SRC = new URL("../../src/", import.meta.url);

const source = (path) => readFile(new URL(path, SRC), "utf8");

/** Every file that can put something on a sign-in screen. */
const AUTH_SURFACES = [
  "components/auth/auth.css",
  "components/auth/AuthShell.tsx",
  "pages/login/page.tsx",
  "pages/register/page.tsx",
  "pages/forgot-password/page.tsx",
];

/**
 * Comments are not declarations.
 *
 * This file and `auth.css` both have to *name* the blur they are refusing to
 * use -- the whole argument is that these five declarations used to be there --
 * and the first version of this detector failed on that prose and reported the
 * explanation as the offence. Rewording the comment would have silenced the
 * test rather than fixed it, so the comments come out first.
 */
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) ? "" : line))
    .join("\n");
}

/**
 * Every way to ask for a blur from CSS or from a Tailwind utility class.
 *
 * `filter: blur(...)` is in here as well as `backdrop-filter`, and the reason
 * it matters is that the two cost differently but both run per frame: a
 * backdrop-filter re-blurs what is behind the element, while a `filter` blur on
 * an element that also animates forces the element itself to be re-blurred every
 * frame. The sign-in brand mark was doing the second one on an eight-second
 * `infinite alternate` that never ended.
 */
function blurDeclarations(text) {
  const code = withoutComments(text);
  const found = [];
  const patterns = [
    /\bbackdrop-filter\s*:/g,
    /(?<!-)\bfilter\s*:\s*[^;}]*\bblur\(/g,
    /\bbackdrop-blur(?:-[\w]+)?\b/g,
    /(?<![\w-])\bblur-(?:sm|md|lg|xl|2xl|3xl)\b/g,
    /\bdrop-shadow-(?:sm|md|lg|xl|2xl)\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const line = code.slice(0, match.index).split("\n").length;
      found.push(`line ${line}: ${match[0]}`);
    }
  }
  return found;
}

test("no blur is written anywhere on the sign-in screens", async () => {
  const offenders = [];

  for (const path of AUTH_SURFACES) {
    const found = blurDeclarations(await source(path));
    if (found.length) offenders.push(`${path} -> ${found.join(", ")}`);
  }

  assert.deepEqual(
    offenders,
    [],
    `blur on a surface with a video behind it: ${offenders.join("; ")}. `
      + "Legibility comes from the surface fill here, not from defocusing the footage.",
  );
});

test("the blur detector actually detects blur", () => {
  // A guard that cannot fail is not a guard. This is the shape the sign-in
  // stylesheet used to have -- five filters, one per field, plus the animated
  // mark -- so if the detector above ever goes quiet this is what it went quiet
  // on.
  const before = `
    .auth-brand { background: var(--surface-glass); backdrop-filter: blur(6px) saturate(140%); }
    .auth-form-panel { backdrop-filter: blur(var(--glass-blur-strong)) saturate(150%); }
    .auth-input, .auth-otp-row input { backdrop-filter: blur(var(--glass-blur)); }
    .auth-notice { backdrop-filter: blur(var(--glass-blur)); }
    .auth-button.is-secondary { backdrop-filter: blur(var(--glass-blur)); }
    .auth-brand-glow { filter: blur(28px); animation: auth-glow 8s var(--ease-out-expo) infinite alternate; }
    .auth-card { @apply backdrop-blur-md drop-shadow-lg blur-sm; }
  `;

  const found = blurDeclarations(before);
  const cssBackdrops = found.filter((entry) => entry.includes("backdrop-filter")).length;
  const utilityBlurs = found.filter((entry) => entry.includes("backdrop-blur")).length;

  // One per input field, times six fields, is the part that made this slow.
  assert.ok(cssBackdrops >= 5, `expected the old stylesheet's five filters, found ${cssBackdrops}`);
  assert.ok(utilityBlurs >= 1, "the Tailwind `backdrop-blur-*` spelling must also be caught");
  assert.ok(
    found.some((entry) => entry.includes("filter: blur(")),
    "an animated `filter: blur()` must be caught as well as a backdrop-filter",
  );
  assert.ok(
    found.some((entry) => entry.includes("blur-sm")) && found.some((entry) => entry.includes("drop-shadow")),
    "the Tailwind filter spellings must be caught too, or a component can reintroduce this",
  );
});

test("a comment that explains the blur is not the blur", async () => {
  // The regression that shaped this file. `auth.css` opens by naming the five
  // filters it no longer has, and the first detector read that paragraph as a
  // sixth declaration -- which is what would happen to any future explanation
  // written in the same place. Stripping comments is the fix; rewording the
  // explanation would only have moved the problem to the next person.
  const styles = await source("components/auth/auth.css");

  assert.match(
    styles,
    /\/\*[\s\S]*backdrop-filter[\s\S]*\*\//,
    "the stylesheet is expected to explain the blur it is refusing to use",
  );
  assert.deepEqual(
    blurDeclarations(styles),
    [],
    "a comment naming `backdrop-filter` must not read as a declaration of one",
  );
});

test("the runtime kill-switch covers the sign-in shell as well as the console", async () => {
  // The source guard above is the one that tells the author. This one is the
  // one that protects the reader in the window between a rule being written and
  // the guard being updated -- and it is the arm that was missing when the
  // sign-in screens stayed slow through a console fix that had already shipped.
  const shell = await source("components/ui/shell.css");

  assert.match(
    shell,
    /\.auth-shell\.auth-shell \*,\s*\n\.auth-shell\.auth-shell \*::before,\s*\n\.auth-shell\.auth-shell \*::after\s*\{[^}]*backdrop-filter:\s*none\s*!important/,
    "`.auth-shell` is a sibling root, so the `.ui-shell` kill-switch never reached the sign-in screens",
  );
  assert.match(
    shell,
    /\.ui-shell\.ui-shell \*,\s*\n\.ui-shell\.ui-shell \*::before/,
    "the console kill-switch must survive",
  );
});

test("the sign-in screens are still over a playing video, which is the reason", async () => {
  // If this stops being true the blur above stops being expensive, and this
  // whole file is guarding against a constraint that no longer exists -- in
  // which case the right move is to delete the constraint deliberately, not to
  // discover it had lapsed.
  const router = await source("router/index.tsx");

  for (const route of ["/login", "/register", "/forgot-password"]) {
    assert.ok(
      router.includes(`"${route}"`),
      `${route} left PUBLIC_PREFIXES, so it no longer plays the video behind the form`,
    );
  }
  assert.match(router, /hasFarmBackdrop\(location\.pathname\) \? <FarmVideoBackdrop \/> : null/);
});