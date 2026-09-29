import assert from "node:assert/strict";
import test from "node:test";

import groupBasicPlugin from "../plugins/kavya/group-basic.js";

function createContext(overrides = {}) {
  const replies = [];
  const writes = [];

  return {
    context: {
      command: "updatelist",
      args: "payment | daftar pembayaran baru",
      isGroup: true,
      isOwner: true,
      isGroupAdmin: true,
      groupAdminChecked: true,
      chat_jid: "120363000000000000@g.us",
      sender_jid: "628111111111@s.whatsapp.net",
      raw_sender_jid: "628111111111@s.whatsapp.net",
      sender: "628111111111",
      pushName: "Bukan Admin Grup",
      config: {},
      services: {
        getGroupParticipantInfo: async () => ({
          checked: true,
          is_admin: false,
          is_super_admin: false,
        }),
      },
      store: {
        getGroupList: async () => ({
          payment: {
            text: "daftar pembayaran lama",
          },
        }),
        setGroupListEntry: async (...args) => {
          writes.push(args);
        },
      },
      reply: async (message) => {
        replies.push(String(message || ""));
      },
      ...overrides,
    },
    replies,
    writes,
  };
}

test("updatelist menolak owner bot yang bukan admin grup", async () => {
  const fixture = createContext();

  const result = await groupBasicPlugin.execute(fixture.context);

  assert.equal(result.handled, true);
  assert.equal(fixture.writes.length, 0);
  assert.match(fixture.replies.join("\n"), /admin/i);
});

test("updatelist mengizinkan admin grup berdasarkan metadata terbaru", async () => {
  const fixture = createContext({
    isOwner: false,
    isGroupAdmin: false,
    groupAdminChecked: false,
    services: {
      getGroupParticipantInfo: async () => ({
        checked: true,
        is_admin: true,
        is_super_admin: false,
      }),
    },
  });

  const result = await groupBasicPlugin.execute(fixture.context);

  assert.equal(result.handled, true);
  assert.ok(fixture.writes.length > 0);
  assert.match(fixture.replies.join("\n"), /berhasil/i);
});

test("updatelist langsung mengganti balasan keyword di grup yang sama", async () => {
  let groupList = {
    picsart: {
      text: "harga lama",
    },
  };
  const replies = [];
  const base = {
    isGroup: true,
    isOwner: false,
    isGroupAdmin: true,
    groupAdminChecked: true,
    chat_jid: "120363999999999999@g.us",
    sender_jid: "628111111111@s.whatsapp.net",
    raw_sender_jid: "628111111111@s.whatsapp.net",
    sender: "628111111111",
    pushName: "Admin Grup",
    config: {},
    services: {
      getGroupParticipantInfo: async () => ({
        checked: true,
        is_admin: true,
        is_super_admin: false,
      }),
    },
    store: {
      getGroupList: async () => groupList,
      setGroupListEntry: async (_groupJid, keyword, entry) => {
        groupList = {
          ...groupList,
          [String(keyword).toLowerCase()]: {
            text: entry.text,
            media: entry.media,
            media_path: entry.media_path,
          },
        };
      },
    },
    reply: async (message) => {
      replies.push(String(message || ""));
    },
  };

  await groupBasicPlugin.execute({
    ...base,
    command: "updatelist",
    args: "picsart | harga baru 4000 dan 13000",
    text: ".updatelist picsart | harga baru 4000 dan 13000",
    prefix: ".",
  });
  await groupBasicPlugin.execute({
    ...base,
    command: "",
    args: "",
    text: "picsart",
    prefix: "",
  });

  assert.match(replies.at(-1), /harga baru 4000 dan 13000/);
  assert.doesNotMatch(replies.at(-1), /harga lama/);
});

test("updatelist diblokir ketika metadata grup tidak dapat diverifikasi", async () => {
  const fixture = createContext({
    isOwner: false,
    isGroupAdmin: true,
    groupAdminChecked: true,
    services: {
      getGroupParticipantInfo: async () => {
        throw new Error("group_metadata_unavailable");
      },
    },
  });

  const result = await groupBasicPlugin.execute(fixture.context);

  assert.equal(result.handled, true);
  assert.equal(fixture.writes.length, 0);
  assert.match(fixture.replies.join("\n"), /belum bisa diverifikasi/i);
});
