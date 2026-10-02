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
 * These assertions are source inspection because the label functions live in
 * `.tsx` files that Node 20 cannot import. This file's job is to stop the four
 * lists from drifting apart again; the counts the owner actually sees are
 * checked by the existing analytics suite.
 */

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const analytics = source("src/pages/owner-v2/overview/analytics.ts");
const ordersPage = source("src/pages/owner-v2/orders/page.tsx");

/*
 * Each file must list the statuses once, in a named constant, and every
 * predicate must read that constant. A fourth inline list reintroduces exactly
 * the drift this file exists to prevent, so the constant is required rather
 * than merely preferred.
 */
test("the failed-delivery statuses are declared once per file, not inlined", () => {
  for (const [name, contents] of [["analytics.ts", analytics], ["orders/page.tsx", ordersPage]]) {
    assert.match(
      contents,
      /FAILED_DELIVERY_STATUSES = \["failed", "needs_redelivery", "abandoned"\]/,
      `${name} must declare the three statuses in one named constant`,
    );
    // Exactly one declaration, and it must be the one the predicates read.
    assert.equal(
      contents.match(/FAILED_DELIVERY_STATUSES =/g)?.length,
      1,
      `${name} declares the constant more than once, so the copies can drift`,
    );
  }
});

test("abandoned is a failed delivery in every predicate, not just the tile", () => {
  // Each predicate that decides "did delivery fail" must reference the constant
  // rather than carrying its own list. The constant's own literal is fine --
  // what must not exist is a literal reaching an `.includes` call directly.
  const inlineLists = [
    ...analytics.matchAll(/\["failed"[^\]]*\]\.includes/g),
    ...ordersPage.matchAll(/\["failed"[^\]]*\]\.includes/g),
  ];
  assert.deepEqual(
    inlineLists.map((match) => match[0]),
    [],
    "an inline status list reached an .includes call and can drift from the constant",
  );

  assert.match(
    analytics,
    /const isLiveDeliveryFailure = \(order: ApiOrder\) => !isCancelled\(order\) && FAILED_DELIVERY_STATUSES\.includes/,
    "the attention tile's failure predicate no longer reads the shared constant",
  );
  assert.match(
    analytics,
    /if \(FAILED_DELIVERY_STATUSES\.includes\(String\(order\.deliveryStatus/,
    "the overview's fulfillmentLabel no longer reads the shared constant",
  );
  assert.match(
    ordersPage,
    /if \(FAILED_DELIVERY_STATUSES\.includes\(String\(order\.deliveryStatus/,
    "the orders page's fulfillmentLabel no longer reads the shared constant",
  );
  assert.match(
    ordersPage,
    /if \(status === "delivery-failed"\) return FAILED_DELIVERY_STATUSES\.includes/,
    "the 'Delivery gagal' filter no longer reads the shared constant",
  );
});

/*
 * The constant is exported from analytics but declared locally in the orders
 * page, because the two files cannot import each other's copy without pulling
 * a .tsx module into the other's dependency graph. That duplication is the
 * remaining risk, so the declaration text itself is pinned: if one side gains
 * a status, this assertion fails until the other gains it too.
 */
test("both declarations are byte-identical, so the two copies cannot disagree", () => {
  const pattern = /const FAILED_DELIVERY_STATUSES = \[[^\]]*\];/g;
  const fromAnalytics = analytics.match(pattern)?.[0];
  const fromOrdersPage = ordersPage.match(pattern)?.[0];

  assert.ok(fromAnalytics, "analytics.ts has no failed-delivery declaration");
  assert.ok(fromOrdersPage, "orders/page.tsx has no failed-delivery declaration");
  assert.equal(
    fromOrdersPage,
    fromAnalytics,
    "the two copies of the failed-delivery list have drifted apart",
  );
});

/*
 * The repair job gives up permanently, so the owner has to be able to see and
 * act. Without the retry button an abandoned order would be counted as needing
 * attention with no route to resolve it, which is worse than not counting it.
 */
test("an abandoned order still gets a retry action in the order drawer", () => {
  // The button is gated on the label, so fixing the label is what grants it.
  assert.match(
    ordersPage,
    /fulfillmentLabel\(selectedOrder\) === "Gagal"[\s\S]{0,120}retry-delivery/,
    "the retry button is no longer reachable for a Gagal order",
  );
  assert.match(analytics, /FAILED_DELIVERY_STATUSES/, "the shared constant is missing");
});

/*
 * Cancelled orders must not become failures just because the list grew. The
 * tile excludes them explicitly; the page relies on orderStatus, which the
 * constant never touches. Pinned so a future edit that adds a status cannot
 * quietly let a cancelled order into the failure row.
 */
test("the failure list holds delivery statuses only, never order states", () => {
  const declared = /FAILED_DELIVERY_STATUSES = \[([^\]]*)\]/.exec(analytics)?.[1] || "";
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