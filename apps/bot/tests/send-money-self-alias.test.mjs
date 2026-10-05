import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

/*
 * Self-transfer minting money, in `plugins/kavya/GROUP/send money.js`.
 *
 * The handler's only self-send guard compares *digits*:
 *
 *     const targetNumber = extractNumber(r);
 *     const senderNumber = extractNumber(sender);
 *     if (targetNumber === senderNumber) return ...;   // line 78
 *
 * That is not enough, because the two sides are not the same kind of string.
 * `sender` is whatever JID the message arrived on and may be a LID
 * (`268053891793140@lid`), while `r` is the output of `convertToJid`
 * (lib/utils.js), which always resolves a LID to a *phone* JID
 * (`6282335408411@s.whatsapp.net`). Different digit runs, so the guard passes.
 *
 * But the lookup afterwards is not digit-scoped. `findUser` (lib/users.js:285)
 * falls through to matching any alias by digits, and `registerUser`
 * (lib/users.js:242) deliberately lets one account hold one `@lid` alias and
 * one `@s.whatsapp.net` alias at the same time. So both lookups land on the
 * SAME db entry.
 *
 * The two writes then both apply to that one account:
 *
 *     updateUser(sender,       { money: userData1.money - amount });
 *     updateUser(targetNumber, { money: userData2.money + amount });
 *
 * The debit and the credit cancel, and because both read the *pre-transfer*
 * snapshot, the credit is computed from the un-debited balance. Net effect:
 * the balance grows by the full amount sent. Repeating the command mints money
 * without limit.
 *
 * The fix compares the resolved `docId` instead of the normalised digits.
 *
 * This is behavioural, not source inspection: the handler is a default export
 * and takes injected `sock`/`messageInfo`, so it runs against the real
 * `lib/users.js` with only `convertToJid` stubbed to stand in for Baileys'
 * LID -> phone resolution. Everything that decides the outcome -- the alias
 * matching in `findUser`, the guard, and both writes -- is the shipping code.
 *
 * `lib/users.js` resolves `./database/users.json` against the CWD and starts a
 * 5s autosave interval at import, so CWD is moved into a throwaway directory
 * first. That keeps this test off the real user database entirely.
 */

const HANDLER = new URL("../../../plugins/kavya/GROUP/send%20money.js", import.meta.url).href;
const LIMIT_HANDLER = new URL("../../../plugins/kavya/GROUP/send%20limit.js", import.meta.url).href;

const LID = "268053891793140@lid";
const PHONE = "6282335408411@s.whatsapp.net";

/** Load the handlers with an isolated CWD, so no real user data is touched. */
async function loadHandler() {
  const root = await mkdtemp(path.join(os.tmpdir(), "kavya-sendmoney-"));
  await mkdir(path.join(root, "database"), { recursive: true });

  const previousCwd = process.cwd();
  process.chdir(root);

  const timers = [];
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = (...args) => {
    const timer = originalSetInterval(...args);
    timers.push(timer);
    return timer;
  };
  let users;
  let handler;
  let limitHandler;
  try {
    users = await import(new URL("../../../lib/users.js", import.meta.url).href);
    handler = (await import(HANDLER)).default;
    limitHandler = (await import(LIMIT_HANDLER)).default;
  } finally {
    globalThis.setInterval = originalSetInterval;
    for (const timer of timers) clearInterval(timer);
  }
  const { addUser, findUser, saveUsers, saveOwners } = users;
  // Both modules default-export a plugin descriptor, not the function itself.
  const run = handler.handle;
  const runLimit = limitHandler.handle;

  return {
    // One human, two aliases -- exactly what registerUser allows.
    // 1000 is the balance a seeded test account would start from.
    seedSelf: () => {
      addUser("doc-self", {
        username: "korban",
        aliases: [PHONE, LID],
        money: 1000,
        limit: 10,
      });
    },
    seedOther: () => {
      addUser("doc-other", {
        username: "lain",
        aliases: ["628999000111@s.whatsapp.net"],
        money: 0,
        limit: 0,
      });
    },
    balanceOf: (jid) => findUser(jid)[1].money,
    limitOf: (jid) => findUser(jid)[1].limit,
    findUser,
    run,
    runLimit,
    restore: async () => {
      await saveUsers();
      await saveOwners();
      process.chdir(previousCwd);
    },
  };
}

/**
 * A `sock` that records what the user was told. `convertToJid` is stubbed with
 * the same contract as lib/utils.js: resolve the LID to its phone JID.
 */
function makeSock(sent) {
  return {
    async sendMessage(_remoteJid, content) {
      sent.push(content.text);
      return {};
    },
    signalRepository: {
      lidMapping: {
        /*
         * Real behaviour: a LID resolves to a phone-number JID. The victim's
         * LID maps to their own phone number -- that is the whole point of the
         * alias pair. Any other LID resolves to itself as a phone JID.
         */
        async getPNForLID(lid) {
          const digits = lid.replace(/\D/g, "");
          return digits === LID.replace(/\D/g, "")
            ? PHONE
            : `${digits}@s.whatsapp.net`;
        },
      },
    },
  };
}

test("sending money to your own second alias must not increase the balance", async (t) => {
  const env = await loadHandler();
  t.after(() => env.restore());
  env.seedSelf();

  const sent = [];
  // The victim types their OWN phone number as the target, while the message
  // arrives on their LID identity -- the shape a real LID-era group produces.
  await env.run(makeSock(sent), {
    remoteJid: "120363000000000000@g.us",
    message: { key: {} },
    content: `${PHONE.split("@")[0]} 500`,
    sender: LID,
    command: "sendmoney",
    prefix: ".",
  });

  const after = env.balanceOf(LID);
  assert.equal(
    after,
    1000,
    `balance was ${after}, expected it to stay 1000; sending 500 to yourself must never mint money`,
  );
  assert.ok(
    sent.some((m) => m.includes("tidak bisa mengirim money ke nomor Anda sendiri")),
    "the self-send must be refused with an explanation, not silently applied",
  );
});

test("a genuine transfer to another account still moves money", async (t) => {
  const env = await loadHandler();
  t.after(() => env.restore());
  env.seedSelf();
  env.seedOther();

  const sent = [];
  await env.run(makeSock(sent), {
    remoteJid: "120363000000000000@g.us",
    message: { key: {} },
    content: "628999000111 300",
    sender: LID,
    command: "sendmoney",
    prefix: ".",
  });

  assert.equal(env.balanceOf(LID), 700, "the sender must be debited");
  assert.equal(
    env.balanceOf("628999000111@s.whatsapp.net"),
    300,
    "the receiver must be credited",
  );
});
/*
 * `send limit` is the same handler with `limit` in place of `money`, and it
 * carries an identical copy of the flaw. That matters more, not less: `limit`
 * is the quota that decides how much money a member may spend, so inflating it
 * is the same escalation with one step removed.
 */
test("sending limit to your own second alias must not increase the limit", async (t) => {
  const env = await loadHandler();
  t.after(() => env.restore());
  env.seedSelf();

  const sent = [];
  await env.runLimit(makeSock(sent), {
    remoteJid: "120363000000000000@g.us",
    message: { key: {} },
    content: `${PHONE.split("@")[0]} 5`,
    sender: LID,
    command: "sendlimit",
    prefix: ".",
  });

  const after = env.limitOf(LID);
  assert.equal(
    after,
    10,
    `limit was ${after}, expected it to stay 10; sending 5 to yourself must never mint limit`,
  );
  assert.ok(
    sent.some((m) => m.includes("tidak bisa mengirim limit ke nomor Anda sendiri")),
    "the self-send must be refused with an explanation, not silently applied",
  );
});

test("a genuine limit transfer to another account still moves limit", async (t) => {
  const env = await loadHandler();
  t.after(() => env.restore());
  env.seedSelf();
  env.seedOther();

  const sent = [];
  await env.runLimit(makeSock(sent), {
    remoteJid: "120363000000000000@g.us",
    message: { key: {} },
    content: "628999000111 4",
    sender: LID,
    command: "sendlimit",
    prefix: ".",
  });

  assert.equal(env.limitOf(LID), 6, "the sender must be debited");
  assert.equal(env.limitOf("628999000111@s.whatsapp.net"), 4, "the receiver must be credited");
});
