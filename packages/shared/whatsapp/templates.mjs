export const LIST_TEMPLATE_PLACEHOLDERS = [
  "@name",
  "@date",
  "@day",
  "@group",
  "@greeting",
  "@size",
  "@time",
  "@x",
  "@list",
  "{name}",
  "{date}",
  "{day}",
  "{group}",
  "{greeting}",
  "{size}",
  "{time}",
  "{items}",
  "{list}",
  "{total}",
];

export const LIST_TEMPLATES = {
  default: {
    name: "Kavya Clean",
    text: [
      "*╭──「 LIST MENU 」*",
      "*│* @greeting kak",
      "*│* Grup: @group",
      "*│* Total: @size keyword",
      "*╰────────────*",
      "",
      "@list",
      "",
      "_Ketik salah satu keyword di atas untuk lihat detail._",
    ].join("\n"),
  },
  compact: {
    name: "Kavya Simple",
    text: [
      "*LIST MENU*",
      "@greeting kak, ini daftar keyword yang tersedia:",
      "",
      "@list",
      "",
      "_Ketik keyword persis seperti yang tertulis ya._",
    ].join("\n"),
  },
  boxed: {
    name: "Kavya Box",
    text: [
      "*╭──「 DAFTAR LIST 」*",
      "*│* Tanggal: @date",
      "*│* Jam: @time",
      "*│* Grup: @group",
      "*╰────────────*",
      "",
      "@list",
      "",
      "*Total:* @size keyword",
    ].join("\n"),
  },
};

export const WHATSAPP_STRINGS = {
  ownerOnly: "Command ini khusus owner.",
  groupOnly: "Command ini hanya aktif di grup.",
  commandIgnoredInPrivate: "Command grup tidak dibalas di private chat.",
  stockEmpty: "Stok ready sedang kosong. Coba cek lagi nanti atau hubungi owner ya.",
  listEmpty:
    "_Belum ada list di grup ini._\n\nAdmin bisa tambah dengan:\n*.addlist keyword | isi list*",
  listOwnerOnly: "Command list ini khusus owner.",
  listSaved: "{keyword} sudah disimpan ke list grup.",
  listDeleted: "{keyword} sudah dihapus dari list grup ini.",
  listReset: "Semua list grup ini sudah direset.",
  listRenamed: "{from} diganti menjadi {to}.",
  listTemplateUpdated: "Template .list grup ini sudah diperbarui.",
  listTemplateInvalid: "Template wajib punya placeholder @list, {items}, atau @x. Opsional: @group, @size, @date, @time.",
  addListFormat: "Format salah.\n\nPakai:\n.{command} keyword | isi list",
  renameListFormat: "Format salah.\n\nPakai:\n.renamelist keyword_lama | keyword_baru",
  deleteListFormat: "Format salah.\n\nPakai:\n.dellist keyword",
  setListFormat:
    "Format salah.\n\nPakai:\n.setlist template\n\nPlaceholder utama: @list, {items}, atau @x. Opsional: @group, @size, @date, @time.",
  buyNowFormat:
    "Format order belum lengkap.\n\nPakai:\n#buynow KODE QTY DURASI\n\nContoh:\n#buynow 1p1u 1 2\n\nKetik #stock kalau mau lihat katalog ready dulu.",
  buyNowUnavailable: "Kode {code} belum ready atau tidak ditemukan.\n\nKetik #stock untuk lihat pilihan yang tersedia.",
  buyNowInsufficient:
    "Stok {code} tinggal {ready}. Order maksimal {ready}, atau ketik #stock untuk lihat pilihan lain.",
  qrisMissing:
    "QRIS belum siap ditampilkan. Owner bisa cek pembayaran ini dari dashboard.",
};

export const WEB_DASHBOARD_COPY = {
  validation: {
    pakasirProjectRequired: "Project Pakasir wajib diisi sebelum QRIS bisa dibuat.",
    pakasirApiKeyRequired: "API key Pakasir wajib diisi sebelum QRIS bisa dibuat.",
    rentalLinkRequired: "Link grup WhatsApp wajib diisi.",
    rentalDaysRequired: "Jumlah hari sewa wajib lebih dari 0.",
    productNameRequired: "Nama produk wajib diisi.",
    variantProductRequired: "Pilih produk induk dulu.",
    variantNameRequired: "Nama varian wajib diisi.",
    variantCodeRequired: "Kode varian wajib diisi. Kode ini yang dipakai user di #buynow.",
    variantPriceRequired: "Harga varian wajib lebih dari 0.",
    stockVariantRequired: "Pilih varian yang mau ditambahkan stoknya.",
    stockCodesRequired: "Isi stok wajib diisi. Minimal satu kode akun/barang.",
  },
  feedback: {
    publicStoreCopied: "Link public store berhasil disalin.",
    pakasirSaved: "Setting Pakasir berhasil disimpan.",
    rentalCreated: "Sewa grup berhasil dibuat.",
    rentalExtended: "Sewa grup berhasil ditambahkan.",
    rentalDeleted: "Sewa grup dihapus.",
    productCreated: "Produk berhasil dibuat.",
    productUpdated: "Produk berhasil diperbarui.",
    productDeleted: "Produk berhasil dihapus.",
    variantCreated: "Varian berhasil dibuat.",
    variantUpdated: "Varian berhasil diperbarui.",
    variantDeleted: "Varian berhasil dihapus.",
    stockDeleted: "Stok berhasil dihapus.",
    stockAdded: "Stok berhasil ditambahkan: {inserted}/{attempted}. Skip: {skipped}.",
  },
  helper: {
    pakasirProject: "Project ID dari Pakasir. Wajib supaya bot bisa membuat QRIS.",
    pakasirApiKey: "API key disimpan di sini dan dipakai untuk buat/cek/cancel QRIS.",
    rentalMode: "Tambah sewa menjaga sisa hari aktif. Contoh sisa 30 + tambah 5 menjadi 35 hari.",
    productName: "Nama ini tampil di website dan pesan WhatsApp.",
    variantCode: "Kode ini harus mudah diketik user, misalnya NF_1P1U_30D.",
    stockCodes: "Tempel satu stok per baris, atau pisahkan blok multi-line dengan satu baris kosong.",
  },
};

export const GROUP_MENU_CATEGORIES = [
  {
    key: "store",
    title: "STORE / LIST",
    lines: [
      ".list - lihat keyword list di grup ini",
      "keyword - kirim isi list sesuai keyword grup",
      ".addlist keyword | isi list - tambah list, owner saja",
      ".updatelist keyword | isi list - update list, owner saja",
      ".renamelist keyword_lama | keyword_baru - rename list, owner saja",
      ".dellist keyword - hapus list, owner saja",
      ".resetlist - reset semua list grup, owner saja",
      ".setlist template - ubah template .list grup, owner saja",
    ],
  },
  {
    key: "sewa",
    title: "SEWA",
    lines: [
      ".ceksewa - cek sisa masa sewa grup ini",
      ".sewabot link_grup hari - tambah grup sewa, owner saja",
      ".tambahsewa link_grup hari - perpanjang dari sisa hari aktif, owner saja",
      ".listsewa - daftar semua sewa, owner saja",
      ".delsewa group_jid - hapus sewa, owner saja",
    ],
  },
  {
    key: "owner",
    title: "OWNER",
    lines: [
      ".backup - buat backup runtime dan kirim ke owner",
      ".addlist / .updatelist / .setlist - kelola list per grup",
    ],
  },
  {
    key: "order",
    title: "AUTO ORDER NOTE",
    lines: [
      "#stock untuk lihat katalog ready di private chat",
      "#buynow KODE QTY DURASI untuk buat invoice QRIS",
      "#balance untuk cek saldo buyer",
      "refresh / cek / status untuk cek invoice terakhir",
      "track ORD-... atau track PAY-... untuk tracking",
      "Command order tidak dibalas di grup.",
    ],
  },
];

export function formatRupiah(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export function formatNumber(value) {
  return new Intl.NumberFormat("id-ID").format(Number(value || 0));
}

function truncateText(value = "", max = 220) {
  const source = String(value || "").trim();
  if (source.length <= max) {
    return source;
  }
  return `${source.slice(0, Math.max(0, max - 3)).trim()}...`;
}

export function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatRentalRemaining(rental) {
  if (!rental) {
    return "tidak aktif";
  }
  const days = Number(rental.remaining_days || 0);
  if (days <= 0) {
    return "expired";
  }
  return `${days} hari`;
}

export function renderText(template = "", values = {}) {
  let output = String(template || "");
  for (const [key, value] of Object.entries(values)) {
    output = output
      .replaceAll(`@${key}`, String(value ?? ""))
      .replaceAll(`{${key}}`, String(value ?? ""));
  }
  return output;
}

export function renderString(key, values = {}) {
  return renderText(WHATSAPP_STRINGS[key] || key, values);
}

export function getDefaultListTemplate() {
  return LIST_TEMPLATES.default.text;
}

export function isValidListTemplate(template = "") {
  const source = String(template || "");
  return source.includes("@list") || source.includes("{items}") || source.includes("{list}") || source.includes("@x");
}

function normalizeListEntries(entries = []) {
  if (Array.isArray(entries)) {
    return entries
      .map((entry) => ({
        keyword: String(entry.keyword || "").trim(),
        text: String(entry.text || "").trim(),
        media_path: String(entry.media_path || entry.mediaPath || "").trim(),
      }))
      .filter((entry) => entry.keyword);
  }

  return Object.entries(entries || {})
    .map(([keyword, entry]) => ({
      keyword: String(keyword || "").trim(),
      text: String(entry?.text || "").trim(),
      media_path: String(entry?.media_path || entry?.mediaPath || "").trim(),
    }))
    .filter((entry) => entry.keyword);
}

export function renderGroupList({ groupJid = "", groupName = "", entries = [], template = "" } = {}) {
  const normalized = normalizeListEntries(entries).sort((a, b) => a.keyword.localeCompare(b.keyword));
  if (!normalized.length) {
    return WHATSAPP_STRINGS.listEmpty;
  }

  const list = normalized.map((entry) => `*•* \`${entry.keyword.toUpperCase()}\``).join("\n");
  const now = new Date();
  const groupLabel = String(groupName || "").trim() || "grup ini";
  const sourceTemplate = renderLegacyListMarker(template || getDefaultListTemplate(), normalized);
  return renderText(sourceTemplate, {
    name: groupLabel,
    group: groupLabel,
    greeting: getGreeting(now),
    date: now.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium" }),
    day: now.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", weekday: "long" }),
    time: now.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }),
    size: normalized.length,
    total: normalized.length,
    list,
    items: list,
  }).trim();
}

function renderLegacyListMarker(template = "", entries = []) {
  const source = String(template || "");
  if (!source.includes("@x")) {
    return source;
  }

  return source
    .split("\n")
    .map((line) => {
      if (!line.includes("@x")) {
        return line;
      }
      const prefix = line.replace("@x", "").trim();
      return entries
        .map((entry) => `${prefix ? `${prefix} ` : ""}${entry.keyword.toUpperCase()}`.trim())
        .join("\n");
    })
    .join("\n");
}

export function buildGroupMenu(categoryKey = "") {
  const key = String(categoryKey || "").trim().toLowerCase();
  const category = GROUP_MENU_CATEGORIES.find((item) => item.key === key);
  if (!category) {
    return [
      "MENU GRUP",
      "",
      "Kategori:",
      ...GROUP_MENU_CATEGORIES.map((item) => `.menu ${item.key} - ${item.title.toLowerCase()}`),
      ".allmenu - tampilkan semua command aktif",
      "",
      "Menu ini hanya aktif di grup.",
    ].join("\n");
  }

  return [`MENU ${category.title}`, "", ...category.lines].join("\n");
}

export function buildAllGroupMenu() {
  const lines = ["ALL MENU GRUP", ""];
  for (const category of GROUP_MENU_CATEGORIES) {
    lines.push(`[${category.title}]`, ...category.lines, "");
  }
  return lines.join("\n").trim();
}

export function buildStockMessage(products = []) {
  const lines = [
    "*╭────〔 KAVYA ORDER BOT 〕─*",
    "*┊・* Katalog ready hari ini",
    "*┊・* Order: #buynow KODE QTY DURASI",
    "*┊・* Contoh: #buynow 1p1u 1 2",
    "*┊・* Cek saldo: #balance",
    "*┊・* Cek order: refresh / status",
    "*┊・* Track: track ORD-... / PAY-...",
    "*╰┈┈┈┈┈┈┈┈*",
  ];
  const topSellerByProduct = new Map();

  for (const product of products) {
    for (const variant of product.variants || []) {
      const soldCount = Number(variant.sold_count || 0);
      const currentTop = topSellerByProduct.get(product.id) || 0;
      if (soldCount > currentTop) {
        topSellerByProduct.set(product.id, soldCount);
      }
    }
  }

  for (const product of products) {
    for (const variant of product.variants || []) {
      const ready = Number(variant.available_stock || 0);
      if (ready <= 0) {
        continue;
      }

      const sold = Number(variant.sold_count || 0);
      const totalStock = ready + sold;
      const badge =
        sold > 0 && sold === Number(topSellerByProduct.get(product.id) || 0)
          ? " `BEST SELLER`🔥"
          : "";

      lines.push(
        "",
        `*╭────〔 ${String(`${product.name} ${variant.name}`).trim().toUpperCase()}${badge} 〕─*`,
        `*┊・Harga:* ${formatRupiah(variant.price)}`,
        variant.duration_label ? `*┊・Durasi:* ${variant.duration_label}` : "",
        `*┊・Stok Tersedia:* ${formatNumber(ready)}`,
        `*┊・Stok Terjual:* ${formatNumber(sold)}`,
        `*┊・Total Stok:* ${formatNumber(totalStock)}`,
        `*┊・Kode:* ${String(variant.code || "").trim().toUpperCase()}`,
        `*┊・Desk:* *${truncateText(variant.description || product.description || "Deskripsi belum diisi.", 220)}*`,
        `*┊・Beli:* #buynow ${String(variant.code || "").trim().toUpperCase()} 1`,
        "*╰┈┈┈┈┈┈┈┈*",
      );
    }
  }

  if (lines.length === 8) {
    return WHATSAPP_STRINGS.stockEmpty;
  }

  return lines.filter(Boolean).join("\n").trim();
}

export function buildOrderQrisMessage({ order, product, variant, quantity, total, payment } = {}) {
  const productName = String(
    `${product?.name || order?.product_name || ""} ${variant?.name || order?.variant_name || ""}`,
  ).trim();
  const subtotal = Number(order?.total_price || total || payment?.amount || 0);
  const balanceUsed = Number(order?.balance_used || 0);
  const fee = Number(payment?.fee || 0);
  const totalPayment = Number(payment?.total_payment || Math.max(0, subtotal - balanceUsed + fee));

  return [
    "╭────〔 INVOICE QRIS 〕─",
    `┊・Order ID : ${order?.order_code || "-"}`,
    `┊・Pay Code : ${payment?.payment_code || "-"}`,
    `┊・Nama Produk : ${productName.toUpperCase() || "-"}`,
    `┊・Jumlah Beli : ${quantity || order?.quantity || 1}`,
    `┊・Subtotal : ${formatRupiah(subtotal)}`,
    balanceUsed > 0
      ? `┊・Balance Terpakai : ${formatRupiah(balanceUsed)}`
      : "",
    `┊・Fee : ${formatRupiah(fee)}`,
    `┊・Total Bayar : ${formatRupiah(totalPayment)}`,
    `┊・Metode Bayar : ${(payment?.payment_method || "QRIS").toUpperCase()} auto`,
    payment?.expired_at ? `┊・Batas Bayar : ${formatDateTime(payment.expired_at)}` : "",
    "╰┈┈┈┈┈┈┈┈",
    "",
    "Scan QRIS pada gambar ini.",
    "Bayar sesuai total dalam 3 menit agar otomatis terverifikasi.",
    "Akun akan dikirim otomatis setelah pembayaran sukses.",
  ].filter(Boolean).join("\n");
}

export function buildOrderMissingQrisMessage({ order, product, variant, quantity, total, payment } = {}) {
  return [
    "Order berhasil dibuat, tapi QRIS belum tampil.",
    "",
    `Order: ${order?.order_code || "-"}`,
    `${product?.name || ""} - ${variant?.name || ""}`,
    `Qty: ${quantity}`,
    `Total: ${formatRupiah(total)}`,
    "",
    WHATSAPP_STRINGS.qrisMissing,
    `Pay code: ${payment?.payment_code || "-"}`,
    "Ketik refresh untuk cek ulang invoice terakhir.",
  ].join("\n");
}

function getGreeting(date) {
  const hour = Number(
    new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      hour12: false,
    }).format(date),
  );

  if (hour < 11) {
    return "Selamat pagi";
  }
  if (hour < 15) {
    return "Selamat siang";
  }
  if (hour < 18) {
    return "Selamat sore";
  }
  return "Selamat malam";
}
