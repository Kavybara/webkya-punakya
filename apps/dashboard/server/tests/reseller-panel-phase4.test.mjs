import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { transpileModule } from "typescript";

/*
 * The reseller side of the console: top-up, catalog, orders, overview.
 *
 * **The top-up dialog could be submitted twice.** `submit()` was guarded by
 * `submitting` React state and nothing else, but `disabled={submitting}` does
 * not land until React re-renders. Two clicks inside that window both reach the
 * request. For `qris_auto` that is not a harmless duplicate: the route calls
 * `createPakasirQris`, which makes a real transaction at the provider, and it
 * messages the owner on WhatsApp. The dealer is billed twice and the owner
 * told twice. Fixed with a ref checked before the first `await`.
 *
 * **A manual method left the form live and sent a second request.** The server
 * only creates a `payment` for `qris_auto`; every other method returns
 * `{ requestId, message }` and nothing else. The dialog's success branch was
 * gated on `payment`, so a BCA deposit fell back to rendering the *form again*
 * with a green confirmation underneath the amount field -- reading as "it did
 * not go through" to anyone who had not memorised the branch. Pressing again
 * filed a second request and sent the owner a second WhatsApp message. There is
 * now a receipt branch that reports the reference and stops.
 *
 * **The expiry was a raw timestamp.** `2026-01-02 03:04:05`, straight from
 * `addMinutesText`, on the one number the reseller cannot do without.
 *
 * **The overview's "Pesanan aktif" tile was capped at 3.** It rendered
 * `activeOrders.length`, and `activeOrders` is `.slice(0, 3)` for the list
 * beneath it. Nine open orders displayed as "3". `openOrderCount` was computed
 * one line above for exactly this and used only in the attention sum.
 *
 * **"Buka QRIS" was a button that did nothing.** `paymentUrl` is only
 * populated once the provider answers; until then `window.open(undefined)`.
 * Live, primary-styled, no explanation.
 *
 * **Two Phase 4 items did not survive being checked against the server**, and
 * the tests pin the reasons rather than the intentions:
 *
 * - *"disable checkout on insufficient balance"* -- `depositBreakdown` in
 *   `server/auto-order.js` splits the payment: `depositUsed = Math.min(balance,
 *   total)` and the remainder becomes `paymentDue`, charged by QRIS. The
 *   checkout page already renders "Deposit dipakai" beside "Total pembayaran".
 *   Blocking would refuse orders the product sells and break a working flow.
 *   The catalog now states the split instead.
 * - *"minimum top-up per method"* -- no minimum exists anywhere on the server:
 *   not in the route, `createDepositTopupOrder`, or `createPakasirQris`. A floor
 *   shown to the dealer would be a promise the backend does not keep. What
 *   *was* missing is fractional rupiah, which the server does accept and store.
 *
 * `parseTopUpAmount`, `depositSplit` and `splitNotice` are transpiled and
 * *called* here. The rest is source inspection -- Node 20 cannot import `.tsx`,
 * the repo's established convention.
 */

const DASHBOARD = new URL("../../", import.meta.url);

const TOPUP = new URL("src/components/reseller-v2/TopUpDialog.tsx", DASHBOARD);
const CATALOG = new URL("src/pages/reseller-v2/catalog/page.tsx", DASHBOARD);
const ORDERS = new URL("src/pages/reseller-v2/orders/page.tsx", DASHBOARD);
const OVERVIEW = new URL("src/pages/reseller-v2/page.tsx", DASHBOARD);
const OVERLAY = new URL("src/components/ui/Overlay.tsx", DASHBOARD);
const DEPOSITS = new URL("src/lib/deposits.ts", DASHBOARD);
const RESELLER_ROUTES = new URL("server/routes/reseller-routes.js", DASHBOARD);
const AUTO_ORDER = new URL("server/auto-order.js", DASHBOARD);
const SETTINGS_ROUTES = new URL("server/routes/settings-routes.js", DASHBOARD);

const outRoot = new URL(".compiled-tests-phase4/", import.meta.url);
mkdirSync(outRoot, { recursive: true });
process.on("exit", () => rmSync(outRoot, { recursive: true, force: true }));

/** Transpiles one `.ts` leaf module and imports it for real. */
async function loadTs(file, name) {
  const { outputText } = transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: 99, target: 99 },
    fileName: "module.ts",
  });
  const out = new URL(`${name}.mjs`, outRoot);
  writeFileSync(out, outputText);
  // `fileURLToPath`, not `.pathname`: the repo path contains a space, which the
  // URL form percent-encodes into a filename that does not exist.
  return import(pathToFileURL(fileURLToPath(out)).href);
}

// `lib/deposits` has no imports at all, so it compiles to a leaf.
// `parseTopUpAmount` is read back out of TopUpDialog's own compiled output
// below, because that is where it lives.
const { depositSplit, splitNotice } = await loadTs(DEPOSITS, "deposits");

function read(file) {
  return readFileSync(file, "utf8");
}

/**
 * Strips block and line comments.
 *
 * Required, not optional: this file quotes the old copy verbatim in order to
 * assert it is gone, and it explains in prose exactly which omissions caused
 * each bug -- so an assertion over raw source would happily match the
 * explanation instead of the fix.
 */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const topup = () => withoutComments(read(TOPUP));
const catalog = () => withoutComments(read(CATALOG));
const orders = () => withoutComments(read(ORDERS));
const overview = () => withoutComments(read(OVERVIEW));
const overlay = () => withoutComments(read(OVERLAY));

/** Formats like `formatRupiah`, for the notice assertions. */
const rp = (value) => `Rp${Number(value).toLocaleString("id-ID")}`;

/* -------------------------------------------------------------------------- */
/* depositSplit                                                               */
/* -------------------------------------------------------------------------- */

test("the split matches the server's own arithmetic", () => {
  // The premise of `lib/deposits.ts`. If `depositBreakdown` ever changes, the
  // catalog's sentence becomes a lie -- so the source it mirrors is asserted
  // here rather than left as a comment that can rot.
  const source = read(AUTO_ORDER);
  const match = /function depositBreakdown\([^)]*\) \{[\s\S]*?\n\}/.exec(source);
  assert.ok(match, "depositBreakdown is gone or renamed in server/auto-order.js");
  assert.match(match[0], /const depositUsed = Math\.min\(depositBefore, Math\.max\(0, Number\(total \|\| 0\)\)\);/);
  assert.match(match[0], /paymentDue: Math\.max\(0, Number\(total \|\| 0\) - depositUsed\)/);
});

test("a balance larger than the order never produces a negative remainder", () => {
  // The `Math.min` is load-bearing. A Rp500.000 balance on a Rp75.000 order has
  // to read as fully covered, not as a Rp425.000 refund.
  const split = depositSplit(500_000, 75_000);
  assert.equal(split.depositUsed, 75_000);
  assert.equal(split.depositAfter, 425_000);
  assert.equal(split.paymentDue, 0);
  assert.equal(split.isShort, false);
});

test("a partial balance splits rather than blocking", () => {
  const split = depositSplit(50_000, 75_000);
  assert.equal(split.depositUsed, 50_000);
  assert.equal(split.depositAfter, 0);
  assert.equal(split.paymentDue, 25_000);
  assert.equal(split.isShort, true);
});

test("an empty balance is a full QRIS order, not an error", () => {
  // The whole reason checkout is not disabled: this is a legitimate purchase.
  const split = depositSplit(0, 75_000);
  assert.equal(split.depositUsed, 0);
  assert.equal(split.paymentDue, 75_000);
  assert.equal(split.isShort, true);
});

test("junk input is treated as zero rather than as NaN", () => {
  for (const bad of [NaN, undefined, null, -5_000, -1]) {
    const split = depositSplit(bad, 75_000);
    assert.equal(split.balance, 0, `${String(bad)} balance`);
    assert.equal(split.depositUsed, 0);
    assert.equal(split.paymentDue, 75_000);
  }
  assert.equal(depositSplit(50_000, NaN).total, 0);
});

test("an exact match is fully covered, with nothing left owing", () => {
  const split = depositSplit(75_000, 75_000);
  assert.equal(split.depositUsed, 75_000);
  assert.equal(split.paymentDue, 0);
  assert.equal(split.isShort, false, "an exactly-covered order is not short");
});

/* -------------------------------------------------------------------------- */
/* splitNotice                                                                */
/* -------------------------------------------------------------------------- */

test("the notice only speaks when money is still owed", () => {
  // Silence is the point: a notice under every purchase teaches dealers to
  // ignore the spot where it would have mattered.
  assert.equal(splitNotice(depositSplit(500_000, 75_000), rp), "");
  assert.equal(splitNotice(depositSplit(75_000, 75_000), rp), "");
});

test("the notice names both the deposit used and the shortfall", () => {
  const notice = splitNotice(depositSplit(50_000, 75_000), rp);
  assert.match(notice, /Saldo Rp50\.000/);
  assert.match(notice, /menutup Rp50\.000/);
  assert.match(notice, /Sisa Rp25\.000 dibayar lewat QRIS/);
});

test("an empty balance gets its own sentence", () => {
  // "Saldo Rp0 menutup Rp0" is technically true and completely useless.
  const notice = splitNotice(depositSplit(0, 75_000), rp);
  assert.match(notice, /Seluruh Rp75\.000 dibayar lewat QRIS/);
  assert.doesNotMatch(notice, /menutup/, "an empty balance has nothing to cover anything with");
});

test("a zero-price selection says nothing", () => {
  assert.equal(splitNotice(depositSplit(0, 0), rp), "");
  assert.equal(splitNotice(depositSplit(50_000, 0), rp), "");
});

/* -------------------------------------------------------------------------- */
/* parseTopUpAmount                                                           */
/* -------------------------------------------------------------------------- */

test("a fractional amount is refused, not rounded", () => {
  // The server accepts it: `Math.max(0, Number(amount || 0))` on `1500.5`
  // stores `deposit: 1500.5` in the reseller's own balance. Rupiah has no
  // subunit in circulation, and `formatRupiah` rounds -- so the field accepted
  // a number the rest of the product cannot show back to them.
  const { amount, error } = parseTopUpAmount("1500.5");
  assert.equal(amount, 0);
  assert.match(error, /bulat rupiah/);
  assert.equal(parseTopUpAmount("0.01").error !== "", true);
  assert.equal(parseTopUpAmount("1000.999").error !== "", true);
});

test("zero, negative and non-numeric amounts are each refused", () => {
  for (const bad of ["", "   ", "0", "-1", "abc", "1e", "NaN", "1,000"]) {
    assert.ok(parseTopUpAmount(bad).error, `${JSON.stringify(bad)} must be refused`);
  }
});

test("a whole rupiah amount passes through unchanged", () => {
  for (const good of ["1", "10000", "1000000", " 5000 "]) {
    const { amount, error } = parseTopUpAmount(good);
    assert.equal(error, "", `${JSON.stringify(good)} must be accepted`);
    assert.equal(amount, Number(String(good).trim()));
  }
});

/* -------------------------------------------------------------------------- */
/* TopUpDialog -- the double submit                                            */
/* -------------------------------------------------------------------------- */

test("the submit lock is a ref checked before the request", () => {
  const source = topup();

  // A ref, not state: `disabled={submitting}` cannot close the window between
  // a click and the re-render, and only a synchronous check can.
  assert.match(source, /const submitLock = useRef\(false\);/);
  assert.match(source, /if \(submitLock\.current\) return;/);

  // ...and it is taken *before* the first await, not after it.
  const submit = /async function submit\(\) \{[\s\S]*?\n  \}/.exec(source)?.[0];
  assert.ok(submit, "submit is not defined");
  assert.ok(
    submit.indexOf("submitLock.current = true") < submit.indexOf("await api.requestResellerDeposit"),
    "the lock is taken after the request has already gone out",
  );

  // Released in the finally, so a failed request can be retried.
  assert.match(submit, /finally \{\s*submitLock\.current = false;\s*setSubmitting\(false\);/);
});

test("a manual method gets a receipt instead of the form back", () => {
  const source = topup();

  assert.match(source, /const \[receipt, setReceipt\] = useState<\{ reference: string; message: string \} \| null>\(null\);/);
  assert.match(
    source,
    /if \(!createdPayment\) setReceipt\(\{ reference, message \}\);/,
    "a manual deposit returns no payment, so the success branch never renders and the dealer sees the form again",
  );

  // The receipt names the thing they must quote to the owner.
  assert.match(source, /<strong>Permintaan terkirim<\/strong>/);
  assert.match(source, /<dt>Nomor permintaan<\/dt>/);
  assert.match(source, /\{receipt\.reference \|\| "-"\}/);

  // It closes the dialog. There is no second submit button in this branch.
  const receiptBranch = /receipt \? \([\s\S]*?\n        \) : \(/.exec(source)?.[0];
  assert.ok(receiptBranch, "the receipt branch is missing");
  assert.doesNotMatch(receiptBranch, /onClick=\{submit\}/);
});

test("the QRIS branch explains itself when the provider gives no link", () => {
  const source = topup();

  // Without a URL there is no way to pay, and the QR only renders when the
  // provider returned a drawable string. A silent missing button is
  // indistinguishable from a bug to the person holding it.
  assert.match(
    source,
    /\{payment\.paymentUrl \? \([\s\S]*?<\/a>\s*\) : \(\s*<p className="reseller-v2-topup-notice">\s*Tautan pembayaran tidak tersedia dari penyedia\./,
  );
  assert.match(source, /hubungi owner bila QRIS tidak tampil/);
});

test("the expiry is a formatted date, not the server's string", () => {
  const source = topup();
  assert.match(source, /<dd>\{payment\.expiresAt \? formatDateTime\(payment\.expiresAt\) : "-"\}<\/dd>/);
  assert.doesNotMatch(source, /<dd>\{payment\.expiresAt \|\| "-"\}<\/dd>/);
});

test("the amount field asks for whole rupiah", () => {
  const source = topup();
  // `min="1"` alone does not stop 1.5 being typed, and `step="1"` is what
  // tells the browser's own validation the same thing.
  assert.match(source, /type="number"\s*min="1"\s*step="1"/);
});

test("method names prefer the owner's wording over a private copy", () => {
  const source = topup();

  // `deposit-instructions` returns a `label` per method and this file ignored
  // all of them. The fallback `|| method` printed the raw key into the
  // dropdown the moment the owner configured an eighth method.
  assert.match(source, /\| instructions\?\.methods\?\.\[method\]\?\.label \|\| method/);
  assert.match(source, /methodLabel\(item, instructions\)/);
  assert.match(source, /methodLabel\(method, instructions\)/);
});

test("the receipt is cleared when the dialog closes", () => {
  const source = topup();
  assert.match(source, /setPayment\(null\);\s*setOrderId\(""\);\s*setReceipt\(null\);/);
});

/* -------------------------------------------------------------------------- */
/* orders -- the dead button                                                   */
/* -------------------------------------------------------------------------- */

test("an empty paymentUrl disables the button and explains why", () => {
  const source = orders();

  assert.match(source, /confirmDisabled=\{!qrisPayment\?\.paymentUrl\}/);

  // A disabled button with no reason is its own dead end, so the notice and
  // the disabled state have to arrive together.
  assert.match(
    source,
    /\{!qrisLoading && !qrisPayment\?\.paymentUrl \? \(\s*<Notice tone="warning">/,
  );
  assert.match(source, /Tautan pembayaran belum tersedia dari penyedia QRIS\./);
  assert.match(source, /hubungi owner untuk membuka\s+ulang\s+pembayaran\./);
});

test("the deadline is formatted on both paths", () => {
  const source = orders();

  // `qrisPayment.expiresAt` and `qrisOrder.paymentExpiresAt` are both
  // `addMinutesText` output. Formatting only one would leave the other raw
  // whenever the payment object has not loaded yet.
  assert.match(source, /qrisPayment\?\.expiresAt\s*\? formatDateTime\(qrisPayment\.expiresAt\)/);
  assert.match(source, /qrisOrder\.paymentExpiresAt\s*\? formatDateTime\(qrisOrder\.paymentExpiresAt\)/);
  assert.doesNotMatch(source, /\{qrisPayment\?\.expiresAt \|\| qrisOrder\.paymentExpiresAt \|\| "-"\}/);
});

test("the delivery drawer's end date is a calendar date", () => {
  const source = orders();

  // `formatCalendarDate` reads YYYY-MM-DD out of the string rather than via
  // `Date`, so it cannot slip a day for a reader east or west of UTC.
  assert.match(source, /account\.expiresAt \? formatCalendarDate\(account\.expiresAt\) : "-"/);
  assert.doesNotMatch(source, /<dd>\{account\.expiresAt \|\| "-"\}<\/dd>/);
});

test("DialogActions can disable its confirm, which it could not before", () => {
  const source = overlay();

  assert.match(source, /confirmDisabled = false,/);
  assert.match(source, /confirmDisabled\?: boolean;/);
  assert.match(source, /disabledReason\?: string;/);

  // `busy` means "wait", `confirmDisabled` means "impossible" -- they cannot be
  // the same flag, or a caller cannot tell a temporary state from a permanent
  // one, and the Cancel button would grey out with the reason. Phase 5 stopped
  // folding them into one local and handed the busy half to the kit's
  // `loading` prop, which derives disabled *and* aria-busy from it; the
  // assertion is that the two still reach the confirm as separate inputs.
  assert.match(source, /loading=\{busy\}/);
  assert.match(source, /disabled=\{confirmDisabled\}/);
  // Cancel is the control a reader reaches for to escape, so it must not be
  // announced as busy -- it is not the thing doing the work.
  assert.match(source, /weight="secondary" onClick=\{onCancel\} disabled=\{busy\}>Batal<\/Button>/);
  assert.doesNotMatch(source, /onClick=\{onCancel\} loading=\{busy\}/);
});

/* -------------------------------------------------------------------------- */
/* overview                                                                   */
/* -------------------------------------------------------------------------- */

test("the active-orders tile counts every open order, not the first three", () => {
  const source = overview();

  assert.match(source, /value=\{openOrderCount\}/);
  assert.match(source, /hint=\{openOrderCount \? "Perlu dipantau" : "Semua beres"\}/);
  assert.match(source, /tone=\{openOrderCount \? "warning" : "success"\}/);

  // The bug: `activeOrders` is `.slice(0, 3)` for the list beneath it.
  assert.doesNotMatch(source, /value=\{activeOrders\.length\}/);

  // ...and the list still shows three, which is what the slice is for.
  assert.match(source, /data\.orders\.filter\(isActiveOrder\)\.slice\(0, 3\)/);
});

test("the balance-history button does not promise a ledger that does not exist", () => {
  const source = overview();

  // There is no reseller-facing balance ledger: `walletLedger` and
  // `resellers/deposit-requests` are both `requireAuth(["owner"])`. Pin the
  // auth, so the day one of them is opened up to resellers this test says so.
  for (const route of [RESELLER_ROUTES]) {
    const text = read(route);
    assert.match(
      text,
      /app\.get\("\/api\/resellers\/deposit-requests", requireAuth\(\["owner"\]\)/,
      "deposit-requests is open to resellers now -- the label can be revisited",
    );
  }

  assert.match(source, />Riwayat pesanan<\/Button>/);
  assert.doesNotMatch(source, />Riwayat saldo<\/Button>/);
});

/* -------------------------------------------------------------------------- */
/* catalog                                                                    */
/* -------------------------------------------------------------------------- */

test("checkout is not disabled on an insufficient balance", () => {
  const source = catalog();

  // The brief asked for this. The server splits the payment instead
  // (`depositBreakdown`), so blocking would refuse orders the product sells.
  assert.doesNotMatch(source, /disabled=\{redirecting \|\| [^}]*balance/);
  assert.match(source, /disabled=\{redirecting\}/);
});

test("the catalog states the split before the dealer commits", () => {
  const source = catalog();

  assert.match(source, /import \{ depositSplit, splitNotice \} from "\.\.\/\.\.\/\.\.\/lib\/deposits"/);
  assert.match(source, /const split = useMemo\(\s*\(\) => depositSplit\(balance, selection\?\.price \|\| 0\),/);

  // Both checkout controls carry it. The sticky phone bar is the only checkout
  // control below the fold on a small screen, so a sentence that only appears
  // in the expanded card is a sentence a phone user never reads.
  assert.match(source, /\{paymentNotice \? \(\s*<p className="reseller-v2-catalog-split">\{paymentNotice\}<\/p>\s*\) : null\}/);
  assert.match(source, /<small className="reseller-v2-catalog-split">\{paymentNotice\}<\/small>/);
});

test("the deposit methods carry no invented minimum", () => {
  // If a floor is ever added it must come from the server, not from this UI.
  assert.doesNotMatch(read(AUTO_ORDER), /depositMin|minimumDeposit|minDeposit/i);
  assert.doesNotMatch(read(RESELLER_ROUTES), /depositMin|minimumDeposit|minDeposit/i);
  assert.doesNotMatch(read(SETTINGS_ROUTES), /depositMin|minimumDeposit|minDeposit/i);

  // The only amount validation on the route is "must not be falsy".
  const route = read(RESELLER_ROUTES);
  assert.match(route, /const amount = Math\.max\(0, Number\(req\.body\?\.amount \|\| 0\)\);/);
  assert.match(route, /if \(!amount\) \{\s*res\.status\(400\)\.json\(\{ error: "Nominal deposit wajib diisi" \}\);/);
});

test("the split sentence is styled, not an unclassed paragraph", () => {
  const css = read(new URL("src/pages/reseller-v2/catalog/catalog.css", DASHBOARD));
  assert.match(css, /\.reseller-v2-catalog-split \{/);
  assert.match(css, /\.reseller-v2-catalog-mobile-bar \.reseller-v2-catalog-split \{/);
});

/* -------------------------------------------------------------------------- */
/* Harness note                                                               */
/* -------------------------------------------------------------------------- */

// `parseTopUpAmount` lives inside `TopUpDialog.tsx`, which is a `.tsx` with a
// React import -- Node 20 cannot import it. The function is pulled out of the
// compiled output textually and re-evaluated, so the assertions above still
// call the real implementation rather than re-implementing it here. That is
// only safe because the function is pure and dependency-free, which the source
// inspection below asserts.
test("parseTopUpAmount is pure and dependency-free, so the shim below is sound", () => {
  const source = topup();
  const fn = /export function parseTopUpAmount\(value: string\): \{[\s\S]*?\n\}/.exec(source)?.[0];
  assert.ok(fn, "parseTopUpAmount is not defined");

  // Nothing from the module scope: no `instructions`, no `methodLabel`, no
  // `selected`. If it grew one, the extracted copy below would throw on
  // something it cannot see and this test would fail loudly rather than
  // quietly passing against stale logic.
  assert.doesNotMatch(fn, /\binstructions\b/);
  assert.doesNotMatch(fn, /methodLabel|safeDepositError|methodOrder/);
});

const compiledTopup = transpileModule(read(TOPUP), {
  compilerOptions: { module: 99, target: 99, jsx: 4 },
  fileName: "TopUpDialog.tsx",
}).outputText;
const extracted = /export function parseTopUpAmount[\s\S]*?\n\}/.exec(compiledTopup)?.[0];
assert.ok(extracted, "parseTopUpAmount did not survive transpilation in a findable form");

// eslint-disable-next-line no-new-func
const { parseTopUpAmount } = new Function(
  "Math",
  `${extracted.replace(/^export /, "")}; return { parseTopUpAmount };`,
)(Math);