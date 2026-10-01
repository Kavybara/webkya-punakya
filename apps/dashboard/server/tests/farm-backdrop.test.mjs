import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * The farm backdrop is a 3.7MB video that the router mounts on some routes
 * and not others.
 *
 * The split is a judgement, not a technical limit, which is exactly why it
 * needs a test. Somebody tidying the route list -- or copying the public
 * prefixes into a new page's list -- can add `/owner-v2` or `/reseller-v2`
 * without noticing that the line above them reads "PUBLIC_PREFIXES", and the
 * result is a table of order IDs and QRIS statuses with a pixel-art farm
 * animating behind it. That is not a crash and not a warning; it just looks
 * wrong, and it costs every console visitor the download.
 *
 * The two assertions that matter are therefore both negative: the console
 * prefixes are absent, and the one route that has to match exactly is "/".
 */

const router = await readFile(
  new URL("../../src/router/index.tsx", import.meta.url),
  "utf8",
);

/** The `PUBLIC_PREFIXES` array, read out of the source. */
function declaredPrefixes() {
  const block = router.match(/PUBLIC_PREFIXES\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(block, "router/index.tsx no longer declares PUBLIC_PREFIXES");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

test("the farm plays on the public pages and nowhere else", () => {
  const prefixes = declaredPrefixes();

  // The pages a visitor reaches without an account. `/store` and
  // `/track-order` are the legacy spellings `/harga` and `/order-tracking`
  // redirect away from, and `/masuk` and `/daftar` are the Indonesian paths
  // the auth pages also answer to.
  for (const path of [
    "/",
    "/harga",
    "/login",
    "/register",
    "/forgot-password",
    "/order-tracking",
  ]) {
    assert.ok(prefixes.includes(path), `${path} lost the farm backdrop`);
  }

  // And the ones that must never gain it. The reseller and owner panels are
  // dense tables the owner scans in a hurry; `/products` is a checkout form.
  //
  // The `"/"` exclusion is not a detail of the assertion, it is the assertion:
  // the bare entry matches only exactly (which the next test pins), so it must
  // be excluded here or every path on earth would "match" it.
  for (const path of ["/owner-v2", "/reseller-v2", "/products", "/order", "/katalog"]) {
    assert.ok(
      !prefixes.some((prefix) => prefix !== "/" && (path === prefix || path.startsWith(prefix))),
      `${path} would play the farm backdrop`,
    );
  }
});

test("'/' is matched exactly, never as a prefix", () => {
  // The bug this guards is subtle and total. "/" is a prefix of every path in
  // the product, so a plain `startsWith` would put the video on every route
  // including both consoles -- while still looking correct, because the public
  // pages would be the pages that have it.
  const fn = router.match(/function hasFarmBackdrop[\s\S]*?\n}/);
  assert.ok(fn, "router/index.tsx no longer defines hasFarmBackdrop");
  assert.match(
    fn[0],
    /if \(pathname === "\/"\) return true;[\s\S]*?prefix !== "\//,
    "hasFarmBackdrop no longer excludes the bare '/' entry from the prefix scan",
  );
});

test("the backdrop is mounted, not rendered by each page", async () => {
  // Mounted in the router rather than inside each page, so that moving from /
  // to /harga keeps the same <video> element and does not restart the clip.
  // The cost of that is one invariant: a page must not also mount its own,
  // or the public pages get two videos and two 3.7MB downloads.
  assert.match(router, /hasFarmBackdrop\(location\.pathname\) \? <FarmVideoBackdrop \/> : null/);

  const pages = await Promise.all(
    ["home/page.tsx", "pricelist/page.tsx", "login/page.tsx", "register/page.tsx"].map(
      (path) => readFile(new URL(`../../src/pages/${path}`, import.meta.url), "utf8"),
    ),
  );
  for (const [index, markup] of pages.entries()) {
    assert.doesNotMatch(
      markup,
      /FarmVideoBackdrop/,
      `page ${index} mounts its own backdrop as well as the router's`,
    );
  }
});

test("a full-bleed surface does not paint the canvas over the video", async () => {
  // `body`'s own background is painted above every negatively-stacked
  // descendant, so an opaque `--bg-canvas` on body or on a full-viewport
  // surface hides the video completely. This happened: the video mounted,
  // decoded, autoplayed, and reported `paused === false` while being
  // invisible behind an opaque sheet. Nothing errors in that state, so the
  // only way to catch a regression is to read the declarations.
  const index = await readFile(new URL("../../src/index.css", import.meta.url), "utf8");
  const body = index.match(/\nbody\s*\{([^}]*)\}/);
  assert.ok(body, "index.css no longer has a body rule");
  assert.doesNotMatch(
    body[1],
    /background:\s*var\(--bg-canvas\)/,
    "body paints the canvas, which would cover the video",
  );

  for (const path of [
    "src/components/auth/auth.css",
    "src/pages/pricelist/page.tsx",
    "src/pages/home/page.tsx",
  ]) {
    const text = await readFile(new URL(`../../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(
      text,
      /bg-\[var\(--bg-canvas\)\]/,
      `${path} fills the viewport with the canvas, which would cover the video`,
    );
  }
});

/**
 * `preload="none"` is not a download policy on its own.
 *
 * The attribute said the visitor should not pay 3.8MB for footage they might
 * scroll past, and the comment said so in as many words -- while the effect
 * called `video.play()` on mount, which is an explicit request to start
 * fetching. The browser honoured the request and ignored the attribute, so
 * every visitor downloaded the video during first paint, which is what made
 * `/harga` feel heavy: the page was competing with a video decode for the main
 * thread before the catalogue had rendered.
 *
 * Both halves are asserted. Fixing only the effect (dropping `preload`) would
 * leave the attribute as decoration; fixing only the attribute (removing the
 * eager play) would leave the same download, just later and uncommented.
 */
test("the video is not asked to play until the browser is idle", async () => {
  const backdrop = await readFile(
    new URL("../../src/components/feature/FarmVideoBackdrop.tsx", import.meta.url),
    "utf8",
  );

  assert.match(backdrop, /requestIdleCallback/);
  assert.match(backdrop, /setTimeout/);
  assert.match(backdrop, /preload="none"/);

  // The hand-off has to be inside the idle callback, not merely mentioned by
  // it -- an idle callback that only sets state still plays on mount.
  const idleBlock = backdrop.match(/requestIdleCallback\(start[^)]*\)/);
  assert.ok(idleBlock, "the idle callback no longer defers `start`");
  assert.match(backdrop, /const start = \(\) => \{[\s\S]*?video\.play\(\)/);

  // And the cleanup has to cancel, or navigating away mid-idle plays a video
  // for a page that is no longer on screen.
  assert.match(backdrop, /cancelIdleCallback/);
  assert.match(backdrop, /clearTimeout/);
});
