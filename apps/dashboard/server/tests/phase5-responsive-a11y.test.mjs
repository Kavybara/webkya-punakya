import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

/*
 * Phase 5: responsive, motion, and the accessibility sweep.
 *
 * Three of the four items in the brief turned out to be already true, and the
 * tests say so rather than leaving the claim in a commit message:
 *
 * - **`aria-label` is already Indonesian.** All 80 occurrences across the app
 *   were inventoried; there is not one English label left to translate. The one
 *   test here fails if an English label reappears.
 * - **`aria-modal` / `role="dialog"` / `aria-labelledby` are already on every
 *   dialog.** `Overlay` has carried them since Phase 1 and `CommandPalette`
 *   was built against them.
 * - **Scroll-reveal was already wrapped in `@supports` + reduced-motion** on the
 *   three selectors that had it. What was missing was the bento grid.
 *
 * What was actually broken:
 *
 * - **The product dialog overflowed a 360px phone.** `.console-variant-locks
 *   article` is `minmax(170px, 1fr) auto minmax(190px, auto)` with a 190px
 *   actions block that sets `flex-wrap: nowrap` around two buttons of
 *   `min-width: 88px`. That is 170 + 190 + 190 + gaps of floor, inside a
 *   content box of 312px once a fullscreen dialog's own padding is subtracted.
 *   No media query anywhere in the file touched the selector, so a reseller
 *   opening a product on a phone got a row that scrolled sideways instead of
 *   stacking. Every other multi-column layout in the app *is* covered at 767px
 *   or 1023px; this one was missed.
 *
 * - **The enlarged-QRIS lightbox was a dialog with no focus trap.** It carried
 *   `role="dialog"`, `aria-modal` and its own Escape listener, and nothing else.
 *   A keyboard user who pressed "Perbesar QRIS" kept tabbing through the
 *   checkout form hidden behind it, and dismissing left focus wherever it
 *   happened to be. The kit already exports `useOverlayFocus` for exactly this
 *   case -- the command palette is the other user of it -- so the fix was to
 *   call it rather than to hand-roll a second keyboard story.
 *
 * - **`aria-busy` was on 7 of 36 async buttons.** A screen reader announces a
 *   greyed-out button and stops; it does not say work is underway, which is the
 *   information a reader needs before deciding to press it again. The kit's
 *   `Button` now takes `loading` and derives both `disabled` and `aria-busy`
 *   from it, so the omission is a compile error rather than a review item.
 *
 * Source inspection throughout -- Node 20 cannot import `.tsx`, which is this
 * repo's established convention for UI tests.
 */

const DASHBOARD = new URL("../../", import.meta.url);

const UI_CSS = new URL("src/components/ui/ui.css", DASHBOARD);
const CONSOLE_CSS = new URL("src/components/console/console.css", DASHBOARD);
const BUTTON = new URL("src/components/ui/Button.tsx", DASHBOARD);
const OVERLAY = new URL("src/components/ui/Overlay.tsx", DASHBOARD);
const PRODUCTS = new URL("src/pages/products/page.tsx", DASHBOARD);
const TOKEN_CSS = new URL("src/styles/tokens.css", DASHBOARD);
const SHELL_CSS = new URL("src/components/ui/shell.css", DASHBOARD);

const read = (file) => readFileSync(file, "utf8");

/**
 * Strips CSS comments.
 *
 * Required for any selector scan: this codebase explains its rules at length
 * in the comment directly above them, and those explanations name the very
 * selectors the assertions are trying to find. A raw scan reads the prose as a
 * second declaration.
 */
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");

/* -------------------------------------------------------------------------- */
/* aria-label: Indonesian, and it stays that way                                */
/* -------------------------------------------------------------------------- */

test("every aria-label in the app is Indonesian", () => {
  // The inventory behind this assertion: 80 occurrences, all Indonesian. The
  // handful of English words that appear in Indonesian UI copy ("template",
  // "order", "OAuth", "QRIS", "PIN", "Gmail", "Sheets") are loanwords the
  // reseller actually uses, so the check is for label *starts*, which is where
  // a translated string would differ.
  const out = execFileSync("git", ["grep", "-h", "-o", "-E", 'aria-label="[^"]*"', "--", "src"], {
    cwd: fileURLToPath(DASHBOARD),
    encoding: "utf8",
  });

  const values = out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^aria-label="/, "").replace(/"$/, ""));

  // 45 of the 80 are literal `"..."` strings; the rest are template literals
// (`aria-label={`Buka order ${id}`}`) and expressions, which this grep does not
// match. The threshold guards against the grep silently going stale.
assert.ok(values.length >= 40, `only ${values.length} literal aria-labels found -- the grep is wrong, not the app`);

  // Words an English aria-label would plausibly begin with.
  //
  // "Edit" is deliberately absent: it is the app's established loanword, used
  // the same way in "Edit stok", "Edit profil" and "Edit ${row.name}". The
  // Indonesian for it is "Ubah", and switching would mean one control labelled
  // two ways depending on which page it is on.
  const english = values.filter((v) =>
    /^(Close|Open|Cancel|Confirm|Save|Delete|Search|Menu|Loading|Submit|Retry|Back|Next|Previous|Select|Settings|Profile|Notifications?)(\s|$)/i.test(v),
  );
  assert.deepEqual(english, [], `English aria-label(s) reintroduced: ${english.join(", ")}`);
});

/* -------------------------------------------------------------------------- */
/* 360-390px: the product dialog                                               */
/* -------------------------------------------------------------------------- */

test("the variant lock row stacks instead of scrolling sideways on a phone", () => {
  const css = read(CONSOLE_CSS);

  // The three-column floor that does not fit: 170 + 190 columns plus a 190px
  // nowrap actions block.
  const rule = /\.console-variant-locks article \{[^}]*\}/.exec(css)?.[0];
  assert.ok(rule, ".console-variant-locks article is gone or renamed");
  assert.match(rule, /grid-template-columns: minmax\(170px, 1fr\) auto minmax\(190px, auto\)/);

  // ...and the single-column override has to live inside a phone breakpoint.
  const mobile = /@media \(max-width: 767px\) \{[\s\S]*?\n\}/.exec(css)?.[0];
  assert.ok(mobile, "console.css has no 767px block");
  assert.match(
    mobile,
    /\.console-variant-locks article \{ grid-template-columns: minmax\(0, 1fr\)/,
    "the variant lock row still lays out three columns on a 360px phone",
  );

  // `flex-wrap: nowrap` around two 88px buttons is what made the actions block
  // itself overflow, so the override has to release it and drop the floor.
  assert.match(mobile, /\.console-variant-locks \.console-variant-actions \{[^}]*flex-wrap: wrap/);
  assert.match(mobile, /\.console-variant-locks button \{[^}]*min-width: 0/);

  // A 34px control is under the 44px touch-target floor the rest of the app
  // holds, so the phone version has to grow it back.
  assert.match(mobile, /\.console-variant-locks button \{[^}]*min-height: 44px/);
});

test("the dialog itself fits 360px before any of its contents do", () => {
  // The reason the rule above is needed: below 640px the panel is fullscreen,
  // so its body content box is 360 - 2*24 = 312px.
  const ui = read(UI_CSS);
  assert.match(ui, /\.ui-panel\.is-dialog \{ width: 100%; max-height: 100svh; border-radius: 0; \}/);

  // A drawer is fullscreen at every width, so a wide one has to scroll rather
  // than clip.
  assert.match(ui, /\.ui-panel\.is-drawer \{[\s\S]*?max-height: 100svh;/);
});

/* -------------------------------------------------------------------------- */
/* Motion: bento scroll-reveal                                                 */
/* -------------------------------------------------------------------------- */

test("bento cells settle on scroll, and only where the browser can drive it", () => {
  const css = read(UI_CSS);

  const block = /@supports \(animation-timeline: view\(\)\) \{[\s\S]*?\n  \}\n\}/.exec(css)?.[0];
  assert.ok(block, "the scroll-reveal @supports block is gone or renamed");

  // Two safety properties, in this order of importance: a browser that cannot
  // do scroll timelines gets NO rule (rather than a hidden element), and a
  // reader who asked for less motion gets none either.
  assert.match(block, /@media \(prefers-reduced-motion: no-preference\)/);

  assert.match(
    block,
    /\.ui-bento-cell:not\(\.is-link\) \{[\s\S]*?animation: ui-reveal linear both;[\s\S]*?animation-timeline: view\(\);/,
    "bento cells do not settle on scroll",
  );

  // `is-link` is excluded on purpose: it carries a hover `transform`, and an
  // animation on transform owns that property for the timeline's length, so
  // the lift would vanish while the cell was on screen and snap back after.
  assert.match(block, /\.ui-bento-cell:not\(\.is-link\)/);
  assert.match(read(UI_CSS), /\.ui-bento-cell\.is-link:hover \{[\s\S]*?transform:/);
});

test("the bento reveal ends early, so an on-screen grid does not flicker", () => {
  const css = read(UI_CSS);
  // `entry 4%` on a grid that fills the first screen has every visible cell
  // animating at once on load, which reads as a flash rather than a settle.
  const bento = /\.ui-bento-cell:not\(\.is-link\) \{[^}]*\}/.exec(css)?.[0];
  assert.ok(bento, "the bento reveal rule is missing");
  assert.match(bento, /animation-range: entry 12% cover 20%;/);
});

test("reduced motion still silences the kit wholesale", () => {
  const css = read(UI_CSS);
  const reduced = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/.exec(css)?.[0];
  assert.ok(reduced, "the reduced-motion block is gone");
  assert.match(reduced, /\.ui-panel, \.ui-panel \*/, "the kit must stop moving entirely");

  // The bento reveal is gated by `no-preference`, so a reader who asked for
  // less motion never receives the rule at all. What has to be pinned is not
  // that a bento reveal exists -- it legitimately does, one, inside the gate --
  // but that it exists *only* there. A second `animation: ui-reveal` on a bento
  // cell outside the `no-preference` query would put the motion back for
  // exactly the readers who asked for none, and that is what this fails on.
  //
  // Comments stripped first, and required: the bento rule is introduced by a
  // paragraph naming `.ui-bento-cell.is-link`, so a raw-source scan reads that
  // explanation as a second declaration.
  const revealed = withoutComments(css);

  // The span of the gate, found by counting braces from the `@supports` opener
  // rather than by matching a closing sequence -- the block nests a media query
  // and a `@keyframes`, so its tail is not a fixed string.
  const openAt = revealed.indexOf("@supports (animation-timeline: view())");
  assert.ok(openAt >= 0, "the @supports gate is gone, so nothing is gated any more");
  let depth = 0;
  let closeAt = -1;
  for (let i = revealed.indexOf("{", openAt); i < revealed.length; i += 1) {
    if (revealed[i] === "{") depth += 1;
    else if (revealed[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        closeAt = i;
        break;
      }
    }
  }
  assert.ok(closeAt > openAt, "could not find where the @supports gate ends");

  const reveals = [...revealed.matchAll(/([^{}]+)\{[^}]*animation: ui-reveal/g)];
  assert.ok(reveals.length > 0, "no ui-reveal animation found at all");

  const bento = reveals.filter((m) => /\.ui-bento-cell/.test(m[1]));
  assert.equal(
    bento.length,
    1,
    `expected exactly one bento reveal, found ${bento.length}: ${bento.map((m) => m[1].trim()).join(" | ")}`,
  );
  assert.ok(
    bento[0].index >= openAt && bento[0].index < closeAt,
    "the bento reveal is declared outside the no-preference query, so reduced-motion readers get it anyway",
  );
  assert.match(
    bento[0][1],
    /\.ui-bento-cell:not\(\.is-link\)/,
    "the bento reveal selector no longer matches the rule",
  );
});

test("the blur kill-switch in shell.css is untouched by Phase 5", () => {
  // The perf invariant: sticky console bars are opaque, not blurred. Phase 5
  // added a motion rule and must not have disturbed it.
  const shell = read(SHELL_CSS);
  assert.match(shell, /\.ui-shell \*[\s\S]*?backdrop-filter: none !important;/);
});

test("no Phase 5 rule hardcodes a colour outside the token file", () => {
  // tokens.css is the palette's only home. A literal hex in a stylesheet is a
  // value that will not follow the theme.
  for (const file of [UI_CSS, CONSOLE_CSS]) {
    const text = read(file);
    const literals = [...text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    assert.deepEqual(literals, [], `${file} has literal hex colour(s): ${literals.join(", ")}`);
  }
  assert.ok(read(TOKEN_CSS).length > 0, "tokens.css is empty");
});

/* -------------------------------------------------------------------------- */
/* The QRIS lightbox: a real dialog                                            */
/* -------------------------------------------------------------------------- */

test("the enlarged-QRIS lightbox traps focus like every other dialog", () => {
  const source = read(PRODUCTS);

  assert.match(
    source,
    /import \{ useOverlayFocus \} from "\.\.\/\.\.\/components\/ui\/Overlay";/,
    "the lightbox must use the kit's focus hook, not its own",
  );
  assert.match(source, /useOverlayFocus\(\s*qrExpanded && Boolean\(qrSrc\),\s*qrClose,/);

  // The ref goes on the panel, not the scrim -- the trap has to walk the
  // lightbox's own controls.
  assert.match(source, /<div ref=\{qrPanelRef\}/);
  assert.match(source, /<button ref=\{qrCloseRef\}/);

  // Its bespoke Escape listener is gone. Two window-level Escape handlers for
  // one overlay is how the drawer-behind-the-dialog bug happened.
  assert.doesNotMatch(source, /closeOnEscape/);
  assert.doesNotMatch(
    source,
    /window\.addEventListener\("keydown",[\s\S]{0,80}setQrExpanded\(false\)/,
    "the lightbox still installs its own Escape handler alongside the kit's",
  );

  // The accessibility contract it already had must survive.
  assert.match(source, /role="dialog" aria-modal="true" aria-label="QRIS diperbesar"/);
});

/* -------------------------------------------------------------------------- */
/* aria-busy: derived, not remembered                                          */
/* -------------------------------------------------------------------------- */

test("the kit's Button derives the busy state from one prop", () => {
  const source = read(BUTTON);

  assert.match(source, /loading\?: boolean;/);
  assert.match(
    source,
    /disabled=\{disabled \|\| loading\}[\s\S]{0,120}?aria-busy=\{loading \|\| undefined\}/,
    "loading must drive both, or the omission is possible again",
  );

  // `aria-busy={false}` says the same thing as omitting it; leaving it off
  // keeps the markup honest about which buttons are actually working.
  assert.match(source, /aria-busy=\{loading \|\| undefined\}/);
  assert.doesNotMatch(source, /aria-busy=\{loading\}/);

  // `disabled` and `loading` are destructured out, which is what makes putting
  // them after `{...rest}` safe.
  assert.match(source, /loading = false,\s*disabled,/);
});

test("DialogActions keeps wait and impossible as separate states", () => {
  const source = read(OVERLAY);
  assert.match(source, /loading=\{busy\}/);
  assert.match(source, /disabled=\{confirmDisabled\}/);
  // Cancel is the escape hatch; announcing it busy would tell a reader the
  // control they reach for to leave is itself mid-request.
  assert.match(source, /onClick=\{onCancel\} disabled=\{busy\}>Batal/);
});

test("no async control announces busy through a whole compound expression", () => {
  // The rule the sweep had to respect: `aria-busy` tracks work in flight only.
  // `disabled={submitting || !selection}` greys for two reasons and only the
  // first is a request, so the attribute takes `submitting` alone.
  //
  // `x || undefined` is NOT a compound expression -- it is how React omits the
  // attribute entirely rather than rendering `aria-busy="false"`, which says
  // the same thing as leaving it off. So the check is for a `||` whose right
  // side is something *other* than `undefined`.
  const offenders = [];
  for (const file of execFileSync("git", ["ls-files", "--", "src"], {
    cwd: fileURLToPath(DASHBOARD),
    encoding: "utf8",
  }).trim().split("\n").filter((f) => f.endsWith(".tsx"))) {
    const text = readFileSync(new URL(file, DASHBOARD), "utf8");
    for (const m of text.matchAll(/aria-busy=\{([^}]+)\}/g)) {
      const expr = m[1];
      const ors = expr.split("||").map((part) => part.trim());
      if (ors.length > 1 && ors[ors.length - 1] !== "undefined") {
        const line = text.slice(0, m.index).split("\n").length;
        offenders.push(`${file}:${line}  aria-busy={${expr}}`);
      }
    }
  }

  assert.deepEqual(offenders, [], `aria-busy must name one flag, not an expression:\n${offenders.join("\n")}`);
});

/* -------------------------------------------------------------------------- */
/* Harness note                                                                */
/* -------------------------------------------------------------------------- */

// Two of the assertions above walk the real working tree rather than a
// hand-copied list, so that they cover files this commit never touched. That is
// only worth anything if the walk still finds anything, which is what this
// checks: an empty result would make both of them pass vacuously.
test("the two working-tree scans in this file actually find something", () => {
  const root = fileURLToPath(DASHBOARD);

  const labelFiles = execFileSync("git", ["grep", "-l", "aria-label=", "--", "src"], {
    cwd: root,
    encoding: "utf8",
  }).trim().split("\n").filter(Boolean);
  assert.ok(labelFiles.length >= 15, `only ${labelFiles.length} files carry aria-label -- the scan is stale`);

  const busyFiles = execFileSync("git", ["grep", "-l", "aria-busy", "--", "src"], {
    cwd: root,
    encoding: "utf8",
  }).trim().split("\n").filter(Boolean);
  assert.ok(busyFiles.length >= 15, `only ${busyFiles.length} files carry aria-busy -- the scan is stale`);
});