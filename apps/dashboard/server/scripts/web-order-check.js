import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { defaultData } from "../default-data.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-web-order-check-"));
const databasePath = path.join(runtimeDir, "kavya-db.json");
const port = 4189;

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
    id: "prod-web-check",
    name: "Web Order Check Product",
    description: "Produk test untuk checkout web reseller.",
    isActive: true,
    variants: [
      {
        id: "var-web-check",
        name: "Bulanan",
        code: "WEB-CHECK",
        prices: { "1 Bulan": 10000, "7 Hari": 4000 },
        snk: "S&K test web bulanan.",
      },
    ],
  },
];
db.resellers = [
  {
    id: "res-web-check",
    name: "Web Check Reseller",
    username: "web.check",
    email: "web-check@kavya.local",
    whatsapp: "6280000000098",
    password: "check-password",
    isActive: true,
    deposit: 50000,
    joinedAt: "2026-01-01",
  },
];
db.stock = [
  {
    id: "stk-web-check-locked",
    productId: "prod-web-check",
    variantId: "var-web-check",
    email: "web-check-locked@kavya.local",
    password: "locked-pass",
    profile: "LOCKED",
    pin: "9999",
    status: "available",
    createdAt: "2025-12-31 10:00",
  },
  {
    id: "stk-web-check-1",
    productId: "prod-web-check",
    variantId: "var-web-check",
    email: "web-check-1@kavya.local",
    password: "pass-1",
    profile: "P1",
    pin: "1111",
    status: "available",
    createdAt: "2026-01-01 10:00",
  },
];
db.orders = [];
db.payments = [];
db.activities = [];
db.managedAccounts = [{
  id: "acc-web-check-locked",
  stockId: "stk-web-check-locked",
  orderId: "ORD-HISTORICAL-LOCK",
  sourceOrderId: "ORD-HISTORICAL-LOCK",
  resellerId: "res-web-check",
  product: "Web Order Check Product",
  productId: "prod-web-check",
  variant: "Bulanan",
  variantId: "var-web-check",
  email: "web-check-locked@kavya.local",
  password: "locked-pass",
  profile: "LOCKED",
  status: "active",
  startedAt: "2026-01-01 10:00",
  expiresAt: "2027-01-01 10:00",
  duration: "12 Bulan",
  durationDays: 365,
  hidden: false,
}];
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
      email: "web-check@kavya.local",
      password: "check-password",
      role: "reseller",
    }),
  });
  const loginPayload = await loginResponse.json();
  if (!loginResponse.ok || !loginPayload?.token) {
    throw new Error(`Login reseller gagal: ${loginResponse.status} ${JSON.stringify(loginPayload)}`);
  }
  const response = await fetch(`http://127.0.0.1:${port}/api/orders`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${loginPayload.token}`,
    },
    body: JSON.stringify({
      productId: "prod-web-check",
      variantId: "var-web-check",
      duration: "1 Bulan",
      qty: 1,
      whatsapp: "6280000000098",
      customer: "Web Check Buyer",
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`POST /api/orders gagal: ${response.status} ${JSON.stringify(payload)}`);
  }
  const saved = JSON.parse(await fs.readFile(databasePath, "utf8"));
  const order = (saved.orders || [])[0];
  const payment = (saved.payments || [])[0];
  const account = (saved.managedAccounts || []).find((item) => item.orderId === order?.id);
  const stock = (saved.stock || []).find((item) => item.id === "stk-web-check-1");
  const lockedStock = (saved.stock || []).find((item) => item.id === "stk-web-check-locked");

  if (!order) throw new Error("Order web tidak tersimpan");
  if (order.source !== "web") throw new Error("Order source bukan web");
  if (order.duration !== "1 Bulan") throw new Error(`Durasi order salah: ${order.duration}`);
  if (order.deliveryStatus !== "sent") throw new Error(`Order web belum terkirim: ${order.deliveryStatus}`);
  if (!Array.isArray(order.deliveredStockIds) || order.deliveredStockIds.length !== 1) throw new Error("deliveredStockIds order web tidak benar");
  if (order.deliveredStockIds[0] !== "stk-web-check-1") throw new Error(`Guard double drop memilih stock yang masih aktif: ${JSON.stringify(order.deliveredStockIds)}`);
  if (!payment || payment.provider !== "deposit" || payment.status !== "paid") throw new Error("Pembayaran deposit web tidak tersimpan benar");
  if (!account || account.duration !== "1 Bulan" || account.resellerId !== "res-web-check") throw new Error("Managed account hasil order web tidak benar");
  if (account.orderId !== order.id || account.sourceOrderId !== order.id) throw new Error("Managed account web belum tertaut ke order");
  if (!stock || stock.status !== "sold") throw new Error(`Stok web tidak berpindah ke sold: ${stock?.status || "missing"}`);
  if (!lockedStock || lockedStock.status !== "available") throw new Error(`Stock terkunci ikut berubah: ${lockedStock?.status || "missing"}`);

  const detailResponse = await fetch(`http://127.0.0.1:${port}/api/orders/${encodeURIComponent(order.id)}`, {
    headers: { authorization: `Bearer ${loginPayload.token}` },
  });
  const detailPayload = await detailResponse.json();
  if (!detailResponse.ok) {
    throw new Error(`GET /api/orders/:id gagal: ${detailResponse.status} ${JSON.stringify(detailPayload)}`);
  }
  if (!detailPayload.fulfillmentText) throw new Error("Detail order auth tidak memuat fulfillmentText");

  const publicTrackResponse = await fetch(`http://127.0.0.1:${port}/api/public/orders/${encodeURIComponent(order.id)}`);
  const publicTrackPayload = await publicTrackResponse.json();
  if (!publicTrackResponse.ok) {
    throw new Error(`GET /api/public/orders/:id gagal: ${publicTrackResponse.status} ${JSON.stringify(publicTrackPayload)}`);
  }
  if (publicTrackPayload.fulfillmentText) throw new Error("Tracking publik masih membocorkan fulfillmentText");

  console.log("web-order-check OK");
  console.log("web order create + fulfill OK");
  console.log("auth order detail OK");
  console.log("public order tracking sanitized OK");
  console.log("deposit payment path OK");
  console.log("managed account + stock transition OK");
  console.log("active managed stock double-drop guard OK");
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
