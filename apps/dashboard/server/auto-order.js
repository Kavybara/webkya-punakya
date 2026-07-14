import { makeId, nowText, todayText } from "./store.js";
import { syncGoogleSheetsStock } from "./google-sheets.js";
import {
  durationAllowedForVariant,
  isCanvaProduct,
  isDailyDurationLabel,
  isLinkPoolProduct,
  isVariantOrderable,
  linkPoolAvailableCount,
  linkPoolsForVariant,
  normalizeDurationLabel,
  priceForDuration,
  resolveProductVariantByCode,
  stockForVariant,
  subscriptionDurationDays,
  variantStockGroupKey,
} from "./stock-groups.js";

export function formatRupiah(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  })
    .format(value)
    .replace("IDR", "Rp")
    .replace(/\u00a0/g, " ")
    .trim();
}

function normalize(text) {
  return String(text || "").trim();
}

function joinBotMessageLines(lines = []) {
  return lines
    .map((line) => String(line ?? "").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeWhatsappNumber(value = "") {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

function managedIdentityKey(account = {}) {
  const orderId = String(account.orderId || account.sourceOrderId || "").trim();
  const stockKey = String(account.stockId || account.sheetStockKey || "").trim();
  if (!orderId || !stockKey) return "";
  return `${stockKey}::${orderId}`;
}

function isLiveManagedAccount(account = {}) {
  if (!account || account.hidden || account.returnedToStockAt) return false;
  const status = String(account.status || "").toLowerCase();
  return !["expired", "replaced", "disabled"].includes(status);
}

function upsertManagedAccount(db, nextAccount = {}) {
  db.managedAccounts = db.managedAccounts || [];
  const identity = managedIdentityKey(nextAccount);
  const existing = identity
    ? (db.managedAccounts || []).find((account) => isLiveManagedAccount(account) && managedIdentityKey(account) === identity)
    : null;
  if (!existing) {
    db.managedAccounts.push(nextAccount);
    return nextAccount;
  }
  const preservedId = existing.id;
  const preservedSource = existing.source;
  Object.assign(existing, nextAccount, {
    id: preservedId,
    source: preservedSource || nextAccount.source || "",
    sheetSource: existing.sheetSource || nextAccount.sheetSource || "",
    sheetStockKey: existing.sheetStockKey || nextAccount.sheetStockKey || "",
    hidden: false,
  });
  delete existing.returnedToStockAt;
  return existing;
}

function whatsappNumberCandidates(...values) {
  const candidates = new Set();
  for (const value of values.flat(Infinity)) {
    for (const part of String(value || "").split(/[,\s]+/)) {
      const digits = part.replace(/[^\d]/g, "");
      const normalized = normalizeWhatsappNumber(digits);
      if (digits) candidates.add(digits);
      if (normalized) candidates.add(normalized);
    }
  }
  candidates.delete("");
  return candidates;
}

function resellerNumberCandidates(reseller = {}) {
  return whatsappNumberCandidates(
    reseller.whatsapp,
    reseller.phone,
    reseller.telepon,
    reseller.telp,
    reseller.contact,
    reseller.contactOwner,
    reseller.ownerNumber,
    reseller.number,
    reseller.whatsappNumber,
  );
}

function primaryResellerWhatsapp(reseller = {}) {
  return (
    normalizeWhatsappNumber(reseller.whatsapp) ||
    normalizeWhatsappNumber(reseller.phone) ||
    normalizeWhatsappNumber(reseller.telepon) ||
    normalizeWhatsappNumber(reseller.telp) ||
    normalizeWhatsappNumber(reseller.contact) ||
    [...resellerNumberCandidates(reseller)][0] ||
    ""
  );
}

function payloadNumberCandidates(payload = {}) {
  return whatsappNumberCandidates(
    payload.from,
    payload.sender,
    payload.whatsapp,
    payload.sender_number,
    payload.senderNumber,
    payload.phone,
    payload.sender_aliases,
    payload.senderAliases,
  );
}

function activeResellerByWhatsapp(db, whatsapp, payload = {}) {
  const candidates = new Set([...whatsappNumberCandidates(whatsapp), ...payloadNumberCandidates(payload)]);
  if (!candidates.size) return null;
  return (
    (db.resellers || []).find((reseller) => {
      if (reseller.isActive === false) return false;
      const resellerNumbers = resellerNumberCandidates(reseller);
      return [...resellerNumbers].some((number) => candidates.has(number));
    }) || null
  );
}

function resellerByIdentifier(db, value) {
  const source = normalize(value);
  const phone = normalizeWhatsappNumber(source);
  const username = source.toLowerCase();
  return (
    (db.resellers || []).find((reseller) => {
      return (
        normalize(reseller.id).toLowerCase() === username ||
        normalize(reseller.username).toLowerCase() === username ||
        (phone && resellerNumberCandidates(reseller).has(phone))
      );
    }) || null
  );
}

function ownerNumberSet(db) {
  return new Set(
    [
      db.settings?.ownerWhatsAppNumber,
      process.env.OWNER_WHATSAPP_NUMBER,
      process.env.OWNER_NUMBERS,
    ]
      .flatMap((value) => String(value || "").split(/[,\s]+/))
      .map((value) => normalizeWhatsappNumber(value))
      .filter(Boolean),
  );
}

function isOwnerCommand(db, payload) {
  const owners = ownerNumberSet(db);
  if (!owners.size) return false;
  const candidates = payloadNumberCandidates(payload);
  return [...candidates].some((number) => owners.has(number));
}

const resellerRequiredMessage =
  "Maaf, nomor WhatsApp kamu belum terdaftar sebagai reseller Kavya. Fitur stok dan order hanya untuk reseller aktif. Hubungi owner untuk daftar atau aktivasi reseller.";

function findVariantByCode(db, code) {
  return resolveProductVariantByCode(db, code);
}

function availableStock(db, productId, variantId) {
  const product = (db.products || []).find((item) => item.id === productId);
  const variant = product?.variants?.find((item) => item.id === variantId);
  if (!product || !variant) return [];
  if (isLinkPoolProduct(db, product, variant)) {
    const count = linkPoolsForVariant(db, product, variant)
      .reduce((total, pool) => total + linkPoolAvailableCount(db, pool), 0);
    if (count <= 0 && isCanvaProduct(product)) return stockForVariant(db, product, variant, "available");
    return Array.from({ length: count }, (_, index) => ({ id: `link-slot-${index}` }));
  }
  return stockForVariant(db, product, variant, "available");
}

function stockCount(db, productId, variantId, status) {
  const product = (db.products || []).find((item) => item.id === productId);
  const variant = product?.variants?.find((item) => item.id === variantId);
  if (!product || !variant) return 0;
  if (status === "available" && isLinkPoolProduct(db, product, variant)) {
    const count = linkPoolsForVariant(db, product, variant)
      .reduce((total, pool) => total + linkPoolAvailableCount(db, pool), 0);
    if (count <= 0 && isCanvaProduct(product)) return stockForVariant(db, product, variant, status).length;
    return count;
  }
  return stockForVariant(db, product, variant, status).length;
}

function activeOrderLock(product = {}, variant = null) {
  if (product?.orderLock?.enabled) {
    return {
      scope: "product",
      reason: String(product.orderLock.reason || "").trim(),
    };
  }
  if (variant?.orderLock?.enabled) {
    return {
      scope: "variant",
      reason: String(variant.orderLock.reason || "").trim(),
    };
  }
  return null;
}

function orderLockReply(product = {}, variant = null) {
  const lock = activeOrderLock(product, variant);
  if (!lock) return "";
  const target = lock.scope === "variant"
    ? `${product?.name || "Produk"} ${variant?.name || ""}`.trim()
    : product?.name || "Produk";
  return `Order untuk ${target} sedang dikunci owner.${lock.reason ? ` Alasan: ${lock.reason}` : ""}`;
}

function clearReservedStockState(stock) {
  stock.status = "available";
  delete stock.reservedFor;
  delete stock.reservedAccountId;
  delete stock.reservedUntil;
  delete stock.reservedAt;
}

function reserveAvailableStocksForOrder(db, order, product, variant, qty = 1) {
  if (isLinkPoolProduct(db, product, variant)) return [];
  const blockedStockIds = new Set((db.managedAccounts || [])
    .filter((account) => account && !account.hidden && !account.returnedToStockAt && !isTerminalManagedAccountStatus(account.status || ""))
    .filter((account) => String(account.orderId || account.sourceOrderId || "").trim() !== String(order.id || "").trim())
    .map((account) => String(account.stockId || "").trim())
    .filter(Boolean));
  const stocks = stockForVariant(db, product, variant, "available")
    .filter((stock) => !blockedStockIds.has(String(stock.id || "").trim()))
    .filter((stock) => !stockHasActiveManagedLink(db, stock, order.id))
    .slice(0, qty);
  if (stocks.length < qty) return [];
  const reservedAt = nowText();
  for (const stock of stocks) {
    stock.status = "reserved";
    stock.reservedFor = order.id;
    stock.reservedUntil = order.paymentExpiresAt || "";
    stock.reservedAt = reservedAt;
  }
  order.reservedStockIds = stocks.map((stock) => stock.id);
  return stocks;
}

function firstPrice(variant) {
  return priceForDuration(variant, "1 Bulan");
}

function compactDescription(product, variant) {
  const text = normalize(variant?.description || product?.description || "Baca S&K produk setelah membeli.");
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function ownerContact(db) {
  const raw =
    db.settings?.ownerWhatsAppNumber ||
    db.settings?.baileyBotNumber ||
    process.env.OWNER_WHATSAPP_NUMBER ||
    process.env.BACKUP_OWNER_NUMBER ||
    "";
  const normalized = normalizeWhatsappNumber(raw);
  return normalized ? `+${normalized}` : "Hubungi owner";
}

function dashboardPaymentUrl(db, paymentRef) {
  const baseUrl = normalize(db.settings?.botPublicUrl || process.env.PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || "http://127.0.0.1:4174").replace(/\/$/, "");
  return `${baseUrl}/api/payments/${paymentRef}`;
}

function dashboardAppUrl(db) {
  return normalize(db.settings?.botPublicUrl || process.env.PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || "http://127.0.0.1:4174").replace(/\/$/, "");
}

function resellerWebsiteOnlyReply(db) {
  const url = dashboardAppUrl(db);
  return joinBotMessageLines([
    "Order reseller via WhatsApp sudah dimatikan.",
    "Silakan lanjut lewat website dashboard reseller agar stok, durasi, dan sinkron Sheets memakai satu jalur.",
    "",
    `Buka: ${url}`,
  ]);
}

function depositBreakdown(reseller, total) {
  const depositBefore = Math.max(0, Number(reseller?.deposit || 0));
  const depositUsed = Math.min(depositBefore, Math.max(0, Number(total || 0)));
  return {
    depositBefore,
    depositUsed,
    depositAfter: Math.max(0, depositBefore - depositUsed),
    paymentDue: Math.max(0, Number(total || 0) - depositUsed),
  };
}

function parseQty(value) {
  const numericValue = Number(value || 1);
  if (!Number.isFinite(numericValue)) return 1;
  return Math.max(1, Math.floor(numericValue));
}

function splitCustomerEmails(value = "") {
  return String(value || "")
    .split(/[\s,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
}

function parseCanvaDurationAndEmails(text = "") {
  const emails = splitCustomerEmails(text);
  let durationText = String(text || "");
  for (const email of emails) {
    durationText = durationText.replace(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " ");
  }
  return { durationText: durationText.replace(/\s+/g, " ").trim(), emails };
}

function parseLinkPoolDurationAndEmails(text = "") {
  return parseCanvaDurationAndEmails(text);
}

function parseBuyNowArgs(body = "") {
  const args = commandArgs(body);
  const code = args[0] || "";
  let qty = 1;
  let durationText = "";

  if (args[1] && /^\d+$/.test(args[1])) {
    qty = parseQty(args[1]);
    durationText = args.slice(2).join(" ");
  } else {
    durationText = args.slice(1).join(" ");
  }

  return { code, qty, durationText };
}

function parseMoney(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) return 0;
  const amount = Number(digits);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.floor(amount));
}

function commandName(body) {
  return normalize(body).split(/\s+/)[0]?.replace(/^[.#]/, "").toLowerCase() || "";
}

function commandArgs(body) {
  const [, ...args] = normalize(body).split(/\s+/);
  return args;
}

function stockReply(db, from, payload = {}) {
  if (!activeResellerByWhatsapp(db, from, payload) && !isOwnerCommand(db, payload)) return resellerRequiredMessage;

  const blocks = [
    "╭────〔 BOT AUTO ORDER 〕─",
    "┊・Ketik: #buynow KODE JUMLAH DURASI",
    "┊・Contoh: #buynow 1p1u 1 2",
    "┊・Pastikan kode dan jumlah akun benar sebelum membuat order.",
    `┊・Contact Admin: ${ownerContact(db)}`,
    "╰┈┈┈┈┈┈┈┈",
  ];
  for (const product of db.products.filter((item) => item.isActive)) {
    for (const variant of product.variants || []) {
      if (!isVariantOrderable(product, variant) || activeOrderLock(product, variant)) continue;
      const count = availableStock(db, product.id, variant.id).length;
      if (count > 0) {
        const sold = stockCount(db, product.id, variant.id, "sold");
        const reserved = stockCount(db, product.id, variant.id, "reserved");
        blocks.push(
          "",
          `╭────〔 ${`${product.name} ${variant.name}`.toUpperCase()} 〕─`,
          `┊・Harga: ${firstPrice(variant) ? formatRupiah(firstPrice(variant)) : "Harga belum diatur"}`,
          `┊・Stok Tersedia: ${count}`,
          `┊・Stok Terjual: ${sold}`,
          `┊・Total Stok: ${count + sold + reserved}`,
          `┊・Kode: ${variant.code}`,
          `┊・Desk: ${compactDescription(product, variant)}`,
          "╰┈┈┈┈┈┈┈┈",
        );
      }
    }
  }
  if (blocks.length === 6) return "Stok ready sedang kosong. Cek lagi nanti atau hubungi owner.";
  return blocks.join("\n");
}

function addMinutesText(minutes, from = new Date()) {
  const date = new Date(from.getTime() + Number(minutes || 0) * 60000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function paymentTtlMinutes() {
  const minutes = Number(process.env.PAYMENT_TTL_MINUTES || 15);
  return Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 15;
}

function addDaysText(days, from = new Date()) {
  const date = new Date(from);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + Number(days || 0));
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function durationDays(duration) {
  return subscriptionDurationDays(duration);
}

function renderAccount(stock, product, variant) {
  const loginLabel = stock.loginPhone ? "Nomor Login" : "Email";
  const loginValue = stock.loginPhone || stock.email;
  const parts = [
    `Akun ${product.name} ${variant.name}`,
    `${loginLabel}: ${loginValue}`,
    `Password: ${stock.password}`,
  ];
  if (stock.otpEmail && stock.otpEmail !== stock.email) parts.push(`OTP Email: ${stock.otpEmail}`);
  if (stock.profile) parts.push(`Profile: ${stock.profile}`);
  if (stock.pin) parts.push(`PIN: ${stock.pin}`);
  if (stock.signInCode) parts.push(`Sign-in code: ${stock.signInCode}`);
  if (stock.verificationCode) parts.push(`Verification code: ${stock.verificationCode}`);
  return parts.join("\n");
}

function renderAccountLine(stock) {
  const loginLabel = stock.loginPhone ? "Nomor Login" : "Email";
  const loginValue = stock.loginPhone || stock.email;
  const lines = [`${loginLabel}: ${loginValue}`, `Password: ${stock.password}`];
  if (stock.otpEmail && stock.otpEmail !== stock.email) lines.push(`OTP Email: ${stock.otpEmail}`);
  if (stock.profile) lines.push(`Profile: ${stock.profile}`);
  if (stock.pin) lines.push(`PIN: ${stock.pin}`);
  if (stock.signInCode) lines.push(`Sign-in code: ${stock.signInCode}`);
  if (stock.verificationCode) lines.push(`Verification code: ${stock.verificationCode}`);
  return lines.join("\n");
}

function renderTransactionTime(value) {
  const date = value ? new Date(String(value).replace(" ", "T")) : new Date();
  if (Number.isNaN(date.getTime())) return nowText();
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(date)
    .replace(".", ":");
}

function renderSuccessReceipt({ order, stocks, product, variant, payment }) {
  const accountLines = stocks
    .map((stock, index) => [`${index + 1}. ${renderAccountLine(stock)}`].join("\n"))
    .join("\n\n");

  return [
    "DETAIL AKUN",
    accountLines,
  ].join("\n");
}

function renderCanvaReceipt({ order, accounts, pool, product, variant, payment }) {
  return renderLinkPoolReceipt({ order, accounts, product, variant, payment, fallbackLink: pool?.link || "" });
}

function renderLinkPoolReceipt({ order, accounts, product, variant, payment, fallbackLink = "" }) {
  const isCanva = isCanvaProduct(product);
  const linkLabel = isCanva ? "Link Canva" : "Link";
  const usageLines = accounts
    .map((account, index) => {
      const lines = [
        `${index + 1}. Email Customer: ${account.email}`,
        `${linkLabel}: ${account.canvaLink || account.password || fallbackLink}`,
      ];
      if (!isCanva) lines.push(`Expired: ${account.expiresAt || "-"}`);
      return lines.join("\n");
    })
    .join("\n\n");

  return [
    isCanva ? "DETAIL CANVA" : "DETAIL LINK",
    usageLines,
  ].join("\n");
}

function allocateLinkPoolSlots(db, product, variant, qty = 1) {
  const slots = [];
  for (const pool of linkPoolsForVariant(db, product, variant)) {
    const available = linkPoolAvailableCount(db, pool);
    for (let index = 0; index < available && slots.length < qty; index += 1) {
      slots.push(pool);
    }
    if (slots.length >= qty) break;
  }
  return slots;
}

function updateLinkPoolsAfterAllocation(allocatedPools = []) {
  const counts = new Map();
  for (const pool of allocatedPools) {
    counts.set(pool.id, { pool, count: (counts.get(pool.id)?.count || 0) + 1 });
  }
  for (const { pool, count } of counts.values()) {
    const quota = Math.max(0, Math.floor(Number(pool.quota || 0)));
    const previousUsed = Number(pool.used);
    const previousAvailable = Number(pool.available);
    const nextUsed = Number.isFinite(previousUsed) && previousUsed >= 0 ? previousUsed + count : count;
    const nextAvailable = Number.isFinite(previousAvailable) && previousAvailable >= 0
      ? Math.max(0, previousAvailable - count)
      : Math.max(0, quota - nextUsed);
    pool.used = nextUsed;
    pool.available = nextAvailable;
    pool.lastUsedAt = nowText();
  }
}

function snkBodyForDuration(variant = {}, duration = "") {
  const fallback = "Dilarang ubah email, password, profil, PIN, payment, atau data akun tanpa izin owner. Garansi diproses jika mengikuti S&K produk.";
  const monthlySnk = normalize(variant.snkMonthly || variant.monthlySnk || variant.snk);
  const dailySnk = normalize(variant.snkDaily || variant.dailySnk);

  if (isDailyDurationLabel(duration)) {
    return dailySnk || monthlySnk || fallback;
  }
  return monthlySnk || dailySnk || fallback;
}

function renderSnkMessage(product, variant, duration = "") {
  const title = `S&K ${product.name} ${variant.name}${duration ? ` - ${duration}` : ""}`;
  return [
    title,
    "",
    snkBodyForDuration(variant, duration),
  ].join("\n");
}

function fillLegacySnkLine(body = "", label = "", value = "") {
  if (!value) return body;
  const pattern = new RegExp(`(^${label}\\s*:\\s*)(?:-|)?\\s*$`, "gim");
  return body.replace(pattern, `$1${value}`);
}

function renderSnkMessageWithContext(product, variant, duration = "", context = {}) {
  const title = `S&K ${product.name} ${variant.name}${duration ? ` - ${duration}` : ""}`;
  const rawBody = snkBodyForDuration(variant, duration);
  let body = renderTemplateText(rawBody, context);
  body = fillLegacySnkLine(body, "Phone", context.phone || context.loginPhone || "");
  body = fillLegacySnkLine(body, "Nomor Login", context.phone || context.loginPhone || "");
  body = fillLegacySnkLine(body, "OTP Email", context.otpEmail || context.email || "");
  body = fillLegacySnkLine(body, "Email", context.otpEmail || context.email || "");
  body = fillLegacySnkLine(body, "Profil", context.profile || "");
  body = fillLegacySnkLine(body, "Profile", context.profile || "");
  body = fillLegacySnkLine(body, "Sewa Berakhir", context.expiresAt || "");
  body = fillLegacySnkLine(body, "Expired", context.expiresAt || "");
  return [
    title,
    "",
    body,
  ].join("\n");
}

function deliveryTemplateFor(product = {}, variant = {}) {
  return normalize(variant?.deliveryTemplate || product?.messageTemplates?.delivery || "");
}

function renderTemplateText(template = "", context = {}) {
  return normalize(template).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => {
    const value = context[key];
    if (value === null || value === undefined) return "";
    return String(value);
  });
}

function accountDetailLines(items = [], { linkLabel = "Link" } = {}) {
  return items
    .map((item, index) => {
      const passwordOrLink = item.canvaLink || item.link || item.password || "";
      const loginLabel = item.loginPhone ? "Nomor Login" : "Email";
      const lines = [`${index + 1}. ${loginLabel}: ${item.loginPhone || item.email || "-"}`];
      if (item.otpEmail && item.otpEmail !== item.email) lines.push(`OTP Email: ${item.otpEmail}`);
      if (passwordOrLink) lines.push(`${linkLabel}: ${passwordOrLink}`);
      if (item.profile) lines.push(`Profile: ${item.profile}`);
      if (item.pin) lines.push(`PIN: ${item.pin}`);
      if (item.device) lines.push(`Device: ${item.device}`);
      if (item.expiresAt) lines.push(`Expired: ${item.expiresAt}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

function derivePaymentTotal(amount = 0, fee = 0, providerTotal = 0) {
  const nominal = Math.max(0, Number(amount || 0));
  const adminFee = Math.max(0, Number(fee || 0));
  const reportedTotal = Math.max(0, Number(providerTotal || 0));
  const computedTotal = nominal > 0 ? nominal + adminFee : 0;
  return Math.max(reportedTotal, computedTotal);
}

function renderDeliveryWithTemplate({ defaultText, order, product, variant, payment, accounts = [], stocks = [], snkText = "" }) {
  const template = deliveryTemplateFor(product, variant);
  if (!template) return defaultText;

  const first = accounts[0] || stocks[0] || {};
  const linkLabel = isCanvaProduct(product) ? "Link Canva" : "Link";
  const items = accounts.length ? accounts : stocks;
  const fee = Number(payment?.fee || order.paymentFee || 0);
  const qrisPaid = payment?.provider === "deposit" ? 0 : derivePaymentTotal(payment?.amount || order.paymentDue || 0, fee, payment?.totalPayment || 0);
  const totalPaid = Number(order.totalPaid || Number(order.depositUsed || 0) + qrisPaid || order.total || 0);
  const passwordOrLink = first.canvaLink || first.link || first.password || "";
  const context = {
    orderId: order.id || "",
    product: product.name || "",
    productName: product.name || "",
    variant: order.customerVariant || order.variant || variant.name || "",
    variantName: order.customerVariant || order.variant || variant.name || "",
    variantCode: order.customerVariantCode || order.variantCode || variant.code || "",
    qty: order.qty || items.length || 1,
    buyer: order.customer || "",
    customer: order.customer || "",
    whatsapp: normalizeWhatsappNumber(order.whatsapp || ""),
    duration: order.duration || "",
    durationDays: order.durationDays || durationDays(order.duration),
    expiresAt: order.expiresAt || first.expiresAt || "",
    device: order.device || first.device || "",
    loginPhone: first.loginPhone || "",
    phone: first.loginPhone || "",
    otpEmail: first.otpEmail || first.email || "",
    email: first.email || "",
    password: first.password || "",
    link: first.canvaLink || first.link || first.password || "",
    passwordOrLink,
    profile: first.profile || "",
    pin: first.pin || "",
    price: formatRupiah(order.total || 0),
    total: formatRupiah(order.total || 0),
    fee: formatRupiah(fee),
    totalPaid: formatRupiah(totalPaid),
    paymentMethod: payment?.paymentMethod || order.paymentMethod || "QRIS auto",
    transactionTime: renderTransactionTime(order.paidAt || nowText()),
    accountDetails: accountDetailLines(items, { linkLabel }),
    accounts: accountDetailLines(items, { linkLabel }),
    snk: snkText,
  };

  const rendered = renderTemplateText(template, context);
  return rendered || defaultText;
}

function snkTemplateContext({ order, product, variant, items = [] }) {
  const first = items[0] || {};
  return {
    orderId: order.id || "",
    product: product.name || "",
    productName: product.name || "",
    variant: order.customerVariant || order.variant || variant.name || "",
    variantName: order.customerVariant || order.variant || variant.name || "",
    duration: order.duration || "",
    durationDays: order.durationDays || durationDays(order.duration),
    expiresAt: order.expiresAt || first.expiresAt || "",
    device: order.device || first.device || "",
    email: first.email || "",
    otpEmail: first.otpEmail || first.email || "",
    phone: first.loginPhone || "",
    loginPhone: first.loginPhone || "",
    password: first.password || "",
    profile: first.profile || "",
    pin: first.pin || "",
    customer: order.customer || "",
    buyer: order.customer || "",
  };
}

export function buildOrderCreatedReply({ order, productName, variantName, qty, price, fee = 0, totalPayment, ttlMinutes = paymentTtlMinutes() } = {}) {
  const quantity = parseQty(qty || order?.qty || 1);
  const unitPrice = Number(price || 0);
  const paymentFee = Number(fee || 0);
  const total = derivePaymentTotal(order?.paymentDue ?? order?.total ?? 0, paymentFee, totalPayment || 0);
  return joinBotMessageLines([
    `Order dibuat: ${order?.id || ""}`,
    `Produk : ${[productName || order?.product, variantName || order?.variant].filter(Boolean).join(" ")}`,
    `Qty : ${quantity}`,
    `Harga : ${formatRupiah(unitPrice)}`,
    `Fee : ${formatRupiah(paymentFee)}`,
    `Total : ${formatRupiah(total)}`,
    "",
    `Qris ini hanya aktif selama ${ttlMinutes} menit jika tidak maka akan otomatis tercancel`,
  ]);
}

export function buildDepositCreatedReply({ order, fee = 0, totalPayment, ttlMinutes = paymentTtlMinutes() } = {}) {
  const amount = Number(order?.paymentDue ?? order?.total ?? 0);
  const paymentFee = Number(fee || 0);
  const total = Number(totalPayment ?? amount + paymentFee);
  return joinBotMessageLines([
    `Deposit dibuat: ${order?.id || ""}`,
    `Nominal : ${formatRupiah(amount)}`,
    `Fee : ${formatRupiah(paymentFee)}`,
    `Total : ${formatRupiah(total)}`,
    "",
    `Qris ini hanya aktif selama ${ttlMinutes} menit jika tidak maka akan otomatis tercancel`,
  ]);
}

function renderDepositPaidReply({ order, reseller, amount, depositBefore, depositAfter, payment }) {
  return joinBotMessageLines([
    "Deposit Berhasil",
    "",
    "Saldo reseller sudah bertambah.",
    "",
    `Reseller : ${reseller?.name || reseller?.username || primaryResellerWhatsapp(reseller)}`,
    `Nomor : ${primaryResellerWhatsapp(reseller)}`,
    `Nominal : ${formatRupiah(amount)}`,
    `Saldo Sebelum : ${formatRupiah(depositBefore)}`,
    `Saldo Sekarang : ${formatRupiah(depositAfter)}`,
    `Ref : ${order?.id || payment?.ref || ""}`,
    "",
    "Saldo sudah bisa dipakai untuk order.",
  ]);
}

function renderStockRaceDepositReply({ order, amount, depositBefore, depositAfter }) {
  return joinBotMessageLines([
    "Stok Habis - Saldo Bertambah",
    "",
    "Pembayaran sudah diterima, tapi stok produk sudah habis karena sistem rebutan stok.",
    "",
    `Order : ${order?.id || ""}`,
    `Produk : ${[order?.product, order?.variant].filter(Boolean).join(" ")}`,
    `Qty : ${order?.qty || 1}`,
    `Nominal : ${formatRupiah(amount)}`,
    `Saldo Sebelum : ${formatRupiah(depositBefore)}`,
    `Saldo Sekarang : ${formatRupiah(depositAfter)}`,
    "",
    "Saldo ini bisa dipakai untuk order berikutnya.",
  ]);
}

function fulfillDepositTopup(db, order) {
  if (order.deliveryStatus === "sent") {
    return { ok: true, reply: order.fulfillmentText || `Deposit ${order.id} sudah pernah diproses.`, order };
  }

  const reseller = (db.resellers || []).find((item) => item.id === order.resellerId) || activeResellerByWhatsapp(db, order.whatsapp);
  if (!reseller) {
    order.deliveryStatus = "failed";
    order.deliveryError = "Reseller deposit tidak ditemukan.";
    return { ok: false, reply: "Reseller deposit tidak ditemukan.", order };
  }

  const payment = (db.payments || []).find((item) => item.orderId === order.id || item.ref === order.paymentRef) || null;
  const amount = Math.max(0, Number(order.depositAdded || order.paymentDue || payment?.amount || order.total || 0));
  if (!amount) {
    order.deliveryStatus = "failed";
    order.deliveryError = "Nominal deposit tidak valid.";
    return { ok: false, reply: "Nominal deposit tidak valid.", order };
  }

  const paidAt = nowText();
  const depositBefore = order.depositCredited ? Number(order.depositBefore || 0) : Math.max(0, Number(reseller.deposit || 0));
  const depositAfter = order.depositCredited ? Number(order.depositAfter || reseller.deposit || 0) : depositBefore + amount;

  if (!order.depositCredited) {
    reseller.deposit = depositAfter;
    order.depositCredited = true;
    order.depositCreditedAt = paidAt;
  }

  order.depositBefore = depositBefore;
  order.depositAdded = amount;
  order.depositAfter = depositAfter;
  order.qrisStatus = "paid";
  order.orderStatus = "completed";
  order.deliveryStatus = "sent";
  order.paidAt = order.paidAt || paidAt;
  order.paymentMethod = payment?.paymentMethod || order.paymentMethod || "QRIS top up saldo";
  order.totalPaid = derivePaymentTotal(payment?.amount || amount, payment?.fee || order.paymentFee || 0, payment?.totalPayment || 0);
  order.fulfillmentText = renderDepositPaidReply({ order, reseller, amount, depositBefore, depositAfter, payment });

  if (payment) {
    payment.status = "paid";
    payment.paidAt = payment.paidAt || paidAt;
    payment.depositBefore = depositBefore;
    payment.depositAdded = amount;
    payment.depositAfter = depositAfter;
    payment.resellerId = reseller.id;
    payment.resellerWhatsapp = primaryResellerWhatsapp(reseller);
    payment.paymentMethod = order.paymentMethod;
  }

  const linkedDepositRequest = (db.depositRequests || []).find((item) =>
    item && (
      item.orderId === order.id
      || item.paymentRef === order.paymentRef
      || item.id === order.id
    ),
  );
  if (linkedDepositRequest) {
    linkedDepositRequest.status = "approved";
    linkedDepositRequest.reviewedAt = linkedDepositRequest.reviewedAt || paidAt;
    linkedDepositRequest.reviewedBy = linkedDepositRequest.reviewedBy || "pakasir";
    linkedDepositRequest.paymentStatus = "paid";
    linkedDepositRequest.deliveryStatus = "paid";
    linkedDepositRequest.orderId = order.id;
    linkedDepositRequest.paymentRef = order.paymentRef;
  }

  db.activities = db.activities || [];
  db.activities.unshift({
    id: makeId("act"),
    type: "reseller",
    title: "Deposit reseller berhasil",
    description: `${formatRupiah(amount)} masuk ke saldo ${reseller.name || reseller.username || primaryResellerWhatsapp(reseller)}. Saldo sekarang ${formatRupiah(depositAfter)}.`,
    createdAt: paidAt,
    orderId: order.id,
    resellerId: reseller.id,
    whatsapp: primaryResellerWhatsapp(reseller),
  });

  return { ok: true, reply: order.fulfillmentText, order };
}

function convertUnavailablePaidOrderToDeposit(db, order) {
  const reseller = (db.resellers || []).find((item) => item.id === order.resellerId) || activeResellerByWhatsapp(db, order.whatsapp);
  if (!reseller) {
    order.deliveryStatus = "failed";
    order.deliveryError = "Stok habis dan reseller tidak ditemukan untuk kredit deposit.";
    return { ok: false, reply: "Stok habis dan reseller tidak ditemukan untuk kredit deposit.", order };
  }

  if (order.deliveryStatus === "stock_unavailable_deposit" && order.stockRaceDepositCredited) {
    return {
      ok: true,
      reply: order.fulfillmentText || "Pembayaran sudah dikreditkan ke saldo reseller karena stok habis.",
      order,
    };
  }

  const payment = (db.payments || []).find((item) => item.orderId === order.id || item.ref === order.paymentRef) || null;
  const amount = Math.max(0, Number(order.total || 0));
  const creditedAt = nowText();
  const depositBefore = Math.max(0, Number(reseller.deposit || 0));
  const depositAfter = depositBefore + amount;

  for (const stock of db.stock || []) {
    if (stock.reservedFor !== order.id) continue;
    clearReservedStockState(stock);
  }

  reseller.deposit = depositAfter;
  order.qrisStatus = settledQrisStatus(order);
  order.orderStatus = "cancelled";
  order.deliveryStatus = "stock_unavailable_deposit";
  order.deliveryError = "Stok habis saat pembayaran terkonfirmasi. Dana dikreditkan ke saldo reseller.";
  order.paidAt = order.paidAt || creditedAt;
  order.stockRaceDepositCredited = true;
  order.stockRaceDepositCreditedAt = creditedAt;
  order.stockRaceDepositAmount = amount;
  order.depositAfter = depositAfter;
  order.fulfillmentText = renderStockRaceDepositReply({ order, amount, depositBefore, depositAfter });
  if (payment) {
    payment.status = "paid";
    payment.paidAt = payment.paidAt || creditedAt;
    payment.stockRaceDepositCredited = true;
    payment.stockRaceDepositAmount = amount;
    payment.depositBefore = depositBefore;
    payment.depositAfter = depositAfter;
  }

  db.activities = db.activities || [];
  db.activities.unshift({
    id: makeId("act"),
    type: "reseller",
    title: "Pembayaran dikreditkan ke saldo",
    description: `${order.product} ${order.variant} x${order.qty || 1} tidak terkirim karena stok habis. ${formatRupiah(amount)} masuk ke saldo ${reseller.name || reseller.username || primaryResellerWhatsapp(reseller)}.`,
    createdAt: creditedAt,
    orderId: order.id,
    resellerId: reseller.id || "",
    whatsapp: primaryResellerWhatsapp(reseller) || normalizeWhatsappNumber(order.whatsapp || ""),
  });

  return { ok: true, reply: order.fulfillmentText, order };
}

function archiveLinkedAccountsForStockReuse(db, stocks = [], nextOrderId = "", archivedAt = nowText()) {
  const stockIds = new Set(stocks.map((stock) => String(stock?.id || "").trim()).filter(Boolean));
  const sheetKeys = new Set(stocks.map((stock) => String(stock?.sheetStockKey || "").trim()).filter(Boolean));
  if (!stockIds.size && !sheetKeys.size) return [];
  const archived = [];
  for (const account of db.managedAccounts || []) {
    if (!account || account.hidden || account.returnedToStockAt || String(account.status || "").toLowerCase() === "replaced") continue;
    const accountOrderId = String(account.orderId || account.sourceOrderId || "").trim();
    if (accountOrderId && accountOrderId === nextOrderId) continue;
    const stockMatch = account.stockId && stockIds.has(String(account.stockId).trim());
    const sheetMatch = account.sheetStockKey && sheetKeys.has(String(account.sheetStockKey).trim());
    if (!stockMatch && !sheetMatch) continue;
    account.hidden = true;
    account.reusedAt = archivedAt;
    account.reusedByOrderId = nextOrderId || "";
    archived.push(account);
  }
  return archived;
}

function sameMinuteBucket(left = "", right = "") {
  return String(left || "").slice(0, 16) && String(left || "").slice(0, 16) === String(right || "").slice(0, 16);
}

function isTerminalManagedAccountStatus(status = "") {
  return ["expired", "replaced", "disabled"].includes(String(status || "").trim().toLowerCase());
}

function linkedManagedAccountsForOrder(db, order = {}, options = {}) {
  const includeHidden = options.includeHidden === true;
  const orderId = String(order.id || "").trim();
  const deliveredStockIds = new Set((order.deliveredStockIds || []).map((item) => String(item || "").trim()).filter(Boolean));
  const accounts = db.managedAccounts || [];
  const direct = accounts.filter((account) => {
    if (!includeHidden && (account.hidden || account.returnedToStockAt)) return false;
    return String(account.orderId || account.sourceOrderId || "").trim() === orderId;
  });
  if (direct.length) return direct;
  return accounts.filter((account) => {
    if (!includeHidden && (account.hidden || account.returnedToStockAt)) return false;
    if (!deliveredStockIds.size || !deliveredStockIds.has(String(account.stockId || "").trim())) return false;
    if (order.expiresAt && String(account.expiresAt || "").trim() === String(order.expiresAt || "").trim()) return true;
    return sameMinuteBucket(account.startedAt, order.paidAt || order.createdAt);
  });
}

function usableManagedAccountsForFulfillment(db, order = {}, qty = 1) {
  const candidates = linkedManagedAccountsForOrder(db, order, { includeHidden: false })
    .filter((account) => !isTerminalManagedAccountStatus(account.status || "active"));
  if (!candidates.length) return [];
  const unique = [];
  const seen = new Set();
  for (const account of candidates) {
    const key = [
      String(account.stockId || "").trim(),
      String(account.email || "").trim().toLowerCase(),
      String(account.password || account.canvaLink || "").trim(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(account);
    if (unique.length >= qty) break;
  }
  return unique;
}

function stockHasActiveManagedLink(db, stock = {}, orderId = "") {
  const stockId = String(stock.id || "").trim();
  const sheetStockKey = String(stock.sheetStockKey || "").trim();
  if (!stockId && !sheetStockKey) return false;
  return (db.managedAccounts || []).some((account) => {
    if (!account || account.hidden || account.returnedToStockAt || isTerminalManagedAccountStatus(account.status || "")) return false;
    const linkedOrderId = String(account.orderId || account.sourceOrderId || "").trim();
    if (orderId && linkedOrderId === orderId) return false;
    return (stockId && String(account.stockId || "").trim() === stockId)
      || (sheetStockKey && String(account.sheetStockKey || "").trim() === sheetStockKey);
  });
}

function restoreFulfillmentFromExistingAccounts({ db, order, product, variant, payment, accounts = [] }) {
  const usableAccounts = accounts.filter(Boolean);
  if (!usableAccounts.length) return "";
  const defaultText = isLinkPoolProduct(db || {}, product, variant)
    ? renderLinkPoolReceipt({ order, accounts: usableAccounts, product, variant, payment })
    : renderSuccessReceipt({ order, stocks: usableAccounts, product, variant, payment });
  return renderDeliveryWithTemplate({
    defaultText,
    order,
    accounts: usableAccounts,
    stocks: usableAccounts,
    product,
    variant,
    payment,
    snkText: order.snkText || "",
  });
}

function settledQrisStatus(order = {}) {
  return order.manualApproved ? "manual" : "paid";
}

export function fulfillPaidOrder(db, orderId) {
  const order = db.orders.find((item) => item.id === orderId || item.paymentRef === orderId);
  if (!order) return { ok: false, reply: "Order tidak ditemukan." };
  const fulfilledAt = order.paidAt || order.createdAt || nowText();
  if (order.deliveryStatus === "stock_unavailable_deposit") {
    return { ok: true, reply: order.fulfillmentText || "Pembayaran sudah dikreditkan ke saldo reseller karena stok habis.", order };
  }
  if (order.qrisStatus === "expired" || order.orderStatus === "cancelled") {
    return { ok: false, reply: "Order sudah expired atau dibatalkan.", order };
  }
  if (order.type === "deposit_topup" || order.orderType === "deposit_topup") {
    return fulfillDepositTopup(db, order);
  }
  if (order.deliveryStatus === "sent") {
    return { ok: true, reply: order.fulfillmentText || `Order ${order.id} sudah pernah dikirim.`, snkText: order.snkText || "", order };
  }
  if (order.fulfillmentText) {
    order.qrisStatus = settledQrisStatus(order);
    order.orderStatus = "completed";
    order.deliveryStatus = "sent";
    order.deliveryError = "";
    return { ok: true, reply: order.fulfillmentText, order };
  }

  const match = findVariantByCode(db, order.variantCode || "");
  const product = match?.product || db.products.find((item) => item.id === order.productId);
  const variant = match?.variant || product?.variants?.find((item) => item.id === order.variantId);
  if (!product || !variant) {
    order.deliveryStatus = "failed";
    order.deliveryError = "Produk/varian order tidak ditemukan.";
    return { ok: false, reply: "Produk/varian order tidak ditemukan." };
  }

  const qty = parseQty(order.qty);
  const payment = (db.payments || []).find((item) => item.orderId === order.id || item.ref === order.paymentRef) || null;
  const reseller = (db.resellers || []).find((item) => item.id === order.resellerId) || activeResellerByWhatsapp(db, order.whatsapp);
  const existingAccounts = usableManagedAccountsForFulfillment(db, order, qty);
  if (existingAccounts.length >= qty) {
    order.qrisStatus = settledQrisStatus(order);
    order.orderStatus = "completed";
    order.deliveryStatus = "sent";
    order.deliveryError = "";
    order.paidAt = order.paidAt || nowText();
    order.deliveredStockIds = existingAccounts.map((account) => account.stockId).filter(Boolean);
    order.paymentFee = Number(payment?.fee || order.paymentFee || 0);
    order.totalPaid = Number(
      order.totalPaid ||
        Number(order.depositUsed || 0) +
          (payment?.provider === "deposit" ? 0 : derivePaymentTotal(payment?.amount || order.paymentDue || 0, order.paymentFee, payment?.totalPayment || 0)) ||
        order.total ||
        0,
    );
    order.paymentMethod =
      order.paymentMethod ||
      payment?.paymentMethod ||
      (Number(order.depositUsed || 0) > 0 && Number(order.paymentDue || 0) > 0
        ? "Deposit + QRIS auto"
        : Number(order.depositUsed || 0) > 0
          ? "Deposit reseller"
          : "QRIS auto");
    order.snkText = order.snkText || renderSnkMessageWithContext(product, variant, order.duration || "", snkTemplateContext({
      order,
      product,
      variant,
      items: existingAccounts,
    }));
    order.fulfillmentText = order.fulfillmentText || restoreFulfillmentFromExistingAccounts({
      db,
      order,
      product,
      variant,
      payment,
      accounts: existingAccounts,
    });
    db.activities = db.activities || [];
    db.activities.unshift({
      id: makeId("act"),
      type: "order",
      title: `Order ${order.id} dipulihkan dari delivery lama`,
      description: `${existingAccounts.length} akun existing dipakai ulang supaya order tidak drop ganda.`,
      createdAt: nowText(),
      orderId: order.id,
      resellerId: order.resellerId || reseller?.id || "",
      whatsapp: normalizeWhatsappNumber(order.whatsapp || reseller?.whatsapp || ""),
    });
    return { ok: true, reply: order.fulfillmentText || `Order ${order.id} sudah pernah dikirim.`, snkText: order.snkText || "", order };
  }

  if (isLinkPoolProduct(db, product, variant)) {
    const allocatedPools = allocateLinkPoolSlots(db, product, variant, qty);
    const customerEmails = Array.isArray(order.customerEmails) && order.customerEmails.length
      ? order.customerEmails
      : splitCustomerEmails(order.email || "");
    if (allocatedPools.length < qty) {
      return convertUnavailablePaidOrderToDeposit(db, order);
    }
    if (customerEmails.length < qty) {
      order.deliveryStatus = "failed";
      order.deliveryError = `${product.name} wajib punya ${qty} email customer.`;
      return { ok: false, reply: order.deliveryError, order };
    }

    const durationDayCount = Number(order.durationDays || durationDays(order.duration));
    const accounts = customerEmails.slice(0, qty).map((email, index) => ({
      id: makeId("acc"),
      stockId: `link-${order.id}-${index + 1}`,
      resellerId: order.resellerId || reseller?.id || "",
      product: product.name,
      productId: product.id,
      variant: order.customerVariant || order.variant || variant.name,
      variantId: order.customerVariantId || order.variantId || variant.id,
      variantCode: order.customerVariantCode || order.variantCode || variant.code,
      stockPoolKey: order.stockPoolKey || variantStockGroupKey(product, variant),
      accountType: isCanvaProduct(product) ? "canva_link" : "link_pool",
      linkPoolId: allocatedPools[index].id,
      canvaPoolId: isCanvaProduct(product) ? allocatedPools[index].id : "",
      orderId: order.id,
      sourceOrderId: order.id,
      duration: order.duration || "",
      durationDays: durationDayCount,
      email,
      password: allocatedPools[index].link,
      canvaLink: isCanvaProduct(product) ? allocatedPools[index].link : "",
      buyer: order.customer,
      reseller: reseller?.name || order.whatsapp || "",
      whatsapp: normalizeWhatsappNumber(order.whatsapp || reseller?.whatsapp || ""),
      profile: "",
      pin: "",
      source: isCanvaProduct(product) ? "canva_order" : "link_pool_order",
      sheetSource: "google_sheets",
      sheetPool: allocatedPools[index].poolKey || allocatedPools[index].key || "",
      sheetPoolSchema: "link",
      sheetName: allocatedPools[index].sheetName || "",
      usageMode: durationDayCount < 30 ? "daily" : "monthly",
      snapshotAt: nowText(),
      startedAt: fulfilledAt,
      expiresAt: order.expiresAt || addDaysText(durationDayCount, order.createdAt || new Date()),
      status: "active",
    }));

    db.managedAccounts = db.managedAccounts || [];
    accounts.forEach((account) => upsertManagedAccount(db, account));
    updateLinkPoolsAfterAllocation(allocatedPools);
    const canvaPoolRow = (db.linkPools || []).find((pool) => isCanvaProduct(product) && pool.id === allocatedPools[0]?.id);
    if (canvaPoolRow) {
      db.canvaPool = {
        id: canvaPoolRow.id,
        link: canvaPoolRow.link,
        quota: Number(canvaPoolRow.quota || 0),
        used: Number(canvaPoolRow.used || 0),
        status: canvaPoolRow.status || "active",
        notes: canvaPoolRow.notes || "",
        updatedAt: nowText(),
      };
    }
    order.qrisStatus = settledQrisStatus(order);
    order.orderStatus = "completed";
    order.deliveryStatus = "sent";
    order.paidAt = order.paidAt || nowText();
    order.deliveredStockIds = accounts.map((account) => account.stockId);
    order.paymentFee = Number(payment?.fee || order.paymentFee || 0);
    order.totalPaid = Number(
      order.totalPaid ||
        Number(order.depositUsed || 0) +
          (payment?.provider === "deposit" ? 0 : derivePaymentTotal(payment?.amount || order.paymentDue || 0, order.paymentFee, payment?.totalPayment || 0)) ||
        order.total ||
        0,
    );
    order.snkText = renderSnkMessageWithContext(product, variant, order.duration || "", snkTemplateContext({
      order,
      product,
      variant,
      items: accounts,
    }));
    order.fulfillmentText = renderDeliveryWithTemplate({
      defaultText: renderLinkPoolReceipt({ order, accounts, product, variant, payment }),
      order,
      accounts,
      product,
      variant,
      payment,
      snkText: order.snkText,
    });
    db.activities.unshift({
      id: makeId("act"),
      type: "order",
      title: `Order ${order.id} selesai`,
      description: `${accounts.length} slot ${product.name} terkirim ke ${order.whatsapp}.`,
      createdAt: nowText(),
      orderId: order.id,
      resellerId: order.resellerId || reseller?.id || "",
      whatsapp: normalizeWhatsappNumber(order.whatsapp || reseller?.whatsapp || ""),
    });
    return { ok: true, reply: order.fulfillmentText, snkText: order.snkText, order };
  }

  const reservedStock = stockForVariant(db, product, variant, "reserved")
    .filter((item) => item.reservedFor === order.id)
    .filter((item) => !stockHasActiveManagedLink(db, item, order.id));
  const fallbackStock = stockForVariant(db, product, variant, "available")
    .filter((item) => !stockHasActiveManagedLink(db, item, order.id));
  const reservedStockIds = new Set(Array.isArray(order.reservedStockIds) ? order.reservedStockIds : []);
  const stocks = (reservedStockIds.size ? reservedStock : [...reservedStock, ...fallbackStock]).slice(0, qty);
  if (!stocks.length || stocks.length < qty) {
    return convertUnavailablePaidOrderToDeposit(db, order);
  }
  archiveLinkedAccountsForStockReuse(db, stocks, order.id, fulfilledAt);

  stocks.forEach((stock) => {
    stock.status = "sold";
    stock.soldAt = fulfilledAt;
    delete stock.reservedFor;
    delete stock.reservedAccountId;
    delete stock.reservedUntil;
    delete stock.reservedAt;
    stock.soldVariantId = order.variantId || variant.id;
    stock.soldVariant = order.customerVariant || order.variant || variant.name;
    stock.soldDuration = order.duration || "";
    stock.soldDurationDays = Number(order.durationDays || durationDays(order.duration));
  });
  order.qrisStatus = settledQrisStatus(order);
  order.orderStatus = "completed";
  order.deliveryStatus = "sent";
  order.paidAt = order.paidAt || nowText();
  order.deliveredStockIds = stocks.map((stock) => stock.id);
  order.paymentFee = Number(payment?.fee || order.paymentFee || 0);
  order.totalPaid = Number(
    order.totalPaid ||
      Number(order.depositUsed || 0) +
        (payment?.provider === "deposit" ? 0 : derivePaymentTotal(payment?.amount || order.paymentDue || 0, order.paymentFee, payment?.totalPayment || 0)) ||
      order.total ||
      0,
  );
  order.paymentMethod =
    order.paymentMethod ||
    payment?.paymentMethod ||
    (Number(order.depositUsed || 0) > 0 && Number(order.paymentDue || 0) > 0
      ? "Deposit + QRIS auto"
      : Number(order.depositUsed || 0) > 0
        ? "Deposit reseller"
        : "QRIS auto");
  order.snkText = renderSnkMessageWithContext(product, variant, order.duration || "", snkTemplateContext({
    order,
    product,
    variant,
    items: stocks,
  }));
  order.fulfillmentText = renderDeliveryWithTemplate({
    defaultText: renderSuccessReceipt({ order, stocks, product, variant, payment }),
    order,
    stocks,
    product,
    variant,
    payment,
    snkText: order.snkText,
  });
  db.managedAccounts = db.managedAccounts || [];
  stocks.forEach((stock) => {
    upsertManagedAccount(db, {
      id: makeId("acc"),
      stockId: stock.id,
      orderId: order.id,
      sourceOrderId: order.id,
      resellerId: order.resellerId || reseller?.id || "",
      product: product.name,
      productId: product.id,
      variant: order.customerVariant || order.variant || variant.name,
      variantId: order.customerVariantId || order.variantId || variant.id,
      variantCode: order.customerVariantCode || order.variantCode || variant.code,
      stockPoolKey: order.stockPoolKey || variantStockGroupKey(product, variant),
      duration: order.duration || "",
      durationDays: Number(order.durationDays || durationDays(order.duration)),
      email: stock.email,
      loginPhone: stock.loginPhone || "",
      otpEmail: stock.otpEmail || "",
      password: stock.password,
      buyer: order.customer,
      reseller: reseller?.name || order.whatsapp || "",
      whatsapp: normalizeWhatsappNumber(order.whatsapp || reseller?.whatsapp || ""),
      profile: stock.profile,
      pin: stock.pin,
      signInCode: stock.signInCode,
      verificationCode: stock.verificationCode,
      resetLink: stock.resetLink,
      householdLink: stock.householdLink,
      device: order.device || stock.device || "",
      sheetSource: stock.sheetSource || "",
      sheetName: stock.sheetName || "",
      sheetRow: stock.sheetRow || 0,
      sheetPool: stock.sheetPool || "",
      sheetPoolSchema: stock.sheetPoolSchema || "",
      sheetStartColumn: stock.sheetStartColumn || 0,
      startedAt: fulfilledAt,
      expiresAt: order.expiresAt || addDaysText(durationDays(order.duration), order.createdAt || new Date()),
      status: "active",
    });
  });
  db.activities.unshift({
    id: makeId("act"),
    type: "order",
    title: `Order ${order.id} selesai`,
    description: `${stocks.length} akun ${product.name} ${variant.name} terkirim ke ${order.whatsapp}. Metode: ${order.paymentMethod}.`,
    createdAt: nowText(),
    orderId: order.id,
    resellerId: order.resellerId || reseller?.id || "",
    whatsapp: normalizeWhatsappNumber(order.whatsapp || reseller?.whatsapp || ""),
  });
  return { ok: true, reply: order.fulfillmentText, snkText: order.snkText, order };
}

async function createOrder(db, { from, code, qty, durationText = "", payload }) {
  const reseller = activeResellerByWhatsapp(db, from, payload);
  if (!reseller) return { handled: true, reply: resellerRequiredMessage };

  const match = findVariantByCode(db, code);
  if (!match) {
    return { handled: true, reply: `Kode ${code} tidak ditemukan. Ketik #stock untuk lihat kode produk.` };
  }

  const { product, variant } = match;
  const lockReply = orderLockReply(product, variant);
  if (lockReply) {
    return { handled: true, reply: lockReply };
  }
  const count = parseQty(qty);
  let stock = availableStock(db, product.id, variant.id);
  if (stock.length < count) {
    try {
      await syncGoogleSheetsStock(db, { silent: true, reason: "whatsapp_order_stock_recheck" });
      stock = availableStock(db, product.id, variant.id);
    } catch {}
    if (stock.length < count) {
      return { handled: true, reply: `stok kosong untuk ${variant.code}` };
    }
  }

  const linkPoolOrder = isLinkPoolProduct(db, product, variant);
  const linkPoolParsed = linkPoolOrder ? parseLinkPoolDurationAndEmails(durationText) : { durationText, emails: [] };
  if (linkPoolOrder && linkPoolParsed.emails.length < count) {
    return { handled: true, reply: `Order ${product.name} wajib isi ${count} email customer. Contoh: #buynow ${variant.code} ${count} 1bulan email@gmail.com` };
  }

  const duration = normalizeDurationLabel(linkPoolParsed.durationText || "1 Bulan", variant);
  if (!durationAllowedForVariant(variant, duration)) {
    return { handled: true, reply: `Durasi ${duration} sedang tidak aktif untuk ${variant.name}.` };
  }
  const price = priceForDuration(variant, duration);
  const total = price * count;
  const paymentPlan = depositBreakdown(reseller, total);
  const orderId = makeId("ORD").toUpperCase();
  const paymentRef = makeId("PAY").toUpperCase();
  const paymentUrl = dashboardPaymentUrl(db, paymentRef);
  const createdAt = nowText();
  const ttlMinutes = paymentTtlMinutes();
  const paymentExpiresAt = addMinutesText(ttlMinutes);
  const expiresAt = addDaysText(durationDays(duration), createdAt);

  const order = {
    id: orderId,
    paymentRef,
    customer: primaryResellerWhatsapp(reseller) || from,
    whatsapp: primaryResellerWhatsapp(reseller) || normalizeWhatsappNumber(from),
    resellerId: reseller?.id || "",
    product: product.name,
    productId: product.id,
    variant: variant.name,
    variantId: variant.id,
    variantCode: variant.code,
    customerVariant: variant.name,
    customerVariantId: variant.id,
    customerVariantCode: variant.code,
    stockPoolKey: variantStockGroupKey(product, variant),
    duration,
    durationDays: durationDays(duration),
    qty: count,
    total,
    depositBefore: paymentPlan.depositBefore,
    depositUsed: paymentPlan.depositUsed,
    depositAfter: paymentPlan.depositAfter,
    paymentDue: paymentPlan.paymentDue,
    email: linkPoolOrder ? linkPoolParsed.emails.join(", ") : payload?.email || "",
    customerEmails: linkPoolOrder ? linkPoolParsed.emails : [],
    device: linkPoolOrder ? "" : payload?.device || payload?.email || "",
    qrisStatus: paymentPlan.paymentDue > 0 ? "pending" : "paid",
    orderStatus: paymentPlan.paymentDue > 0 ? "pending" : "paid",
    deliveryStatus: paymentPlan.paymentDue > 0 ? "waiting_payment" : "paid_by_deposit",
    channel: "Reseller",
    source: "whatsapp",
    qrisUrl: paymentPlan.paymentDue > 0 ? paymentUrl : "",
    stockPolicy: "pay_first",
    paymentMethod:
      paymentPlan.paymentDue > 0 && paymentPlan.depositUsed > 0
        ? "Deposit + QRIS auto"
        : paymentPlan.depositUsed > 0
          ? "Deposit reseller"
          : "QRIS auto",
    createdAt,
    expiresAt,
    paymentExpiresAt,
    deliveredStockIds: [],
  };
  const reservedStocks = reserveAvailableStocksForOrder(db, order, product, variant, count);
  if (!linkPoolOrder && reservedStocks.length < count) {
    return { handled: true, reply: `stok kosong untuk ${variant.code}` };
  }

  if (paymentPlan.depositUsed > 0) {
    reseller.deposit = paymentPlan.depositAfter;
  }

  db.orders.unshift(order);
  db.payments.unshift({
    ref: paymentRef,
    orderId,
    status: paymentPlan.paymentDue > 0 ? "pending" : "paid",
    amount: paymentPlan.paymentDue,
    provider: paymentPlan.paymentDue > 0 ? "pakasir" : "deposit",
    paymentUrl: paymentPlan.paymentDue > 0 ? paymentUrl : "",
    qrisText: paymentPlan.paymentDue > 0 ? paymentUrl : "",
    depositBefore: paymentPlan.depositBefore,
    depositUsed: paymentPlan.depositUsed,
    depositAfter: paymentPlan.depositAfter,
    totalPayment: paymentPlan.paymentDue > 0 ? paymentPlan.paymentDue : total,
    paymentMethod: order.paymentMethod,
    createdAt,
    expiresAt: paymentExpiresAt,
  });
  db.activities.unshift({
    id: makeId("act"),
    type: "order",
    title: `Order ${orderId} dibuat dari WhatsApp`,
    description:
      paymentPlan.paymentDue > 0
        ? `${product.name} ${variant.name} x${count}. Deposit dipakai ${formatRupiah(paymentPlan.depositUsed)}, sisa QRIS ${formatRupiah(paymentPlan.paymentDue)}.`
        : `${product.name} ${variant.name} x${count} lunas memakai deposit reseller.`,
    createdAt: nowText(),
    orderId,
    resellerId: reseller?.id || "",
    whatsapp: primaryResellerWhatsapp(reseller) || normalizeWhatsappNumber(from),
  });

  if (paymentPlan.paymentDue <= 0) {
    const fulfilled = fulfillPaidOrder(db, orderId);
    return {
      handled: true,
      order,
      reply: fulfilled.reply,
      snkText: fulfilled.snkText || order.snkText || "",
      paidByDeposit: true,
      orderId,
      paymentRef,
    };
  }

  return {
    handled: true,
    order,
    reply: buildOrderCreatedReply({
      order,
      productName: product.name,
      variantName: variant.name,
      qty: count,
      price,
      totalPayment: paymentPlan.paymentDue,
      ttlMinutes,
    }),
    paymentUrl,
    qrisText: paymentUrl,
    qrText: paymentUrl,
    orderId,
    paymentRef,
  };
}

function createDepositTopup(db, { from, body, payload }) {
  const reseller = activeResellerByWhatsapp(db, from, payload);
  if (!reseller) return { handled: true, reply: resellerRequiredMessage };

  const amount = parseMoney(commandArgs(body)[0]);
  if (!amount) {
    return { handled: true, reply: "Format salah. Gunakan: #deposit 5000" };
  }

  const { order, payment, ttlMinutes } = createDepositTopupOrder(db, {
    reseller,
    amount,
    source: "whatsapp_deposit",
    channel: "Reseller",
    whatsapp: primaryResellerWhatsapp(reseller) || normalizeWhatsappNumber(from),
  });

  return {
    handled: true,
    order,
    reply: buildDepositCreatedReply({ order, ttlMinutes }),
    paymentUrl: payment.paymentUrl,
    qrisText: payment.qrisText,
    qrText: payment.qrisText,
    orderId: order.id,
    paymentRef: order.paymentRef,
  };
}

export function createDepositTopupOrder(db, { reseller, amount, source = "reseller_panel", channel = "Reseller Panel", whatsapp = "" } = {}) {
  const depositAmount = Math.max(0, Number(amount || 0));
  if (!reseller || !depositAmount) {
    throw new Error("deposit_topup_order_requires_reseller_and_amount");
  }

  db.orders = db.orders || [];
  db.payments = db.payments || [];
  db.activities = db.activities || [];

  const depositBefore = Math.max(0, Number(reseller.deposit || 0));
  const orderId = makeId("DEP").toUpperCase();
  const paymentRef = makeId("PAY").toUpperCase();
  const paymentUrl = dashboardPaymentUrl(db, paymentRef);
  const createdAt = nowText();
  const ttlMinutes = paymentTtlMinutes();
  const paymentExpiresAt = addMinutesText(ttlMinutes);
  const resellerWhatsapp = primaryResellerWhatsapp(reseller) || normalizeWhatsappNumber(whatsapp);
  const order = {
    id: orderId,
    paymentRef,
    type: "deposit_topup",
    orderType: "deposit_topup",
    customer: reseller.name || reseller.username || resellerWhatsapp,
    whatsapp: resellerWhatsapp,
    resellerId: reseller.id || "",
    product: "Top Up Saldo",
    productId: "deposit_topup",
    variant: "Deposit",
    variantId: "deposit",
    variantCode: "DEPOSIT",
    duration: "",
    qty: 1,
    total: depositAmount,
    depositBefore,
    depositUsed: 0,
    depositAdded: depositAmount,
    depositAfter: depositBefore,
    paymentDue: depositAmount,
    qrisStatus: "pending",
    orderStatus: "pending",
    deliveryStatus: "waiting_payment",
    channel,
    source,
    qrisUrl: paymentUrl,
    paymentMethod: "QRIS top up saldo",
    createdAt,
    paymentExpiresAt,
    deliveredStockIds: [],
  };
  const payment = {
    ref: paymentRef,
    orderId,
    type: "deposit_topup",
    status: "pending",
    amount: depositAmount,
    provider: "pakasir",
    paymentUrl,
    qrisText: paymentUrl,
    resellerId: reseller.id,
    resellerName: reseller.name || reseller.username || "",
    resellerWhatsapp,
    depositBefore,
    depositUsed: 0,
    depositAdded: depositAmount,
    depositAfter: depositBefore,
    totalPayment: depositAmount,
    paymentMethod: "QRIS top up saldo",
    source,
    createdAt,
    expiresAt: paymentExpiresAt,
  };

  db.orders.unshift(order);
  db.payments.unshift(payment);
  db.activities.unshift({
    id: makeId("act"),
    type: "reseller",
    title: `Deposit ${orderId} dibuat`,
    description: `${reseller.name || reseller.username || resellerWhatsapp} membuat top up saldo ${formatRupiah(depositAmount)}${channel ? ` via ${channel}` : ""}.`,
    createdAt: nowText(),
    orderId,
    resellerId: reseller.id || "",
    whatsapp: resellerWhatsapp,
  });

  return { order, payment, ttlMinutes };
}

function balanceReply(db, { from, body, payload }) {
  const args = commandArgs(body);
  const owner = isOwnerCommand(db, payload);
  const target = owner && args[0] ? args[0] : from;
  const reseller = resellerByIdentifier(db, target) || (!owner ? activeResellerByWhatsapp(db, target, payload) : null);
  if (!reseller || (reseller.isActive === false && !owner)) return resellerRequiredMessage;
  return joinBotMessageLines([
    `Saldo reseller ${reseller.name || reseller.username || primaryResellerWhatsapp(reseller)}: ${formatRupiah(Number(reseller.deposit || 0))}`,
    `Nomor: ${primaryResellerWhatsapp(reseller)}`,
  ]);
}

function parseAddBalanceRequest(db, from, body) {
  const args = commandArgs(body);
  if (!args.length) {
    return { error: "Format salah. Gunakan: .addbalance 5000 atau .addbalance 628xxxx 5000" };
  }

  if (args.length === 1) {
    return {
      target: from,
      amount: parseMoney(args[0]),
    };
  }

  const firstAsReseller = resellerByIdentifier(db, args[0]);
  const secondAsReseller = resellerByIdentifier(db, args[1]);
  if (firstAsReseller) {
    return {
      target: args[0],
      amount: parseMoney(args[1]),
    };
  }
  if (secondAsReseller) {
    return {
      target: args[1],
      amount: parseMoney(args[0]),
    };
  }

  const firstLooksPhone = normalizeWhatsappNumber(args[0]).length >= 9;
  const secondLooksPhone = normalizeWhatsappNumber(args[1]).length >= 9;
  if (firstLooksPhone) {
    return {
      target: args[0],
      amount: parseMoney(args[1]),
    };
  }
  if (secondLooksPhone) {
    return {
      target: args[1],
      amount: parseMoney(args[0]),
    };
  }
  return {
    target: from,
    amount: parseMoney(args[0]),
  };
}

function addBalance(db, { from, body, payload }) {
  if (!isOwnerCommand(db, payload)) {
    return { handled: true, reply: "Command .addbalance khusus owner." };
  }

  const request = parseAddBalanceRequest(db, from, body);
  if (request.error) return { handled: true, reply: request.error };
  if (!request.amount) {
    return { handled: true, reply: "Nominal deposit tidak valid. Contoh: .addbalance 5000" };
  }

  const reseller = resellerByIdentifier(db, request.target);
  if (!reseller) {
    return { handled: true, reply: `Reseller ${request.target || from} tidak ditemukan.` };
  }

  db.payments = db.payments || [];
  db.activities = db.activities || [];

  const depositBefore = Math.max(0, Number(reseller.deposit || 0));
  const depositAdded = request.amount;
  const depositAfter = depositBefore + depositAdded;
  const ref = makeId("DEP").toUpperCase();
  const createdAt = nowText();
  reseller.deposit = depositAfter;

  db.payments.unshift({
    ref,
    orderId: "",
    type: "manual_deposit",
    status: "paid",
    amount: depositAdded,
    provider: "manual",
    resellerId: reseller.id,
    resellerName: reseller.name || reseller.username || "",
    resellerWhatsapp: primaryResellerWhatsapp(reseller),
    depositBefore,
    depositAdded,
    depositAfter,
    totalPayment: depositAdded,
    paymentMethod: "Owner addbalance WhatsApp",
    source: "whatsapp_owner_command",
    createdAt,
    paidAt: createdAt,
  });
  db.activities.unshift({
    id: makeId("act"),
    type: "reseller",
    title: "Deposit reseller ditambah",
    description: `${formatRupiah(depositAdded)} ditambahkan ke ${reseller.name || reseller.username || primaryResellerWhatsapp(reseller)}. Saldo sekarang ${formatRupiah(depositAfter)}.`,
    createdAt,
    resellerId: reseller.id,
    whatsapp: primaryResellerWhatsapp(reseller),
  });

  return {
    handled: true,
    balanceRef: ref,
    resellerId: reseller.id,
    reply: joinBotMessageLines([
      "Deposit reseller berhasil ditambah.",
      "",
      `Reseller: ${reseller.name || reseller.username || primaryResellerWhatsapp(reseller)}`,
      `Nomor: ${primaryResellerWhatsapp(reseller)}`,
      `Tambah: ${formatRupiah(depositAdded)}`,
      `Saldo sebelum: ${formatRupiah(depositBefore)}`,
      `Saldo sekarang: ${formatRupiah(depositAfter)}`,
      `Ref: ${ref}`,
    ]),
  };
}

export async function handleInboundMessage(db, payload) {
  const chatJid = normalize(payload.chat_jid || payload.remote_jid || payload.chatJid || payload.remoteJid || "");
  if (payload.is_group || payload.isGroup || chatJid.endsWith("@g.us")) {
    return { handled: false, ignored: true, reason: "private_chat_only" };
  }

  const from = normalize(payload.from || payload.sender || payload.whatsapp || "unknown");
  const body = normalize(payload.body || payload.message || payload.text);
  const lower = body.toLowerCase();
  const command = commandName(body);

  db.whatsappMessages.unshift({
    id: makeId("msg"),
    from,
    body,
    direction: "inbound",
    createdAt: nowText(),
  });

  let reply = "";
  let result = { handled: true };

  if (["addbalance", "addsaldo", "adddeposit"].includes(command)) {
    result = addBalance(db, { from, body, payload });
    reply = result.reply;
  } else if (lower === "#stock" || lower === "#stok" || lower === "stock" || lower === "stok") {
    reply = resellerWebsiteOnlyReply(db);
  } else if (lower.startsWith("#buynow") || lower.startsWith(".buynow")) {
    reply = resellerWebsiteOnlyReply(db);
  } else if (command === "deposit") {
    result = createDepositTopup(db, { from, body, payload });
    reply = result.reply;
  } else if (["balance", "saldo", "ceksaldo", "cekbalance", "cekbal"].includes(command) || lower === "#balance" || lower === "balance") {
    reply = balanceReply(db, { from, body, payload });
  } else if (command === "bot") {
    reply = "Helo ada yang bisa di bantu ?";
  } else {
    reply = "";
  }

  db.whatsappMessages.unshift({
    id: makeId("msg"),
    to: from,
    body: reply,
    direction: "outbound",
    createdAt: nowText(),
  });

  return { ...result, reply };
}
