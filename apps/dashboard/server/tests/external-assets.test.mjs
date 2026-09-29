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
