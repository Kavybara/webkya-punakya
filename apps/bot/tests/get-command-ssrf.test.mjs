import assert from "node:assert/strict";
import test from "node:test";

import {
  safeGet,
  SsrfBlockedError,
} from "../../../lib/safeFetch.js";

/*
 * `.get` — `plugins/kavya/TOOLS/get.js` — was an unauthenticated request proxy.
 *
 * The handler did:
 *
 *     const response = await axios.get(content);
 *
 * and then posted the result back into the group chat. The command is
 * `OnlyOwner: false`, and `apps/bot/plugins/legacy-autoresbot.js` scopes only
 * `OWNER`, `PANEL` and `PUSHKONTAK` to owners — `TOOLS` is not in that set, so
 * `guardLegacyPlugin` let any member through.
 *
 * The attack needs no listener: the attacker posts `.get
 * http://169.254.169.254/latest/meta-data/iam/security-credentials/` in the
 * group and the answer comes back in the same chat.
 *
 * The other tests in safe-fetch-ssrf.test.mjs cover the guard itself. This file
 * exists to prove the guard is actually *wired into the command* -- a perfect
 * module that nothing calls protects nothing, which is exactly the state this
 * handler was in while `safeFetch.js` already existed and had 17 passing tests.
 *
 * These run against the real handler with a stubbed `sock`. The fetch itself is
 * exercised through `safeGet`'s injected resolver, so no socket is opened and
 * no request ever leaves the machine.
 */

const HANDLER = "file:///C:/Users/tegar/Downloads/File%20Backup21/plugins/kavya/TOOLS/get.js";

const PUBLIC = [{ address: "93.184.216.34", family: 4 }];

/** Records everything the handler tried to tell the chat. */
function makeSock(sent) {
  return {
    async sendMessage(_remoteJid, content) {
      if (content?.text !== undefined) sent.push(content.text);
      return {};
    },
  };
}

/**
 * `reply(m, text)` (lib/utils.js:1120) destructures sock, message and remoteJid
 * off `m` itself, not off the outer messageInfo -- so all three have to live
 * inside `m` or every reply throws before it is ever sent.
 */
function messageInfo(content, sock) {
  return {
    m: { sock, message: { key: {} }, remoteJid: "120363000000000000@g.us" },
    remoteJid: "120363000000000000@g.us",
    message: { key: {} },
    prefix: ".",
    command: "get",
    content,
  };
}

/**
 * Run the handler and collect what it sent back.
 *
 * No resolver injection here on purpose. `safeGet` is a module-level import
 * inside the handler, and Node's ESM loader offers no per-test override, so the
 * tests below stick to inputs `safeGet` rejects from the URL alone (literal
 * loopback, `file:`, `gopher:`). Those reach the guard without a DNS lookup,
 * which is what makes them safe to run with no network.
 */
async function runHandler({ content }) {
  const sent = [];
  const sock = makeSock(sent);
  const handler = (await import(HANDLER)).default;
  await handler.handle(sock, messageInfo(content, sock));
  return sent;
}

test("the command module exists and exports a plugin descriptor", async () => {
  const handler = (await import(HANDLER)).default;
  assert.equal(typeof handler.handle, "function");
  assert.ok(handler.Commands.includes("get"));
  assert.equal(handler.OnlyOwner, false, "still member-reachable; the guard is what protects it");
});

test("loopback, link-local and private targets are refused", async () => {
  for (const url of [
    "http://127.0.0.1:8080/admin",
    "http://localhost/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://[::1]/",
    "http://2130706433/",
    "file:///etc/passwd",
    "gopher://127.0.0.1:6379/_SET",
  ]) {
    await assert.rejects(
      () => safeGet(url, { resolveHostname: async () => PUBLIC }),
      SsrfBlockedError,
      `safeGet accepted ${url}`,
    );
  }
});

test("a public URL that redirects to loopback is refused", async () => {
  const request = async () => ({
    status: 302,
    headers: { location: "http://169.254.169.254/latest/meta-data/", "content-type": "text/html" },
    data: Buffer.from(""),
  });

  await assert.rejects(
    () => safeGet("https://example.com/", { resolveHostname: async () => PUBLIC, request }),
    SsrfBlockedError,
  );
});

test("the handler tells the user a blocked target was refused", async () => {
  const sent = await runHandler({ content: "http://127.0.0.1:8080/" });

  assert.ok(
    sent.some((t) => /tidak diizinkan/i.test(t)),
    `expected a plain "not allowed" message, got: ${JSON.stringify(sent)}`,
  );
  // The refusal must not be phrased as an internal fault, which would train
  // users to retry rather than to stop asking for internal addresses.
  assert.ok(!sent.some((t) => /Maaf, terjadi kesalahan/.test(t)));
});

test("non-URL input still gets the usage message", async () => {
  const sent = await runHandler({ content: "bukan-url" });
  assert.ok(
    sent.some((t) => /Format Penggunaan/.test(t)),
    `expected the usage hint, got: ${JSON.stringify(sent)}`,
  );
});