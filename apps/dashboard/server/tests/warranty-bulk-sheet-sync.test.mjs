import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * The warranty stock-review sheet sync -- and why the page stopped offering it
 * in bulk.
 *
 * This file used to pin a bulk action on the warranty table: select N claims,
 * press one button, sync all of them. The button was removed, and the reason is
 * the last test in here, so read that one first.
 *
 * What is left is worth keeping. The per-claim "Coba Sync Ulang" button still
 * calls the same endpoint, so the endpoint's guards still need to hold, and
 * `DataTable`'s `bulkAction` prop still has no caller now that this page was
 * the only one -- so the frozen-selection contract it offers is still pinned
 * here, ready for the next page that needs it.
 */
const page = readFileSync(new URL("../../src/pages/owner-v2/warranty/page.tsx", import.meta.url), "utf8");
const dataTable = readFileSync(new URL("../../src/components/ui/DataTable.tsx", import.meta.url), "utf8");
const routes = readFileSync(new URL("../routes/warranty-routes.js", import.meta.url), "utf8");

/** The `retry-stock-review-sync` handler, from its route to the next route. */
function sheetSyncRoute() {
  const start = routes.indexOf('app.post("/api/warranty-claims/:id/retry-stock-review-sync"');
  assert.ok(start > 0, "the retry-stock-review-sync route is missing");
  const end = routes.indexOf("\n  app.", start + 10);
  return routes.slice(start, end > 0 ? end : undefined);
}

test("the sheet-retry endpoint reaches Google Sheets and no customer", () => {
  const route = sheetSyncRoute();
  assert.match(route, /syncWarrantyStockReviewToGoogleSheets/, "the route no longer syncs the sheet");
  assert.match(route, /updateDb\(/, "the route no longer records the outcome");
  // The per-claim retry button sits two handlers above the notification retry,
  // and it is reachable from a claim detail dialog. If someone later adds a
  // notification send to this handler, that button stops being a spreadsheet
  // write and starts messaging a real customer -- so this assertion is the
  // guard on the choice, not on the code.
  assert.doesNotMatch(
    route,
    /sendWhatsAppMessage|recordNotification|deliverReplacementNotifications/,
    "the sheet-retry endpoint now reaches a customer",
  );
});

test("the endpoint refuses a claim that never triggered a review", () => {
  // The guard is what stops a broad call from writing sheet cells for
  // arbitrary stock: only claims that actually triggered a review and named the
  // stock they touched are eligible, and the 404 says so rather than no-oping.
  const route = sheetSyncRoute();
  assert.match(route, /!claim\.stockReviewTriggered \|\| !\(claim\.stockReviewStockIds \|\| \[\]\)\.length/);
  assert.match(route, /res\.status\(404\)/);
  // And a failed sync answers 409 rather than 200-with-a-failure-body, so a
  // caller can tell "this one is broken" from "this one worked".
  assert.match(route, /res\.status\(409\)/);
});

test("the per-claim retry still reports what it did, without claiming it unblocks stock", () => {
  // The success message says what actually happened -- the DIPERIKSA cells were
  // written -- and not the thing that does not happen. A review clears by the
  // owner editing the sheet back to NORMAL and waiting for the stock-sync cron;
  // no button here does that, and the wording used to imply one did.
  assert.match(
    page,
    /Kondisi DIPERIKSA untuk \$\{selected\.id\} berhasil disinkronkan\./,
    "the per-claim retry no longer says what it wrote",
  );
  assert.doesNotMatch(
    page,
    /lepas dari blokir|kembali bisa dijual|tidak lagi diblokir/i,
    "the warranty page still promises a sync releases blocked stock; it never did",
  );
});

test("DataTable still offers the frozen-selection contract to a future caller", () => {
  // The warranty table was the only page using `bulkAction`, and it no longer
  // does. The prop stays -- it is the right shape for the next bulk action --
  // but with no live caller, its behaviour is only pinned by this assertion, so
  // it is the one that has to keep the contract honest.
  //
  // `rows.filter((row) => selected.has(rowKey(row)))` reads the table's live
  // state at click time. A dialog is open for as long as the caller takes to
  // read it, and the table can re-sort and re-page underneath -- so the rows
  // handed to `onClick` have to be the ones that were on screen when it was
  // clicked, not whatever is current when they confirm.
  assert.match(
    dataTable,
    /onClick=\{\(\) => bulkAction\.onClick\(selectedRows, \(\) => setSelected\(new Set\(\)\)\)\}/,
    "DataTable does not pass the selection and a clear callback to the caller",
  );
  // And it must clear the checkbox column when the prop disappears, or a
  // selection made under one action survives into the next.
  assert.match(dataTable, /if \(!selectable\) setSelected\(new Set\(\)\)/);
});