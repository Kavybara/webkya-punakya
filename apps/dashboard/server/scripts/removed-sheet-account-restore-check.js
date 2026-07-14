import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { defaultData } from "../default-data.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-removed-sheet-restore-check-"));
const databasePath = path.join(runtimeDir, "kavya-db.json");
const port = 4197;

const db = clone(defaultData);
db.settings = {
  ...(db.settings || {}),
  ownerWhatsAppNumber: "6280000000010",
  botPublicUrl: `http://127.0.0.1:${port}`,
  pakasirProject: "",
  pakasirMerchantId: "",
  pakasirApiKey: "",
  whatsappBotToken: "",
  whatsappBotUrl: "",
};
db.products = [
  {
    id: "prod-netflix",
    name: "Netflix Premium",
    isActive: true,
    variants: [
      {
        id: "net-1p1u",
        name: "Sharing 1P1U",
        code: "NET-1P1U",
        prices: { "1 Bulan": 25000 },
        snk: "removed test",
      },
    ],
  },
];
db.stock = [
  {
    id: "stk-removed-1",
    productId: "prod-netflix",
    variantId: "net-1p1u",
    email: "marcdf@freenet.de",
    password: "paoaoa101",
    profile: "Marc",
    pin: "2015",
    status: "removed",
    sheetSource: "google_sheets",
    sheetStockKey: "NETFLIX_SHARED:24:marcdf@freenet.de:marc",
    sheetPool: "NETFLIX_SHARED",
    sheetName: "Netflix",
    sheetRow: 24,
    sheetRemovedAt: "2026-07-09 14:18",
  },
];
db.managedAccounts = [
  {
    id: "acc-removed-1",
    stockId: "stk-removed-1",
    resellerId: "res-neeca",
    product: "Netflix Premium",
    productId: "prod-netflix",
    variant: "Sharing 1P1U",
    variantId: "net-1p1u",
    variantCode: "NET-1P1U",
    stockPoolKey: "prod-netflix::netflix-1p1u-semi",
    duration: "3 Bulan",
    durationDays: 90,
    email: "marcdf@freenet.de",
    password: "paoaoa101",
    buyer: "neeca",
    reseller: "neeca",
    whatsapp: "6285157314844",
    profile: "Marc",
    pin: "2015",
    sheetSource: "google_sheets",
    sheetStockKey: "NETFLIX_SHARED:24:marcdf@freenet.de:marc",
    sheetName: "Netflix",
    sheetRow: 24,
    sheetPool: "NETFLIX_SHARED",
    sheetPoolSchema: "profile",
    sheetStartColumn: 0,
    startedAt: "2026-06-21",
    expiresAt: "2026-09-19 00:00",
    status: "active",
    hidden: true,
    returnedToStockAt: "2026-07-09 14:18",
    sheetMissingArchivedAt: "2026-07-09 14:18",
    orderId: "ORD-REMOVED-1",
    sourceOrderId: "ORD-REMOVED-1",
  },
];

await fs.writeFile(databasePath, JSON.stringify(db, null, 2));

let failure = null;
try {
  process.env.DATABASE_PATH = databasePath;
  process.env.PORT = String(port);
  process.env.PUBLIC_APP_URL = `http://127.0.0.1:${port}`;
  process.env.APP_PUBLIC_URL = `http://127.0.0.1:${port}`;
  process.env.WHATSAPP_BOT_URL = "";
  process.env.WHATSAPP_BOT_TOKEN = "";
  await import("../index.js");
  await delay(700);

  const saved = JSON.parse(await fs.readFile(databasePath, "utf8"));
  const account = (saved.managedAccounts || []).find((item) => item.id === "acc-removed-1");
  if (!account) throw new Error("Managed account check hilang");
  if (!account.hidden || !account.returnedToStockAt) {
    throw new Error(`Akun Sheet yang stoknya removed malah hidup lagi: ${JSON.stringify(account)}`);
  }
  if (account.status !== "active") {
    throw new Error(`Status akun tidak dipertahankan untuk histori removed: ${JSON.stringify(account)}`);
  }

  console.log("removed-sheet-account-restore-check OK");
  console.log("removed google sheets stock no longer reactivates archived reseller account");
} catch (error) {
  failure = error;
} finally {
  await fs.rm(runtimeDir, { recursive: true, force: true }).catch(() => undefined);
  if (failure) {
    console.error(failure);
    process.exit(1);
  }
  process.exit(0);
}
