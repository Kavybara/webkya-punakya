import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { transpileModule } from "typescript";

/*
 * `summariseRevenue` is the function behind the overview's money tiles, and it
 * had no behavioural test at all -- only source assertions elsewhere. Since
 * Node 20 cannot import `.ts`, both modules are transpiled at load time.
 *
 * Two files, because analytics.ts re-exports `attentionTotal` as a value, and
 * the compiled module resolves that specifier at runtime. Each is written under
 * a directory that keeps the same depth as its original, so the relative
 * `../../../components/attention` specifier still lands on the sibling that was
 * compiled next to it. The `lib/api` import is `import type`, so it is erased
 * and needs nothing.
 *
 * `lib/labels` is a third, for the same reason and not by choice: analytics.ts
 * no longer defines `isPaid` or `FAILED_DELIVERY_STATUSES` itself, it imports
 * them from the shared status vocabulary. That import is a value, so the
 * compiled analytics module resolves it at runtime and fails hard if the sibling
 * was not written. Both of labels.ts's own imports are `import type`, so it
 * transpiles to a leaf with nothing left to resolve.
 */
const sources = {
  analytics: "../../src/pages/owner-v2/overview/analytics.ts",
  attention: "../../src/components/attention/attention.ts",
  labels: "../../src/lib/labels.ts",
};

const outRoot = new URL("../.compiled-tests/", import.meta.url);
mkdirSync(outRoot, { recursive: true });
process.on("exit", () => rmSync(outRoot, { recursive: true, force: true }));

function compileTo(relativeSource, relativeOut) {
  const outFile = new URL(relativeOut, outRoot);
  mkdirSync(new URL(".", outFile), { recursive: true });
  const { outputText } = transpileModule(readFileSync(new URL(relativeSource, import.meta.url), "utf8"), {
    compilerOptions: { module: 99, target: 99 },
    fileName: "module.ts",
  });
  // Node's ESM resolver does not try extensions or index files, and the source
  // uses extensionless bundler-style specifiers. Every relative import in the
  // compiled output is therefore repointed at the .mjs file written beside it.
  // An import left unresolved here would be a hard failure, not a silent skip.
  const rewritten = outputText.replace(/from "(\.[^"]*)"/g, (match, specifier) => (
    specifier.endsWith(".mjs") ? match : `from "${specifier}.mjs"`
  ));
  writeFileSync(outFile, rewritten);
  return outFile;
}

compileTo(sources.attention, "src/components/attention.mjs");
compileTo(sources.labels, "src/lib/labels.mjs");
const compiledAnalytics = compileTo(sources.analytics, "src/pages/owner-v2/overview/analytics.mjs");

// `fileURLToPath`, not `.pathname`: the repo path has a space in it, which the
// URL form percent-encodes into a filename that does not exist.
const { summariseRevenue, buildAttentionQueue, buildRevenueSeries, isSmokeTest } = await import(pathToFileURL(fileURLToPath(compiledAnalytics)).href);

function order(overrides = {}) {
  return {
    id: "ORD1",
    qrisStatus: "paid",
    orderStatus: "completed",
    deliveryStatus: "sent",
    createdAt: "2026-10-02T09:00:00.000Z",
    total: 1000,
    ...overrides,
  };
}

// Fixed clock so "today" is deterministic regardless of when the suite runs.
const NOW = new Date("2026-10-02T12:00:00.000Z");

function summarise(orders) {
  const series = buildRevenueSeries(orders, 7, NOW);
  return summariseRevenue(series, orders);
}

/*
 * An order placed by a smoke-test reseller is created with `qrisStatus:
 * "pending"` and `excludeFromSalesMetrics: true` (server/routes/order-routes.js).
 * That is exactly the shape the pending filter accepted, so the owner's own test
 * orders were counted as customers waiting to pay -- sitting beside revenue
 * figures that had deliberately excluded them.
 */
test("an unpaid smoke-test order is not counted as a customer waiting to pay", () => {
  const real = order({ id: "ORD_REAL", qrisStatus: "pending", orderStatus: "pending" });
  const smoke = order({
    id: "ORD_SMOKE",
    qrisStatus: "pending",
    orderStatus: "pending",
    source: "owner_smoke_test",
  });

  const withBoth = summarise([real, smoke]);
  const withRealOnly = summarise([real]);

  assert.equal(withBoth.pending, 1, "the smoke test leaked into the pending count");
  assert.equal(withBoth.pending, withRealOnly.pending, "adding a smoke test changed a live number");
});

test("a smoke-test reseller's order is excluded from pending too", () => {
  const real = order({ id: "ORD_REAL", qrisStatus: "pending", orderStatus: "pending" });
  const smokeReseller = order({
    id: "ORD_SMOKE_RESELLER",
    qrisStatus: "pending",
    orderStatus: "pending",
    excludeFromSalesMetrics: true,
  });

  assert.equal(summarise([real, smokeReseller]).pending, 1);
});

/*
 * The three ways an order can be flagged as a test all have to work, because
 * the server writes all three: `isSmokeTest`/`source` for the owner's own smoke
 * test, `excludeFromSalesMetrics` for a smoke-test reseller's order.
 */
test("smoke tests stay excluded from today's counts and from revenue", () => {
  const paidSmoke = order({ id: "ORD_SMOKE", source: "owner_smoke_test", total: 99999 });
  const liveSmoke = order({ id: "ORD_SMOKE2", excludeFromSalesMetrics: true, total: 99999 });
  const real = order({ id: "ORD_REAL", total: 1000 });

  const withSmoke = summarise([real, paidSmoke, liveSmoke]);
  const realOnly = summarise([real]);

  assert.equal(withSmoke.week, realOnly.week, "a smoke test added revenue");
  assert.equal(withSmoke.weekOrders, realOnly.weekOrders, "a smoke test was counted as an order");
  assert.equal(withSmoke.todayOrders, realOnly.todayOrders, "a smoke test was counted as today's order");
});

test("a pending smoke test does not offset the today's pending figure either", () => {
  const real = order({ id: "ORD_REAL", qrisStatus: "pending", orderStatus: "pending" });
  const smoke = order({
    id: "ORD_SMOKE",
    qrisStatus: "pending",
    orderStatus: "pending",
    source: "owner_smoke_test",
  });

  const withBoth = summarise([real, smoke]);
  assert.equal(withBoth.todayOrders, 1);
  assert.equal(withBoth.todayPaid, 0);
  assert.equal(withBoth.todayPending, 1, "the smoke test was counted as today's unpaid order");
});

/*
 * The negative direction matters as much as the positive one: an order that is
 * genuinely pending must still be counted, or the fix would be to simply drop
 * every pending order and the tile would read 0 while customers waited.
 */
test("real unpaid orders are still counted", () => {
  const pending = [
    order({ id: "A", qrisStatus: "pending", orderStatus: "pending" }),
    order({ id: "B", qrisStatus: "pending", orderStatus: "pending" }),
  ];

  assert.equal(summarise(pending).pending, 2);
});

/*
 * `isSmokeTest` is the predicate all of this rests on, so it is pinned directly.
 * A weaker check here would let every exclusion above quietly stop working.
 */
test("the smoke-test predicate covers all three markers the server writes", () => {
  assert.equal(isSmokeTest(order({ source: "owner_smoke_test" })), true);
  assert.equal(isSmokeTest(order({ isSmokeTest: true })), true);
  assert.equal(isSmokeTest(order({ excludeFromSalesMetrics: true })), true);
  assert.equal(isSmokeTest(order({ source: "OWNER_SMOKE_TEST" })), true, "the check is case-sensitive");
  assert.equal(isSmokeTest(order({})), false, "a normal order was treated as a smoke test");
});

/*
 * `failed` was removed from the summary: nothing read it, and it counted only
 * `deliveryStatus === "failed"`, so it would have disagreed with the attention
 * tile on two of the three failure statuses. Its absence is asserted so a
 * future change cannot reintroduce a second, disagreeing failure count.
 */
test("the summary exposes no separate failure count to drift from the attention tile", () => {
  const summary = summarise([order({ id: "X", deliveryStatus: "abandoned", orderStatus: "processing" })]);
  assert.equal(summary.failed, undefined, "a second failure count came back");

  // The tile is the only place a failure is counted, and it sees all three.
  const tile = buildAttentionQueue([order({ id: "X", deliveryStatus: "abandoned", orderStatus: "processing" })], null, NOW);
  const failed = tile.find((item) => item.id === "delivery-failed");
  assert.equal(failed.count, 1);
});