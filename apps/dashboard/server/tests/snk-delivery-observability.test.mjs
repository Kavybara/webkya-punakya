import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * A customer can be left holding half a delivery, and the owner cannot see it.
 *
 * An S&K order fulfils in two legs: the account itself, then the S&K credential
 * as a separate message (fulfillment-notification-service.js:138-147). The two
 * are sent independently and can fail independently, and the statuses are
 * recorded separately and correctly:
 *
 *     result.order.whatsappNotificationStatus     = accountDelivery.sent ? "sent" : "failed";
 *     result.order.whatsappSnkNotificationStatus = snkDelivery.sent ? "sent" : ... : "failed";
 *
 * The account status has readers. The S&K status had none -- a repo-wide search
 * for `whatsappSnkNotificationStatus` returns only the three lines that write it.
 *
 * So the failure mode is concrete: the bot is down for forty seconds while a
 * paid order fulfils. The account leg goes out, the S&K leg does not. The order
 * reads `whatsappNotificationStatus: "sent"`, the owner's dashboard shows the
 * order delivered, no retry is scheduled, and nothing anywhere records that the
 * customer never received the half that matters. The record of the error exists
 * (`whatsappSnkNotificationError`) and is equally unread.
 *
 * The three assertions below are the minimum for this to be recoverable by a
 * human: the status has to reach the attention queue, the error string has to
 * travel with it, and a failed leg must be visible without opening every order.
 *
 * Source-inspected, for the same reason as the rest of this suite: booting the
 * API writes the real database.
 */
const SERVICE = new URL("../services/fulfillment-notification-service.js", import.meta.url);
const INDEX = new URL("../index.js", import.meta.url);

function read(file) {
  return readFileSync(file, "utf8");
}

test("the S&K leg failure is recorded as a failure, not silently dropped", () => {
  const service = read(SERVICE);

  // The write side is already right; this pins it so a future refactor that
  // collapses the two legs into one status does not quietly restore the bug.
  assert.match(
    service,
    /whatsappSnkNotificationStatus\s*=\s*snkDelivery\.sent\s*\?\s*"sent"/,
    "the S&K outcome must be tracked separately from the account outcome, because they fail independently",
  );
  assert.match(
    service,
    /whatsappSnkNotificationError/,
    "a failed S&K send must record why, not just that it failed",
  );
});

test("a failed S&K leg becomes something the owner can see", () => {
  // The defect was not that the write was missing -- it was that nothing ever
  // read it. So the assertion is on a reader existing, in the same place that
  // every other order-level problem is surfaced: the attention queue.
  const index = read(INDEX);
  assert.match(
    index,
    /whatsappSnkNotificationStatus/,
    "whatsappSnkNotificationStatus is written and read by nothing, so a customer can miss half a delivery with no trace",
  );
  assert.match(
    index,
    /whatsappSnkNotificationError/,
    "the recorded failure reason never reaches the owner, so even a manual check cannot tell what went wrong",
  );
});

test("the S&K failure is reported per order, as a high-severity queue item", () => {
  const index = read(INDEX);

  // Scoped to the one queue item rather than matching the file loosely: the
  // order of keys inside the object literal is not the property under test,
  // only the shape of the item and the severity it carries.
  const start = index.indexOf("delivery-snk-failed-");
  assert.notEqual(start, -1, "the S&K failure does not produce its own queue item");
  const item = index.slice(start, index.indexOf("});", start));

  assert.match(
    item,
    /severity:\s*"high"/,
    "a customer holding an account with no ownership proof is a high-severity problem, not a medium one",
  );
  assert.match(
    item,
    /kind:\s*"notification"/,
    "the queue item needs its own kind so a half-delivery is countable apart from a failed account message",
  );
  assert.match(
    item,
    /orderId:\s*order\.id/,
    "the item must link back to the order, or the owner cannot act on it",
  );
  assert.match(
    item,
    /whatsappSnkNotificationError/,
    "the recorded reason must travel with the queue item, not just the fact of failure",
  );

  // And it has to be a separate item from the account-message failure, not a
  // second condition on the existing one: the two legs fail independently and
  // need different checks.
  const accountItemStart = index.indexOf("delivery-wa-failed-");
  assert.notEqual(accountItemStart, -1);
  assert.equal(
    accountItemStart === start,
    false,
    "the account-message item and the S&K item are the same item, so a half-delivery is indistinguishable from a total failure",
  );
});