import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { JsonStore } from "../lib/json-store.js";

test("setGroupListEntry mirrors updates into legacy database/list.json", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kavya-list-mirror-"));
  const storeDir = path.join(root, "runtime", "whatsapp-database");
  const legacyListPath = path.join(root, "database", "list.json");
  const legacyBotListPath = path.join(root, "apps", "bot", "database", "lists.json");
  const dashboardDbPath = path.join(root, "kavya-digital-dashboard", "runtime", "kavya-db.json");
  process.env.LEGACY_LIST_FILE = legacyListPath;
  process.env.LEGACY_BOT_LIST_FILE = legacyBotListPath;
  process.env.DATABASE_PATH = dashboardDbPath;
  await mkdir(path.dirname(legacyListPath), { recursive: true });
  await mkdir(path.dirname(legacyBotListPath), { recursive: true });
  await mkdir(path.dirname(dashboardDbPath), { recursive: true });
  await writeFile(legacyBotListPath, JSON.stringify({}, null, 2));
  await writeFile(dashboardDbPath, JSON.stringify({ whatsappGroupLists: [] }, null, 2));
  await writeFile(legacyListPath, JSON.stringify({
    "120363000000000000@g.us": {
      list: {
        picsart: {
          content: {
            text: "harga lama",
            media: "",
          },
        },
      },
    },
  }, null, 2));

  const store = new JsonStore(storeDir);
  await store.ensure();
  await store.setGroupListEntry("120363000000000000@g.us", "picsart", {
    text: "harga baru 4000 dan 13000",
    media: "",
    media_path: "",
  });

  const legacy = JSON.parse(await readFile(legacyListPath, "utf8"));
  const legacyBot = JSON.parse(await readFile(legacyBotListPath, "utf8"));
  const dashboard = JSON.parse(await readFile(dashboardDbPath, "utf8"));
  assert.equal(
    legacy["120363000000000000@g.us"].list.picsart.content.text,
    "harga baru 4000 dan 13000",
  );
  assert.equal(
    legacyBot["120363000000000000@g.us"].list.picsart.content.text,
    "harga baru 4000 dan 13000",
  );
  assert.equal(
    dashboard.whatsappGroupLists[0].entries.find((entry) => entry.keyword === "picsart").text,
    "harga baru 4000 dan 13000",
  );
});

test("keyword named list is treated as a normal group list entry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kavya-list-keyword-"));
  const storeDir = path.join(root, "runtime", "whatsapp-database");
  const legacyListPath = path.join(root, "database", "list.json");
  const legacyBotListPath = path.join(root, "apps", "bot", "database", "lists.json");
  const dashboardDbPath = path.join(root, "kavya-digital-dashboard", "runtime", "kavya-db.json");
  process.env.LEGACY_LIST_FILE = legacyListPath;
  process.env.LEGACY_BOT_LIST_FILE = legacyBotListPath;
  process.env.DATABASE_PATH = dashboardDbPath;
  await mkdir(path.dirname(legacyListPath), { recursive: true });
  await mkdir(path.dirname(legacyBotListPath), { recursive: true });
  await mkdir(path.dirname(dashboardDbPath), { recursive: true });
  await writeFile(legacyListPath, JSON.stringify({}, null, 2));
  await writeFile(legacyBotListPath, JSON.stringify({}, null, 2));
  await writeFile(dashboardDbPath, JSON.stringify({ whatsappGroupLists: [] }, null, 2));

  const store = new JsonStore(storeDir);
  await store.ensure();
  await store.setGroupListEntry("120363000000000001@g.us", "list", {
    text: "daftar menu utama",
    media: "",
    media_path: "",
  });

  const lists = await store.getGroupList("120363000000000001@g.us");
  assert.equal(
    lists.list.list.content.text,
    "daftar menu utama",
  );
});
