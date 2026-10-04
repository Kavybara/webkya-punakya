import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * The owner access page looks up a customer's sign-in code, their verification
 * code, their household link and their password-reset link by reading the owner's
 * own Gmail. Every one of those is a credential for a specific customer, so the
 * question this file asks is narrow: can a credential belonging to one customer
 * be shown while the page names another?
 *
 * It could. The account list on the right is a list of buttons; clicking one set
 * the search input and blanked the result, but did NOT bump the request counter
 * that `runLookup` checks its response against. So:
 *
 *   1. The owner searches customer A. A lookup goes out.
 *   2. Before it returns, the owner clicks customer B in the list. The input
 *      now says B. The result area is empty.
 *   3. A's response arrives. `requestRef.current === requestId` still holds,
 *      because nothing in step 2 touched it. The code is rendered.
 *
 * The screen now shows B's email in the input and A's sign-in code underneath
 * it. The owner reads a code to a customer, the customer does not sign in, and
 * the page that could explain why -- this one -- insists the lookup succeeded.
 * Nothing is logged, no error is raised, and the 60-second auto-hide looks
 * exactly like the normal case.
 *
 * Two smaller defects are in the same file because they are the same omission
 * repeated: the copy confirmation's 1.8s reset timer is not owned by anything,
 * so it fires after a tool switch, after navigating away, and after unmount; and
 * the result block named no account at all, leaving the search input -- which the
 * owner can type into freely and which this panel does not observe -- as the only
 * thing on screen claiming to say whose credential is displayed.
 *
 * Node 20 cannot import `.tsx`, so this is source inspection -- the repo's
 * established convention for anything under `src/`.
 */

const PAGE = new URL("../../src/pages/owner-v2/account-access/page.tsx", import.meta.url);

function read(file) {
  return readFileSync(file, "utf8");
}

/**
 * Strips block and line comments.
 *
 * Required, not optional: this file explains in prose exactly which omissions
 * caused the bug, so an assertion over raw source happily matches the
 * explanation instead of the fix. This has already produced one false failure
 * elsewhere in the suite.
 */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("picking an account from the list goes through the same guard as every other change", () => {
  const page = withoutComments(read(PAGE));

  assert.match(
    page,
    /className="console-access-account" onClick=\{\(\) => \{ clearResult\(\); setQuery\(target\); \}\}/,
    "the account-list button is setting the query without invalidating the in-flight lookup, so the previous account's code renders under the newly-selected account",
  );

  // The assertion above only proves the handler calls clearResult. This proves
  // clearResult actually does the invalidating -- a future edit that empties
  // its body would otherwise pass the first test silently.
  const clearResult = /const clearResult = \(\) => \{[\s\S]*?\};/.exec(page)?.[0];
  assert.ok(clearResult, "clearResult is gone; the handler now points at nothing");
  assert.match(
    clearResult,
    /requestRef\.current \+= 1;/,
    "clearResult must bump the request id, or the pending response still matches its own guard",
  );
});

test("every way of changing what is on screen invalidates the pending lookup", () => {
  const page = withoutComments(read(PAGE));

  // These are the four triggers. All of them invalidate.
  for (const [what, pattern] of [
    ["switching tool", /onClick=\{\(\) => \{ setTool\(item\.id\); clearResult\(\); \}\}/],
    ["typing a different target", /onChange=\{\(event\) => \{ setQuery\(event\.target\.value\); clearResult\(\); \}\}/],
    ["switching provider", /const changeProvider = \(nextProvider: Provider\) => \{\s*requestRef\.current \+= 1;/],
    ["picking an account", /className="console-access-account" onClick=\{\(\) => \{ clearResult\(\); setQuery\(target\); \}\}/],
  ]) {
    assert.match(page, pattern, `${what} can leave a stale result on screen`);
  }
});

test("a new lookup also invalidates the previous one", () => {
  const page = withoutComments(read(PAGE));
  const runLookup = /const runLookup = async \(\) => \{[\s\S]*?\n  \};/.exec(page)?.[0];
  assert.ok(runLookup, "runLookup is not defined");

  assert.match(
    runLookup,
    /const requestId = requestRef\.current \+ 1;\s*requestRef\.current = requestId;/,
    "a second search while the first is in flight would let the first response win",
  );
  assert.match(
    runLookup,
    /if \(requestRef\.current !== requestId\) return;/,
    "the response is applied without checking it is still the newest one",
  );
});

test("the copy confirmation's reset timer is owned and cleared", () => {
  const page = withoutComments(read(PAGE));

  assert.doesNotMatch(
    page,
    /window\.setTimeout\(\(\) => setCopyState\("idle"\)/,
    "an unowned timer fires after a tool switch, after navigating away, and after unmount",
  );
  assert.match(
    page,
    /copyTimerRef\.current = window\.setTimeout\(/,
    "the reset timer must be stored, or there is nothing to cancel",
  );
  assert.match(
    page,
    /useEffect\(\(\) => clearCopyTimer, \[\]\)/,
    "the timer must be cleared on unmount",
  );
});

test("changing provider or clearing the result also drops the copy timer", () => {
  const page = withoutComments(read(PAGE));

  const clearResult = /const clearResult = \(\) => \{[\s\S]*?\};/.exec(page)?.[0];
  assert.match(
    clearResult,
    /clearCopyTimer\(\);/,
    "'Tersalin' can outlive the credential it was confirming",
  );

  const changeProvider = /const changeProvider = [\s\S]*?\};/.exec(page)?.[0];
  assert.match(changeProvider, /clearCopyTimer\(\);/);
});

test("the result names the account it belongs to", () => {
  const page = withoutComments(read(PAGE));

  const resultBlock = /\{result \? \([\s\S]*?\) : null\}/.exec(page)?.[0];
  assert.ok(resultBlock, "the result block is gone");

  assert.match(
    resultBlock,
    /result\.account\.email/,
    "nothing in the result block says whose credential this is",
  );
  assert.match(resultBlock, /result\.account\.loginPhone/);
  assert.match(
    resultBlock,
    /console-access-result-account/,
    "the identity must be its own line, not folded into the product/variant line",
  );
});

test("the result names the account from the response, not from the live filter state", () => {
  const page = withoutComments(read(PAGE));

  const resultBlock = /\{result \? \([\s\S]*?\) : null\}/.exec(page)?.[0];

  // `accountTarget` reads the current `provider` to decide whether the identity
  // is the phone number or the email. Using it inside the result block makes
  // the rendered identity a function of a filter the owner can change, which
  // is the class of bug this whole file is about.
  assert.doesNotMatch(
    resultBlock,
    /accountTarget\(result\.account/,
    "the result's identity is derived from live provider state; read the fields off the response instead",
  );
});

test("account statuses come from the shared vocabulary, not a fourth copy", () => {
  const page = withoutComments(read(PAGE));

  assert.match(page, /import \{ accountStatus, type Label \} from "\.\.\/\.\.\/\.\.\/lib\/labels"/);
  assert.match(page, /function accountAccessStatus\(account: OwnerAccountAccessAccount\): Label/);
  assert.match(page, /const base = accountStatus\(account\.status\);/);

  // The words this page used to invent. "Kedaluwarsa" is the worst: the order
  // vocabulary reserves it for a QRIS payment that timed out, so an account
  // that simply ran out of days read as an unpaid order.
  for (const stale of ['"Kedaluwarsa"', '"Diganti"', '"Tidak aktif"', '"Hampir berakhir"']) {
    assert.doesNotMatch(
      page,
      new RegExp(`return ${stale.replace(/"/g, '"')}`),
      `${stale} is a private status word; lib/labels is the vocabulary`,
    );
  }

  assert.doesNotMatch(page, /function statusTone\(/, "the tone/label pair must travel together");
  assert.doesNotMatch(page, /function statusLabel\(/);
});

test("the expiry window only re-judges an account that is otherwise fine", () => {
  const page = withoutComments(read(PAGE));
  const helper = /function accountAccessStatus[\s\S]*?\n\}/.exec(page)?.[0];
  assert.ok(helper, "accountAccessStatus is not defined");

  assert.match(
    helper,
    /if \(stored !== "active" \|\| !account\.expiresAt\) return base;/,
    "an account that is already replaced or disabled must be reported as that, not as 'ending soon'",
  );
  assert.match(helper, /EXPIRY_WARNING_MS/);
});

test("the same helper decides the active count, the attention count and the badge", () => {
  const page = withoutComments(read(PAGE));

  // One judgement, three readings. If the badge and the count could disagree,
  // the header could say "3 akun aktif" over a list showing two green badges.
  assert.match(page, /const activeCount = accounts\.filter\(\(account\) => accountAccessStatus\(account\)\.tone === "success"\)/);
  assert.match(page, /<Badge tone=\{accountAccessStatus\(account\)\.tone\}>\{accountAccessStatus\(account\)\.label\}<\/Badge>/);
  assert.match(page, /accountAccessStatus\(existing\)\.tone !== "success"/);
});