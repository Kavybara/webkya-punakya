import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { defaultData } from "../default-data.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-delivery-retry-check-"));
const databasePath = path.join(runtimeDir, "kavya-db.json");
const port = 4196;
const botPort = 4296;

const sentMessages = [];
const botServer = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/messages/send") {
    let body = "";
    for await (const chunk of req) body += chunk;
    sentMessages.push(JSON.parse(body || "{}"));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ success: true, messageKey: `msg-${sentMessages.length}` }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ success: false, error: "not_found" }));
});
await new Promise((resolve) => botServer.listen(botPort, "127.0.0.1", resolve));

const db = clone(defaultData);
db.settings = {
  ...(db.settings || {}),
  ownerEmail: "owner@kavya.local",
  ownerPassword: "ownerpass123",
  ownerWhatsAppNumber: "6280000000010",
  botPublicUrl: `http://127.0.0.1:${port}`,
  whatsappBotToken: "test-token",
  whatsappBotUrl: `http://127.0.0.1:${botPort}`,
  pakasirProject: "",
  pakasirMerchantId: "",
  pakasirApiKey: "",
};
db.orders = [
  {
    id: "ORD-RETRY-1",
    paymentRef: "PAY-RETRY-1",
    customer: "Retry Buyer",
    whatsapp: "628111000111",
    resellerId: "",
    reseller: "",
    product: "Netflix",
    productId: "prod-retry",
    variant: "1P1U",
    variantId: "var-retry",
    variantCode: "RETRY",
    customerVariant: "1P1U",
    customerVariantId: "var-retry",
    customerVariantCode: "RETRY",
    duration: "1 Bulan",
    durationDays: 30,
    qty: 1,
    total: 25000,
    qrisStatus: "paid",
    orderStatus: "completed",
    deliveryStatus: "sent",
    source: "web",
    createdAt: "2026-07-09 11:00",
    paidAt: "2026-07-09 11:01",
    expiresAt: "2026-08-08 11:01",
    fulfillmentText: "AKUN RETRY SIAP",
    whatsappNotificationStatus: "failed",
    whatsappNotificationError: "socket_closed",
  },
];
db.payments = [
  {
    ref: "PAY-RETRY-1",
    orderId: "ORD-RETRY-1",
    status: "paid",
    amount: 25000,
    provider: "pakasir",
    createdAt: "2026-07-09 11:00",
    paidAt: "2026-07-09 11:01",
  },
];
await fs.writeFile(databasePath, JSON.stringify(db, null, 2));

let failure = null;
try {
  process.env.DATABASE_PATH = databasePath;
  process.env.AUTH_SECRET = "kavya-regression-test-auth-secret-32-characters";
  process.env.PORT = String(port);
  process.env.PUBLIC_APP_URL = `http://127.0.0.1:${port}`;
  process.env.APP_PUBLIC_URL = `http://127.0.0.1:${port}`;
  process.env.OWNER_EMAIL = "owner@kavya.local";
  process.env.OWNER_PASSWORD = "ownerpass123";
  process.env.WHATSAPP_BOT_URL = `http://127.0.0.1:${botPort}`;
  process.env.WHATSAPP_BOT_TOKEN = "test-token";
  await import("../index.js");
  await delay(500);

  await delay(22_000);
  if (!sentMessages.length) {
    throw new Error("Fulfillment repair job tidak mengirim ulang pesan WhatsApp");
  }

  const saved = JSON.parse(await fs.readFile(databasePath, "utf8"));
  const order = (saved.orders || []).find((item) => item.id === "ORD-RETRY-1");
  if (!order) throw new Error("Order retry tidak ditemukan setelah save");
  if (order.whatsappNotificationStatus !== "sent") {
    throw new Error(`Status notif belum pulih: ${JSON.stringify(order)}`);
  }
  if (!order.whatsappNotificationSentAt || Number(order.whatsappNotificationAttemptCount || 0) < 1) {
    throw new Error(`Metadata attempt notif belum tersimpan: ${JSON.stringify(order)}`);
  }

  console.log("delivery-notification-retry-check OK");
  console.log("scheduled fulfillment repair resent failed whatsapp notification and repaired status");
} catch (error) {
  failure = error;
} finally {
  await new Promise((resolve) => botServer.close(resolve));
  await fs.rm(runtimeDir, { recursive: true, force: true }).catch(() => undefined);
  if (failure) {
    console.error(failure);
    process.exit(1);
  }
  process.exit(0);
}
