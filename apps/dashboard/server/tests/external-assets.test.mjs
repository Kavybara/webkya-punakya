import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * No icon font is loaded from a CDN.
 *
 * There were two. Font Awesome had been linked for a long time with no `fa-`
 * class anywhere in the source -- pure cost, pure supply-chain surface.
 * Remixicon was actually used, across every legacy page, and was the reason a
 * render-blocking third-party stylesheet sat in the head of a page that renders
 * money and order state.
 *
 * Both are gone. Icons come from `lucide-react`, which is bundled, tree-shaken
 * to the glyphs actually imported, and served from our own origin.
 *
 * The first version of this test only failed when a font was linked *and* its
 * classes were used -- so the unused Font Awesome link passed, and then so did
 * the Remixicon link the moment its last caller was deleted. That is a test
 * that reports success precisely when there is nothing to report. The rule is
 * now absolute: none of these class prefixes may appear in the source, and none
 * of these packages may be linked.
 */

const INDEX = fs.readFileSync(path.resolve("index.html"), "utf8");

/** Icon font package name -> the class prefix its glyphs are written with. */
const CDN_ICON_FONTS = [
  { packageName: "font-awesome", marker: /\bfa[srlbd]?-[a-z]/ },
  { packageName: "remixicon", marker: /\bri-[a-z]/ },
];

function sourceText(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceText(full);
    return /\.(tsx|ts|css|html)$/.test(entry.name) ? [fs.readFileSync(full, "utf8")] : [];
  });
}

const SOURCE = sourceText(path.resolve("src")).join("\n");

function source(relativePath) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

test("no icon font is loaded from a CDN, and none of their classes survive", () => {
  for (const { packageName, marker } of CDN_ICON_FONTS) {
    assert.doesNotMatch(
      INDEX,
      new RegExp(`cdnjs[^"']*${packageName}`, "i"),
      `index.html links ${packageName} from a CDN -- icons come from lucide-react`,
    );
    assert.doesNotMatch(
      SOURCE,
      marker,
      `a ${packageName} class is back in src/; icons come from lucide-react, not a font CDN`,
    );
  }
});

test("a payment payload is never put in a URL to somebody else's server", () => {
  // Three surfaces built the QRIS code by asking a free third-party image API
  // to draw it:
  //
  //   https://api.qrserver.com/v1/create-qr-code/?...&data=${encodeURIComponent(payload)}
  //
  // `payload` is the live QRIS string -- the code a customer scans to hand over
  // money. In a query string it is now in that company's access logs, in any
  // cache between here and there, and in anything proxying the request. On the
  // public checkout it was the payment string of someone who had never logged
  // in.
  //
  // The code is drawn in the browser from `qrcode` instead, so nothing about a
  // payment leaves the machine that is about to scan it. This assertion is
  // deliberately absolute and covers comments too, so the pattern cannot come
  // back as a "just for this one case" special case.
  assert.doesNotMatch(
    SOURCE,
    /qrserver\.com/i,
    "a QR image API must not be handed a payment payload -- use lib/qrisQr.ts",
  );

  // And the replacement has to actually exist, or the assertion above would
  // pass on a page that simply stopped drawing a code.
  assert.match(SOURCE, /from "qrcode"/, "the local QR encoder is the sanctioned path");
});

test("a payment code is drawn locally, from one shared definition, everywhere", async () => {
  const [orders, checkout, topUp, encoder] = await Promise.all([
    source("src/pages/reseller-v2/orders/page.tsx"),
    source("src/pages/products/page.tsx"),
    source("src/components/reseller-v2/TopUpDialog.tsx"),
    source("src/lib/qrisQr.ts"),
  ]);

  // The provider returns the raw QRIS string and nothing to draw it with. Each
  // of these three screens used to resolve "what does this payment encode" on
  // its own, which is how three slightly different answers ended up on three
  // screens. One definition, called from all three.
  assert.match(encoder, /export function qrisPayloadFrom/, "one place decides what the code encodes");
  for (const [name, page] of [["orders", orders], ["checkout", checkout], ["top-up", topUp]]) {
    assert.match(page, /useQrisQr\(qrisPayloadFrom\(/, `${name} must draw from the shared payload`);
  }

  // A payment image fetched over the network is a payment image we neither
  // control nor vouch for. Nothing may prefer one over the local render, and
  // the field is off the type so reaching for one is a compile error.
  for (const [name, page] of [["orders", orders], ["checkout", checkout], ["top-up", topUp]]) {
    assert.doesNotMatch(page, /qrImageUrl/, `${name} must not prefer a remote payment image`);
  }

  // The fallback chain, in the one place it lives. `paymentUrl` is last on
  // purpose: it is a scannable code, but it is the provider's payment page
  // rather than the QRIS string proper.
  assert.match(encoder, /\[payment\.qrString, payment\.qrisText, payment\.paymentUrl\]/);
});

test("vendored CDN assets carry an integrity attribute", () => {
  // cdnjs is a third party we do not control, serving a render-blocking
  // stylesheet to a page that renders money and order state. If the CDN is
  // compromised, an unverified stylesheet is a hole straight into the page.
  //
  // Scoped to cdnjs on purpose. Google Fonts is excluded because its css2
  // response varies by user agent, so any fixed hash we published would
  // break the stylesheet for some visitors. Self-hosting the fonts is the
  // real fix and belongs with the design-system work, not here.
  const links = [...INDEX.matchAll(/<link\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>/g)];
  const unverified = links
    .map((match) => match[0])
    .filter((tag) => /cdnjs\.cloudflare\.com/.test(tag))
    .filter((tag) => !/integrity=/.test(tag))
    .map((tag) => tag.match(/href="([^"]+)"/)[1]);

  assert.deepEqual(unverified, [], `cdnjs asset without SRI: ${unverified.join(", ")}`);
});
