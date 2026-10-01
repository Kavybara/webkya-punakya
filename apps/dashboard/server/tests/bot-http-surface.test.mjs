import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createHttpServer } from "../../../bot/handle/server.js";

/**
 * The bot's HTTP surface: who may be messaged, and what a sync hands back.
 *
 * These are real requests against a real `http.Server` on an ephemeral port,
 * not source assertions. `createHttpServer` only builds the server, so nothing
 * here touches a WhatsApp socket -- `connection` is a stub, and the only calls
 * it records are the ones a request is supposed to make.
 *
 * What is being defended:
 *
 *   - `/messages/send` used to accept any JID, including `@g.us`. It is guarded
 *     by one shared static token with no rate limit, and each send is serialised
 *     through a 750ms queue with six retries, so a loop turns a leaked token
 *     into ~1.3 messages a second inside live customer groups.
 *   - `/groups/sync` used to return the full member roster of every joined
 *     group -- every member's phone number -- behind that same token, for a
 *     route the dashboard never called.
 */

const TOKEN = "test-bot-token";

/** A `connection` stub that records sends instead of performing them. */
function stubConnection(overrides = {}) {
  const sent = [];
  return {
    sent,
    getHealthPayload: () => ({ ok: true }),
    getStatusPayload: () => ({ connected: true }),
    renderQrPage: () => "<html></html>",
    deleteMessage: async () => ({ key: { id: "deleted" } }),
    sendMessage: async (to) => {
      sent.push(to);
      return { key: { id: `msg-${sent.length}` } };
    },
    syncJoinedGroups: async () => ({
      success: true,
      groups: [
        {
          group_jid: "120363024446021056@g.us",
          group_name: "PINKOLA BABES",
          participant_count: 2,
          participants: [
            { jid: "6281234567890@s.whatsapp.net", number: "6281234567890", is_admin: true },
            { jid: "6289999999999@s.whatsapp.net", number: "6289999999999", is_admin: false },
          ],
        },
      ],
      result: { total: 1 },
    }),
    ...overrides,
  };
}

/** Boot the server on a free port and return a request helper. */
async function withServer(connection, run) {
  const server = createHttpServer({ config: { token: TOKEN }, connection });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const call = async (path, { method = "GET", body, auth = true } = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        ...(auth ? { Authorization: `Bearer ${TOKEN}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  try {
    await run(call);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("a person can still be messaged", async () => {
  const connection = stubConnection();
  await withServer(connection, async (call) => {
    const result = await call("/messages/send", {
      method: "POST",
      body: { to: "6281234567890", text: "Kode OTP Kavya: 1234" },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
  });
  // The point of the guard is that it does not cost the legitimate caller.
  assert.deepEqual(connection.sent, ["6281234567890"]);
});

test("a group JID is refused, and nothing is sent", async () => {
  const connection = stubConnection();
  await withServer(connection, async (call) => {
    const result = await call("/messages/send", {
      method: "POST",
      body: { to: "120363024446021056@g.us", text: "promo" },
    });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, "group_target_not_allowed");
  });
  // The refusal has to happen before the socket, not after the send.
  assert.deepEqual(connection.sent, [], "a message reached a group despite the 400");
});

test("broadcast and newsletter targets are refused too", async () => {
  const connection = stubConnection();
  await withServer(connection, async (call) => {
    for (const to of ["12345@broadcast", "12345@newsletter", "120363@g.us "]) {
      const result = await call("/messages/send", { method: "POST", body: { to, text: "x" } });
      assert.equal(result.body.error, "group_target_not_allowed", `${to} was not refused`);
    }
  });
  assert.deepEqual(connection.sent, []);
});

test("a lid address is still deliverable", async () => {
  // WhatsApp hands back `@lid` addresses for some contacts instead of the real
  // number. Denying it would quietly break delivery to legitimate people, so the
  // guard has to distinguish "many recipients" from "an unusual address for one".
  const connection = stubConnection();
  await withServer(connection, async (call) => {
    const result = await call("/messages/send", {
      method: "POST",
      body: { to: "19887351093812@lid", text: "Kode OTP Kavya: 1234" },
    });
    assert.equal(result.status, 200);
  });
  assert.deepEqual(connection.sent, ["19887351093812@lid"]);
});

test("a group sync returns counts but never a member roster", async () => {
  const connection = stubConnection();
  await withServer(connection, async (call) => {
    const result = await call("/groups/sync", { method: "POST" });
    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.groups.length, 1);
    // The useful fields survive.
    assert.equal(result.body.groups[0].group_jid, "120363024446021056@g.us");
    assert.equal(result.body.groups[0].participant_count, 2);
    // The roster does not.
    assert.equal(result.body.groups[0].participants, undefined);
  });

  // Belt and braces: not one phone number may appear anywhere in the payload.
  const raw = await fetchSummary(connection);
  assert.doesNotMatch(raw, /6281234567890|6289999999999/, "a member number reached the sync response");
});

test("the whole bot HTTP surface still needs the bearer token", async () => {
  await withServer(stubConnection(), async (call) => {
    for (const [path, method] of [
      ["/messages/send", "POST"],
      ["/messages/delete", "POST"],
      ["/groups/sync", "POST"],
      ["/groups/join", "POST"],
      ["/session/status", "GET"],
    ]) {
      const result = await call(path, { method, auth: false, body: method === "POST" ? {} : undefined });
      assert.equal(result.status, 401, `${path} answered without a token`);
    }
  });
});

test("the group sync payload no longer carries participants at all", async () => {
  /*
   * Source assertion, and the one place a source assertion is right.
   *
   * `listJoinedGroups` used to build a full roster for every joined group on
   * every sync. The dashboard's `normalizeSyncedGroup` is a whitelist with no
   * `participants` key, so the array was serialised onto the wire -- 1000 phone
   * numbers for a 1000-member group -- and then thrown away. The count is what
   * anyone reads, and the count is still produced.
   */
  const source = await readFile(
    new URL("../../../bot/handle/connection.js", import.meta.url),
    "utf8",
  );

  // The sync path asks for the summary shape...
  assert.match(
    source,
    /groupInfoFromMetadata\(group, "", \{ includeParticipants: false \}\)/,
    "listJoinedGroups is building the full roster again",
  );
  // ...and only the on-demand lookup still builds the roster.
  assert.match(
    source,
    /async function getGroupInfo\(groupJid\)[\s\S]{0,400}?groupInfoFromMetadata\(metadata, normalized\)/,
    "getGroupInfo must keep its default, which includes participants",
  );
  assert.match(
    source,
    /const participants = includeParticipants && Array\.isArray/,
    "the roster is no longer gated on the flag",
  );
});

/** The serialised `/groups/sync` response, as text, for the phone-number scan. */
async function fetchSummary(connection) {
  let payload = "";
  await withServer(connection, async (call) => {
    const result = await call("/groups/sync", { method: "POST" });
    payload = JSON.stringify(result.body);
  });
  return payload;
}