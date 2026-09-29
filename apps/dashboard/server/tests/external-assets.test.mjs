import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * index.html loads icon fonts from a third-party CDN, which makes them
 * render-blocking and hands a third party a say in how the app looks.
 * Font Awesome had been loaded that way for some time with no `fa-` class
 * anywhere in the source: pure cost, pure supply-chain surface.
 *
 * This checks the rule rather than the one instance, so a font cannot be
 * re-added without something actually using it.
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

test("no unused icon font is loaded from a CDN", () => {
  for (const { packageName, marker } of CDN_ICON_FONTS) {
    const linked = new RegExp(`cdnjs[^"']*${packageName}`, "i").test(INDEX);
    const used = marker.test(SOURCE);
    assert.equal(
      linked && used,
      used,
      `index.html loads ${packageName} from a CDN but no ${marker} class is used in src/`,
    );
  }
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
