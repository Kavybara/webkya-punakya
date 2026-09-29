import assert from "node:assert/strict";
import test from "node:test";

import { withServer } from "./helpers/boot-server.mjs";

test("the public precheck rejects without writing to the database", { timeout: 90_000 }, async () => {
  await withServer(async ({ post, fileSize }) => {
    const before = fileSize();

    const missing = await post("/api/public/catalog/precheck", {
      productId: "no-such-product",
      variantId: "no-such-variant",
    });
    assert.equal(missing.status, 409);

    // The property that matters: an unauthenticated probe costs no storage
    // write at all. The decision used to run inside updateDb, so every guess
    // — including a guess at an id that does not exist — rewrote the entire
    // database file and held the lock every other mutation needs.
    assert.equal(fileSize(), before, "a rejected probe must not touch the database file");

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await post("/api/public/catalog/precheck", { productId: `probe-${attempt}`, variantId: "nope" });
    }
    assert.equal(fileSize(), before, "twenty rejected probes must not touch the database file");
  });
});

test("the public precheck still answers a shopper's real request", { timeout: 90_000 }, async () => {
  await withServer(async ({ get, post }) => {
    const product = (await (await get("/api/public/catalog")).json())[0];
    const response = await post("/api/public/catalog/precheck", {
      productId: product.id,
      variantId: product.variants[0].id,
      duration: "1 bulan",
    });
    const body = await response.json();

    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(body.productId, product.id);
    assert.equal(body.variantId, product.variants[0].id);
    assert.equal(typeof body.stockCount, "number");
    assert.ok(Array.isArray(body.catalog));
  });
});

test("the public precheck rate limits an unauthenticated prober", { timeout: 90_000 }, async () => {
  await withServer(async ({ post }) => {
    let limited = null;
    for (let attempt = 0; attempt < 60 && !limited; attempt += 1) {
      const response = await post("/api/public/catalog/precheck", {
        productId: "no-such-product",
        variantId: "nope",
      });
      if (response.status === 429) limited = response;
    }
    assert.ok(limited, "the precheck never rate limited");
    assert.ok(limited.headers.get("retry-after"), "a 429 must tell the client when to come back");
  });
});
