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
  // There is nothing on cdnjs any more, which is the point: the only asset
  // linked from a CDN here was a font stylesheet, and it is now self-hosted.
  // The check stays so that adding one back is a deliberate act.
  const links = [...INDEX.matchAll(/<link\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>/g)];
  const unverified = links
    .map((match) => match[0])
    .filter((tag) => /cdnjs\.cloudflare\.com/.test(tag))
    .filter((tag) => !/integrity=/.test(tag))
    .map((tag) => tag.match(/href="([^"]+)"/)[1]);

  assert.deepEqual(unverified, [], `cdnjs asset without SRI: ${unverified.join(", ")}`);
});

test("the page loads no stylesheet or font from a host the CSP would block", () => {
  // The failure this catches happened silently and for a long time.
  // `index.html` linked Inter from `fonts.googleapis.com`; the policy in
  // `server/services/security-headers-service.js` reads `style-src 'self'
  // 'unsafe-inline'` and `font-src 'self' data:`, and names neither Google
  // host. The browser blocked the stylesheet, so every page in production
  // rendered in a system fallback while the whole design system was written
  // around a typeface nobody was seeing. A blocked third-party stylesheet is a
  // console line, not a build error -- nothing in the gate could see it.
  //
  // The rule is therefore not "the policy must list every host we use" -- a
  // policy with a third party in it is the thing worth avoiding -- it is "the
  // page may not depend on a host at all". Type is self-hosted, so the policy
  // stays exactly as tight as it was and the critical path is same-origin.
  assert.doesNotMatch(
    INDEX,
    /fonts\.(googleapis|gstatic)\.com/i,
    "index.html must not request a font from Google -- it is self-hosted, and the CSP would block it anyway",
  );

  // Only links that *load* something. `rel="canonical"` and the `og:url` are
  // absolute URLs by necessity -- they name the deployed origin rather than
  // fetching it -- and are not caught by the policy.
  const LOADING_REL = /rel="(?:stylesheet|preload|modulepreload|prefetch|preconnect|dns-prefetch|icon|apple-touch-icon|manifest)"/;
  const externalLinks = [...INDEX.matchAll(/<link\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => LOADING_REL.test(tag))
    .map((tag) => tag.match(/href="(https?:\/\/[^"]+)"/)?.[1])
    .filter(Boolean);

  assert.deepEqual(
    externalLinks,
    [],
    `the page must load nothing cross-origin; these would need the CSP widened: ${externalLinks.join(", ")}`,
  );
});

test("every self-hosted font the stylesheet declares is actually in public/", () => {
  // Self-hosting moves the failure from "the CDN was blocked" to "the file was
  // never committed", which is quieter still: the `@font-face` parses, the
  // browser requests a 404, and the fallback stack renders without a word.
  // Read off the stylesheet's own declarations rather than a hand-kept list,
  // so renaming a file in CSS cannot quietly desynchronise the test.
  const declared = [...SOURCE.matchAll(/url\(["']?(\/[^"')]+\.woff2?)["']?\)/g)].map((m) => m[1]);
  const unique = [...new Set(declared)];

  assert.ok(unique.length > 0, "expected at least one self-hosted @font-face in src/");

  const missing = unique.filter((url) => !fs.existsSync(path.resolve("public", url.replace(/^\//, ""))));
  assert.deepEqual(
    missing,
    [],
    `@font-face points at a file that is not in public/, so the browser silently falls back: ${missing.join(", ")}`,
  );
});
