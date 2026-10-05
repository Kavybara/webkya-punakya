import assert from "node:assert/strict";
import test from "node:test";
import axios from "../../../node_modules/axios/index.js";

import {
  SsrfBlockedError,
  isBlockedAddress,
  parseUrl,
  createPinnedLookup,
  safeGet,
  truncate,
  DEFAULT_MAX_BYTES,
  MAX_SAFE_TEXT_LENGTH,
} from "../../../lib/safeFetch.js";

/*
 * SSRF guard for outbound fetches triggered by chat commands.
 *
 * `plugins/kavya/TOOLS/get.js` fetched an attacker-supplied URL with a bare
 * `axios.get(content)` and echoed the body back into the group. It is
 * `OnlyOwner: false`, and `TOOLS` is not in the adapter's
 * OWNER_SCOPED_LEGACY_DIRS (`apps/bot/plugins/legacy-autoresbot.js`), so
 * `guardLegacyPlugin` let any member through. That turns a group chat into a
 * request proxy pointed at the host's own network.
 *
 * These tests are behavioural against the real module, and they are split by
 * attack class rather than by function, because the interesting failures are
 * the representations that *look* public and resolve inward:
 *
 *   - `http://2130706433/`   decimal-encoded loopback
 *   - `http://[::ffff:127.0.0.1]/`  IPv4-mapped IPv6
 *   - a public hostname that resolves to 169.254.169.254 (cloud metadata)
 *   - a public URL that 302s to loopback
 *   - a public hostname whose DNS answer changes between check and connect
 *
 * `safeGet` takes injected `resolveHostname` and `request` so the redirect,
 * DNS and rebinding behaviour can be exercised without opening a socket. The
 * defaults are the real `dns.lookup` and real `axios`; only the tests swap them.
 */

const PUBLIC = [{ address: "93.184.216.34", family: 4 }];

test("DNS resolution cannot hold a command indefinitely", async () => {
  await assert.rejects(safeGet("https://example.com/", {
    timeoutMs: 30,
    resolveHostname: () => new Promise(() => {}),
    request: async () => { throw new Error("must not request before DNS completes"); },
  }), /timeout/i);
});

test("the default Axios requester receives a URL and a guarded HTTP config", async () => {
  const previous = axios.request;
  let received;
  axios.request = async (config) => {
    received = config;
    return { status: 200, headers: { "content-type": "text/plain" }, data: Buffer.from("ok"), config };
  };
  try {
    await safeGet("https://example.com/", { resolveHostname: async () => PUBLIC });
    assert.equal(received.url, "https://example.com/");
    assert.equal(received.method, "get");
    assert.equal(received.proxy, false);
    assert.equal(received.adapter, "http");
    assert.equal(typeof received.lookup, "function");
  } finally {
    axios.request = previous;
  }
});

/** A `request` stand-in that never touches the network. */
function stubRequest(responder) {
  const calls = [];
  const fn = async (config) => {
    calls.push(config);
    return responder(config, calls.length - 1);
  };
  fn.calls = calls;
  return fn;
}

function plainText(body = "<title>ok</title>", contentType = "text/html") {
  return {
    status: 200,
    headers: { "content-type": contentType },
    data: Buffer.from(body),
    request: { res: { responseUrl: undefined } },
  };
}

// ---------------------------------------------------------------------------
// Scheme allowlist
// ---------------------------------------------------------------------------

test("only http and https are accepted", () => {
  for (const url of [
    "file:///etc/passwd",
    "gopher://127.0.0.1:6379/_SET",
    "ftp://example.com/x",
    "data:text/html,<script>alert(1)</script>",
    "javascript:alert(1)",
    "ws://example.com",
  ]) {
    assert.throws(() => parseUrl(url), SsrfBlockedError, `accepted ${url}`);
  }
  assert.doesNotThrow(() => parseUrl("https://example.com"));
  assert.doesNotThrow(() => parseUrl("http://example.com"));
});

test("credentials embedded in the URL are refused", () => {
  // Otherwise the fetch becomes an authenticated request to an attacker host
  // using credentials the bot itself would supply.
  assert.throws(
    () => parseUrl("http://user:pass@example.com/"),
    SsrfBlockedError,
  );
});

// ---------------------------------------------------------------------------
// Hostnames that must never be reached
// ---------------------------------------------------------------------------

test("local and internal-only hostnames are refused before resolution", () => {
  /*
   * These are names, not literals, so the address checks cannot judge them.
   * Catching them here means the guard does not depend on what the resolver
   * happens to answer -- a hosts-file entry or a captive portal returning a
   * routable address would otherwise be enough to get in.
   */
  for (const url of [
    "http://localhost/",
    "http://localhost:8080/admin",
    "http://LOCALHOST/",            // case must not matter
    "http://localhost./",           // trailing root dot
    "http://foo.localhost/",        // .localhost is reserved (RFC 6761)
    "http://localhost.localdomain/",
    "http://ip6-localhost/",
    "http://printer.local/",        // mDNS, resolves inside the LAN
    "http://db.internal/",
    "http://wiki.intranet/",
    "http://gateway.home.arpa/",
  ]) {
    assert.throws(() => parseUrl(url), SsrfBlockedError, `accepted ${url}`);
  }
});

test("a hostname that merely contains a blocked word is still allowed", () => {
  // Substring matching would take down real sites for no security gain.
  for (const url of [
    "https://example.com/",
    "https://mylocalhost.example.com/",
    "https://localhosting.io/",
    "https://internal.example.com/",
  ]) {
    assert.doesNotThrow(() => parseUrl(url), `wrongly blocked ${url}`);
  }
});

// ---------------------------------------------------------------------------
// Address classification: IPv4
// ---------------------------------------------------------------------------

test("IPv4 loopback, private, link-local and reserved space is blocked", () => {
  const blocked = [
    "127.0.0.1", "127.1.2.3", "127.255.255.254",
    "0.0.0.0", "0.0.0.1",
    "10.0.0.1", "10.255.255.255",
    "172.16.0.1", "172.31.255.255",
    "192.168.0.1", "192.168.255.255",
    "169.254.169.254", // cloud instance metadata
    "169.254.0.1",
    "100.64.0.1", "100.127.255.255", // CGNAT
    "192.0.0.1", "192.0.2.1", // IETF protocol assignments / TEST-NET-1
    "198.18.0.1", "198.19.255.255", // benchmarking
    "198.51.100.1", "203.0.113.1", // TEST-NET-2/3
    "224.0.0.1", "239.255.255.255", // multicast
    "240.0.0.1", "255.255.255.255", // reserved / broadcast
  ];
  for (const ip of blocked) {
    assert.ok(isBlockedAddress(ip), `${ip} should be blocked`);
  }
  for (const ip of ["93.184.216.34", "8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1"]) {
    assert.ok(!isBlockedAddress(ip), `${ip} should be allowed`);
  }
});

// ---------------------------------------------------------------------------
// Address classification: IPv6, including the IPv4-mapped forms
// ---------------------------------------------------------------------------

test("IPv6 loopback, ULA, link-local and multicast is blocked", () => {
  const blocked = [
    "::1",
    "::",
    "fc00::1", "fd00::1", "fdff:ffff::1", // unique local fc00::/7
    "fe80::1", "fe80::1%25eth0", "febf::1", // link-local fe80::/10
    "ff02::1", "ff0e::1", // multicast
    "2001:db8::1", // documentation
    "::ffff:127.0.0.1", // IPv4-mapped loopback -- the classic bypass
    "::ffff:7f00:1", // same, hex form
    "::ffff:10.0.0.1",
    "::ffff:192.168.1.1",
    "::ffff:169.254.169.254",
    "64:ff9b::7f00:1", // NAT64 wrapping loopback
  ];
  for (const ip of blocked) {
    assert.ok(isBlockedAddress(ip), `${ip} should be blocked`);
  }
  for (const ip of ["2606:2800:220:1:248:1893:25c8:1946", "2a00:1450:4001:82f::200e"]) {
    assert.ok(!isBlockedAddress(ip), `${ip} should be allowed`);
  }
});

// ---------------------------------------------------------------------------
// Obfuscated literals
// ---------------------------------------------------------------------------

test("non-canonical IPv4 literals are decoded before being judged", () => {
  // WHATWG URL keeps these verbatim as the hostname, so they reach the
  // resolver looking like names but resolving inward.
  for (const url of [
    "http://2130706433/", // 127.0.0.1
    "http://0x7f000001/",
    "http://017700000001/",
    "http://127.1/",
  ]) {
    assert.throws(() => parseUrl(url), SsrfBlockedError, `accepted ${url}`);
  }
});

// ---------------------------------------------------------------------------
// DNS resolution
// ---------------------------------------------------------------------------

test("a public hostname that resolves inward is refused", async () => {
  const request = stubRequest(() => plainText());
  await assert.rejects(
    () =>
      safeGet("http://metadata.internal.example/", {
        resolveHostname: async () => [{ address: "169.254.169.254", family: 4 }],
        request,
      }),
    SsrfBlockedError,
  );
  assert.equal(request.calls.length, 0, "must refuse before opening a socket");
});

test("one private answer poisons the whole resolution", async () => {
  // A round-robin record with a public and a private address: connecting to
  // whichever arrives first is a coin flip the attacker controls.
  const request = stubRequest(() => plainText());
  await assert.rejects(
    () =>
      safeGet("https://mixed.example/", {
        resolveHostname: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "10.1.2.3", family: 4 },
        ],
        request,
      }),
    SsrfBlockedError,
  );
  assert.equal(request.calls.length, 0);
});

test("a resolution failure is an error, not an open door", async () => {
  const request = stubRequest(() => plainText());
  await assert.rejects(
    () =>
      safeGet("https://nx.example/", {
        resolveHostname: async () => {
          throw new Error("ENOTFOUND");
        },
        request,
      }),
    /ENOTFOUND/,
  );
});

// ---------------------------------------------------------------------------
// DNS rebinding
// ---------------------------------------------------------------------------

test("safeGet hands the socket a lookup pinned to the address it validated", async () => {
  /*
   * This is the test that should have existed the first time round.
   *
   * The previous version asserted `createPinnedLookup` works -- and it did --
   * while `safeGet` went on to call plain `axios.get`, which resolves the
   * hostname itself. Every rebinding defence was present in the module and
   * absent from the request path, and a unit test on the unused function
   * reported green.
   *
   * So this goes through `safeGet` and inspects the config the real requester
   * receives. The stub stands in for axios, and axios forwards `lookup`
   * straight to `http.request` (axios/dist/node/axios.cjs: `let lookup =
   * own('lookup')` ... `options.lookup = lookup`), so if `lookup` is on the
   * config the socket is pinned.
   */
  const request = stubRequest(() => plainText());

  await safeGet("https://example.com/", {
    resolveHostname: async () => PUBLIC,
    request,
  });

  const config = request.calls[0];
  assert.equal(typeof config.lookup, "function", "safeGet must pin the socket, not just check the name");

  // Whatever the agent asks for, it gets the validated address back.
  assert.deepEqual(
    await new Promise((res, rej) =>
      config.lookup("example.com", { all: true }, (e, a) => (e ? rej(e) : res(a))),
    ),
    PUBLIC,
  );

  const [single] = await new Promise((res, rej) =>
    config.lookup("example.com", { all: false }, (e, a, f) => (e ? rej(e) : res([a, f]))),
  );
  assert.equal(
    single,
    PUBLIC[0].address,
    "the single-address form must return the validated address too",
  );
});

test("the pinned lookup ignores a hostname other than the one validated", async () => {
  /*
   * The pin must not become a redirect. A lookup that answers any hostname with
   * the pinned address would let a redirect to `evil.example` connect to the
   * address we judged for `good.example`. Pinning is per-request and per-hop;
   * `safeGet` rebuilds it for each hop from that hop's own validation.
   */
  const lookup = createPinnedLookup(PUBLIC);

  // A name with no pinned answer fails closed rather than resolving for real.
  await assert.rejects(
    () =>
      new Promise((res, rej) =>
        createPinnedLookup([])("example.com", { all: false }, (e, a) => (e ? rej(e) : res(a))),
      ),
    SsrfBlockedError,
    "an empty pin must fail closed instead of falling back to the resolver",
  );

  // The pinned set is a copy: a caller mutating what it got back cannot retune
  // the pin for the next lookup.
  const pinned = await new Promise((res, rej) =>
    lookup("example.com", { all: true }, (e, a) => (e ? rej(e) : res(a))),
  );
  pinned.push({ address: "127.0.0.1", family: 4 });

  assert.deepEqual(
    await new Promise((res, rej) =>
      lookup("example.com", { all: true }, (e, a) => (e ? rej(e) : res(a))),
    ),
    PUBLIC,
  );
});

// ---------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------

test("a redirect to loopback is refused", async () => {
  const request = stubRequest(() => ({
    status: 302,
    headers: { location: "http://127.0.0.1:8080/admin", "content-type": "text/html" },
    data: Buffer.from(""),
  }));

  await assert.rejects(
    () => safeGet("https://example.com/", { resolveHostname: async () => PUBLIC, request }),
    SsrfBlockedError,
  );
  assert.equal(request.calls.length, 1, "must not follow the hop");
});

test("a redirect to a private address by hostname is refused", async () => {
  const request = stubRequest(() => ({
    status: 301,
    headers: { location: "http://metadata.internal.example/latest/meta-data/", "content-type": "text/html" },
    data: Buffer.from(""),
  }));

  await assert.rejects(
    () =>
      safeGet("https://example.com/", {
        resolveHostname: async (hostname) =>
          hostname === "example.com"
            ? PUBLIC
            : [{ address: "169.254.169.254", family: 4 }],
        request,
      }),
    SsrfBlockedError,
  );
});

test("a redirect loop terminates instead of hanging", async () => {
  let hop = 0;
  const request = stubRequest(() => ({
    status: 302,
    headers: { location: `https://example.com/${++hop}`, "content-type": "text/html" },
    data: Buffer.from(""),
  }));

  await assert.rejects(
    () => safeGet("https://example.com/", { resolveHostname: async () => PUBLIC, request }),
    /redirect/i,
  );
  assert.ok(hop <= 10, `stopped after ${hop} hops`);
});

test("a safe redirect is followed", async () => {
  const request = stubRequest((_c, i) =>
    i === 0
      ? { status: 302, headers: { location: "https://www.example.com/", "content-type": "text/html" }, data: Buffer.from("") }
      : plainText("<title>Arrived</title>"),
  );

  const result = await safeGet("https://example.com/", {
    resolveHostname: async () => PUBLIC,
    request,
  });
  assert.equal(result.status, 200);
  assert.match(result.data.toString(), /Arrived/);
});

// ---------------------------------------------------------------------------
// Response limits
// ---------------------------------------------------------------------------

test("an oversized body is refused", async () => {
  const request = stubRequest(() => {
    const res = plainText();
    res.data = Buffer.alloc(DEFAULT_MAX_BYTES + 1, 0x61);
    return res;
  });

  await assert.rejects(
    () => safeGet("https://example.com/", { resolveHostname: async () => PUBLIC, request }),
    /terlalu besar|too large/i,
  );
});

test("a content type outside the allowlist is refused", async () => {
  for (const contentType of [
    "application/x-msdownload",
    "application/octet-stream",
    "text/html; charset=utf-8\x00binary",
    "image/svg+xml",
  ]) {
    const request = stubRequest(() => plainText("x", contentType));
    await assert.rejects(
      () => safeGet("https://example.com/", { resolveHostname: async () => PUBLIC, request }),
      SsrfBlockedError,
      `accepted ${contentType}`,
    );
  }
});

test("the allowlist still permits html, json and plain text", async () => {
  for (const contentType of [
    "text/html",
    "text/html; charset=utf-8",
    "application/json",
    "application/json; charset=utf-8",
    "text/plain; charset=utf-8",
  ]) {
    const request = stubRequest(() => plainText("body", contentType));
    const result = await safeGet("https://example.com/", {
      resolveHostname: async () => PUBLIC,
      request,
    });
    assert.equal(result.status, 200, `rejected ${contentType}`);
  }
});

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

test("a hanging request is bounded by the timeout", async () => {
  const request = () => new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5_000));
  await assert.rejects(
    () =>
      safeGet("https://example.com/", {
        resolveHostname: async () => PUBLIC,
        request,
        timeoutMs: 25,
      }),
    /timeout|aborted|socket hang up/i,
  );
});

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

test("text too long for a chat message is clipped, not sent whole", () => {
  /*
   * `safeGet` accepts up to DEFAULT_MAX_BYTES, which is far more than a WhatsApp
   * message will carry. Without clipping, a large-but-legal response would fail
   * at serialization time -- after the request had already been made.
   */
  const long = "a".repeat(MAX_SAFE_TEXT_LENGTH * 3);
  const clipped = truncate(long);

  assert.ok(clipped.length <= MAX_SAFE_TEXT_LENGTH + 64, `length was ${clipped.length}`);
  assert.match(clipped, /dipotong/);
  assert.ok(clipped.startsWith("aaa"), "the beginning must survive, not the end");
});

test("text within the limit is passed through untouched", () => {
  const short = "<title>Contoh</title>";
  assert.equal(truncate(short), short);
  assert.equal(truncate(""), "");
  assert.equal(truncate(undefined), "");
});
