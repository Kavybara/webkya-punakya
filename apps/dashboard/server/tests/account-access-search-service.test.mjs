import test from "node:test";
import assert from "node:assert/strict";

import {
  accountAccessGmailQueries,
  accountAccessMailboxPaths,
} from "../services/account-access-search-service.js";

test("Gmail lookup falls back beyond the dedicated label", () => {
  const queries = accountAccessGmailQueries("signin", "emmachris@vya.baby");

  assert.match(queries[0], /label:NF_SIGNIN/);
  assert.match(queries[0], /to:"emmachris@vya\.baby"/);
  assert.equal(queries.some((query) => !query.includes("label:") && query.includes('"emmachris@vya.baby"')), true);
  assert.equal(queries.every((query) => query.includes("newer_than:2d")), true);
});

test("IMAP lookup checks the label, All Mail, and Inbox without duplicates", () => {
  const mailboxes = [
    { path: "INBOX", specialUse: "\\Inbox" },
    { path: "[Gmail]/All Mail", specialUse: "\\All" },
    { path: "NF_SIGNIN", specialUse: "" },
  ];

  assert.deepEqual(accountAccessMailboxPaths("signin", mailboxes).paths, [
    "NF_SIGNIN",
    "[Gmail]/All Mail",
    "INBOX",
  ]);
});

/**
 * The label case, which is the whole point.
 *
 * A label is a name the owner typed into Gmail, and Gmail does not promise to
 * return it the way it was typed -- a label created as `nf_verif` comes back
 * from IMAP as `nf_verif`. `getMailboxLock` is an exact-path lookup, so the
 * configured `NF_VERIF` threw, the throw was recorded, All Mail opened fine
 * anyway, and the lookup answered `not_found` for a message that was sitting in
 * the label. These cases are the ones that produced "the code is in Gmail but
 * the web says it is not".
 */
test("a label is opened under the name the server actually uses, whatever its case", () => {
  // Case only. `Nf_Verify` is a different name, not a differently-cased one,
  // and the next test is where that belongs.
  for (const realPath of ["nf_verif", "NF_VERIF", "nf_Verif", "NF_verif"]) {
    const mailboxes = [
      { path: "INBOX", specialUse: "\\Inbox" },
      { path: "[Gmail]/All Mail", specialUse: "\\All" },
      { path: realPath, specialUse: "" },
    ];
    const result = accountAccessMailboxPaths("verification", mailboxes);

    assert.equal(result.paths.includes(realPath), true, `${realPath} is not opened`);
    assert.equal(result.unresolved.length, 0, `${realPath} reported as unresolved`);
  }
});

test("every tool label resolves regardless of how the owner spelled it", () => {
  const expected = {
    signin: "nf_signin",
    verification: "nf_verif",
    reset: "nf_reset",
    household: "nf_house",
    disney_otp: "disney_code",
  };

  for (const [type, realPath] of Object.entries(expected)) {
    const result = accountAccessMailboxPaths(type, [
      { path: "INBOX", specialUse: "\\Inbox" },
      { path: realPath, specialUse: "" },
    ]);
    assert.equal(result.paths.includes(realPath), true, `${type} does not open ${realPath}`);
    assert.deepEqual(result.unresolved, [], `${type} reported as unresolved`);
  }
});

test("a label filed under a parent folder is still found", () => {
  const result = accountAccessMailboxPaths("verification", [
    { path: "INBOX", specialUse: "\\Inbox" },
    { path: "Kavya/NF_VERIF", specialUse: "", delimiter: "/" },
  ]);

  assert.equal(result.paths.includes("Kavya/NF_VERIF"), true);
  assert.deepEqual(result.unresolved, []);
});

/**
 * Matching is on whole path segments, never on a substring.
 *
 * A label genuinely named "verif" must not be opened by a lookup configured for
 * "NF_VERIF" -- the code would be read out of the wrong mailbox and reported as
 * a Netflix access code.
 */
test("a differently named label is not matched by a substring of it", () => {
  const result = accountAccessMailboxPaths("verification", [
    { path: "INBOX", specialUse: "\\Inbox" },
    { path: "OLD_NF_VERIF", specialUse: "" },
    { path: "verif", specialUse: "" },
    // A typo the owner made, not a case the owner chose. It is a different
    // label, and treating it as `NF_VERIF` would read a code out of whatever
    // mail happens to be filed there.
    { path: "Nf_Verify", specialUse: "" },
  ]);

  assert.equal(result.paths.includes("OLD_NF_VERIF"), false);
  assert.equal(result.paths.includes("verif"), false);
  assert.equal(result.paths.includes("Nf_Verify"), false);
  assert.deepEqual(result.unresolved, ["NF_VERIF"]);
});

/**
 * A label that genuinely does not exist is reported, not swallowed.
 *
 * Before the resolution, that case produced exactly the same `not_found` as a
 * label that opened fine and held no matching message. The reseller had no way
 * to tell an owner misconfiguration from a customer who never pressed send.
 */
test("a label the account does not have is named in the result", () => {
  const result = accountAccessMailboxPaths("disney_otp", [
    { path: "INBOX", specialUse: "\\Inbox" },
    { path: "[Gmail]/All Mail", specialUse: "\\All" },
  ]);

  assert.deepEqual(result.unresolved, ["DISNEY_CODE"]);
  // Still attempted, so the failure is recorded against a real attempt rather
  // than inferred from an empty list.
  assert.equal(result.paths.includes("DISNEY_CODE"), true);
});

test("a localised account is searched through its own inbox name", () => {
  const result = accountAccessMailboxPaths("signin", [
    { path: "Kotak Masuk", specialUse: "\\Inbox" },
    { path: "Semua Mail", specialUse: "\\All" },
    { path: "NF_SIGNIN", specialUse: "" },
  ]);

  assert.equal(result.paths.includes("Kotak Masuk"), true);
  assert.equal(result.paths.includes("Semua Mail"), true);
  assert.equal(result.paths.includes("INBOX"), false, "asking a localised account for INBOX is a guaranteed throw");
  assert.deepEqual(result.unresolved, []);
});

test("a failed listing falls back to the configured names rather than searching nothing", () => {
  // `client.list()` is allowed to fail. Returning an empty path list here would
  // turn a listing failure into a silent "no code", which is the ambiguity
  // this whole function exists to remove.
  const result = accountAccessMailboxPaths("verification", []);

  assert.equal(result.paths.includes("NF_VERIF"), true);
  assert.deepEqual(result.unresolved, [], "an unlisted account is not evidence of a missing label");
});

test("search planning rejects malformed target addresses", () => {
  assert.deepEqual(accountAccessGmailQueries("verification", 'victim@example.com" OR newer_than:99d'), []);
  assert.deepEqual(accountAccessMailboxPaths("unknown", [{ path: "INBOX", specialUse: "\\Inbox" }]).paths, []);
});
