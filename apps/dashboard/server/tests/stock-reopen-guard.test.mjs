import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { transpileModule } from "typescript";

/*
 * The owner stock page, where credentials are handed out.
 *
 * **A sold account could be put back on sale in one click.** The edit dialog's
 * status `<select>` offers "Tersedia" for every row, and the PUT route is
 * `Object.assign(item, req.body)` with no check of any kind:
 *
 *     const previousPassword = String(item.password || "");
 *     Object.assign(item, req.body);
 *
 * So open a row that reads "Terjual", change the select to "Tersedia", press
 * Save, and the same login is back in the pool that resellers buy from -- while
 * the customer who received it is still holding it. No confirmation, no name
 * anywhere on screen, and the table afterwards looks correct: one available
 * account, one sold order, no contradiction visible.
 *
 * The page now stops and asks, and the answer is not always yes:
 *
 *   - `reserved` routes through `releaseStockReservation`, which is the
 *     endpoint built for this. It 409s while a linked daily account is active
 *     and 409s while the order holding the reservation is still live, and it
 *     picks the resulting status itself.
 *   - `sold` cannot use that endpoint -- it rejects anything not `reserved`
 *     with "Stok ini tidak sedang reserved". There is no guarded path for a
 *     delivered account, so the dialog says so plainly instead of implying a
 *     safety net that does not exist.
 *
 * Three more defects in the same file:
 *
 * - Every dialog shares one `dialogError`, and only `openCreate`/`openEdit`
 *   cleared it. A save that failed left its sentence inside the *next* dialog
 *   opened -- the assign dialog, the delete confirmation -- describing
 *   something the owner was not doing.
 * - The delete dialog's eyebrow was the constant "Konfirmasi tindakan" and its
 *   body read "Stok akan dihapus melalui endpoint owner", naming no account, no
 *   product and no customer. The assign dialog on the same file already named
 *   its subject; delete did not.
 * - The daily-assign form showed a start date and a duration but never the end
 *   date they produce, even though that end date is what the reseller is told
 *   and what `buildDailyStockAssignment` stores.
 *
 * `parsedDurationDays` and `dailyEndDate` live in `lib/durations` rather than in
 * the page, so they are transpiled and *called* here. The rest is source
 * inspection -- Node 20 cannot import `.tsx`, which is the repo's established
 * convention for anything under `src/pages`.
 */

const PAGE = new URL("../../src/pages/owner-v2/stock/page.tsx", import.meta.url);
const DURATIONS = new URL("../../src/lib/durations.ts", import.meta.url);

const outRoot = new URL("../.compiled-tests-stock/", import.meta.url);
mkdirSync(outRoot, { recursive: true });
process.on("exit", () => rmSync(outRoot, { recursive: true, force: true }));

// `lib/durations` has no imports at all, so the compiled module is a leaf and
// nothing has to be written beside it.
const { outputText } = transpileModule(readFileSync(DURATIONS, "utf8"), {
  compilerOptions: { module: 99, target: 99 },
  fileName: "module.ts",
});
const compiledDurations = new URL("durations.mjs", outRoot);
writeFileSync(compiledDurations, outputText);

// `fileURLToPath`, not `.pathname`: the repo path contains a space, which the
// URL form percent-encodes into a filename that does not exist.
const { parsedDurationDays, dailyEndDate } = await import(pathToFileURL(fileURLToPath(compiledDurations)).href);

function read(file) {
  return readFileSync(file, "utf8");
}

/**
 * Strips block and line comments.
 *
 * Required, not optional: this file explains in prose exactly which omissions
 * caused the bugs, so an assertion over raw source happily matches the
 * explanation instead of the fix.
 */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const page = () => withoutComments(read(PAGE));

/* -------------------------------------------------------------------------- */
/* parsedDurationDays                                                         */
/* -------------------------------------------------------------------------- */

test("a fractional duration is rejected rather than rounded away silently", () => {
  // The bug: the guard was `Number(value) <= 0`, which 0.5 passes, and then
  // `Math.floor(0.5)` is 0 -- so the request asked for a zero-day rental and the
  // server clamped it back up to 1. The owner got a full day they did not ask
  // for, from a field that looked like it had accepted 0.5.
  assert.equal(parsedDurationDays("0.5"), 0);
  assert.equal(parsedDurationDays("0.9"), 0);
  assert.equal(parsedDurationDays("1.5"), 1, "1.5 is a whole day plus change, and 1 is what the server stores");
  assert.equal(parsedDurationDays("2.9"), 2);
});

test("zero, negative and non-numeric durations are all rejected", () => {
  // All four reach `Math.max(1, ...)` on the server and become a 1-day rental.
  for (const bad of ["0", "-1", "-0.5", "", "  ", "abc", "NaN", "1e"]) {
    assert.equal(parsedDurationDays(bad), 0, `${JSON.stringify(bad)} must not produce a usable duration`);
  }
});

test("whole days pass through unchanged", () => {
  assert.equal(parsedDurationDays("1"), 1);
  assert.equal(parsedDurationDays("7"), 7);
  assert.equal(parsedDurationDays("30"), 30);
  assert.equal(parsedDurationDays(" 14 "), 14, "a stray space is trimmed by Number, not by this function");
});

/* -------------------------------------------------------------------------- */
/* dailyEndDate                                                               */
/* -------------------------------------------------------------------------- */

test("the end date is the start date plus the duration", () => {
  assert.equal(dailyEndDate("2026-10-04", "1"), "2026-10-05");
  assert.equal(dailyEndDate("2026-10-04", "7"), "2026-10-11");
  assert.equal(dailyEndDate("2026-10-04", "30"), "2026-11-03");
});

test("month and year boundaries roll over instead of clamping", () => {
  assert.equal(dailyEndDate("2026-01-30", "3"), "2026-02-02");
  assert.equal(dailyEndDate("2026-12-30", "5"), "2027-01-04", "a 5-day rental over new year crosses into the next year");
  assert.equal(dailyEndDate("2028-02-26", "3"), "2028-02-29", "2028 is a leap year");
  assert.equal(dailyEndDate("2026-02-26", "3"), "2026-03-01", "2026 is not");
});

test("the start date is read as a calendar date, not as UTC", () => {
  // `new Date("2026-01-02")` parses as UTC midnight, which is the previous day
  // for anyone west of Greenwich. The server stores a local wall-clock date and
  // the reseller is told a local date, so the preview has to agree with both.
  assert.equal(dailyEndDate("2026-01-01", "1"), "2026-01-02", "must not slip back a day through UTC parsing");
  assert.equal(dailyEndDate("2026-03-01", "1"), "2026-03-02");
});

test("the preview uses the floored duration, matching what the server stores", () => {
  // If the preview used the raw 1.9 while the request sent 1, the date shown
  // would be a day later than the date the reseller is actually given.
  assert.equal(dailyEndDate("2026-10-04", "1.9"), "2026-10-05");
  assert.equal(dailyEndDate("2026-10-04", "0.5"), "", "an unusable duration shows nothing, not a date");
});

test("unusable input yields no date rather than an invented one", () => {
  for (const bad of ["", "  ", "not-a-date", "2026-13-01", "04/10/2026", "2026-10-04T00:00:00Z"]) {
    assert.equal(dailyEndDate(bad, "7"), "", `${JSON.stringify(bad)} is not the plain YYYY-MM-DD the date input produces`);
  }
  assert.equal(dailyEndDate("2026-10-04", "0"), "");
});

/* -------------------------------------------------------------------------- */
/* The reopen guard                                                           */
/* -------------------------------------------------------------------------- */

test("save refuses the reopen instead of writing it", () => {
  const source = page();
  const save = /async function save\(\) \{[\s\S]*?\n  async function releaseStock/.exec(source)?.[0];
  assert.ok(save, "save is not defined");

  assert.match(
    save,
    /if \(editing && isReopeningSoldStock\(editing\.status, form\.status\)\) \{ setReopenConfirm\(true\); return; \}/,
    "a sold or reserved row can still be set back to available with one click and no confirmation",
  );

  // ...and the guard sits above the write, not beside the toast.
  assert.ok(
    save.indexOf("setReopenConfirm(true)") < save.indexOf("api.updateStock"),
    "the confirmation is requested after the unguarded write has already gone out",
  );
});

test("only a delivered account counts as a reopen", () => {
  const source = page();
  const guard = /export function isReopeningSoldStock[\s\S]*?\n\}/.exec(source)?.[0];
  assert.ok(guard, "isReopeningSoldStock is not defined");

  assert.match(guard, /next === "available"/, "the dangerous direction is returning to the pool, not leaving it");
  assert.match(guard, /previous === "sold" \|\| previous === "reserved"/);

  // available -> reserved is an ordinary forward move and must not be gated;
  // gating it would train the owner to click through the dialog.
  assert.doesNotMatch(guard, /previous === "available"/);
});

test("a reservation goes through the endpoint that actually checks", () => {
  const source = page();
  const release = /async function releaseStock\(\)[\s\S]*?\n  \}/.exec(source)?.[0];
  assert.ok(release, "releaseStock is not defined");

  assert.match(
    release,
    /if \(subject\.status === "reserved"\) \{\s*const released = await api\.releaseStockReservation\(subject\.id\);/,
    "a reservation must go through release-reservation, which is the only path that refuses while an account or order is still live",
  );

  // The endpoint chooses the resulting status -- `blocked` when Sheets says the
  // account is unusable -- so the toast reports what the server decided rather
  // than asserting it went back to available.
  assert.match(release, /stockStatusLabel\(released\.stock\?\.status \?\? "available"\)/);
});

test("a delivered account is not sent to the endpoint that would reject it", () => {
  const source = page();
  const release = /async function releaseStock\(\)[\s\S]*?\n  \}/.exec(source)?.[0];

  // `release-reservation` throws "Stok ini tidak sedang reserved" for anything
  // that is not reserved, so routing a sold row through it would turn every
  // reopen into a 400. Built from a string rather than written as a literal,
  // because a regex literal cannot start with `}` -- the parser reads it as a
  // block. `\s*` rather than a space, because the two branches are on separate
  // lines here.
  assert.match(
    release,
    new RegExp('\\} else \\{\\s*await api\\.updateStock\\(subject\\.id, \\{ status: "available" \\}\\);'),
    "a sold row must take the plain update path, because the guarded endpoint refuses it",
  );
});

test("the reopen dialog tells the owner which of the two cases they are in", () => {
  const source = page();

  assert.match(source, /\{reopenConfirm && editing \? <Dialog open title="Kembalikan ke pool stok\?"/);
  assert.match(source, /eyebrow=\{stockIdentity\(editing\)\}/, "the dialog must name the account it is about");

  // A reservation has a real server-side check, so promising a refusal is true.
  assert.match(
    source,
    /editing\.status === "reserved" \? <Notice tone="warning">Sistem akan menolak selama masih ada akun harian aktif/,
  );
  // A delivered account has none, and saying otherwise would be a lie.
  assert.match(source, /server tidak melakukan apa pun untuk mencegahnya/);
});

test("every dialog opener clears the shared error", () => {
  const source = page();

  // The bug: a save that failed with "Produk atau varian tidak valid" left that
  // sentence inside the assign dialog that opened next.
  assert.match(
    source,
    /function openAction\(next: StockAction\) \{ setDialogError\(""\); setAction\(next\); \}/,
    "the delete / sync / maintenance dialogs can open showing another dialog's error",
  );
  assert.match(source, /function openDaily\(row: ApiStockItem\) \{ setDialogError\(""\);/);

  // ...and none of them is left calling setAction directly.
  const direct = source.match(/onClick=\{\(\) => setAction\(/g) || [];
  assert.equal(direct.length, 0, "a dialog opener bypasses the error reset");
});

test("the two failing actions are reachable and no others bypass the reset", () => {
  const source = page();

  assert.match(source, /onClick=\{\(\) => openAction\(\{ type: "delete", stock: row \}\)\}/);
  assert.match(source, /onClick=\{\(\) => openAction\(\{ type: "sync" \}\)\}/);
  assert.match(source, /onClick=\{\(\) => openAction\(\{ type: "maintenance" \}\)\}/);
});

/* -------------------------------------------------------------------------- */
/* The delete dialog                                                          */
/* -------------------------------------------------------------------------- */

test("the delete dialog names the account it is about to destroy", () => {
  const source = page();

  assert.match(
    source,
    /eyebrow=\{action\.type === "delete" \? stockIdentity\(action\.stock\) : "Konfirmasi tindakan"\}/,
    "the eyebrow is a constant for all three actions, so delete names no account",
  );
  assert.match(
    source,
    /\{action\.type === "delete" && action\.stock \? <>\{stockIdentity\(action\.stock\)\} \(\{productName\(action\.stock\)\} \/ \{variantName\(action\.stock\)\}\)/,
    "the body must name the account and its product, not just say 'stock will be deleted'",
  );
});

test("the delete dialog says who is holding the stock", () => {
  const source = page();

  assert.match(
    source,
    /action\.stock\?\.reservedFor \? `Stok ini sedang di-reservasi untuk \$\{action\.stock\.reservedFor\}\. ` : ""/,
    "deleting a reserved row without saying so is the case that costs money",
  );
});

test("the row buttons name the account, not the row id", () => {
  const source = page();

  // `stock_abc123` tells a screen-reader user nothing; the email does.
  for (const [action, verb] of [["Edit", "Edit stok"], ["Assign", "Assign harian"], ["Hapus", "Hapus stok"]]) {
    assert.match(
      source,
      new RegExp(`aria-label=\\{\`${verb.replace(" ", "\\s")} \\$\\{stockIdentity\\(row\\)\\}\``),
      `${action} button is announced as a row id`,
    );
  }
  assert.doesNotMatch(source, /aria-label=\{`Edit stok \$\{row\.id\}`\}/);
  assert.doesNotMatch(source, /aria-label=\{`Hapus stok \$\{row\.id\}`\}/);
  assert.doesNotMatch(source, /aria-label=\{`Assign harian \$\{row\.id\}`\}/);
});

/* -------------------------------------------------------------------------- */
/* The duration preview                                                       */
/* -------------------------------------------------------------------------- */

test("the assign form previews the end date before the owner commits", () => {
  const source = page();

  assert.match(
    source,
    /<Field label="Durasi hari" hint=\{dailyEndLabel \? `Berakhir \$\{dailyEndLabel\}` : undefined\}>/,
    "the form asks for a start date and a duration but never says when the access ends",
  );
  assert.match(source, /const dailyEndLabel = useMemo\(\(\) => \{/);
  assert.match(source, /dailyEndDate\(dailyForm\.startedAt, dailyForm\.durationDays\)/);
  assert.match(source, /return end \? formatCalendarDate\(end\) : "";/, "an unusable input must hide the hint, not render a guess");
});

test("assign validates the floored duration and says why", () => {
  const source = page();
  const assign = /async function assignDaily\(\)[\s\S]*?\n  \}/.exec(source)?.[0];
  assert.ok(assign, "assignDaily is not defined");

  assert.match(assign, /const durationDays = parsedDurationDays\(dailyForm\.durationDays\);/);
  assert.doesNotMatch(
    assign,
    /Number\(dailyForm\.durationDays\) <= 0/,
    "0.5 passes this guard and then floors to a zero-day rental",
  );
  assert.match(assign, /\{ resellerId: dailyForm\.resellerId, variantId: dailyForm\.variantId \|\| assigning\.variantId, startedAt: dailyForm\.startedAt, durationDays,/);

  // The request must carry the value that was validated, not the raw string --
  // otherwise the check and the write disagree about what "1.9" means.
  assert.doesNotMatch(assign, /durationDays: Math\.floor\(Number\(dailyForm\.durationDays\)\)/);

  // The reseller and the duration are different mistakes and deserve different
  // sentences; the old guard merged them into one.
  assert.match(assign, /if \(!assigning \|\| !dailyForm\.resellerId\) \{ setDialogError\("Reseller tujuan wajib dipilih\."\); return; \}/);
  assert.match(assign, /if \(!durationDays\) \{ setDialogError\(/);
  assert.match(assign, /Durasi pecahan seperti 0,5 hari tidak bisa dipakai/);
});