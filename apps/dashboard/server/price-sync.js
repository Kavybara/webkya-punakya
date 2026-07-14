import fs from "node:fs/promises";
import path from "node:path";

const SOURCE_PRIORITY = ["daisuiky", "daisuki", "reseller ecca store", "ecca", "ress iky", "iky"];
const SOURCE_SECTION_PREFIX = "KAVYA_SOURCE:";
const PRODUCT_PRICE_PATTERN = /(netflix|canva|wetv|iqiyi|vidio|viu|disney|youtube|spotify|hbo|prime|capcut|picsart|vpn|chatgpt|adobe|bstation|loklok|dramabox|reelshort|ibis|lightroom|vsco|youku)/i;

function normalize(value = "") {
  return String(value || "").trim();
}

function normalizeLower(value = "") {
  return normalize(value).toLowerCase();
}

function compact(value = "") {
  return normalizeLower(value).replace(/[^a-z0-9]+/g, "");
}

function readEntryText(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  if (typeof entry.text === "string") return entry.text;
  if (typeof entry.content?.text === "string") return entry.content.text;
  return "";
}

async function readJsonIfExists(filePath, fallback = {}) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function candidateRoots(rootDir) {
  return [...new Set([rootDir, path.resolve(rootDir, ".."), process.cwd()].map((item) => path.resolve(item)))];
}

async function readLegacyLists(rootDir) {
  const candidates = candidateRoots(rootDir).flatMap((baseDir) => [
    path.join(baseDir, "apps", "bot", "database", "lists.json"),
    path.join(baseDir, "apps", "dashboard", "runtime", "whatsapp-database", "lists.json"),
    path.join(baseDir, "database", "list.json"),
  ]);
  const merged = [];
  for (const filePath of candidates) {
    const data = await readJsonIfExists(filePath, {});
    for (const [groupJid, group] of Object.entries(data || {})) {
      const list = group?.list || group || {};
      for (const [keyword, entry] of Object.entries(list || {})) {
        const text = readEntryText(entry);
        if (!text) continue;
        merged.push({ filePath, groupJid, keyword, text });
      }
    }
  }
  return merged;
}

async function readLegacyRentals(rootDir) {
  const candidates = candidateRoots(rootDir).flatMap((baseDir) => [
    path.join(baseDir, "apps", "bot", "database", "rentals.json"),
    path.join(baseDir, "apps", "dashboard", "runtime", "whatsapp-database", "rentals.json"),
    path.join(baseDir, "database", "sewa.json"),
    path.join(baseDir, "database", "rentals.json"),
  ]);
  const merged = [];
  for (const filePath of candidates) {
    const data = await readJsonIfExists(filePath, {});
    for (const [groupJid, rental] of Object.entries(data || {})) {
      merged.push({ filePath, groupJid, rental: rental || {} });
    }
  }
  return merged;
}

function cleanInviteLink(value = "") {
  return String(value || "").trim().replace(/\?mode=[^ ]+/gi, "");
}

function looksLikePriceLine(line = "") {
  const source = normalizeLower(line);
  if (!/\d/.test(source)) return false;
  const hasDuration = /(\d+\s*(hari|day|days|bulan|month|months|tahun|year|years|minggu|week|weeks)\b|\d+\s*[bdh]\b|lifetime)/i.test(source);
  const hasPrice = /(?:[:=|\-]|\u2013|\u2014|\u2192|\u21d2|\u27a1|\u2794|\u27d1)\s*(?:rp\s*)?[0-9][0-9.,]*\s*[kp]?|(?:rp\s*)?[0-9][0-9.,]*\s*[kp]?\s*$/i.test(source);
  return hasDuration && hasPrice;
}

function looksLikeProductPriceList(row) {
  const haystack = `${row.keyword || ""}\n${row.text || ""}`;
  if (!PRODUCT_PRICE_PATTERN.test(haystack)) return false;
  return String(row.text || "").split(/\r?\n/).some(looksLikePriceLine);
}

function sourceScore(row) {
  const key = normalizeLower(row.keyword);
  const text = normalizeLower(row.text);
  let score = 0;
  SOURCE_PRIORITY.forEach((needle, index) => {
    if (key.includes(needle)) score += 100 - index * 10;
    if (text.includes(needle)) score += 40 - index * 5;
  });
  if (text.includes("pricelist") && text.includes("ress")) score += 20;
  if (text.includes("canva") && text.includes("netflix")) score += 10;
  if (looksLikeProductPriceList(row)) score += 8;
  return score;
}

function buildSourceFromRows(rows, fallbackKeyword = "whatsapp price group") {
  const pricedRows = rows.filter(looksLikeProductPriceList);
  const sourceRows = pricedRows.length ? pricedRows : rows;
  const entries = sourceRows
    .map((row) => ({ ...row, score: sourceScore(row) }))
    .filter((row) => row.score > 0 || looksLikeProductPriceList(row))
    .sort((a, b) => b.score - a.score || String(a.keyword).localeCompare(String(b.keyword)));

  if (!entries.length) return null;
  const primary = entries[0];
  return {
    filePath: primary.filePath,
    groupJid: primary.groupJid,
    keyword: primary.keyword || fallbackKeyword,
    score: entries.reduce((sum, entry) => sum + Number(entry.score || 0), 0),
    entryCount: entries.length,
    text: entries.map((entry) => `${SOURCE_SECTION_PREFIX} ${entry.keyword}\n${entry.text}`).join("\n\n"),
  };
}

function nameTokens(value = "") {
  const ignored = new Set(["reseller", "resseller", "ress", "open", "close", "closed", "group", "grup", "wa", "whatsapp", "bot", "sewa", "store", "official"]);
  return normalizeLower(value)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !ignored.has(token));
}

function findSourceByGroupName(rows, groupName = "") {
  const tokens = nameTokens(groupName);
  if (!tokens.length) return null;

  const rowsByGroup = new Map();
  for (const row of rows) {
    const current = rowsByGroup.get(row.groupJid) || [];
    current.push(row);
    rowsByGroup.set(row.groupJid, current);
  }

  const grouped = new Map();
  for (const row of rows) {
    const haystack = normalizeLower(`${row.keyword}\n${row.text}`);
    const matches = tokens.filter((token) => haystack.includes(token));
    if (!matches.length) continue;
    const current = grouped.get(row.groupJid) || { groupJid: row.groupJid, score: 0 };
    current.score += matches.length * 100 + sourceScore(row);
    grouped.set(row.groupJid, current);
  }

  const best = [...grouped.values()]
    .map((group) => ({ ...group, source: buildSourceFromRows(rowsByGroup.get(group.groupJid) || [], groupName) }))
    .filter((group) => group.source)
    .sort((a, b) => b.score - a.score)[0];
  return best?.source || null;
}

export async function findWaPriceSource(rootDir, options = {}) {
  const [rows, rentals] = await Promise.all([readLegacyLists(rootDir), readLegacyRentals(rootDir)]);
  const groupJid = String(options.groupJid || "").trim();
  if (groupJid) {
    const exactSource = buildSourceFromRows(rows.filter((row) => row.groupJid === groupJid), groupJid);
    if (exactSource) return exactSource;
    const linkGrub = cleanInviteLink(options.linkGrub || options.link || "");
    if (linkGrub) {
      const matchedRental = rentals.find((row) => cleanInviteLink(row.rental?.linkGrub || row.rental?.link || "") === linkGrub);
      if (matchedRental) {
        const linkedSource = buildSourceFromRows(rows.filter((row) => row.groupJid === matchedRental.groupJid), matchedRental.groupJid);
        if (linkedSource) return linkedSource;
      }
    }
    return findSourceByGroupName(rows, options.groupName || options.fallbackName || "");
  }

  const best = rows
    .map((row) => ({ ...row, score: sourceScore(row) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)[0];
  if (!best) return null;
  return buildSourceFromRows(rows.filter((row) => row.groupJid === best.groupJid), best.keyword);
}

function moneyToNumber(raw = "") {
  const source = normalizeLower(raw);
  if (!source) return 0;
  const hasK = /k\b/.test(source);
  const cleaned = source.replace(/rp/gi, "").replace(/,/g, ".").replace(/[^\d.]/g, "");
  if (!cleaned) return 0;
  const amount = hasK
    ? Number(cleaned.replace(/\.(?=\d{3}\b)/g, "")) * 1000
    : Number(cleaned.replace(/\./g, ""));
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.round(amount));
}

function linePrice(line = "") {
  const source = normalize(line);
  const ress = source.match(/\/\s*ress(?:eller)?\s*([0-9][0-9.,]*\s*[kp]?)/i);
  if (ress) return moneyToNumber(ress[1]);
  const explicit = source.match(/(?:[:=|\-]|\u2013|\u2014|\u2192|\u21d2|\u27a1|\u2794|\u27d1)\s*(?:rp\s*)?([0-9][0-9.,]*\s*[kp]?)/i);
  if (explicit) return moneyToNumber(explicit[1]);
  const fallback = source.match(/(?:rp\s*)?([0-9][0-9.,]*\s*[kp]?)\s*$/i);
  return fallback ? moneyToNumber(fallback[1]) : 0;
}

function durationLabel(line = "") {
  const source = normalizeLower(line);
  const short = source.match(/(\d+)\s*([bdh])\b/i);
  if (short) {
    const amount = Number(short[1]);
    return short[2].toLowerCase() === "b" ? `${amount} Bulan` : `${amount} Hari`;
  }
  const match = source.match(/(\d+)\s*(hari|day|days|bulan|month|months|tahun|year|years|minggu|week|weeks)/i);
  if (!match) {
    if (source.includes("lifetime")) return "Lifetime";
    return "";
  }
  const amount = Number(match[1]);
  const unit = match[2];
  if (/hari|day/.test(unit)) return `${amount} Hari`;
  if (/minggu|week/.test(unit)) return `${amount * 7} Hari`;
  if (/tahun|year/.test(unit)) return `${amount} Tahun`;
  return `${amount} Bulan`;
}

function extractSections(text = "") {
  const sections = [];
  const lines = String(text || "").split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const marker = line.match(new RegExp(`^${SOURCE_SECTION_PREFIX}\\s*(.+)$`, "i"));
    if (marker) {
      if (current) sections.push(current);
      current = { title: normalize(marker[1]), lines: [] };
      continue;
    }

    const quotedTitle = line.match(/[\u275d"\u201c]\s*([^\u275e"\u201d]+?)\s*[\u275e"\u201d]/u);
    if (quotedTitle) {
      if (current) sections.push(current);
      current = { title: normalize(quotedTitle[1]), lines: [] };
      continue;
    }

    if (current) current.lines.push(line);
  }
  if (current) sections.push(current);
  return sections;
}

function parseSectionRows(section) {
  const rows = [];
  let context = "";
  for (const rawLine of section.lines || []) {
    const line = normalize(String(rawLine || "").replace(/[`*_>]/g, " "));
    if (!line || /^[-=.\s]+$/.test(line)) continue;
    const price = linePrice(line);
    const duration = durationLabel(line);
    if (price && duration) {
      rows.push({
        section: section.title,
        context,
        label: normalize(`${context} ${line}`),
        duration,
        price,
        raw: rawLine,
      });
      continue;
    }
    if (!price && line.length <= 100 && !/note|ress\s*=|pricelist|format|order/i.test(line)) {
      context = line;
    }
  }
  return rows;
}

function productAliases(product = {}) {
  const base = [product.name, product.category, product.code].filter(Boolean);
  const aliases = new Set(base.map(compact));
  if (aliases.has("youtubepremium") || aliases.has("yt")) aliases.add("youtube");
  if (aliases.has("wetvvip")) aliases.add("wetv");
  if (aliases.has("iqiyipremium")) aliases.add("iqiyi");
  if (aliases.has("picsartgold")) aliases.add("picsart");
  if (aliases.has("netflixpremium") || aliases.has("net")) aliases.add("netflix");
  if (aliases.has("canvapro")) aliases.add("canva");
  return aliases;
}

function variantTokens(variant = {}) {
  const source = [variant.name, variant.code, variant.id].map(normalizeLower).join(" ");
  const tokens = new Set();
  if (/1p?1u|1u/.test(source)) tokens.add("1p1u");
  if (/1p?2u|2p?1u|2u/.test(source)) tokens.add("1p2u");
  if (/semi/.test(source)) tokens.add("semi");
  if (/private|priv/.test(source)) tokens.add("private");
  if (/member/.test(source)) tokens.add("member");
  if (/fam/.test(source)) tokens.add("famplan");
  if (/ind/.test(source)) tokens.add("indplan");
  if (/premium|prem/.test(source)) tokens.add("premium");
  if (/sharing|share|shared|shar/.test(source)) tokens.add("share");
  if (/standard|standar/.test(source)) tokens.add("standar");
  if (/designer|design/.test(source)) tokens.add("designer");
  return tokens;
}

function rowScoreForVariant(product, variant, row) {
  const text = compact(`${row.context} ${row.label}`);
  const title = compact(row.section);
  const aliases = [...productAliases(product)];
  const productScore = aliases.some((alias) => title === alias || title.includes(alias) || alias.includes(title)) ? 50 : 0;
  if (!productScore) return 0;
  let score = productScore;
  for (const token of variantTokens(variant)) {
    if (token === "1p1u" && /(1p1u|1p1|1u)/.test(text)) score += 30;
    if (token === "1p2u" && /(1p2u|1p2|2p1u|2u)/.test(text)) score += 30;
    if (token === "semi" && /semi/.test(text)) score += 35;
    if (token === "private" && /priv/.test(text)) score += 25;
    if (token === "member" && /member/.test(text)) score += 30;
    if (token === "famplan" && /fam/.test(text)) score += 30;
    if (token === "indplan" && /ind/.test(text)) score += 30;
    if (token === "premium" && /premium|prem/.test(text)) score += 20;
    if (token === "standar" && /standar|standard/.test(text)) score += 20;
    if (token === "designer" && /designer|design/.test(text)) score += 20;
    if (token === "share" && /share|shar|sharing/.test(text)) score += 12;
  }
  if (/private|priv/.test(text) && !variantTokens(variant).has("private")) score -= 20;
  if (/semi/.test(text) && !variantTokens(variant).has("semi")) score -= 15;
  if (/designer|design/.test(text) && !variantTokens(variant).has("designer")) score -= 10;
  return score;
}

function normalizedDurationKey(value = "") {
  return normalizeLower(value).replace(/\s+/g, " ");
}

function isMonthlyDuration(value = "") {
  return /\bbulan\b|\bmonth/.test(normalizedDurationKey(value));
}

function isDailyDuration(value = "") {
  return /\bhari\b|\bday|\bminggu\b|\bweek/.test(normalizedDurationKey(value));
}

function dailyPriceCleanups(db) {
  const cleanups = [];
  for (const product of db.products || []) {
    for (const variant of product.variants || []) {
      for (const [duration, price] of Object.entries(variant.prices || {})) {
        if (!isDailyDuration(duration)) continue;
        cleanups.push({
          productId: product.id,
          productName: product.name,
          variantId: variant.id,
          variantName: variant.name,
          duration,
          oldPrice: Number(price || 0),
          newPrice: 0,
          action: "delete",
          source: "cleanup harga harian",
          raw: duration,
        });
      }
    }
  }
  return cleanups;
}

function bestRowFor(product, variant, duration, rows) {
  const wantedDuration = normalizedDurationKey(duration);
  return rows
    .filter((row) => normalizedDurationKey(row.duration) === wantedDuration)
    .map((row) => ({ ...row, score: rowScoreForVariant(product, variant, row) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.price - b.price)[0] || null;
}

export function previewWaPriceSync(db, sourceText) {
  const sections = extractSections(sourceText);
  const rows = sections.flatMap(parseSectionRows).filter((row) => isMonthlyDuration(row.duration));
  const changes = [];
  const cleanup = dailyPriceCleanups(db);
  const skipped = [];

  for (const product of db.products || []) {
    for (const variant of product.variants || []) {
      const currentPrices = variant.prices || {};
      const durations = new Set([...Object.keys(currentPrices), ...rows.map((row) => row.duration)]);
      const nextPrices = { ...currentPrices };
      let variantChanged = false;
      for (const duration of durations) {
        const row = bestRowFor(product, variant, duration, rows);
        if (!row) continue;
        const oldPrice = Number(currentPrices[duration] || 0);
        if (oldPrice === row.price) continue;
        nextPrices[duration] = row.price;
        variantChanged = true;
        changes.push({
          productId: product.id,
          productName: product.name,
          variantId: variant.id,
          variantName: variant.name,
          duration,
          oldPrice,
          newPrice: row.price,
          source: `${row.section} / ${row.context || "-"}`,
          raw: row.raw,
        });
      }
      if (!variantChanged && !Object.keys(currentPrices).some((duration) => bestRowFor(product, variant, duration, rows))) {
        skipped.push({ productId: product.id, productName: product.name, variantId: variant.id, variantName: variant.name });
      }
    }
  }

  return { changes, cleanup, skipped, parsedRows: rows.length };
}

export function applyWaPriceSync(db, preview) {
  let updated = 0;
  for (const change of preview.changes || []) {
    const product = (db.products || []).find((item) => item.id === change.productId);
    const variant = product?.variants?.find((item) => item.id === change.variantId);
    if (!variant) continue;
    variant.prices = { ...(variant.prices || {}), [change.duration]: Number(change.newPrice || 0) };
    updated += 1;
  }
  for (const cleanup of preview.cleanup || []) {
    const product = (db.products || []).find((item) => item.id === cleanup.productId);
    const variant = product?.variants?.find((item) => item.id === cleanup.variantId);
    if (!variant?.prices || !(cleanup.duration in variant.prices)) continue;
    delete variant.prices[cleanup.duration];
    updated += 1;
  }
  return updated;
}
