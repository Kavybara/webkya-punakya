import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { defaultData } from "../default-data.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-reseller-visibility-check-"));
const databasePath = path.join(runtimeDir, "kavya-db.json");
const port = 4191;

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
    id: "prod-netflix-visibility",
    name: "Netflix Visibility Product",
    description: "Produk test untuk visibility reseller.",
    isActive: true,
    variants: [
      {
        id: "var-netflix-visibility",
        name: "1P1U",
        code: "NET-VIS",
        prices: { "1 Bulan": 25000 },
        snk: "S&K test visibility.",
      },
    ],
  },
];
db.resellers = [
  {
    id: "res-nadia",
    name: "Nadia",
    username: "nadia",
    email: "nadia@kavya.local",
    whatsapp: "6281111111111",
    password: "nadia-password",
    isActive: true,
    deposit: 0,
    joinedAt: "2026-01-01",
  },
  {
    id: "res-shelby",
    name: "Shelby",
    username: "shelby",
    email: "shelby@kavya.local",
    whatsapp: "6282222222222",
    password: "shelby-password",
    isActive: true,
    deposit: 0,
    joinedAt: "2026-01-01",
  },
];
db.stock = [
  {
    id: "stk-netflix-visibility",
    productId: "prod-netflix-visibility",
    variantId: "var-netflix-visibility",
    email: "nadia-visibility@kavya.local",
    password: "pass-visibility",
    profile: "P1",
    pin: "1111",
    status: "sold",
    soldAt: "2026-06-30 20:00",
    soldDuration: "1 Bulan",
    soldDurationDays: 30,
    createdAt: "2026-06-30 19:00",
  },
];
db.orders = [
  {
    id: "ORD-VISIBILITY-1",
    paymentRef: "PAY-VISIBILITY-1",
    customer: "Nadia",
    whatsapp: "6281111111111",
    resellerId: "res-nadia",
    reseller: "Nadia",
    product: "Netflix Visibility Product",
    productId: "prod-netflix-visibility",
    variant: "1P1U",
    variantId: "var-netflix-visibility",
    variantCode: "NET-VIS",
    customerVariant: "1P1U",
    customerVariantId: "var-netflix-visibility",
    customerVariantCode: "NET-VIS",
    stockPoolKey: "prod-netflix-visibility::var-netflix-visibility",
    duration: "1 Bulan",
    durationDays: 30,
    qty: 1,
    total: 25000,
    paymentDue: 0,
    qrisStatus: "paid",
    orderStatus: "completed",
    deliveryStatus: "sent",
    paymentMethod: "Deposit reseller",
    createdAt: "2026-06-30 20:00",
    paidAt: "2026-06-30 20:01",
    expiresAt: "2026-07-30 20:01",
    deliveredStockIds: ["stk-netflix-visibility"],
    source: "web",
    channel: "Reseller",
  },
];
db.payments = [];
db.activities = [];
db.managedAccounts = [
  {
    id: "acc-visibility-1",
    stockId: "stk-netflix-visibility",
    resellerId: "res-shelby",
    product: "Netflix Visibility Product",
    productId: "prod-netflix-visibility",
    variant: "1P1U",
    variantId: "var-netflix-visibility",
    variantCode: "NET-VIS",
    stockPoolKey: "prod-netflix-visibility::var-netflix-visibility",
    duration: "",
    durationDays: 0,
    email: "nadia-visibility@kavya.local",
    password: "pass-visibility",
    buyer: "",
    reseller: "Shelby",
    whatsapp: "",
    profile: "P1",
    pin: "1111",
    source: "google_sheets",
    startedAt: "",
    expiresAt: "",
    status: "active",
    hidden: false,
  },
];
db.whatsappMessages = [];
await fs.writeFile(databasePath, JSON.stringify(db, null, 2));

let failure = null;
try {
  process.env.DATABASE_PATH = databasePath;
  process.env.AUTH_SECRET = "kavya-regression-test-auth-secret-32-characters";
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
      email: "nadia@kavya.local",
      password: "nadia-password",
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
    throw new Error(`Akun Nadia tidak terlihat di panel reseller: ${JSON.stringify(accountsPayload)}`);
  }
  const visible = accountsPayload[0] || {};
  if (visible.email !== "nadia-visibility@kavya.local") {
    throw new Error(`Akun yang muncul salah: ${JSON.stringify(visible)}`);
  }
  if (!visible.startedAt || !visible.duration || !visible.expiresAt) {
    throw new Error(`Field akun belum ter-repair penuh: ${JSON.stringify(visible)}`);
  }

  const saved = JSON.parse(await fs.readFile(databasePath, "utf8"));
  const account = (saved.managedAccounts || []).find((item) => item.id === "acc-visibility-1");
  if (!account) throw new Error("Managed account hasil repair tidak ditemukan");
  if (account.resellerId !== "res-nadia") throw new Error(`resellerId belum pindah ke Nadia: ${account.resellerId}`);
  if (account.reseller !== "Nadia") throw new Error(`nama reseller belum canonical: ${account.reseller}`);
  if (account.orderId !== "ORD-VISIBILITY-1") throw new Error(`orderId belum terikat: ${account.orderId}`);
  if (account.whatsapp !== "6281111111111") throw new Error(`whatsapp reseller belum sinkron: ${account.whatsapp}`);
  if (!account.startedAt || !account.duration || !account.expiresAt) {
    throw new Error(`tanggal/durasi akun belum terisi: ${JSON.stringify(account)}`);
  }

  console.log("reseller-account-visibility-check OK");
  console.log("stale reseller mapping repaired");
  console.log("reseller panel visibility OK");
  console.log("managed account metadata repair OK");
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
