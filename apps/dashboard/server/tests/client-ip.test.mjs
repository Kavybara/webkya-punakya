import assert from "node:assert/strict";
import test from "node:test";

import {
  clientKey,
  directPeerAddress,
  isLoopbackAddress,
  normalizeIpAddress,
  parseTrustedProxyIps,
  resolveTrustProxy,
} from "../lib/client-ip.js";
import { createLoginAttemptLimiter } from "../lib/login-attempt-limiter.js";

function request(ip, forwardedFor) {
  const request = { ip, socket: { remoteAddress: "203.0.113.9" } };
  if (forwardedFor) request.headers = { "x-forwarded-for": forwardedFor };
  return request;
}

test("IPv4-mapped IPv6 addresses normalize to their IPv4 form", () => {
  assert.equal(normalizeIpAddress("::ffff:127.0.0.1"), "127.0.0.1");
  assert.equal(normalizeIpAddress("::FFFF:203.0.113.9"), "203.0.113.9");
  assert.equal(normalizeIpAddress("  203.0.113.9  "), "203.0.113.9");
  assert.equal(normalizeIpAddress(undefined), "");
  assert.equal(normalizeIpAddress("::1"), "::1");
});

test("loopback detection covers both socket families", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("203.0.113.9"), false);
  assert.equal(isLoopbackAddress(""), false);
});

test("TRUSTED_PROXY_IPS parses a comma separated allowlist", () => {
  const trusted = parseTrustedProxyIps("10.0.0.4, ::1 ,");
  assert.equal(trusted.size, 2);
  assert.equal(trusted.has("10.0.0.4"), true);
  assert.equal(trusted.has("::1"), true);
  assert.equal(trusted.has(""), false);
  assert.equal(parseTrustedProxyIps("").size, 0);
});

test("with no allowlist only loopback peers are trusted", () => {
  const trust = resolveTrustProxy({});
  assert.equal(trust("127.0.0.1"), true);
  assert.equal(trust("::1"), true);
  assert.equal(trust("::ffff:127.0.0.1"), true);
  assert.equal(trust("203.0.113.9"), false);
  assert.equal(trust("10.0.0.4"), false);
});

test("an explicit allowlist replaces the loopback default", () => {
  const trust = resolveTrustProxy({ TRUSTED_PROXY_IPS: "10.0.0.4" });
  assert.equal(trust("10.0.0.4"), true);
  assert.equal(trust("127.0.0.1"), false);
  assert.equal(trust("203.0.113.9"), false);
});

test("a forged X-Forwarded-For cannot move a direct client off its transport address", () => {
  // This is the bypass the old `app.set("trust proxy", 1)` allowed: with one
  // trusted hop Express reads the rightmost XFF entry, which a client sets
  // itself, so rotating the header minted a fresh rate-limiter identity.
  const trust = resolveTrustProxy({});
  const forged = ["1.2.3.4", "8.8.8.8", "not-an-ip", ""];

  for (const value of forged) {
    // proxy-addr scans right to left and returns the first untrusted address,
    // which for a direct client is always the socket itself.
    assert.equal(trust("203.0.113.9"), false);
    assert.equal(clientKey(request(undefined, value)), "203.0.113.9", value);
  }
  assert.equal(clientKey(request(undefined)), "203.0.113.9");
  assert.equal(directPeerAddress(request(undefined)), "203.0.113.9");
  assert.equal(clientKey({}), "unknown");
});

test("a trusted loopback proxy still yields the real client address", () => {
  // Express resolves `req.ip` before this module sees it, so the module only
  // has to pass it through unchanged when one is present.
  assert.equal(clientKey(request("198.51.100.22")), "198.51.100.22");
  assert.equal(clientKey(request("::ffff:198.51.100.22")), "198.51.100.22");
});

test("login attempts are capped per client and account even as the address rotates", () => {
  const limiter = createLoginAttemptLimiter({ env: {} });

  // Five attempts against the pair budget is the pre-existing limit, reached
  // without any address rotation at all.
  for (let index = 0; index < 5; index += 1) {
    assert.equal(limiter.check(request("198.51.100.1"), "owner@kavya.test").allowed, true);
    limiter.recordFailure(request("198.51.100.1"), "owner@kavya.test");
  }
  assert.equal(limiter.check(request("198.51.100.1"), "owner@kavya.test").allowed, false);

  // Rotating the address no longer resets anything. The pair budget is spent
  // per address, so a new address gets its own five tries — but they all draw
  // on the same account budget, so the total is capped rather than unlimited.
  assert.equal(limiter.limits.account, 10);
  for (let index = 0; index < 5; index += 1) {
    assert.equal(limiter.check(request("198.51.100.2"), "owner@kavya.test").allowed, true);
    limiter.recordFailure(request("198.51.100.2"), "owner@kavya.test");
  }
  for (const address of ["198.51.100.3", "203.0.113.7", "::1"]) {
    assert.equal(limiter.check(request(address), "owner@kavya.test").allowed, false, address);
  }

  // And an unrelated account from the blocked address is unaffected, so one
  // locked account does not deny service to everyone behind the same address.
  assert.equal(limiter.check(request("198.51.100.1"), "other@kavya.test").allowed, true);
});

test("a distributed attack on one account runs out of account budget", () => {
  const limiter = createLoginAttemptLimiter({ env: { LOGIN_ACCOUNT_MAX_ATTEMPTS: "3" } });

  for (let index = 0; index < 3; index += 1) {
    const address = `198.51.100.${index + 1}`;
    assert.equal(limiter.check(request(address), "owner@kavya.test").allowed, true);
    limiter.recordFailure(request(address), "owner@kavya.test");
  }
  // Each address is individually under the pair budget of 5; only the shared
  // account budget stops this.
  assert.equal(limiter.check(request("198.51.100.9"), "owner@kavya.test").allowed, false);
});

test("one address spraying many accounts is capped by the client budget", () => {
  const limiter = createLoginAttemptLimiter({ env: { LOGIN_MAX_ATTEMPTS: "1", LOGIN_CLIENT_MAX_ATTEMPTS: "2" } });

  limiter.recordFailure(request("198.51.100.1"), "a@kavya.test");
  limiter.recordFailure(request("198.51.100.1"), "b@kavya.test");

  // Neither account is over its own budget, but the address is now spraying.
  assert.equal(limiter.check(request("198.51.100.1"), "c@kavya.test").allowed, false);
  // Other addresses are unaffected.
  assert.equal(limiter.check(request("198.51.100.2"), "c@kavya.test").allowed, true);
});

test("a successful login clears every key it touched", () => {
  const limiter = createLoginAttemptLimiter({ env: {} });

  limiter.recordFailure(request("198.51.100.1"), "owner@kavya.test");
  limiter.recordFailure(request("198.51.100.2"), "owner@kavya.test");
  limiter.recordFailure(request("198.51.100.2"), "other@kavya.test");
  limiter.clear(request("198.51.100.2"), "owner@kavya.test");

  assert.equal(limiter.check(request("198.51.100.2"), "owner@kavya.test").allowed, true);
  // Clearing one account must not wipe the other account's counter.
  assert.equal(limiter.check(request("198.51.100.2"), "other@kavya.test").allowed, true);
});

test("attempt counters expire with the window and report a retry hint", () => {
  let clock = 1_000_000;
  const limiter = createLoginAttemptLimiter({
    now: () => clock,
    env: { LOGIN_MAX_ATTEMPTS: "1", LOGIN_WINDOW_MS: "60000" },
  });

  for (let index = 0; index < 5; index += 1) {
    limiter.recordFailure(request("198.51.100.1"), "owner@kavya.test");
  }
  const blocked = limiter.check(request("198.51.100.1"), "owner@kavya.test");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);

  clock += 60_001;
  assert.equal(limiter.check(request("198.51.100.1"), "owner@kavya.test").allowed, true);
});

test("the email key is case and whitespace insensitive", () => {
  const limiter = createLoginAttemptLimiter({ env: { LOGIN_MAX_ATTEMPTS: "1" } });

  limiter.recordFailure(request("198.51.100.1"), "  Owner@Kavya.Test ");
  assert.equal(limiter.check(request("198.51.100.1"), "owner@kavya.test").allowed, false);
});
