import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * Three defects on the owner accounts page, all of which survived the general
 * UI sweep because each looked like ordinary code.
 *
 * The date one is the interesting one. Every writer in the server formats
 * `startedAt` / `expiresAt` as local wall-clock text with a SPACE separator:
 *
 *     `${date.getFullYear()}-${pad(month)}-${pad(day)} ${pad(h)}:${pad(min)}`
 *
 * in `store.js` `nowText`, `index.js` `dateTimeText`, and
 * `google-sheets.js` `formatDateTime`. A `datetime-local` input accepts only
 * `YYYY-MM-DDTHH:mm`. The page fed it `row.startedAt.slice(0, 16)`, which
 * preserves the space -- `2026-06-21 00:00` -- and the browser rejects it, so
 * the field renders EMPTY. The owner opens Edit on an account whose expiry is
 * perfectly valid and sees a blank date next to a Save button, with no way to
 * tell an empty field from one the system failed to read.
 *
 * The reverse direction matters too: typing into the field produces a `T`, and
 * saving that verbatim writes a second date format into the same column.
 *
 * The error-state one: the edit form and the delete dialog shared a single
 * `formError`. `openEdit` cleared it, the row's trash button did not, so a
 * rejected save greeted the owner inside the delete dialog describing an edit
 * they had already abandoned.
 *
 * Node 20 cannot import `.tsx`, so this is source inspection -- the repo's
 * established convention for anything under `src/`.
 */

const ACCOUNTS_PAGE = new URL("../../src/pages/owner-v2/accounts/page.tsx", import.meta.url);

function read(file) {
  return readFileSync(file, "utf8");
}

function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("a stored timestamp is converted for the datetime-local input", () => {
  const page = read(ACCOUNTS_PAGE);

  assert.match(
    page,
    /function toDateTimeInput[\s\S]*?split\(\/\[T \]\/\)[\s\S]*?\$\{datePart\}T\$\{timePart/,
    "the page must translate the store's space-separated format into the T-separated one an input accepts",
  );

  // The old expression, which produced a string that looked right and was not a
  // valid input value -- so the browser silently rendered an empty field.
  assert.doesNotMatch(
    page,
    /startedAt: row\.startedAt\?\.slice\(0, 16\)/,
    "the raw slice is back, which cannot produce a value a datetime-local input will display",
  );
});

test("the form populates its dates through the converter, not a raw slice", () => {
  const page = read(ACCOUNTS_PAGE);
  assert.match(page, /startedAt: toDateTimeInput\(row\.startedAt\)/);
  assert.match(page, /expiresAt: toDateTimeInput\(row\.expiresAt\)/);
});

test("a save puts the store back on its own date format", () => {
  const page = withoutComments(read(ACCOUNTS_PAGE));

  assert.match(
    page,
    /fromDateTimeInput/,
    "saving the raw input value would write a T-separated date into a space-separated column",
  );
  assert.match(
    page,
    /startedAt: fromDateTimeInput\(form\.startedAt\)/,
    "startedAt must be normalised on the way out, not just on the way in",
  );
  assert.match(
    page,
    /expiresAt: fromDateTimeInput\(form\.expiresAt\)/,
    "expiresAt must be normalised on the way out, not just on the way in",
  );
});

test("the edit form and the delete dialog do not share one error", () => {
  const page = withoutComments(read(ACCOUNTS_PAGE));

  assert.match(page, /const \[formError, setFormError\] = useState\(""\)/);
  assert.match(
    page,
    /const \[actionError, setActionError\] = useState\(""\)/,
    "the delete dialog needs its own error state",
  );

  // The delete dialog must read its own state, not the form's.
  const deleteDialog = page.slice(page.indexOf('title="Hapus managed account"'));
  assert.match(
    deleteDialog,
    /actionError \? <Notice tone="danger">\{actionError\}<\/Notice>/,
    "the delete dialog is still rendering the edit form's error",
  );
});

test("opening the delete dialog clears whatever the edit form was complaining about", () => {
  const page = withoutComments(read(ACCOUNTS_PAGE));

  assert.match(
    page,
    /setFormError\(""\); setAction\(\{ type: "delete", account: row \}\)/,
    "the trash button must clear the form error, or a stale rejection greets the owner in the delete dialog",
  );
});

test("secrets reveal one field at a time and re-mask themselves", () => {
  const page = withoutComments(read(ACCOUNTS_PAGE));

  assert.doesNotMatch(
    page,
    /setRevealed\(/,
    "a single reveal flag exposes every password, PIN, reset link and pool link at once",
  );
  assert.match(
    page,
    /revealedFields\.includes\(field\.key\)/,
    "each secret must decide its own visibility",
  );
  assert.match(
    page,
    /function toggleReveal\(key: string\)/,
    "there must be a per-field toggle to replace the global button",
  );
  assert.match(
    page,
    /aria-label=\{shown \? `Sembunyikan \$\{field\.label\}` : `Tampilkan \$\{field\.label\}`\}/,
    "the reveal control needs a name that says which secret it exposes, not just an icon",
  );
});

test("a revealed secret is masked again on a timer, and on unmount", () => {
  const page = read(ACCOUNTS_PAGE);

  assert.match(
    page,
    /revealTimerRef\.current = window\.setTimeout\(clearReveals, REVEAL_TIMEOUT_MS\)/,
    "a reveal that never expires stays readable for as long as the dialog is open",
  );
  assert.match(
    page,
    /useEffect\(\(\) => clearReveals, \[\]\)/,
    "the timer must be cleared on unmount, or it fires into a component that is gone",
  );
  assert.match(
    page,
    /function closeCredentials\(\)[\s\S]*?clearReveals\(\)/,
    "closing the dialog is the owner saying they are done; that is when the secrets go",
  );
});

test("account statuses are read from the shared vocabulary, not the raw token", () => {
  const page = withoutComments(read(ACCOUNTS_PAGE));

  assert.match(page, /import \{ accountStatus \} from "\.\.\/\.\.\/\.\.\/lib\/labels"/);
  assert.match(
    page,
    /\{ id: "status", header: "Status"[\s\S]{0,200}accountStatus\(row\.status\)\.label/,
    "the Status column renders the raw database token",
  );
  assert.doesNotMatch(
    page,
    /tone=\{row\.status === "active" \? "success"/,
    "the per-status tone chain is back, one place to forget to update",
  );
});

test("no raw account status is printed as prose in the delete dialog", () => {
  const page = withoutComments(read(ACCOUNTS_PAGE));

  assert.doesNotMatch(
    page,
    /Akun \$\{action\.account\.status\}/,
    "the confirmation sentence interpolates the raw token straight into Indonesian text",
  );
  assert.match(page, /accountStatus\(action\.account\.status\)\.label\.toLowerCase\(\)/);
});