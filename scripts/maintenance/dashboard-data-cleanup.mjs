import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const applyChanges = process.argv.includes("--apply");
const jsonOutput = process.argv.includes("--json");
const dbArg = process.argv.find((arg) => arg.startsWith("--db="));
const backupArg = process.argv.find((arg) => arg.startsWith("--backup-dir="));

function loadRootEnv() {
  const envPath = path.join(rootDir, ".env");
  if (!fsSync.existsSync(envPath)) return;
  for (const rawLine of fsSync.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadRootEnv();

const runtimeDir = path.resolve(
  process.env.RUNTIME_PATH
    || process.env.RUNTIME_DIR
    || path.join(rootDir, "apps", "dashboard", "runtime"),
);

function firstExistingPath(paths) {
  return paths.find((candidate) => candidate && fsSync.existsSync(candidate));
}

const explicitDbPath = dbArg ? dbArg.slice("--db=".length) : process.env.DATABASE_PATH || "";
const fallbackRuntimeDir = path.join(rootDir, "apps", "dashboard", "runtime");
const legacyRuntimeDir = path.join(rootDir, "kavya-digital-dashboard", "runtime");
const dbPath = path.resolve(
  explicitDbPath
    || firstExistingPath([
      path.join(runtimeDir, "kavya-db.json"),
      path.join(fallbackRuntimeDir, "kavya-db.json"),
      path.join(legacyRuntimeDir, "kavya-db.json"),
    ])
    || path.join(runtimeDir, "kavya-db.json"),
);
const configuredBackupDir = process.env.RUNTIME_BACKUP_DIR ? path.resolve(process.env.RUNTIME_BACKUP_DIR) : "";
const backupDir = path.resolve(
  backupArg
    ? backupArg.slice("--backup-dir=".length)
    : configuredBackupDir && fsSync.existsSync(path.dirname(configuredBackupDir))
      ? configuredBackupDir
      : path.join(path.dirname(dbPath), "backups"),
);

function nowText() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function stampText() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function normalizeLower(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeWhatsapp(value = "") {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

function normalizeEmail(value = "") {
  return normalizeLower(value);
}

function makeId(prefix) {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${stamp}-${random}`;
}

function readArray(db, key) {
  if (!Array.isArray(db[key])) db[key] = [];
  return db[key];
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return raw.trim() ? JSON.parse(raw) : {};
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function textIncludesAny(value = "", needles = []) {
  const text = normalizeLower(value);
  return needles.some((needle) => text.includes(needle));
}

function productText(item = {}) {
  return [
    item.product,
    item.productId,
    item.productName,
    item.variant,
    item.variantId,
    item.variantCode,
    item.stockPoolKey,
    item.sheetPool,
    item.category,
  ].join(" ");
}

function isCanvaItem(item = {}) {
  return textIncludesAny(productText(item), ["canva"]) || item.accountType === "canva_link" || Boolean(item.canvaLink);
}

function isNetflixItem(item = {}) {
  const text = productText(item);
  return textIncludesAny(text, ["netflix"]) || /\bnet[-_]/i.test(text);
}

function isVisibleManagedAccount(account = {}) {
  return !account.hidden && !account.returnedToStockAt;
}

function parsedDateMs(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const text = String(value).trim();
  if (!text) return 0;
  const normalized = text
    .replace(",", "")
    .replace(/\bJanuari\b/i, "January")
    .replace(/\bFebruari\b/i, "February")
    .replace(/\bMaret\b/i, "March")
    .replace(/\bMei\b/i, "May")
    .replace(/\bJuni\b/i, "June")
    .replace(/\bJuli\b/i, "July")
    .replace(/\bAgustus\b/i, "August")
    .replace(/\bOktober\b/i, "October")
    .replace(/\bDesember\b/i, "December")
    .replace(/\bApr\b/i, "April")
    .replace(/\bAgu\b/i, "August")
    .replace(/\bOkt\b/i, "October")
    .replace(/\bDes\b/i, "December");
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function keepBestAccount(accounts = []) {
  return [...accounts].sort((a, b) => {
    const statusScore = (item) => {
      const status = normalizeLower(item.status);
      if (status === "active") return 4;
      if (status === "expiring") return 3;
      if (status === "expired") return 2;
      if (status === "replaced") return 1;
      return 0;
    };
    return (
      statusScore(b) - statusScore(a)
      || parsedDateMs(b.expiresAt) - parsedDateMs(a.expiresAt)
      || parsedDateMs(b.startedAt) - parsedDateMs(a.startedAt)
      || String(a.id || "").localeCompare(String(b.id || ""))
    );
  })[0];
}

function safeResellerScore(db, reseller) {
  const whatsapp = normalizeWhatsapp(reseller.whatsapp);
  const id = String(reseller.id || "");
  const orders = readArray(db, "orders").filter((order) => order.resellerId === id || normalizeWhatsapp(order.whatsapp) === whatsapp).length;
  const accounts = readArray(db, "managedAccounts").filter((account) => account.resellerId === id || normalizeWhatsapp(account.whatsapp) === whatsapp).length;
  const activities = readArray(db, "activities").filter((activity) => activity.resellerId === id || normalizeWhatsapp(activity.whatsapp) === whatsapp).length;
  return {
    orders,
    accounts,
    activities,
    deposit: Number(reseller.deposit || 0),
    score: (reseller.isActive === false ? 0 : 1000) + orders * 20 + accounts * 10 + activities + Number(reseller.deposit || 0) / 1000,
  };
}

function findOrderForActivity(db, activity) {
  const haystack = [activity.orderId, activity.paymentRef, activity.title, activity.description].join(" ");
  const orderMatch = haystack.match(/\bORD-[A-Z0-9-]+\b/i)?.[0]?.toUpperCase();
  const payMatch = haystack.match(/\bPAY-[A-Z0-9-]+\b/i)?.[0]?.toUpperCase();
  return readArray(db, "orders").find((order) => {
    return (
      (orderMatch && String(order.id || "").toUpperCase() === orderMatch)
      || (payMatch && String(order.paymentRef || "").toUpperCase() === payMatch)
    );
  }) || null;
}

function fixActivityOwnership(db) {
  const changes = [];
  for (const activity of readArray(db, "activities")) {
    const order = findOrderForActivity(db, activity);
    const account = activity.accountId
      ? readArray(db, "managedAccounts").find((item) => item.id === activity.accountId)
      : null;
    const targetResellerId = order?.resellerId || account?.resellerId || "";
    const targetWhatsapp = normalizeWhatsapp(order?.whatsapp || account?.whatsapp || "");
    if (!targetResellerId && !targetWhatsapp) continue;

    const before = {
      id: activity.id,
      resellerId: activity.resellerId || "",
      whatsapp: normalizeWhatsapp(activity.whatsapp || ""),
      orderId: activity.orderId || "",
    };
    const next = {
      resellerId: targetResellerId || activity.resellerId || "",
      whatsapp: targetWhatsapp || normalizeWhatsapp(activity.whatsapp || ""),
      orderId: order?.id || activity.orderId || "",
    };
    if (before.resellerId === next.resellerId && before.whatsapp === next.whatsapp && before.orderId === next.orderId) continue;

    activity.resellerId = next.resellerId;
    activity.whatsapp = next.whatsapp;
    activity.orderId = next.orderId;
    changes.push({ id: activity.id, title: activity.title || "", before, after: next });
  }
  return changes;
}

function hideDuplicateManagedAccounts(db) {
  const groups = new Map();
  for (const account of readArray(db, "managedAccounts")) {
    if (!isVisibleManagedAccount(account)) continue;
    const keys = [];
    if (account.stockId) keys.push(`stock:${account.stockId}`);
    if (account.sheetStockKey) keys.push(`sheet:${account.sheetStockKey}`);
    if (isCanvaItem(account)) {
      const orderId = account.orderId || account.sourceOrderId || "";
      const email = normalizeEmail(account.email);
      const whatsapp = normalizeWhatsapp(account.whatsapp);
      if (orderId && email) keys.push(`canva-order:${orderId}:${email}`);
      if (account.sheetRow && email) keys.push(`canva-sheet:${account.sheetName || "Canva"}:${account.sheetRow}:${email}`);
      if (!orderId && !account.sheetRow && email && account.startedAt && account.durationDays) {
        keys.push(`canva-usage:${email}:${account.startedAt}:${account.durationDays}:${whatsapp}`);
      }
    }
    for (const key of keys) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(account);
    }
  }

  const duplicateIds = new Set();
  const changes = [];
  for (const [key, accounts] of groups.entries()) {
    const unique = Array.from(new Map(accounts.map((account) => [account.id, account])).values());
    if (unique.length <= 1) continue;
    const keeper = keepBestAccount(unique);
    for (const account of unique) {
      if (account.id === keeper.id || duplicateIds.has(account.id)) continue;
      duplicateIds.add(account.id);
      account.hidden = true;
      account.duplicateHiddenAt = nowText();
      account.cleanupReason = `duplicate:${key}`;
      if (!["expired", "replaced", "disabled"].includes(normalizeLower(account.status))) account.status = "expired";
      changes.push({
        key,
        kept: keeper.id,
        hidden: account.id,
        email: account.email || "",
        product: account.product || "",
        reseller: account.reseller || account.whatsapp || "",
      });
    }
  }
  return changes;
}

function removeCanvaStockArtifacts(db) {
  const stock = readArray(db, "stock");
  const removed = [];
  db.stock = stock.filter((item) => {
    if (!isCanvaItem(item)) return true;
    const status = normalizeLower(item.status);
    const looksLikePoolArtifact = status === "available" || String(item.id || "").startsWith("canva-") || item.accountType === "canva_link";
    if (!looksLikePoolArtifact) return true;
    removed.push({
      id: item.id,
      email: item.email || "",
      status: item.status || "",
      product: item.product || item.productId || "",
      reason: "canva_stock_uses_pool_not_stock_row",
    });
    return false;
  });
  return removed;
}

function syncCompletedPaymentStatus(db) {
  const payments = readArray(db, "payments");
  const changes = [];
  for (const order of readArray(db, "orders")) {
    if (order.orderStatus !== "completed" && order.deliveryStatus !== "sent") continue;
    const payment = payments.find((item) => item.orderId === order.id || item.ref === order.paymentRef);
    if (!payment || payment.status === "paid") continue;
    const before = payment.status || "";
    payment.status = "paid";
    payment.paidAt = payment.paidAt || order.paidAt || order.completedAt || nowText();
    changes.push({ ref: payment.ref, orderId: order.id, before, after: "paid" });
  }
  return changes;
}

function normalizeExactDuplicateResellers(db) {
  const resellers = readArray(db, "resellers");
  const groups = new Map();
  for (const reseller of resellers) {
    const keys = [
      normalizeWhatsapp(reseller.whatsapp) ? `wa:${normalizeWhatsapp(reseller.whatsapp)}` : "",
      normalizeEmail(reseller.email) ? `email:${normalizeEmail(reseller.email)}` : "",
      normalizeLower(reseller.username) ? `username:${normalizeLower(reseller.username)}` : "",
    ].filter(Boolean);
    for (const key of keys) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(reseller);
    }
  }

  const handled = new Set();
  const deactivated = [];
  const ambiguous = [];
  for (const [key, group] of groups.entries()) {
    const unique = Array.from(new Map(group.map((item) => [item.id, item])).values());
    if (unique.length <= 1) continue;
    const ranked = unique
      .map((reseller) => ({ reseller, usage: safeResellerScore(db, reseller) }))
      .sort((a, b) => b.usage.score - a.usage.score);
    const keeper = ranked[0];
    for (const item of ranked.slice(1)) {
      const duplicate = item.reseller;
      if (handled.has(duplicate.id)) continue;
      const safeNoData = item.usage.orders === 0 && item.usage.accounts === 0 && item.usage.deposit === 0;
      if (!safeNoData) {
        ambiguous.push({
          key,
          keepCandidate: keeper.reseller.id,
          duplicateCandidate: duplicate.id,
          duplicateName: duplicate.name || duplicate.username || duplicate.email || "",
          usage: item.usage,
        });
        continue;
      }
      duplicate.isActive = false;
      duplicate.cleanupDuplicateOf = keeper.reseller.id;
      duplicate.cleanupAt = nowText();
      handled.add(duplicate.id);
      deactivated.push({
        key,
        kept: keeper.reseller.id,
        deactivated: duplicate.id,
        name: duplicate.name || duplicate.username || duplicate.email || "",
      });
    }
  }
  return { deactivated, ambiguous };
}

function collectWarnings(db) {
  const warnings = [];
  const resellerIds = new Set(readArray(db, "resellers").map((item) => item.id).filter(Boolean));
  const orderIds = new Set(readArray(db, "orders").map((item) => item.id).filter(Boolean));
  for (const account of readArray(db, "managedAccounts")) {
    if (account.resellerId && !resellerIds.has(account.resellerId)) {
      warnings.push({ type: "missing_reseller", accountId: account.id, resellerId: account.resellerId, email: account.email || "" });
    }
    if (!account.resellerId && normalizeLower(account.reseller) && !normalizeWhatsapp(account.whatsapp)) {
      warnings.push({ type: "reseller_name_only", accountId: account.id, reseller: account.reseller, email: account.email || "" });
    }
  }
  for (const payment of readArray(db, "payments")) {
    if (payment.orderId && !orderIds.has(payment.orderId)) {
      warnings.push({ type: "payment_without_order", ref: payment.ref, orderId: payment.orderId });
    }
  }
  return warnings.slice(0, 200);
}

async function backupDatabase(db) {
  await fs.mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `kavya-db-cleanup-${stampText()}.json`);
  await writeJson(backupPath, db);
  return backupPath;
}

async function main() {
  if (!fsSync.existsSync(dbPath)) {
    throw new Error(`Database tidak ditemukan: ${dbPath}`);
  }
  const original = await readJson(dbPath);
  const db = clone(original);
  const report = {
    success: true,
    mode: applyChanges ? "apply" : "dry-run",
    db_path: dbPath,
    backup_path: "",
    changes: {
      activity_owner_fixed: fixActivityOwnership(db),
      duplicate_managed_accounts_hidden: hideDuplicateManagedAccounts(db),
      canva_stock_artifacts_removed: removeCanvaStockArtifacts(db),
      completed_payment_status_fixed: syncCompletedPaymentStatus(db),
      exact_duplicate_resellers: normalizeExactDuplicateResellers(db),
    },
    warnings: [],
  };
  report.warnings = collectWarnings(db);

  const changedCount = Object.values(report.changes).reduce((sum, value) => {
    if (Array.isArray(value)) return sum + value.length;
    if (value && typeof value === "object") {
      return sum + Object.values(value).reduce((inner, item) => inner + (Array.isArray(item) ? item.length : 0), 0);
    }
    return sum;
  }, 0);
  report.changed_count = changedCount;

  if (applyChanges && changedCount > 0) {
    report.backup_path = await backupDatabase(original);
    await writeJson(dbPath, db);
  }

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Kavya dashboard data cleanup (${report.mode})`);
  console.log(`DB: ${report.db_path}`);
  if (report.backup_path) console.log(`Backup: ${report.backup_path}`);
  console.log(`Perubahan terdeteksi: ${changedCount}`);
  for (const [key, value] of Object.entries(report.changes)) {
    if (Array.isArray(value)) {
      console.log(`- ${key}: ${value.length}`);
      continue;
    }
    if (value && typeof value === "object") {
      const text = Object.entries(value).map(([name, item]) => `${name}=${Array.isArray(item) ? item.length : 0}`).join(", ");
      console.log(`- ${key}: ${text}`);
    }
  }
  if (report.warnings.length) {
    console.log(`Warnings: ${report.warnings.length} item perlu dicek manual`);
    for (const warning of report.warnings.slice(0, 10)) {
      console.log(`  - ${warning.type}: ${warning.email || warning.ref || warning.accountId || ""}`);
    }
  }
  if (!applyChanges) {
    console.log("Dry-run saja. Jalankan dengan --apply untuk menulis perubahan.");
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
