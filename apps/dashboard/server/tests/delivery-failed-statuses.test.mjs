import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * "Delivery failed" was spelled out as an inline array list in four places, and
 * the four had drifted apart:
 *
 *   - analytics.ts buildAttentionQueue -> failed, needs_redelivery, abandoned
 *   - analytics.ts fulfillmentLabel    -> failed only
 *   - orders/page.tsx fulfillmentLabel -> failed, needs_redelivery
 *   - orders/page.tsx matchesStatus    -> failed, needs_redelivery
 *
 * `abandoned` is the status the fulfillment repair job writes once it has
 * retried 80 times and stopped (server/index.js). Nothing in the backend ever
 * selects it again -- the filter returns early on it -- so it is precisely the
 * order most in need of the owner. It was counted by the overview tile and
 * then unreachable from the page the tile links to.
 *
 * The fix was consolidation, not a fourth edit in lockstep: the list now lives
 * once in `lib/labels.ts` and every reader calls `deliveryFailed(order)`. The
 * assertions below used to pin the two surviving copies to be byte-identical,
 * which is the weakest thing you can say about a duplicated constant -- it
 * detects divergence after the fact and says nothing about intent. They now
 * assert there is exactly one declaration, anywhere, and that no page may
 * re-state the list.
 *
 * These assertions are source inspection because the label functions live in
 * `.tsx` files that Node 20 cannot import. The counts the owner actually sees
 * are checked by the existing analytics suite.
 */

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const labels = source("src/lib/labels.ts");
const analytics = source("src/pages/owner-v2/overview/analytics.ts");
const ordersPage = source("src/pages/owner-v2/orders/page.tsx");
const overviewPage = source("src/pages/owner-v2/page.tsx");
const resellerOrdersPage = source("src/pages/reseller-v2/orders/page.tsx");
const resellerOverviewPage = source("src/pages/reseller-v2/page.tsx");

const STATUS_FILES = [
  ["lib/labels.ts", labels],
  ["overview/analytics.ts", analytics],
  ["orders/page.tsx", ordersPage],
  ["owner-v2/page.tsx", overviewPage],
  ["reseller-v2/orders/page.tsx", resellerOrdersPage],
  ["reseller-v2/page.tsx", resellerOverviewPage],
];

/*
 * The whole point of the consolidation: one declaration, in one file. A second
 * copy is the drift this file was originally written to prevent, so its return
 * is now a hard failure rather than something to keep byte-aligned.
 */
test("the failed-delivery statuses are declared exactly once, in labels.ts", () => {
  assert.match(
    labels,
    /export const FAILED_DELIVERY_STATUSES = \["failed", "needs_redelivery", "abandoned"\]/,
    "labels.ts must declare the three statuses in one named constant",
  );

  for (const [name, contents] of STATUS_FILES) {
    if (name === "lib/labels.ts") continue;
    assert.equal(
      contents.match(/FAILED_DELIVERY_STATUSES\s*=/g)?.length ?? 0,
      0,
      `${name} re-declares the failed-delivery list; it must import labels.ts instead`,
    );
  }
});

test("every reader imports the shared constant instead of re-deriving it", () => {
  // analytics.ts reads the list directly; the page-level consumers are meant to
  // go through `deliveryFailed` so the "is this a failure" test has a name.
  assert.match(
    analytics,
    /import \{ FAILED_DELIVERY_STATUSES, isPaid \} from "\.\.\/\.\.\/\.\.\/lib\/labels"/,
    "analytics.ts must import the shared constant rather than declaring one",
  );
  assert.match(
    analytics,
    /const isLiveDeliveryFailure = \(order: ApiOrder\) => !isCancelled\(order\) && FAILED_DELIVERY_STATUSES\.includes/,
    "the attention tile's failure predicate no longer reads the shared constant",
  );

  for (const [name, contents] of [
    ["orders/page.tsx", ordersPage],
  ]) {
    assert.match(
      contents,
      /import \{[^}]*deliveryFailed[^}]*\} from "\.\.\/\.\.\/\.\.\/lib\/labels"/,
      `${name} must import the deliveryFailed predicate from labels.ts`,
    );
  }

  // `reseller-v2/page.tsx` asks only the combined question, so it imports
  // `orderStatus` and has no reason to import the predicate -- checked below.
  assert.match(
    resellerOverviewPage,
    /import \{ orderStatus \} from "\.\.\/\.\.\/lib\/labels"/,
    "the reseller overview must take its status from labels.ts rather than its own ladder",
  );

  assert.match(
    ordersPage,
    /if \(status === "delivery-failed"\) return deliveryFailed\(order\)/,
    "the 'Gagal kirim' filter no longer goes through the shared predicate",
  );
});

test("no status list is inlined into an .includes call anywhere", () => {
  // A literal reaching `.includes` directly is the drift vector. The constant's
  // own literal is fine; what must not exist is a second one used for matching.
  for (const [name, contents] of STATUS_FILES) {
    assert.deepEqual(
      [...contents.matchAll(/\["failed"[^\]]*\]\.includes/g)].map((match) => match[0]),
      [],
      `${name} inlines a failed-delivery list into an .includes call`,
    );
  }
});

/*
 * The repair job gives up permanently, so the owner has to be able to see and
 * act. Without the retry button an abandoned order would be counted as needing
 * attention with no route to resolve it, which is worse than not counting it.
 */
test("an abandoned order still gets a retry action in the order drawer", () => {
  // This used to be `fulfillmentLabel(selectedOrder) === "Gagal"`. That was a
  // label comparison: renaming "Gagal" to "Gagal kirim" for consistency with the
  // rest of the product would have silently removed the button, with no type
  // error and no failing test. It is a predicate now, so the rename cannot reach
  // it.
  assert.match(
    ordersPage,
    /deliveryFailed\(selectedOrder\)\s*\?\s*<button[\s\S]{0,200}retry-delivery/,
    "the retry button is no longer reachable for a failed delivery",
  );
  assert.doesNotMatch(
    ordersPage,
    /fulfillmentLabel\([^)]*\)\s*===/,
    "a page compares a status label to a string again, which a rename can silently break",
  );
});

/*
 * Cancelled orders must not become failures just because the list grew. The
 * tile excludes them explicitly; the page relies on orderStatus, which the
 * constant never touches. Pinned so a future edit that adds a status cannot
 * quietly let a cancelled order into the failure row.
 */
test("the failure list holds delivery statuses only, never order states", () => {
  const declared = /FAILED_DELIVERY_STATUSES = \[([^\]]*)\]/.exec(labels)?.[1] || "";
  const statuses = declared.split(",").map((item) => item.trim().replace(/^"|"$/g, "")).filter(Boolean);

  for (const status of statuses) {
    assert.equal(
      ["cancelled", "completed", "expired", "pending", "processing", "paid"].includes(status),
      false,
      `"${status}" is an order state, not a delivery status, and would double-count cancelled orders`,
    );
  }
  assert.deepEqual(statuses, ["failed", "needs_redelivery", "abandoned"]);
});