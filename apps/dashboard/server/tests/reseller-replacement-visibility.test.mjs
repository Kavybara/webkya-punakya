import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const accountsPageUrl = new URL("../../src/pages/reseller-v2/accounts/page.tsx", import.meta.url);
const warrantyPageUrl = new URL("../../src/pages/reseller-v2/warranty/page.tsx", import.meta.url);
const typesUrl = new URL("../../src/lib/types.ts", import.meta.url);

/**
 * A warranty replacement produced two account rows and told the reseller about
 * exactly one of them.
 *
 * `newAccountFromStock` (warranty-service.js:525-577) spreads `...oldAccount`, so
 * the replacement inherits `resellerId`, `orderId` and `whatsapp` and lands in the
 * same reseller's list. The old row is marked at warranty-service.js:632-641:
 * `status = "replaced"`, plus `replacedAt`, `replacedByAccountId` and
 * `replacementReason`. The new row carries the mirror image --
 * `replacementOfAccountId` and `replacementCreatedAt` (lines 562-570).
 *
 * None of that reached the screen. `replacedByAccountId` and `replacedAt` were
 * declared in `types.ts` and read nowhere; `replacementOfAccountId` was not even
 * declared. So from the reseller's side a replacement looked like an unrelated
 * new row appearing in "Aktif" and an old one silently going quiet:
 *
 *   - the new row got an "Aktif" badge and nothing else;
 *   - the old row fell to "Kadaluarsa" labelled "Tidak Aktif" by
 *     `normalizeResellerAccountStatus`, which maps `replaced` -> `inactive`
 *     (resellerAccounts.ts:85);
 *   - `accountConditionBadge` could not cover it either -- that reads
 *     `account.accountCondition`, and the `REPLACED` condition is written to the
 *     *stock* row (warranty-service.js:645), never to the managed account.
 *
 * The old row was also the least legible thing on the page: `replaced` is
 * terminal in `isTerminalManagedAccountStatus` (index.js:3064-3066), so
 * `redactExpiredAccountSecrets` (account-routes.js:112-132) blanks its email and
 * loginPhone, and `accountIdentity` falls through to "-". The reseller was shown
 * a row with no identity, no reason, and no successor.
 *
 * The data is already in the listing payload -- redaction only empties secrets,
 * it does not strip these fields -- so this is a read, not a new endpoint.
 */
test("the managed account type declares both directions of the replacement link", async () => {
  const types = await readFile(typesUrl, "utf8");

  // The forward direction: which account this one replaced.
  assert.match(
    types,
    /replacementOfAccountId\?: string;/,
    "the new side of the link is undeclared, so nothing can read it",
  );
  assert.match(
    types,
    /replacementCreatedAt\?: string;/,
    "the replacement timestamp is undeclared, so the UI cannot say when",
  );
  // And the backward one, which was declared but never read.
  assert.match(types, /replacedByAccountId\?: string;/);
  assert.match(types, /replacedAt\?: string;/);
  assert.match(types, /replacementReason\?: string;/);
});

test("a replacement account is labelled as one in the reseller's list", async () => {
  const page = await readFile(accountsPageUrl, "utf8");

  assert.match(
    page,
    /replacementOfAccountId/,
    "the account list never reads replacementOfAccountId, so a replacement looks like any other new row",
  );
  assert.match(page, /Pengganti/, "no badge marks the replacement account");
  assert.match(
    page,
    /replacedByAccountId/,
    "the account list never reads replacedByAccountId, so the replaced account is not marked at all",
  );
  assert.match(page, /Diganti/, "no badge marks the account that was replaced");
});

test("the badge cannot be a bare claim -- it has to name what it points at", async () => {
  const page = await readFile(accountsPageUrl, "utf8");
  const start = page.indexOf("function accountReplacementBadge");
  assert.ok(start > 0, "the replacement badge helper is missing");

  // A pill that says "Pengganti" and stops there answers none of the reseller's
  // three questions: which one, since when, and why. The label alone is the
  // defect these assertions exist to prevent.
  const helper = page.slice(start, start + 1200);
  assert.match(helper, /replacedByAccountId/, "the old side does not resolve the successor it points to");
  assert.doesNotMatch(
    helper,
    /return null;\s*}\s*if \(condition === "REPLACED"\)/,
    "the replacement badge is folded into the account-condition badge, which cannot fire -- REPLACED is written to the stock row",
  );
});

test("the drawer answers which account this replaced, and when", async () => {
  const page = await readFile(accountsPageUrl, "utf8");

  // The successor/ancestor lookup. Both rows are in the same list, so this is a
  // find, not a fetch.
  assert.match(
    page,
    /replacementOfAccountId[\s\S]{0,400}?\.find\(/,
    "the drawer does not resolve the account this one replaced",
  );
  assert.match(
    page,
    /replacedByAccountId[\s\S]{0,400}?\.find\(/,
    "the drawer does not resolve the account that replaced this one",
  );
  // The reason lives on the OLD row only (warranty-service.js:636); the new row
  // sets `replacementReason: ""` at line 568. Reading it off the selected row
  // alone would always render nothing.
  assert.match(page, /replacementReason/, "the owner's reason never reaches the reseller");
  assert.match(page, /replacementCreatedAt|replacedAt/, "no timestamp is shown");
});

test("the warranty history links the claim to its replacement account", async () => {
  const page = await readFile(warrantyPageUrl, "utf8");

  assert.match(
    page,
    /claim\.replacement/,
    "the claim history never reads claim.replacement, so a 'Diganti' badge says nothing about which account arrived",
  );
  // It has to be a usable destination, not a bare id.
  assert.match(
    page,
    /reseller-v2\/accounts\?account=/,
    "the replacement is not linked to the account it produced",
  );
});

test("no new colour tokens -- the replacement marks go through Badge tone", async () => {
  const page = await readFile(accountsPageUrl, "utf8");
  const helperStart = page.indexOf("function accountReplacementBadge");
  assert.ok(helperStart > 0);
  const helper = page.slice(helperStart, helperStart + 1200);

  // `design-tokens.test.mjs` will fail on an undeclared token, but it cannot see
  // that a tone was invented rather than chosen -- `tone: "replaced"` is a
  // string that compiles nowhere and renders as `is-replaced`, i.e. unstyled.
  const tones = [...helper.matchAll(/tone:\s*"([^"]+)"/g)].map((match) => match[1]);
  const allowed = new Set(["default", "success", "warning", "danger", "info", "muted"]);
  for (const tone of tones) {
    assert.ok(
      allowed.has(tone),
      `"${tone}" is not a Tone; Badge would render is-${tone} with no styles behind it`,
    );
  }
});
