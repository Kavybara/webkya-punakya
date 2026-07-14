import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { defaultData } from "../default-data.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-manual-order-check-"));
const databasePath = path.join(runtimeDir, "kavya-db.json");
const port = 4217;
const ownerPassword = "owner-check-password";
const ownerEmail = "owner@kavya.id";
function dateTimeText(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
const nowDate = new Date();
const now = dateTimeText(nowDate);
const expiresAt = dateTimeText(new Date(nowDate.getTime() + 30 * 60 * 1000));
const accountExpiresAt = dateTimeText(new Date(nowDate.getTime() + 30 * 86400000));

const db = clone(defaultData);
db.settings = {
  ...(db.settings || {}),
  ownerEmail,
  ownerWhatsAppNumber: "6280000000010",
  botPublicUrl: `http://127.0.0.1:${port}`,
};
db.products = [
  {
    id: "prod-manual-check",
    name: "Manual Approval Product",
    description: "Produk test approve manual.",
    isActive: true,
    needsProfile: true,
    needsPin: true,
    code: "MANUAL",
    variants: [
      {
        id: "var-manual-check",
        name: "Sharing 1P1U",
        code: "MANUAL-1P1U",
        prices: { "1 Bulan": 10000 },
        snk: "S&K test manual approval.",
      },
    ],
  },
];
db.resellers = [
  {
    id: "res-manual-check",
    name: "Manual Check Reseller",
    username: "manual.check",
    email: "manual-check@kavya.local",
    whatsapp: "6280000000099",
    password: "reseller-check-password",
    isActive: true,
    deposit: 0,
    joinedAt: "2026-01-01",
  },
];
db.stock = [
  {
    id: "stk-manual-check-1",
    productId: "prod-manual-check",
    variantId: "var-manual-check",
    email: "manual-check-1@kavya.local",
    password: "pass-1",
    profile: "P1",
    pin: "1111",
    status: "reserved",
    reservedFor: "ORD-MANUAL-CHECK",
    reservedUntil: expiresAt,
    reservedAt: now,
    createdAt: now,
  },
];
db.orders = [
  {
    id: "ORD-MANUAL-CHECK",
    paymentRef: "PAY-MANUAL-CHECK",
    customer: "Manual Check Buyer",
    whatsapp: "6280000000099",
    resellerId: "res-manual-check",
    reseller: "Manual Check Reseller",
    product: "Manual Approval Product",
    productId: "prod-manual-check",
    variant: "Sharing 1P1U",
    variantId: "var-manual-check",
    variantCode: "MANUAL-1P1U",
    customerVariant: "Sharing 1P1U",
    customerVariantId: "var-manual-check",
    customerVariantCode: "MANUAL-1P1U",
    stockPoolKey: "prod-manual-check::var-manual-check",
    duration: "1 Bulan",
    durationDays: 30,
    qty: 1,
    total: 10000,
    depositBefore: 0,
    depositUsed: 0,
    depositAfter: 0,
    paymentDue: 10000,
    email: "",
    customerEmails: [],
    device: "Smart TV Samsung",
    customerData: "",
    checkoutRequirements: { customerField: "device", required: true, minItems: 1, label: "Device Customer" },
    note: "",
    qrisStatus: "pending",
    orderStatus: "pending",
    deliveryStatus: "waiting_payment",
    channel: "Reseller",
    source: "web",
    stockPolicy: "pay_first",
    paymentMethod: "QRIS auto",
    createdAt: now,
    expiresAt: accountExpiresAt,
    paymentExpiresAt: expiresAt,
    deliveredStockIds: [],
    reservedStockIds: ["stk-manual-check-1"],
  },
];
db.payments = [
  {
    ref: "PAY-MANUAL-CHECK",
    orderId: "ORD-MANUAL-CHECK",
    status: "pending",
    amount: 10000,
    provider: "pakasir",
    createdAt: now,
    expiresAt,
    paymentUrl: "",
    qrisText: "dummy",
    qrString: "dummy",
  },
];
db.activities = [];
db.managedAccounts = [];
db.whatsappMessages = [];
await fs.writeFile(databasePath, JSON.stringify(db, null, 2));

let failure = null;
try {
  process.env.DATABASE_PATH = databasePath;
  process.env.PORT = String(port);
  process.env.PUBLIC_APP_URL = `http://127.0.0.1:${port}`;
  process.env.APP_PUBLIC_URL = `http://127.0.0.1:${port}`;
  process.env.OWNER_PASSWORD = ownerPassword;
  process.env.WHATSAPP_BOT_URL = "";
  process.env.WHATSAPP_BOT_TOKEN = "";
  await import("../index.js");
  await delay(500);

  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: ownerEmail,
      password: ownerPassword,
      role: "owner",
    }),
  });
  const loginPayload = await loginResponse.json();
  if (!loginResponse.ok || !loginPayload?.token) {
    throw new Error(`Login owner gagal: ${loginResponse.status} ${JSON.stringify(loginPayload)}`);
  }

  const response = await fetch(`http://127.0.0.1:${port}/api/orders/ORD-MANUAL-CHECK/approve-manual`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${loginPayload.token}`,
    },
    body: JSON.stringify({ reason: "order test recording" }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`POST /api/orders/:id/approve-manual gagal: ${response.status} ${JSON.stringify(payload)}`);
  }

  const saved = JSON.parse(await fs.readFile(databasePath, "utf8"));
  const order = (saved.orders || []).find((item) => item.id === "ORD-MANUAL-CHECK");
  const payment = (saved.payments || []).find((item) => item.ref === "PAY-MANUAL-CHECK");
  const account = (saved.managedAccounts || [])[0];
  const stock = (saved.stock || []).find((item) => item.id === "stk-manual-check-1");

  if (!order) throw new Error("Order manual tidak ditemukan setelah approve.");
  if (order.qrisStatus !== "manual") throw new Error(`qrisStatus tidak manual: ${order.qrisStatus}`);
  if (order.orderStatus !== "completed") throw new Error(`orderStatus tidak completed: ${order.orderStatus}`);
  if (order.deliveryStatus !== "sent") throw new Error(`deliveryStatus tidak sent: ${order.deliveryStatus}`);
  if (!order.manualApproved || order.manualApprovalReason !== "order test recording") throw new Error("Metadata manual approval tidak tersimpan benar.");
  if (!payment || payment.status !== "manual" || payment.providerStatus !== "owner_approved") throw new Error("Status payment manual tidak tersimpan benar.");
  if (!account || account.orderId !== order.id) throw new Error("Managed account hasil approve manual tidak terbentuk.");
  if (!stock || stock.status !== "sold") throw new Error(`Stok approve manual tidak berubah ke sold: ${stock?.status || "missing"}`);

  console.log("manual-order-approve-check OK");
  console.log("owner manual approval route OK");
  console.log("manual payment state persisted OK");
  console.log("stock + account fulfillment OK");
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
