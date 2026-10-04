import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/*
 * Brief Phase 6 -- the reseller balance ledger, the stock release reason, the
 * mass-assignment hole behind both, and one bug found on the way.
 *
 * Source inspection, not import-and-call. Node 20 cannot import `.ts`/`.tsx`,
 * and booting the real server writes the real database, sends real WhatsApp
 * messages and syncs real Google Sheets. Reading the source is the only form of
 * this test that touches nothing.
 *
 * Every assertion runs over comment-stripped source. This file quotes the code
 * it objects to in order to assert it is gone, so an assertion over raw source
 * would match its own explanation.
 */

const DASHBOARD = new URL("../../", import.meta.url);
const read = (relative) => readFileSync(new URL(relative, DASHBOARD), "utf8");

function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const src = (relative) => withoutComments(read(relative));

const RESELLER_ROUTES = src("server/routes/reseller-routes.js");
const STOCK_ROUTES = src("server/routes/stock-routes.js");
const INDEX = src("server/index.js");
const API = src("src/lib/api.ts");
const OVERVIEW = src("src/pages/reseller-v2/page.tsx");
const BALANCE_PAGE = src("src/pages/reseller-v2/balance/page.tsx");
const STOCK_PAGE = src("src/pages/owner-v2/stock/page.tsx");
const ROUTER = src("src/router/config.tsx");
const NAVIGATION = src("src/components/reseller-v2/navigation.ts");

/* -------------------------------------------------------------------------- */
/* the balance ledger endpoint                                                  */
/* -------------------------------------------------------------------------- */

test("the balance ledger is reseller-scoped, and authenticated as a reseller", () => {
  // Not owner. A dealer asking for their own money must not be routed through a
  // role check that also serves the cross-dealer ledger.
  assert.match(
    RESELLER_ROUTES,
    /app\.get\("\/api\/resellers\/balance-ledger", requireAuth\(\["reseller"\]\)/,
  );
});

test("the ledger is filtered before the 120-entry cap, not after", () => {
  /*
   * The bug this exists to prevent. `buildWalletLedger` sorts all resellers'
   * rows together and keeps the newest 120, then returns them. Filtering that
   * result for one reseller hands a dealer whichever 120 rows happened to be
   * globally newest -- wrong rows, and other dealers' rows.
   *
   * So the scoping happens on the *input*: a copy of the db whose `resellers`
   * list contains only the caller, which means every entry and every summary is
   * derived from their own orders and deposits before the cap ever runs.
   */
  assert.match(RESELLER_ROUTES, /const scoped = \{ \.\.\.db, resellers: \[reseller\] \};/);
  assert.match(RESELLER_ROUTES, /const ledger = buildWalletLedger\(scoped\);/);

  // And the raw `db` must never be the thing that gets built.
  assert.doesNotMatch(RESELLER_ROUTES, /buildWalletLedger\(db\)/);

  // The summary is the caller's own row, not the first one -- the summaries
  // array is sorted by balance, so index 0 is the richest dealer in the shop.
  assert.match(
    RESELLER_ROUTES,
    /ledger\.resellerSummaries\.find\(\(item\) => item\.resellerId === reseller\.id\)/,
  );
});

test("the ledger does not echo a phone number back to the dealer", () => {
  // `whatsapp` and `resellerName` are the caller's own, so this is not a leak.
  // It is noise: the page already knows the number, and a phone number is not
  // something a balance table needs to carry around.
  assert.doesNotMatch(RESELLER_ROUTES, /whatsapp: entry\.whatsapp/);
  assert.doesNotMatch(RESELLER_ROUTES, /resellerName: entry\.resellerName/);
});

test("a reseller session for a deleted account gets an empty ledger, not an error", () => {
  // Same shape as the rest of `/api/resellers`. Throwing a 500 at a dealer
  // whose account was deleted is a worse answer than showing them nothing.
  assert.match(RESELLER_ROUTES, /if \(!reseller\) \{\s*res\.json\(\{ balance: 0, entries: \[\], summary: null \}\);\s*return;\s*\}/);
});

test("the client calls the endpoint that exists", () => {
  assert.match(API, /balanceHistory\(\)\s*\{/);
  assert.match(API, /"\/resellers\/balance-ledger"/);
});

test("the balance page is routed, and reachable from the nav", () => {
  assert.match(ROUTER, /lazy\(\(\) => import\("\.\.\/pages\/reseller-v2\/balance\/page"\)\)/);
  assert.match(ROUTER, /path: "\/reseller-v2\/saldo", element: page\(ResellerV2BalancePage\)/);
  assert.match(NAVIGATION, /path: "\/reseller-v2\/saldo"/);
});

test("no balance page reads a ledger endpoint that was never built", () => {
  // `/operations/wallet-ledger` was written into api.ts during this phase and
  // does not exist on the server. The owner's real ledger arrives whole inside
  // `operationsCenter()`; a separate endpoint for it was never built.
  assert.doesNotMatch(API, /"\/operations\/wallet-ledger"/);
});

/* -------------------------------------------------------------------------- */
/* the balance page does not show machine keys                                  */
/* -------------------------------------------------------------------------- */

test("every ledger type the server can emit has an Indonesian label", () => {
  /*
   * The server sends six `type` values. The dealer sees none of them: a page
   * that renders `stock_race_credit` next to `Kredit stok habis` has failed,
   * and a page with a `default` fallthrough is one release away from failing
   * silently.
   */
  const cases = src("src/pages/reseller-v2/balance/page.tsx");
  for (const type of [
    "order_spend",
    "deposit_refund",
    "stock_race_credit",
    "late_paid_credit",
    "deposit_topup_paid",
    "manual_topup",
  ]) {
    assert.match(cases, new RegExp(`case "${type}":`), `no label for ledger type ${type}`);
  }

  // The three label strings themselves, so a renamed type cannot pass on the
  // strength of its `case` alone.
  for (const label of ["Pembelian", "Refund pesanan", "Kredit stok habis", "Kredit bayar telat", "Top up QRIS", "Top up manual"]) {
    assert.ok(cases.includes(`"${label}"`), `missing label: ${label}`);
  }
});

test("direction is read from kind, never from the sign of the amount", () => {
  // A refund and a late-paid credit are both positive amounts that arrived
  // because something went wrong. Reading the sign gets both of those backwards.
  assert.match(BALANCE_PAGE, /return entry\.kind === "credit";/);
  assert.doesNotMatch(BALANCE_PAGE, /entry\.amount > 0/);
});

test("a row with no anchor balance shows nothing rather than a fake zero", () => {
  // `balanceAfter` is absent on refund and manual-topup rows. Rendering `0`
  // there would read as "this left you at nothing".
  assert.match(BALANCE_PAGE, /entry\.balanceAfter === undefined \|\| entry\.balanceAfter === null/);
});

/* -------------------------------------------------------------------------- */
/* stock: the mass-assignment hole                                              */
/* -------------------------------------------------------------------------- */

test("PUT /api/stock/:id rejects fields outside the allowlist, naming them", () => {
  assert.match(STOCK_ROUTES, /const STOCK_EDITABLE_FIELDS = new Set\(\[/);
  assert.match(STOCK_ROUTES, /const blockedFields = Object\.keys\(req\.body \|\| \{\}\)\.filter\(\(key\) => !STOCK_EDITABLE_FIELDS\.has\(key\)\)/);
  assert.match(STOCK_ROUTES, /error\.status = 409;/);

  // Silently dropping them would be worse than refusing: a client that thinks
  // it saved something and did not is the harder bug to find. So the refusal
  // has to name the keys it rejected.
  assert.match(STOCK_ROUTES, /Field stok tidak boleh diubah lewat form: \$\{blockedFields\.join\(", "\)\}/);
});

test("the allowlist covers every field the edit form actually sends", () => {
  /*
   * An allowlist that is missing one of the form's own fields breaks the edit
   * dialog the day it is added to, with a 409 that names the offending key and
   * no obvious cause. So the two are asserted against each other.
   */
  const formFields = [...STOCK_PAGE.matchAll(/setForm\(\{([^}]*)\}/g)]
    .flatMap((match) => [...match[1].matchAll(/(\w+):/g)])
    .map((match) => match[1]);

  assert.ok(formFields.length > 0, "the edit form's field list could not be read");

  const allowlist = STOCK_ROUTES.slice(
    STOCK_ROUTES.indexOf("STOCK_EDITABLE_FIELDS"),
    STOCK_ROUTES.indexOf("STOCK_EDITABLE_FIELDS") + 900,
  );
  for (const field of new Set(formFields)) {
    assert.ok(
      allowlist.includes(`"${field}"`),
      `the edit form sends "${field}" but the stock allowlist does not permit it`,
    );
  }
});

test("the release and the status edit both name the acting owner", () => {
  // The activity log is the audit trail. An entry that says "oleh owner" when
  // the app has a named owner profile is a trail that cannot answer who.
  const actorReads = STOCK_ROUTES.match(/ownerProfile\(db\)/g) || [];
  assert.ok(actorReads.length >= 3, `expected the actor read in each of 3 places, found ${actorReads.length}`);
  assert.doesNotMatch(STOCK_ROUTES, /oleh owner\./);
});

/* -------------------------------------------------------------------------- */
/* stock: releasing a sold unit                                                  */
/* -------------------------------------------------------------------------- */

test("releasing stock requires a reason", () => {
  assert.match(STOCK_ROUTES, /app\.post\("\/api\/stock\/:id\/release", requireAuth\(\["owner"\]\)/);
  assert.match(STOCK_ROUTES, /const reason = String\(req\.body\?\.reason \|\| ""\)\.trim\(\);/);
  assert.match(STOCK_ROUTES, /if \(!reason\) \{\s*res\.status\(400\)/);
});

test("releasing stock refuses while a linked daily account is active", () => {
  assert.match(STOCK_ROUTES, /const linkedAccountId = String\(stock\.reservedAccountId \|\| ""\)\.trim\(\);/);
  assert.match(STOCK_ROUTES, /Stok ini masih dipakai akun harian aktif/);

  // The guard is guarded. An absent `reservedAccountId` normalises to "", and
  // comparing "" to "" matches any account whose id is also missing.
  assert.match(STOCK_ROUTES, /const linkedAccount = linkedAccountId\s*\?/);
});

test("releasing stock sends reserved rows to the endpoint built for them", () => {
  // `release-reservation` refuses anything that is not `reserved`, and it is
  // the only one of the two that also checks the live order holding the hold.
  assert.match(STOCK_ROUTES, /if \(current === "reserved"\) \{/);
  assert.match(STOCK_ROUTES, /Stok reserved harus dilepas lewat endpoint release-reservation/);
});

test("the client no longer hardcodes the resulting status", () => {
  /*
   * `api.updateStock(id, { status: "available" })` asserted that a sold unit
   * becomes sellable. Google Sheets may now report the account as unusable, in
   * which case it has to come back `blocked`. The server decides.
   */
  assert.doesNotMatch(STOCK_PAGE, /api\.updateStock\(subject\.id, \{ status: "available" \}\)/);
  assert.match(STOCK_PAGE, /api\.releaseStock\(subject\.id, \{ reason: releaseReason\.trim\(\) \}\)/);
  assert.match(STOCK_PAGE, /released\.stock\?\.status/);
});

test("the reopen dialog collects a reason for sold stock only", () => {
  // A reservation lasts hours and already writes its own activity entry. The
  // release it is undoing is the one a later reader needs explained.
  assert.match(STOCK_PAGE, /editing\.status === "reserved" \? null : <Field label="Alasan pengembalian" required/);
  assert.match(STOCK_PAGE, /value=\{releaseReason\}/);
});

test("the reopen warning no longer claims the server does nothing", () => {
  // It used to read "server tidak melakukan apa pun untuk mencegahnya", which
  // was true of `updateStock` and false of the release endpoint.
  assert.doesNotMatch(STOCK_PAGE, /server tidak melakukan apa pun untuk mencegahnya/);
  assert.match(STOCK_PAGE, /server tidak bisa tahu apakah pelanggan lama sudah berhenti memakainya/);
});

/* -------------------------------------------------------------------------- */
/* the bug found on the way                                                    */
/* -------------------------------------------------------------------------- */

test("buildWalletLedger does not push to an `items` it never declared", () => {
  /*
   * A `db.warrantyClaims` loop sat at the tail of `buildWalletLedger`, pushing
   * queue items onto a bare `items` that the function did not declare -- so
   * every call threw `ReferenceError: items is not defined`.
   *
   * It was not dormant. `warranty-service.js` sets `replacementSyncStatus` to
   * "pending" on every manual replacement, so the loop's guard passed on real
   * data. Both `/api/operations/center` and the new balance ledger call this
   * function, which is how a pasted-together warranty alert took the whole
   * Operations Center down.
   *
   * The slice is brace-counted rather than taken to the next blank line: the
   * bug lived at the very end of the function, so anything index-based would
   * have quietly stopped covering it.
   */
  const start = INDEX.indexOf("function buildWalletLedger(db) {");
  assert.ok(start > 0, "buildWalletLedger was not found");

  let depth = 0;
  let end = -1;
  for (let i = start; i < INDEX.length; i += 1) {
    if (INDEX[i] === "{") depth += 1;
    else if (INDEX[i] === "}") {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.ok(end > start, "the end of buildWalletLedger could not be located");

  const body = INDEX.slice(start, end);
  assert.doesNotMatch(body, /\bitems\.push\b/, "buildWalletLedger pushes to an undeclared `items`");
  assert.doesNotMatch(body, /replacementSyncStatus/, "the warranty loop is back in the ledger");

  // ...and the alert it was written for now lives somewhere that has `items`.
  assert.match(INDEX, /manual-warranty-sync-/);
  const manual = INDEX.slice(INDEX.indexOf("function buildManualQueue("));
  assert.ok(
    manual.includes("manual-warranty-sync-"),
    "the warranty replacement-sync alert was dropped instead of moved",
  );
});

/* -------------------------------------------------------------------------- */
/* the archive window                                                           */
/* -------------------------------------------------------------------------- */

test("the activity archive keeps more than five days", () => {
  /*
   * Five days meant a stock release reason written today is gone before anyone
   * reads it. It is a named constant now rather than a bare literal, so the
   * next person to change it sees the number they are changing.
   *
   * The `= 5` defaults further down are left alone on purpose. They are
   * fallbacks on a parameter the only production caller now always supplies, so
   * changing them would be noise -- and asserting they are gone would pin an
   * implementation detail that is allowed to move. What matters is that the
   * scheduled job no longer asks for five.
   */
  assert.match(INDEX, /const ACTIVITY_ARCHIVE_KEEP_DAYS = 30;/);
  assert.match(INDEX, /runActivityArchive\(\{ keepDays: ACTIVITY_ARCHIVE_KEEP_DAYS \}\)/);

  // No caller anywhere passes a literal five any more.
  const INDEX_RAW = read("server/index.js");
  const archiveCalls = INDEX_RAW.match(/runActivityArchive\([^)]*\)/g) || [];
  for (const call of archiveCalls) {
    assert.doesNotMatch(call, /keepDays: 5\b/, "an archive caller still hardcodes five days");
  }
});