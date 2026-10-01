import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

const [server, accessPage, apiTypes] = await Promise.all([
  source("server/index.js"),
  source("src/pages/reseller-v2/access/page.tsx"),
  source("src/lib/api.ts"),
]);

/**
 * "No code in the mailbox" and "the code is in the mailbox, 40 minutes old" are
 * different problems with opposite remedies, and the lookup used to return the
 * same `not_found` for both. The reseller was told the email had not arrived
 * while it sat in `NF_VERIF` the whole time -- the worst of the two answers,
 * because it teaches the customer to trigger the email again and teaches the
 * operator nothing about the window.
 *
 * These are source assertions because the behaviour lives in `index.js`, which
 * starts a server on import. What is asserted here is the wiring: that the
 * rejected messages are kept, that both lookup paths consult the reporter, and
 * that the panel has a branch that can render it. The reporter's own decision --
 * running the *same* extractor the fresh path runs -- is what makes a stale
 * result trustworthy, and it is the part that would silently rot if it were
 * reduced to a `reason: "stale"` string.
 */
test("aged-out messages are kept and reported instead of being dropped as not found", () => {
  // Both engines keep what they reject. IMAP is the one that runs in
  // production (`gmailLookupMode` picks IMAP whenever it is configured), so a
  // fix applied to only the Gmail path would change nothing for anybody.
  assert.match(server, /staleMessages\.push\(\{ message, dateMs \}\)/);
  assert.match(server, /staleMessages\.push\(\{ message, dateMs, mailbox \}\)/);

  assert.match(server, /const stale = await staleAccessResult\(type, staleMessages, nowMs, account\)/);
  assert.match(server, /const stale = await staleAccessResult\(type, staleMessages, nowMs, account, \{ mode: "imap" \}\)/);

  // And each lookup asks before falling through to its own "nothing here".
  assert.match(server, /if \(stale\) return stale;[\s\S]{0,120}?if \(gmailImapConfigured\(db\) && mode !== "imap"\)/);
  assert.match(server, /if \(stale\) return stale;[\s\S]{0,200}?mailboxErrors/);
});

test("a stale result is only reported when the extractor would have returned it", () => {
  // Without this, any old Netflix email in the label -- a twelve-month-old
  // marketing mail, a password reset from last year -- reads as "your code
  // expired", which is a worse lie than the one it replaced.
  assert.match(server, /const extracted = await extractAccessValue\(type, item\.message, account\);/);
  assert.match(server, /if \(!extracted\?\.value\) continue;/);

  // The three newest, not the three the walk happened to reach first.
  assert.match(server, /\.slice\(0, STALE_ACCESS_CANDIDATES\)/);
  // One Netflix email lives in the label, in All Mail, and in the inbox at
  // once. Without dedup the budget is spent on a single message.
  assert.match(server, /const seen = new Set\(\);/);
});

test("the stale result carries the age and the window, so the panel can say both", () => {
  assert.match(server, /reason: "stale"/);
  assert.match(server, /ageMinutes: Math\.max\(1, Math\.round\(ageMs \/ 60000\)\)/);
  assert.match(server, /windowMinutes: Math\.round\(accountAccessMaxAgeMs\(type\) \/ 60000\)/);
  assert.match(apiTypes, /staleMessage\?: \{/);
  assert.match(apiTypes, /ageMinutes: number;/);
  assert.match(apiTypes, /windowMinutes: number;/);
});

/**
 * The half that actually reaches the reseller.
 *
 * `reason: "stale"` used to fall through to `sourceText()`, which answers
 * "Belum ditemukan di label Gmail owner" -- the exact sentence the change
 * exists to stop saying. This asserts the branch is wired to the payload, and
 * that the remedy is in the copy: the answer is "ask for a new one", not
 * "keep waiting".
 */
test("the reseller panel explains an expired code instead of a missing one", () => {
  assert.match(accessPage, /function staleNotice/);
  assert.match(accessPage, /if \(!stale\) return null;/);
  assert.match(accessPage, /stale\?\.description \|\| lookupResult\.result\.error/);
  assert.match(accessPage, /title=\{stale\?\.title \|\| \(lookupResult\.result\.error/);

  // The remedy, stated plainly enough that nobody reads past it.
  assert.match(accessPage, /minta pelanggan mengirim ulang kode/i);

  // The old wording must not come back as the stale branch's fallback.
  assert.doesNotMatch(accessPage, /title=\{emptyText\(lookupResult\.type\)\}/, "the stale branch bypasses emptyText entirely");
  // And stale outranks the error title: an aged-out code is not a failed lookup.
  assert.match(accessPage, /title=\{stale\?\.title \|\| \(/);
});

/**
 * `label_unresolved` is the other new reason, and it is aimed at the owner, not
 * the reseller.
 *
 * Before the paths were resolved against the server's own listing, a label
 * spelled differently than configured threw, the throw was recorded, and All
 * Mail opened fine -- so the "every mailbox failed" test never fired and the
 * cause came back as `not_found`, identical to a customer who never pressed
 * send. Now it is named, and it needs a title that does not claim there is no
 * code when the truth is that the code was never looked for.
 */
test("an unresolvable label is reported by name rather than as a missing code", () => {
  assert.match(server, /reason: "label_unresolved"/);
  assert.match(server, /unresolvedLabels\.join\(", "\)/);
  assert.match(server, /tidak ditemukan di Gmail owner/);

  // The empty state has to agree with it: "Belum ada sign-in code" on top of
  // "the label does not exist" is two contradictory claims about one lookup.
  assert.match(accessPage, /lookupResult\.result\.error \? "Lookup tidak bisa diselesaikan" : emptyText/);
});
