/**
 * Telling an empty database apart from a lost one.
 *
 * `store.js` answers a missing `kavya-db.json` with `clone(defaultData)` --
 * products and prices come back, and `resellers` is `[]`. The owner logs in
 * to a site that looks completely healthy and finds an empty reseller table.
 * Nothing logs an error, because nothing failed: the file was never restored.
 *
 * The owner cannot be asked to tell these apart by looking at the page, so the
 * server has to. It can, because not every table is empty after a loss:
 *
 *   - `stock` and `managedAccounts` are rebuilt by the Google Sheets sync, so
 *     they prove nothing either way.
 *   - `orders` and `payments` exist ONLY in `kavya-db.json`. Sheets does not
 *     hold them and no sync rebuilds them.
 *
 * So "orders exist but no resellers" is not a state this system can reach by
 * normal use -- every order records the reseller that placed it
 * (`resellerId`). It is a contradiction, and that is what makes it a safe thing
 * to raise an alarm about. Counting orders would be a guess; this is not.
 *
 * A genuinely fresh install has no orders either, so it stays silent.
 */
export function detectDatabaseLoss(db = {}) {
  const resellers = Array.isArray(db.resellers) ? db.resellers : [];
  const orders = Array.isArray(db.orders) ? db.orders : [];
  const payments = Array.isArray(db.payments) ? db.payments : [];

  if (resellers.length > 0) {
    return { lost: false, reason: "resellers_present", resellerCount: resellers.length };
  }

  // Orders that name a reseller which is not in the list are the loudest
  // signal: the database is not merely empty, it is internally inconsistent.
  const orphanedOrders = orders.filter((order) => {
    const resellerId = String(order?.resellerId || "").trim();
    return Boolean(resellerId);
  });

  if (orphanedOrders.length > 0) {
    return {
      lost: true,
      reason: "orders_reference_missing_resellers",
      resellerCount: 0,
      orderCount: orders.length,
      orphanedOrderCount: orphanedOrders.length,
      paymentCount: payments.length,
    };
  }

  // No orders to contradict it, but money is still recorded. Payments are as
  // durable as orders and equally absent from Sheets.
  if (payments.length > 0) {
    return {
      lost: true,
      reason: "payments_without_resellers",
      resellerCount: 0,
      orderCount: orders.length,
      orphanedOrderCount: 0,
      paymentCount: payments.length,
    };
  }

  // Nothing survived that could prove a loss. A fresh install lands here, and
  // so does a database whose owner simply has no reseller yet -- both are
  // legitimately empty, and inventing an alarm for them would train the owner
  // to ignore the real one.
  return { lost: false, reason: "no_evidence_of_loss", resellerCount: 0, orderCount: orders.length, paymentCount: payments.length };
}

/**
 * The owner-facing sentence for a detected loss.
 *
 * Kept next to the detector so the wording cannot drift from the condition
 * that triggers it, and so a test can assert the two stay attached.
 *
 * `docs/RESTORE.md` claims the reseller list rebuilds itself from Sheets. It
 * does not: `syncDataResellersToGoogleSheets` reads `db.resellers` and writes
 * outward. Telling the owner to click that button would be sending them in a
 * circle, so the message points at the only path that actually works.
 */
export function databaseLossMessage(assessment = {}) {
  if (!assessment.lost) return "";
  const orphanNote = assessment.orphanedOrderCount
    ? ` ${assessment.orphanedOrderCount} order di database ini menunjuk reseller yang sudah tidak ada.`
    : "";
  return `Database reseller kosong, padahal ada data order dan pembayaran yang tidak ada di Google Sheets.${orphanNote} `
    + "Data ini tidak akan kembali sendiri. Pulihkan kavya-db.json dari file backup (lihat docs/RESTORE.md), lalu jalankan ulang sinkron Sheets. "
    + "Jangan buat akun reseller baru dulu: itu akan menimpa data lama kalau file backup ternyata masih ada.";
}
