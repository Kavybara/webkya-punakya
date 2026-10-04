import { formatRentalEndDate, rentalInviteLink } from "../../../../packages/shared/rental-expiry.mjs";

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

/*
 * Two lines that answer the question every one of these messages exists to
 * answer: when does this stop, and where do I go?
 *
 * `newEndsAt` outranks the rental's own `endsAt` because after an adjustment
 * the rental on the payload is the record as it was *before* the change -- the
 * notification would otherwise announce the date the rental just left.
 */
function rentalEndLines(rental = {}, newEndsAt = "") {
  const endsAt = String(newEndsAt || "").trim();
  const endText = formatRentalEndDate(endsAt ? { ...rental, endsAt } : rental);
  return endText ? [`Berakhir : ${endText}`] : [];
}

function rentalLinkLines(rental = {}) {
  const link = rentalInviteLink(rental);
  return link ? [`Link Grub : ${link}`] : [];
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

export function rentalChangedNotificationText({ db = {}, rental = {}, action = "", addedDays = 0, previousDays = 0, totalDays = 0, newEndsAt = "" } = {}) {
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
    ...rentalEndLines(rental, newEndsAt),
    ...rentalLinkLines(rental),
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
    ...rentalEndLines(rental),
    ...rentalLinkLines(rental),
    "",
    "Untuk Mengecek status sewa ketik .ceksewa pada grub tersebut",
  ]);
}

export function rentalExpiredNotificationText(db = {}, rental = {}) {
  /*
   * No `Link Grub` line here, unlike every other rental notification. Once a
   * rental ends the invite link is not information -- it is a way in, and the
   * person receiving this has just lost the right to use it. Sending it would
   * invite someone into a group they are no longer paying for.
   */
  return joinBotMessageLines([
    "Notifikasi Sewa Bot Expired",
    "",
    `Name Grub : ${rentalDisplayName(rental)}`,
    `Nomor Owner : ${rentalOwnerContactNumber(db, rental) || "-"}`,
    "Expired : 0 hari",
    ...rentalEndLines(rental),
    "",
    "Bot tidak akan merespons command di grup sampai sewa diperpanjang.",
    "List grup tetap disimpan sementara dan baru dibersihkan otomatis setelah 30 hari expired.",
  ]);
}
