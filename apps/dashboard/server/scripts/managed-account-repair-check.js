import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { defaultData } from "../default-data.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-managed-account-repair-check-"));
const databasePath = path.join(runtimeDir, "kavya-db.json");
const port = 4194;

const db = clone(defaultData);
db.settings = {
  ...(db.settings || {}),
  ownerEmail: "owner@kavya.local",
  ownerPassword: "ownerpass123",
  ownerWhatsAppNumber: "6280000000098",
  botPublicUrl: `http://127.0.0.1:${port}`,
  pakasirProject: "",
  pakasirMerchantId: "",
  pakasirApiKey: "",
  whatsappBotToken: "",
  whatsappBotUrl: "",
};
db.products = [
  {
    id: "prod-netflix-repair",
    name: "Netflix Premium",
    isActive: true,
    variants: [
      {
        id: "var-netflix-repair",
        name: "Sharing 1P1U",
        code: "NET-REPAIR",
        prices: { "1 Bulan": 25000 },
        snk: "Repair test.",
      },
    ],
  },
];
db.resellers = [
  {
    id: "res-val",
    name: "val",
    username: "val",
    email: "val@kavya.local",
    whatsapp: "6281234500009",
    password: "valpass123",
    isActive: true,
    deposit: 0,
    joinedAt: "2026-01-01",
  },
];
db.stock = [
  {
    id: "stk-netflix-repair-a",
    productId: "prod-netflix-repair",
    variantId: "var-netflix-repair",
    email: "same@vya.baby",
    password: "newpass999",
    profile: "Toast",
    pin: "1111",
    status: "sold",
    soldAt: "2026-07-07 19:47",
    createdAt: "2026-07-07 19:47",
    sheetSource: "google_sheets",
    sheetStockKey: "NETFLIX:1:same@vya.baby:toast",
    sheetName: "Netflix",
    sheetRow: 10,
  },
  {
    id: "stk-netflix-repair-b",
    productId: "prod-netflix-repair",
    variantId: "var-netflix-repair",
    email: "same@vya.baby",
    password: "oldpass111",
    profile: "Bagel",
    pin: "2222",
    status: "sold",
    soldAt: "2026-07-06 10:00",
    createdAt: "2026-07-06 10:00",
    sheetSource: "google_sheets",
    sheetStockKey: "NETFLIX:2:same@vya.baby:bagel",
    sheetName: "Netflix",
    sheetRow: 11,
  },
  {
    id: "stk-netflix-order-gap",
    productId: "prod-netflix-repair",
    variantId: "var-netflix-repair",
    email: "gap@vya.baby",
    password: "gap123456",
    profile: "Marc",
    pin: "3333",
    status: "sold",
    soldAt: "2026-07-08 12:00",
    createdAt: "2026-07-08 12:00",
    sheetSource: "google_sheets",
    sheetStockKey: "NETFLIX:3:gap@vya.baby:marc",
    sheetName: "Netflix",
    sheetRow: 12,
  },
];
db.orders = [
  {
    id: "ORD-REPAIR-CONSENSUS-A",
    paymentRef: "PAY-REPAIR-CONSENSUS-A",
    customer: "val",
    whatsapp: "6281234500009",
    resellerId: "res-val",
    reseller: "val",
    product: "Netflix Premium",
    productId: "prod-netflix-repair",
    variant: "Sharing 1P1U",
    variantId: "var-netflix-repair",
    variantCode: "NET-REPAIR",
    customerVariant: "Sharing 1P1U",
    customerVariantId: "var-netflix-repair",
    customerVariantCode: "NET-REPAIR",
    stockPoolKey: "prod-netflix-repair::var-netflix-repair",
    duration: "5 Hari",
    durationDays: 5,
    qty: 1,
    total: 20000,
    qrisStatus: "paid",
    orderStatus: "completed",
    deliveryStatus: "sent",
    createdAt: "2026-07-07 19:47",
    paidAt: "2026-07-07 19:47",
    expiresAt: "2026-07-12 19:47",
    deliveredStockIds: ["stk-netflix-repair-a"],
    source: "web",
  },
  {
    id: "ORD-REPAIR-CONSENSUS-B",
    paymentRef: "PAY-REPAIR-CONSENSUS-B",
    customer: "val",
    whatsapp: "6281234500009",
    resellerId: "res-val",
    reseller: "val",
    product: "Netflix Premium",
    productId: "prod-netflix-repair",
    variant: "Sharing 1P1U",
    variantId: "var-netflix-repair",
    variantCode: "NET-REPAIR",
    customerVariant: "Sharing 1P1U",
    customerVariantId: "var-netflix-repair",
    customerVariantCode: "NET-REPAIR",
    stockPoolKey: "prod-netflix-repair::var-netflix-repair",
    duration: "2 Hari",
    durationDays: 2,
    qty: 1,
    total: 10000,
    qrisStatus: "paid",
    orderStatus: "completed",
    deliveryStatus: "sent",
    createdAt: "2026-07-06 10:00",
    paidAt: "2026-07-06 10:00",
    expiresAt: "2026-07-08 10:00",
    deliveredStockIds: ["stk-netflix-repair-b"],
    source: "web",
  },
  {
    id: "ORD-REPAIR-BACKFILL",
    paymentRef: "PAY-REPAIR-BACKFILL",
    customer: "val",
    whatsapp: "6281234500009",
    resellerId: "res-val",
    reseller: "val",
    product: "Netflix Premium",
    productId: "prod-netflix-repair",
    variant: "Sharing 1P1U",
    variantId: "var-netflix-repair",
    variantCode: "NET-REPAIR",
    customerVariant: "Sharing 1P1U",
    customerVariantId: "var-netflix-repair",
    customerVariantCode: "NET-REPAIR",
    stockPoolKey: "prod-netflix-repair::var-netflix-repair",
    duration: "1 Bulan",
    durationDays: 30,
    qty: 1,
    total: 25000,
    qrisStatus: "paid",
    orderStatus: "completed",
    deliveryStatus: "sent",
    createdAt: "2026-07-08 12:00",
    paidAt: "2026-07-08 12:00",
    expiresAt: "2026-08-07 12:00",
    deliveredStockIds: ["stk-netflix-order-gap"],
    source: "web",
  },
];
db.payments = [];
db.activities = [];
db.managedAccounts = [
  {
    id: "acc-repair-consensus-a",
    stockId: "stk-netflix-repair-a",
    orderId: "ORD-REPAIR-CONSENSUS-A",
    sourceOrderId: "ORD-REPAIR-CONSENSUS-A",
    resellerId: "res-val",
    product: "Netflix Premium",
    productId: "prod-netflix-repair",
    variant: "Sharing 1P1U",
    variantId: "var-netflix-repair",
    variantCode: "NET-REPAIR",
    duration: "5 Hari",
    durationDays: 5,
    email: "same@vya.baby",
    password: "newpass999",
    buyer: "val",
    reseller: "val",
    whatsapp: "6281234500009",
    profile: "Toast",
    pin: "1111",
    source: "google_sheets",
    sheetSource: "google_sheets",
    sheetStockKey: "NETFLIX:1:same@vya.baby:toast",
    startedAt: "2026-07-07 19:47",
    expiresAt: "2026-07-12 19:47",
    status: "active",
    hidden: false,
  },
  {
    id: "acc-repair-consensus-b",
    stockId: "stk-netflix-repair-b",
    orderId: "ORD-REPAIR-CONSENSUS-B",
    sourceOrderId: "ORD-REPAIR-CONSENSUS-B",
    resellerId: "res-val",
    product: "Netflix Premium",
    productId: "prod-netflix-repair",
    variant: "Sharing 1P1U",
    variantId: "var-netflix-repair",
    variantCode: "NET-REPAIR",
    duration: "2 Hari",
    durationDays: 2,
    email: "same@vya.baby",
    password: "oldpass111",
    buyer: "val",
    reseller: "val",
    whatsapp: "6281234500009",
    profile: "Bagel",
    pin: "2222",
    source: "google_sheets",
    sheetSource: "google_sheets",
    sheetStockKey: "NETFLIX:2:same@vya.baby:bagel",
    startedAt: "2026-07-06 10:00",
    expiresAt: "2026-07-08 10:00",
    status: "active",
    hidden: false,
  },
];
db.whatsappMessages = [];

db.resellers.push({
  id: "res-bintang",
  name: "bintang",
  username: "bintang",
  email: "bintang@kavya.local",
  whatsapp: "6281234500010",
  password: "bintangpass123",
  isActive: true,
});
db.stock.push(
  {
    id: "stk-cross-daily",
    productId: "prod-netflix-repair",
    variantId: "var-netflix-repair",
    stockPoolKey: "prod-netflix-repair::var-netflix-repair",
    email: "cross@vya.baby",
    password: "crosspass",
    profile: "Grapes",
    pin: "4444",
    status: "sold",
    soldAt: "2026-07-13 10:37",
    soldDuration: "1 Hari",
    soldDurationDays: 1,
    soldExpiresAt: "2026-07-14 10:37",
    expiresAt: "2026-07-14 10:37",
    sheetSellerInput: "bintang",
    resellerId: "res-bintang",
    reseller: "bintang",
    sheetSource: "google_sheets",
    sheetStockKey: "NETFLIX:CROSS:DAILY",
  },
  {
    id: "stk-cross-monthly",
    productId: "prod-netflix-repair",
    variantId: "var-netflix-repair",
    stockPoolKey: "prod-netflix-repair::var-netflix-repair",
    email: "cross@vya.baby",
    password: "crosspass",
    profile: "Kiwi",
    pin: "5555",
    status: "sold",
    soldAt: "2026-07-13 10:55",
    soldDuration: "1 Bulan",
    soldDurationDays: 30,
    soldExpiresAt: "2026-08-12 10:55",
    expiresAt: "2026-08-12 10:55",
    sheetSellerInput: "bintang",
    resellerId: "res-bintang",
    reseller: "bintang",
    sheetSource: "google_sheets",
    sheetStockKey: "NETFLIX:CROSS:MONTHLY",
  },
);
db.orders.push(
  {
    id: "ORD-CROSS-DAILY",
    resellerId: "res-bintang",
    reseller: "bintang",
    whatsapp: "6281234500010",
    productId: "prod-netflix-repair",
    variantId: "var-netflix-repair",
    stockPoolKey: "prod-netflix-repair::var-netflix-repair",
    duration: "1 Hari",
    durationDays: 1,
    qty: 1,
    qrisStatus: "paid",
    orderStatus: "completed",
    deliveryStatus: "sent",
    createdAt: "2026-07-13 10:37",
    paidAt: "2026-07-13 10:37",
    deliveredStockIds: ["stk-cross-monthly"],
  },
  {
    id: "ORD-CROSS-MONTHLY",
    resellerId: "res-bintang",
    reseller: "bintang",
    whatsapp: "6281234500010",
    productId: "prod-netflix-repair",
    variantId: "var-netflix-repair",
    stockPoolKey: "prod-netflix-repair::var-netflix-repair",
    duration: "1 Bulan",
    durationDays: 30,
    qty: 1,
    qrisStatus: "paid",
    orderStatus: "completed",
    deliveryStatus: "sent",
    createdAt: "2026-07-13 10:55",
    paidAt: "2026-07-13 10:55",
    deliveredStockIds: ["stk-cross-daily"],
  },
);
db.managedAccounts.push(
  {
    id: "acc-cross-daily",
    stockId: "stk-cross-daily",
    orderId: "ORD-CROSS-MONTHLY",
    sourceOrderId: "ORD-CROSS-MONTHLY",
    resellerId: "res-bintang",
    productId: "prod-netflix-repair",
    variantId: "var-netflix-repair",
    email: "cross@vya.baby",
    password: "crosspass",
    profile: "Grapes",
    pin: "4444",
    duration: "1 Bulan",
    durationDays: 30,
    startedAt: "2026-07-13 10:55",
    expiresAt: "2026-08-12 10:55",
    reseller: "bintang",
    sheetSellerInput: "bintang",
    sheetSource: "google_sheets",
    sheetStockKey: "NETFLIX:CROSS:DAILY",
    status: "active",
  },
  {
    id: "acc-cross-monthly",
    stockId: "stk-cross-monthly",
    orderId: "ORD-CROSS-DAILY",
    sourceOrderId: "ORD-CROSS-DAILY",
    resellerId: "res-bintang",
    productId: "prod-netflix-repair",
    variantId: "var-netflix-repair",
    email: "cross@vya.baby",
    password: "crosspass",
    profile: "Kiwi",
    pin: "5555",
    duration: "1 Hari",
    durationDays: 1,
    startedAt: "2026-07-13 10:37",
    expiresAt: "2026-07-14 10:37",
    reseller: "bintang",
    sheetSellerInput: "bintang",
    sheetSource: "google_sheets",
    sheetStockKey: "NETFLIX:CROSS:MONTHLY",
    status: "active",
  },
);

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
  const rebuilt = (saved.managedAccounts || []).find((item) => item.orderId === "ORD-REPAIR-BACKFILL");
  if (!rebuilt) {
    throw new Error("Managed account untuk order completed yang hilang tidak berhasil dibangun ulang");
  }
  if (rebuilt.stockId !== "stk-netflix-order-gap" || rebuilt.email !== "gap@vya.baby") {
    throw new Error(`Managed account hasil backfill salah: ${JSON.stringify(rebuilt)}`);
  }

  const consensus = (saved.managedAccounts || []).filter((item) => item.email === "same@vya.baby" && !item.hidden);
  const toast = consensus.find((item) => item.profile === "Toast");
  const bagel = consensus.find((item) => item.profile === "Bagel");
  if (!toast || !bagel) {
    throw new Error(`Managed account Netflix tidak lengkap setelah repair: ${JSON.stringify(consensus)}`);
  }
  if (toast.password !== "newpass999" || bagel.password !== "oldpass111") {
    throw new Error(`Password Google Sheets tidak dipertahankan per row: ${JSON.stringify(consensus)}`);
  }

  const soldStock = (saved.stock || []).find((item) => item.id === "stk-netflix-order-gap");
  if (!soldStock) throw new Error("Stock hasil order gap hilang");
  if (soldStock.sheetOrderId !== "ORD-REPAIR-BACKFILL" || soldStock.buyer !== "val" || soldStock.reseller !== "val") {
    throw new Error(`Metadata sold stock belum sinkron: ${JSON.stringify(soldStock)}`);
  }

  const repairedDaily = saved.managedAccounts.find((item) => item.id === "acc-cross-daily");
  const repairedMonthly = saved.managedAccounts.find((item) => item.id === "acc-cross-monthly");
  const dailyOrder = saved.orders.find((item) => item.id === "ORD-CROSS-DAILY");
  const monthlyOrder = saved.orders.find((item) => item.id === "ORD-CROSS-MONTHLY");
  if (repairedDaily?.orderId !== dailyOrder.id || repairedDaily.durationDays !== 1 || repairedDaily.startedAt !== "2026-07-13 10:37") {
    throw new Error(`Relasi harian silang tidak diperbaiki: ${JSON.stringify(repairedDaily)}`);
  }
  if (repairedMonthly?.orderId !== monthlyOrder.id || repairedMonthly.durationDays !== 30 || repairedMonthly.startedAt !== "2026-07-13 10:55") {
    throw new Error(`Relasi bulanan silang tidak diperbaiki: ${JSON.stringify(repairedMonthly)}`);
  }
  if (JSON.stringify(dailyOrder.deliveredStockIds) !== JSON.stringify(["stk-cross-daily"]) || JSON.stringify(monthlyOrder.deliveredStockIds) !== JSON.stringify(["stk-cross-monthly"])) {
    throw new Error(`Delivered stock silang tidak diperbaiki: ${JSON.stringify([dailyOrder.deliveredStockIds, monthlyOrder.deliveredStockIds])}`);
  }

  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@kavya.local", password: "ownerpass123", role: "owner" }),
  });
  const loginPayload = await loginResponse.json();
  if (!loginResponse.ok || !loginPayload.token) throw new Error(`Login owner untuk audit gagal: ${JSON.stringify(loginPayload)}`);
  const authHeaders = { authorization: `Bearer ${loginPayload.token}` };
  const operationsResponse = await fetch(`http://127.0.0.1:${port}/api/operations/center`, { headers: authHeaders });
  const operations = await operationsResponse.json();
  if (!operationsResponse.ok || !operations.sheetsAudit?.summary || operations.sheetsAudit.summary.rowsRead < 2) {
    throw new Error(`Sheets row audit tidak tersedia: ${JSON.stringify(operations.sheetsAudit)}`);
  }
  const auditResponse = await fetch(`http://127.0.0.1:${port}/api/accounts/acc-cross-daily/audit`, { headers: authHeaders });
  const auditPayload = await auditResponse.json();
  if (!auditResponse.ok || auditPayload.orderId !== "ORD-CROSS-DAILY" || !auditPayload.timeline?.length) {
    throw new Error(`Account audit trail tidak benar: ${JSON.stringify(auditPayload)}`);
  }

  console.log("managed-account-repair-check OK");
  console.log("completed order rebuilt, google sheets password preserved per row, sold stock metadata synced");
  console.log("sheet row audit + account audit trail OK");
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
