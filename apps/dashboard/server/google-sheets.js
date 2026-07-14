import crypto from "node:crypto";
import {
  canvaPool,
  canvaUsedCount,
  isCanvaProduct,
  isNetflixSharedVariant,
  isNetflixTwoUserVariant,
  isVidioPlatinumAllDeviceVariant,
  isVidioPlatinumMobileVariant,
  isVidioPlatinumTvVariant,
  isVariantOrderable,
  isViuVariant,
  stockForVariant,
  variantStockGroupKey,
} from "./stock-groups.js";

export const NETFLIX_SHEETS_SNK = `⋆°࿔ ៸ NETFLIX 1P1U 1 BULAN 𝜗𝜚⋆
⚠︎ JIKA ADA NOTIF HARGA BARU NETFLIX, TOLONG DI ACCEPT DAN JANGAN DITOLAK ⚠

𝙨𝙮𝙖𝙧𝙖𝙩 & 𝙠𝙚𝙩𝙚𝙣𝙩𝙪𝙖𝙣 : 
യ WAJIB SETOR FORM DAN SS LOGIN MAX 1X24 JAM
യ 25-30 Hari terhitung 1 bulan
യ Hanya boleh login dalam 1 device.
യ Dilarang keras mengutak-atik billing, payment, email, atau sistem lainnya!
യ Jika ada notifikasi apapun, tekan "Lain kali" / "Not right now" / "X".
യ estimasi garansi jika ada kendala dalam akun adalah 0-3 x 24 jam.

യ Jika tidak bisa login, coba lakukan ini:
➝ Bersihkan data/memori/chace aplikasi netflix
➝ Ganti jaringan wifi/data/hotspot
➝ Hapus data aplikasi Netflix lalu reinstall
➝ Gunakan netflix.com/clearcookies 
➝ Coba login di device lain 

email ::
pass ::
profile ::

📎  Melanggar? maka tidak akan mendapatkan garansi.

— thank u and have a great day(◍^ᴗ^◍)♡`;

const SHEET_HEADERS = ["ACCOUNT", "Nama profil", "TANGGAL", "DURASI", "EXPIRED", "DEVICE", "SELLER", "NOMOR WA", "PIN", "", "CATATAN", ""];
const SIMPLE_ACCOUNT_HEADERS = ["ACCOUNT", "PASSWORD", "TANGGAL", "DURASI", "EXPIRED", "SELLER", "NOMOR WA", "", "CATATAN", ""];
const UNIVERSAL_ACCOUNT_HEADERS = ["ACCOUNT", "TANGGAL", "DURASI", "EXPIRED", "SELLER", "NOMOR WA", "", "CATATAN", ""];
const DISNEY_HEADERS = ["Number", "OTP Email", "Nama profil", "TANGGAL", "DURASI", "EXPIRED", "DEVICE", "SELLER", "NOMOR WA", "ORDER ID", "CATATAN", "STOCK ID"];
const CANVA_SHEET_NAME = "Canva";
const VIU_SHEET_NAME = "Viu";
const VIDIO_SHEET_NAME = "Vidio";
const ORDER_HISTORY_SHEET_NAME = "Order History";
const ORDER_HISTORY_HEADERS = [
  "WAKTU ORDER",
  "RESELLER",
  "CUSTOMER",
  "PRODUK",
  "VARIAN",
  "DURASI",
  "ACCOUNT",
  "PROFIL",
  "EXPIRED",
  "SHEET",
  "ROW",
  "ORDER ID",
  "STOCK ID",
  "CATATAN",
];

function isSmokeTestOrder(order = {}) {
  return Boolean(order.isSmokeTest || String(order.source || "").toLowerCase() === "owner_smoke_test");
}

function smokeTestMarker(order = {}) {
  const label = String(order.smokeTestLabel || order.customer || "kya").trim() || "kya";
  return `SMOKE TEST OWNER (${label})`;
}

function sheetOrderNote(order = {}, stock = {}) {
  const baseNote = String(order.note || stock.notes || "").trim();
  if (!isSmokeTestOrder(order)) return baseNote;
  return [smokeTestMarker(order), baseNote].filter(Boolean).join(" | ");
}

function sheetOrderCustomer(order = {}, account = {}) {
  const customer = String(order.customer || account.buyer || "").trim();
  if (!isSmokeTestOrder(order)) return customer;
  return `${smokeTestMarker(order)}${customer ? ` - ${customer}` : ""}`;
}

function isDisneySheetStock(stock = {}, account = {}) {
  const text = [
    stock.sheetPool,
    stock.productName,
    stock.product,
    stock.productId,
    account.product,
    account.productId,
  ].map(normalizePoolMarker).join(" ");
  return text.includes("DISNEY");
}
const CANVA_POOL_HEADERS = ["CANVA LINK", "KUOTA", "TERPAKAI", "SISA", "STATUS", "CATATAN"];
const CANVA_USAGE_HEADERS = ["EMAIL CUSTOMER", "RESELLER", "NOMOR WA", "TANGGAL", "DURASI", "EXPIRED", "STATUS", "ORDER ID"];
const LINK_POOL_HEADERS = ["LINK", "KUOTA", "TERPAKAI", "SISA", "STATUS", "CATATAN", "STOCK ID"];
const LINK_USAGE_HEADERS = ["EMAIL CUSTOMER", "RESELLER", "NOMOR WA", "TANGGAL BELI", "DURASI", "EXPIRED", "ORDER ID", "STOCK ID"];
const DATA_RESELLER_SHEET_NAMES = ["data reseller", "reseller data", "resellers", "reseller"];
const CHECKOUT_EMAIL_HEADERS = ["EMAIL CUSTOMER", "EMAIL CUST", "CUSTOMER EMAIL", "EMAIL BUYER", "EMAIL CUSTOMER CANVA"];
const CHECKOUT_DEVICE_HEADERS = ["DEVICE", "PERANGKAT", "DEVICE CUSTOMER", "CUSTOMER DEVICE"];
const STORED_SECRET_PLACEHOLDER = "[stored]";
const POOLS = {
  NETFLIX_SHARED: {
    key: "NETFLIX_SHARED",
    label: "POOL: NETFLIX_SHARED",
    startColumn: 0,
    variantMatch: isNetflixSharedVariant,
    productKey: "netflix",
  },
  NETFLIX_2U: {
    key: "NETFLIX_2U",
    label: "POOL: NETFLIX_2U",
    startColumn: 13,
    variantMatch: isNetflixTwoUserVariant,
    productKey: "netflix",
  },
  VIU: {
    key: "VIU",
    label: "POOL: VIU",
    startColumn: 0,
    variantMatch: isViuVariant,
    productKey: "viu",
  },
  VIDIO_PLATINUM_TV: {
    key: "VIDIO_PLATINUM_TV",
    label: "POOL: VIDIO_PLATINUM_TV",
    aliases: ["POOL: Vidio Platinum tv", "POOL: Vidio_Platinum_tv", "POOL: Vidio_Plantinum_tv", "Vidio Platinum tv", "Vidio_Platinum_tv", "Vidio_Plantinum_tv"],
    startColumn: 0,
    variantMatch: isVidioPlatinumTvVariant,
    productKey: "vidio",
  },
  VIDIO_PLATINUM_MOBILE: {
    key: "VIDIO_PLATINUM_MOBILE",
    label: "POOL: VIDIO_PLATINUM_MOBILE",
    aliases: ["POOL: Vidio Platinum Mobile", "POOL: Vidio_Platinum_Mobile", "POOL: Vidio_Plantinum_Mobile", "Vidio Platinum Mobile", "Vidio_Platinum_Mobile", "Vidio_Plantinum_Mobile"],
    startColumn: 13,
    variantMatch: isVidioPlatinumMobileVariant,
    productKey: "vidio",
  },
  VIDIO_PLATINUM_ALL_DEVICE: {
    key: "VIDIO_PLATINUM_ALL_DEVICE",
    label: "POOL: VIDIO_PLATINUM_ALL_DEVICE",
    aliases: ["POOL: Vidio Platinum All Device", "POOL: Vidio_Platinum_All_Device", "POOL: Vidio_Plantinum_All_Device", "Vidio Platinum All Device", "Vidio_Platinum_All_Device", "Vidio_Plantinum_All_Device"],
    startColumn: 26,
    variantMatch: isVidioPlatinumAllDeviceVariant,
    productKey: "vidio",
  },
};

const SHEET_CONFIGS = {
  netflix: {
    key: "netflix",
    summaryName: "Netflix",
    sheetName: (db) => googleSheetsSettings(db).sheetName,
    productMatch: productIsNetflix,
    pools: [POOLS.NETFLIX_SHARED, POOLS.NETFLIX_2U],
    requireProfile: true,
  },
  viu: {
    key: "viu",
    summaryName: "Viu",
    sheetName: () => VIU_SHEET_NAME,
    productMatch: productIsViu,
    pools: [POOLS.VIU],
    requireProfile: false,
  },
  vidio: {
    key: "vidio",
    summaryName: "Vidio",
    sheetName: () => VIDIO_SHEET_NAME,
    productMatch: productIsVidio,
    pools: [POOLS.VIDIO_PLATINUM_TV, POOLS.VIDIO_PLATINUM_MOBILE, POOLS.VIDIO_PLATINUM_ALL_DEVICE],
    requireProfile: false,
  },
};

let tokenCache = { key: "", accessToken: "", expiresAt: 0 };

function normalize(value = "") {
  return String(value || "").trim();
}

function normalizeLower(value = "") {
  return normalize(value).toLowerCase();
}

function normalizeWhatsapp(value = "") {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

function normalizeSellerKey(value = "") {
  return normalizeLower(value)
    .replace(/@.*$/, "")
    .replace(/\b(reseller|ress|seller|store|shop|official|admin)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactSellerKey(value = "") {
  return normalizeSellerKey(value).replace(/\s+/g, "");
}

function resellerSellerKeys(reseller = {}) {
  return [
    reseller.name,
    reseller.username,
    reseller.email,
    reseller.displayName,
    reseller.storeName,
    reseller.shopName,
  ]
    .map(normalizeSellerKey)
    .filter(Boolean);
}

function sellerMatchesReseller(seller, reseller) {
  const key = normalizeSellerKey(seller);
  if (!key) return false;
  const compact = compactSellerKey(seller);
  return resellerSellerKeys(reseller).some((candidate) => {
    if (candidate === key) return true;
    if (candidate.replace(/\s+/g, "") === compact) return true;
    return candidate.length >= 3 && key.split(" ").includes(candidate);
  });
}

function resellerBySellerName(db, seller) {
  const matches = (db.resellers || []).filter((item) => sellerMatchesReseller(seller, item));
  return matches.length === 1 ? matches[0] : null;
}

function resellerByWhatsapp(db, whatsapp) {
  const normalized = normalizeWhatsapp(whatsapp);
  if (!normalized) return null;
  return (db.resellers || []).find((item) => normalizeWhatsapp(item.whatsapp) === normalized) || null;
}

function resellerAliasKeys(value = "") {
  const aliasKey = normalizeSellerKey(value);
  const aliasCompact = aliasKey.replace(/\s+/g, "");
  return { aliasKey, aliasCompact };
}

function splitResellerAliases(value = "") {
  return String(value || "")
    .split(/[,;|]+/)
    .map((item) => normalize(item))
    .filter(Boolean);
}

function dataResellerSheetNameMatches(name = "") {
  const normalized = normalizeLower(name).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return DATA_RESELLER_SHEET_NAMES.includes(normalized) || normalized.includes("data reseller") || normalized.includes("reseller data");
}

function dataResellerColumns(header = []) {
  const end = header.length || 6;
  return {
    seller: dynamicHeaderIndex(header, 0, end, ["SELLER", "RESELLER", "RESS", "ALIAS", "NAMA", "NAMA RESELLER"]),
    whatsapp: dynamicHeaderIndex(header, 0, end, ["NOMER WA", "NOMOR WA", "NO WA", "WHATSAPP", "WA", "TELEPON", "PHONE"]),
    canonical: dynamicHeaderIndex(header, 0, end, ["NAMA UTAMA", "SELLER UTAMA", "MASTER", "DISPLAY NAME"]),
    status: dynamicHeaderIndex(header, 0, end, ["STATUS"]),
    notes: dynamicHeaderIndex(header, 0, end, ["CATATAN", "NOTE", "NOTES"]),
  };
}

function parseDataResellerRows(values = [], sheetName = "") {
  const headerIndex = values.findIndex((row) => {
    const columns = dataResellerColumns(row || []);
    return columns.seller >= 0 && columns.whatsapp >= 0;
  });
  if (headerIndex < 0) return { rows: [], warnings: [`${sheetName}: header Seller/Nomer WA tidak ditemukan`] };
  const columns = dataResellerColumns(values[headerIndex] || []);
  const rows = [];
  const warnings = [];
  for (let rowIndex = headerIndex + 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] || [];
    const seller = readColumn(row, columns.seller);
    const whatsapp = normalizeWhatsapp(readColumn(row, columns.whatsapp));
    const status = normalizeLower(readColumn(row, columns.status) || "active") || "active";
    const canonical = readColumn(row, columns.canonical) || seller;
    const notes = readColumn(row, columns.notes);
    if (!seller && !whatsapp) continue;
    if (!seller || !whatsapp) {
      warnings.push(`${sheetName}!${rowIndex + 1}: Seller/Nomer WA belum lengkap`);
      continue;
    }
    if (["inactive", "nonaktif", "disabled", "off", "arsip", "archive"].includes(status)) continue;
    const aliases = [...splitResellerAliases(seller), ...splitResellerAliases(canonical)]
      .filter(Boolean)
      .filter((alias, index, list) => list.findIndex((item) => normalizeSellerKey(item) === normalizeSellerKey(alias)) === index);
    rows.push({
      sheetName,
      rowNumber: rowIndex + 1,
      seller,
      canonical,
      whatsapp,
      status,
      notes,
      aliases,
    });
  }
  return { rows, warnings };
}

function buildDataResellerLookup(rows = [], sheetName = "") {
  const entries = [];
  const warnings = [];
  const byAlias = new Map();
  for (const row of rows) {
    for (const alias of row.aliases || []) {
      const { aliasKey, aliasCompact } = resellerAliasKeys(alias);
      if (!aliasKey) continue;
      const duplicateKey = aliasCompact || aliasKey;
      const previous = byAlias.get(duplicateKey);
      if (previous && previous.whatsapp !== row.whatsapp) {
        warnings.push(`Alias reseller "${alias}" bentrok: ${previous.whatsapp} dan ${row.whatsapp}`);
        continue;
      }
      byAlias.set(duplicateKey, row);
      entries.push({
        alias,
        aliasKey,
        aliasCompact,
        seller: row.seller,
        name: row.canonical || row.seller,
        whatsapp: row.whatsapp,
        sheetName: row.sheetName || sheetName,
        rowNumber: row.rowNumber,
      });
    }
  }
  return { entries, warnings };
}

function sheetResellerLookupEntries(db = {}) {
  return Array.isArray(db.settings?.googleSheetsResellerAliases) ? db.settings.googleSheetsResellerAliases : [];
}

function mappedSheetResellerByAlias(db, seller) {
  const { aliasKey, aliasCompact } = resellerAliasKeys(seller);
  if (!aliasKey) return null;
  const matches = sheetResellerLookupEntries(db).filter((entry) => (
    entry.aliasKey === aliasKey
    || (entry.aliasCompact && entry.aliasCompact === aliasCompact)
  ));
  const phones = [...new Set(matches.map((entry) => normalizeWhatsapp(entry.whatsapp)).filter(Boolean))];
  if (phones.length !== 1) return null;
  return matches.find((entry) => normalizeWhatsapp(entry.whatsapp) === phones[0]) || null;
}

export function sheetResellerIdentity(db, row = {}) {
  const sellerInput = String(row.seller || "").trim();
  const directWhatsapp = normalizeWhatsapp(row.whatsapp);
  const directReseller = directWhatsapp ? resellerByWhatsapp(db, directWhatsapp) : null;
  // The SELLER cell is the only ownership switch for Sheet-backed stock.
  // NOMOR WA remains metadata and must never create an assignment by itself.
  if (!sellerInput) {
    return {
      reseller: null,
      whatsapp: "",
      name: "",
      source: "seller_blank",
      conflict: false,
      inputWhatsapp: directWhatsapp,
      inputWhatsappResellerId: directReseller?.id || "",
    };
  }

  const mapped = mappedSheetResellerByAlias(db, sellerInput);
  const mappedWhatsapp = normalizeWhatsapp(mapped?.whatsapp || "");
  const mappedReseller = mappedWhatsapp ? resellerByWhatsapp(db, mappedWhatsapp) : null;
  const namedReseller = resellerBySellerName(db, sellerInput);
  const sellerReseller = mappedReseller || namedReseller;

  // SELLER is the explicit ownership field in every stock pool. A stale or
  // mistyped phone must not silently move the account to another reseller.
  if (sellerReseller) {
    const canonicalWhatsapp = normalizeWhatsapp(sellerReseller.whatsapp || mappedWhatsapp || "");
    return {
      reseller: sellerReseller,
      whatsapp: canonicalWhatsapp,
      name: sellerReseller.name || sellerReseller.username || mapped?.name || sellerInput || canonicalWhatsapp,
      source: mappedReseller ? "data_reseller" : "reseller_name",
      conflict: Boolean(directReseller && directReseller.id !== sellerReseller.id),
      inputWhatsapp: directWhatsapp,
      inputWhatsappResellerId: directReseller?.id || "",
    };
  }

  if (mapped?.whatsapp) {
    return {
      reseller: mappedReseller,
      whatsapp: mappedWhatsapp,
      name: mappedReseller?.name || mapped.name || sellerInput || mappedWhatsapp,
      source: "data_reseller",
      conflict: false,
      inputWhatsapp: directWhatsapp,
      inputWhatsappResellerId: directReseller?.id || "",
    };
  }

  return {
    reseller: null,
    whatsapp: "",
    name: sellerInput,
    source: "seller_unresolved",
    conflict: Boolean(directReseller),
    inputWhatsapp: directWhatsapp,
    inputWhatsappResellerId: directReseller?.id || "",
  };
}

function resellerForSheetRow(db, row) {
  return sheetResellerIdentity(db, row).reseller;
}

function canonicalSheetResellerName(identity = {}, fallback = "") {
  return String(
    identity?.reseller?.name
    || identity?.reseller?.username
    || identity?.name
    || fallback
    || "",
  ).trim();
}

async function syncSheetResellerLookup(db, options = {}) {
  if (options.resellerLookup) return options.resellerLookup;
  db.settings = db.settings || {};
  const empty = { ok: true, rows: 0, aliases: 0, sheetName: "", warnings: [] };
  if (!googleSheetsConfigured(db)) return empty;
  const meta = await getSpreadsheetMeta(db);
  const sheetName = (meta.sheets || [])
    .map((item) => normalize(item.properties?.title))
    .find((name) => dataResellerSheetNameMatches(name));
  if (!sheetName) {
    const lookup = { ...empty, warnings: ["Tab data reseller tidak ditemukan"] };
    db.settings.googleSheetsResellerAliases = [];
    db.settings.googleSheetsResellerSync = { ...lookup, syncedAt: new Date().toISOString() };
    return lookup;
  }
  const values = await readSheetValuesByName(db, sheetName);
  const parsed = parseDataResellerRows(values, sheetName);
  const built = buildDataResellerLookup(parsed.rows, sheetName);
  const lookup = {
    ok: true,
    sheetName,
    rows: parsed.rows.length,
    aliases: built.entries.length,
    warnings: [...parsed.warnings, ...built.warnings],
  };
  db.settings.googleSheetsResellerAliases = built.entries;
  db.settings.googleSheetsResellerSync = { ...lookup, syncedAt: new Date().toISOString() };
  return lookup;
}

async function ensureSheetResellerLookup(db, options = {}) {
  if (options.resellerLookup) return options.resellerLookup;
  try {
    return await syncSheetResellerLookup(db, options);
  } catch (error) {
    const warning = `data reseller: ${error.message || "gagal dibaca"}`;
    db.settings = db.settings || {};
    db.settings.googleSheetsResellerSync = { ok: false, rows: 0, aliases: 0, warnings: [warning], syncedAt: new Date().toISOString() };
    return { ok: false, rows: 0, aliases: 0, warnings: [warning] };
  }
}

function decodePrivateKey(value = "") {
  let raw = normalize(value);
  if (!raw) return "";
  try {
    if (raw.startsWith("{")) {
      const json = JSON.parse(raw);
      raw = normalize(json.private_key || json.privateKey || raw);
    }
  } catch {
    // Fall through to the lenient extraction below.
  }
  const fieldMatch = raw.match(/"private_key"\s*:\s*"([\s\S]*?)"\s*,?/);
  if (fieldMatch) {
    try {
      raw = JSON.parse(`"${fieldMatch[1]}"`);
    } catch {
      raw = fieldMatch[1];
    }
  }
  raw = raw.replace(/^private_key\s*:\s*/i, "").replace(/^"|"[,]?$/g, "");
  return raw.replace(/\\n/g, "\n").trim();
}

function firstConfigured(...values) {
  return values.map((value) => normalize(value)).find(Boolean) || "";
}

function normalizeSpreadsheetId(value = "") {
  const raw = normalize(value);
  if (!raw) return "";
  const match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) || raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : raw;
}

function serviceAccountFromJson(value = "") {
  const raw = normalize(value);
  if (!raw) return {};
  try {
    const json = JSON.parse(raw);
    return {
      email: normalize(json.client_email),
      privateKey: decodePrivateKey(json.private_key),
    };
  } catch {
    return {};
  }
}

export function googleSheetsSettings(db = {}) {
  const settings = db.settings || {};
  const json = serviceAccountFromJson(firstConfigured(settings.googleSheetsServiceAccountJson, process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON));
  const spreadsheetId = normalizeSpreadsheetId(firstConfigured(settings.googleSheetsSpreadsheetId, process.env.GOOGLE_SHEETS_SPREADSHEET_ID));
  const sheetName = firstConfigured(settings.googleSheetsSheetName, process.env.GOOGLE_SHEETS_SHEET_NAME, "Netflix");
  const serviceAccountEmail = firstConfigured(settings.googleSheetsServiceAccountEmail, process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL, json.email);
  const privateKey = firstConfigured(settings.googleSheetsPrivateKey, process.env.GOOGLE_SHEETS_PRIVATE_KEY, json.privateKey);
  return {
    spreadsheetId,
    sheetName,
    serviceAccountEmail,
    privateKey: decodePrivateKey(privateKey),
  };
}

export function googleSheetsConfigured(db = {}) {
  const settings = googleSheetsSettings(db);
  return Boolean(settings.spreadsheetId && settings.sheetName && settings.serviceAccountEmail && settings.privateKey);
}

export function googleSheetsPublicSettings(db = {}) {
  const settings = googleSheetsSettings(db);
  return {
    spreadsheetId: settings.spreadsheetId,
    sheetName: settings.sheetName,
    serviceAccountEmail: settings.serviceAccountEmail,
    privateKey: settings.privateKey ? STORED_SECRET_PLACEHOLDER : "",
  };
}

function base64url(value) {
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
}

async function googleAccessToken(db) {
  const settings = googleSheetsSettings(db);
  if (!googleSheetsConfigured(db)) {
    const error = new Error("Google Sheets belum dikonfigurasi");
    error.status = 400;
    throw error;
  }
  const cacheKey = `${settings.serviceAccountEmail}:${crypto.createHash("sha1").update(settings.privateKey).digest("hex")}`;
  if (tokenCache.key === cacheKey && tokenCache.accessToken && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url({ alg: "RS256", typ: "JWT" });
  const claim = base64url({
    iss: settings.serviceAccountEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  signer.end();
  const signature = signer.sign(settings.privateKey, "base64url");
  const assertion = `${header}.${claim}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || "Google auth gagal");
  }
  tokenCache = {
    key: cacheKey,
    accessToken: String(payload.access_token || ""),
    expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000,
  };
  return tokenCache.accessToken;
}

async function sheetsFetch(db, endpoint, options = {}) {
  const token = await googleAccessToken(db);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${endpoint}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || payload.error || "Google Sheets request gagal");
  }
  return payload;
}

function a1Column(index) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function quoteSheetName(name) {
  return `'${String(name || "Sheet1").replace(/'/g, "''")}'`;
}

function rowRange(sheetName, rowNumber, startColumn, width = SHEET_HEADERS.length) {
  const start = a1Column(startColumn);
  const end = a1Column(startColumn + width - 1);
  return `${quoteSheetName(sheetName)}!${start}${rowNumber}:${end}${rowNumber}`;
}

function nextWritableRow(values = [], minimumRow = 1) {
  let lastFilled = minimumRow - 1;
  for (let index = 0; index < values.length; index += 1) {
    const row = values[index] || [];
    if (row.some((cell) => normalize(cell))) lastFilled = index + 1;
  }
  return Math.max(minimumRow, lastFilled + 1);
}

function orderHistoryUsesSensitiveColumns(header = []) {
  return normalize(header[7]).toUpperCase() === "PASSWORD" || normalize(header[9]).toUpperCase() === "PIN";
}

function orderHistoryNeedsLegacyMigration(header = [], values = []) {
  if (orderHistoryUsesSensitiveColumns(header)) return true;
  const headerHasStatus = normalize(header[15]).toUpperCase() === "STATUS";
  if (headerHasStatus) return true;
  return values.slice(1).some((row = []) => normalize(row[16]));
}

function compactLegacyOrderHistoryRow(row = []) {
  return [
    row[0] ?? "",
    row[1] ?? "",
    row[2] ?? "",
    row[3] ?? "",
    row[4] ?? "",
    row[5] ?? "",
    row[6] ?? "",
    row[8] ?? "",
    row[10] ?? "",
    row[11] ?? "",
    row[12] ?? "",
    row[13] ?? "",
    row[14] ?? "",
    row[16] ?? row[15] ?? "",
  ];
}

function poolSchema(pool = {}) {
  if (pool.schema) return pool.schema;
  if (["viu", "vidio"].includes(pool.productKey)) return "split";
  return "profile";
}

function normalizedPoolProductKey(pool = {}) {
  const parsed = parseDynamicPoolKey(pool.key || "");
  return normalizePoolMarker(parsed.productKey || pool.productKey || "");
}

function isDisneyPool(pool = {}) {
  const normalizedProduct = normalizedPoolProductKey(pool);
  return normalizedProduct === "DISNEY" || normalizedProduct === "DISNEYPLUS";
}

function poolHeaders(pool = {}) {
  if (isDisneyPool(pool)) return DISNEY_HEADERS;
  const schema = poolSchema(pool);
  if (schema === "split") return SIMPLE_ACCOUNT_HEADERS;
  if (schema === "universal") return UNIVERSAL_ACCOUNT_HEADERS;
  return SHEET_HEADERS;
}

function poolUsesSplitPassword(pool = {}) {
  return poolSchema(pool) === "split";
}

function poolUsesUniversalAccount(pool = {}) {
  return poolSchema(pool) === "universal";
}

function cellRange(sheetName, rowNumber, columnIndex) {
  const column = a1Column(columnIndex);
  return `${quoteSheetName(sheetName)}!${column}${rowNumber}`;
}

function protectedFormulaHeader(header = "") {
  const token = headerToken(header);
  return [
    "EXPIRED",
    "EXPIRY",
    "EXPIRES",
    "EXPIRESAT",
    "EXPIREDAT",
    "EXPIREDDATE",
    "TANGGALEXPIRED",
    "BERAKHIR",
    "TERPAKAI",
    "USED",
    "SISA",
    "AVAILABLE",
    "REMAINING",
    "LEFT",
    "NOMORWA",
    "NOMERWA",
    "NOWA",
    "NOMORWHATSAPP",
    "NOMERWHATSAPP",
    "NOWHATSAPP",
    "WHATSAPPNUMBER",
    "WHATSAPP",
    "WA",
  ].includes(token);
}

const PROTECTED_FORMULA_KEYS = new Set([
  "EXPIRED",
  "EXPIRY",
  "EXPIRES",
  "EXPIRESAT",
  "EXPIREDAT",
  "EXPIREDDATE",
  "TANGGALEXPIRED",
  "BERAKHIR",
  "TERPAKAI",
  "USED",
  "SISA",
  "AVAILABLE",
  "REMAINING",
  "LEFT",
  "NOMORWA",
  "NOMERWA",
  "NOWA",
  "NOMORWHATSAPP",
  "NOMERWHATSAPP",
  "NOWHATSAPP",
  "WHATSAPPNUMBER",
  "WHATSAPP",
  "WA",
]);

function protectedFormulaKey(key = "") {
  return PROTECTED_FORMULA_KEYS.has(headerToken(key));
}

function safeCellUpdates(sheetName, rowNumber, startColumn, headers = [], values = [], options = {}) {
  const protectedHeaders = new Set((options.protectedHeaders || []).map(headerToken).filter(Boolean));
  const allowHeaders = new Set((options.allowHeaders || []).map(headerToken).filter(Boolean));
  const preserveIndexes = new Set(
    (options.preserveIndexes || [])
      .map((index) => Number(index))
      .filter((index) => Number.isInteger(index) && index >= 0),
  );
  const data = [];
  for (let index = 0; index < values.length; index += 1) {
    const header = headers[index] || "";
    const token = headerToken(header);
    if (!token) continue;
    if (preserveIndexes.has(index)) continue;
    if (allowHeaders.size && !allowHeaders.has(token)) continue;
    if (!allowHeaders.size && (protectedHeaders.has(token) || protectedFormulaHeader(header))) continue;
    data.push({
      range: cellRange(sheetName, rowNumber, startColumn + index),
      values: [[values[index] ?? ""]],
    });
  }
  return data;
}

function clearCellUpdatesByColumns(sheetName, rowNumber, columns = {}, keys = []) {
  const data = [];
  const seen = new Set();
  for (const key of keys) {
    if (protectedFormulaKey(key)) continue;
    const columnIndex = columns[key];
    if (!Number.isFinite(columnIndex) || columnIndex < 0 || seen.has(columnIndex)) continue;
    seen.add(columnIndex);
    data.push({
      range: cellRange(sheetName, rowNumber, columnIndex),
      values: [[""]],
    });
  }
  return data;
}

function legacyMetadataOffsetsForPool(pool = {}) {
  if (poolUsesUniversalAccount(pool)) return [6, 8];
  if (poolUsesSplitPassword(pool)) return [7, 9];
  return [9, 11];
}

function clearLegacyMetadataCells(sheetName, rowNumber, startColumn, pool = {}) {
  return legacyMetadataOffsetsForPool(pool).map((offset) => ({
    range: cellRange(sheetName, rowNumber, Number(startColumn || 0) + offset),
    values: [[""]],
  }));
}

function formulaIndexesFromRow(row = []) {
  const preserve = new Set();
  for (let index = 0; index < row.length; index += 1) {
    const value = row[index];
    if (typeof value !== "string") continue;
    if (!value.trim().startsWith("=")) continue;
    preserve.add(index);
  }
  return preserve;
}

function valuesRange(sheetName) {
  return `${quoteSheetName(sheetName)}!A:ZZ`;
}

function sheetMetaCacheKey(db) {
  const { spreadsheetId } = googleSheetsSettings(db);
  return spreadsheetId || "";
}

let spreadsheetMetaCache = { key: "", meta: null, expiresAt: 0 };

function columnCountFromLetters(value = "") {
  let count = 0;
  for (const char of String(value || "").toUpperCase()) {
    if (char < "A" || char > "Z") return 0;
    count = count * 26 + char.charCodeAt(0) - 64;
  }
  return count;
}

function valueRangeGridRequirement(range = "") {
  const bangIndex = String(range || "").lastIndexOf("!");
  if (bangIndex < 1) return null;
  let sheetName = String(range).slice(0, bangIndex).trim();
  if (sheetName.startsWith("'") && sheetName.endsWith("'")) {
    sheetName = sheetName.slice(1, -1).replace(/''/g, "'");
  }
  let columns = 0;
  let rows = 0;
  for (const part of String(range).slice(bangIndex + 1).split(":")) {
    const matched = part.trim().match(/^\$?([A-Z]+)\$?(\d+)?$/i);
    if (!matched) continue;
    columns = Math.max(columns, columnCountFromLetters(matched[1]));
    rows = Math.max(rows, Number(matched[2] || 0));
  }
  return sheetName && columns ? { sheetName, columns, rows } : null;
}

async function ensureValueRangesFit(db, data = []) {
  const requiredBySheet = new Map();
  for (const item of data || []) {
    const requirement = valueRangeGridRequirement(item?.range || "");
    if (!requirement) continue;
    const current = requiredBySheet.get(requirement.sheetName) || { columns: 0, rows: 0 };
    current.columns = Math.max(current.columns, requirement.columns);
    current.rows = Math.max(current.rows, requirement.rows);
    requiredBySheet.set(requirement.sheetName, current);
  }
  const requests = [];
  for (const [sheetName, required] of requiredBySheet) {
    const properties = await getSheetProperties(db, sheetName);
    const sheetId = properties?.sheetId;
    if (sheetId === undefined || sheetId === null) continue;
    const currentColumns = Number(properties.gridProperties?.columnCount || 0);
    const currentRows = Number(properties.gridProperties?.rowCount || 0);
    const columnCount = Math.max(currentColumns, required.columns);
    const rowCount = Math.max(currentRows, required.rows);
    const fields = [];
    const gridProperties = {};
    if (columnCount > currentColumns) {
      gridProperties.columnCount = columnCount;
      fields.push("gridProperties.columnCount");
    }
    if (rowCount > currentRows) {
      gridProperties.rowCount = rowCount;
      fields.push("gridProperties.rowCount");
    }
    if (!fields.length) continue;
    requests.push({
      updateSheetProperties: {
        properties: { sheetId, gridProperties },
        fields: fields.join(","),
      },
    });
  }
  if (requests.length) await batchUpdate(db, requests);
}

async function updateValues(db, data) {
  const { spreadsheetId } = googleSheetsSettings(db);
  await ensureValueRangesFit(db, data);
  return sheetsFetch(db, `${spreadsheetId}/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data,
    }),
  });
}

async function getSpreadsheetMeta(db) {
  const cacheKey = sheetMetaCacheKey(db);
  const now = Date.now();
  if (spreadsheetMetaCache.key === cacheKey && spreadsheetMetaCache.meta && spreadsheetMetaCache.expiresAt > now) {
    return spreadsheetMetaCache.meta;
  }
  const { spreadsheetId } = googleSheetsSettings(db);
  const meta = await sheetsFetch(db, `${spreadsheetId}?fields=sheets.properties`);
  spreadsheetMetaCache = {
    key: cacheKey,
    meta,
    expiresAt: now + 15_000,
  };
  return meta;
}

async function getSheetId(db, sheetName) {
  const meta = await getSpreadsheetMeta(db);
  const sheet = (meta.sheets || []).find((item) => item.properties?.title === sheetName);
  return sheet?.properties?.sheetId ?? null;
}

async function getSheetProperties(db, sheetName) {
  const meta = await getSpreadsheetMeta(db);
  const sheet = (meta.sheets || []).find((item) => item.properties?.title === sheetName);
  return sheet?.properties || null;
}

async function ensureSheetExists(db, sheetName) {
  const existing = await getSheetId(db, sheetName);
  if (existing !== null) return existing;
  try {
    await batchUpdate(db, [{ addSheet: { properties: { title: sheetName } } }]);
  } catch (error) {
    if (!String(error.message || "").includes("already exists")) throw error;
  }
  return getSheetId(db, sheetName);
}

async function batchUpdate(db, requests) {
  const { spreadsheetId } = googleSheetsSettings(db);
  spreadsheetMetaCache = { key: "", meta: null, expiresAt: 0 };
  return sheetsFetch(db, `${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
}

async function readSheetValues(db) {
  const { spreadsheetId, sheetName } = googleSheetsSettings(db);
  const response = await sheetsFetch(db, `${spreadsheetId}/values/${encodeURIComponent(valuesRange(sheetName))}?valueRenderOption=FORMATTED_VALUE`);
  return response.values || [];
}

export async function readSheetValuesByName(db, sheetName) {
  const { spreadsheetId } = googleSheetsSettings(db);
  const response = await sheetsFetch(db, `${spreadsheetId}/values/${encodeURIComponent(valuesRange(sheetName))}?valueRenderOption=FORMATTED_VALUE`);
  return response.values || [];
}

function hashKey(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 14);
}

function productIsNetflix(product = {}) {
  const text = [product.id, product.code, product.name, product.category].map(normalizeLower).join(" ");
  return text.includes("netflix") || normalize(product.code).toUpperCase() === "NET";
}

function productIsViu(product = {}) {
  const text = [product.id, product.code, product.name, product.category].map(normalizeLower).join(" ");
  return text.includes("viu") || normalize(product.code).toUpperCase() === "VIU";
}

function productIsVidio(product = {}) {
  const text = [product.id, product.code, product.name, product.category].map(normalizeLower).join(" ");
  return text.includes("vidio") || normalize(product.code).toUpperCase() === "VIDIO";
}

function slugPart(value = "") {
  return normalizePoolMarker(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function displayNameFromPoolPart(value = "") {
  const raw = String(value || "").replace(/[_-]+/g, " ").trim();
  if (!raw) return "Akun";
  const upperWords = new Set(["HBO", "TV", "VIP", "UHD", "HD", "AI", "GPT", "VIU"]);
  return raw
    .split(/\s+/)
    .map((word) => {
      const upper = word.toUpperCase();
      if (/^\d+U$/i.test(word)) return upper;
      if (upperWords.has(upper)) return upper;
      if (upper === "YOUTUBE") return "YouTube";
      if (upper === "WETV") return "WeTV";
      if (upper === "CHATGPT") return "ChatGPT";
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function productDisplayNameFromKey(productKey = "") {
  const normalized = normalizePoolMarker(productKey);
  const overrides = {
    HBO: "HBO Max",
    HBOMAX: "HBO Max",
    YT: "YouTube Premium",
    YOUTUBE: "YouTube Premium",
    M365: "Microsoft 365",
    MS365: "Microsoft 365",
    MICROSOFT365: "Microsoft 365",
    OFFICE365: "Microsoft 365",
    WETV: "WeTV",
    CHATGPT: "ChatGPT",
    DISNEY: "Disney+",
    DISNEYPLUS: "Disney+",
    PRIME: "Prime Video",
    PRIMEVIDEO: "Prime Video",
  };
  return overrides[normalized] || displayNameFromPoolPart(productKey);
}

function productPoolAliases(product = {}) {
  const aliases = new Set();
  for (const value of [product.id, product.code, product.name, product.category]) {
    const marker = normalizePoolMarker(value);
    if (marker) aliases.add(marker);
  }
  const nameWords = normalize(product.name).split(/\s+/).filter(Boolean);
  if (nameWords[0]) aliases.add(normalizePoolMarker(nameWords[0]));
  if (/youtube/i.test(product.name || product.code || "")) aliases.add("YOUTUBE");
  if (/microsoft\s*365|ms\s*365|office\s*365/i.test(product.name || product.code || "")) {
    aliases.add("MS365");
    aliases.add("M365");
    aliases.add("MICROSOFT365");
    aliases.add("OFFICE365");
  }
  if (/hbo/i.test(product.name || product.code || "")) aliases.add("HBO");
  if (/wetv/i.test(product.name || product.code || "")) aliases.add("WETV");
  if (/chatgpt|openai/i.test(product.name || product.code || "")) aliases.add("CHATGPT");
  if (/prime/i.test(product.name || product.code || "")) aliases.add("PRIME");
  if (/disney/i.test(product.name || product.code || "")) aliases.add("DISNEY");
  return aliases;
}

function productMatchesPoolKey(product = {}, productKey = "") {
  const wanted = normalizePoolMarker(productKey);
  if (!wanted) return false;
  return productPoolAliases(product).has(wanted);
}

function parseDynamicPoolKey(poolKey = "") {
  const tokens = String(poolKey || "").split(/_+/).map(normalize).filter(Boolean);
  return { tokens, productKey: tokens[0] || "", variantKey: tokens.slice(1).join("_") || "" };
}

function dynamicPoolRequiresProfile(pool = {}) {
  const { productKey, variantKey } = parseDynamicPoolKey(pool.key || "");
  const normalizedProduct = normalizePoolMarker(productKey);
  const normalizedVariant = normalizePoolMarker(variantKey);
  if (normalizedProduct === "DISNEY" || normalizedProduct === "DISNEYPLUS") {
    if (normalizedVariant === "3U") return false;
  }
  return poolSchema(pool) === "profile";
}

function findProductForDynamicPool(db, poolKey = "") {
  const { tokens } = parseDynamicPoolKey(poolKey);
  for (let size = Math.max(1, tokens.length - 1); size >= 1; size -= 1) {
    const productKey = tokens.slice(0, size).join("_");
    const product = (db.products || []).find((item) => productMatchesPoolKey(item, productKey));
    if (product) {
      return {
        product,
        productKey,
        variantKey: tokens.slice(size).join("_") || "ACCOUNT",
      };
    }
  }
  return { product: null, productKey: tokens[0] || poolKey, variantKey: tokens.slice(1).join("_") || "ACCOUNT" };
}

function ensureDynamicProduct(db, productKey = "", schema = "universal") {
  db.products = db.products || [];
  const existing = (db.products || []).find((item) => productMatchesPoolKey(item, productKey));
  if (existing) {
    if (schema === "profile") {
      existing.needsProfile = true;
      existing.needsPin = true;
    }
    return { product: existing, created: false };
  }
  const idBase = slugPart(productKey) || "produk";
  let id = `prod-${idBase}`;
  let counter = 2;
  while (db.products.some((item) => item.id === id)) {
    id = `prod-${idBase}-${counter++}`;
  }
  const name = productDisplayNameFromKey(productKey);
  const product = {
    id,
    name,
    description: `Produk ${name} dari Google Sheets.`,
    category: name,
    isActive: true,
    needsProfile: schema === "profile",
    needsPin: schema === "profile",
    code: normalizePoolMarker(productKey).slice(0, 16) || idBase.toUpperCase(),
    variants: [],
  };
  db.products.push(product);
  return { product, created: true };
}

function variantMatchesPoolKey(variant = {}, variantKey = "") {
  const wanted = normalizePoolMarker(variantKey || "ACCOUNT");
  if (!wanted) return false;
  const aliases = [variant.id, variant.code, variant.name].map(normalizePoolMarker).filter(Boolean);
  return aliases.some((alias) => alias === wanted || alias.endsWith(wanted) || wanted.endsWith(alias));
}

function ensureDynamicVariant(product = {}, productKey = "", variantKey = "") {
  product.variants = product.variants || [];
  const wanted = variantKey || "ACCOUNT";
  const existing = product.variants.find((variant) => isVariantOrderable(product, variant) && variantMatchesPoolKey(variant, wanted));
  if (existing) return { variant: existing, created: false };

  const productCode = normalize(product.code || productKey || product.id).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "PROD";
  const variantSlug = slugPart(wanted) || "account";
  let id = `${slugPart(product.id || productCode)}-${variantSlug}`;
  let counter = 2;
  while (product.variants.some((item) => item.id === id)) {
    id = `${slugPart(product.id || productCode)}-${variantSlug}-${counter++}`;
  }
  const priceTemplate = product.variants.find((variant) => variant.prices && Object.keys(variant.prices).length)?.prices;
  const modeTemplate = product.variants.find((variant) => variant.durationModes)?.durationModes;
  const durationModes = modeTemplate
    ? { daily: modeTemplate.daily !== false, monthly: modeTemplate.monthly !== false }
    : { daily: true, monthly: true };
  const variant = {
    id,
    code: `${productCode}-${normalizePoolMarker(wanted).replace(/_/g, "-")}`.slice(0, 32),
    name: displayNameFromPoolPart(wanted),
    description: `Stok ${product.name} ${displayNameFromPoolPart(wanted)} dari Google Sheets.`,
    prices: priceTemplate ? { ...priceTemplate } : { "1 Bulan": 0, "3 Bulan": 0 },
    durationModes,
    snk: "Gunakan akun sesuai data yang diberikan admin.",
    snkMonthly: "Gunakan akun sesuai data yang diberikan admin.",
    snkDaily: "",
  };
  product.variants.push(variant);
  return { variant, created: true };
}

function netflixProduct(db) {
  return (db.products || []).find(productIsNetflix) || null;
}

function productForConfig(db, config) {
  return (db.products || []).find(config.productMatch) || null;
}

function poolVariant(product, pool) {
  return (product?.variants || []).find((variant) => isVariantOrderable(product, variant) && pool.variantMatch(product, variant)) || null;
}

function parseAccountCell(value = "") {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const emailIndex = lines.findIndex((line) => line.includes("@"));
  const email = emailIndex >= 0 ? lines[emailIndex] : lines[0] || "";
  const password = emailIndex >= 0 ? lines[emailIndex + 1] || "" : lines[1] || "";
  return { email, password };
}

function monthNumber(name = "") {
  const key = normalizeLower(name).replace(/\./g, "");
  const months = {
    jan: 0,
    januari: 0,
    feb: 1,
    februari: 1,
    mar: 2,
    maret: 2,
    apr: 3,
    april: 3,
    mei: 4,
    may: 4,
    jun: 5,
    juni: 5,
    jul: 6,
    juli: 6,
    agu: 7,
    agustus: 7,
    aug: 7,
    sep: 8,
    september: 8,
    okt: 9,
    oktober: 9,
    oct: 9,
    nov: 10,
    november: 10,
    des: 11,
    desember: 11,
    dec: 11,
  };
  return months[key];
}

function parseDateText(value = "") {
  const raw = normalize(value);
  if (!raw) return null;
  const iso = raw.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T,]+(\d{1,2})[:.](\d{2}))?/);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4] || 0), Number(iso[5] || 0));
  }
  const numericDmy = raw.match(/(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?(?:[ T,]+(\d{1,2})[:.](\d{2}))?/);
  if (numericDmy) {
    const now = new Date();
    let year = Number(numericDmy[3] || now.getFullYear());
    if (year < 100) year += 2000;
    return new Date(year, Number(numericDmy[2]) - 1, Number(numericDmy[1]), Number(numericDmy[4] || 0), Number(numericDmy[5] || 0));
  }
  const id = raw.toLowerCase().match(/(\d{1,2})[\s/-]*([a-zA-Z]+)(?:[\s/-]+(\d{4}))?(?:[\s,]+(\d{1,2})[:.](\d{2}))?/);
  if (id) {
    const month = monthNumber(id[2]);
    if (month !== undefined) {
      const now = new Date();
      return new Date(Number(id[3] || now.getFullYear()), month, Number(id[1]), Number(id[4] || 0), Number(id[5] || 0));
    }
  }
  const fallback = new Date(raw.replace(" ", "T"));
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function parseDurationDays(value = "", fallbackText = "") {
  const source = `${value || ""} ${fallbackText || ""}`.trim().toLowerCase();
  const number = Number(source.match(/\d+/)?.[0] || 0);
  if (!number) return 0;
  if (/(?:^|\s)\d+\s*(?:b|bln|bulan|month|months)\b/i.test(source)) return number * 30;
  if (/(?:^|\s)\d+\s*(?:t|thn|tahun|year|years)\b/i.test(source)) return number * 365;
  if (/(?:^|\s)\d+\s*(?:jam|hour|hours|hr)\b/i.test(source)) return Math.max(1, Math.ceil(number / 24));
  if (/(?:^|\s)\d+\s*(?:d|h|hari|day|days)\b/i.test(source)) return number;
  return number;
}

function parseDurationUnit(value = "") {
  const source = String(value || "").trim().toLowerCase();
  const amount = Number(source.match(/\d+/)?.[0] || 0);
  if (!amount) return { amount: 0, unit: "" };
  if (/(?:^|\s)\d+\s*(?:b|bln|bulan|month|months)\b/i.test(source)) return { amount, unit: "month" };
  if (/(?:^|\s)\d+\s*(?:t|thn|tahun|year|years)\b/i.test(source)) return { amount, unit: "year" };
  if (/(?:^|\s)\d+\s*(?:jam|hour|hours|hr)\b/i.test(source)) return { amount, unit: "hour" };
  if (/(?:^|\s)\d+\s*(?:d|h|hari|day|days)\b/i.test(source)) return { amount, unit: "day" };
  return { amount, unit: "" };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const ID_MONTH_NAMES = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function formatSheetPurchaseDate(value) {
  const parsed = value instanceof Date ? value : parseDateText(value);
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) return "";
  return formatDateTime(parsed);
}

function hasExplicitClock(value = "") {
  return /\b\d{1,2}[:.]\d{2}\b/.test(String(value || ""));
}

function preferPurchaseDate(account = {}, order = {}, stock = {}) {
  const rawValue = order.paidAt || order.createdAt || account.startedAt || stock.soldAt || "";
  const parsed = parseDateText(rawValue) || new Date();
  if (!hasExplicitClock(rawValue)) {
    const reference = parseDateText(order.paidAt || order.createdAt || account.startedAt || account.createdAt || stock.soldAt || "");
    if (reference instanceof Date && !Number.isNaN(reference.getTime())) {
      parsed.setHours(reference.getHours(), reference.getMinutes(), 0, 0);
    }
  }
  return parsed;
}

function formatSheetDurationLabel(value = "", fallbackDays = 0) {
  const normalized = String(value || "").trim();
  const { amount, unit } = parseDurationUnit(normalized);
  if (amount && unit === "month") return `${amount} Bulan`;
  if (amount && unit === "year") return `${amount} Tahun`;
  if (amount && unit === "hour") return `${amount} Jam`;
  if (amount && unit === "day") return `${amount} Hari`;
  const days = Math.max(0, Number(fallbackDays || parseDurationDays(normalized) || 0));
  if (!days) return "";
  if (days % 365 === 0) return `${Math.max(1, Math.floor(days / 365))} Tahun`;
  if (days % 30 === 0) return `${Math.max(1, Math.floor(days / 30))} Bulan`;
  return `${days} Hari`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setTime(next.getTime() + Math.max(1, Number(days || 1)) * 86400000);
  return next;
}

function addCalendarMonths(date, months) {
  const next = new Date(date);
  const wantedDay = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + Math.max(1, Number(months || 1)));
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(wantedDay, lastDay));
  return next;
}

function accountStatus(expiresAt) {
  const date = parseDateText(expiresAt);
  if (!date) return "active";
  return date.getTime() <= Date.now() ? "expired" : "active";
}

function sheetComputedExpiry(purchasedAt, durationDays) {
  return purchasedAt && durationDays ? formatDateTime(addDays(purchasedAt, durationDays)) : "";
}

function computedExpiryFromDuration(purchasedAt, durationText = "", durationDays = 0) {
  if (!purchasedAt) return "";
  const { amount, unit } = parseDurationUnit(durationText);
  if (amount && unit === "hour") return formatDateTime(new Date(purchasedAt.getTime() + amount * 3600000));
  if (amount && unit === "month") return formatDateTime(addCalendarMonths(purchasedAt, amount));
  if (amount && unit === "year") return formatDateTime(addCalendarMonths(purchasedAt, amount * 12));
  const fixedDays = Number(durationDays || parseDurationDays(durationText) || 0);
  return sheetComputedExpiry(purchasedAt, fixedDays);
}

function preferredExpiryText(purchasedAt, durationText = "", durationDays = 0, sheetExpiresAt = "") {
  const computed = computedExpiryFromDuration(purchasedAt, durationText, durationDays);
  if (computed) return computed;
  const sheetDate = parseDateText(sheetExpiresAt);
  if (!sheetDate) return computed;
  if (purchasedAt && sheetDate.getTime() <= purchasedAt.getTime() && computed) return computed;
  return sheetExpiresAt;
}

function normalizePoolMarker(value = "") {
  return normalize(value).toUpperCase().replace(/POOL[:\s-]*/g, "").replace(/[^A-Z0-9]/g, "").replace(/PLANTINUM/g, "PLATINUM");
}

function poolMarkerCandidates(pool) {
  return [pool.key, pool.label, ...(pool.aliases || [])].map(normalizePoolMarker).filter(Boolean);
}

function findPoolMarkers(values, pools = Object.values(POOLS)) {
  const markers = {};
  const candidates = new Map(pools.map((pool) => [pool.key, poolMarkerCandidates(pool)]));
  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] || [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const cell = normalizePoolMarker(row[columnIndex]);
      if (!cell) continue;
      for (const pool of pools) {
        if ((candidates.get(pool.key) || []).includes(cell)) {
          markers[pool.key] = { rowIndex, columnIndex };
        }
      }
    }
  }
  return markers;
}

function readCell(row, startColumn, offset) {
  return normalize(row[startColumn + offset]);
}

function readCellBounded(row, startColumn, offset, endColumn = Number.POSITIVE_INFINITY) {
  const index = Number(startColumn || 0) + Number(offset || 0);
  if (index < 0 || index >= Number(endColumn || 0)) return "";
  return normalize(row[index]);
}

function poolKeyFromMarker(value = "") {
  const raw = normalize(value);
  if (!/^\s*POOL\s*[:_-]/i.test(raw)) return "";
  return raw
    .replace(/^\s*POOL\s*[:_-]\s*/i, "")
    .replace(/plantinum/ig, "platinum")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function knownPoolMarkerSet() {
  const markers = new Set();
  for (const pool of Object.values(POOLS)) {
    for (const candidate of poolMarkerCandidates(pool)) markers.add(candidate);
  }
  return markers;
}

function findDynamicPoolMarkers(values) {
  const known = knownPoolMarkerSet();
  const markers = [];
  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] || [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const raw = normalize(row[columnIndex]);
      const key = poolKeyFromMarker(raw);
      if (!key) continue;
      const normalizedKey = normalizePoolMarker(key);
      if (!normalizedKey || known.has(normalizedKey)) continue;
      if (["CANVA", "CANVAPOOL", "CANVAUSAGE"].includes(normalizedKey)) continue;
      if (looksLikeLinkPoolHeader(values[rowIndex + 1] || [], columnIndex)) continue;
      markers.push({
        key,
        label: raw || `POOL: ${key}`,
        rowIndex,
        columnIndex,
      });
    }
  }
  return markers;
}

function headerToken(value = "") {
  return normalizePoolMarker(value);
}

function normalizedDynamicStartColumn(header = [], startColumn = 0) {
  const current = headerToken(header[startColumn]);
  const previous = startColumn > 0 ? headerToken(header[startColumn - 1]) : "";
  if (previous === "NUMBER" && ["OTPEMAIL", "EMAIL", "NAMAPROFIL", "PROFILE", "PROFIL"].includes(current)) {
    return startColumn - 1;
  }
  const identityTokens = new Set(["ACCOUNT", "AKUN", "EMAILAKUN", "NUMBER", "NOMOR", "NOMORLOGIN", "NOHP", "NOMORHP", "PHONE", "PHONENUMBER"]);
  const candidates = header
    .map((value, index) => (identityTokens.has(headerToken(value)) ? index : -1))
    .filter((index) => index >= 0);
  if (candidates.length && !identityTokens.has(current)) {
    return candidates.sort((a, b) => Math.abs(a - startColumn) - Math.abs(b - startColumn))[0];
  }
  return startColumn;
}

function headerHasAlias(header = [], startColumn = 0, endColumn = header.length, aliases = []) {
  return dynamicHeaderIndex(header, startColumn, endColumn, aliases) >= 0;
}

function looksLikeLinkPoolHeader(header = [], startColumn = 0, endColumn = header.length) {
  const hasLink = headerHasAlias(header, startColumn, endColumn, ["LINK", "CANVA LINK", "INVITE LINK", "URL"]);
  const hasQuota = headerHasAlias(header, startColumn, endColumn, ["KUOTA", "QUOTA", "LIMIT"]);
  const hasUsed = headerHasAlias(header, startColumn, endColumn, ["TERPAKAI", "USED"]);
  const hasAvailable = headerHasAlias(header, startColumn, endColumn, ["SISA", "AVAILABLE"]);
  const hasStatus = headerHasAlias(header, startColumn, endColumn, ["STATUS"]);
  return hasQuota && (hasLink || hasUsed || hasAvailable || hasStatus);
}

function looksLikeLinkUsageHeader(header = [], startColumn = 0, endColumn = header.length) {
  return (
    headerHasAlias(header, startColumn, endColumn, ["EMAIL CUSTOMER", "EMAIL CUST", "CUSTOMER EMAIL"])
    && headerHasAlias(header, startColumn, endColumn, ["DURASI", "DURATION"])
  );
}

function dynamicHeaderIndex(header = [], startColumn = 0, endColumn = header.length, aliases = []) {
  const wanted = aliases.map(headerToken).filter(Boolean);
  for (let index = startColumn; index < endColumn; index += 1) {
    const token = headerToken(header[index]);
    if (!token) continue;
    if (wanted.includes(token)) return index;
  }
  return -1;
}

function inferDynamicPoolSchema(header = [], startColumn = 0, endColumn = header.length) {
  const hasProfile = dynamicHeaderIndex(header, startColumn, endColumn, ["Nama profil", "Profile", "Profil", "Nama profile"]) >= 0;
  const hasPin = dynamicHeaderIndex(header, startColumn, endColumn, ["PIN", "Profile PIN"]) >= 0;
  const hasPassword = dynamicHeaderIndex(header, startColumn, endColumn, ["PASSWORD", "PASS", "Password"]) >= 0;
  if (hasProfile || hasPin) return "profile";
  if (hasPassword) return "split";
  return "universal";
}

function dynamicPoolColumns(header = [], startColumn = 0, endColumn = header.length, schema = "universal") {
  return {
    account: dynamicHeaderIndex(header, startColumn, endColumn, ["ACCOUNT", "AKUN", "EMAIL", "EMAIL AKUN"]),
    loginPhone: dynamicHeaderIndex(header, startColumn, endColumn, ["NUMBER", "NOMOR", "NOMOR LOGIN", "NO HP", "NOMOR HP", "PHONE", "PHONE NUMBER"]),
    otpEmail: dynamicHeaderIndex(header, startColumn, endColumn, ["OTP EMAIL", "EMAIL OTP", "EMAIL LOGIN", "EMAIL"]),
    password: schema === "split" ? dynamicHeaderIndex(header, startColumn, endColumn, ["PASSWORD", "PASS", "PW"]) : -1,
    profile: schema === "profile" ? dynamicHeaderIndex(header, startColumn, endColumn, ["Nama profil", "Profile", "Profil", "Nama profile"]) : -1,
    date: dynamicHeaderIndex(header, startColumn, endColumn, ["TANGGAL", "TANGGAL BELI", "PURCHASED", "START"]),
    duration: dynamicHeaderIndex(header, startColumn, endColumn, ["DURASI", "DURATION"]),
    expiresAt: dynamicHeaderIndex(header, startColumn, endColumn, ["EXPIRED", "EXPIRY", "EXPIRES", "BERAKHIR"]),
    device: dynamicHeaderIndex(header, startColumn, endColumn, CHECKOUT_DEVICE_HEADERS),
    seller: dynamicHeaderIndex(header, startColumn, endColumn, ["SELLER", "RESELLER", "RESS"]),
    whatsapp: dynamicHeaderIndex(header, startColumn, endColumn, ["NOMOR WA", "NO WA", "WHATSAPP", "WA"]),
    pin: schema === "profile" ? dynamicHeaderIndex(header, startColumn, endColumn, ["PIN", "PROFILE PIN"]) : -1,
    orderId: dynamicHeaderIndex(header, startColumn, endColumn, ["ORDER ID", "ORDER", "ID ORDER"]),
    notes: dynamicHeaderIndex(header, startColumn, endColumn, ["CATATAN", "NOTE", "NOTES"]),
    stockId: dynamicHeaderIndex(header, startColumn, endColumn, ["STOCK ID", "ID STOK", "STOK ID"]),
  };
}

function checkoutRequirementsFromSheetHeader(header = [], startColumn = 0, endColumn = header.length) {
  const emailColumn = dynamicHeaderIndex(header, startColumn, endColumn, CHECKOUT_EMAIL_HEADERS);
  if (emailColumn >= 0) {
    return {
      customerField: "email",
      required: true,
      minItems: 1,
      label: "Email Customer",
      placeholder: "email customer, pisahkan jika beli banyak",
      helper: "Wajib isi email customer. Jika qty lebih dari 1, isi sejumlah qty.",
    };
  }

  const deviceColumn = dynamicHeaderIndex(header, startColumn, endColumn, CHECKOUT_DEVICE_HEADERS);
  if (deviceColumn >= 0) {
    return {
      customerField: "device",
      required: true,
      minItems: 1,
      label: "Device Customer",
      placeholder: "Contoh: Smart TV Samsung",
      helper: "Wajib isi device customer supaya admin bisa audit akun.",
    };
  }

  return null;
}

function checkoutRequirementsForSheetPool(values = [], pool = {}, allMarkers = [], pools = Object.values(POOLS)) {
  const marker = pool.rowIndex !== undefined
    ? { rowIndex: pool.rowIndex, columnIndex: Number(pool.markerColumn ?? pool.startColumn ?? 0) }
    : (findPoolMarkers(values, pools)[pool.key] || { rowIndex: 10, columnIndex: pool.startColumn });
  const headerRowIndex = marker.rowIndex + 1;
  const header = values[headerRowIndex] || [];
  const nextStart = allMarkers.length
    ? allMarkers
      .filter((item) => item.rowIndex === marker.rowIndex && item.columnIndex > marker.columnIndex)
      .map((item) => item.columnIndex)
      .sort((a, b) => a - b)[0] || header.length || marker.columnIndex + poolHeaders(pool).length
    : marker.columnIndex + poolHeaders(pool).length;
  return checkoutRequirementsFromSheetHeader(header, marker.columnIndex, nextStart);
}

function applySheetCheckoutRequirements(target = {}, requirements = null) {
  if (requirements) {
    target.sheetCheckoutRequirements = requirements;
    return;
  }
  delete target.sheetCheckoutRequirements;
}

function readColumn(row = [], index = -1) {
  return index >= 0 ? normalize(row[index]) : "";
}

function firstPhoneLikeCell(row = [], startColumn = 0, endColumn = row.length) {
  for (let index = startColumn; index < endColumn; index += 1) {
    const value = normalize(row[index]);
    const digits = String(value || "").replace(/[^\d]/g, "");
    if (digits.length < 9) continue;
    if (String(value || "").includes("@")) continue;
    return normalizeWhatsapp(digits);
  }
  return "";
}

function inferredLoginPhone(row = [], columns = {}, startColumn = 0, endColumn = row.length) {
  const otpColumn = Number(columns.otpEmail ?? -1);
  const directIndex = Number(columns.loginPhone ?? -1);
  const direct = directIndex >= startColumn && (otpColumn < 0 || directIndex < otpColumn)
    ? normalizeWhatsapp(readColumn(row, directIndex))
    : "";
  if (direct) return direct;
  const boundaries = [columns.otpEmail, columns.profile, columns.date, endColumn]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > startColumn);
  const fallbackEnd = boundaries.length ? Math.min(...boundaries) : endColumn;
  return firstPhoneLikeCell(row, startColumn, fallbackEnd);
}

function parsePoolRows(values, pool, sheetName = "", pools = Object.values(POOLS), options = {}) {
  const markers = findPoolMarkers(values, pools);
  const marker = markers[pool.key] || { rowIndex: 10, columnIndex: pool.startColumn };
  const headerRowIndex = marker.rowIndex + 1;
  const dataStartIndex = headerRowIndex + 1;
  const header = values[headerRowIndex] || [];
  const nextStart = Object.values(markers)
    .filter((item) => item.rowIndex === marker.rowIndex && item.columnIndex > marker.columnIndex)
    .map((item) => item.columnIndex)
    .sort((a, b) => a - b)[0] || header.length || marker.columnIndex + poolHeaders(pool).length;
  const requireProfile = options.requireProfile !== false;
  const splitPassword = poolUsesSplitPassword(pool);
  const checkoutRequirements = checkoutRequirementsFromSheetHeader(header, marker.columnIndex, nextStart);
  const rows = [];
  for (let rowIndex = dataStartIndex; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] || [];
    const accountCell = readCellBounded(row, marker.columnIndex, 0, nextStart);
    const profile = splitPassword ? "" : readCellBounded(row, marker.columnIndex, 1, nextStart);
    const pin = splitPassword ? "" : readCellBounded(row, marker.columnIndex, 8, nextStart);
    const passwordCell = splitPassword ? readCellBounded(row, marker.columnIndex, 1, nextStart) : "";
    if (!accountCell && !passwordCell && !profile && !pin) continue;
    const parsed = parseAccountCell(accountCell);
    const email = parsed.email;
    const password = splitPassword ? passwordCell || parsed.password : parsed.password;
    if (!email || (requireProfile && !profile)) continue;
    const dateText = readCellBounded(row, marker.columnIndex, 2, nextStart);
    const durationText = readCellBounded(row, marker.columnIndex, 3, nextStart);
    const durationDays = parseDurationDays(durationText, dateText);
    const purchasedAt = parseDateText(dateText);
    const sheetExpiresAt = readCellBounded(row, marker.columnIndex, 4, nextStart);
    const expiresAt = preferredExpiryText(purchasedAt, durationText, durationDays, sheetExpiresAt);
    const sheetStockKey = `${pool.key}:${rowIndex + 1}:${email.toLowerCase()}:${profile.toLowerCase()}`;
    rows.push({
      pool: pool.key,
      sheetName,
      rowNumber: rowIndex + 1,
      startColumn: marker.columnIndex,
      sheetStockKey,
      stockId: readCellBounded(row, marker.columnIndex, splitPassword ? 9 : 11, nextStart) || `stk-sheet-${hashKey(sheetStockKey)}`,
      email,
      password,
      profile,
      pin,
      dateText,
      purchasedAt: purchasedAt ? formatDateTime(purchasedAt) : "",
      durationText,
      durationDays,
      expiresAt,
      device: splitPassword ? "" : readCellBounded(row, marker.columnIndex, 5, nextStart),
      seller: readCellBounded(row, marker.columnIndex, splitPassword ? 5 : 6, nextStart),
      whatsapp: normalizeWhatsapp(readCellBounded(row, marker.columnIndex, splitPassword ? 6 : 7, nextStart)),
      orderId: readCellBounded(row, marker.columnIndex, splitPassword ? 7 : 9, nextStart),
      notes: readCellBounded(row, marker.columnIndex, splitPassword ? 8 : 10, nextStart),
      checkoutRequirements,
    });
  }
  return rows;
}

function parseDynamicPoolRows(values, pool, allMarkers = []) {
  const initialHeaderRowIndex = pool.rowIndex + 1;
  const header = values[initialHeaderRowIndex] || [];
  const markerColumn = Number(pool.markerColumn ?? pool.startColumn ?? 0);
  const normalizedStart = normalizedDynamicStartColumn(header, markerColumn);
  const marker = { rowIndex: pool.rowIndex, columnIndex: normalizedStart };
  const headerRowIndex = marker.rowIndex + 1;
  const dataStartIndex = headerRowIndex + 1;
  const nextStart = allMarkers
    .filter((item) => item.rowIndex === marker.rowIndex && item.columnIndex > markerColumn)
    .map((item) => item.columnIndex)
    .sort((a, b) => a - b)[0] || header.length || marker.columnIndex + poolHeaders(pool).length;
  const schema = poolSchema(pool);
  const columns = dynamicPoolColumns(header, marker.columnIndex, nextStart, schema);
  const checkoutRequirements = checkoutRequirementsFromSheetHeader(header, marker.columnIndex, nextStart);
  const rows = [];
  if (columns.account < 0 && columns.loginPhone < 0 && columns.otpEmail < 0) return rows;
  for (let rowIndex = dataStartIndex; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] || [];
    const accountCell = readColumn(row, columns.account);
    const loginPhone = readColumn(row, columns.loginPhone);
    const otpEmail = readColumn(row, columns.otpEmail);
    const passwordCell = readColumn(row, columns.password);
    const profile = readColumn(row, columns.profile);
    const pin = readColumn(row, columns.pin);
    if (!accountCell && !loginPhone && !otpEmail && !passwordCell && !profile && !pin) continue;
    const parsed = parseAccountCell(accountCell);
    const accountPhone = normalizeWhatsapp(parsed.email || "");
    const normalizedPhone = inferredLoginPhone(row, columns, marker.columnIndex, nextStart) || accountPhone;
    const email = parsed.email || otpEmail || normalizedPhone;
    const password = schema === "split" ? passwordCell || parsed.password : parsed.password;
    if (!email) continue;
    if (dynamicPoolRequiresProfile(pool) && !profile) continue;
    const dateText = readColumn(row, columns.date);
    const durationText = readColumn(row, columns.duration);
    const durationDays = parseDurationDays(durationText, dateText);
    const purchasedAt = parseDateText(dateText);
    const sheetExpiresAt = readColumn(row, columns.expiresAt);
    const expiresAt = preferredExpiryText(purchasedAt, durationText, durationDays, sheetExpiresAt);
    const sheetStockKey = `${pool.key}:${rowIndex + 1}:${email.toLowerCase()}:${profile.toLowerCase()}`;
    rows.push({
      pool: pool.key,
      sheetName: pool.sheetName || "",
      rowNumber: rowIndex + 1,
      startColumn: marker.columnIndex,
      schema,
      sheetStockKey,
      stockId: readColumn(row, columns.stockId) || `stk-sheet-${hashKey(sheetStockKey)}`,
      email,
      loginPhone: normalizedPhone || "",
      otpEmail: otpEmail || "",
      password,
      profile,
      pin,
      dateText,
      purchasedAt: purchasedAt ? formatDateTime(purchasedAt) : "",
      durationText,
      durationDays,
      expiresAt,
      device: readColumn(row, columns.device),
      seller: readColumn(row, columns.seller),
      whatsapp: normalizeWhatsapp(readColumn(row, columns.whatsapp)),
      orderId: readColumn(row, columns.orderId),
      notes: readColumn(row, columns.notes),
      checkoutRequirements,
    });
  }
  return rows;
}

function existingBySheetKey(list = [], key) {
  return list.find((item) => item.sheetStockKey === key);
}

function legacySheetRowMatch(list = [], row = {}) {
  return list.find((item) => {
    if (!item || item.sheetSource !== "google_sheets") return false;
    if (row.sheetName && item.sheetName && item.sheetName !== row.sheetName) return false;
    if (String(item.sheetPool || "") !== String(row.pool || "")) return false;
    if (Number(item.sheetRow || 0) !== Number(row.rowNumber || 0)) return false;
    return normalizeLower(item.profile || "") === normalizeLower(row.profile || "");
  }) || null;
}

function managedSaleForSheetKey(list = [], key) {
  return list.find((item) => (
    item.sheetStockKey === key
    && !item.hidden
    && !item.returnedToStockAt
    && !["expired", "replaced", "disabled"].includes(normalizeLower(item.status || ""))
    && accountStatus(item.expiresAt) !== "expired"
  ));
}

function liveManagedIdentityKey(account = {}) {
  const orderId = String(account.orderId || account.sourceOrderId || "").trim();
  const stockKey = String(account.stockId || account.sheetStockKey || "").trim();
  if (!orderId || !stockKey) return "";
  return `${stockKey}::${orderId}`;
}

function isLiveManagedAccount(account = {}) {
  if (!account || account.hidden || account.returnedToStockAt) return false;
  const status = normalizeLower(account.status || "");
  if (["expired", "replaced", "disabled"].includes(status)) return false;
  return accountStatus(account.expiresAt) !== "expired";
}

function activeManagedIdentityAccount(list = [], payload = {}) {
  const key = liveManagedIdentityKey(payload);
  if (!key) return null;
  return list.find((item) => isLiveManagedAccount(item) && liveManagedIdentityKey(item) === key) || null;
}

function isArchivedSheetAccount(account = {}) {
  return Boolean(
    account.hidden
    || account.returnedToStockAt
    || account.archivedAt
    || account.manualArchivedAt
    || account.sheetMissingArchivedAt
    || account.sheetClearedAt
  );
}

function upsertManagedFromSheet(db, product, variant, stock, row) {
  db.managedAccounts = db.managedAccounts || [];
  const identity = sheetResellerIdentity(db, row);
  const reseller = identity.reseller;
  const canonicalReseller = canonicalSheetResellerName(identity, row.seller || row.whatsapp || "");
  const canonicalWhatsapp = identity.whatsapp || "";
  const nextStatus = accountStatus(row.expiresAt);
  const identitySeed = {
    stockId: stock.id,
    sheetStockKey: row.sheetStockKey,
    orderId: row.orderId,
    sourceOrderId: row.orderId,
  };
  const matchedSheetRow = db.managedAccounts.find((account) => managedAccountMatchesSheetRow(account, row, stock));
  const restoreSheetAssignment = Boolean(matchedSheetRow && String(row.seller || "").trim());
  const existing =
    activeManagedIdentityAccount(db.managedAccounts, identitySeed)
    || activeManagedIdentityAccount(db.managedAccounts, { stockId: stock.id, orderId: row.orderId, sourceOrderId: row.orderId })
    || activeManagedIdentityAccount(db.managedAccounts, { sheetStockKey: row.sheetStockKey, orderId: row.orderId, sourceOrderId: row.orderId })
    || managedSaleForSheetKey(db.managedAccounts, row.sheetStockKey)
    || matchedSheetRow;
  const previousHistory = existingBySheetKey(db.managedAccounts, row.sheetStockKey);
  const account = existing || {
    id: previousHistory ? `acc-sheet-${hashKey(`${row.sheetStockKey}:${row.purchasedAt || Date.now()}`)}` : `acc-sheet-${hashKey(row.sheetStockKey)}`,
    stockId: stock.id,
    source: "google_sheets",
    usageMode: Number(row.durationDays || 0) < 30 ? "daily" : "monthly",
    sheetStockKey: row.sheetStockKey,
    sheetSource: "google_sheets",
    sheetPool: row.pool,
    sheetPoolSchema: row.schema || stock.sheetPoolSchema || poolSchema({ productKey: "" }),
    sheetName: row.sheetName || stock.sheetName || "",
    sheetRow: row.rowNumber,
    sheetStartColumn: row.startColumn,
    hidden: false,
  };
  Object.assign(account, {
    stockId: stock.id,
    resellerId: reseller?.id || "",
    product: product.name,
    productId: product.id,
    variant: variant.name,
    variantId: variant.id,
    variantCode: variant.code,
    stockPoolKey: variantStockGroupKey(product, variant),
    duration: row.durationText || (row.durationDays ? `${row.durationDays} Hari` : ""),
    durationDays: row.durationDays || account.durationDays || 30,
    email: row.email,
    loginPhone: row.loginPhone || account.loginPhone || "",
    otpEmail: row.otpEmail || account.otpEmail || "",
    password: row.password,
    buyer: row.seller || identity.whatsapp || account.buyer || "",
    reseller: canonicalReseller,
    whatsapp: canonicalWhatsapp,
    sheetSellerInput: row.seller || "",
    sheetWhatsappInput: normalizeWhatsapp(row.whatsapp || ""),
    sheetResellerResolutionSource: identity.source || "",
    sheetResellerConflict: Boolean(identity.conflict),
    profile: row.profile,
    pin: row.pin,
    device: row.device || account.device || "",
    sheetSource: "google_sheets",
    sheetStockKey: row.sheetStockKey,
    sheetPool: row.pool,
    sheetPoolSchema: row.schema || stock.sheetPoolSchema || account.sheetPoolSchema || "",
    sheetName: row.sheetName || stock.sheetName || account.sheetName || "",
    sheetRow: row.rowNumber,
    sheetStartColumn: row.startColumn,
    // A sold Sheet row is the source of truth for its assignment period.
    // Never retain timestamps from an older web/order link after a Sheet sync.
    startedAt: row.purchasedAt,
    expiresAt: row.expiresAt,
    status: nextStatus,
    snapshotAt: account.snapshotAt || row.purchasedAt,
    hidden: false,
    returnedToStockAt: "",
    sheetClearedAt: "",
    sheetMissingArchivedAt: "",
  });
  if (existing?.source !== "google_sheets") {
    account.sheetStockKey = row.sheetStockKey;
    account.sheetSource = "google_sheets";
    account.sheetPool = row.pool;
    account.sheetPoolSchema = row.schema || stock.sheetPoolSchema || account.sheetPoolSchema || "";
    account.sheetName = row.sheetName || stock.sheetName || account.sheetName || "";
    account.sheetRow = row.rowNumber;
    account.sheetStartColumn = row.startColumn;
  } else if (!existing) {
    db.managedAccounts.unshift(account);
  }
  if (restoreSheetAssignment) {
    delete account.slotConflictArchived;
    delete account.duplicateOfAccountId;
    delete account.duplicateArchivedAt;
    delete account.archivedAt;
    delete account.manualArchivedAt;
  }
  // Distinct populated Sheet rows are distinct assignments, even when an
  // account/profile is intentionally reused. Exact order/stock duplicates are
  // still handled by the database consistency repair.
  return account;
}

function managedAccountMatchesSheetRow(account = {}, row = {}, stock = null) {
  if (!account || account.status === "replaced") return false;
  if (row.sheetStockKey && account.sheetStockKey === row.sheetStockKey) return true;
  if (stock?.id && account.stockId === stock.id) return true;
  if (row.rowNumber && Number(account.sheetRow || 0) === Number(row.rowNumber)) {
    const sameSheet = !row.sheetName || !account.sheetName || account.sheetName === row.sheetName;
    const sameColumn = Number(account.sheetStartColumn || 0) === Number(row.startColumn || 0);
    const sameEmail = normalizeLower(account.email || "") === normalizeLower(row.email || "");
    const sameProfile = normalizeLower(account.profile || "") === normalizeLower(row.profile || "");
    if (sameSheet && sameColumn && sameEmail && sameProfile) return true;
  }
  return false;
}

function activeManagedSheetDuplicate(account = {}, row = {}) {
  if (!account || account.hidden || account.returnedToStockAt) return false;
  if (account.status === "replaced") return false;
  if (String(account.sheetSource || account.source || "").toLowerCase() !== "google_sheets") return false;
  if (account.status === "expired" || accountStatus(account.expiresAt) === "expired") return false;
  const rowStockKey = String(row.sheetStockKey || "").trim();
  const accountStockKey = String(account.sheetStockKey || "").trim();
  if (rowStockKey && accountStockKey) return rowStockKey === accountStockKey;
  const rowStockId = String(row.stockId || "").trim();
  const accountStockId = String(account.stockId || "").trim();
  if (rowStockId && accountStockId) return rowStockId === accountStockId;
  if (!row.rowNumber) return false;
  const sameSheet = !row.sheetName || !account.sheetName || account.sheetName === row.sheetName;
  const sameColumn = Number(account.sheetStartColumn || 0) === Number(row.startColumn || 0);
  const sameRow = Number(account.sheetRow || 0) === Number(row.rowNumber || 0);
  return sameSheet && sameColumn && sameRow;
}

function sheetRowMoment(row = {}) {
  return parseDateText(row.purchasedAt || row.dateText || row.expiresAt || "");
}

function managedAccountMoment(account = {}) {
  return parseDateText(account.startedAt || account.snapshotAt || account.expiresAt || "");
}

function activeManagedSheetConflictSet(db, keptAccount, row = {}) {
  const conflicts = [];
  for (const account of db.managedAccounts || []) {
    if (!account || account.id === keptAccount?.id) continue;
    if (row.sheetStockKey && account.sheetStockKey === row.sheetStockKey) continue;
    if (!activeManagedSheetDuplicate(account, row)) continue;
    conflicts.push(account);
  }
  return conflicts;
}

function managedSheetConflictScore(account = {}, row = {}, fallbackMoment = 0) {
  const primaryMoment = row && account?.id === row.__currentAccountId
    ? (sheetRowMoment(row)?.getTime() || fallbackMoment || 0)
    : (managedAccountMoment(account)?.getTime() || 0);
  const expiryMoment = parseDateText(account.expiresAt || "")?.getTime() || 0;
  const rowNumber = Number(account.sheetRow || 0);
  return [primaryMoment, expiryMoment, rowNumber];
}

function dedupeManagedSheetConflicts(db, keptAccount, row = {}) {
  if (!keptAccount || !row.email) return 0;
  const clearedAt = formatDateTime(new Date());
  const conflicts = activeManagedSheetConflictSet(db, keptAccount, row);
  if (!conflicts.length) return 0;
  const currentMoment = sheetRowMoment(row)?.getTime() || managedAccountMoment(keptAccount)?.getTime() || 0;
  row.__currentAccountId = keptAccount.id;
  const candidates = [keptAccount, ...conflicts].sort((left, right) => {
    const leftScore = managedSheetConflictScore(left, row, currentMoment);
    const rightScore = managedSheetConflictScore(right, row, currentMoment);
    for (let index = 0; index < leftScore.length; index += 1) {
      if (leftScore[index] === rightScore[index]) continue;
      return rightScore[index] - leftScore[index];
    }
    return String(right.id || "").localeCompare(String(left.id || ""));
  });
  const winner = candidates[0];
  let hidden = 0;
  for (const account of candidates) {
    if (account.id === winner.id) {
      account.hidden = false;
      account.returnedToStockAt = "";
      account.sheetClearedAt = "";
      account.sheetMissingArchivedAt = "";
      continue;
    }
    account.status = "expired";
    account.hidden = true;
    account.returnedToStockAt = account.returnedToStockAt || clearedAt;
    account.sheetDedupedAt = clearedAt;
    account.sheetDedupedBy = winner.sheetStockKey || row.sheetStockKey || row.email || keptAccount.id;
    hidden += 1;
  }
  delete row.__currentAccountId;
  return hidden;
}

function clearManagedIfReturned(db, row, stock = null, options = {}) {
  const force = Boolean(options.force);
  const accounts = (db.managedAccounts || []).filter((account) => managedAccountMatchesSheetRow(account, row, stock));
  let cleared = 0;
  const clearedAt = formatDateTime(new Date());
  for (const account of accounts) {
    if (!force && account.status !== "expired" && accountStatus(account.expiresAt) !== "expired") continue;
    account.status = "expired";
    account.returnedToStockAt = clearedAt;
    account.hidden = true;
    account.sheetClearedAt = clearedAt;
    cleared += 1;
  }
  return cleared;
}

function liveManagedAccountForSheetStock(db, stock = {}) {
  const stockId = String(stock.id || "").trim();
  const sheetStockKey = String(stock.sheetStockKey || "").trim();
  if (!stockId && !sheetStockKey) return null;
  return (db.managedAccounts || []).find((account) => {
    if (!account || account.hidden || account.returnedToStockAt) return false;
    const status = normalizeLower(account.status || "");
    if (["expired", "replaced", "disabled"].includes(status)) return false;
    if (accountStatus(account.expiresAt) === "expired") return false;
    return (stockId && String(account.stockId || "").trim() === stockId)
      || (sheetStockKey && String(account.sheetStockKey || "").trim() === sheetStockKey);
  }) || null;
}

function linkedManagedAccountsForSheetStock(db, stock = {}) {
  const stockId = String(stock.id || "").trim();
  const sheetStockKey = String(stock.sheetStockKey || "").trim();
  if (!stockId && !sheetStockKey) return [];
  return (db.managedAccounts || []).filter((account) => (
    (stockId && String(account.stockId || "").trim() === stockId)
    || (sheetStockKey && String(account.sheetStockKey || "").trim() === sheetStockKey)
  ));
}

function sheetStockShouldStaySold(db, stock = {}) {
  const linkedAccounts = linkedManagedAccountsForSheetStock(db, stock);
  for (const account of linkedAccounts) {
    if (!account || account.returnedToStockAt) continue;
    const status = normalizeLower(account.status || "");
    const expiryMs = parseDateText(account.expiresAt || "")?.getTime() || 0;
    if (expiryMs > Date.now()) return true;
    if (!["expired", "replaced", "disabled"].includes(status) && accountStatus(account.expiresAt) !== "expired") return true;
  }
  const orderIds = new Set(
    linkedAccounts
      .map((account) => String(account.orderId || account.sourceOrderId || "").trim())
      .filter(Boolean),
  );
  for (const order of db.orders || []) {
    if ((order.deliveredStockIds || []).some((candidate) => String(candidate || "").trim() === String(stock.id || "").trim())) {
      orderIds.add(String(order.id || "").trim());
    }
  }
  return orderIds.size > 1;
}

function ensureManagedAccountForSheetStock(db, stock = {}) {
  if (!stock || String(stock.sheetSource || "").toLowerCase() !== "google_sheets") return null;
  if (String(stock.status || "").toLowerCase() !== "sold") return null;
  if (String(stock.sheetRemovedAt || "").trim()) return null;
  if (liveManagedAccountForSheetStock(db, stock)) return null;

  db.managedAccounts = db.managedAccounts || [];
  const existing = (db.managedAccounts || []).find((account) => {
    if (!account || account.status === "replaced") return false;
    return (stock.id && String(account.stockId || "").trim() === String(stock.id || "").trim())
      || (stock.sheetStockKey && String(account.sheetStockKey || "").trim() === String(stock.sheetStockKey || "").trim());
  });
  const account = existing || {
    id: `acc-sheet-${hashKey(`${stock.sheetStockKey || stock.id}:${stock.soldAt || Date.now()}`)}`,
    source: "google_sheets",
    usageMode: Number(stock.soldDurationDays || 0) < 30 ? "daily" : "monthly",
    hidden: false,
  };
  Object.assign(account, {
    stockId: stock.id || account.stockId || "",
    source: "google_sheets",
    resellerId: String(stock.resellerId || account.resellerId || "").trim(),
    product: stock.productName || account.product || "",
    productId: stock.productId || account.productId || "",
    variant: stock.variantName || account.variant || "",
    variantId: stock.variantId || account.variantId || "",
    variantCode: stock.variantCode || account.variantCode || "",
    stockPoolKey: stock.stockPoolKey || account.stockPoolKey || "",
    duration: stock.soldDuration || account.duration || "",
    durationDays: Number(stock.soldDurationDays || account.durationDays || 0),
    email: stock.email || account.email || "",
    loginPhone: stock.loginPhone || account.loginPhone || "",
    otpEmail: stock.otpEmail || account.otpEmail || "",
    password: stock.password || account.password || "",
    buyer: stock.buyer || account.buyer || "",
    reseller: stock.reseller || account.reseller || "",
    whatsapp: stock.whatsapp || account.whatsapp || "",
    profile: stock.profile || account.profile || "",
    pin: stock.pin || account.pin || "",
    device: stock.device || account.device || "",
    sheetSource: "google_sheets",
    sheetStockKey: stock.sheetStockKey || account.sheetStockKey || "",
    sheetPool: stock.sheetPool || account.sheetPool || "",
    sheetPoolSchema: stock.sheetPoolSchema || account.sheetPoolSchema || "",
    sheetName: stock.sheetName || account.sheetName || "",
    sheetRow: Number(stock.sheetRow || account.sheetRow || 0),
    sheetStartColumn: Number(stock.sheetStartColumn || account.sheetStartColumn || 0),
    startedAt: stock.soldAt || account.startedAt || "",
    expiresAt: stock.expiresAt || stock.soldExpiresAt || account.expiresAt || "",
    status: accountStatus(stock.expiresAt || stock.soldExpiresAt || account.expiresAt || ""),
    hidden: false,
    returnedToStockAt: "",
    sheetClearedAt: "",
    sheetMissingArchivedAt: "",
  });
  if (!existing) db.managedAccounts.unshift(account);
  return account;
}

function backfillManagedAccountsFromSoldStocks(db, stocks = []) {
  db.managedAccounts = db.managedAccounts || [];
  let repaired = 0;
  for (const stock of stocks) {
    if (!stock || String(stock.sheetSource || "").toLowerCase() !== "google_sheets") continue;
    if (String(stock.status || "").toLowerCase() !== "sold") continue;
    const existing = (db.managedAccounts || []).find((account) => (
      (stock.id && String(account.stockId || "").trim() === String(stock.id || "").trim())
      || (stock.sheetStockKey && String(account.sheetStockKey || "").trim() === String(stock.sheetStockKey || "").trim())
    ));
    if (existing) continue;
    db.managedAccounts.unshift({
      id: `acc-sheet-${hashKey(`${stock.sheetStockKey || stock.id}:${stock.soldAt || Date.now()}`)}`,
      stockId: stock.id || "",
      source: "google_sheets",
      usageMode: Number(stock.soldDurationDays || 0) < 30 ? "daily" : "monthly",
      hidden: false,
      resellerId: String(stock.resellerId || "").trim(),
      product: stock.productName || "",
      productId: stock.productId || "",
      variant: stock.variantName || "",
      variantId: stock.variantId || "",
      variantCode: stock.variantCode || "",
      stockPoolKey: stock.stockPoolKey || "",
      duration: stock.soldDuration || "",
      durationDays: Number(stock.soldDurationDays || 0),
      email: stock.email || "",
      loginPhone: stock.loginPhone || "",
      otpEmail: stock.otpEmail || "",
      password: stock.password || "",
      buyer: stock.buyer || "",
      reseller: stock.reseller || "",
      whatsapp: stock.whatsapp || "",
      profile: stock.profile || "",
      pin: stock.pin || "",
      device: stock.device || "",
      sheetSource: "google_sheets",
      sheetStockKey: stock.sheetStockKey || "",
      sheetPool: stock.sheetPool || "",
      sheetPoolSchema: stock.sheetPoolSchema || "",
      sheetName: stock.sheetName || "",
      sheetRow: Number(stock.sheetRow || 0),
      sheetStartColumn: Number(stock.sheetStartColumn || 0),
      startedAt: stock.soldAt || "",
      expiresAt: stock.expiresAt || stock.soldExpiresAt || "",
      status: accountStatus(stock.expiresAt || stock.soldExpiresAt || ""),
      returnedToStockAt: "",
      sheetClearedAt: "",
      sheetMissingArchivedAt: "",
    });
    repaired += 1;
  }
  return repaired;
}

function repairManagedAccountsFromSheetStock(db, config, sheetName, seenSheetKeys) {
  let repaired = 0;
  for (const stock of db.stock || []) {
    if (stock.sheetSource !== "google_sheets") continue;
    if (!seenSheetKeys.has(stock.sheetStockKey)) continue;
    if (!config.pools.some((pool) => pool.key === stock.sheetPool)) continue;
    if (stock.sheetName && stock.sheetName !== sheetName) continue;
    if (!ensureManagedAccountForSheetStock(db, stock)) continue;
    repaired += 1;
  }
  return repaired;
}

function sheetUsageFieldsCleared(row = {}) {
  return !row.purchasedAt
    && !row.dateText
    && !row.durationText
    && !row.expiresAt
    && !row.device
    && !row.seller
    && !row.whatsapp
    && !row.orderId;
}

function shouldAutoReturnClearedExpiredSheetRow(db, row = {}) {
  if (!sheetUsageFieldsCleared(row)) return false;
  const account = existingBySheetKey(db.managedAccounts || [], row.sheetStockKey);
  if (!account || account.returnedToStockAt || account.status === "replaced") return false;
  return account.status === "expired" || accountStatus(account.expiresAt) === "expired";
}

function sheetRowIdentity(payload = {}) {
  const sheetName = normalizeLower(payload.sheetName || "");
  const pool = normalize(payload.pool || payload.sheetPool || "");
  const rowNumber = Number(payload.rowNumber || payload.sheetRow || 0);
  if (!sheetName || !pool || !rowNumber) return "";
  return `${sheetName}::${pool}::${rowNumber}`;
}

function stockMatchesSheetRowIdentity(stock = {}, row = {}) {
  return Boolean(sheetRowIdentity(stock) && sheetRowIdentity(stock) === sheetRowIdentity({
    sheetName: row.sheetName,
    pool: row.pool,
    rowNumber: row.rowNumber,
  }));
}

function isLocalSheetStockLocked(db, stock = null) {
  if (!stock || !["sold", "reserved"].includes(stock.status)) return false;
  if (stock.reservedFor) {
    const order = (db.orders || []).find((item) => item.id === stock.reservedFor || item.paymentRef === stock.reservedFor);
    if (!order || ["expired", "cancelled", "completed"].includes(String(order.orderStatus || "").toLowerCase())) return false;
    if (["paid", "success", "settlement", "expired", "cancelled"].includes(String(order.qrisStatus || "").toLowerCase())) return false;
    const expiresAt = parseDateText(order.paymentExpiresAt || "");
    return Boolean(expiresAt && expiresAt.getTime() > Date.now());
  }
  return false;
}

function upsertSheetStock(db, product, variant, row, config = {}) {
  db.stock = db.stock || [];
  applySheetCheckoutRequirements(variant, row.checkoutRequirements || null);
  const identity = sheetResellerIdentity(db, row);
  const canonicalReseller = canonicalSheetResellerName(identity, row.seller || row.whatsapp || "");
  const canonicalWhatsapp = identity.whatsapp || "";
  const existing =
    db.stock.find((item) => stockMatchesSheetRowIdentity(item, row))
    || existingBySheetKey(db.stock, row.sheetStockKey)
    || db.stock.find((item) => item.id === row.stockId)
    || legacySheetRowMatch(db.stock, row);
  const stock = existing || { id: row.stockId };
  // SELLER is the authoritative assignment switch. Dates and phone numbers are
  // details of an assignment, not proof that one still exists.
  const sheetSold = Boolean(String(row.seller || "").trim());
  const sheetCleared = !sheetSold;
  const localLocked = !sheetSold && !sheetCleared && isLocalSheetStockLocked(db, existing);
  const effectiveNotes = localLocked ? (existing?.notes || "") : (sheetSold ? (row.notes || "") : "");
  const effectiveDevice = localLocked ? (existing?.device || "") : (sheetSold ? (row.device || "") : "");
  const effectiveResellerId = localLocked ? (existing?.resellerId || "") : (sheetSold ? (identity.reseller?.id || "") : "");
  const effectiveReseller = localLocked ? (existing?.reseller || "") : (sheetSold ? canonicalReseller : "");
  const effectiveBuyer = localLocked ? (existing?.buyer || "") : (sheetSold ? (row.seller || identity.whatsapp || "") : "");
  const effectiveWhatsapp = localLocked ? (existing?.whatsapp || "") : (sheetSold ? canonicalWhatsapp : "");
  const effectiveExpiresAt = localLocked ? (existing?.expiresAt || "") : (sheetSold ? (row.expiresAt || "") : "");
  const effectiveSheetOrderId = localLocked
    ? (existing?.sheetOrderId || "")
    : (sheetSold ? (row.orderId || existing?.sheetOrderId || "") : "");
  Object.assign(stock, {
    productId: product.id,
    variantId: variant.id,
    email: row.email,
    password: row.password,
    profile: row.profile,
    pin: row.pin,
    notes: effectiveNotes,
    status: localLocked ? existing.status : sheetSold ? "sold" : "available",
    sheetSource: "google_sheets",
    sheetStockKey: row.sheetStockKey,
    sheetPool: row.pool,
    sheetRow: row.rowNumber,
    sheetStartColumn: row.startColumn,
    sheetName: row.sheetName || googleSheetsSettings(db).sheetName,
    sheetPoolSchema: row.schema || stock.sheetPoolSchema || poolSchema({ productKey: config.key }),
    device: effectiveDevice,
    loginPhone: row.loginPhone || stock.loginPhone || "",
    otpEmail: row.otpEmail || stock.otpEmail || "",
    soldAt: sheetSold ? row.purchasedAt : localLocked ? existing.soldAt : "",
    soldDuration: sheetSold ? row.durationText || `${row.durationDays || 30} Hari` : localLocked ? existing.soldDuration : "",
    soldDurationDays: sheetSold ? row.durationDays || 30 : localLocked ? existing.soldDurationDays : 0,
    soldExpiresAt: sheetSold ? row.expiresAt : localLocked ? existing.soldExpiresAt : "",
    soldVariant: sheetSold ? stock.soldVariant || variant.name : localLocked ? existing.soldVariant : "",
    soldVariantId: sheetSold ? stock.soldVariantId || variant.id : localLocked ? existing.soldVariantId : "",
    productName: product.name,
    variantName: variant.name,
    variantCode: variant.code,
    stockPoolKey: variantStockGroupKey(product, variant),
    resellerId: effectiveResellerId,
    reseller: effectiveReseller,
    buyer: effectiveBuyer,
    whatsapp: effectiveWhatsapp,
    sheetSellerInput: row.seller || "",
    sheetWhatsappInput: normalizeWhatsapp(row.whatsapp || ""),
    sheetResellerResolutionSource: identity.source || "",
    sheetResellerConflict: Boolean(identity.conflict),
    expiresAt: effectiveExpiresAt,
    sheetOrderId: effectiveSheetOrderId,
    sheetRemovedAt: "",
    sheetLastSyncedAt: formatDateTime(new Date()),
  });
  // A row that is present in Sheets is authoritative. Local conflict and
  // reservation flags from an older snapshot must not keep a cleared row out
  // of the catalog after the owner has made it available again in Sheets.
  if (!localLocked) {
    delete stock.historyConflict;
    delete stock.historyConflictAt;
    delete stock.historyConflictOrderIds;
    delete stock.autoBackfillBlocked;
    delete stock.autoBackfillBlockedAt;
    delete stock.reservedFor;
    delete stock.reservedAccountId;
    delete stock.reservedUntil;
    delete stock.reservedAt;
  }
  if (!sheetSold && !localLocked) {
    stock.soldAt = "";
    stock.soldDuration = "";
    stock.soldDurationDays = 0;
    stock.soldExpiresAt = "";
    stock.soldVariant = "";
    stock.soldVariantId = "";
    stock.expiresAt = "";
    stock.sheetOrderId = "";
  }
  if (!existing) db.stock.unshift(stock);
  if (sheetSold) upsertManagedFromSheet(db, product, variant, stock, row);
  const returned = !sheetSold && !localLocked ? clearManagedIfReturned(db, row, stock, { force: true }) : 0;
  return { stock, sheetSold, localLocked, returned, created: !existing };
}

function dedupeSheetStockRows(db, config, sheetName, seenSheetKeys, syncedAt) {
  const poolKeys = new Set(config.pools.map((pool) => pool.key));
  const groups = new Map();
  let deduped = 0;
  for (const stock of db.stock || []) {
    if (String(stock.sheetSource || "").toLowerCase() !== "google_sheets") continue;
    if (String(stock.status || "").toLowerCase() === "removed" || stock.sheetRemovedAt) continue;
    if (!poolKeys.has(stock.sheetPool)) continue;
    if (stock.sheetName && stock.sheetName !== sheetName) continue;
    const identity = sheetRowIdentity(stock);
    if (!identity) continue;
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(stock);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const preferred = group.find((stock) => seenSheetKeys.has(stock.sheetStockKey))
      || group.find((stock) => String(stock.status || "").toLowerCase() === "available")
      || group[0];
    for (const stock of group) {
      if (stock === preferred) continue;
      const linkedAccounts = (db.managedAccounts || []).filter((account) => (
        account
        && !account.hidden
        && !account.returnedToStockAt
        && (
          (stock.id && account.stockId === stock.id)
          || (!stock.id && stock.sheetStockKey && account.sheetStockKey === stock.sheetStockKey)
        )
      ));
      for (const account of linkedAccounts) {
        account.status = "expired";
        account.hidden = true;
        account.sheetDedupedAt = syncedAt;
        account.returnedToStockAt = account.returnedToStockAt || syncedAt;
      }
      stock.status = "removed";
      stock.sheetRemovedAt = syncedAt;
      stock.sheetLastSyncedAt = syncedAt;
      stock.notes = stock.notes || "Removed from Google Sheets";
      deduped += 1;
    }
  }
  return deduped;
}

function removeMissingSheetStock(db, config, sheetName, seenSheetKeys, syncedAt) {
  const poolKeys = new Set(config.pools.map((pool) => pool.key));
  const removedStocks = new Set();
  let removed = 0;
  for (const stock of db.stock || []) {
    if (stock.sheetSource !== "google_sheets") continue;
    if (!poolKeys.has(stock.sheetPool)) continue;
    if (stock.sheetName && stock.sheetName !== sheetName) continue;
    if (!stock.sheetStockKey || seenSheetKeys.has(stock.sheetStockKey)) continue;
    const linkedAccounts = (db.managedAccounts || []).filter((account) => (
      account
      && !account.hidden
      && account.status !== "replaced"
      && (account.stockId === stock.id || account.sheetStockKey === stock.sheetStockKey)
    ));
    for (const account of linkedAccounts) {
      account.status = "expired";
      account.hidden = true;
      account.sheetMissingArchivedAt = syncedAt;
      account.returnedToStockAt = account.returnedToStockAt || syncedAt;
    }
    stock.status = "removed";
    stock.sheetRemovedAt = syncedAt;
    stock.sheetLastSyncedAt = syncedAt;
    stock.notes = stock.notes || "Removed from Google Sheets";
    removedStocks.add(stock);
    removed += 1;
  }
  // Deleted Sheet rows must disappear from operational stock entirely. Order
  // and managed-account history stay archived, but catalog/fulfillment can no
  // longer see or select this stock record.
  if (removedStocks.size) {
    db.stock = (db.stock || []).filter((stock) => !removedStocks.has(stock));
  }
  return removed;
}

async function syncSheetConfigStock(db, config, options = {}) {
  if (!googleSheetsConfigured(db)) {
    return { ok: false, skipped: true, reason: "google_sheets_not_configured" };
  }
  const resellerLookup = await ensureSheetResellerLookup(db, options);
  const product = productForConfig(db, config);
  if (!product) {
    return { ok: false, skipped: true, reason: `${config.key}_product_not_found` };
  }
  const sheetName = config.sheetName(db);
  const values = await readSheetValuesByName(db, sheetName);
  const summary = { imported: 0, available: 0, sold: 0, locked: 0, managed: 0, returned: 0, removed: 0, warnings: [...(resellerLookup.warnings || [])], resellerAliases: resellerLookup.aliases || 0 };
  const seenSheetKeys = new Set();
  for (const pool of config.pools) {
    const variant = poolVariant(product, pool);
    if (!variant) {
      summary.warnings.push(`${pool.key}: varian ${config.summaryName} tidak ditemukan`);
      continue;
    }
    applySheetCheckoutRequirements(variant, checkoutRequirementsForSheetPool(values, pool, [], config.pools));
    for (const row of parsePoolRows(values, pool, sheetName, config.pools, { requireProfile: config.requireProfile })) {
      seenSheetKeys.add(row.sheetStockKey);
      const result = upsertSheetStock(db, product, variant, row, config);
      summary.imported += 1;
      if (result.stock.status === "available") summary.available += 1;
      if (result.sheetSold) {
        summary.sold += 1;
        summary.managed += 1;
      }
      if (result.localLocked) summary.locked += 1;
      if (result.returned) summary.returned += Number(result.returned || 0);
    }
  }
  summary.repaired = repairManagedAccountsFromSheetStock(db, config, sheetName, seenSheetKeys);
  const ownershipBackfilled = backfillLinkPoolOwnershipFromSibling(db);
  const duplicatesHidden = dedupeCanvaManagedAccounts(db);
  const syncedAt = formatDateTime(new Date());
  summary.deduped = dedupeSheetStockRows(db, config, sheetName, seenSheetKeys, syncedAt);
  summary.removed = removeMissingSheetStock(db, config, sheetName, seenSheetKeys, syncedAt);
  db.settings = db.settings || {};
  db.settings.googleSheetsLastSyncAt = syncedAt;
  db.settings.googleSheetsLastSyncSummary = { ...(db.settings.googleSheetsLastSyncSummary || {}), [config.key]: summary };
  db.activities = db.activities || [];
  if (!options.silent) {
    db.activities.unshift({
      id: `act-sheet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      type: "stock",
      title: `${config.summaryName} sheet synced`,
      description: `${summary.imported} row dibaca, ${summary.available} available, ${summary.sold} sold, ${summary.returned} akun diarsipkan mengikuti perubahan Sheets, ${summary.deduped || 0} duplikat dirapikan, ${summary.removed} stale dibersihkan.`,
      createdAt: formatDateTime(new Date()),
    });
  }
  return { ok: true, ...summary };
}

export async function syncNetflixSheetsStock(db, options = {}) {
  return syncSheetConfigStock(db, SHEET_CONFIGS.netflix, options);
}

export async function syncViuSheetsStock(db, options = {}) {
  return syncSheetConfigStock(db, SHEET_CONFIGS.viu, options);
}

export async function syncVidioSheetsStock(db, options = {}) {
  return syncSheetConfigStock(db, SHEET_CONFIGS.vidio, options);
}

export async function syncDynamicSheetsStock(db, options = {}) {
  if (!googleSheetsConfigured(db)) {
    return { ok: false, skipped: true, reason: "google_sheets_not_configured" };
  }
  const resellerLookup = await ensureSheetResellerLookup(db, options);
  const meta = await getSpreadsheetMeta(db);
  const configuredNetflixSheet = googleSheetsSettings(db).sheetName;
  const knownSheets = new Set([configuredNetflixSheet, VIU_SHEET_NAME, VIDIO_SHEET_NAME, CANVA_SHEET_NAME].map(normalizeLower));
  const sheets = (meta.sheets || [])
    .map((item) => normalize(item.properties?.title))
    .filter(Boolean);
  const summary = {
    imported: 0,
    available: 0,
    sold: 0,
    locked: 0,
    managed: 0,
    repaired: 0,
    returned: 0,
    removed: 0,
    productsCreated: 0,
    variantsCreated: 0,
    pools: 0,
    warnings: [...(resellerLookup.warnings || [])],
    resellerAliases: resellerLookup.aliases || 0,
  };

  for (const sheetName of sheets) {
    const values = await readSheetValuesByName(db, sheetName).catch((error) => {
      summary.warnings.push(`${sheetName}: ${error.message || "gagal dibaca"}`);
      return [];
    });
    if (!values.length) continue;
    let markers = findDynamicPoolMarkers(values);
    if (!markers.length) continue;
    if (knownSheets.has(normalizeLower(sheetName))) {
      markers = markers.filter((marker) => {
        const productKey = parseDynamicPoolKey(marker.key).productKey;
        return !["NETFLIX", "VIU", "VIDIO", "CANVA"].includes(normalizePoolMarker(productKey));
      });
    }
    if (!markers.length) continue;
    markers = markers.sort((a, b) => a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex);
    const pools = markers.map((marker) => {
      const header = values[marker.rowIndex + 1] || [];
      const startColumn = normalizedDynamicStartColumn(header, marker.columnIndex);
      const nextStart = markers
        .filter((item) => item.rowIndex === marker.rowIndex && item.columnIndex > marker.columnIndex)
        .map((item) => item.columnIndex)
        .sort((a, b) => a - b)[0] || header.length || marker.columnIndex + UNIVERSAL_ACCOUNT_HEADERS.length;
      return {
        key: marker.key,
        label: marker.label || `POOL: ${marker.key}`,
        startColumn,
        markerColumn: marker.columnIndex,
        rowIndex: marker.rowIndex,
        productKey: "dynamic",
        schema: inferDynamicPoolSchema(header, startColumn, nextStart),
        sheetName,
      };
    });
    const seenSheetKeys = new Set();
    for (const pool of pools) {
      const found = findProductForDynamicPool(db, pool.key);
      const productResult = found.product
        ? { product: found.product, created: false }
        : ensureDynamicProduct(db, found.productKey, pool.schema);
      const product = productResult.product;
      if (productResult.created) summary.productsCreated += 1;
      if (pool.schema === "profile") {
        product.needsProfile = true;
        product.needsPin = true;
      }
      const variantResult = ensureDynamicVariant(product, found.productKey, found.variantKey);
      if (variantResult.created) summary.variantsCreated += 1;
      applySheetCheckoutRequirements(variantResult.variant, checkoutRequirementsForSheetPool(values, pool, markers));
      const config = {
        key: "dynamic",
        summaryName: "Dynamic",
        pools: [pool],
        requireProfile: pool.schema === "profile",
      };
      for (const row of parseDynamicPoolRows(values, pool, markers)) {
        seenSheetKeys.add(row.sheetStockKey);
        const result = upsertSheetStock(db, product, variantResult.variant, row, config);
        summary.imported += 1;
        if (result.stock.status === "available") summary.available += 1;
        if (result.sheetSold) {
          summary.sold += 1;
          summary.managed += 1;
        }
        if (result.localLocked) summary.locked += 1;
        if (result.returned) summary.returned += Number(result.returned || 0);
      }
    }
    summary.pools += pools.length;
    summary.repaired += repairManagedAccountsFromSheetStock(db, { key: "dynamic", pools }, sheetName, seenSheetKeys);
    const soldDynamicStocks = (db.stock || []).filter((stock) => (
      stock.sheetSource === "google_sheets"
      && stock.sheetName === sheetName
      && pools.some((pool) => pool.key === stock.sheetPool)
      && seenSheetKeys.has(stock.sheetStockKey)
    ));
    summary.repaired += backfillManagedAccountsFromSoldStocks(db, soldDynamicStocks);
    const syncedAt = formatDateTime(new Date());
    summary.removed += removeMissingSheetStock(db, { pools }, sheetName, seenSheetKeys, syncedAt);
  }

  db.settings = db.settings || {};
  db.settings.googleSheetsLastSyncAt = new Date().toISOString();
  db.settings.googleSheetsLastSyncSummary = { ...(db.settings.googleSheetsLastSyncSummary || {}), dynamic: summary };
  if (!options.silent) {
    db.activities = db.activities || [];
    db.activities.unshift({
      id: `act-dynamic-sheet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      type: "stock",
      title: "Dynamic sheets synced",
      description: `${summary.pools} pool dinamis, ${summary.imported} row dibaca, ${summary.productsCreated} produk baru, ${summary.variantsCreated} varian baru.`,
      createdAt: formatDateTime(new Date()),
    });
  }
  return { ok: true, ...summary };
}

function canvaProduct(db) {
  return (db.products || []).find(isCanvaProduct) || null;
}

function canvaVariant(product) {
  return (product?.variants || []).find((variant) => isVariantOrderable(product, variant)) || null;
}

function linkPoolKeyFromMarker(value = "") {
  const raw = normalize(value);
  if (!raw) return "";
  let cleaned = raw
    .replace(/^\s*POOL\s*[:_-]?\s*/i, "")
    .replace(/\s+POOL\s*$/i, "")
    .replace(/\s+USAGE\s*$/i, "")
    .replace(/plantinum/ig, "platinum")
    .trim();
  if (!cleaned && /canva/i.test(raw)) cleaned = "CANVA";
  return cleaned
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function previousSectionLabel(values = [], rowIndex = 0) {
  for (let index = rowIndex - 1; index >= Math.max(0, rowIndex - 4); index -= 1) {
    const row = values[index] || [];
    const text = row.map(normalize).filter(Boolean).join(" ").trim();
    if (text) return text;
  }
  return "";
}

function linkPoolColumns(header = []) {
  return {
    link: fallbackHeaderIndex(header, ["canva link", "link", "invite link", "url"], 0),
    quota: fallbackHeaderIndex(header, ["kuota", "quota", "limit"], 1),
    used: fallbackHeaderIndex(header, ["terpakai", "used"], 2),
    available: fallbackHeaderIndex(header, ["sisa", "available"], 3),
    status: fallbackHeaderIndex(header, ["status"], 4),
    notes: fallbackHeaderIndex(header, ["catatan", "note", "notes"], 5),
    stockId: findHeaderIndex(header, ["stock id", "id stok", "stok id"]),
  };
}

function linkUsageColumns(header = []) {
  const statusIndex = findHeaderIndex(header, ["status"]);
  const orderIndex = fallbackHeaderIndex(header, ["order id", "order", "id order"], statusIndex >= 0 ? 7 : 6);
  return {
    email: fallbackHeaderIndex(header, ["email customer", "email cust", "customer email", "email"], 0),
    reseller: fallbackHeaderIndex(header, ["reseller", "ress", "seller"], 1),
    whatsapp: fallbackHeaderIndex(header, ["nomor wa", "no wa", "whatsapp", "wa"], 2),
    startedAt: fallbackHeaderIndex(header, ["tanggal beli", "tanggal", "tgl beli", "tgl", "date"], 3),
    duration: fallbackHeaderIndex(header, ["durasi", "duration"], 4),
    expiresAt: fallbackHeaderIndex(header, ["expired", "expiry", "berakhir"], 5),
    status: statusIndex,
    orderId: orderIndex,
    stockId: fallbackHeaderIndex(header, ["stock id", "id stok", "stok id", "pool id"], orderIndex + 1),
  };
}

function numericCell(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const numeric = Number(text.replace(/[^\d.-]/g, ""));
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
}

function findLinkPoolSections(values = []) {
  const sections = [];
  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] || [];
    if (!looksLikeLinkPoolHeader(row)) continue;
    const label = previousSectionLabel(values, rowIndex);
    const key = linkPoolKeyFromMarker(label || "LINK_POOL");
    if (!key) continue;
    sections.push({
      key,
      label,
      headerIndex: rowIndex,
      dataStartIndex: rowIndex + 1,
      columns: linkPoolColumns(row),
    });
  }
  return sections;
}

function findLinkUsageSections(values = []) {
  const sections = [];
  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] || [];
    if (!looksLikeLinkUsageHeader(row)) continue;
    const label = previousSectionLabel(values, rowIndex);
    const key = linkPoolKeyFromMarker(label || "LINK_POOL");
    if (!key) continue;
    sections.push({
      key,
      label,
      headerIndex: rowIndex,
      dataStartIndex: rowIndex + 1,
      columns: linkUsageColumns(row),
    });
  }
  return sections;
}

function rowLooksLikeSectionMarker(row = []) {
  const text = row.map(normalizeLower).filter(Boolean).join(" ");
  return text.includes("usage") || text.includes("pool:");
}

function parseLinkPoolRows(values = [], sheetName = "") {
  const poolSections = findLinkPoolSections(values);
  const usageSections = findLinkUsageSections(values);
  const pools = [];
  for (const section of poolSections) {
    const nextPoolHeader = poolSections
      .filter((item) => item.headerIndex > section.headerIndex)
      .map((item) => item.headerIndex)
      .sort((a, b) => a - b)[0] || values.length;
    const nextUsageHeader = usageSections
      .filter((item) => item.headerIndex > section.headerIndex)
      .map((item) => item.headerIndex - 1)
      .sort((a, b) => a - b)[0] || values.length;
    const endIndex = Math.min(nextPoolHeader, nextUsageHeader, values.length);
    for (let rowIndex = section.dataStartIndex; rowIndex < endIndex; rowIndex += 1) {
      const row = values[rowIndex] || [];
      if (rowLooksLikeSectionMarker(row)) break;
      const link = normalize(row[section.columns.link]);
      const quota = numericCell(row[section.columns.quota]);
      const used = numericCell(row[section.columns.used]);
      const available = numericCell(row[section.columns.available]);
      const stockId = normalize(section.columns.stockId >= 0 ? row[section.columns.stockId] : "");
      if (!link && quota === null && !stockId) continue;
      const id = stockId || `LINK-${section.key}-${rowIndex + 1}-${hashKey(link || section.key)}`.toUpperCase();
      pools.push({
        id,
        key: section.key,
        poolKey: section.key,
        sheetName,
        sheetRow: rowIndex + 1,
        sheetHeaderRow: section.headerIndex + 1,
        link,
        quota: quota || 0,
        used: used ?? undefined,
        available: available ?? undefined,
        status: normalizeLower(row[section.columns.status] || "active") || "active",
        notes: normalize(row[section.columns.notes]),
      });
    }
  }
  return pools;
}

function parseLinkUsageRows(values = [], sheetName = "") {
  const sections = findLinkUsageSections(values);
  const rows = [];
  for (const section of sections) {
    const nextHeader = sections
      .filter((item) => item.headerIndex > section.headerIndex)
      .map((item) => item.headerIndex)
      .sort((a, b) => a - b)[0] || values.length;
    for (let rowIndex = section.dataStartIndex; rowIndex < nextHeader; rowIndex += 1) {
      const row = values[rowIndex] || [];
      if (rowLooksLikeSectionMarker(row) || looksLikeLinkPoolHeader(row)) break;
      const email = singleEmail(row[section.columns.email]);
      if (!email) continue;
      const durationText = normalize(row[section.columns.duration]);
      const durationDays = parseDurationDays(durationText);
      const startedDate = parseDateText(row[section.columns.startedAt]);
      if (!isReasonablePurchaseDate(startedDate)) continue;
      const startedAt = startedDate ? formatDateTime(startedDate) : normalize(row[section.columns.startedAt]);
      const sheetExpiresAt = section.columns.expiresAt >= 0 ? normalize(row[section.columns.expiresAt]) : "";
      const expiresAt = preferredExpiryText(parseDateText(startedAt), durationText, durationDays, sheetExpiresAt);
      rows.push({
        key: section.key,
        sheetName,
        rowNumber: rowIndex + 1,
        email,
        reseller: normalize(row[section.columns.reseller]),
        whatsapp: normalizeWhatsapp(row[section.columns.whatsapp]),
        duration: durationText,
        durationDays,
        startedAt,
        expiresAt,
        status: section.columns.status >= 0 ? normalizeLower(row[section.columns.status]) || accountStatus(expiresAt) : accountStatus(expiresAt),
        orderId: section.columns.orderId >= 0 ? normalize(row[section.columns.orderId]) : "",
        stockId: section.columns.stockId >= 0 ? normalize(row[section.columns.stockId]) : "",
      });
    }
  }
  return rows;
}

function linkPoolProductAndVariant(db, key = "") {
  if (normalizePoolMarker(key) === "CANVA") {
    const product = canvaProduct(db);
    const variant = canvaVariant(product);
    return { product, variant, createdProduct: false, createdVariant: false };
  }
  const found = findProductForDynamicPool(db, key);
  const productResult = found.product ? { product: found.product, created: false } : ensureDynamicProduct(db, found.productKey, "link");
  const variantKey = !found.variantKey || normalizePoolMarker(found.variantKey) === "ACCOUNT" ? "MEMBER" : found.variantKey;
  const variantResult = ensureDynamicVariant(productResult.product, found.productKey, variantKey);
  return {
    product: productResult.product,
    variant: variantResult.variant,
    createdProduct: productResult.created,
    createdVariant: variantResult.created,
  };
}

function activeLinkAccountStatus(expiresAt = "") {
  return accountStatus(expiresAt) === "expired" ? "expired" : "active";
}

function linkUsageMatchesAccount(account = {}, row = {}, pool = {}, options = {}) {
  if (!account || (!options.includeArchived && isArchivedSheetAccount(account))) return false;
  const accountOrderId = normalize(account.orderId || account.sourceOrderId);
  if (row.orderId && accountOrderId && normalizeLower(row.orderId) === normalizeLower(accountOrderId)) return true;
  if (row.stockId && normalize(row.stockId) && normalize(row.stockId) === normalize(account.linkPoolId || account.canvaPoolId)) {
    return normalizeLower(account.email) === normalizeLower(row.email);
  }
  if (pool?.id && normalize(account.linkPoolId || account.canvaPoolId) === normalize(pool.id)) {
    const accountDate = formatDateTime(parseDateText(account.startedAt || "") || new Date(0)).slice(0, 10);
    const rowDate = formatDateTime(parseDateText(row.startedAt || "") || new Date(0)).slice(0, 10);
    return normalizeLower(account.email) === normalizeLower(row.email) && accountDate === rowDate;
  }
  return false;
}

function linkPoolUsedByAccounts(db = {}, pool = {}) {
  return (db.managedAccounts || []).filter((account) => {
    if (account.hidden || account.returnedToStockAt) return false;
    if (normalize(account.linkPoolId || account.canvaPoolId) !== normalize(pool.id)) return false;
    const status = normalizeLower(account.status || "active");
    if (["expired", "replaced", "disabled"].includes(status)) return false;
    return accountStatus(account.expiresAt) !== "expired";
  }).length;
}

function linkPoolAvailable(db = {}, pool = {}) {
  const explicit = Number(pool.available);
  if (Number.isFinite(explicit) && explicit >= 0) return Math.floor(explicit);
  return Math.max(0, Number(pool.quota || 0) - linkPoolUsedByAccounts(db, pool));
}

function upsertLinkPoolUsageAccount(db, row = {}, pool = {}) {
  const product = (db.products || []).find((item) => item.id === pool.productId);
  const variant = product?.variants?.find((item) => item.id === pool.variantId);
  if (!product || !variant) return null;
  const identity = sheetResellerIdentity(db, { seller: row.reseller, whatsapp: row.whatsapp });
  const reseller = identity.reseller;
  const canonicalReseller = canonicalSheetResellerName(identity, row.reseller || row.whatsapp || "");
  const canonicalWhatsapp = identity.whatsapp || "";
  const matchedUsage = (db.managedAccounts || []).find((account) => linkUsageMatchesAccount(account, row, pool, { includeArchived: true }));
  const nextStatus = normalizeLower(row.status || activeLinkAccountStatus(row.expiresAt));
  if (matchedUsage && isArchivedSheetAccount(matchedUsage) && ["expired", "replaced", "disabled"].includes(nextStatus)) {
    matchedUsage.hidden = true;
    matchedUsage.status = nextStatus;
    matchedUsage.returnedToStockAt = matchedUsage.returnedToStockAt
      || matchedUsage.archivedAt
      || matchedUsage.manualArchivedAt
      || matchedUsage.sheetMissingArchivedAt
      || matchedUsage.sheetClearedAt
      || formatDateTime(new Date());
    return matchedUsage;
  }
  const existing = matchedUsage && !isArchivedSheetAccount(matchedUsage) ? matchedUsage : null;
  const idSeed = `${pool.id}:${row.email}:${row.startedAt}:${row.orderId || row.rowNumber}`;
  const account = existing || {
    id: `acc-link-${hashKey(idSeed)}`,
    stockId: `link-${pool.id}-${row.rowNumber || hashKey(idSeed)}`,
    source: normalizePoolMarker(pool.poolKey) === "CANVA" ? "canva_sheet" : "link_pool_sheet",
    accountType: normalizePoolMarker(pool.poolKey) === "CANVA" ? "canva_link" : "link_pool",
    sheetSource: "google_sheets",
    sheetPoolSchema: "link",
    hidden: false,
  };
  Object.assign(account, {
    stockId: account.stockId || `link-${pool.id}-${row.rowNumber || hashKey(idSeed)}`,
    resellerId: reseller?.id || "",
    product: product.name,
    productId: product.id,
    variant: variant.name,
    variantId: variant.id,
    variantCode: variant.code,
    stockPoolKey: variantStockGroupKey(product, variant),
    duration: row.duration || account.duration || "",
    durationDays: row.durationDays || account.durationDays || 30,
    email: row.email,
    password: pool.link || account.password || "",
    canvaLink: normalizePoolMarker(pool.poolKey) === "CANVA" ? pool.link || account.canvaLink || "" : account.canvaLink || "",
    linkPoolId: pool.id,
    canvaPoolId: normalizePoolMarker(pool.poolKey) === "CANVA" ? pool.id : account.canvaPoolId || "",
    buyer: row.reseller || identity.whatsapp || account.buyer || "",
    reseller: canonicalReseller,
    whatsapp: canonicalWhatsapp,
    startedAt: row.startedAt,
    expiresAt: row.expiresAt,
    status: row.status || activeLinkAccountStatus(row.expiresAt),
    usageMode: Number(row.durationDays || 0) < 30 ? "daily" : "monthly",
    sheetName: row.sheetName,
    sheetRow: row.rowNumber,
    sheetPool: pool.poolKey,
    sheetPoolSchema: "link",
    sourceOrderId: row.orderId || account.sourceOrderId || "",
    orderId: row.orderId || account.orderId || "",
    hidden: false,
  });
  if (!existing) db.managedAccounts.unshift(account);
  return account;
}

export async function syncLinkPoolSheetsStock(db, options = {}) {
  if (!googleSheetsConfigured(db)) {
    return { ok: false, skipped: true, reason: "google_sheets_not_configured" };
  }
  const resellerLookup = await ensureSheetResellerLookup(db, options);
  db.linkPools = db.linkPools || [];
  db.managedAccounts = db.managedAccounts || [];
  const meta = await getSpreadsheetMeta(db);
  const sheets = (meta.sheets || []).map((item) => normalize(item.properties?.title)).filter(Boolean);
  const onlyKeys = new Set((options.keys || []).map((item) => normalizePoolMarker(item)).filter(Boolean));
  const summary = {
    pools: 0,
    quota: 0,
    used: 0,
    available: 0,
    usageImported: 0,
    productsCreated: 0,
    variantsCreated: 0,
    hidden: 0,
    byKey: {},
    warnings: [...(resellerLookup.warnings || [])],
    resellerAliases: resellerLookup.aliases || 0,
  };
  const seenPoolIds = new Set();
  const seenUsageKeys = new Set();

  for (const sheetName of sheets) {
    const values = await readSheetValuesByName(db, sheetName).catch((error) => {
      summary.warnings.push(`${sheetName}: ${error.message || "gagal dibaca"}`);
      return [];
    });
    if (!values.length) continue;
    const poolRows = parseLinkPoolRows(values, sheetName).filter((pool) => !onlyKeys.size || onlyKeys.has(normalizePoolMarker(pool.key)));
    const usageRows = parseLinkUsageRows(values, sheetName).filter((row) => !onlyKeys.size || onlyKeys.has(normalizePoolMarker(row.key)));
    if (!poolRows.length && !usageRows.length) continue;

    for (const row of poolRows) {
      const { product, variant, createdProduct, createdVariant } = linkPoolProductAndVariant(db, row.key);
      if (!product || !variant) {
        summary.warnings.push(`${sheetName}: produk/varian ${row.key} tidak ditemukan`);
        continue;
      }
      if (createdProduct) summary.productsCreated += 1;
      if (createdVariant) summary.variantsCreated += 1;
      const existing = db.linkPools.find((pool) => pool.id === row.id || (pool.sheetName === row.sheetName && Number(pool.sheetRow) === Number(row.sheetRow) && normalizePoolMarker(pool.poolKey) === normalizePoolMarker(row.key)));
      const pool = existing || { id: row.id };
      Object.assign(pool, {
        id: row.id,
        productId: product.id,
        variantId: variant.id,
        product: product.name,
        variant: variant.name,
        variantCode: variant.code,
        stockPoolKey: variantStockGroupKey(product, variant),
        poolKey: row.key,
        key: row.key,
        sheetSource: "google_sheets",
        sheetName: row.sheetName,
        sheetRow: row.sheetRow,
        sheetHeaderRow: row.sheetHeaderRow,
        sheetPoolSchema: "link",
        link: row.link || pool.link || "",
        quota: row.quota || pool.quota || 0,
        used: row.used,
        available: row.available,
        status: row.status || pool.status || "active",
        notes: row.notes || pool.notes || "",
        sheetLastSyncedAt: formatDateTime(new Date()),
      });
      if (!existing) db.linkPools.push(pool);
      seenPoolIds.add(pool.id);
      const key = normalizePoolMarker(pool.poolKey);
      summary.byKey[key] = summary.byKey[key] || { pools: 0, quota: 0, used: 0, available: 0, usageImported: 0 };
      summary.byKey[key].pools += 1;
      summary.byKey[key].quota += Number(pool.quota || 0);
      summary.byKey[key].used += linkPoolUsedByAccounts(db, pool);
      summary.byKey[key].available += linkPoolAvailable(db, pool);
    }

    for (const row of usageRows) {
      const key = normalizePoolMarker(row.key);
      const poolsForKey = db.linkPools.filter((pool) => normalizePoolMarker(pool.poolKey) === key);
      const pool = poolsForKey.find((item) => normalize(item.id) === normalize(row.stockId))
        || (poolsForKey.length === 1 ? poolsForKey[0] : poolsForKey.find((item) => linkPoolAvailable(db, item) > 0))
        || poolsForKey[0];
      if (!pool) continue;
      const account = upsertLinkPoolUsageAccount(db, row, pool);
      if (account) {
        summary.usageImported += 1;
        seenUsageKeys.add(`${pool.id}:${row.rowNumber}:${normalizeLower(row.email)}`);
        summary.byKey[key] = summary.byKey[key] || { pools: 0, quota: 0, used: 0, available: 0, usageImported: 0 };
        summary.byKey[key].usageImported += 1;
      }
    }
  }

  const ownershipBackfilled = backfillLinkPoolOwnershipFromSibling(db);
  const duplicatesHidden = dedupeCanvaManagedAccounts(db);
  const syncedAt = formatDateTime(new Date());
  for (const pool of db.linkPools || []) {
    if (pool.sheetSource !== "google_sheets") continue;
    if (onlyKeys.size && !onlyKeys.has(normalizePoolMarker(pool.poolKey))) continue;
    if (!seenPoolIds.has(pool.id)) {
      pool.status = "removed";
      pool.sheetRemovedAt = syncedAt;
      continue;
    }
    pool.used = linkPoolUsedByAccounts(db, pool);
    pool.available = linkPoolAvailable(db, pool);
    summary.quota += Number(pool.quota || 0);
    summary.used += Number(pool.used || 0);
    summary.available += Number(pool.available || 0);
    if (normalizePoolMarker(pool.poolKey) === "CANVA") {
      db.canvaPool = {
        id: pool.id,
        link: pool.link,
        quota: Number(pool.quota || 0),
        used: Number(pool.used || 0),
        status: pool.status || "active",
        notes: pool.notes || "",
        updatedAt: syncedAt,
      };
    }
  }

  for (const account of db.managedAccounts || []) {
    if (!["link_pool_sheet", "canva_sheet", "link_pool_order", "canva_order"].includes(String(account.source || ""))) continue;
    if (onlyKeys.size && !onlyKeys.has(normalizePoolMarker(account.sheetPool))) continue;
    if (account.hidden || account.returnedToStockAt) continue;
    const key = `${account.linkPoolId || account.canvaPoolId}:${account.sheetRow}:${normalizeLower(account.email)}`;
    if (seenUsageKeys.has(key)) continue;
    account.hidden = true;
    account.status = "expired";
    account.sheetSource = account.sheetSource || "google_sheets";
    account.sheetMissingArchivedAt = syncedAt;
    account.returnedToStockAt = account.returnedToStockAt || syncedAt;
    summary.hidden += 1;
  }

  summary.pools = (db.linkPools || []).filter((pool) => pool.sheetSource === "google_sheets" && (!onlyKeys.size || onlyKeys.has(normalizePoolMarker(pool.poolKey))) && pool.status !== "removed").length;
  summary.ownershipBackfilled = ownershipBackfilled;
  summary.duplicatesHidden = duplicatesHidden;
  db.settings = db.settings || {};
  db.settings.googleSheetsLastSyncAt = new Date().toISOString();
  db.settings.googleSheetsLastSyncSummary = { ...(db.settings.googleSheetsLastSyncSummary || {}), linkPools: summary };
  if (!options.silent) {
    db.activities = db.activities || [];
    db.activities.unshift({
      id: `act-link-pool-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      type: "stock",
      title: "Link pool sheets synced",
      description: `${summary.pools} pool link, kuota ${summary.quota}, tersedia ${summary.available}.`,
      createdAt: syncedAt,
    });
  }
  return { ok: true, ...summary };
}

function canvaUsageRow(account = {}, order = {}) {
  return [
    account.email || order.email || "",
    account.reseller || order.customer || "",
    normalizeWhatsapp(account.whatsapp || order.whatsapp || ""),
    account.startedAt || order.paidAt || order.createdAt || formatDateTime(new Date()),
    account.duration || order.duration || "",
    account.expiresAt || order.expiresAt || "",
    account.status || "active",
    order.id || account.orderId || account.sourceOrderId || "",
  ];
}

function setRowValue(row, index, value) {
  if (index < 0) return;
  row[index] = value;
}

function setCellValue(cells, index, value, skipIndexes = new Set()) {
  if (index < 0) return;
  const protectedIndexes = skipIndexes instanceof Set ? skipIndexes : new Set([skipIndexes]);
  if (protectedIndexes.has(index)) return;
  cells.set(index, value);
}

function canvaUsageRowByColumns(account = {}, order = {}, columns = canvaUsageColumns(CANVA_USAGE_HEADERS), headerLength = CANVA_USAGE_HEADERS.length) {
  const maxColumn = Math.max(
    headerLength - 1,
    ...Object.values(columns).filter((index) => Number.isFinite(index) && index >= 0),
  );
  const row = Array.from({ length: maxColumn + 1 }, () => "");
  const startedAt = formatSheetPurchaseDate(preferPurchaseDate(account, order));
  const durationLabel = formatSheetDurationLabel(account.duration || order.duration || "", account.durationDays || order.durationDays || 0);
  setRowValue(row, columns.email, account.email || order.email || "");
  setRowValue(row, columns.reseller, account.reseller || order.reseller || order.customer || "");
  setRowValue(row, columns.whatsapp, normalizeWhatsapp(account.whatsapp || order.whatsapp || ""));
  setRowValue(row, columns.startedAt, startedAt);
  setRowValue(row, columns.duration, durationLabel);
  setRowValue(row, columns.status, account.status || "active");
  setRowValue(row, columns.orderId, order.id || account.orderId || account.sourceOrderId || "");
  return row;
}

function canvaUsageCellsByColumns(account = {}, order = {}, columns = canvaUsageColumns(CANVA_USAGE_HEADERS)) {
  const cells = new Map();
  const skipIndexes = new Set([columns.expiresAt, columns.whatsapp]);
  const startedAt = formatSheetPurchaseDate(preferPurchaseDate(account, order));
  const durationLabel = formatSheetDurationLabel(account.duration || order.duration || "", account.durationDays || order.durationDays || 0);
  setCellValue(cells, columns.email, account.email || order.email || "", skipIndexes);
  setCellValue(cells, columns.reseller, account.reseller || order.reseller || order.customer || "", skipIndexes);
  setCellValue(cells, columns.whatsapp, normalizeWhatsapp(account.whatsapp || order.whatsapp || ""), skipIndexes);
  setCellValue(cells, columns.startedAt, startedAt, skipIndexes);
  setCellValue(cells, columns.duration, durationLabel, skipIndexes);
  setCellValue(cells, columns.status, account.status || "active", skipIndexes);
  setCellValue(cells, columns.orderId, order.id || account.orderId || account.sourceOrderId || "", skipIndexes);
  return [...cells.entries()].sort((a, b) => a[0] - b[0]);
}

function headerIndex(headers = [], aliases = [], fallback) {
  const normalizedHeaders = headers.map((item) => normalizeLower(item));
  const index = normalizedHeaders.findIndex((header) => aliases.some((alias) => header.includes(alias)));
  return index >= 0 ? index : fallback;
}

function findHeaderIndex(headers = [], aliases = []) {
  const normalizedHeaders = headers.map((item) => normalizeLower(item));
  return normalizedHeaders.findIndex((header) => aliases.some((alias) => header.includes(alias)));
}

function fallbackHeaderIndex(headers = [], aliases = [], fallback) {
  const index = findHeaderIndex(headers, aliases);
  return index >= 0 ? index : fallback;
}

function singleEmail(value = "") {
  const email = normalizeLower(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function isReasonablePurchaseDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  const min = new Date(2024, 0, 1);
  const max = new Date();
  max.setFullYear(max.getFullYear() + 1);
  return date >= min && date <= max;
}

function canvaUsageColumns(header = []) {
  const statusIndex = findHeaderIndex(header, ["status"]);
  const orderIndex = fallbackHeaderIndex(header, ["order"], statusIndex >= 0 ? 7 : 6);
  return {
    email: fallbackHeaderIndex(header, ["email"], 0),
    reseller: fallbackHeaderIndex(header, ["reseller", "ress", "seller"], 1),
    whatsapp: fallbackHeaderIndex(header, ["nomor wa", "no wa", "whatsapp", "wa"], 2),
    startedAt: fallbackHeaderIndex(header, ["tanggal", "tgl beli", "tgl", "date"], 3),
    duration: fallbackHeaderIndex(header, ["durasi", "duration"], 4),
    expiresAt: fallbackHeaderIndex(header, ["expired", "expiry", "berakhir"], 5),
    status: statusIndex,
    orderId: orderIndex,
  };
}

function canvaPoolColumns(header = []) {
  return {
    link: headerIndex(header, ["canva link", "link"], 0),
    quota: headerIndex(header, ["kuota", "quota"], 1),
    used: headerIndex(header, ["terpakai", "used"], 2),
    available: headerIndex(header, ["sisa", "available"], 3),
    status: headerIndex(header, ["status"], 4),
    notes: headerIndex(header, ["catatan", "note"], 5),
  };
}

function findCanvaPoolLocation(values = []) {
  const markerIndex = values.findIndex((row) => (row || []).some((cell) => {
    const text = normalizeLower(cell);
    return text === "canva pool" || (text.includes("pool") && text.includes("canva"));
  }));
  const searchStart = markerIndex >= 0 ? markerIndex + 1 : 0;
  let headerIndex = -1;
  for (let index = searchStart; index < Math.min(values.length, searchStart + 8); index += 1) {
    const text = (values[index] || []).map(normalizeLower).join(" ");
    if (text.includes("kuota") || text.includes("canva link") || /\blink\b/.test(text)) {
      headerIndex = index;
      break;
    }
  }
  if (headerIndex < 0) headerIndex = 2;
  const dataIndex = headerIndex + 1;
  return {
    headerIndex,
    dataIndex,
    rowNumber: dataIndex + 1,
    columns: canvaPoolColumns(values[headerIndex] || []),
  };
}

function parseCanvaUsageRows(values = []) {
  const markerIndex = values.findIndex((row) => (row || []).some((cell) => {
    const text = normalizeLower(cell);
    return text === "canva usage" || (text.includes("usage") && text.includes("canva"));
  }));
  const headerIndex = markerIndex >= 0 ? markerIndex + 1 : 7;
  const startIndex = headerIndex + 1;
  const columns = canvaUsageColumns(values[headerIndex] || []);
  const rows = [];
  for (let rowIndex = startIndex; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] || [];
    const email = singleEmail(row[columns.email]);
    if (!email) continue;
    const durationText = normalize(row[columns.duration]);
    const durationDays = parseDurationDays(durationText);
    const startedDate = parseDateText(row[columns.startedAt]);
    if (!isReasonablePurchaseDate(startedDate)) continue;
    const startedAt = startedDate ? formatDateTime(startedDate) : normalize(row[columns.startedAt]);
    const parsedStartedAt = parseDateText(startedAt);
    const sheetExpiresAt = columns.expiresAt >= 0 ? normalize(row[columns.expiresAt]) : "";
    const expiresAt = preferredExpiryText(parsedStartedAt, durationText, durationDays, sheetExpiresAt);
    rows.push({
      rowNumber: rowIndex + 1,
      email,
      reseller: normalize(row[columns.reseller]),
      whatsapp: normalizeWhatsapp(row[columns.whatsapp]),
      duration: durationText,
      durationDays,
      startedAt,
      expiresAt,
      status: columns.status >= 0 ? normalize(row[columns.status]) || accountStatus(expiresAt) : accountStatus(expiresAt),
      orderId: columns.orderId >= 0 ? normalize(row[columns.orderId]) : "",
    });
  }
  return rows;
}

function canvaAccountOrderId(account = {}) {
  const direct = normalize(account.orderId || account.sourceOrderId);
  if (direct) return direct;
  const stockId = normalize(account.stockId);
  const match = stockId.match(/^canva-(ORD-[A-Z0-9-]+)-\d+$/i);
  return match?.[1] || "";
}

function isCanvaManagedAccount(account = {}) {
  const productText = [account.productId, account.product, account.variantCode, account.accountType, account.source].map(normalizeLower).join(" ");
  return productText.includes("canva") || account.accountType === "canva_link" || account.source === "canva_order" || account.source === "canva_sheet";
}

function canvaUsageMatchesSheetRow(account = {}, row = {}) {
  if (!isCanvaManagedAccount(account)) return false;
  const orderId = normalize(row.orderId);
  const accountOrderId = canvaAccountOrderId(account);
  if (orderId && accountOrderId && normalizeLower(orderId) === normalizeLower(accountOrderId)) return true;
  if (normalizeLower(account.email) !== normalizeLower(row.email)) return false;
  const accountDate = formatDateTime(parseDateText(account.startedAt || "") || new Date(0)).slice(0, 10);
  const rowDate = formatDateTime(parseDateText(row.startedAt || "") || new Date(0)).slice(0, 10);
  return Boolean(accountDate && rowDate && accountDate === rowDate);
}

function canvaDedupeKey(account = {}) {
  if (!isCanvaManagedAccount(account)) return "";
  const orderId = canvaAccountOrderId(account);
  if (orderId) return `order:${normalizeLower(orderId)}`;
  const date = formatDateTime(parseDateText(account.startedAt || "") || new Date(0)).slice(0, 10);
  return `email:${normalizeLower(account.email)}:${date}`;
}

function canvaDedupePriority(account = {}) {
  if (account.source === "canva_order") return 3;
  if (account.canvaPoolId === "CANVA-MAIN") return 2;
  if (account.source !== "canva_sheet") return 2;
  return 1;
}

function managedAccountDateKey(value = "") {
  return formatDateTime(parseDateText(value || "") || new Date(0)).slice(0, 10);
}

function linkPoolOwnershipScore(account = {}) {
  let score = 0;
  if (String(account.resellerId || "").trim()) score += 5;
  if (normalizeWhatsapp(account.whatsapp || "")) score += 4;
  if (String(account.reseller || "").trim()) score += 3;
  if (String(account.buyer || "").trim()) score += 2;
  if (String(account.orderId || account.sourceOrderId || "").trim()) score += 1;
  if (account.canvaPoolId === "CANVA-MAIN") score += 1;
  if (account.source === "canva_order") score += 2;
  return score;
}

function linkPoolOwnershipSibling(source = {}, candidate = {}) {
  if (!candidate || candidate.id === source.id) return false;
  if (normalizeLower(candidate.email || "") !== normalizeLower(source.email || "")) return false;
  if (normalizeLower(candidate.productId || candidate.product || "") !== normalizeLower(source.productId || source.product || "")) return false;
  const sourceDate = managedAccountDateKey(source.startedAt || "");
  const candidateDate = managedAccountDateKey(candidate.startedAt || "");
  if (!sourceDate || !candidateDate || sourceDate !== candidateDate) return false;
  return isCanvaManagedAccount(source) ? isCanvaManagedAccount(candidate) : true;
}

function mergeLinkPoolOwnership(target = {}, source = {}) {
  let updated = 0;
  for (const field of ["resellerId", "reseller", "buyer", "whatsapp", "orderId", "sourceOrderId"]) {
    const nextValue = String(source[field] || "").trim();
    if (!nextValue || String(target[field] || "").trim()) continue;
    target[field] = source[field];
    updated += 1;
  }
  return updated;
}

function backfillLinkPoolOwnershipFromSibling(db) {
  let updated = 0;
  for (const account of db.managedAccounts || []) {
    if (account.hidden || account.returnedToStockAt) continue;
    if (!["link_pool_sheet", "canva_sheet"].includes(String(account.source || ""))) continue;
    const currentScore = linkPoolOwnershipScore(account);
    if (currentScore >= 12) continue;
    const sibling = (db.managedAccounts || [])
      .filter((candidate) => linkPoolOwnershipSibling(account, candidate))
      .sort((left, right) => linkPoolOwnershipScore(right) - linkPoolOwnershipScore(left))[0];
    if (!sibling || linkPoolOwnershipScore(sibling) <= currentScore) continue;
    updated += mergeLinkPoolOwnership(account, sibling);
  }
  return updated;
}

function mergeCanvaDuplicateData(target = {}, source = {}) {
  let updated = 0;
  for (const field of ["resellerId", "reseller", "buyer", "whatsapp", "orderId", "sourceOrderId", "duration", "durationDays", "expiresAt", "canvaPoolId", "linkPoolId"]) {
    const nextValue = source[field];
    if (nextValue === undefined || nextValue === null || nextValue === "") continue;
    const currentValue = target[field];
    if (currentValue === nextValue) continue;
    if (currentValue !== undefined && currentValue !== null && currentValue !== "" && field !== "canvaPoolId") continue;
    target[field] = nextValue;
    updated += 1;
  }
  return updated;
}

function dedupeCanvaManagedAccounts(db) {
  const kept = new Map();
  let hidden = 0;
  for (const account of db.managedAccounts || []) {
    if (!isCanvaManagedAccount(account) || account.hidden || account.returnedToStockAt) continue;
    const orderId = canvaAccountOrderId(account);
    if (orderId) {
      account.orderId = account.orderId || orderId;
      account.sourceOrderId = account.sourceOrderId || orderId;
    }
    const key = canvaDedupeKey(account);
    if (!key) continue;
    const current = kept.get(key);
    if (!current) {
      kept.set(key, account);
      continue;
    }
    const keep = (() => {
      const accountPriority = canvaDedupePriority(account);
      const currentPriority = canvaDedupePriority(current);
      if (accountPriority !== currentPriority) return accountPriority > currentPriority ? account : current;
      const accountScore = linkPoolOwnershipScore(account);
      const currentScore = linkPoolOwnershipScore(current);
      if (accountScore !== currentScore) return accountScore > currentScore ? account : current;
      const accountExpiry = parseDateText(account.expiresAt || "")?.getTime() || 0;
      const currentExpiry = parseDateText(current.expiresAt || "")?.getTime() || 0;
      if (accountExpiry !== currentExpiry) return accountExpiry > currentExpiry ? account : current;
      return account;
    })();
    const duplicate = keep === account ? current : account;
    mergeCanvaDuplicateData(keep, duplicate);
    duplicate.hidden = true;
    duplicate.duplicateOf = keep.id;
    duplicate.duplicateHiddenAt = formatDateTime(new Date());
    kept.set(key, keep);
    hidden += 1;
  }
  return hidden;
}

export async function syncCanvaSheetsStock(db, options = {}) {
  const result = await syncLinkPoolSheetsStock(db, { ...options, keys: ["CANVA"], silent: true });
  const canva = result.byKey?.CANVA || {};
  return {
    ok: result.ok,
    pools: canva.pools || 0,
    imported: result.usageImported || 0,
    usageImported: canva.usageImported || result.usageImported || 0,
    quota: canva.quota || db.canvaPool?.quota || 0,
    used: canva.used || db.canvaPool?.used || 0,
    available: canva.available || 0,
    hidden: result.hidden || 0,
    warnings: result.warnings || [],
  };
  if (!googleSheetsConfigured(db)) {
    return { ok: false, skipped: true, reason: "google_sheets_not_configured" };
  }
  const values = await readSheetValuesByName(db, CANVA_SHEET_NAME).catch(() => []);
  const poolLocation = findCanvaPoolLocation(values);
  const poolRow = values[poolLocation.dataIndex] || [];
  const poolColumns = poolLocation.columns;
  const link = normalize(poolRow[poolColumns.link]);
  const quota = Math.max(0, Math.floor(Number(String(poolRow[poolColumns.quota] || "").replace(/[^\d]/g, "")) || 0));
  const status = normalizeLower(poolRow[poolColumns.status] || "active") || "active";
  const notes = normalize(poolRow[poolColumns.notes]);
  if (link || quota) {
    const previousPool = db.canvaPool || db.settings?.canvaPool || {};
    const safeLink = link || normalize(previousPool.link || previousPool.canvaLink || "");
    db.canvaPool = {
      ...previousPool,
      id: "CANVA-MAIN",
      link: safeLink,
      quota: quota || Math.max(0, Math.floor(Number(previousPool.quota || 0))) || 0,
      status,
      notes: notes || normalize(previousPool.notes || ""),
      updatedAt: formatDateTime(new Date()),
    };
    if (safeLink) {
      for (const account of db.managedAccounts || []) {
        if (account.accountType !== "canva_link" && account.source !== "canva_order" && account.source !== "canva_sheet") continue;
        const statusText = normalizeLower(account.status || "active");
        if (["expired", "replaced", "disabled"].includes(statusText)) continue;
        account.password = safeLink;
        account.canvaLink = safeLink;
        account.canvaPoolId = "CANVA-MAIN";
      }
    }
  }

  const product = canvaProduct(db);
  const variant = canvaVariant(product);
  let imported = 0;
  let staleHidden = 0;
  if (product && variant) {
    db.managedAccounts = db.managedAccounts || [];
    const usageRows = parseCanvaUsageRows(values);
    for (const row of usageRows) {
      const existing = db.managedAccounts.find((account) => canvaUsageMatchesSheetRow(account, row));
      if (existing) {
        if (existing.archivedAt || existing.manualArchivedAt || existing.returnedToStockAt) {
          existing.hidden = true;
          existing.status = normalizeLower(existing.status || "expired") === "expired" ? "expired" : existing.status || "expired";
          existing.sheetLastSeenAt = formatDateTime(new Date());
          continue;
        }
        const reseller = resellerForSheetRow(db, { seller: row.reseller, whatsapp: row.whatsapp });
        const identity = sheetResellerIdentity(db, { seller: row.reseller, whatsapp: row.whatsapp });
        const canonicalReseller = canonicalSheetResellerName(identity, row.reseller || row.whatsapp || "");
        const canonicalWhatsapp = identity.whatsapp || "";
        if (row.orderId) {
          existing.orderId = existing.orderId || row.orderId;
          existing.sourceOrderId = existing.sourceOrderId || row.orderId;
        }
        existing.resellerId = reseller?.id || "";
        existing.duration = row.duration || existing.duration;
        existing.durationDays = row.durationDays || existing.durationDays || 30;
        existing.email = row.email || existing.email;
        existing.password = db.canvaPool?.link || existing.password || "";
        existing.canvaLink = db.canvaPool?.link || existing.canvaLink || "";
        existing.buyer = row.reseller || row.whatsapp || existing.buyer || "";
        existing.reseller = canonicalReseller;
        existing.whatsapp = canonicalWhatsapp;
        existing.startedAt = row.startedAt || existing.startedAt;
        existing.expiresAt = row.expiresAt || existing.expiresAt;
        existing.status = row.status || accountStatus(row.expiresAt || existing.expiresAt);
        existing.source = existing.source || "canva_sheet";
        existing.accountType = existing.accountType || "canva_link";
        existing.canvaPoolId = "CANVA-MAIN";
        existing.usageMode = Number(existing.durationDays || 0) < 30 ? "daily" : "monthly";
        existing.sheetSource = "google_sheets";
        existing.sheetPool = "CANVA";
        existing.sheetPoolSchema = "link";
        existing.sheetName = CANVA_SHEET_NAME;
        existing.sheetRow = row.rowNumber;
        existing.sheetLastSeenAt = formatDateTime(new Date());
        existing.sheetMissingArchivedAt = "";
        existing.hidden = false;
        continue;
      }
      const reseller = resellerForSheetRow(db, { seller: row.reseller, whatsapp: row.whatsapp });
      const identity = sheetResellerIdentity(db, { seller: row.reseller, whatsapp: row.whatsapp });
      const canonicalReseller = canonicalSheetResellerName(identity, row.reseller || row.whatsapp || "");
      const canonicalWhatsapp = identity.whatsapp || "";
      db.managedAccounts.unshift({
        id: `acc-canva-${hashKey(`${row.email}:${row.startedAt}:${row.orderId}`)}`,
        stockId: `canva-sheet-${row.rowNumber}`,
        resellerId: reseller?.id || "",
        product: product.name,
        productId: product.id,
        variant: variant.name,
        variantId: variant.id,
        variantCode: variant.code,
        stockPoolKey: variantStockGroupKey(product, variant),
        accountType: "canva_link",
        canvaPoolId: "CANVA-MAIN",
        duration: row.duration,
        durationDays: row.durationDays || 30,
        email: row.email,
        password: db.canvaPool?.link || "",
        canvaLink: db.canvaPool?.link || "",
        buyer: row.reseller || row.whatsapp || "",
        reseller: canonicalReseller,
        whatsapp: canonicalWhatsapp,
        startedAt: row.startedAt,
        expiresAt: row.expiresAt,
        status: row.status || accountStatus(row.expiresAt),
        source: "canva_sheet",
        orderId: row.orderId,
        sourceOrderId: row.orderId,
        usageMode: Number(row.durationDays || 0) < 30 ? "daily" : "monthly",
        sheetSource: "google_sheets",
        sheetPool: "CANVA",
        sheetPoolSchema: "link",
        sheetName: CANVA_SHEET_NAME,
        sheetRow: row.rowNumber,
        sheetLastSeenAt: formatDateTime(new Date()),
        hidden: false,
      });
      imported += 1;
    }
    const missingArchivedAt = formatDateTime(new Date());
    for (const account of db.managedAccounts) {
      if (!isCanvaManagedAccount(account) || account.hidden || account.returnedToStockAt) continue;
      if (!["canva_sheet", "canva_order"].includes(String(account.source || "")) && !account.sheetRow) continue;
      if (usageRows.some((row) => canvaUsageMatchesSheetRow(account, row))) continue;
      account.hidden = true;
      account.status = "expired";
      account.sheetSource = account.sheetSource || "google_sheets";
      account.sheetPool = account.sheetPool || "CANVA";
      account.sheetPoolSchema = account.sheetPoolSchema || "link";
      account.sheetMissingArchivedAt = missingArchivedAt;
      account.returnedToStockAt = account.returnedToStockAt || missingArchivedAt;
      staleHidden += 1;
    }
  }

  const duplicatesHidden = dedupeCanvaManagedAccounts(db);
  const used = canvaUsedCount(db);
  if (db.canvaPool) db.canvaPool.used = used;
  const quotaValue = db.canvaPool?.quota || 0;

  const summary = { imported, duplicatesHidden, staleHidden, quota: quotaValue, used, available: Math.max(0, quotaValue - used) };
  db.settings = db.settings || {};
  db.settings.googleSheetsLastSyncAt = new Date().toISOString();
  db.settings.googleSheetsLastSyncSummary = { ...(db.settings.googleSheetsLastSyncSummary || {}), canva: summary };
  if (!options.silent) {
    db.activities = db.activities || [];
    db.activities.unshift({
      id: `act-canva-sheet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      type: "stock",
      title: "Canva sheet synced",
      description: `Canva pool ${summary.used}/${summary.quota} terpakai, ${summary.imported} usage baru diimpor.`,
      createdAt: formatDateTime(new Date()),
    });
  }
  return { ok: true, ...summary };
}

export async function syncGoogleSheetsStock(db, options = {}) {
  const resellerLookup = await ensureSheetResellerLookup(db, options);
  const syncOptions = { ...options, resellerLookup, silent: true };
  const disneyFormat = await ensureDisneySheetFormat(db).catch((error) => ({ ok: false, error: error.message || "disney_format_failed" }));
  const netflix = await syncNetflixSheetsStock(db, syncOptions).catch((error) => ({ ok: false, error: error.message || "netflix_sync_failed" }));
  const viu = await syncViuSheetsStock(db, syncOptions).catch((error) => ({ ok: false, error: error.message || "viu_sync_failed" }));
  const vidio = await syncVidioSheetsStock(db, syncOptions).catch((error) => ({ ok: false, error: error.message || "vidio_sync_failed" }));
  const linkPools = await syncLinkPoolSheetsStock(db, syncOptions).catch((error) => ({ ok: false, error: error.message || "link_pool_sync_failed" }));
  const canvaSummary = linkPools?.byKey?.CANVA || {};
  const canva = linkPools?.ok === false
    ? { ok: false, error: linkPools.error || "canva_sync_failed" }
    : {
        ok: true,
        pools: canvaSummary.pools || 0,
        imported: canvaSummary.usageImported || 0,
        usageImported: canvaSummary.usageImported || 0,
        quota: canvaSummary.quota || db.canvaPool?.quota || 0,
        used: canvaSummary.used || db.canvaPool?.used || 0,
        available: canvaSummary.available || 0,
      };
  const dynamic = await syncDynamicSheetsStock(db, syncOptions).catch((error) => ({ ok: false, error: error.message || "dynamic_sync_failed" }));
  db.settings = db.settings || {};
  db.settings.googleSheetsLastSyncAt = new Date().toISOString();
  db.settings.googleSheetsLastSyncSummary = { netflix, viu, vidio, canva, linkPools, dynamic, disneyFormat, resellers: resellerLookup };
  if (!options.silent) {
    db.activities = db.activities || [];
    db.activities.unshift({
      id: `act-sheet-all-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      type: "stock",
      title: "Google Sheets stock synced",
      description: `Netflix: ${netflix.imported || 0} row. Viu: ${viu.imported || 0} row. Vidio: ${vidio.imported || 0} row. Link pool: ${linkPools.available || 0}/${linkPools.quota || 0} tersedia. Dynamic: ${dynamic.imported || 0} row. Reseller alias: ${resellerLookup.aliases || 0}.`,
      createdAt: formatDateTime(new Date()),
    });
  }
  return { ok: true, netflix, viu, vidio, canva, linkPools, dynamic, disneyFormat, resellers: resellerLookup };
}

export async function ensureDisneySheetFormat(db) {
  if (!googleSheetsConfigured(db)) return { ok: false, skipped: true, reason: "google_sheets_not_configured" };
  const meta = await getSpreadsheetMeta(db);
  const sheetNames = (meta.sheets || []).map((item) => normalize(item.properties?.title)).filter(Boolean);
  const sheetName = sheetNames.find((name) => normalizePoolMarker(name) === "DISNEY");
  if (!sheetName) return { ok: true, skipped: true, reason: "disney_sheet_not_found" };
  const values = await readSheetValuesByName(db, sheetName);
  const markers = findDynamicPoolMarkers(values)
    .filter((marker) => isDisneyPool({ key: marker.key, productKey: "dynamic" }))
    .sort((a, b) => a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex);
  const updates = [];
  let repairedPools = 0;
  let migratedRows = 0;
  for (const marker of markers) {
    const headerRowIndex = marker.rowIndex + 1;
    const header = values[headerRowIndex] || [];
    const startColumn = normalizedDynamicStartColumn(header, marker.columnIndex);
    const current = DISNEY_HEADERS.map((_, index) => headerToken(header[startColumn + index]));
    const expected = DISNEY_HEADERS.map(headerToken);
    if (expected.every((token, index) => current[index] === token)) continue;
    const currentHasLegacyPin = (
      current.slice(0, 9).every((token, index) => token === expected[index])
      && headerToken(header[startColumn + 9]) === "PIN"
      && headerToken(header[startColumn + 10]) === "ORDERID"
      && headerToken(header[startColumn + 11]) === "CATATAN"
      && headerToken(header[startColumn + 12]) === "STOCKID"
    );
    const missingOrderId = (
      current[0] === expected[0]
      && current[1] === expected[1]
      && current[2] === expected[2]
      && current[8] === expected[8]
      && current[9] === expected[10]
      && current[10] === expected[11]
    );
    const missingStockId = expected.slice(0, 11).every((token, index) => current[index] === token) && !current[11];
    if (!missingOrderId && !missingStockId && !currentHasLegacyPin) continue;
    for (let rowIndex = headerRowIndex + 1; rowIndex < values.length; rowIndex += 1) {
      const row = values[rowIndex] || [];
      const hasStockIdentity = [0, 1, 2].some((offset) => normalize(row[startColumn + offset]));
      if (!hasStockIdentity) continue;
      const sheetRow = rowIndex + 1;
      const stock = (db.stock || []).find((item) => (
        normalizeLower(item.sheetName) === normalizeLower(sheetName)
        && Number(item.sheetRow || 0) === sheetRow
        && normalizePoolMarker(item.sheetPool) === normalizePoolMarker(marker.key)
      ));
      const account = stock ? (db.managedAccounts || []).find((item) => item.stockId === stock.id && !item.returnedToStockAt) : null;
      const orderIdCandidates = currentHasLegacyPin
        ? [row[startColumn + 10], row[startColumn + 9]]
        : [row[startColumn + 9]];
      const noteCandidates = currentHasLegacyPin
        ? [row[startColumn + 11], row[startColumn + 10]]
        : [row[startColumn + 9]];
      const stockCandidates = currentHasLegacyPin
        ? [row[startColumn + 12], row[startColumn + 11]]
        : [row[startColumn + 10]];
      const orderId = stock?.sheetOrderId || account?.orderId || account?.sourceOrderId
        || orderIdCandidates.map(normalize).find((value) => /^ORD-/i.test(value)) || "";
      const notes = stock?.notes
        || noteCandidates.map(normalize).find((value) => value && !/^ORD-/i.test(value) && !/^stk-/i.test(value)) || "";
      const stockId = stock?.id
        || stockCandidates.map(normalize).find((value) => /^stk-/i.test(value)) || "";
      if (missingStockId) {
        updates.push({ range: cellRange(sheetName, rowIndex + 1, startColumn + 11), values: [[stockId]] });
        migratedRows += 1;
        continue;
      }
      updates.push({
        range: rowRange(sheetName, rowIndex + 1, startColumn + 9, 3),
        values: [[orderId, notes, stockId]],
      });
      if (currentHasLegacyPin) {
        updates.push({ range: cellRange(sheetName, rowIndex + 1, startColumn + 12), values: [[""]] });
      }
      migratedRows += 1;
    }
    updates.push({
      range: rowRange(sheetName, headerRowIndex + 1, startColumn, DISNEY_HEADERS.length),
      values: [DISNEY_HEADERS],
    });
    if (currentHasLegacyPin) {
      updates.push({ range: cellRange(sheetName, headerRowIndex + 1, startColumn + 12), values: [[""]] });
    }
    repairedPools += 1;
  }
  if (updates.length) await updateValues(db, updates);
  return { ok: true, repairedPools, migratedRows, headers: DISNEY_HEADERS };
}

function sheetRowValues(stock, account = {}, order = {}) {
  const pool = stockPool(stock);
  const purchaseDate = preferPurchaseDate(account, order, stock);
  const startedAt = formatSheetPurchaseDate(purchaseDate);
  const durationDays = Number(account.durationDays || order.durationDays || stock.soldDurationDays || 30);
  const durationLabel = formatSheetDurationLabel(account.duration || order.duration || stock.soldDuration || "", durationDays);
  const expiresAt = account.expiresAt || order.expiresAt || formatDateTime(addDays(purchaseDate || new Date(), durationDays));
  if (isDisneyPool(pool) || isDisneySheetStock(stock, account)) {
    return [
      stock.loginPhone || account.loginPhone || "",
      stock.otpEmail || account.otpEmail || stock.email || account.email || "",
      stock.profile || account.profile || "",
      startedAt,
      durationLabel,
      expiresAt,
      order.device || account.device || stock.device || "",
      account.reseller || order.reseller || sheetOrderCustomer(order, account) || "",
      normalizeWhatsapp(account.whatsapp || order.whatsapp || ""),
      order.id || account.orderId || account.sourceOrderId || "",
      sheetOrderNote(order, stock),
      account.stockId || stock.id || "",
    ];
  }
  if (poolUsesUniversalAccount(pool)) {
    return [
      `${stock.email || account.email || ""}\n${stock.password || account.password || ""}`.trim(),
      startedAt,
      durationLabel,
      expiresAt,
      account.reseller || order.reseller || sheetOrderCustomer(order, account) || "",
      normalizeWhatsapp(account.whatsapp || order.whatsapp || ""),
      sheetOrderNote(order, stock),
      "",
      "",
    ];
  }
  if (poolUsesSplitPassword(pool)) {
    return [
      stock.email || account.email || "",
      stock.password || account.password || "",
      startedAt,
      durationLabel,
      expiresAt,
      account.reseller || order.reseller || sheetOrderCustomer(order, account) || "",
      normalizeWhatsapp(account.whatsapp || order.whatsapp || ""),
      sheetOrderNote(order, stock),
      "",
      "",
    ];
  }
  return [
    `${stock.email || account.email || ""}\n${stock.password || account.password || ""}`.trim(),
    stock.profile || account.profile || "",
    startedAt,
    durationLabel,
    expiresAt,
    order.device || account.device || stock.device || order.email || "",
    account.reseller || order.reseller || sheetOrderCustomer(order, account) || "",
    normalizeWhatsapp(account.whatsapp || order.whatsapp || ""),
    stock.pin || account.pin || "",
    "",
    sheetOrderNote(order, stock),
    "",
  ];
}

function stockPool(stock = {}) {
  if (POOLS[stock.sheetPool]) return POOLS[stock.sheetPool];
  return {
    key: stock.sheetPool || "DYNAMIC",
    label: `POOL: ${stock.sheetPool || "DYNAMIC"}`,
    startColumn: Number(stock.sheetStartColumn || 0),
    productKey: "dynamic",
    schema: stock.sheetPoolSchema || "universal",
    sheetName: stock.sheetName || "",
  };
}

function stockSheetName(db, stock = {}) {
  const pool = stockPool(stock);
  return stock.sheetName || (pool.productKey === "netflix" ? googleSheetsSettings(db).sheetName : SHEET_CONFIGS[pool.productKey]?.sheetName(db)) || googleSheetsSettings(db).sheetName;
}

function sheetHeaderSections(header = []) {
  const starts = header
    .map((value, index) => {
      const token = headerToken(value);
      return ["ACCOUNT", "AKUN", "EMAILAKUN", "NUMBER", "NOMOR", "NOMORLOGIN", "NOHP", "NOMORHP", "PHONE", "PHONENUMBER"].includes(token)
        ? index
        : -1;
    })
    .filter((index) => index >= 0);
  return starts.map((startColumn, index) => ({
    startColumn,
    endColumn: starts[index + 1] ?? header.length,
  })).filter((section) => {
    const columns = dynamicPoolColumns(header, section.startColumn, section.endColumn, inferDynamicPoolSchema(header, section.startColumn, section.endColumn));
    return columns.duration >= 0 && columns.seller >= 0;
  });
}

function actualSheetLayout(rows = [], stock = {}, pool = {}) {
  const sheetRowIndex = Math.max(0, Number(stock.sheetRow || 1) - 1);
  const expectedStart = Number(stock.sheetStartColumn ?? pool.startColumn ?? 0);
  const disney = isDisneyPool(pool) || isDisneySheetStock(stock);
  const layouts = [];
  for (let rowIndex = sheetRowIndex - 1; rowIndex >= Math.max(0, sheetRowIndex - 40); rowIndex -= 1) {
    const header = rows[rowIndex] || [];
    for (const section of sheetHeaderSections(header)) {
      const schema = inferDynamicPoolSchema(header, section.startColumn, section.endColumn);
      const columns = dynamicPoolColumns(header, section.startColumn, section.endColumn, schema);
      const looksDisney = columns.loginPhone >= 0 && columns.otpEmail >= 0 && columns.profile >= 0;
      if (disney && !looksDisney) continue;
      layouts.push({
        header,
        headerRow: rowIndex + 1,
        startColumn: section.startColumn,
        endColumn: section.endColumn,
        schema,
        columns,
        distance: Math.abs(section.startColumn - expectedStart),
      });
    }
    if (layouts.length) break;
  }
  return layouts.sort((a, b) => a.distance - b.distance)[0] || null;
}

function actualSheetRowUpdates(sheetName, rowNumber, rows, stock = {}, account = {}, order = {}) {
  const pool = stockPool(stock);
  const layout = actualSheetLayout(rows, stock, pool);
  if (!layout) return null;
  const { header, startColumn, endColumn, schema, columns } = layout;
  const purchaseDate = preferPurchaseDate(account, order, stock);
  const durationDays = Number(account.durationDays || order.durationDays || stock.soldDurationDays || 30);
  const durationLabel = formatSheetDurationLabel(account.duration || order.duration || stock.soldDuration || "", durationDays);
  const values = Array(header.length).fill("");
  const writtenIndexes = new Set();
  const put = (index, value) => {
    if (!Number.isInteger(index) || index < startColumn || index >= endColumn) return;
    values[index] = value ?? "";
    writtenIndexes.add(index);
  };
  const disney = isDisneyPool(pool) || isDisneySheetStock(stock, account);
  if (disney) {
    put(columns.loginPhone, stock.loginPhone || account.loginPhone || "");
    put(columns.otpEmail, stock.otpEmail || account.otpEmail || stock.email || account.email || "");
  } else if (schema === "split") {
    put(columns.account, stock.email || account.email || "");
    put(columns.password, stock.password || account.password || "");
  } else {
    put(columns.account, `${stock.email || account.email || ""}\n${stock.password || account.password || ""}`.trim());
  }
  put(columns.profile, stock.profile || account.profile || "");
  put(columns.date, formatSheetPurchaseDate(purchaseDate));
  put(columns.duration, durationLabel);
  put(columns.device, order.device || account.device || stock.device || "");
  put(columns.seller, account.reseller || order.reseller || sheetOrderCustomer(order, account) || "");
  // EXPIRED and NOMOR WA are owned by Sheet formulas derived from date,
  // duration, and seller. Never write them from the dashboard.
  put(columns.pin, stock.pin || account.pin || "");
  put(columns.orderId, order.id || account.orderId || account.sourceOrderId || "");
  put(columns.notes, sheetOrderNote(order, stock));
  put(columns.stockId, account.stockId || stock.id || "");
  const preserveIndexes = [...formulaIndexesFromRow(rows[rowNumber - 1] || [])];
  const allowHeaders = [...writtenIndexes].map((index) => header[index]).filter(Boolean);
  const updates = safeCellUpdates(sheetName, rowNumber, 0, header, values, { preserveIndexes, allowHeaders })
    .filter((update) => writtenIndexes.has(columnIndexFromRange(update.range)));
  return { updates, layout };
}

function columnIndexFromRange(range = "") {
  const match = String(range).match(/!([A-Z]+)\d+$/i);
  if (!match) return -1;
  return match[1].toUpperCase().split("").reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

export async function pushAccountsToGoogleSheets(db, accounts = [], order = {}) {
  if (!googleSheetsConfigured(db)) return { ok: false, skipped: true, reason: "google_sheets_not_configured" };
  const data = [];
  let updated = 0;
  const rowsBySheet = new Map();
  async function formulaIndexesForRow(sheetName, rowNumber) {
    if (!rowsBySheet.has(sheetName)) {
      rowsBySheet.set(sheetName, await readSheetValuesByName(db, sheetName).catch(() => []));
    }
    return formulaIndexesFromRow((rowsBySheet.get(sheetName) || [])[Number(rowNumber) - 1] || []);
  }
  for (const account of accounts) {
    const stock = (db.stock || []).find((item) => item.id === account.stockId || item.sheetStockKey === account.sheetStockKey);
    if (!stock?.sheetStockKey || !stock.sheetRow) continue;
    const pool = stockPool(stock);
    const sheetName = stockSheetName(db, stock);
    if (!rowsBySheet.has(sheetName)) {
      rowsBySheet.set(sheetName, await readSheetValuesByName(db, sheetName).catch(() => []));
    }
    const actualMapping = actualSheetRowUpdates(sheetName, Number(stock.sheetRow), rowsBySheet.get(sheetName) || [], stock, account, order);
    if (actualMapping) {
      if (!actualMapping.updates.length) continue;
      stock.sheetStartColumn = actualMapping.layout.startColumn;
      account.sheetStartColumn = actualMapping.layout.startColumn;
      data.push(...actualMapping.updates);
      updated += 1;
      continue;
    }
    const headers = poolHeaders(pool);
    const preserveIndexes = await formulaIndexesForRow(sheetName, stock.sheetRow);
    const rowUpdates = safeCellUpdates(
      sheetName,
      Number(stock.sheetRow),
      Number(stock.sheetStartColumn ?? pool.startColumn),
      headers,
      sheetRowValues(stock, account, order),
      { preserveIndexes: [...preserveIndexes] },
    );
    rowUpdates.push(...clearLegacyMetadataCells(sheetName, Number(stock.sheetRow), Number(stock.sheetStartColumn ?? pool.startColumn), pool));
    if (!rowUpdates.length) continue;
    data.push(...rowUpdates);
    updated += 1;
  }
  if (!data.length) return { ok: true, updated: 0, skipped: true, reason: "no_sheet_rows" };
  await updateValues(db, data);
  const syncedAt = formatDateTime(new Date());
  for (const account of accounts) {
    account.googleSheetsSyncedAt = syncedAt;
  }
  return { ok: true, updated };
}

export async function previewAccountSheetMapping(db, options = {}) {
  const accountId = normalize(options.accountId || "");
  const stockId = normalize(options.stockId || "");
  const sheetStockKey = normalize(options.sheetStockKey || "");
  const email = normalizeLower(options.email || "");
  const account = (db.managedAccounts || []).find((item) => (
    (accountId && normalize(item.id) === accountId)
    || (sheetStockKey && normalize(item.sheetStockKey) === sheetStockKey)
    || (email && normalizeLower(item.email) === email)
  )) || null;
  const stock = (db.stock || []).find((item) => (
    (stockId && normalize(item.id) === stockId)
    || (sheetStockKey && normalize(item.sheetStockKey) === sheetStockKey)
    || (email && normalizeLower(item.email) === email)
  )) || null;
  const target = stock || account;
  if (!target) {
    return { ok: false, reason: "target_not_found" };
  }

  const resolvedStock = stock || (account ? (db.stock || []).find((item) => item.id === account.stockId || item.sheetStockKey === account.sheetStockKey) : null) || target;
  const pool = stockPool(resolvedStock);
  const sheetName = stockSheetName(db, resolvedStock);
  let headers = poolHeaders(pool);
  let values = sheetRowValues(resolvedStock, account || {}, options.order || {});
  let startColumn = Number(resolvedStock.sheetStartColumn ?? pool.startColumn);
  const rowNumber = Number(resolvedStock.sheetRow || account?.sheetRow || 0);
  const sheetConfigured = googleSheetsConfigured(db);
  let preserveIndexes = [];
  let actualMapping = null;
  if (sheetConfigured && sheetName && rowNumber) {
    const rows = await readSheetValuesByName(db, sheetName).catch(() => []);
    preserveIndexes = [...formulaIndexesFromRow((rows[Number(rowNumber) - 1] || []))];
    actualMapping = actualSheetRowUpdates(sheetName, rowNumber, rows, resolvedStock, account || {}, options.order || {});
    if (actualMapping) {
      headers = actualMapping.layout.header.slice(actualMapping.layout.startColumn, actualMapping.layout.endColumn);
      startColumn = actualMapping.layout.startColumn;
      values = headers.map((_, index) => {
        const absoluteIndex = startColumn + index;
        const update = actualMapping.updates.find((item) => columnIndexFromRange(item.range) === absoluteIndex);
        return update?.values?.[0]?.[0] ?? "";
      });
    }
  }

  const updates = actualMapping?.updates || (rowNumber
    ? safeCellUpdates(sheetName, rowNumber, startColumn, headers, values, { preserveIndexes })
    : []);

  return {
    ok: true,
    sheetConfigured,
    source: account ? "managed_account" : "stock",
    sheetName,
    rowNumber,
    startColumn,
    schema: poolSchema(pool),
    headers,
    values,
    updates,
    columns: headers.map((header, index) => ({
      index: startColumn + index,
      header,
      value: values[index] ?? "",
    })),
    target: {
      id: target.id || "",
      email: target.email || "",
      stockId: target.stockId || "",
      sheetStockKey: target.sheetStockKey || "",
      accountType: target.accountType || "",
      source: target.source || "",
    },
  };
}

export async function syncAccountCredentialsToGoogleSheets(db, options = {}) {
  if (!googleSheetsConfigured(db)) return { ok: false, skipped: true, reason: "google_sheets_not_configured" };
  const includeAll = Boolean(options.all);
  const emailKey = normalizeLower(options.email || "");
  const stockIds = new Set((options.stockIds || []).map((item) => normalize(item)).filter(Boolean));
  const sheetStockKeys = new Set((options.sheetStockKeys || []).map((item) => normalize(item)).filter(Boolean));
  const accountIds = new Set((options.accountIds || []).map((item) => normalize(item)).filter(Boolean));
  const dataByRange = new Map();
  const rowsBySheet = new Map();

  function includeStock(stock = {}) {
    return (
      includeAll
      ||
      (emailKey && normalizeLower(stock.email) === emailKey)
      || stockIds.has(normalize(stock.id))
      || sheetStockKeys.has(normalize(stock.sheetStockKey))
    );
  }

  async function addRow(target = {}, fallback = {}) {
    const sheetRow = Number(target.sheetRow || fallback.sheetRow || 0);
    if (!sheetRow) return;
    const pool = stockPool(target.sheetPool ? target : fallback);
    const startColumn = Number(target.sheetStartColumn ?? fallback.sheetStartColumn ?? pool.startColumn);
    const sheetName = stockSheetName(db, target.sheetName ? target : fallback);
    const email = target.email || fallback.email || options.email || "";
    const password = options.password !== undefined ? options.password : target.password ?? fallback.password ?? "";
    if (!email && !password) return;
    if (!rowsBySheet.has(sheetName)) {
      rowsBySheet.set(sheetName, await readSheetValuesByName(db, sheetName).catch(() => []));
    }
    const rows = rowsBySheet.get(sheetName) || [];
    const layout = actualSheetLayout(rows, target.sheetRow ? target : fallback, pool);
    if (layout) {
      const disney = isDisneyPool(pool) || isDisneySheetStock(target, fallback);
      if (disney) {
        const loginPhone = target.loginPhone || fallback.loginPhone || "";
        const otpEmail = target.otpEmail || fallback.otpEmail || email;
        if (layout.columns.loginPhone >= 0) dataByRange.set(cellRange(sheetName, sheetRow, layout.columns.loginPhone), [[loginPhone]]);
        if (layout.columns.otpEmail >= 0) dataByRange.set(cellRange(sheetName, sheetRow, layout.columns.otpEmail), [[otpEmail]]);
      } else if (layout.schema === "split") {
        if (layout.columns.account >= 0) dataByRange.set(cellRange(sheetName, sheetRow, layout.columns.account), [[email]]);
        if (layout.columns.password >= 0) dataByRange.set(cellRange(sheetName, sheetRow, layout.columns.password), [[password]]);
      } else if (layout.columns.account >= 0) {
        dataByRange.set(cellRange(sheetName, sheetRow, layout.columns.account), [[`${email}\n${password}`.trim()]]);
      }
      return;
    }
    if (poolUsesUniversalAccount(pool)) {
      dataByRange.set(cellRange(sheetName, sheetRow, startColumn), [[`${email}\n${password}`.trim()]]);
    } else if (poolUsesSplitPassword(pool)) {
      dataByRange.set(rowRange(sheetName, sheetRow, startColumn, 2), [[email, password]]);
    } else {
      dataByRange.set(cellRange(sheetName, sheetRow, startColumn), [[`${email}\n${password}`.trim()]]);
    }
  }

  for (const stock of db.stock || []) {
    if (!includeStock(stock)) continue;
    await addRow(stock);
  }

  for (const account of db.managedAccounts || []) {
    const matchesAccount = (
      includeAll
      ||
      (emailKey && normalizeLower(account.email) === emailKey)
      || stockIds.has(normalize(account.stockId))
      || sheetStockKeys.has(normalize(account.sheetStockKey))
      || accountIds.has(normalize(account.id))
    );
    if (!matchesAccount) continue;
    const stock = (db.stock || []).find((item) => item.id === account.stockId || item.sheetStockKey === account.sheetStockKey);
    await addRow(stock || account, account);
  }

  const data = [...dataByRange.entries()].map(([range, values]) => ({ range, values }));
  if (!data.length) return { ok: true, updated: 0, skipped: true, reason: "no_sheet_rows" };
  await updateValues(db, data);
  const syncedAt = formatDateTime(new Date());
  for (const stock of db.stock || []) {
    if (includeStock(stock)) stock.googleSheetsSyncedAt = syncedAt;
  }
  for (const account of db.managedAccounts || []) {
    const stockMatch = stockIds.has(normalize(account.stockId)) || sheetStockKeys.has(normalize(account.sheetStockKey));
    if (includeAll || (emailKey && normalizeLower(account.email) === emailKey) || accountIds.has(normalize(account.id)) || stockMatch) {
      account.googleSheetsSyncedAt = syncedAt;
    }
  }
  return { ok: true, updated: data.length };
}

export async function pushFulfilledOrderToGoogleSheets(db, result = {}) {
  const order = result.order || {};
  const stockIds = new Set(order.deliveredStockIds || []);
  const orderId = String(order.id || "").trim();
  const directAccounts = (db.managedAccounts || []).filter((account) => (
    String(account.orderId || account.sourceOrderId || "").trim() === orderId
  ));
  const accounts = directAccounts.length
    ? directAccounts
    : (db.managedAccounts || []).filter((account) => stockIds.has(account.stockId));
  try {
    let pushed;
    if (accounts.some((account) => ["canva_link", "link_pool"].includes(String(account.accountType || "")) || ["canva_order", "link_pool_order"].includes(String(account.source || "")))) {
      pushed = await pushLinkPoolUsageToGoogleSheets(db, accounts, order);
    } else {
      pushed = await pushAccountsToGoogleSheets(db, accounts, order);
    }
    const history = await pushOrderHistoryToGoogleSheets(db, accounts, order);
    order.googleSheetsSyncStatus = pushed.ok ? "synced" : pushed.skipped ? "skipped" : "failed";
    order.googleSheetsSyncAt = pushed.ok ? formatDateTime(new Date()) : order.googleSheetsSyncAt || "";
    order.googleSheetsSyncError = pushed.ok || pushed.skipped ? "" : pushed.reason || "google_sheets_sync_failed";
    order.googleSheetsHistorySyncStatus = history.ok ? "synced" : history.skipped ? "skipped" : "failed";
    order.googleSheetsHistorySyncAt = history.ok ? formatDateTime(new Date()) : order.googleSheetsHistorySyncAt || "";
    order.googleSheetsHistorySyncError = history.ok || history.skipped ? "" : history.reason || history.error || "google_sheets_history_sync_failed";
    return { ...pushed, history };
  } catch (error) {
    order.googleSheetsSyncStatus = "failed";
    order.googleSheetsSyncError = error.message || "google_sheets_sync_failed";
    return { ok: false, error: order.googleSheetsSyncError };
  }
}

function orderHistoryAccountCells(account = {}, order = {}, stock = {}) {
  const purchaseDate = formatSheetPurchaseDate(preferPurchaseDate(account, order, stock));
  return [
    purchaseDate || order.paidAt || order.createdAt || "",
    account.reseller || order.reseller || order.customer || "",
    sheetOrderCustomer(order, account),
    account.product || order.product || "",
    account.variant || order.variant || "",
    account.duration || order.duration || "",
    account.email || stock.email || "",
    account.profile || stock.profile || "",
    account.expiresAt || order.expiresAt || "",
    account.sheetName || stock.sheetName || "",
    String(account.sheetRow || stock.sheetRow || ""),
    order.id || account.orderId || account.sourceOrderId || "",
    account.stockId || stock.id || "",
    sheetOrderNote(order, stock),
  ];
}

function orderHistoryIdentity(account = {}, stock = {}) {
  const stockId = normalize(account.stockId || stock.id || "");
  if (stockId) return stockId;
  const sheetName = normalize(account.sheetName || stock.sheetName || "");
  const sheetRow = normalize(account.sheetRow || stock.sheetRow || "");
  if (sheetName && sheetRow) return `${sheetName}#${sheetRow}`;
  return normalizeLower(account.email || stock.email || "");
}

function orderHistoryKey(account = {}, order = {}, stock = {}) {
  return [
    normalize(order.id || account.orderId || account.sourceOrderId || ""),
    orderHistoryIdentity(account, stock),
    normalizeLower(account.email || stock.email || ""),
  ].join("|");
}

function orderHistoryRowKey(row = []) {
  const orderId = normalize(row[11]);
  const stockId = normalize(row[12]);
  const email = normalizeLower(row[6]);
  const sheetName = normalize(row[9]);
  const sheetRow = normalize(row[10]);
  const identity = stockId || (sheetName && sheetRow ? `${sheetName}#${sheetRow}` : email);
  return [orderId, identity, email].join("|");
}

export async function ensureOrderHistorySheet(db) {
  if (!googleSheetsConfigured(db)) {
    const error = new Error("Google Sheets belum dikonfigurasi");
    error.status = 400;
    throw error;
  }
  const sheetId = await ensureSheetExists(db, ORDER_HISTORY_SHEET_NAME);
  const values = await readSheetValuesByName(db, ORDER_HISTORY_SHEET_NAME).catch(() => []);
  const header = values[0] || [];
  const writes = [];
  const normalizedHeader = header.slice(0, ORDER_HISTORY_HEADERS.length).map((cell) => normalize(cell));
  const expectedHeader = ORDER_HISTORY_HEADERS.map((cell) => normalize(cell));
  const headerMatches = normalizedHeader.length === expectedHeader.length && expectedHeader.every((cell, index) => normalizedHeader[index] === cell);
  const needsLegacyMigration = orderHistoryNeedsLegacyMigration(header, values);
  if (!header.some((cell) => normalize(cell)) || !headerMatches) {
    writes.push({
      range: `${quoteSheetName(ORDER_HISTORY_SHEET_NAME)}!A1:${a1Column(ORDER_HISTORY_HEADERS.length - 1)}1`,
      values: [ORDER_HISTORY_HEADERS],
    });
    for (const columnIndex of [14, 15, 16]) {
      writes.push({
        range: cellRange(ORDER_HISTORY_SHEET_NAME, 1, columnIndex),
        values: [[""]],
      });
    }
  }
  if (needsLegacyMigration) {
    for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
      const row = values[rowIndex] || [];
      if (!row.some((cell) => normalize(cell))) continue;
      writes.push({
        range: rowRange(ORDER_HISTORY_SHEET_NAME, rowIndex + 1, 0, ORDER_HISTORY_HEADERS.length),
        values: [compactLegacyOrderHistoryRow(row)],
      });
      for (const columnIndex of [14, 15, 16]) {
        writes.push({
          range: cellRange(ORDER_HISTORY_SHEET_NAME, rowIndex + 1, columnIndex),
          values: [[""]],
        });
      }
    }
  }
  if (writes.length) await updateValues(db, writes);
  if (sheetId !== null) {
    await batchUpdate(db, [
      {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: "gridProperties.frozenRowCount",
        },
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: "CENTER", wrapStrategy: "WRAP" } },
          fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.horizontalAlignment,userEnteredFormat.wrapStrategy",
        },
      },
    ]).catch(() => null);
  }
  return { ok: true, sheetName: ORDER_HISTORY_SHEET_NAME };
}

export async function pushOrderHistoryToGoogleSheets(db, accounts = [], order = {}) {
  if (!googleSheetsConfigured(db)) return { ok: false, skipped: true, reason: "google_sheets_not_configured" };
  if (!accounts.length || !order?.id) return { ok: true, updated: 0, skipped: true, reason: "no_accounts" };
  await ensureOrderHistorySheet(db);
  const values = await readSheetValuesByName(db, ORDER_HISTORY_SHEET_NAME).catch(() => []);
  const existingKeys = new Set();
  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] || [];
    const key = orderHistoryRowKey(row);
    if (key !== "|||") existingKeys.add(key);
  }
  const data = [];
  let nextRow = nextWritableRow(values, 2);
  let updated = 0;
  for (const account of accounts) {
    const stock = (db.stock || []).find((item) => item.id === account.stockId || item.sheetStockKey === account.sheetStockKey) || {};
    const key = orderHistoryKey(account, order, stock);
    if (existingKeys.has(key)) continue;
    const rowValues = orderHistoryAccountCells(account, order, stock);
    data.push({
      range: rowRange(ORDER_HISTORY_SHEET_NAME, nextRow, 0, ORDER_HISTORY_HEADERS.length),
      values: [rowValues],
    });
    existingKeys.add(key);
    nextRow += 1;
    updated += 1;
  }
  if (!data.length) return { ok: true, updated: 0, skipped: true, reason: "order_history_already_synced" };
  await updateValues(db, data);
  return { ok: true, updated };
}

export async function backfillOrderHistorySheet(db, options = {}) {
  if (!googleSheetsConfigured(db)) return { ok: false, skipped: true, reason: "google_sheets_not_configured" };
  const limit = Math.max(0, Number(options.limit || 0));
  const orderIds = new Set((options.orderIds || []).map((item) => normalize(item)).filter(Boolean));
  const orders = (db.orders || [])
    .filter((order) => {
      if (orderIds.size) return orderIds.has(normalize(order.id));
      return Boolean(order.id && (order.deliveredStockIds || []).length);
    })
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  const selected = limit > 0 ? orders.slice(0, limit) : orders;
  await ensureOrderHistorySheet(db);
  const values = await readSheetValuesByName(db, ORDER_HISTORY_SHEET_NAME).catch(() => []);
  const existingKeys = new Set();
  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] || [];
    const key = orderHistoryRowKey(row);
    if (key !== "|||") existingKeys.add(key);
  }
  const data = [];
  let nextRow = nextWritableRow(values, 2);
  let updatedOrders = 0;
  let updatedRows = 0;
  for (const order of selected) {
    const accounts = (db.managedAccounts || []).filter((account) => (
      String(account.orderId || account.sourceOrderId || "").trim() === String(order.id || "").trim()
      || (order.deliveredStockIds || []).includes(account.stockId)
    ));
    let orderUpdated = 0;
    for (const account of accounts) {
      const stock = (db.stock || []).find((item) => item.id === account.stockId || item.sheetStockKey === account.sheetStockKey) || {};
      const key = orderHistoryKey(account, order, stock);
      if (existingKeys.has(key)) continue;
      data.push({
        range: rowRange(ORDER_HISTORY_SHEET_NAME, nextRow, 0, ORDER_HISTORY_HEADERS.length),
        values: [orderHistoryAccountCells(account, order, stock)],
      });
      existingKeys.add(key);
      nextRow += 1;
      updatedRows += 1;
      orderUpdated += 1;
    }
    if (orderUpdated > 0) updatedOrders += 1;
  }
  if (data.length) await updateValues(db, data);
  return {
    ok: true,
    totalOrders: selected.length,
    updatedOrders,
    updatedRows,
    skippedOrders: selected.length - updatedOrders,
  };
}

function linkUsageCellsByColumns(account = {}, order = {}, columns = linkUsageColumns(LINK_USAGE_HEADERS)) {
  const cells = new Map();
  const skipIndexes = new Set([columns.expiresAt, columns.whatsapp]);
  const startedAt = formatSheetPurchaseDate(preferPurchaseDate(account, order));
  const durationLabel = formatSheetDurationLabel(account.duration || order.duration || "", account.durationDays || order.durationDays || 0);
  setCellValue(cells, columns.email, account.email || order.email || "", skipIndexes);
  setCellValue(cells, columns.reseller, account.reseller || order.reseller || order.customer || "", skipIndexes);
  setCellValue(cells, columns.whatsapp, normalizeWhatsapp(account.whatsapp || order.whatsapp || ""), skipIndexes);
  setCellValue(cells, columns.startedAt, startedAt, skipIndexes);
  setCellValue(cells, columns.duration, durationLabel, skipIndexes);
  setCellValue(cells, columns.status, account.status || "active", skipIndexes);
  setCellValue(cells, columns.orderId, order.id || account.orderId || account.sourceOrderId || "", skipIndexes);
  setCellValue(cells, columns.stockId, account.linkPoolId || account.canvaPoolId || "", skipIndexes);
  return [...cells.entries()].sort((a, b) => a[0] - b[0]);
}

export async function pushLinkPoolUsageToGoogleSheets(db, accounts = [], order = {}) {
  if (!googleSheetsConfigured(db)) return { ok: false, skipped: true, reason: "google_sheets_not_configured" };
  if (!accounts.length) return { ok: true, updated: 0, skipped: true, reason: "no_accounts" };
  const accountsBySheetKey = new Map();
  for (const account of accounts) {
    const poolId = normalize(account.linkPoolId || account.canvaPoolId || "");
    const pool = (db.linkPools || []).find((item) => normalize(item.id) === poolId);
    if (!pool?.sheetName) continue;
    const key = `${pool.sheetName}::${normalizePoolMarker(pool.poolKey || pool.key)}`;
    if (!accountsBySheetKey.has(key)) accountsBySheetKey.set(key, { pool, accounts: [] });
    accountsBySheetKey.get(key).accounts.push(account);
  }
  if (!accountsBySheetKey.size) return { ok: true, updated: 0, skipped: true, reason: "no_link_pool_sheet" };

  const data = [];
  let updated = 0;
  for (const { pool, accounts: groupAccounts } of accountsBySheetKey.values()) {
    const values = await readSheetValuesByName(db, pool.sheetName).catch(() => []);
    const usageSection = findLinkUsageSections(values).find((section) => normalizePoolMarker(section.key) === normalizePoolMarker(pool.poolKey || pool.key));
    if (!usageSection) continue;
    const usageColumns = usageSection.columns;
    const existingRows = values.slice(usageSection.headerIndex + 1);
    const existingUsageKeys = new Set();
    for (const row of existingRows) {
      const email = normalizeLower(row?.[usageColumns.email] || "");
      const orderId = normalize(row?.[usageColumns.orderId] || "");
      const stockId = normalize(row?.[usageColumns.stockId] || "");
      if (email && orderId) existingUsageKeys.add(`${email}|${orderId}|${stockId}`);
    }
    let nextRow = usageSection.headerIndex + existingRows.length + 2;
    for (const account of groupAccounts) {
      const email = normalizeLower(account.email || order.email || "");
      const orderId = normalize(order.id || account.orderId || account.sourceOrderId || "");
      const stockId = normalize(account.linkPoolId || account.canvaPoolId || "");
      const usageKey = email && orderId ? `${email}|${orderId}|${stockId}` : "";
      if (usageKey && existingUsageKeys.has(usageKey)) {
        account.googleSheetsSyncedAt = account.googleSheetsSyncedAt || formatDateTime(new Date());
        continue;
      }
      const rowNumber = nextRow++;
      for (const [columnIndex, value] of linkUsageCellsByColumns(account, order, usageColumns)) {
        data.push({
          range: cellRange(pool.sheetName, rowNumber, columnIndex),
          values: [[value]],
        });
      }
      if (usageKey) existingUsageKeys.add(usageKey);
      updated += 1;
    }
  }
  if (!data.length) return { ok: true, updated: 0, skipped: true, reason: "link_usage_not_found_or_already_synced" };
  await updateValues(db, data);
  const syncedAt = formatDateTime(new Date());
  for (const account of accounts) account.googleSheetsSyncedAt = syncedAt;
  return { ok: true, updated };
}

export async function pushCanvaUsageToGoogleSheets(db, accounts = [], order = {}) {
  if (!googleSheetsConfigured(db)) return { ok: false, skipped: true, reason: "google_sheets_not_configured" };
  if (!accounts.length) return { ok: true, updated: 0, skipped: true, reason: "no_accounts" };
  await ensureCanvaSheetsTemplate(db).catch(() => null);
  const values = await readSheetValuesByName(db, CANVA_SHEET_NAME).catch(() => []);
  const markerIndex = values.findIndex((row) => normalize(row?.[0]).toUpperCase() === "CANVA USAGE");
  const headerIndex = markerIndex >= 0 ? markerIndex + 1 : 7;
  const usageHeader = values[headerIndex] || CANVA_USAGE_HEADERS;
  const usageColumns = canvaUsageColumns(usageHeader);
  const existingRows = values.slice(headerIndex + 1);
  const existingUsageKeys = new Set();
  for (const row of existingRows) {
    const email = normalizeLower(row?.[usageColumns.email] || "");
    const orderId = normalize(row?.[usageColumns.orderId] || "");
    if (email && orderId) existingUsageKeys.add(`${email}|${orderId}`);
  }
  let nextRow = headerIndex + existingRows.length + 2;
  const data = [];
  let updated = 0;
  for (const account of accounts) {
    const email = normalizeLower(account.email || order.email || "");
    const orderId = normalize(order.id || account.orderId || account.sourceOrderId || "");
    const usageKey = email && orderId ? `${email}|${orderId}` : "";
    if (usageKey && existingUsageKeys.has(usageKey)) {
      account.googleSheetsSyncedAt = account.googleSheetsSyncedAt || formatDateTime(new Date());
      continue;
    }
    const rowNumber = nextRow++;
    for (const [columnIndex, value] of canvaUsageCellsByColumns(account, order, usageColumns)) {
      data.push({
        range: cellRange(CANVA_SHEET_NAME, rowNumber, columnIndex),
        values: [[value]],
      });
    }
    if (usageKey) existingUsageKeys.add(usageKey);
    updated += 1;
  }
  if (!data.length) return { ok: true, updated: 0, skipped: true, reason: "already_synced" };
  await updateValues(db, data);
  const syncedAt = formatDateTime(new Date());
  for (const account of accounts) account.googleSheetsSyncedAt = syncedAt;
  return { ok: true, updated };
}

function backfillOptionSet(values = []) {
  return new Set((values || []).map((item) => normalizeLower(item)).filter(Boolean));
}

function backfillOrderSet(values = []) {
  return new Set((values || []).map((item) => normalize(item)).filter(Boolean));
}

function isUsageManagedAccount(account = {}) {
  return (
    ["link_pool", "canva_link"].includes(String(account.accountType || ""))
    || ["link_pool_sheet", "canva_sheet", "link_pool_order", "canva_order"].includes(String(account.source || ""))
  );
}

function matchesBackfillAccountFilters(account = {}, options = {}) {
  if (!account || !account.email) return false;
  if (!options.includeHidden && (account.hidden || account.returnedToStockAt)) return false;
  const accountIds = backfillOrderSet(options.accountIds);
  const orderIds = backfillOrderSet(options.orderIds);
  const emails = backfillOptionSet(options.emails);
  if (!accountIds.size && !orderIds.size && !emails.size) return true;
  if (accountIds.has(normalize(account.id))) return true;
  if (emails.has(normalizeLower(account.email))) return true;
  const orderId = normalize(account.orderId || account.sourceOrderId || "");
  return Boolean(orderId && orderIds.has(orderId));
}

function previewDiffEntries(preview = {}) {
  return (preview.columns || [])
    .map((column) => {
      const update = (preview.updates || []).find((item) => item.range.endsWith(`${a1Column(column.index)}${preview.rowNumber}`));
      return update ? { header: column.header, value: column.value } : null;
    })
    .filter(Boolean);
}

async function buildLinkUsageBackfill(db, accounts = []) {
  const bySheet = new Map();
  for (const account of accounts) {
    const poolId = normalize(account.linkPoolId || account.canvaPoolId || "");
    const pool = (db.linkPools || []).find((item) => normalize(item.id) === poolId);
    if (!pool?.sheetName) continue;
    if (!bySheet.has(pool.sheetName)) bySheet.set(pool.sheetName, []);
    bySheet.get(pool.sheetName).push({ account, pool });
  }
  const previews = [];
  const data = [];
  for (const [sheetName, entries] of bySheet.entries()) {
    const values = await readSheetValuesByName(db, sheetName).catch(() => []);
    const rows = parseLinkUsageRows(values, sheetName);
    const sections = findLinkUsageSections(values);
    for (const { account, pool } of entries) {
      const row = rows.find((item) => linkUsageMatchesAccount(account, item, pool));
      if (!row) continue;
      const section = sections.find((item) => normalizePoolMarker(item.key) === normalizePoolMarker(row.key) && item.headerIndex < row.rowNumber);
      if (!section) continue;
      const cells = linkUsageCellsByColumns(account, { id: account.orderId || account.sourceOrderId || "" }, section.columns);
      previews.push({
        scope: "link_usage",
        accountId: account.id || "",
        orderId: account.orderId || account.sourceOrderId || "",
        email: account.email || "",
        sheetName,
        rowNumber: row.rowNumber,
        columns: cells.map(([columnIndex, value]) => ({ columnIndex, value })),
      });
      for (const [columnIndex, value] of cells) {
        data.push({
          range: cellRange(sheetName, row.rowNumber, columnIndex),
          values: [[value]],
        });
      }
    }
  }
  return { previews, data };
}

async function buildCanvaUsageBackfill(db, accounts = []) {
  if (!accounts.length) return { previews: [], data: [] };
  const values = await readSheetValuesByName(db, CANVA_SHEET_NAME).catch(() => []);
  const markerIndex = values.findIndex((row) => normalize(row?.[0]).toUpperCase() === "CANVA USAGE");
  const headerIndex = markerIndex >= 0 ? markerIndex + 1 : 7;
  const usageColumns = canvaUsageColumns(values[headerIndex] || CANVA_USAGE_HEADERS);
  const rows = parseCanvaUsageRows(values);
  const previews = [];
  const data = [];
  for (const account of accounts) {
    const row = rows.find((item) => canvaUsageMatchesSheetRow(account, item));
    if (!row) continue;
    const cells = canvaUsageCellsByColumns(account, { id: account.orderId || account.sourceOrderId || "" }, usageColumns);
    previews.push({
      scope: "canva_usage",
      accountId: account.id || "",
      orderId: account.orderId || account.sourceOrderId || "",
      email: account.email || "",
      sheetName: CANVA_SHEET_NAME,
      rowNumber: row.rowNumber,
      columns: cells.map(([columnIndex, value]) => ({ columnIndex, value })),
    });
    for (const [columnIndex, value] of cells) {
      data.push({
        range: cellRange(CANVA_SHEET_NAME, row.rowNumber, columnIndex),
        values: [[value]],
      });
    }
  }
  return { previews, data };
}

export async function backfillGoogleSheetsOrders(db, options = {}) {
  if (!googleSheetsConfigured(db)) return { ok: false, skipped: true, reason: "google_sheets_not_configured" };
  const limit = Math.max(0, Number(options.limit || 0));
  const filteredAccounts = (db.managedAccounts || []).filter((account) => matchesBackfillAccountFilters(account, options));
  const selectedAccounts = limit > 0 ? filteredAccounts.slice(0, limit) : filteredAccounts;
  const standardAccounts = selectedAccounts.filter((account) => !isUsageManagedAccount(account));
  const usageAccounts = selectedAccounts.filter((account) => isUsageManagedAccount(account));
  const canvaUsageAccounts = [];
  const linkUsageAccounts = [];
  for (const account of usageAccounts) {
    const poolId = normalize(account.linkPoolId || account.canvaPoolId || "");
    const pool = (db.linkPools || []).find((item) => normalize(item.id) === poolId);
    if (normalizePoolMarker(pool?.poolKey || account.sheetPool || "") === "CANVA" && !pool?.sheetName) {
      canvaUsageAccounts.push(account);
    } else {
      linkUsageAccounts.push(account);
    }
  }

  const standardPreviews = [];
  for (const account of standardAccounts) {
    const preview = await previewAccountSheetMapping(db, { accountId: account.id });
    if (!preview?.ok || !preview.rowNumber) continue;
    standardPreviews.push({
      scope: "account_row",
      accountId: account.id || "",
      orderId: account.orderId || account.sourceOrderId || "",
      email: account.email || "",
      sheetName: preview.sheetName,
      rowNumber: preview.rowNumber,
      columns: previewDiffEntries(preview),
    });
  }

  const linkUsage = await buildLinkUsageBackfill(db, linkUsageAccounts);
  const canvaUsage = await buildCanvaUsageBackfill(db, canvaUsageAccounts);
  const previews = [...standardPreviews, ...linkUsage.previews, ...canvaUsage.previews];

  if (options.dryRun !== false) {
    return {
      ok: true,
      dryRun: true,
      totalAccounts: selectedAccounts.length,
      standardAccounts: standardAccounts.length,
      usageAccounts: usageAccounts.length,
      matchedRows: previews.length,
      unmatchedAccounts: selectedAccounts.length - previews.length,
      sample: previews.slice(0, Number(options.sample || 20)),
    };
  }

  const standardResult = standardAccounts.length ? await pushAccountsToGoogleSheets(db, standardAccounts, {}) : { ok: true, updated: 0, skipped: true };
  const usageData = [...linkUsage.data, ...canvaUsage.data];
  if (usageData.length) await updateValues(db, usageData);
  const syncedAt = formatDateTime(new Date());
  for (const account of [...linkUsageAccounts, ...canvaUsageAccounts]) {
    if (previews.some((item) => item.accountId === account.id)) account.googleSheetsSyncedAt = syncedAt;
  }
  return {
    ok: true,
    dryRun: false,
    totalAccounts: selectedAccounts.length,
    standardAccounts: standardAccounts.length,
    usageAccounts: usageAccounts.length,
    matchedRows: previews.length,
    unmatchedAccounts: selectedAccounts.length - previews.length,
    updated: Number(standardResult.updated || 0) + usageData.length,
    updatedAccountRows: Number(standardResult.updated || 0),
    updatedUsageCells: usageData.length,
    sample: previews.slice(0, Number(options.sample || 20)),
  };
}

export async function clearAccountsInGoogleSheets(db, accounts = []) {
  if (!googleSheetsConfigured(db)) return { ok: false, skipped: true, reason: "google_sheets_not_configured" };
  const data = [];
  let updated = 0;
  const rowsBySheet = new Map();
  async function formulaIndexesForRow(sheetName, rowNumber) {
    if (!rowsBySheet.has(sheetName)) {
      rowsBySheet.set(sheetName, await readSheetValuesByName(db, sheetName).catch(() => []));
    }
    return formulaIndexesFromRow((rowsBySheet.get(sheetName) || [])[Number(rowNumber) - 1] || []);
  }
  for (const account of accounts) {
    const stock = (db.stock || []).find((item) => item.id === account.stockId || item.sheetStockKey === account.sheetStockKey);
    if (["canva_link", "link_pool"].includes(String(account.accountType || "")) || ["canva_sheet", "link_pool_sheet", "canva_order", "link_pool_order"].includes(String(account.source || ""))) {
      const sheetName = normalize(account.sheetName);
      const sheetRow = Number(account.sheetRow || 0);
      if (!sheetName || !sheetRow) continue;
      const values = await readSheetValuesByName(db, sheetName).catch(() => []);
      const key = normalizePoolMarker(account.sheetPool || (account.accountType === "canva_link" ? "CANVA" : ""));
      const usageSection = findLinkUsageSections(values).find((section) => !key || normalizePoolMarker(section.key) === key)
        || findLinkUsageSections(values).find((section) => sheetRow > section.headerIndex + 1);
      const columns = usageSection?.columns || linkUsageColumns(key === "CANVA" ? CANVA_USAGE_HEADERS : LINK_USAGE_HEADERS);
      const rowUpdates = clearCellUpdatesByColumns(sheetName, sheetRow, columns, ["email", "reseller", "startedAt", "duration", "status", "orderId", "stockId"]);
      if (!rowUpdates.length) continue;
      data.push(...rowUpdates);
      updated += 1;
      continue;
    }
    if (!stock?.sheetStockKey || !stock.sheetRow) continue;
    const pool = stockPool(stock);
    const sheetName = stockSheetName(db, stock);
    if (!rowsBySheet.has(sheetName)) {
      rowsBySheet.set(sheetName, await readSheetValuesByName(db, sheetName).catch(() => []));
    }
    const layout = actualSheetLayout(rowsBySheet.get(sheetName) || [], stock, pool);
    if (layout) {
      const rowUpdates = clearCellUpdatesByColumns(sheetName, Number(stock.sheetRow), layout.columns, [
        "date", "duration", "expiresAt", "device", "seller", "whatsapp", "orderId", "notes", "stockId",
      ]);
      if (!rowUpdates.length) continue;
      data.push(...rowUpdates);
      updated += 1;
      continue;
    }
    const headers = poolHeaders(pool);
    const preserveIndexes = await formulaIndexesForRow(sheetName, stock.sheetRow);
    const values = poolUsesUniversalAccount(pool)
      ? [`${stock.email || account.email || ""}\n${stock.password || account.password || ""}`.trim(), "", "", "", "", "", "", stock.notes || "", ""]
      : poolUsesSplitPassword(pool)
        ? [stock.email || account.email || "", stock.password || account.password || "", "", "", "", "", "", stock.notes || "", ""]
        : [`${stock.email || account.email || ""}\n${stock.password || account.password || ""}`.trim(), stock.profile || account.profile || "", "", "", "", "", "", "", stock.pin || account.pin || "", "", stock.notes || "", ""];
    const rowUpdates = safeCellUpdates(
      sheetName,
      Number(stock.sheetRow),
      Number(stock.sheetStartColumn ?? pool.startColumn),
      headers,
      values,
      { preserveIndexes: [...preserveIndexes] },
    );
    rowUpdates.push(...clearLegacyMetadataCells(sheetName, Number(stock.sheetRow), Number(stock.sheetStartColumn ?? pool.startColumn), pool));
    if (!rowUpdates.length) continue;
    data.push(...rowUpdates);
    updated += 1;
  }
  if (!data.length) return { ok: true, updated: 0, skipped: true };
  await updateValues(db, data);
  return { ok: true, updated };
}

export async function ensureNetflixSheetsTemplate(db) {
  if (!googleSheetsConfigured(db)) {
    const error = new Error("Google Sheets belum dikonfigurasi");
    error.status = 400;
    throw error;
  }
  const { sheetName } = googleSheetsSettings(db);
  await ensureSheetExists(db, sheetName);
  await updateValues(db, [
    { range: `${quoteSheetName(sheetName)}!A1`, values: [[NETFLIX_SHEETS_SNK]] },
    { range: `${quoteSheetName(sheetName)}!A11:L12`, values: [[POOLS.NETFLIX_SHARED.label, "", "", "", "", "", "", "", "", "", "", ""], SHEET_HEADERS] },
    { range: `${quoteSheetName(sheetName)}!N11:Y12`, values: [[POOLS.NETFLIX_2U.label, "", "", "", "", "", "", "", "", "", "", ""], SHEET_HEADERS] },
  ]);
  const sheetId = await getSheetId(db, sheetName);
  if (sheetId !== null) {
    await batchUpdate(db, [
      {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 12 } },
          fields: "gridProperties.frozenRowCount",
        },
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 12 },
          cell: { userEnteredFormat: { wrapStrategy: "WRAP" } },
          fields: "userEnteredFormat.wrapStrategy",
        },
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 10, endRowIndex: 12 },
          cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
          fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.horizontalAlignment",
        },
      },
    ]);
  }
  return { ok: true, sheetName, frozenRowCount: 12 };
}

async function ensurePoolSheetsTemplate(db, config, title) {
  if (!googleSheetsConfigured(db)) {
    const error = new Error("Google Sheets belum dikonfigurasi");
    error.status = 400;
    throw error;
  }
  const sheetName = config.sheetName(db);
  const sheetId = await ensureSheetExists(db, sheetName);
  const requiredColumns = Math.max(...config.pools.map((pool) => pool.startColumn + poolHeaders(pool).length), SHEET_HEADERS.length);
  if (sheetId !== null) {
    const currentColumns = Number((await getSheetProperties(db, sheetName))?.gridProperties?.columnCount || 0);
    if (currentColumns < requiredColumns) {
      await batchUpdate(db, [
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { columnCount: requiredColumns } },
            fields: "gridProperties.columnCount",
          },
        },
      ]).catch(() => null);
    }
  }
  const data = [
    { range: `${quoteSheetName(sheetName)}!A1`, values: [[title || `${config.summaryName.toUpperCase()} STOCK POOL`]] },
  ];
  for (const pool of config.pools) {
    const headers = poolHeaders(pool);
    const start = a1Column(pool.startColumn);
    const end = a1Column(pool.startColumn + headers.length - 1);
    data.push({
      range: `${quoteSheetName(sheetName)}!${start}11:${end}12`,
      values: [[pool.label, ...Array(headers.length - 1).fill("")], headers],
    });
  }
  await updateValues(db, data);
  if (sheetId !== null) {
    await batchUpdate(db, [
      {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 12 } },
          fields: "gridProperties.frozenRowCount",
        },
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 12 },
          cell: { userEnteredFormat: { wrapStrategy: "WRAP" } },
          fields: "userEnteredFormat.wrapStrategy",
        },
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 10, endRowIndex: 12 },
          cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
          fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.horizontalAlignment",
        },
      },
    ]);
  }
  return { ok: true, sheetName, frozenRowCount: 12, pools: config.pools.map((pool) => pool.key) };
}

export async function ensureViuSheetsTemplate(db) {
  return ensurePoolSheetsTemplate(db, SHEET_CONFIGS.viu, "VIU STOCK POOL");
}

export async function ensureVidioSheetsTemplate(db) {
  return ensurePoolSheetsTemplate(db, SHEET_CONFIGS.vidio, "VIDIO PLATINUM STOCK POOL");
}

export async function ensureCanvaSheetsTemplate(db) {
  if (!googleSheetsConfigured(db)) {
    const error = new Error("Google Sheets belum dikonfigurasi");
    error.status = 400;
    throw error;
  }
  const sheetId = await ensureSheetExists(db, CANVA_SHEET_NAME);
  const pool = canvaPool(db);
  const values = await readSheetValuesByName(db, CANVA_SHEET_NAME).catch(() => []);
  const isBlankRow = (row = []) => !row.some((cell) => normalize(cell));
  const hasCanvaPoolMarker = values.some((row) => (row || []).some((cell) => {
    const text = normalizeLower(cell);
    return text === "canva pool" || (text.includes("pool") && text.includes("canva"));
  }));
  const hasCanvaUsageMarker = values.some((row) => (row || []).some((cell) => {
    const text = normalizeLower(cell);
    return text === "canva usage" || (text.includes("usage") && text.includes("canva"));
  }));
  const poolLocation = findCanvaPoolLocation(values);
  const poolHeader = values[poolLocation.headerIndex] || [];
  const poolData = values[poolLocation.dataIndex] || [];
  const canvaUsageMarkerIndex = values.findIndex((row) => (row || []).some((cell) => {
    const text = normalizeLower(cell);
    return text === "canva usage" || (text.includes("usage") && text.includes("canva"));
  }));
  const usageHeaderIndex = canvaUsageMarkerIndex >= 0 ? canvaUsageMarkerIndex + 1 : 7;
  const usageHeader = values[usageHeaderIndex] || [];
  const writes = [];

  if (!hasCanvaPoolMarker && !normalize(values[0]?.[0])) {
    writes.push({ range: `${quoteSheetName(CANVA_SHEET_NAME)}!A1`, values: [["CANVA POOL"]] });
  }
  if (isBlankRow(poolHeader)) {
    writes.push({ range: `${quoteSheetName(CANVA_SHEET_NAME)}!A${poolLocation.headerIndex + 1}:F${poolLocation.headerIndex + 1}`, values: [CANVA_POOL_HEADERS] });
  }
  if (isBlankRow(poolData)) {
    writes.push({
      range: `${quoteSheetName(CANVA_SHEET_NAME)}!A${poolLocation.dataIndex + 1}:F${poolLocation.dataIndex + 1}`,
      values: [[pool.link || "", pool.quota || 0, "", "", pool.status || "active", pool.notes || ""]],
    });
  }
  if (!hasCanvaUsageMarker && !normalize(values[6]?.[0])) {
    writes.push({ range: `${quoteSheetName(CANVA_SHEET_NAME)}!A7`, values: [["CANVA USAGE"]] });
  }
  if (isBlankRow(usageHeader)) {
    writes.push({ range: `${quoteSheetName(CANVA_SHEET_NAME)}!A${usageHeaderIndex + 1}:H${usageHeaderIndex + 1}`, values: [CANVA_USAGE_HEADERS] });
  }
  if (writes.length) await updateValues(db, writes);
  if (sheetId !== null) {
    await batchUpdate(db, [
      {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 8 } },
          fields: "gridProperties.frozenRowCount",
        },
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 8 },
          cell: { userEnteredFormat: { wrapStrategy: "WRAP" } },
          fields: "userEnteredFormat.wrapStrategy",
        },
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 2, endRowIndex: 4 },
          cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
          fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.horizontalAlignment",
        },
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 6, endRowIndex: 8 },
          cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: "CENTER" } },
          fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.horizontalAlignment",
        },
      },
    ]);
  }
  return { ok: true, sheetName: CANVA_SHEET_NAME, frozenRowCount: 8 };
}

export async function ensureGoogleSheetsTemplate(db) {
  const netflix = await ensureNetflixSheetsTemplate(db);
  const viu = await ensureViuSheetsTemplate(db);
  const vidio = await ensureVidioSheetsTemplate(db);
  const canva = await ensureCanvaSheetsTemplate(db);
  const orderHistory = await ensureOrderHistorySheet(db);
  return { ok: true, netflix, viu, vidio, canva, orderHistory };
}
