import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../src/", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

/**
 * Every page that renders a shell, found by walking the tree rather than by a
 * hand-written list.
 *
 * A list would be the failure mode this test exists to prevent: the day
 * somebody adds `owner-v2/reports/page.tsx`, a list does not notice, and the
 * new page renders a shell with no attention and no test failure. So the
 * inventory is derived, and the lists below are only ever used to explain what
 * the walk found.
 */
async function pageFilesUnder(relative) {
  const found = [];
  const entries = await readdir(new URL(relative, root), { withFileTypes: true });
  for (const entry of entries) {
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await pageFilesUnder(path)));
    else if (entry.name === "page.tsx") found.push(path);
  }
  return found;
}

const ownerPages = await pageFilesUnder("pages/owner-v2");
const resellerPages = await pageFilesUnder("pages/reseller-v2");

const attention = await source("components/attention/attention.ts");
const exempt = [...attention.matchAll(/"(pages\/[^"]+\/page\.tsx)"/g)].map((match) => match[1]);

const consoleShell = await source("components/console/ConsoleShell.tsx");
const resellerShell = await source("components/reseller-v2/ResellerShell.tsx");

test("the walk actually found both consoles, so an empty result cannot pass", () => {
  // Without this, a typo in the directory name would make every loop below
  // iterate over nothing and every assertion inside it vacuously true.
  assert.ok(ownerPages.length >= 14, `expected 14+ owner pages, walked ${ownerPages.length}`);
  assert.ok(resellerPages.length >= 8, `expected 8+ reseller pages, walked ${resellerPages.length}`);
});

test("no page passes a count and a state that come from different sources", async () => {
  // The two bugs this whole refactor was built on. Both pages passed a count
  // and a `systemState` derived from two different collections, so the pill
  // could read green beside "4 perlu perhatian" -- warranty counted open claims
  // while branching on failing ones, stock counted reserved rows while
  // branching on maintenance mode.
  //
  // `systemStateFor` exists to make the mistake unexpressible: the count and
  // the state now come from one argument. So this test does not check that the
  // numbers are equal -- it checks that the state is not a second, hand-written
  // derivation at all.
  const pages = [...ownerPages, ...resellerPages];
  const inline = pages.filter((path) => exempt.includes(path));

  for (const path of pages) {
    if (inline.includes(path)) continue;
    const text = await source(path);
    assert.doesNotMatch(
      text,
      /systemState=\{"[^}]*\?/,
      `${path} branches systemState inline. Use systemStateFor(count, { error, loading }) so the count and the colour cannot disagree.`,
    );
    assert.doesNotMatch(
      text,
      /systemState="(healthy|warning|unknown|loading)"/,
      `${path} hardcodes systemState. A literal here is a page asserting a system state it never measured.`,
    );
  }
});

test("every page that renders a shell states its attention, or is named as an exemption", async () => {
  const pages = [...ownerPages, ...resellerPages].filter((path) => !exempt.includes(path));

  for (const path of pages) {
    const text = await source(path);
    const shell = /<ConsoleShell|<ResellerShell/.test(text);
    assert.ok(shell, `${path} is in the page list but renders no shell -- update the inventory.`);
    assert.match(
      text,
      /attentionCount=\{[A-Za-z]/,
      `${path} renders a shell with no attentionCount. Either derive one, or add it to PAGES_WITHOUT_ATTENTION with a reason.`,
    );
    assert.match(
      text,
      /systemState=\{systemStateFor\(/,
      `${path} renders a shell without systemStateFor().`,
    );
  }
});

test("an exemption is a stated decision in the page, not a silent gap", async () => {
  assert.ok(exempt.length > 0, "PAGES_WITHOUT_ATTENTION parsed as empty -- the regex in this test is stale.");

  for (const path of exempt) {
    const text = await source(path);
    assert.doesNotMatch(
      text,
      /attentionCount|systemStateFor/,
      `${path} is listed as having no attention but computes some. Remove it from PAGES_WITHOUT_ATTENTION and wire it up.`,
    );
    assert.match(
      text,
      /PAGES_WITHOUT_ATTENTION/,
      `${path} is exempt but does not say why. Point the comment at PAGES_WITHOUT_ATTENTION so the reason lives next to the code it excuses.`,
    );
  }
});

test("neither shell invents a health state when a page does not pass one", async () => {
  // The prop default is the thing. `attentionCount = 0, systemState = "healthy"`
  // is what let four owner pages say "Operasional normal" while computing
  // nothing -- and it is what would have quietly papered over any page that
  // forgot to wire itself up. Both shells now render the pill conditionally.
  for (const [name, text] of [["ConsoleShell", consoleShell], ["ResellerShell", resellerShell]]) {
    assert.doesNotMatch(
      text,
      /systemState = "healthy"/,
      `${name} still defaults systemState to "healthy". That is a page claiming health it did not measure.`,
    );
    assert.match(
      text,
      /systemState \? \(/,
      `${name} must render the pill conditionally, so a page with nothing to say shows nothing rather than a green dot.`,
    );
  }
});

test("the pill's words and its markup exist in exactly one place", async () => {
  // Both consoles drew their own status pill from their own stylesheet. That is
  // not a duplication bug in the abstract -- it is why all seven reseller pages
  // showed no system state at all: `.console-status-pill` lived in `console.css`,
  // which only the owner console imports, so the rule that drew it was in the
  // other half of the product.
  const shellCss = await source("components/ui/shell.css");
  const consoleCss = await source("components/console/console.css");
  const resellerCss = await source("components/reseller-v2/reseller-v2.css");

  assert.match(shellCss, /\.ui-shell-status-pill/);
  assert.doesNotMatch(consoleCss, /\.console-status-pill/);
  assert.doesNotMatch(resellerCss, /status-pill/);

  for (const [name, text] of [["ConsoleShell", consoleShell], ["ResellerShell", resellerShell]]) {
    assert.match(text, /ui-shell-status-pill/, `${name} renders the shared pill class.`);
    assert.match(text, /systemStateLabel\(/, `${name} uses the shared label rather than its own ternary.`);
  }

  // No blur on the pill. The sticky console bars are opaque by design: a
  // `backdrop-filter` here was measured at 276.3ms p95 against 17.9ms opaque.
  const pillRule = shellCss.slice(shellCss.indexOf(".ui-shell-status-pill"));
  assert.doesNotMatch(
    pillRule.slice(0, pillRule.indexOf("}")),
    /backdrop-filter/,
    "The status pill is in the scrolling topbar. A blur there is per-frame work over the whole viewport.",
  );
});

test("the attention queue is no longer the owner console's alone", async () => {
  // The queue moved from `pages/owner-v2/overview/` into `components/attention/`
  // with console-free class names. If the old file comes back, the two copies
  // will drift and only the owner will see the change.
  //
  // The pre-move copy is deleted, and this asserts that rather than asserting
  // it is unimported. An unimported duplicate is not neutral: it still reads
  // as the real one to whoever opens `overview/` first, and the day somebody
  // imports it the queue is back in one console only.
  await assert.rejects(
    () => readFile(new URL("pages/owner-v2/overview/AttentionQueue.tsx", root)),
    "pages/owner-v2/overview/AttentionQueue.tsx is back. The shared queue lives in components/attention/ -- delete the copy.",
  );

  const queue = await source("components/attention/AttentionQueue.tsx");
  const queueCss = await source("components/attention/attention.css");
  // Comments are stripped before the CSS is checked. `console.css` still names
  // `.console-attention-list` in a comment explaining why that selector is
  // deliberately absent -- and a test that fails on its own explanation is a
  // test somebody will delete rather than satisfy.
  const consoleRules = (await source("components/console/console.css")).replace(/\/\*[\s\S]*?\*\//g, "");

  assert.doesNotMatch(queue, /console-(queue|attention)-/, "The queue must not carry console-prefixed classes.");
  assert.doesNotMatch(consoleRules, /\.console-attention-|\.console-queue-/, "Attention styling has moved out of console.css.");
  assert.match(queueCss, /\.attention-side/, "The kamu/sistem tag needs its own rule.");
});

test("the queue rows still say which of the two sides can fix them", async () => {
  const analytics = await source("pages/owner-v2/overview/analytics.ts");
  const start = analytics.indexOf("export function buildAttentionQueue");
  const end = analytics.indexOf("\nexport function", start + 10);
  const body = analytics.slice(start, end === -1 ? analytics.length : end);

  // Split on the row marker rather than trying to match `id` and `side` with a
  // bounded window. One row (stock-anomaly) carries a five-line comment between
  // the two fields, so a character budget either drops that row or swallows the
  // next one -- and a queue test that quietly checks 8 of 9 rows is worse than
  // no test, because it reads as coverage.
  const rows = body
    .split(/\n\s+id: "/)
    .slice(1)
    .map((chunk) => [chunk.slice(0, chunk.indexOf('"')), chunk]);

  assert.ok(rows.length >= 9, `expected 9 queue rows, matched ${rows.length}`);

  for (const [id, chunk] of rows) {
    const side = chunk.match(/\n {6}side: (.*),/);
    assert.ok(
      side,
      `Row "${id}" has no side. Every row must say whether the owner or the system can make it stop, or the split is decoration.`,
    );
    assert.match(
      side[1],
      /"you"|"system"|>=/,
      `Row "${id}" has a side that is neither "you" nor "system".`,
    );
  }

  // The stock row is the one that is genuinely two rows wearing a coat, so its
  // tag is derived from which half is larger rather than asserted. Calling it
  // "kamu" when most findings are the system disagreeing with itself would send
  // the owner to Sheets to look for a typo that is not there -- the exact
  // failure the split exists to prevent, reintroduced one level up.
  const stockRow = rows.find(([id]) => id === "stock-anomaly")?.[1] || "";
  assert.match(
    stockRow,
    /side:[\s\S]*highOwnerFixable[\s\S]*highSystemSide/,
    "The stock-anomaly row must derive its side by comparing owner-fixable against system-side findings.",
  );
});
