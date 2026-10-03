import assert from "node:assert/strict";
import test from "node:test";

import { accountConditionAvailability } from "../google-sheets/account-condition.js";
import {
  planAccountConditionSheetUpdate,
  planAccountSheetRowUpdate,
  validateReplacementTargetSheetRow,
} from "../google-sheets.js";

/**
 * A warranty replacement writes to two rows, and only one of them gets cleaned.
 *
 * The owner asked what happens to the old order's row in Sheets, and the answer
 * is "almost nothing, and that is deliberate". `syncAccountReplacementToGoogleSheets`
 * (google-sheets.js:5175-5204) builds exactly two plans:
 *
 *   - `conditionPlan` on the OLD row, and `planAccountConditionSheetUpdate`
 *     (google-sheets.js:4672-4702) emits a single cell. One range, one value.
 *     SELLER, ORDER ID, the dates and the duration on that row are not written,
 *     so they are not cleared.
 *   - `assignmentPlan` on the NEW row, which is a full fulfillment write --
 *     date, duration, device, seller, ORDER ID, CATATAN, STOCK ID
 *     (google-sheets.js:4582-4592).
 *
 * Since both carry `order.id` -- the new one at line 4590, `put(columns.orderId,
 * order.id || ...)`, the same order object the old row was filled from -- the same
 * ORDER ID ends up on two rows.
 *
 * That is not a drift bug in the sync. It is the only thing that makes the old
 * row legible afterwards: a replaced row with its order id, its dates and its
 * expiry intact is the audit trail for "this was sold, then it failed, then it
 * was replaced". Clearing it would make the failure unreconstructable, and the
 * REPLACED condition would be a flag on a row that no longer says who owned it.
 *
 * What does change is the database's answer, and only that: `executeReplacement`
 * rewrites `order.deliveredStockIds` to name the new stock and drop the old one
 * (warranty-routes.js:430-435). So the two views disagree by construction --
 * the order points at one stock, the sheet shows two rows carrying its id.
 *
 * The old row must also never return to the catalog. `clearManagedIfReturned`
 * fires on `availability.available` (google-sheets.js:2902), and REPLACED is in
 * BLOCKING_CONDITIONS, so it holds with the seller filled *or* cleared -- which
 * is why the last test here pins the cleared-seller case specifically.
 */

// The verified Netflix layout, verbatim: PIN sits between EXPIRED and DEVICE,
// which is why the fulfillment assertions below pin G/H/J/M rather than guessing
// that SELLER follows DEVICE.
const HEADER = [
  "ACCOUNT & PASSWORD",
  "PROFIL",
  "TANGGAL",
  "DURASI",
  "EXPIRED",
  "PIN",
  "DEVICE CUSTOMER",
  "SELLER",
  "NOMOR WA",
  "ORDER ID / ID MANUAL",
  "KONDISI AKUN",
  "CATATAN",
  "STOCK ID",
  "",
];

/** A row the way Sheets holds one: assignment filled, credential present. */
function soldRow({ orderId, stockId, condition = "NORMAL", seller = "kya", row = 4 }) {
  return [
    "account@example.com\nsecret",
    "Caramel",
    "2026-07-01",
    "1 Bulan",
    `=IF(OR(C${row}="";D${row}="");"";C${row}+30)`,
    "4421",
    "Android TV",
    seller,
    `=IFERROR(VLOOKUP(I${row};'data reseller'!A:B;2;FALSE);"")`,
    orderId,
    condition,
    "",
    stockId,
    "",
  ];
}

/** Header on row 1, data on `row`, everything else blank. */
function sheetWith(row) {
  const rows = [HEADER, [], [], [], []];
  if (row) rows[row.rowIndex] = row.cells;
  return rows;
}

/**
 * A catalog row: credentials present, nothing assigned to anyone.
 *
 * The header is real and so is the offset -- the planner reads columns by header
 * name, so a fixture with the wrong number of columns silently tests a sheet that
 * does not exist.
 */
function freeRow({ email, profile, stockId, condition = "NORMAL" }) {
  const row = new Array(HEADER.length).fill("");
  row[HEADER.indexOf("ACCOUNT & PASSWORD")] = email;
  row[HEADER.indexOf("PROFIL")] = profile;
  row[HEADER.indexOf("KONDISI AKUN")] = condition;
  row[HEADER.indexOf("STOCK ID")] = stockId;
  return row;
}

/** The same catalog row with the target cell overridden, for the refusal cases. */
function withCell(row, header, value) {
  const next = [...row];
  next[HEADER.indexOf(header)] = value;
  return next;
}

test("the replaced row keeps its order, its dates and its seller", () => {
  const stock = {
    id: "stk-old",
    sheetPool: "NETFLIX_SHARED",
    sheetRow: 4,
    sheetStartColumn: 0,
    email: "account@example.com",
    profile: "Caramel",
    pin: "4421",
  };
  const rows = sheetWith({ rowIndex: 3, cells: soldRow({ orderId: "ORD-1", stockId: "stk-old" }) });

  const plan = planAccountConditionSheetUpdate("Netflix", 4, rows, stock, "REPLACED");

  assert.equal(plan.ok, true);
  // One cell. Not a row rewrite, not a deletion.
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].values[0][0], "REPLACED");

  // And it is the condition column, not the order column -- the assertion that
  // matters, because clearing the order id is exactly what would destroy the
  // audit trail this row exists to keep.
  const conditionColumn = HEADER.indexOf("KONDISI AKUN");
  const writtenColumn = plan.updates[0].range.match(/!([A-Z]+)4/)?.[1];
  const expected = String.fromCharCode(65 + conditionColumn);
  assert.equal(writtenColumn, expected);

  // Nothing that would blank the assignment was even considered.
  for (const header of ["SELLER", "ORDER ID / ID MANUAL", "TANGGAL", "DURASI"]) {
    assert.doesNotMatch(
      plan.updates[0].range,
      new RegExp(`!${String.fromCharCode(65 + HEADER.indexOf(header))}4$`),
      `the replaced-row plan writes ${header}, which would erase the record of the failure`,
    );
  }
});

test("the replacement row is written as a fresh assignment of the same order", () => {
  const stock = {
    id: "stk-new",
    sheetPool: "NETFLIX_SHARED",
    sheetRow: 7,
    sheetStartColumn: 0,
    email: "replacement@example.com",
    profile: "Cokelat",
    pin: "9001",
  };
  const rows = [
    HEADER,
    [],
    [],
    soldRow({ orderId: "ORD-1", stockId: "stk-old" }),
    [],
    [],
    freeRow({ email: "replacement@example.com", profile: "Cokelat", stockId: "stk-new" }),
  ];

  const plan = planAccountSheetRowUpdate(
    "Netflix",
    7,
    rows,
    stock,
    { id: "ACCOUNT-NEW", stockId: "stk-new", reseller: "kya", startedAt: "2026-07-01 10:00", duration: "1 Bulan", durationDays: 30 },
    { id: "ORD-1", reseller: "kya", device: "Android TV" },
  );

  assert.equal(plan.ok, true);
  const byRange = new Map(plan.updates.map((u) => [u.range, u.values[0][0]]));
  const at = (header) => `'Netflix'!${String.fromCharCode(65 + HEADER.indexOf(header))}7`;

  // The same ORDER ID now appears on both rows -- the old one keeps it because
  // nothing clears it, this one gets it because it is the same order.
  assert.equal(byRange.get(at("ORDER ID / ID MANUAL")), "ORD-1");
  assert.equal(byRange.get(at("SELLER")), "kya");
  assert.equal(byRange.get(at("STOCK ID")), "stk-new");

  // Credentials are not part of a fulfillment write.
  assert.equal(byRange.has(at("ACCOUNT & PASSWORD")), false, "fulfillment must not rewrite credentials");
  assert.equal(byRange.has(at("PROFIL")), false, "fulfillment must not rewrite the profile");
  // Nor are the formula-owned cells -- writing them would destroy the owner of
  // this sheet's own formulas.
  assert.equal(byRange.has(at("EXPIRED")), false, "EXPIRED is formula-owned");
  assert.equal(byRange.has(at("NOMOR WA")), false, "NOMOR WA is formula-owned");
});

test("a replaced row never returns to the catalog, even with the seller cleared", () => {
  // The obvious way to un-sell a failed row in Sheets is to clear SELLER. That
  // must not be enough to put it back on offer -- otherwise a replacement would
  // hand the reseller the same broken account twice.
  const filled = accountConditionAvailability({ seller: "kya", condition: "REPLACED" });
  assert.equal(filled.sold, true);
  assert.equal(filled.available, false);

  const cleared = accountConditionAvailability({ seller: "", condition: "REPLACED" });
  assert.equal(cleared.sold, false);
  assert.equal(cleared.blocked, true);
  assert.equal(
    cleared.available,
    false,
    "a REPLACED row with the seller cleared is available again, so the failed account can be sold twice",
  );
});

test("the replacement target must be unassigned and unblocked before it is written to", () => {
  const stock = { id: "stk-new", sheetPool: "NETFLIX_SHARED", sheetRow: 7, sheetStartColumn: 0 };
  const catalog = freeRow({ email: "replacement@example.com", profile: "Cokelat", stockId: "stk-new" });
  const free = [HEADER, [], [], soldRow({ orderId: "ORD-1", stockId: "stk-old" }), [], [], catalog];
  assert.equal(
    validateReplacementTargetSheetRow(free, stock, { orderId: "ORD-1" }).ok,
    true,
    "an unassigned target row is rejected, so a replacement can never land on a row someone else owns",
  );

  // Someone else's order is refused.
  const taken = [...free];
  taken[6] = withCell(catalog, "ORDER ID / ID MANUAL", "ORD-LAIN");
  assert.equal(
    validateReplacementTargetSheetRow(taken, stock, { orderId: "ORD-1" }).ok,
    false,
  );

  // And a row already flagged as a problem is refused.
  const flagged = [...free];
  flagged[6] = withCell(catalog, "KONDISI AKUN", "BERMASALAH");
  const result = validateReplacementTargetSheetRow(flagged, stock, { orderId: "ORD-1" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "replacement_target_condition_blocked");
});