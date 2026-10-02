import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * The warranty page's bulk action: retry the Google Sheets stock-review sync
 * for every selected claim.
 *
 * `DataTable` grew a `bulkAction` prop with no caller anywhere in the app, so
 * the checkbox column, the selection bar and the colSpan arithmetic had never
 * been exercised by a real page. This installs it on the one action that is
 * safe to run in bulk, and pins why that one and not its neighbour: the sheet
 * retry writes spreadsheet cells and nothing else, while the notification
 * retry sitting two handlers above it sends real WhatsApp to real customers.
 */
const page = readFileSync(new URL("../../src/pages/owner-v2/warranty/page.tsx", import.meta.url), "utf8");
const dataTable = readFileSync(new URL("../../src/components/ui/DataTable.tsx", import.meta.url), "utf8");
const routes = readFileSync(new URL("../routes/warranty-routes.js", import.meta.url), "utf8");

/** The `retry-stock-review-sync` handler, from its route to the next route. */
function sheetSyncRoute() {
  const start = routes.indexOf('app.post("/api/warranty-claims/:id/retry-stock-review-sync"');
  assert.ok(start > 0, "the retry-stock-review-sync route is missing");
  const end = routes.indexOf('\n  app.', start + 10);
  return routes.slice(start, end > 0 ? end : undefined);
}

/** The bulk handler's body, from its declaration to the next top-level one. */
function bulkHandler() {
  const start = page.indexOf("async function runBulkSheetRetry");
  assert.ok(start > 0, "the bulk sheet-sync handler is missing from the warranty page");
  const end = page.slice(start).indexOf("\n  const columns = useMemo");
  const rest = page.slice(start);
  return end > 0 ? rest.slice(0, end) : rest;
}

test("the sheet-retry endpoint reaches Google Sheets and no customer", () => {
  const route = sheetSyncRoute();
  assert.match(route, /syncWarrantyStockReviewToGoogleSheets/, "the route no longer syncs the sheet");
  assert.match(route, /updateDb\(/, "the route no longer records the outcome");
  // The reason this action was chosen over the notification retry two handlers
  // above it. If someone later adds a notification send to this handler, the
  // bulk action above it stops being a spreadsheet write and starts messaging
  // every selected customer at once -- so this assertion is the guard on the
  // choice, not on the code.
  assert.doesNotMatch(
    route,
    /sendWhatsAppMessage|recordNotification|deliverReplacementNotifications/,
    "the sheet-retry endpoint now reaches a customer",
  );
});

test("the endpoint refuses a claim that never triggered a review", () => {
  // The guard is what stops a broad selection from writing sheet cells for
  // arbitrary stock: only claims that actually triggered a review and named the
  // stock they touched are eligible, and the 404 says so rather than no-oping.
  const route = sheetSyncRoute();
  assert.match(route, /!claim\.stockReviewTriggered \|\| !\(claim\.stockReviewStockIds \|\| \[\]\)\.length/);
  assert.match(route, /res\.status\(404\)/);
  // And a failed sync answers 409 rather than 200-with-a-failure-body, so a
  // partial bulk run can tell "this one is broken" from "this one worked".
  assert.match(route, /res\.status\(409\)/);
});

test("the warranty table offers the sheet retry as its bulk action", () => {
  assert.match(page, /bulkAction=/, "the warranty DataTable takes no bulkAction");
  assert.match(page, /label: "Sinkronkan ulang ke Google Sheets"/);
  assert.match(page, /hint: "[^"]*"/, "the bulk action states what it will do");
});

test("the bulk action is offered on both views, and only to claims that triggered a review", () => {
  // Eligibility mirrors the endpoint's own guard, so the count the owner sees
  // before confirming is the count that will actually be sent. A selection the
  // endpoint would 404 on every row of is a selection that reports "0 synced,
  // 8 failed" and teaches the owner nothing.
  assert.match(page, /bulkEligible\.length/, "eligibility is not computed for the confirmation");
  assert.match(page, /claim\.stockReviewTriggered/, "eligibility ignores whether a review was triggered");
  assert.match(page, /claim\.stockReviewStockIds\?\.length/, "eligibility ignores which stock the review touched");
});

test("the bulk retry asks first, and the confirmation names the count", () => {
  const handler = bulkHandler();
  // Selecting is not consenting. This one writes spreadsheet cells and touches
  // no customer, so it is not styled as destructive -- but it does clear
  // `warrantyReviewBlocked` on every stock row it touches, which is what puts
  // that stock back into circulation, so it still gets a confirm.
  assert.match(
    page,
    /onClick: \(claims, clearSelection\) => \{[^}]*setBulk\(\{ claims, clearSelection, result: null \}\)/,
    "the bulk click opens a confirmation rather than running",
  );
  assert.match(page, /<Dialog open title="Sinkronkan ulang ke Google Sheets"/);
  assert.match(page, /Konfirmasi sinkronkan/, "the confirmation states what will happen");
  // And the confirmation says the one thing a spreadsheet write is not: that it
  // sends nothing to anybody. The reason this action was chosen over the
  // notification retry is worth restating where the owner reads it.
  assert.match(page, /Tidak ada pesan yang dikirim ke reseller/);
});

test("the bulk retry takes the same lock every other handler on the page takes", () => {
  const handler = bulkHandler();
  // `busy` is React state and does not change until a render lands, so the
  // disabled button is not what stops a second click. This page already
  // documents that at length above the three retry handlers; the bulk path
  // runs the same endpoint and holds the same lock. The stakes are lower than
  // the notification retry -- a double-fire here is redundant sheet writes, not
  // duplicate messages -- but the lock is free and the shape is identical.
  assert.match(handler, /if \(!bulk \|\| actionLockRef\.current\) return;/, "the bulk retry is not double-fire safe");
  assert.match(handler, /actionLockRef\.current = true;/);
  assert.match(handler, /actionLockRef\.current = false;/, "the lock is never released");
  assert.equal([...handler.matchAll(/actionLockRef\.current = false;/g)].length, 1);
});

test("the bulk retry runs one claim at a time, not all at once", () => {
  const handler = bulkHandler();
  // Sequential is the point: these are real writes to one spreadsheet through
  // one API client, and "3 of 20 failed" is only actionable if the run can say
  // which three.
  assert.match(handler, /for \(const claim of/, "the bulk retry has no per-claim loop");
  assert.doesNotMatch(handler, /Promise\.all/, "the bulk retry fires every write at once");
  assert.doesNotMatch(handler, /claims\.map\(async/, "the bulk retry fires every write at once");
  assert.match(handler, /failed\.push\(\{/);
  assert.match(handler, /catch \(cause\)/);
});

test("a selection containing ineligible claims reports them as skipped", () => {
  const handler = bulkHandler();
  // The endpoint 404s on anything that never triggered a review. Silently
  // dropping those rows would make a partial run read as a complete one.
  assert.match(handler, /if \(!claim\.stockReviewTriggered/, "ineligible rows are not separated out");
  assert.match(handler, /skipped\.push\(claim\.id\)/, "ineligible rows are not counted");
  assert.match(page, /bulk\.result\.skipped\.length/, "skipped rows are not shown to the owner");
});

test("the run reports what happened instead of only raising a toast", () => {
  const handler = bulkHandler();
  assert.match(handler, /setBulk\(\(current\) => current && \{ \.\.\.current, result:/);
  assert.match(page, /bulk\.result\.synced/, "the result does not say how many synced");
  assert.match(page, /bulk\.result\.failed\.map/, "the result does not name the failures");
  // Selection is cleared through the callback DataTable handed over, not by
  // reaching into the table's state from the page.
  assert.match(handler, /clearSelection\(\)/);
  assert.doesNotMatch(handler, /setSelected\(new Set\(\)\)/, "the page clears the table's selection directly");
});

test("DataTable gives the caller a frozen selection to confirm against", () => {
  // `rows.filter((row) => selected.has(rowKey(row)))` reads the table's live
  // state at click time. The dialog is open for as long as the owner takes to
  // read it, and the table can re-sort and re-page underneath -- so the rows
  // handed to `onClick` have to be the ones that were on screen when the owner
  // clicked, not whatever is current when they confirm.
  assert.match(
    dataTable,
    /onClick=\{\(\) => bulkAction\.onClick\(selectedRows, \(\) => setSelected\(new Set\(\)\)\)\}/,
    "DataTable does not pass the selection and a clear callback to the caller",
  );
  // And it must clear the checkbox column when the prop disappears, or a
  // selection made on one view silently survives into the next.
  assert.match(dataTable, /if \(!selectable\) setSelected\(new Set\(\)\)/);
});