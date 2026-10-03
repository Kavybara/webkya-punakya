import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * "Retry delivery" reported a send that never happened as a successful send.
 *
 * The fulfilment guard refuses to re-send to a customer who already has the
 * credentials, and says so honestly:
 *
 *     if (result.order.whatsappNotificationStatus === "sent") {
 *       return { ...result, delivery: { sent: true, skipped: true } };
 *     }
 *
 * `sent: true` here means "the order is in a sent state", not "this call sent a
 * message" -- the `skipped: true` is what actually distinguishes them. The
 * endpoint passes that object through untouched (`order-routes.js:509-512`), and
 * the owner page discarded the response entirely, then set a fixed success
 * toast:
 *
 *     if (kind === "retry-delivery") await api.retryDelivery(order.id);
 *     ...
 *     setToast(`${actionText(kind).button} berhasil dijalankan.`);
 *
 * So clicking "Retry delivery" on an already-delivered order produced a green
 * "berhasil dijalankan" for a message that was not sent. On this screen that
 * is worse than a cosmetic bug: the owner's reason to press the button is to
 * make sure a customer received their credentials, and the confirmation tells
 * them the question is settled when it is not.
 *
 * Node 20 cannot import `.tsx`, so this is a source inspection -- the repo's
 * established convention for anything under `src/`.
 */
const ORDERS_PAGE = new URL("../../src/pages/owner-v2/orders/page.tsx", import.meta.url);
const API = new URL("../../src/lib/api.ts", import.meta.url);

function read(file) {
  return readFileSync(file, "utf8");
}

test("retryDelivery's response type carries the skip flag", () => {
  const api = read(API);
  const start = api.indexOf("retryDelivery(id: string)");
  assert.notEqual(start, -1, "api.retryDelivery is not defined");

  const signature = api.slice(start, api.indexOf("},", start));
  assert.match(
    signature,
    /skipped\??:\s*boolean/,
    "the response type drops `skipped`, so no caller can tell a skipped send from a real one",
  );
});

test("the owner page reads the skip flag instead of assuming success", () => {
  const page = read(ORDERS_PAGE);

  assert.match(
    page,
    /const result = await api\.retryDelivery\(order\.id\)/,
    "the response is discarded, so the skip flag can never reach the toast",
  );
  assert.match(
    page,
    /result\?\.delivery\?\.skipped/,
    "the owner page must ask whether the send was skipped rather than assuming it happened",
  );
});

test("a skipped retry says so instead of reporting success", () => {
  const page = read(ORDERS_PAGE);

  // The toast is the whole defect: it is what the owner reads as confirmation
  // that the customer has their credentials.
  assert.match(
    page,
    /deliverySkipped\s*\?\s*[\s\S]{0,160}?dilewati[\s\S]{0,160}?:\s*`\$\{actionText\(kind\)\.button\} berhasil dijalankan\.`/,
    "the success toast is unconditional, so a skipped send is still announced as delivered",
  );
  assert.match(
    page,
    /Pengiriman dilewati/,
    "a skipped retry needs to tell the owner plainly that nothing was sent",
  );
});

test("the server's skip flag and the page's read of it are the same fact", () => {
  const service = read(new URL("../services/fulfillment-notification-service.js", import.meta.url));

  assert.match(
    service,
    /delivery:\s*\{\s*sent:\s*true,\s*skipped:\s*true\s*\}/,
    "the fulfilment guard reports a skip as `sent: true, skipped: true`",
  );
  assert.match(
    read(ORDERS_PAGE),
    /delivery\?\.skipped/,
    "and the owner page reads exactly that field",
  );
});