/**
 * Drawing a QRIS code without asking anyone's permission.
 *
 * This had three implementations, all identical, and all of them built a URL to
 * a free third-party image API with the payload `encodeURIComponent`-ed into
 * the query string.
 *
 * `payload` is the live QRIS string for a real order -- the thing a customer
 * scans to hand you money. Putting it in the query string of a request to a
 * free third-party image API means that string is now in that company's access
 * logs, in anything caching the response, and in anything proxying the request
 * between here and there. On the reseller history page it leaked every pending
 * order's payment string. On the public checkout it leaked the payment string
 * of a customer who had never logged in.
 *
 * The code is drawn here instead. `qrcode` is already a dependency of this
 * monorepo (the bot uses it for terminal output) and it has a browser build
 * that returns a data URL, so the payload never leaves the tab, no request is
 * made, and nothing render-blocking is fetched from a third party.
 *
 * The data URL is a PNG, so it is bigger than an SVG would be. That is the
 * trade for keeping the payment string on the machine that is about to scan it.
 *
 * server/tests/external-assets.test.mjs asserts that no QR image API is named
 * anywhere in src/ -- including in comments, which is why this paragraph
 * describes the old URL rather than reproducing it.
 */

import type { ApiPayment } from "./api";
import QRCode from "qrcode";

/** The size the codes have always been drawn at, in pixels. */
const QR_SIZE = 260;

/** The quiet zone, in modules. The spec's minimum is 4. */
const QR_MARGIN = 2;

/**
 * The raw QRIS string for a payment -- the text a customer's phone camera
 * reads to hand over money.
 *
 * This is the only thing the payment provider gives us to draw. The provider
 * used to also hand back a URL for a pre-rendered picture of the same code; it
 * does not any more, and even when it did, a payment code fetched as an image
 * from somebody else's host is a payment code we do not control and cannot
 * vouch for. So there is one answer to "what does this payment encode", and it
 * is a string we hold.
 *
 * The field order is the fallback chain, most specific first:
 *
 *   1. `qrString`   -- the provider's own QRIS field
 *   2. `qrisText`   -- our normalised name for the same string
 *   3. `paymentUrl` -- not a QRIS string at all, but the provider's payment
 *                      page. Encoding a URL is a real scannable code, and it is
 *                      better than showing a customer nothing when the string
 *                      proper is missing.
 *
 * Every caller used to run this chain itself, which is how three slightly
 * different definitions of "the payload" ended up on three screens.
 */
export function qrisPayloadFrom(payment: ApiPayment | null | undefined): string {
  if (!payment) return "";
  const candidates = [payment.qrString, payment.qrisText, payment.paymentUrl];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }
  return "";
}

let cache = new Map<string, Promise<string>>();

/**
 * A data URL for the QR of `payload`, or an empty string when there is nothing
 * to encode.
 *
 * Memoised by payload: a reseller re-opening a payment, or the checkout
 * re-rendering while the dialog animates, should not re-encode the same string
 * on every frame.
 */
export function qrisQrDataUrl(payload: string | null | undefined): Promise<string> {
  const value = String(payload || "").trim();
  if (!value) return Promise.resolve("");

  const cached = cache.get(value);
  if (cached) return cached;

  const pending = QRCode.toDataURL(value, {
    width: QR_SIZE,
    margin: QR_MARGIN,
    errorCorrectionLevel: "M",
    // A QR is a black-and-white image. Letting the library emit colour options
    // is how a code ends up with a logo punched out of the middle of it, which
    // a phone camera will refuse to read at a payment counter.
    color: { dark: "#0f172a", light: "#ffffff" },
  }).catch(() => {
    // A payload the encoder rejects -- which is a bug, not a user error --
    // should leave the caller with no image and its own fallback, not an
    // unhandled rejection in the middle of a render.
    cache.delete(value);
    return "";
  });

  cache.set(value, pending);
  return pending;
}

/** Test seam: the cache is keyed by payload, which is long-lived by design. */
export function __clearQrCache() {
  cache = new Map();
}
