import fs from "node:fs";
import path from "node:path";

function resolveDbPath() {
  const explicit = process.argv[2];
  if (explicit) return path.resolve(explicit);
  return path.resolve(process.cwd(), "runtime", "kavya-db.json");
}

function parseDb(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function hasExplicitClock(value = "") {
  return /\b\d{1,2}[:.]\d{2}\b/.test(String(value || ""));
}

function normalize(value = "") {
  return String(value || "").trim();
}

function stockKey(account = {}) {
  return normalize(account.sheetStockKey) || normalize(account.stockId);
}

function orderKey(account = {}) {
  return normalize(account.orderId) || normalize(account.sourceOrderId);
}

function compactAccount(account = {}) {
  return {
    id: account.id,
    source: account.source || "",
    product: account.product || "",
    email: account.email || "",
    stockId: account.stockId || "",
    sheetStockKey: account.sheetStockKey || "",
    sheetName: account.sheetName || "",
    sheetRow: account.sheetRow || 0,
    orderId: orderKey(account),
    reseller: account.reseller || "",
    startedAt: account.startedAt || "",
    expiresAt: account.expiresAt || "",
    status: account.status || "",
  };
}

const dbPath = resolveDbPath();
const db = parseDb(dbPath);
const accounts = Array.isArray(db.managedAccounts) ? db.managedAccounts : [];
const orders = Array.isArray(db.orders) ? db.orders : [];

const legacySheetRows = accounts
  .filter((account) => account.source === "google_sheets" && !orderKey(account))
  .map(compactAccount)
  .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));

const groupedByStock = new Map();
for (const account of accounts) {
  if (account.returnedToStockAt || String(account.status || "").toLowerCase() === "replaced") continue;
  const key = stockKey(account);
  if (!key) continue;
  const list = groupedByStock.get(key) || [];
  list.push(account);
  groupedByStock.set(key, list);
}

const webVsSheetDuplicates = [...groupedByStock.entries()]
  .map(([key, list]) => ({
    key,
    accounts: list.map(compactAccount),
  }))
  .filter(({ accounts: list }) => {
    if (list.length < 2) return false;
    const hasWeb = list.some((item) => item.source !== "google_sheets" && item.orderId);
    const hasSheet = list.some((item) => item.source === "google_sheets");
    return hasWeb && hasSheet;
  });

const midnightWebRows = accounts
  .filter((account) => account.source !== "google_sheets" && orderKey(account) && account.startedAt && !hasExplicitClock(account.startedAt))
  .map(compactAccount);

const suspiciousSyncedOrders = orders
  .filter((order) => order.source === "web" && order.googleSheetsSyncStatus === "synced")
  .map((order) => {
    const delivered = accounts.filter((account) => orderKey(account) === order.id);
    const shadows = delivered.filter((account) => {
      const key = stockKey(account);
      if (!key) return false;
      return accounts.some((candidate) => candidate !== account && candidate.source === "google_sheets" && stockKey(candidate) === key);
    });
    return {
      id: order.id,
      productName: order.productName || order.product || "",
      customer: order.customer || "",
      createdAt: order.createdAt || "",
      paidAt: order.paidAt || "",
      expiresAt: order.expiresAt || "",
      duration: order.duration || "",
      deliveredStockIds: order.deliveredStockIds || [],
      shadowCount: shadows.length,
    };
  })
  .filter((item) => item.shadowCount > 0);

const report = {
  dbPath,
  generatedAt: new Date().toISOString(),
  totals: {
    managedAccounts: accounts.length,
    legacySheetRows: legacySheetRows.length,
    webVsSheetDuplicates: webVsSheetDuplicates.length,
    midnightWebRows: midnightWebRows.length,
    suspiciousSyncedOrders: suspiciousSyncedOrders.length,
  },
  legacySheetRows,
  webVsSheetDuplicates,
  midnightWebRows,
  suspiciousSyncedOrders,
};

console.log(JSON.stringify(report, null, 2));
