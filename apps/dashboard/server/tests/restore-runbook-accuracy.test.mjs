import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * `docs/RESTORE.md` is read under the worst possible conditions: it is opened
 * for the first time while the server is already dead and the owner is trying
 * to work out whether their money is gone. A wrong row in its data table does
 * not fail loudly there -- it just gets believed.
 *
 * It already was wrong once. The table claimed the reseller list rebuilds
 * itself from Google Sheets. It does not: `google-sheets.js` only ever reads
 * `db.resellers` (to push it outward), so a skipped restore leaves an app that
 * looks perfectly healthy with an empty reseller table.
 *
 * These assertions read the runbook and the sync module together, so the claim
 * and the code are checked against each other instead of against a memory of
 * what the code used to do.
 */
const runbook = readFileSync(new URL("../../../../docs/RESTORE.md", import.meta.url), "utf8");
const sheetsSync = readFileSync(new URL("../google-sheets.js", import.meta.url), "utf8");

// The table is markdown; pull the row for one data kind out of it by its label
// rather than asserting on prose, so rewording the cell cannot break this.
function runbookRow(label) {
  const row = runbook.split("\n").find((line) => line.startsWith(`| ${label}`));
  assert.ok(row, `RESTORE.md has no row for "${label}" -- the table is the part an owner trusts`);
  return row;
}

test("the runbook does not claim Sheets rebuilds the reseller list", () => {
  const row = runbookRow("**Daftar reseller**");
  assert.match(row, /❌/, 'the reseller row must read "does not come back", not "comes back"');
  assert.doesNotMatch(
    row,
    /✅/,
    "RESTORE.md tells the owner their reseller list returns on its own. It does not, and believing that is how a skipped restore goes unnoticed.",
  );
});

test("no row claims recovery from Sheets for data that only exists in kavya-db.json", () => {
  // These three are the ones where a false "yes" costs real money. `stock` and
  // `managedAccounts` are genuinely rebuilt from sheet rows, so they are the
  // control: if this ever fails on those, the table has drifted the other way
  // and someone needs to look at the sync module.
  for (const label of ["**Order", "**Saldo wallet / deposit**"]) {
    const row = runbookRow(label);
    assert.doesNotMatch(row, /✅/, `${label} exists only in kavya-db.json and cannot come back from Sheets`);
  }
  assert.match(runbookRow("Stok, status sold"), /✅/, "stock is rebuilt from Sheets and must keep saying so");
  assert.match(runbookRow("Managed Account"), /✅/, "managed accounts are rebuilt from Sheets and must keep saying so");
});

test("the runbook explains that reseller sync is one-way", () => {
  assert.match(
    runbook,
    /tidak pernah membaca baris reseller/i,
    "without this, the ❌ reads as a documentation bug rather than a real limit",
  );
  assert.match(runbook, /satu arah/i, "the direction of the sync is the actual reason");
});

test("the runbook names the silent failure mode", () => {
  // The reason this correction matters is that nothing else warns the owner.
  assert.match(
    runbook,
    /defaultData/,
    "the runbook must explain that a missing database is silently replaced, not reported",
  );
  assert.match(runbook, /resellers: \[\]/, "the exact shape of the empty state should be written down");
});

test("the verification checklist checks the reseller list", () => {
  // The checklist is what actually runs during a restore. It used to ask about
  // stock and balances but never "is the reseller list there", which is the
  // one question whose answer distinguishes a good restore from a failed one.
  const checklist = runbook.slice(runbook.indexOf("## 8. Verifikasi setelah hidup"));
  assert.match(checklist, /Daftar reseller/i, "the post-restore checklist never asks whether resellers came back");
  assert.match(checklist, /banner/i, "and never tells the owner to look for the loss banner");
});

test("the checklist tells the owner to check for data loss first", () => {
  // Ordering carries meaning in a checklist. If the banner check is not first,
  // a failed restore gets read as "stok 0, cek .env" and the real cause is
  // lost.
  const checklist = runbook.slice(runbook.indexOf("## 8. Verifikasi setelah hidup"));
  const bannerAt = checklist.search(/banner merah/i);
  const orderAt = checklist.search(/\*\*Jumlah order\*\*/i);
  assert.ok(bannerAt > -1, "no banner check found");
  assert.ok(orderAt > -1, "no order-count check found");
  assert.ok(bannerAt < orderAt, "the loss banner must be checked before order counts");
});

test("the one-way claim matches what the sync module actually does", () => {
  // Guard against the doc and the code disagreeing again. Every `db.resellers`
  // reference in the sheets module must be a read, never an assignment.
  const assignments = sheetsSync.match(/db\.resellers\s*=[^=]/g) || [];
  assert.deepEqual(
    assignments,
    [],
    "the sync module now assigns db.resellers. If that is a deliberate new feature, RESTORE.md's one-way claim is out of date and must be corrected the same day.",
  );
});

test("orders and payments still exist nowhere in Sheets", () => {
  // The loss detector's whole premise rests on this: it fires only when orders
  // exist with no resellers, which is impossible if Sheets could rebuild orders.
  // If a sync ever starts writing orders, the detector needs revisiting too.
  assert.doesNotMatch(
    sheetsSync,
    /db\.payments\s*=[^=]/,
    "payments are now written by the Sheets sync; the loss detector's payments-only branch may be dead code",
  );
});