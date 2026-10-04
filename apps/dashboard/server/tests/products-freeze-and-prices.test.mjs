import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * The owner products page, where a catalogue is edited. Five defects, and the
 * first one is the reason this file exists.
 *
 * **A save reverted the freeze that had just been set.** `editing` is a
 * snapshot of one product, taken when the edit dialog opened. The freeze
 * buttons live *inside* that dialog, so the sequence is: open Edit, freeze a
 * variant, confirm. The confirm reloads the product list -- but the dialog is
 * still open, still holding the snapshot from before the freeze.
 *
 * `save()` then built its update payload by spreading that snapshot:
 *
 *     { ...editing, name: ..., variants: applyPriceEdits(editing.variants, ...) }
 *
 * and the server prefers the client's value. `normalizeOrderLockInput` in
 * `server/index.js` reads `source.enabled` first and only falls back to the
 * stored lock:
 *
 *     const enabled = hasSource
 *       ? Boolean(source.enabled ?? source.isLocked ?? previous.enabled ?? ...)
 *
 * So the round trip is: freeze a variant, type a corrected price, press Save,
 * and the freeze is gone. No error, no warning, no visual difference except
 * the badge the owner has to remember to check. `deliveryTemplate` travels the
 * same way, so a template saved from the editor could be rolled back by an
 * unrelated price edit afterwards.
 *
 * The repair belongs in `load` rather than at each call site. A reload from a
 * lock, a template save, or the manual refresh button all repair the snapshot
 * when they repair it in one place, and no future caller can forget to.
 *
 * **A rejected price was dropped without a word.** `applyPriceEdits` keeps an
 * edit only when the value is a positive number, and it discarded everything
 * else silently. The owner corrects a price, presses Save, sees "Produk
 * berhasil disimpan", closes the dialog -- and the price is exactly as it was.
 * Nothing distinguishes a save that landed from a save that was thrown away,
 * because both look identical from the table.
 *
 * The two are deliberately asymmetric. An *empty* field is not an error: it is
 * the documented way to stop offering a duration, and `applyPriceEdits` deletes
 * the key rather than writing `0` so the public catalogue stops advertising a
 * free month. Zero is likewise allowed for the same reason -- the create form
 * seeds `price: "0"` and an unpriced product is a legitimate state to sit in.
 * The only real failure is a negative price, or a value `Number` cannot read.
 *
 * Node 20 cannot import `.tsx`, so this is source inspection -- the repo's
 * established convention for anything under `src/`.
 */

const PAGE = new URL("../../src/pages/owner-v2/products/page.tsx", import.meta.url);
const SERVER = new URL("../index.js", import.meta.url);

function read(file) {
  return readFileSync(file, "utf8");
}

/**
 * Strips block and line comments.
 *
 * Required, not optional: this file explains in prose exactly which omissions
 * caused the bug, so an assertion over raw source happily matches the
 * explanation of the defect instead of the fix. That has already produced one
 * false failure elsewhere in the suite.
 */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const page = () => withoutComments(read(PAGE));

/**
 * `save()` is written as one long line, so the usual "up to the first closing
 * brace at this indent" slice never terminates on it. Bound it by the function
 * that follows instead.
 */
function saveBody(source) {
  const body = /async function save\(\) \{[\s\S]*?\n  async function executeAction/.exec(source)?.[0];
  assert.ok(body, "save is not defined");
  return body;
}

test("the server takes the client's lock over the stored one, which is what makes the stale snapshot dangerous", () => {
  // The premise of this whole file. If the server ever stopped preferring the
  // client value, the fix here would be belt-and-braces rather than necessary,
  // and the test suite should say so rather than keep implying a live bug.
  assert.match(
    read(SERVER),
    /const enabled = hasSource\s*\?\s*Boolean\(source\.enabled \?\? source\.isLocked \?\? previous\.enabled/,
    "the server no longer prefers a client-supplied orderLock; re-check whether the stale-snapshot fix is still load-bearing",
  );
});

test("reloading repairs the snapshot the open edit dialog is holding", () => {
  const source = page();
  const load = /const load = useCallback\([\s\S]*?, \[\]\);/.exec(source)?.[0];
  assert.ok(load, "load is not defined as a useCallback");

  assert.match(
    load,
    /setEditing\(\(current\) => \(current \? rows\.find\(\(row\) => row\.id === current\.id\) \?\? current : current\)\)/,
    "a reload leaves the edit dialog holding its pre-freeze snapshot, so the next save reverts the freeze",
  );

  // Matched by id, not by position: the list is re-sorted and re-paginated, so
  // an index would attach the dialog to whichever row landed in that slot.
  assert.match(load, /row\.id === current\.id/);
});

test("the repair lives in load, so no caller can forget it", () => {
  const source = page();

  // Every reload path exists: the lock action, the template save, the template
  // copy, and the shell's manual refresh. All of them go through `load`, so
  // one repair covers all four.
  assert.match(source, /await load\(\);/);
  assert.match(source, /onRefresh=\{load\}/);

  // And nothing re-implements the repair next to a caller, where a fifth
  // reload path could be added without it.
  assert.doesNotMatch(
    source,
    /setEditing\(rows\.find|setEditing\(\(rows\)/,
    "the snapshot repair has been duplicated at a call site instead of living in load",
  );
});

test("a price that cannot be stored is reported instead of dropped", () => {
  const source = page();

  assert.match(
    source,
    /export function invalidPriceEdits\(edits: PriceEdits\): string\[\]/,
    "there must be a check that can name the offending price",
  );

  const save = saveBody(source);
  assert.match(
    save,
    /const badPrices = invalidPriceEdits\(priceEdits\); if \(badPrices\.length\) \{ setFormError\(/,
    "save() does not consult the price check, so an invalid price is still dropped silently",
  );
  assert.match(
    save,
    /setFormError\(badPrices\.join\(" "\)\); return; \}/,
    "the save must abort before the request; a warning shown after a successful write is a lie",
  );
  // ...and the abort has to come before the write, not after it.
  assert.ok(
    save.indexOf("badPrices.join") < save.indexOf("setBusy(true)"),
    "the price check runs after the request is already in flight",
  );
});

test("an empty price is not an error, because it is how a duration is withdrawn", () => {
  const source = page();
  const check = /export function invalidPriceEdits[\s\S]*?\n\}/.exec(source)?.[0];
  assert.ok(check, "invalidPriceEdits is not defined");

  assert.match(
    check,
    /if \(!trimmed\) continue;/,
    "blanking a price field is the documented way to stop offering that duration; it must not raise an error",
  );
  assert.match(
    check,
    /Number\.isFinite\(amount\) && amount >= 0/,
    "zero is allowed -- the create form seeds price: \"0\" and an unpriced product is legitimate",
  );
});

test("the message names the duration and says what to do instead", () => {
  const source = page();
  const check = /export function invalidPriceEdits[\s\S]*?\n\}/.exec(source)?.[0];

  assert.match(
    check,
    /Harga \$\{duration\} tidak boleh negatif\. Kosongkan kolomnya jika durasi ini tidak dijual lagi\./,
    "the owner needs the remedy, not just the rejection",
  );
  assert.match(check, /Harga \$\{duration\} harus berupa angka\./);
});

test("the create form's own price field is checked too", () => {
  const source = page();
  const save = saveBody(source);

  // `priceEdits` only covers the edit path. On create the single price lives in
  // `form.price`, which `emptyForm` seeds with "0" and which the server accepts
  // as any finite number -- including a negative one.
  assert.match(
    save,
    /!editing && form\.price\.trim\(\) && \(!Number\.isFinite\(createPrice\) \|\| createPrice < 0\)/,
  );
});

test("opening the template editor no longer closes the product dialog", () => {
  const source = page();
  const openTemplate = /async function openTemplate[\s\S]*?\n  \}/.exec(source)?.[0];
  assert.ok(openTemplate, "openTemplate is not defined");

  assert.doesNotMatch(
    openTemplate,
    /setEditing\(undefined\)/,
    "the product dialog closes and every price the owner typed into it is discarded, with no prompt",
  );
  assert.match(
    openTemplate,
    /setTemplateLoadedSource\(config\.source\);/,
    "the baseline the unsaved check compares against must be set when the template loads",
  );
});

test("copying a template asks first when there are unsaved edits", () => {
  const source = page();

  assert.match(
    source,
    /const templateUnsaved = Boolean\(templateTarget && templateSource !== templateLoadedSource\)/,
    "without a baseline the page cannot tell an edited template from a freshly loaded one",
  );

  const copyTemplate = /async function copyTemplate\(confirmed = false\)[\s\S]*?\n  \}/.exec(source)?.[0];
  assert.ok(copyTemplate, "copyTemplate does not take a confirmation flag");
  assert.match(
    copyTemplate,
    /if \(templateUnsaved && !confirmed\) \{\s*setTemplateCopyConfirm\(true\);\s*return;\s*\}/,
    "the copy overwrites the textarea in one step and only mentions it afterwards",
  );

  // The guard has to sit above the request, not beside the post-hoc notice.
  assert.ok(
    copyTemplate.indexOf("setTemplateCopyConfirm(true)") < copyTemplate.indexOf("api.copyDeliveryTemplate"),
    "the confirmation is requested after the copy has already run",
  );
  assert.match(
    copyTemplate,
    /setTemplateLoadedSource\(config\.source\);/,
    "after a copy the editor holds the copied text, which is now the saved baseline",
  );
});

test("the copy confirmation is a dialog, not a warning strip", () => {
  const source = page();

  assert.match(source, /\{templateCopyConfirm \? <Dialog open title="Ganti dengan template lain\?"/);
  assert.match(source, /onConfirm=\{\(\) => copyTemplate\(true\)/);
  assert.match(
    source,
    /Perubahan yang belum disimpan akan hilang\./,
    "the dialog must say what is being lost, before it is lost",
  );
});

test("product status and order lock are read from the shared vocabulary", () => {
  const source = page();

  assert.match(source, /import \{ orderLockStatus, productStatus \} from "\.\.\/\.\.\/\.\.\/lib\/labels"/);

  // These are the exact English words the columns used to render.
  for (const stale of ['"Archived"', '"Frozen"', '"Open"', '"Order frozen"', '`Archive ${row.name}`']) {
    assert.doesNotMatch(
      source,
      new RegExp(stale.replace(/[${}]/g, "\\$&")),
      `${stale} is untranslated status vocabulary that lib/labels already owns`,
    );
  }

  assert.match(source, /productStatus\(row\)\.label/);
  assert.match(source, /orderLockStatus\(row\.orderLock\)\.label/);
});

test("label and tone still travel together", () => {
  const source = page();

  assert.match(source, /<Badge tone=\{productStatus\(row\)\.tone\}>\{productStatus\(row\)\.label\}<\/Badge>/);
  assert.match(source, /<Badge tone=\{orderLockStatus\(row\.orderLock\)\.tone\}>\{orderLockStatus\(row\.orderLock\)\.label\}<\/Badge>/);

  // The defect the shared vocabulary exists to prevent: a colour table keyed on
  // label *strings*, so renaming one silently turns its badge grey.
  assert.doesNotMatch(source, /tone=\{row\.isArchived \? "muted" : row\.isActive \? "success" : "warning"\}/);
});

test("the metric row and the table count the same products", () => {
  const source = page();

  assert.match(source, /label: "Diarsipkan", value: products\.filter\(\(row\) => row\.isArchived\)\.length/);
  assert.match(source, /label: "Pemesanan dikunci", value: products\.filter\(\(row\) => row\.orderLock\?\.enabled\)\.length/);
});

test("the archive button says which way it will move the product", () => {
  const source = page();

  assert.match(
    source,
    /aria-label=\{`\$\{row\.isArchived \? "K|archivekan" : "Arsipkan"\} \$\{row\.name\}`\}/,
    "an icon-only button with a one-way label cannot say what pressing it does",
  );
});