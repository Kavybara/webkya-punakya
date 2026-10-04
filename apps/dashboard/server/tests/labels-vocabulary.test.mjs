import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * `lib/labels.ts` is the single source of truth for what a status is called.
 *
 * It exists because "what state is this order in" had five separate answers
 * across the app, four of them disagreeing about the same order on screens the
 * owner looks at side by side. The worst of them labelled a customer-cancelled
 * order and a botched delivery with the same word, so a reseller could not tell
 * the one they caused from the one the customer paid for and did not receive.
 *
 * These assertions are source inspection, not execution: Node 20 cannot import
 * `.ts`, and `lib/labels.ts` is imported by `.tsx` pages. The convention here
 * is the repo's -- inspect the source, assert on intent.
 */

const LABELS = new URL("../../src/lib/labels.ts", import.meta.url);

function source(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function labels() {
  return readFileSync(LABELS, "utf8");
}

/**
 * Strips block and line comments.
 *
 * Required, not optional: these files explain in prose exactly which words are
 * banned and why, so an assertion over raw source happily matches the
 * explanation of the defect instead of the fix. This has already produced one
 * false failure.
 */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("the brief's seven order statuses are the ones the file emits", () => {
  const emitted = withoutComments(labels()).match(/label: "([^"]+)"/g)?.map((m) => /"([^"]+)"/.exec(m)[1]);

  for (const status of ["Menunggu pembayaran", "Dibayar", "Diproses", "Selesai", "Kedaluwarsa", "Dibatalkan", "Gagal kirim"]) {
    assert.ok(
      emitted.includes(status),
      `"${status}" is one of the seven order statuses the product must show, and labels.ts never emits it`,
    );
  }
});

test("no untranslated English status reaches a reader", () => {
  const body = withoutComments(labels());

  // These are the exact strings the five competing implementations used. Each
  // was a real label on a real screen.
  for (const stale of ['"Expired"', '"Sukses"', '"Gagal"', '"Menunggu Pembayaran"']) {
    assert.doesNotMatch(
      body,
      new RegExp(`label: ${stale.replace(/"/g, '"')}`),
      `${stale} is an untranslated status label still emitted by labels.ts`,
    );
  }
});

test("a cancelled order and a failed delivery are different statuses", () => {
  const orderStatus = /export function orderStatus[\s\S]*?\n}/.exec(labels())?.[0];
  assert.ok(orderStatus, "orderStatus is not defined in labels.ts");

  const cancelled = /lifecycle === "cancelled"\)\s*return \{\s*label: "([^"]+)"/.exec(orderStatus)?.[1];
  const failed = /deliveryFailed\(order\)\)\s*return \{\s*label: "([^"]+)"/.exec(orderStatus)?.[1];

  assert.equal(cancelled, "Dibatalkan");
  assert.equal(failed, "Gagal kirim");
  assert.notEqual(
    cancelled,
    failed,
    "this is the defect that cost money: a reseller must be able to tell an order they cancelled from one the customer paid for and never received",
  );
});

test("a paid order that was never delivered is not reported as fine", () => {
  const orderStatus = /export function orderStatus[\s\S]*?\n}/.exec(labels())?.[0];

  const failedCheck = orderStatus.indexOf("deliveryFailed(order)");
  const completedCheck = orderStatus.indexOf('lifecycle === "completed"');
  assert.ok(failedCheck > -1 && completedCheck > -1, "orderStatus lost one of its two checks");

  assert.ok(
    failedCheck < completedCheck,
    "a completed order whose delivery failed must read 'Gagal kirim', not 'Selesai' -- the customer paid and got nothing",
  );
});

test("an unrecognised status is humanised rather than printed raw", () => {
  assert.match(
    labels(),
    /function humanise[\s\S]*?replace\(\/\[_-\]\+\/g, " "\)/,
    "labels.ts must have a fallback that turns an unknown token into words",
  );
  assert.match(
    labels(),
    /if \(!text\) return "Tidak diketahui"/,
    "an empty status must say so; a blank cell reads as 'nothing to report'",
  );
});

test("every label carries its tone, so a rename cannot drop the colour", () => {
  const body = withoutComments(labels());

  // The defect this prevents: `badgeTone(label)` mapped label *strings* to
  // colours, so renaming "Expired" to "Kedaluwarsa" silently turned every
  // matching badge grey with no type error and no failing test.
  assert.doesNotMatch(
    source("src/pages/owner-v2/orders/page.tsx"),
    /function badgeTone/,
    "a string-keyed colour table is back; label and tone must travel together",
  );

  const returns = [...body.matchAll(/return \{ label: "([^"]+)", tone: "([^"]+)" \}/g)];
  assert.ok(returns.length >= 12, `expected every label to name a tone, found ${returns.length}`);
});

test("the rental, severity, health and connection vocabularies are translated", () => {
  const body = withoutComments(labels());

  for (const [fn, expected] of [
    ["rentalStatus", ["Aktif", "Dijeda", "Berakhir"]],
    ["severity", ["Tinggi", "Sedang", "Rendah"]],
    ["systemHealth", ["Sehat", "Perlu dicek", "Bermasalah"]],
    ["waConnection", ["Menghubungkan", "Terhubung", "Terputus"]],
  ]) {
    for (const label of expected) {
      assert.match(
        body,
        new RegExp(`label: "${label}"`),
        `${fn}() must be able to say "${label}"`,
      );
    }
  }
});

test("rental expiry and an expired payment stay different words", () => {
  // "Kedaluwarsa" is a deadline that passed in anger; "Berakhir" is a rental
  // that ran out of days normally. Sharing the word makes one of them wrong.
  assert.match(labels(), /expired: \{ label: "Berakhir"/);
  assert.match(labels(), /qris === "expired"\) return \{ label: "Kedaluwarsa"/);
});

test("labels.ts has no consumer that reads a raw status instead", () => {
  // Sanity check on the consolidation: the five previous homes of this logic
  // must now import, not redeclare.
  for (const page of [
    "src/pages/owner-v2/page.tsx",
    "src/pages/owner-v2/orders/page.tsx",
    "src/pages/reseller-v2/page.tsx",
    "src/pages/reseller-v2/orders/page.tsx",
  ]) {
    assert.doesNotMatch(
      source(page),
      /function (statusForOrder|fulfillmentLabel|paymentLabel)\s*\([^)]*\)\s*\{\s*\n\s*if/,
      `${page} still defines its own order-status ladder`,
    );
  }
});