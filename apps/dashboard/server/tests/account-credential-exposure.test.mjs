import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeFile = new URL("../routes/account-routes.js", import.meta.url);
const accountsPage = new URL("../../src/pages/owner-v2/accounts/page.tsx", import.meta.url);

/**
 * Every managed-account secret, in one place.
 *
 * The bug this pins was not that the owner could see a credential -- the owner
 * is the whole reason these records exist -- it was that a page which renders
 * none of them shipped all of them anyway. `GET /api/accounts` returned raw
 * rows and the owner branch had no redaction at all:
 *
 *     res.json(req.auth?.role === "reseller" ? accounts.map(redactExpiredAccountSecrets) : accounts);
 *
 * So every open of "Manajemen Akun" put every password, PIN, OTP and reset
 * link for every account into the browser -- DevTools, page cache, a careless
 * screenshot. Meanwhile the page told the reader the opposite:
 *
 *     "Password, PIN, OTP, reset link, dan household link tidak dimuat oleh
 *      overview endpoint dan tidak ditampilkan di form ini."
 *
 * The note was not merely optimistic, it was describing a `?view=overview`
 * parameter the server never read (`account-routes.js` ignores `req.query.view`
 * entirely). A promise of protection that no code enforced.
 *
 * The fix keeps the owner's access and stops the blanket delivery: the listing
 * carries identity and lifecycle only, and a secret arrives only when one
 * account is opened. `canvaLink` is on this list because a Canva pool link is
 * itself the credential -- handing over the pool is handing over every account
 * in it.
 */
const SECRET_FIELDS = [
  "password",
  "pin",
  "signInCode",
  "verificationCode",
  "resetLink",
  "householdLink",
  "otpEmail",
  "canvaLink",
];

async function routes() {
  return readFile(routeFile, "utf8");
}

/**
 * The listing handler, sliced out so the assertions cannot drift onto a neighbour.
 *
 * Ends at the credentials endpoint rather than the next `app.`, so the fix
 * adding that endpoint cannot be mistaken for the fix it was added alongside.
 */
function listingHandler(source) {
  const start = source.indexOf('app.get("/api/accounts",');
  assert.ok(start > 0, "GET /api/accounts is missing from the account routes");
  const end = source.indexOf('app.get("/api/accounts/:id/credentials"', start + 1);
  return source.slice(start, end > 0 ? end : start + 1200);
}

test("the account listing carries no credential, for anyone", async () => {
  const handler = listingHandler(await routes());

  // Every secret must go through the redaction, not merely be mentioned near
  // it. This is why the assertion is on the call, not on a field list: a
  // future field added to the account shape would otherwise slip past.
  assert.match(
    handler,
    /\.map\(redactListingSecrets\)|redactListingSecrets\(/,
    "the listing must redact secrets for every role, not only for resellers",
  );

  // And the owner must not be the exception any more. The role ternary may
  // stay -- a reseller additionally loses expired accounts' secrets -- but the
  // false branch, which is the owner, has to be redacted as well. So the
  // assertion is that `: accounts)` is immediately followed by the redact map.
  const flat = handler.replace(/\s+/g, " ");
  assert.match(
    flat,
    /: accounts\)\s*\.map\(redactListingSecrets\s*\)/,
    "the owner branch must be redacted too, not returned as-is",
  );
  assert.doesNotMatch(
    flat,
    /res\.json\(accounts\)/,
    "GET /api/accounts must not respond with the raw rows",
  );
});

test("the redaction covers every secret the account record can hold", async () => {
  const source = await routes();
  const fn = source.slice(
    source.indexOf("function redactListingSecrets"),
    source.indexOf("function redactExpiredAccountSecrets"),
  );
  assert.ok(fn.length > 0, "redactListingSecrets is missing");

  for (const field of SECRET_FIELDS) {
    assert.match(
      fn,
      new RegExp(`\\b${field}\\s*:\\s*""`),
      `redactListingSecrets must blank ${field}; a secret that ships in the listing is the bug this whole file exists to prevent`,
    );
  }

  // Identity survives, or the listing is useless: the owner has to be able to
  // tell the accounts apart. It survives by way of the `...account` spread --
  // this function removes fields, it does not rebuild the record -- so the
  // assertion is that it spreads rather than reconstructs.
  assert.match(fn, /\.\.\.account\b/, "the redactor must spread the record, so identity survives");
  assert.doesNotMatch(
    fn,
    /\bemail:\s*""/,
    "email is identity, not a secret -- blanking it would make the listing useless",
  );
  assert.doesNotMatch(fn, /\bloginPhone:\s*""/, "loginPhone is identity, not a secret");
});

test("a secret arrives only for one named account, and the read is recorded", async () => {
  const source = await routes();

  // A per-account endpoint, so opening the drawer can fetch what the row
  // deliberately did not carry.
  assert.match(
    source,
    /app\.get\(\s*["']\/api\/accounts\/:id\/credentials["']/,
    "there must be a way to fetch one account's credentials on demand",
  );

  const creds = source.slice(source.indexOf('/api/accounts/:id/credentials"'));
  const end = creds.indexOf("\n  app.", 1);
  const handler = end > 0 ? creds.slice(0, end) : creds;

  // Owner only. This is the whole point of keeping it off the listing.
  assert.match(
    handler,
    /requireAuth\(\[\s*["']owner["']\s*\]\)/,
    "credentials must be owner-only; a reseller already has a redacted listing",
  );

  // And whoever opened it, somebody has to be able to find out afterwards.
  assert.match(
    handler,
    /db\.activities/,
    "reading a credential must leave an activity entry naming who read it",
  );
});

test("the privacy note has to describe what the code does", async () => {
  const page = await readFile(accountsPage, "utf8");

  // The old note claimed the endpoint withheld secrets. It never did. A note
  // that describes an endpoint behaviour the endpoint does not have is worse
  // than no note, because it is relied on.
  assert.doesNotMatch(
    page,
    /tidak dimuat oleh overview endpoint/,
    "the endpoint never withheld secrets, so the note must stop claiming that it did",
  );

  // What it should say instead: the listing withholds them, on purpose.
  assert.match(
    page,
    /Password, PIN, OTP[^\n]*tidak ikut/,
    "the note must state that the listing does not carry credentials",
  );
});