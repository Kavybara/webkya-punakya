import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { defaultData } from "../default-data.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-managed-account-dedupe-check-"));
const databasePath = path.join(runtimeDir, "kavya-db.json");
const port = 4193;

const db = clone(defaultData);
db.settings = {
  ...(db.settings || {}),
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
    id: "prod-netflix-dedupe",
    name: "Netflix Premium",
    description: "Produk test dedupe account.",
    isActive: true,
    variants: [
      {
        id: "var-netflix-dedupe",
        name: "Sharing 1P1U",
        code: "NET-DEDUPE",
        prices: { "1 Bulan": 25000 },
        snk: "S&K test dedupe.",
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
    id: "stk-netflix-dedupe",
    sheetStockKey: "NETFLIX_SHARED:24:marcdf@freenet.de:marc",
    productId: "prod-netflix-dedupe",
    variantId: "var-netflix-dedupe",
    email: "marcdf@freenet.de",
    password: "paaaoa101",
    profile: "Marc",
    pin: "2015",
    status: "sold",
    sheetSource: "google_sheets",
    soldAt: "2026-06-21 00:00",
    soldDuration: "3 Bulan",
    soldDurationDays: 90,
    createdAt: "2026-06-21 00:00",
  },
  {
    id: "stk-netflix-reuse-row",
    sheetStockKey: "NETFLIX_SHARED:25:marcdf@freenet.de:marc",
    productId: "prod-netflix-dedupe",
    variantId: "var-netflix-dedupe",
    email: "marcdf@freenet.de",
    password: "paaaoa101",
    profile: "Marc",
    pin: "2015",
    status: "sold",
    sheetSource: "google_sheets",
    soldAt: "2026-06-23 00:00",
    soldDuration: "1 Bulan",
    soldDurationDays: 30,
    createdAt: "2026-06-23 00:00",
  },
];
db.orders = [
  {
    id: "ORD-MQNYNFWE-11J3P",
    paymentRef: "PAY-MQNYNFWE-11J3P",
    customer: "neeca",
    whatsapp: "6281234500001",
    resellerId: "res-neeca",
    reseller: "neeca",
    product: "Netflix Premium",
    productId: "prod-netflix-dedupe",
    variant: "Sharing 1P1U",
    variantId: "var-netflix-dedupe",
    variantCode: "NET-DEDUPE",
    customerVariant: "Sharing 1P1U",
    customerVariantId: "var-netflix-dedupe",
    customerVariantCode: "NET-DEDUPE",
    stockPoolKey: "prod-netflix-dedupe::var-netflix-dedupe",
    duration: "3 Bulan",
    durationDays: 90,
    qty: 1,
    total: 78000,
    paymentDue: 0,
    qrisStatus: "paid",
    orderStatus: "completed",
    deliveryStatus: "sent",
    paymentMethod: "Deposit reseller",
    createdAt: "2026-06-21 00:00",
    paidAt: "2026-06-21 00:00",
    expiresAt: "2026-09-19 00:00",
    deliveredStockIds: ["stk-netflix-dedupe"],
    source: "web",
    channel: "Reseller",
  },
];
db.payments = [];
db.activities = [];
db.managedAccounts = [
  {
    id: "acc-web-duplicate",
    stockId: "stk-netflix-dedupe",
    orderId: "ORD-MQNYNFWE-11J3P",
    sourceOrderId: "ORD-MQNYNFWE-11J3P",
    resellerId: "res-neeca",
    product: "Netflix Premium",
    productId: "prod-netflix-dedupe",
    variant: "Sharing 1P1U",
    variantId: "var-netflix-dedupe",
    variantCode: "NET-DEDUPE",
    duration: "3 Bulan",
    durationDays: 90,
    email: "marcdf@freenet.de",
    password: "paaaoa101",
    buyer: "neeca",
    reseller: "neeca",
    whatsapp: "6281234500001",
    profile: "Marc",
    pin: "2015",
    source: "web_order",
    startedAt: "2026-06-21 00:00",
    expiresAt: "2026-09-19 00:00",
    status: "active",
    hidden: false,
  },
  {
    id: "acc-sheet-canonical",
    stockId: "stk-netflix-dedupe",
    sheetStockKey: "NETFLIX_SHARED:24:marcdf@freenet.de:marc",
    orderId: "ORD-MQNYNFWE-11J3P",
    sourceOrderId: "ORD-MQNYNFWE-11J3P",
    resellerId: "res-neeca",
    product: "Netflix Premium",
    productId: "prod-netflix-dedupe",
    variant: "Sharing 1P1U",
    variantId: "var-netflix-dedupe",
    variantCode: "NET-DEDUPE",
    duration: "3 Bulan",
    durationDays: 90,
    email: "marcdf@freenet.de",
    password: "paaaoa101",
    buyer: "neeca",
    reseller: "neeca",
    whatsapp: "6281234500001",
    profile: "Marc",
    pin: "2015",
    source: "google_sheets",
    sheetSource: "google_sheets",
    sheetName: "Netflix",
    sheetRow: 24,
    startedAt: "2026-06-21 00:00",
    expiresAt: "2026-09-19 00:00",
    status: "active",
    hidden: false,
  },
  {
    id: "acc-sheet-reuse-row",
    stockId: "stk-netflix-reuse-row",
    sheetStockKey: "NETFLIX_SHARED:25:marcdf@freenet.de:marc",
    orderId: "ORD-SHEET-REUSE-ROW",
    sourceOrderId: "ORD-SHEET-REUSE-ROW",
    resellerId: "res-neeca",
    product: "Netflix Premium",
    productId: "prod-netflix-dedupe",
    variant: "Sharing 1P1U",
    variantId: "var-netflix-dedupe",
    variantCode: "NET-DEDUPE",
    duration: "1 Bulan",
    durationDays: 30,
    email: "marcdf@freenet.de",
    password: "paaaoa101",
    buyer: "neeca",
    reseller: "neeca",
    whatsapp: "6281234500001",
    sheetSellerInput: "neeca",
    profile: "Marc",
    pin: "2015",
    source: "google_sheets",
    sheetSource: "google_sheets",
    sheetName: "Netflix",
    sheetRow: 25,
    startedAt: "2026-06-23 00:00",
    expiresAt: "2026-07-23 00:00",
    status: "active",
    hidden: false,
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
  if (!Array.isArray(accountsPayload) || accountsPayload.length !== 2) {
    throw new Error(`Reuse antarbaris Sheets ikut terhapus: ${JSON.stringify(accountsPayload)}`);
  }
  const visibleIds = new Set(accountsPayload.map((item) => item.id));
  if (!visibleIds.has("acc-sheet-canonical") || !visibleIds.has("acc-sheet-reuse-row")) {
    throw new Error(`Assignment Sheets yang tampil salah: ${JSON.stringify(accountsPayload)}`);
  }

  const saved = JSON.parse(await fs.readFile(databasePath, "utf8"));
  const webDuplicate = (saved.managedAccounts || []).find((item) => item.id === "acc-web-duplicate");
  const sheetCanonical = (saved.managedAccounts || []).find((item) => item.id === "acc-sheet-canonical");
  const sheetReuse = (saved.managedAccounts || []).find((item) => item.id === "acc-sheet-reuse-row");
  if (!webDuplicate || !sheetCanonical || !sheetReuse) throw new Error("Managed account hasil dedupe tidak lengkap");
  if (!webDuplicate.hidden || !webDuplicate.returnedToStockAt || webDuplicate.status !== "replaced") {
    throw new Error(`Akun duplikat belum diarsipkan benar: ${JSON.stringify(webDuplicate)}`);
  }
  if (webDuplicate.duplicateOfAccountId !== sheetCanonical.id) {
    throw new Error(`duplicateOfAccountId salah: ${webDuplicate.duplicateOfAccountId}`);
  }
  if (sheetReuse.hidden || sheetReuse.returnedToStockAt || sheetReuse.status !== "active") {
    throw new Error(`Reuse dari baris Sheets berbeda ikut diarsipkan: ${JSON.stringify(sheetReuse)}`);
  }

  console.log("managed-account-dedupe-check OK");
  console.log("duplicate local account archived; distinct Sheet assignments preserved");
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
