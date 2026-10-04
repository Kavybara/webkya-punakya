/**
 * Turns the bot's recorded backup outcome into something the owner can act on.
 *
 * The Health Center's existing backup card counts files in `runtime/backups`.
 * That answers "what exists on this machine", which is not the question the
 * owner has. They want to know whether a copy of their money reached them --
 * and a file sitting on the same VPS that is about to die with it is not a
 * backup in any sense they care about.
 *
 * The gap this closes is real and was silent. `runScheduledBackup` returns
 * before building an archive when WhatsApp is disconnected or while heavy work
 * is paused, so a machine with thirty recent files can still have delivered
 * nothing for a week. The reason for the skip lived in a variable inside the bot
 * process, and when that process is the thing that broke, there was nothing left
 * to ask. The bot now records each outcome into `kavya-db.json`; this reads it.
 *
 * Two deliberate choices:
 *
 * - Absent state is `never_run`, not "fine". A database written before this
 *   existed has no state, and defaulting that to healthy is precisely how weeks
 *   of silence pass unnoticed.
 * - Delivery is judged separately from execution. A run that happened but was
 *   skipped leaves `sentAt` old, and the owner has no copy even though the
 *   scheduler looks busy.
 */

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Grace is deliberate: the interval is when the timer fires, so a run is late by
// up to that much before it is late at all. One extra interval of slack on top
// avoids flagging the ordinary case where a run is merely in progress.
const GRACE_MULTIPLIER = 1;

/**
 * The scheduled backup interval, read from the same environment variables the
 * bot reads (`apps/bot/config.js`). Both processes share one `.env`, so this is
 * the actual schedule rather than a guess -- judging staleness against a
 * hardcoded 24 hours while the bot was reconfigured to 6 would either cry wolf
 * every night or sleep through a genuinely missed backup.
 *
 * Mirrors the bot's precedence: an explicit millisecond value wins over the
 * hours form, and an unparseable value falls back to the daily default.
 */
export function backupIntervalMs(env = process.env) {
  const hours = Number(env.AUTO_BACKUP_INTERVAL_HOURS);
  const millis = Number(env.AUTO_BACKUP_INTERVAL_MS);
  if (Number.isFinite(millis) && millis > 0) return millis;
  if (Number.isFinite(hours) && hours > 0) return hours * 60 * 60 * 1000;
  return DEFAULT_INTERVAL_MS;
}

function parseTimestamp(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  // `nowText()` in the store writes `YYYY-MM-DD HH:MM` in server-local time.
  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hoursBetween(from, to) {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / (60 * 60 * 1000)));
}

export function assessBackupHealth({ backupState = null, intervalMs = DEFAULT_INTERVAL_MS, now = new Date() } = {}) {
  const interval = Number(intervalMs) > 0 ? Number(intervalMs) : DEFAULT_INTERVAL_MS;
  const deadlineMs = interval * (1 + GRACE_MULTIPLIER);
  const state = backupState && typeof backupState === "object" ? backupState : null;

  const base = {
    status: "never_run",
    stale: false,
    neverSent: false,
    severity: "warning",
    ranAt: "",
    sentAt: "",
    fileName: "",
    ageHours: null,
    sinceLastSentHours: null,
    message: "",
  };

  if (!state || !state.status) {
    return {
      ...base,
      ok: false,
      severity: "warning",
      status: "never_run",
      message:
        "Belum pernah ada catatan backup otomatis. Proses bot WhatsApp mungkin belum pernah menjalankan jadwal backup, atau versi bot yang lebih baru belum ter-deploy.",
    };
  }

  const status = String(state.status || "unknown");
  const ranAt = String(state.ranAt || "");
  const sentAt = String(state.sentAt || "");
  const error = String(state.error || "");
  const reason = String(state.reason || "");

  const ranDate = parseTimestamp(ranAt);
  const sentDate = parseTimestamp(sentAt);
  const ageHours = ranDate ? hoursBetween(ranDate, now) : null;
  const sinceLastSentHours = sentDate ? hoursBetween(sentDate, now) : null;

  const shared = { status, severity: "none", stale: false, neverSent: false, ranAt, sentAt, fileName: String(state.fileName || ""), ageHours, sinceLastSentHours };
  const stale = ageHours !== null && ranDate.getTime() < now.getTime() - deadlineMs;

  if (status === "disabled") {
    return {
      ...shared,
      ok: false,
      severity: "warning",
      status: "disabled",
      message: "Backup otomatis dimatikan. Tidak ada yang mengirim file backup ke owner sampai diaktifkan lagi.",
    };
  }

  if (status === "failed") {
    return {
      ...shared,
      ok: false,
      severity: "error",
      stale,
      status: "failed",
      message: `Backup otomatis gagal.${error ? ` Alasan: ${error}.` : ""} Periksa log proses bot WhatsApp.`,
    };
  }

  if (status === "skipped") {
    return {
      ...shared,
      ok: false,
      severity: "warning",
      stale,
      status: "skipped",
      message:
        "Backup otomatis dilewati, jadi tidak ada file yang dikirim." +
        (reason || error ? ` Alasan: ${reason || error}.` : "") +
        " Proses bot WhatsApp biasanya jadi penyebabnya. Cek status koneksi WhatsApp.",
    };
  }

  if (status === "created") {
    // The archive exists on the VPS but the owner never received it. Same disk,
    // same failure mode -- this is not a backup from the owner's point of view.
    return {
      ...shared,
      ok: false,
      severity: "error",
      neverSent: true,
      stale,
      status: "created",
      message:
        "Backup dibuat tapi tidak terkirim ke owner." +
        (reason || error ? ` Alasan: ${reason || error}.` : "") +
        " File ada di VPS yang sama, jadi belum aman kalau server ini hilang.",
    };
  }

  if (status === "sent") {
    const sentTooLongAgo = sinceLastSentHours !== null && sentDate.getTime() < now.getTime() - deadlineMs;
    const deliveryMissing = !sentDate;
    if (stale) {
      return {
        ...shared,
        ok: false,
        severity: "warning",
        stale: true,
        status: "sent",
        message: `Backup terakhir sudah terlalu lama (${ageHours} jam lalu, jadwalnya tiap ${Math.round(interval / 3600000)} jam). Proses bot kemungkinan berhenti.`,
      };
    }
    if (deliveryMissing || sentTooLongAgo) {
      return {
        ...shared,
        ok: false,
        severity: "warning",
        neverSent: true,
        stale: sentTooLongAgo,
        status: "sent",
        message: deliveryMissing
          ? "Backup tercatat terkirim, tapi tidak ada catatan waktu pengiriman. Jalankan backup manual untuk memastikan owner punya salinan."
          : `Backup terakhir yang benar-benar terkirim sudah ${sinceLastSentHours} jam lalu. Jalankan backup manual untuk memastikan owner punya salinan terbaru.`,
      };
    }
    return { ...shared, ok: true, severity: "none", stale: false, neverSent: false, status: "sent", message: "" };
  }

  // A status we do not recognise. Not an error, but not something to call
  // healthy either -- the point of this feature is that silence is visible.
  return {
    ...shared,
    ok: false,
    severity: "warning",
    status,
    message: `Status backup tidak dikenal: "${status}". Periksa versi proses bot WhatsApp.`,
  };
}