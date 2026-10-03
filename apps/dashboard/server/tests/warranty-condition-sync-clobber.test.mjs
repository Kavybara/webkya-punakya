import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAccountCondition } from "../google-sheets/account-condition.js";
import { syncManagedAccountCondition } from "../google-sheets.js";

/**
 * An empty KONDISI AKUN cell is "unstated", and the sync treated it as "NORMAL".
 *
 * `normalizeAccountCondition("")` returns `{ value: "NORMAL", known: true,
 * empty: true }` -- note it carries `empty: true` precisely so a caller can tell
 * "the owner wrote NORMAL" from "the owner wrote nothing". `syncManagedAccountCondition`
 * (google-sheets.js:2751-2775) uses `empty` for `accountConditionRaw` and then
 * writes `condition.value` anyway:
 *
 *     const nextCondition = condition.value || "NORMAL";
 *
 * So a blank cell overwrites whatever blocking condition the account was
 * carrying, and `DIPERIKSA` becomes `NORMAL`.
 *
 * The stock row does not have this problem, which is what makes it a bug rather
 * than a design choice. `upsertSheetStock` (google-sheets.js:2825-2870) also
 * reassigns `stock.accountCondition` from the sheet, but the warranty review
 * writes `warrantyReviewBlocked = true` as a write-ahead lock and
 * `stockForVariant` (stock-groups.js:448) honours it -- that is exactly the
 * "pending review sync" case the existing test at
 * google-sheets-account-condition.test.mjs:115 pins. So the stock stays locked
 * while the account it represents silently goes back to normal.
 *
 * That split matters because the two are read by different people. The stock
 * lock keeps a bad account out of the catalog. The account condition is what
 * the reseller sees: `accountConditionBadge` (reseller-v2/accounts/page.tsx:57)
 * renders "Sedang diperiksa" from it, and `accountConditionKnown === false`
 * folds to `inactive` in `normalizeResellerAccountStatus`. Reset it to NORMAL and
 * an account under active warranty review looks like a healthy one.
 *
 * The lock is set because the Sheets write failed or has not run:
 * `warranty-service.js:131-151` stamps DIPERIKSA on both rows, then
 * `warranty-routes.js:116` sets `warrantyReviewBlocked = !reviewSync.ok`. The
 * cell is still blank at that point -- writing it is the very thing that failed.
 */
test("a blank sheet cell does not reset a managed account to NORMAL", () => {
  const stock = {
    id: "stock-review",
    sheetStockKey: "NETFLIX_SHARED:12:account@example.com:profile-2",
    warrantyReviewBlocked: true,
  };
  const account = {
    id: "account-review",
    stockId: stock.id,
    sheetStockKey: stock.sheetStockKey,
    status: "active",
    hidden: false,
    accountCondition: "DIPERIKSA",
    accountConditionRaw: "DIPERIKSA",
    accountConditionKnown: true,
    warrantyReviewId: "WRV-1",
  };
  const db = { managedAccounts: [account] };

  const condition = normalizeAccountCondition("");

  // The blank cell is distinguishable from a written NORMAL -- that is the whole
  // point of `empty`.
  assert.equal(condition.value, "NORMAL");
  assert.equal(condition.empty, true);

  syncManagedAccountCondition(db, stock, condition);

  assert.equal(
    account.accountCondition,
    "DIPERIKSA",
    "a blank sheet cell silently cleared the DIPERIKSA the reseller was shown as 'Sedang diperiksa'",
  );
});

test("a blank sheet cell still normalises an account that has no condition to lose", () => {
  const stock = { id: "stock-plain", sheetStockKey: "NETFLIX_SHARED:9:a@b.c:profile-1" };
  const account = {
    id: "account-plain",
    stockId: stock.id,
    sheetStockKey: stock.sheetStockKey,
    status: "active",
    hidden: false,
    accountCondition: "UNKNOWN",
    accountConditionKnown: false,
  };
  const db = { managedAccounts: [account] };

  // An unrecognised condition is a different case from a blocking one: the
  // account is not flagged for review, it is flagged as not-understood, and
  // `accountConditionKnown: false` is what folds it to `inactive`. A blank cell
  // resolving that to NORMAL is the useful behaviour, so the guard must not
  // swallow it.
  syncManagedAccountCondition(db, stock, normalizeAccountCondition(""));

  assert.equal(account.accountCondition, "NORMAL");
  assert.equal(account.accountConditionKnown, true);
  assert.equal(account.accountConditionRaw, "");
});

test("a written condition is still authoritative, blank or not", () => {
  const stock = { id: "stock-owner", sheetStockKey: "NETFLIX_SHARED:9:a@b.c:profile-9" };
  const account = {
    id: "account-owner",
    stockId: stock.id,
    sheetStockKey: stock.sheetStockKey,
    status: "active",
    hidden: false,
    accountCondition: "DIPERIKSA",
  };
  const db = { managedAccounts: [account] };

  // Sheets is the master. When the owner actually writes a value it wins, in
  // both directions -- including back to NORMAL.
  syncManagedAccountCondition(db, stock, normalizeAccountCondition("NORMAL"));
  assert.equal(account.accountCondition, "NORMAL", "a written NORMAL must clear the local flag");
});