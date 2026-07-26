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
  ownerEmail: "owner-check@kavya.local",
  ownerPassword: "owner-check-password",
  gmailClientSecret: "gmail-client-secret-check",
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
      email: "web-check@kavya.local",
      password: "check-password",
      role: "reseller",
    }),
  });
  const loginPayload = await loginResponse.json();
  if (!loginResponse.ok || !loginPayload?.token) {
    throw new Error(`Login reseller gagal: ${loginResponse.status} ${JSON.stringify(loginPayload)}`);
  }
  const browserLoginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: `http://127.0.0.1:${port}` },
    body: JSON.stringify({ email: "web-check@kavya.local", password: "check-password", role: "reseller", remember: true }),
  });
  const browserLoginPayload = await browserLoginResponse.json();
  const browserCookie = browserLoginResponse.headers.get("set-cookie") || "";
  if (!browserLoginResponse.ok || browserLoginPayload?.token || !/HttpOnly/i.test(browserCookie) || !/SameSite=Lax/i.test(browserCookie)) {
    throw new Error(`Browser cookie login tidak aman: ${browserLoginResponse.status} ${JSON.stringify(browserLoginPayload)} ${browserCookie}`);
  }
  const ownerLoginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner-check@kavya.local", password: "owner-check-password", role: "owner" }),
  });
  const ownerLoginPayload = await ownerLoginResponse.json();
  if (!ownerLoginResponse.ok || !ownerLoginPayload.token) throw new Error("Login owner regression gagal");
  const settingsResponse = await fetch(`http://127.0.0.1:${port}/api/owner-settings`, {
    headers: { authorization: `Bearer ${ownerLoginPayload.token}` },
  });
  const settingsPayload = await settingsResponse.json();
  if (!settingsResponse.ok || settingsPayload.gmail?.clientSecret !== "[stored]") {
    throw new Error(`Secret Settings owner belum dimask: ${JSON.stringify(settingsPayload.gmail || {})}`);
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
  const storedReseller = (saved.resellers || []).find((item) => item.id === "res-web-check");
  if (saved.settings?.ownerPassword || !saved.settings?.ownerPasswordHash || storedReseller?.password || !storedReseller?.passwordHash) {
    throw new Error("Migrasi password hash owner/reseller tidak tuntas");
  }
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

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const duplicatePaidResponse = await fetch(`http://127.0.0.1:${port}/api/orders/${encodeURIComponent(order.id)}/mark-paid`, {
      method: "POST",
      headers: { authorization: `Bearer ${ownerLoginPayload.token}` },
    });
    if (!duplicatePaidResponse.ok) {
      throw new Error(`Sinyal paid ulang gagal diproses secara idempotent: ${duplicatePaidResponse.status}`);
    }
  }
  const afterDuplicatePaid = JSON.parse(await fs.readFile(databasePath, "utf8"));
  const duplicateAccounts = (afterDuplicatePaid.managedAccounts || []).filter((item) => item.orderId === order.id && !item.hidden);
  const duplicatePaidOrder = (afterDuplicatePaid.orders || []).find((item) => item.id === order.id);
  if (duplicateAccounts.length !== 1 || duplicatePaidOrder?.deliveredStockIds?.length !== 1) {
    throw new Error(`Paid ulang menyebabkan double fulfillment: accounts=${duplicateAccounts.length}, stocks=${duplicatePaidOrder?.deliveredStockIds?.length || 0}`);
  }

  afterDuplicatePaid.stock.push({
    id: "stk-web-check-race",
    productId: "prod-web-check",
    variantId: "var-web-check",
    email: "web-check-race@kavya.local",
    password: "race-pass",
    profile: "RACE",
    pin: "7777",
    status: "available",
    createdAt: "2026-01-02 10:00",
  });
  const raceReseller = afterDuplicatePaid.resellers.find((item) => item.id === "res-web-check");
  raceReseller.deposit = Number(raceReseller.deposit || 0) + 20000;
  await fs.writeFile(databasePath, JSON.stringify(afterDuplicatePaid, null, 2));
  const raceRequest = () => fetch(`http://127.0.0.1:${port}/api/orders`, {
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
      customer: "Concurrent Buyer",
    }),
  });
  const raceResponses = await Promise.all([raceRequest(), raceRequest()]);
  const raceSuccessCount = raceResponses.filter((item) => item.status === 201).length;
  if (raceSuccessCount !== 1) {
    const payloads = await Promise.all(raceResponses.map((item) => item.json().catch(() => ({}))));
    throw new Error(`Checkout paralel harus tepat satu sukses, aktual ${raceSuccessCount}: ${JSON.stringify(payloads)}`);
  }
  const afterRace = JSON.parse(await fs.readFile(databasePath, "utf8"));
  const raceAccounts = (afterRace.managedAccounts || []).filter((item) => item.stockId === "stk-web-check-race" && !item.hidden);
  const raceOrders = (afterRace.orders || []).filter((item) => item.deliveredStockIds?.includes("stk-web-check-race"));
  if (raceAccounts.length !== 1 || raceOrders.length !== 1) {
    throw new Error(`Stok checkout paralel ter-drop ganda: accounts=${raceAccounts.length}, orders=${raceOrders.length}`);
  }

  const detailResponse = await fetch(`http://127.0.0.1:${port}/api/orders/${encodeURIComponent(order.id)}`, {
    headers: { authorization: `Bearer ${loginPayload.token}` },
  });
  const detailPayload = await detailResponse.json();
  if (!detailResponse.ok) {
    throw new Error(`GET /api/orders/:id gagal: ${detailResponse.status} ${JSON.stringify(detailPayload)}`);
  }
  if (!detailPayload.fulfillmentText) throw new Error("Detail order auth tidak memuat fulfillmentText");

  const publicTrackResponse = await fetch(`http://127.0.0.1:${port}/api/public/order-tracking`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ trackingToken: order.trackingToken }),
  });
  const publicTrackPayload = await publicTrackResponse.json();
  if (!publicTrackResponse.ok) {
    throw new Error(`POST /api/public/order-tracking gagal: ${publicTrackResponse.status} ${JSON.stringify(publicTrackPayload)}`);
  }
  if (publicTrackPayload.fulfillmentText || publicTrackPayload.snkText || publicTrackPayload.trackingToken) {
    throw new Error("Tracking publik membocorkan fulfillment detail atau tracking token");
  }

  const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
  const healthPayload = await healthResponse.json();
  if (healthPayload.databasePath || healthPayload.database || healthPayload.backup) {
    throw new Error("Health publik masih membocorkan path/database/backup server");
  }

  const fakeWebhookResponse = await fetch(`http://127.0.0.1:${port}/api/pakasir/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paymentRef: order.paymentRef, status: "paid" }),
  });
  if (![401, 503].includes(fakeWebhookResponse.status)) {
    throw new Error(`Webhook Pakasir tanpa secret tidak fail-closed: ${fakeWebhookResponse.status}`);
  }

  let rateLimitedStatus = 0;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const failedLogin = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "rate-limit-probe@kavya.local", password: "wrong-password", role: "reseller" }),
    });
    rateLimitedStatus = failedLogin.status;
  }
  if (rateLimitedStatus !== 429) throw new Error(`Login rate limit tidak aktif: ${rateLimitedStatus}`);

  console.log("web-order-check OK");
  console.log("web order create + fulfill OK");
  console.log("auth order detail OK");
  console.log("public order tracking sanitized OK");
  console.log("cookie/CORS/health/webhook/login hardening OK");
  console.log("deposit payment path OK");
  console.log("managed account + stock transition OK");
  console.log("active managed stock double-drop guard OK");
  console.log("duplicate paid idempotency OK");
  console.log("concurrent checkout single-stock guard OK");
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
