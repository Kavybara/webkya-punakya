import assert from "node:assert/strict";
import test from "node:test";

import { buildWhatsappListHistory } from "../services/whatsapp-list-history-service.js";

test("WhatsApp list history combines audit events and current list snapshot per group", () => {
  const result = buildWhatsappListHistory({
    rentals: [
      { id: "120@g.us", groupJid: "120@g.us", name: "Reseller Iky" },
      { id: "999@g.us", groupJid: "999@g.us", name: "Ress Lain" },
    ],
    groupLists: [
      {
        groupJid: "120@g.us",
        entries: [
          { keyword: "picsart", text: "harga baru", updatedAt: "2026-08-31T04:00:00.000Z" },
          { keyword: "netflix", text: "paket netflix", updatedAt: "2026-08-30T04:00:00.000Z" },
        ],
      },
    ],
    auditEvents: [
      {
        at: "2026-08-31T05:00:00.000Z",
        command: "updatelist",
        groupJid: "120@g.us",
        keyword: "picsart",
        sender: "6281",
        senderName: "Admin",
        textPreview: "harga paling baru",
      },
      {
        at: "2026-08-31T06:00:00.000Z",
        command: "updatelist",
        groupJid: "999@g.us",
        keyword: "hbo",
      },
    ],
    groupId: "120@g.us",
  });

  assert.equal(result.group?.name, "Reseller Iky");
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].keyword, "picsart");
  assert.equal(result.items[0].source, "audit");
  assert.equal(result.items[0].senderName, "Admin");
  assert.equal(result.items[1].source, "snapshot");
});
