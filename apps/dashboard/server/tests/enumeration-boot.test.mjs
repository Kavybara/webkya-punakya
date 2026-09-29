import assert from "node:assert/strict";
import test from "node:test";

import { withServer } from "./helpers/boot-server.mjs";

// Every assertion here is about what an unauthenticated caller can learn. The
// fixture seeds one known reseller, so "the account exists" and "the account
// does not exist" are both reachable from the outside.

const KNOWN_WHATSAPP = "628111222333";
const UNKNOWN_IDENTIFIER = "nobody@example.test";

test("a password reset request answers the same for a known and an unknown account", { timeout: 90_000 }, async () => {
  await withServer(async ({ post, fileSize }) => {
    const known = await post("/api/auth/password-reset/request", { identifier: KNOWN_WHATSAPP });
    const knownStatus = known.status;
    const knownBody = await known.json();

    const unknown = await post("/api/auth/password-reset/request", { identifier: UNKNOWN_IDENTIFIER });
    const unknownStatus = unknown.status;
    const unknownBody = await unknown.json();

    // Identical in every observable way. The endpoint used to answer 404 for an
    // unknown account, 400 for one with no WhatsApp number, and 502 when the
    // send failed — a complete oracle for who has an account here.
    assert.equal(knownStatus, unknownStatus, `status differed: ${knownStatus} vs ${unknownStatus}`);
    assert.deepEqual(knownBody, unknownBody, "the response body must not depend on whether the account exists");
    assert.equal(knownStatus, 200);
    assert.equal(knownBody.ok, true);
    assert.equal(knownBody.deliveryStatus, "sent");
  });
});

test("a password reset request for an unknown account writes nothing", { timeout: 90_000 }, async () => {
  await withServer(async ({ post, fileSize }) => {
    const before = fileSize();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await post("/api/auth/password-reset/request", { identifier: `ghost-${attempt}@example.test` });
    }
    assert.equal(fileSize(), before, "probing for accounts must not rewrite the database file");
  });
});

test("a password reset request still rejects a missing identifier as a client error", { timeout: 90_000 }, async () => {
  await withServer(async ({ post }) => {
    // This one is safe to be specific about: it says nothing about any
    // account, only about the request being malformed.
    const response = await post("/api/auth/password-reset/request", { identifier: "  " });
    assert.equal(response.status, 400);
  });
});

test("a login never reveals that the instance has no owner password configured", { timeout: 90_000 }, async () => {
  await withServer(async ({ post }) => {
    const wrongPassword = await post("/api/auth/login", { role: "owner", email: "owner", password: "wrong" });
    const wrongStatus = wrongPassword.status;
    const wrongBody = await wrongPassword.json();

    const unconfigured = await post("/api/auth/login", { role: "owner", email: "owner", password: "boot-test-password" });
    const unconfiguredStatus = unconfigured.status;
    const unconfiguredBody = await unconfigured.json();

    // Asking with the right password against an instance that has no owner
    // password set must be indistinguishable from asking with a wrong one.
    assert.equal(unconfiguredStatus, wrongStatus, "status must not reveal configuration state");
    assert.deepEqual(unconfiguredBody, wrongBody, "the body must not reveal configuration state");
    // Belt and braces, so the test keeps meaning something if the startup
    // migration starts provisioning an owner password of its own.
    assert.equal(unconfiguredStatus, 401);
    assert.doesNotMatch(
      JSON.stringify(unconfiguredBody),
      /konfigurasi|belum di/i,
      "the response must not describe the instance's configuration",
    );
  }, { env: { OWNER_PASSWORD: "", OWNER_USERNAME: "" } });
});

test("the reseller check is rate limited so a phone number list cannot map the reseller base", { timeout: 90_000 }, async () => {
  await withServer(async ({ get }) => {
    const first = await get(`/api/public/reseller-check?whatsapp=${KNOWN_WHATSAPP}`);
    assert.equal(first.status, 200);
    assert.equal((await first.json()).active, true, "a known reseller must still be recognised");

    let limited = null;
    for (let attempt = 0; attempt < 40 && !limited; attempt += 1) {
      const response = await get(`/api/public/reseller-check?whatsapp=628${String(attempt).padStart(9, "0")}`);
      if (response.status === 429) limited = response;
    }
    assert.ok(limited, "the reseller check never rate limited");
    assert.ok(limited.headers.get("retry-after"), "a 429 must tell the client when to come back");
  });
});
