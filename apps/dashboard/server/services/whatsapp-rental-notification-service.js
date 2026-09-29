function normalizeWhatsappNumber(value = "") {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

function ownerProfileWhatsapp(db = {}) {
  return db.ownerProfile?.whatsapp || db.owner?.whatsapp || "";
}

export function rentalOwnerContactNumber(db = {}, rental = {}) {
  return normalizeWhatsappNumber(
    rental.contact ||
      rental.ownerNumber ||
      rental.ownerWhatsapp ||
      rental.ownerWhatsAppNumber ||
      rental.owner ||
      db.settings?.ownerWhatsAppNumber ||
      ownerProfileWhatsapp(db) ||
      process.env.OWNER_WHATSAPP_NUMBER ||
      process.env.BACKUP_OWNER_NUMBER ||
      "",
  );
}

export function rentalDisplayName(rental = {}) {
  return String(rental.name || rental.groupName || rental.groupJid || rental.id || "Grup WhatsApp").trim();
}

export function formatRentalDays(value) {
  const days = Number(value || 0);
  return `${Number.isFinite(days) ? Math.max(0, Math.trunc(days)) : 0} hari`;
}

function joinBotMessageLines(lines = []) {
  return lines
    .map((line) => String(line ?? "").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function rentalDeltaDays({ addedDays, previousDays, totalDays } = {}) {
  const directDelta = Number(addedDays || 0);
  if (Number.isFinite(directDelta) && directDelta !== 0) return Math.trunc(directDelta);

  const before = Number(previousDays || 0);
  const after = Number(totalDays || 0);
  if (Number.isFinite(before) && Number.isFinite(after) && before !== after) return Math.trunc(after - before);
  return 0;
}

function changeTitle(action = "", delta = 0) {
  const normalized = String(action || "").trim().toLowerCase();
  if (normalized === "reduced" || normalized === "subtract" || normalized === "decreased" || delta < 0) {
    return "Bot Sewa Berkurang";
  }
  return "Bot Sewa Bertambah";
}

export function rentalChangedNotificationText({ db = {}, rental = {}, action = "", addedDays = 0, previousDays = 0, totalDays = 0 } = {}) {
  const delta = rentalDeltaDays({ addedDays, previousDays, totalDays });
  const changeLabel = delta < 0 ? "Pengurangan Hari" : "Penambahan Hari";
  const remainingDays = Number(totalDays || rental.daysLeft || 0);
  return joinBotMessageLines([
    changeTitle(action, delta),
    "",
    `Name Grub : ${rentalDisplayName(rental)}`,
    `Nomor Owner : ${rentalOwnerContactNumber(db, rental) || "-"}`,
    delta ? `${changeLabel} : ${formatRentalDays(Math.abs(delta))}` : "",
    `Expired : ${formatRentalDays(remainingDays)}`,
    "",
    "Untuk Mengecek status sewa ketik .ceksewa pada grub tersebut",
  ]);
}

export function rentalJoinedNotificationText(payload = {}) {
  return rentalChangedNotificationText({ ...payload, action: "added" });
}

export function rentalExpiringNotificationText(db = {}, rental = {}, daysLeft = 0) {
  return joinBotMessageLines([
    "Sewa Bot Hampir Berakhir",
    "",
    `Name Grub : ${rentalDisplayName(rental)}`,
    `Nomor Owner : ${rentalOwnerContactNumber(db, rental) || "-"}`,
    `Waktu Tersisa : ${formatRentalDays(daysLeft)}`,
    "",
    "Untuk Mengecek status sewa ketik .ceksewa pada grub tersebut",
  ]);
}

export function rentalExpiredNotificationText(db = {}, rental = {}) {
  return joinBotMessageLines([
    "Notifikasi Sewa Bot Expired",
    "",
    `Name Grub : ${rentalDisplayName(rental)}`,
    `Nomor Owner : ${rentalOwnerContactNumber(db, rental) || "-"}`,
    "Expired : 0 hari",
    "",
    "Bot tidak akan merespons command di grup sampai sewa diperpanjang.",
    "List grup tetap disimpan sementara dan baru dibersihkan otomatis setelah 30 hari expired.",
  ]);
}
