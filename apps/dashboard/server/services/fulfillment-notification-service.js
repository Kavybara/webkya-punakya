import { isSheetBackedRecord } from "./sheet-sync-status-service.js";

export function createFulfillmentNotificationService(deps) {
  const {
    activeResellerByWhatsapp,
    deleteWhatsAppMessage,
    formatRupiah,
    fulfillPaidOrder,
    getProduct,
    isSmokeTestOrder,
    joinBotMessageLines,
    makeId,
    nowText,
    pushFulfilledOrderToGoogleSheets,
    resellerDepositPaidMessage,
    sendWhatsAppMessage,
    syncGoogleSheetsStockSafely,
    syncSheetsForProductOrThrow,
  } = deps;

  async function preflightReservedSheetStock(db, orderId) {
    const order = (db.orders || []).find((item) => item.id === orderId || item.paymentRef === orderId);
    if (!order || order.fulfillmentText || (order.deliveredStockIds || []).length) return { ok: true, skipped: true };
    const intendedStockIds = new Set(
      (order.reservedStockIds || []).map((stockId) => String(stockId || "").trim()).filter(Boolean),
    );
    const reserved = (db.stock || []).filter((stock) => (
      (stock.reservedFor === order.id || intendedStockIds.has(String(stock.id || "").trim()))
      && isSheetBackedRecord(stock)
    ));
    if (!reserved.length) return { ok: true, skipped: true };

    const reservedIds = reserved.map((stock) => stock.id);
    try {
      const product = getProduct?.(db, order.productId);
      if (product && syncSheetsForProductOrThrow) {
        // The full sync can report unrelated failures (for example a duplicate
        // reseller alias). Product-scoped sync throws only when this order's
        // own stock source cannot be verified.
        await syncSheetsForProductOrThrow(db, product, "paid_order_stock_preflight", { force: true });
      } else {
        const synced = await syncGoogleSheetsStockSafely(db, {
          silent: true,
          force: true,
          reason: "paid_order_stock_preflight",
        });
        if (!synced?.ok) {
          throw new Error(synced?.error || synced?.reason || "google_sheets_preflight_failed");
        }
      }
    } catch (error) {
      order.orderStatus = "processing";
      order.deliveryStatus = "stock_recheck_failed";
      order.fulfillmentBlockedReason = error?.message || "google_sheets_preflight_failed";
      order.stockPreflightFailedAt = nowText();
      return { ok: false, order, reply: "", reason: order.fulfillmentBlockedReason };
    }

    const stillReserved = new Set((db.stock || [])
      .filter((stock) => stock.status === "reserved" && stock.reservedFor === order.id)
      .map((stock) => stock.id));
    const conflicts = reservedIds.filter((stockId) => !stillReserved.has(stockId));
    if (conflicts.length) {
      order.holdOnStockUnavailable = true;
      order.stockConflictDetectedAt = nowText();
      order.stockConflictStockIds = conflicts;
      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "order",
        title: `Konflik stok order ${order.id}`,
        description: `${conflicts.length} reservasi berubah di Google Sheets sebelum fulfillment. Sistem hanya boleh memakai fallback yang masih aman.`,
        createdAt: nowText(),
        orderId: order.id,
      });
    }
    return { ok: true, order, conflicts };
  }

  async function fulfillPaidOrderAndNotify(db, orderId) {
    const preflight = await preflightReservedSheetStock(db, orderId);
    if (!preflight.ok) return preflight;
    const result = fulfillPaidOrder(db, orderId);
    if (!result?.ok || !result.order || !result.reply) return result;
    if (result.order.googleSheetsSyncStatus !== "synced") {
      await pushFulfilledOrderToGoogleSheets(db, result);
    }
    const sheetCommitRequired = (result.order.deliveredStockIds || []).some((stockId) => {
      const stock = (db.stock || []).find((item) => item.id === stockId);
      return isSheetBackedRecord(stock || {});
    });
    if (sheetCommitRequired && result.order.googleSheetsSyncStatus !== "synced") {
      result.order.orderStatus = "processing";
      result.order.deliveryStatus = "sheet_sync_failed";
      result.order.fulfillmentBlockedReason = result.order.googleSheetsSyncError || "google_sheets_sync_failed";
      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "order",
        title: `Order ${result.order.id} tertahan saat commit Sheets`,
        description: `Akun belum boleh dianggap terkirim karena assignment Google Sheets gagal: ${result.order.fulfillmentBlockedReason}.`,
        createdAt: nowText(),
        orderId: result.order.id,
      });
      return {
        ...result,
        reply: "",
        delivery: { sent: false, skipped: true, reason: "google_sheets_sync_failed" },
      };
    }
    if (isSmokeTestOrder(result.order)) {
      result.order.whatsappNotificationStatus = "skipped";
      result.order.whatsappNotificationError = "";
      result.order.whatsappNotificationSentAt = "";
      result.order.whatsappNotificationAttemptedAt = nowText();
      result.order.whatsappNotificationAttemptCount = Number(result.order.whatsappNotificationAttemptCount || 0) + 1;
      return { ...result, delivery: { sent: false, skipped: true, reason: "smoke_test" } };
    }
    if (result.order.whatsappNotificationStatus === "sent") {
      return { ...result, delivery: { sent: true, skipped: true } };
    }
    result.order.whatsappNotificationAttemptedAt = nowText();
    result.order.whatsappNotificationAttemptCount = Number(result.order.whatsappNotificationAttemptCount || 0) + 1;

    if (result.order.source === "whatsapp") {
      const paymentChatJid = String(result.order.whatsappPaymentMessageChatJid || "").trim();
      const deleteTarget = paymentChatJid || result.order.whatsapp;
      const notifyTarget =
        (result.order.type === "deposit_topup" || result.order.orderType === "deposit_topup") && paymentChatJid
          ? paymentChatJid
          : result.order.whatsapp;
      const deletePayment = result.order.whatsappPaymentMessageKey
        ? await deleteWhatsAppMessage(db, {
            to: deleteTarget,
            messageKey: result.order.whatsappPaymentMessageKey,
          })
        : { deleted: false, skipped: true, reason: "payment_message_key_not_recorded" };
      const accountDelivery = await sendWhatsAppMessage(db, {
        to: notifyTarget,
        text: result.reply,
      });
      const snkDelivery = result.snkText
        ? await sendWhatsAppMessage(db, {
            to: result.order.whatsapp,
            text: result.snkText,
          })
        : { sent: false, skipped: true, reason: "snk_empty" };
      result.delivery = { account: accountDelivery, snk: snkDelivery, deletePayment };
      result.order.whatsappPaymentDeleteStatus = deletePayment.deleted ? "deleted" : deletePayment.skipped ? "skipped" : "failed";
      if (!deletePayment.deleted && !deletePayment.skipped) {
        result.order.whatsappPaymentDeleteError = deletePayment.reason || "whatsapp_delete_failed";
      }
      result.order.whatsappNotificationStatus = accountDelivery.sent ? "sent" : "failed";
      result.order.whatsappSnkNotificationStatus = snkDelivery.sent ? "sent" : snkDelivery.skipped ? "skipped" : "failed";
      if (accountDelivery.sent) {
        result.order.whatsappNotificationSentAt = nowText();
        result.order.whatsappNotificationError = "";
      } else {
        result.order.whatsappNotificationError = accountDelivery.reason || "whatsapp_send_failed";
      }
      if (snkDelivery.sent) {
        result.order.whatsappSnkNotificationSentAt = nowText();
      } else if (!snkDelivery.skipped) {
        result.order.whatsappSnkNotificationError = snkDelivery.reason || "whatsapp_snk_send_failed";
      }
      return result;
    }

    const deliveryText =
      result.order.deliveryStatus === "stock_unavailable_deposit"
        ? result.reply
        : (result.order.type === "deposit_topup" || result.order.orderType === "deposit_topup")
          ? resellerDepositPaidMessage(
              (db.resellers || []).find((item) => item.id === result.order.resellerId) || activeResellerByWhatsapp(db, result.order.whatsapp) || {},
              result.order,
              (db.payments || []).find((item) => item.orderId === result.order.id || item.ref === result.order.paymentRef) || {},
            )
        : joinBotMessageLines([
            "Pembayaran berhasil ✧⁠*⁠。",
            "",
            "Periksa detail akun dan SnK di halaman selesai website Kavya.",
            "",
            ` Order ID : ${result.order.id}`,
            ` Produk   : ${result.order.product} ${result.order.variant}`,
            ` Total    : ${formatRupiah(result.order.total)}`,
            "",
            "๑ Jika terdapat kendala, owner bisa cek menggunakan Order ID di dashboard. ๑",
            "",
            "Terimakasih ෆ⁠╹⁠ .̮ ⁠╹⁠ෆ",
          ]);
    const delivery = await sendWhatsAppMessage(db, {
      to: result.order.whatsapp,
      text: deliveryText,
    });
    result.delivery = delivery;
    result.order.whatsappNotificationStatus = delivery.sent ? "sent" : "failed";
    if (delivery.sent) {
      result.order.whatsappNotificationSentAt = nowText();
      result.order.whatsappNotificationError = "";
    } else {
      result.order.whatsappNotificationError = delivery.reason || "whatsapp_send_failed";
    }
    return result;
  }


  return { fulfillPaidOrderAndNotify };
}
