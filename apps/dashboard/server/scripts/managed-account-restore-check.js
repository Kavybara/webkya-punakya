import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { defaultData } from "../default-data.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-managed-account-restore-check-"));
const databasePath = path.join(runtimeDir, "kavya-db.json");
const port = 4192;

const db = clone(defaultData);
db.settings = {
  ...(db.settings || {}),
  ownerWhatsAppNumber: "6280000000099",
  botPublicUrl: `http://127.0.0.1:${port}`,
  pakasirProject: "",
  pakasirMerchantId: "",
  pakasirApiKey: "",
  whatsappBotToken: "",
  whatsappBotUrl: "",
};
db.products = [
  {
    id: "prod-netflix-restore",
    name: "Netflix Premium",
    description: "Produk test restore account visibility.",
    isActive: true,
    variants: [
      {
        id: "var-netflix-restore",
        name: "Sharing 1P1U",
        code: "NET-RESTORE",
        prices: { "1 Bulan": 25000 },
        snk: "S&K test restore.",
      },
    ],
  },
];
db.resellers = [
  {
    id: "res-neeca",
    name: "neeca",
    username: "neeca",
    email: "neeca@kavya.local",
    whatsapp: "6281234500001",
    password: "neeca-password",
    isActive: true,
    deposit: 0,
    joinedAt: "2026-01-01",
  },
];
db.stock = [
  {
    id: "stk-netflix-restore",
    sheetStockKey: "netflix-row-51",
    productId: "prod-netflix-restore",
    variantId: "var-netflix-restore",
    email: "anakvera@kya.baby",
    password: "restore-pass",
    profile: "4",
    pin: "",
    status: "sold",
    sheetSource: "google_sheets",
    soldAt: "2026-06-20 17:02",
    soldDuration: "1 Bulan",
    soldDurationDays: 30,
    createdAt: "2026-06-20 17:02",
  },
];
db.orders = [];
db.payments = [];
db.activities = [];
db.managedAccounts = [
  {
    id: "acc-netflix-restore",
    stockId: "stk-netflix-restore",
    sheetStockKey: "netflix-row-51",
    resellerId: "res-neeca",
    product: "Netflix Premium",
    productId: "prod-netflix-restore",
    variant: "Sharing 1P1U",
    variantId: "var-netflix-restore",
    variantCode: "NET-RESTORE",
    stockPoolKey: "prod-netflix-restore::var-netflix-restore",
    duration: "1 Bulan",
    durationDays: 30,
    email: "anakvera@kya.baby",
    password: "restore-pass",
    buyer: "neeca",
    reseller: "neeca",
    whatsapp: "6281234500001",
    profile: "4",
    pin: "",
    source: "google_sheets",
    sheetSource: "google_sheets",
    sheetName: "Netflix",
    sheetRow: 51,
    startedAt: "2026-06-20 17:02",
    expiresAt: "2026-07-20 17:02",
    status: "expired",
    hidden: true,
    returnedToStockAt: "2026-07-03 00:01",
  },
];
db.whatsappMessages = [];
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
  await delay(500);

  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "neeca@kavya.local",
      password: "neeca-password",
      role: "reseller",
    }),
  });
  const loginPayload = await loginResponse.json();
  if (!loginResponse.ok || !loginPayload?.token) {
    throw new Error(`Login reseller gagal: ${loginResponse.status} ${JSON.stringify(loginPayload)}`);
  }

  const accountsResponse = await fetch(`http://127.0.0.1:${port}/api/accounts`, {
    headers: { authorization: `Bearer ${loginPayload.token}` },
  });
  const accountsPayload = await accountsResponse.json();
  if (!accountsResponse.ok) {
    throw new Error(`GET /api/accounts gagal: ${accountsResponse.status} ${JSON.stringify(accountsPayload)}`);
  }
  if (!Array.isArray(accountsPayload) || accountsPayload.length !== 1) {
    throw new Error(`Akun restore tidak muncul di panel reseller: ${JSON.stringify(accountsPayload)}`);
  }

  const saved = JSON.parse(await fs.readFile(databasePath, "utf8"));
  const restored = (saved.managedAccounts || []).find((item) => item.id === "acc-netflix-restore");
  if (!restored) throw new Error("Managed account restore tidak ditemukan");
  if (restored.hidden) throw new Error("Managed account masih hidden setelah refresh");
  if (restored.returnedToStockAt) throw new Error(`returnedToStockAt belum dibersihkan: ${restored.returnedToStockAt}`);
  if (restored.status !== "active") throw new Error(`status account belum aktif: ${restored.status}`);

  console.log("managed-account-restore-check OK");
  console.log("archived google sheets netflix account restored");
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
