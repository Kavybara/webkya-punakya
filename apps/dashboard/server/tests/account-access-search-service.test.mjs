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

  assert.deepEqual(accountAccessMailboxPaths("signin", mailboxes), [
    "NF_SIGNIN",
    "[Gmail]/All Mail",
    "INBOX",
  ]);
});

test("search planning rejects malformed target addresses", () => {
  assert.deepEqual(accountAccessGmailQueries("verification", 'victim@example.com" OR newer_than:99d'), []);
  assert.deepEqual(accountAccessMailboxPaths("unknown", [{ path: "INBOX", specialUse: "\\Inbox" }]), []);
});
