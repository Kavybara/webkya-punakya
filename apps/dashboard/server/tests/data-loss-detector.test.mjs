import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { databaseLossMessage, detectDatabaseLoss } from "../services/data-loss-detector.js";

/**
 * A lost database must not look like a healthy one.
 *
 * `store.js` answers a missing `kavya-db.json` with `defaultData`, so a total
 * loss produces a site that loads, logs in, and shows an empty reseller table
 * with no error anywhere. The owner has no way to tell that apart from "I have
 * no resellers yet" by looking at the page -- so the server has to tell them.
 *
 * What makes this detectable without guessing: orders and payments live only in
 * `kavya-db.json`. Sheets rebuilds stock and managed accounts, so those prove
 * nothing. Every order carries a `resellerId`, so "orders but no resellers" is
 * a state normal operation cannot reach.
 */

test("a database with resellers is never reported as lost", () => {
  const result = detectDatabaseLoss({
    resellers: [{ id: "res-1" }, { id: "res-2" }],
    orders: [{ id: "o1", resellerId: "res-1" }],
    payments: [{ ref: "p1" }],
  });
  assert.equal(result.lost, false);
  assert.equal(result.reason, "resellers_present");
  assert.equal(result.resellerCount, 2);
});

test("a fresh install is not reported as lost", () => {
  // The false-positive that matters most: a brand-new database is legitimately
  // empty, and alarming about it would teach the owner to ignore the alarm.
  const result = detectDatabaseLoss({ resellers: [], orders: [], payments: [] });
  assert.equal(result.lost, false);
  assert.equal(result.reason, "no_evidence_of_loss");
});

test("orders referencing a missing reseller are reported as a loss", () => {
  const result = detectDatabaseLoss({
    resellers: [],
    orders: [
      { id: "o1", resellerId: "res-gone" },
      { id: "o2", resellerId: "res-gone" },
    ],
    payments: [],
  });
  assert.equal(result.lost, true);
  assert.equal(result.reason, "orders_reference_missing_resellers");
  assert.equal(result.orphanedOrderCount, 2);
  assert.equal(result.orderCount, 2);
});

test("payments surviving without resellers are reported as a loss", () => {
  // Orders can be pruned by retention while payments remain, so this case has
  // to stand on its own rather than relying on the order check above.
  const result = detectDatabaseLoss({ resellers: [], orders: [], payments: [{ ref: "p1" }] });
  assert.equal(result.lost, true);
  assert.equal(result.reason, "payments_without_resellers");
  assert.equal(result.paymentCount, 1);
});

test("stock and managed accounts alone never imply a loss", () => {
  // Both are rebuilt by the Sheets sync, so their presence after a total loss
  // is expected -- treating it as evidence would fire on a healthy restore.
  const result = detectDatabaseLoss({
    resellers: [],
    orders: [],
    payments: [],
    stock: [{ id: "s1" }, { id: "s2" }],
    managedAccounts: [{ id: "m1" }],
  });
  assert.equal(result.lost, false, "Sheets rebuilds stock and accounts, so they are not evidence of a healthy database");
  assert.equal(result.reason, "no_evidence_of_loss");
});

test("owner-placed orders without a resellerId do not imply a loss", () => {
  // Owner orders legitimately carry an empty resellerId. Treating those as
  // orphaned would raise the alarm on a healthy database with only owner sales.
  const result = detectDatabaseLoss({
    resellers: [],
    orders: [{ id: "o1", resellerId: "" }, { id: "o2" }],
    payments: [],
  });
  assert.equal(result.lost, false);
  assert.equal(result.reason, "no_evidence_of_loss");
});

test("a missing db shape does not throw", () => {
  // store.js can hand over a partial object; the detector must not be the
  // thing that crashes the owner console.
  for (const input of [{}, { resellers: null }, { orders: "nope" }, undefined]) {
    assert.doesNotThrow(() => detectDatabaseLoss(input), `detectDatabaseLoss(${JSON.stringify(input)}) threw`);
    assert.equal(detectDatabaseLoss(input).lost, false);
  }
});

test("no message is produced unless a loss was detected", () => {
  assert.equal(databaseLossMessage(detectDatabaseLoss({ resellers: [], orders: [], payments: [] })), "");
  assert.equal(databaseLossMessage({ lost: false }), "");
});

test("the message names the only path that actually restores resellers", () => {
  // docs/RESTORE.md tells the owner the reseller list rebuilds itself from
  // Sheets. It does not -- `syncDataResellersToGoogleSheets` reads db.resellers
  // and writes outward. Pointing the owner at that button would send them in a
  // circle, so the message has to name the backup instead.
  const message = databaseLossMessage(
    detectDatabaseLoss({ resellers: [], orders: [{ id: "o1", resellerId: "res-gone" }], payments: [] }),
  );
  assert.match(message, /kavya-db\.json/, "the message must name the file to restore");
  assert.match(message, /RESTORE\.md/, "the message must point at the runbook");
  assert.doesNotMatch(
    message,
    /Syncronkan Data Reseller/i,
    "the message must not send the owner to a button that reads an empty list and writes nothing back",
  );
});

test("the message tells the owner not to recreate resellers by hand", () => {
  // Creating a fresh reseller over a merely-unrestored database destroys the
  // only copy of that record. This is the most expensive wrong move available
  // here, so it gets its own assertion.
  const message = databaseLossMessage(detectDatabaseLoss({ resellers: [], orders: [], payments: [{ ref: "p1" }] }));
  assert.match(message, /Jangan buat akun reseller baru dulu/i);
});

test("the orphaned-order count is reported to the owner", () => {
  // The number is what makes the warning concrete: it proves the database is
  // internally inconsistent rather than merely new.
  const message = databaseLossMessage(
    detectDatabaseLoss({
      resellers: [],
      orders: [{ id: "o1", resellerId: "gone" }, { id: "o2", resellerId: "gone" }, { id: "o3", resellerId: "gone" }],
      payments: [],
    }),
  );
  assert.match(message, /3 order/, "the owner should be told how much is inconsistent");
});

test("the health endpoint reports the assessment instead of guessing", () => {
  // `runPakasirPaymentSyncJob` and the sheets sync cannot be reached without
  // booting the server, so this is a source inspection -- the same convention
  // the rest of this suite uses for route wiring.
  const source = readFileSync(new URL("../routes/system-routes.js", import.meta.url), "utf8");

  assert.match(source, /detectDatabaseLoss\(/, "the health endpoint never runs the loss detector");
  assert.match(source, /databaseLossMessage\(/, "the endpoint reports a flag with no owner-facing wording");
  assert.match(source, /databaseLoss/, "the assessment is not exposed in the response body");
});
