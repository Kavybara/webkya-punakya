export function createPaymentReconciliationService(deps) {
  const {
    activeResellerByWhatsapp,
    dateTimeText,
    derivePakasirTotalPayment,
    fetchPakasirTransactionDetail,
    formatRupiah,
    fulfillPaidOrderAndNotify,
    makeId,
    normalizeWhatsappNumber,
    nowText,
    toDateTime,
  } = deps;

  function pakasirStatusIsPaid(status = "") {
    const text = String(status || "").toLowerCase();
    return ["paid", "success", "settlement", "settled", "completed", "complete", "berhasil", "sukses"].some((word) => text.includes(word));
  }

  function paymentPaidAmount(payment = {}, order = {}) {
    return Math.max(
      0,
      derivePakasirTotalPayment(payment.amount || order.paymentDue || 0, payment.fee || order.paymentFee || 0, payment.totalPayment || 0),
      Number(payment.amount || 0),
      Number(order.paymentDue || 0),
    );
  }

  function terminalPaymentState(order = {}, payment = {}) {
    const orderStatus = String(order.orderStatus || "").toLowerCase();
    const deliveryStatus = String(order.deliveryStatus || "").toLowerCase();
    const paymentStatus = String(payment.status || order.qrisStatus || "").toLowerCase();
    if (deliveryStatus === "sent" || ["completed", "fulfilled", "refunded"].includes(orderStatus)) return "fulfilled";
    if (["refunded", "failed", "failed_permanent"].includes(paymentStatus)) return paymentStatus;
    if (["failed", "failed_permanent"].includes(orderStatus)) return orderStatus;
    if (["cancelled", "expired"].includes(orderStatus) || ["cancelled", "expired"].includes(paymentStatus)) return "expired";
    return "";
  }

  function paymentCheckBackoffMs(attempts = 1) {
    const steps = [15_000, 30_000, 60_000, 120_000, 300_000, 600_000];
    return steps[Math.min(steps.length - 1, Math.max(0, Number(attempts || 1) - 1))];
  }

  function recordPaymentCheck(payment, order, detail, checkedAt) {
    const attempts = Number(payment.paymentCheckAttempts || 0) + 1;
    const providerStatus = String(detail?.status || detail?.transaction?.status || (detail?.paid ? "paid" : "pending")).toLowerCase();
    const nextCheckAt = detail?.paid ? "" : new Date(Date.now() + paymentCheckBackoffMs(attempts)).toISOString();
    payment.providerLastCheckedAt = checkedAt;
    payment.lastPaymentCheckAt = checkedAt;
    payment.paymentCheckAttempts = attempts;
    payment.paymentProviderStatus = providerStatus || "unknown";
    payment.nextPaymentCheckAt = nextCheckAt;
    payment.lastPaymentCheckError = detail?.ok === false ? "payment_provider_check_failed" : "";
    order.lastPaymentCheckAt = checkedAt;
    order.paymentCheckAttempts = attempts;
    order.paymentProviderStatus = providerStatus || order.paymentProviderStatus || "unknown";
    order.nextPaymentCheckAt = nextCheckAt;
    order.lastPaymentCheckError = payment.lastPaymentCheckError;
  }

  async function reconcilePakasirPaymentInDb(db, ref, options = {}) {
    const payment = (db.payments || []).find((item) => item.ref === ref || item.orderId === ref);
    const order = (db.orders || []).find((item) => item.paymentRef === ref || item.id === ref || item.id === payment?.orderId);
    if (!payment || !order) return { ok: false, skipped: true, reason: "payment_or_order_missing" };
    if (payment.provider !== "pakasir") return { ok: true, skipped: true, reason: "not_pakasir", order, payment };
    const terminalState = terminalPaymentState(order, payment);
    if (terminalState === "fulfilled") {
      return { ok: true, skipped: true, reason: "already_fulfilled", order, payment };
    }
    if (terminalState && !options.allowLatePaymentRecovery) {
      return { ok: true, skipped: true, reason: `terminal_${terminalState}`, order, payment };
    }

    const status = String(payment.status || order.qrisStatus || "").toLowerCase();
    const shouldCheck = ["pending", "expired", "created", "waiting_payment", ""].includes(status)
      || ["pending", "expired", "created", "waiting_payment", "cancelled"].includes(String(order.qrisStatus || "").toLowerCase())
      || ["cancelled"].includes(String(order.orderStatus || "").toLowerCase());
    if (!shouldCheck) return { ok: true, skipped: true, reason: "status_not_checkable", order, payment };

    const lastChecked = toDateTime(payment.providerLastCheckedAt);
    const throttleMs = Number(options.throttleMs || 0);
    if (throttleMs > 0 && lastChecked && Date.now() - lastChecked.getTime() < throttleMs) {
      return { ok: true, skipped: true, reason: "throttled", order, payment };
    }

    const checkedAt = nowText();
    let detail;
    try {
      detail = await fetchPakasirTransactionDetail(db, order, payment);
    } catch {
      detail = {
        ok: false,
        paid: false,
        status: "provider_error",
        payload: null,
        transaction: null,
      };
    }
    recordPaymentCheck(payment, order, detail, checkedAt);
    payment.providerDetailStatus = detail.status || "";
    payment.providerDetailError = detail.ok ? "" : "payment_provider_check_failed";
    if (detail.payload) payment.providerDetailRaw = detail.payload;
    if (detail.transaction?.totalPayment) payment.totalPayment = detail.transaction.totalPayment;
    if (detail.transaction?.fee) payment.fee = detail.transaction.fee;
    if (detail.transaction?.paymentMethod) payment.paymentMethod = detail.transaction.paymentMethod;

    if (!detail.paid) {
      return {
        ok: detail.ok,
        checked: true,
        paid: false,
        detail: { ok: detail.ok, paid: false, status: detail.status || "", reason: detail.ok ? "" : "payment_provider_check_failed" },
        order,
        payment,
      };
    }

    payment.status = "paid";
    payment.paidAt = payment.paidAt || (detail.paidAt ? dateTimeText(toDateTime(detail.paidAt) || new Date()) : checkedAt);
    order.paidAt = order.paidAt || payment.paidAt;
    order.paymentProviderStatus = "paid";
    order.paymentProviderCheckedAt = checkedAt;
    payment.nextPaymentCheckAt = "";
    payment.lastPaymentCheckError = "";
    order.nextPaymentCheckAt = "";
    order.lastPaymentCheckError = "";

    const prepared = preparePaidOrderForFulfillment(db, order, payment);
    if (prepared.reply && prepared.order.deliveryStatus === "late_paid_deposit") return prepared;
    return fulfillPaidOrderAndNotify(db, order.id);
  }

  function creditLatePaidQrisToDeposit(db, order, payment, amount) {
    const reseller = (db.resellers || []).find((item) => item.id === order.resellerId) || activeResellerByWhatsapp(db, order.whatsapp);
    if (!reseller || !amount || order.latePaidDepositCredited) {
      return { ok: true, order, reply: order.fulfillmentText || "Pembayaran terlambat sudah tercatat." };
    }

    const creditedAt = nowText();
    const depositBefore = Math.max(0, Number(reseller.deposit || 0));
    const depositAfter = depositBefore + amount;
    reseller.deposit = depositAfter;
    order.qrisStatus = "paid";
    order.orderStatus = "cancelled";
    order.deliveryStatus = "late_paid_deposit";
    order.latePaidDepositCredited = true;
    order.latePaidDepositCreditedAt = creditedAt;
    order.latePaidDepositAmount = amount;
    order.fulfillmentText = `Pembayaran ${formatRupiah(amount)} diterima setelah order expired. Nominal masuk ke saldo reseller. Saldo sekarang ${formatRupiah(depositAfter)}.`;
    payment.status = "paid";
    payment.paidAt = payment.paidAt || creditedAt;
    payment.latePaidDepositCredited = true;
    payment.latePaidDepositAmount = amount;
    payment.depositBefore = depositBefore;
    payment.depositAfter = depositAfter;

    db.activities = db.activities || [];
    db.activities.unshift({
      id: makeId("act"),
      type: "order",
      title: `Pembayaran ${order.paymentRef || order.id} terlambat`,
      description: `${formatRupiah(amount)} diterima setelah order expired dan dikreditkan ke deposit ${reseller.name || reseller.username || order.whatsapp}.`,
      createdAt: creditedAt,
      orderId: order.id,
      resellerId: reseller.id || order.resellerId || "",
      whatsapp: normalizeWhatsappNumber(order.whatsapp || reseller.whatsapp || ""),
    });

    return { ok: true, order, reply: order.fulfillmentText };
  }

  function preparePaidOrderForFulfillment(db, order, payment) {
    const paidAt = nowText();
    const wasExpired = order.qrisStatus === "expired" || order.orderStatus === "cancelled";
    const amount = paymentPaidAmount(payment, order);
    payment.status = "paid";
    payment.paidAt = payment.paidAt || paidAt;
    order.paidAt = order.paidAt || paidAt;

    if (wasExpired && Number(order.depositUsed || 0) > 0 && order.depositRefunded && amount < Number(order.total || 0)) {
      return creditLatePaidQrisToDeposit(db, order, payment, amount);
    }

    if (wasExpired) {
      order.latePaymentRecovered = true;
      order.latePaymentRecoveredAt = paidAt;
      order.previousExpiredStatus = order.previousExpiredStatus || `${order.qrisStatus || ""}/${order.orderStatus || ""}`;
      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "order",
        title: `Pembayaran ${order.paymentRef || order.id} diterima setelah expired`,
        description: `${order.product} ${order.variant} tetap diproses karena pembayaran Pakasir sudah paid.`,
        createdAt: paidAt,
        orderId: order.id,
        resellerId: order.resellerId || "",
        whatsapp: normalizeWhatsappNumber(order.whatsapp || ""),
      });
    }

    order.qrisStatus = "paid";
    order.orderStatus = order.deliveryStatus === "sent" ? "completed" : "processing";
    if (order.deliveryStatus === "waiting_payment") order.deliveryStatus = wasExpired ? "paid_after_expired" : "paid";
    return { ok: true, order };
  }

  function prepareManualApprovedOrderForFulfillment(db, order, payment, options = {}) {
    const approvedAt = nowText();
    const actor = String(options.actor || "owner").trim() || "owner";
    const reason = String(options.reason || "").trim() || "manual approval";
    payment.status = "manual";
    payment.paidAt = payment.paidAt || approvedAt;
    payment.providerStatus = "owner_approved";
    payment.providerWebhookStatus = "owner_approved";
    payment.manualApproved = true;
    payment.manualApprovedAt = approvedAt;
    payment.manualApprovedBy = actor;
    payment.manualApprovalReason = reason;
    order.paidAt = order.paidAt || approvedAt;
    order.qrisStatus = "manual";
    order.orderStatus = order.deliveryStatus === "sent" ? "completed" : "processing";
    if (order.deliveryStatus === "waiting_payment" || order.deliveryStatus === "paid_after_expired") {
      order.deliveryStatus = "manual_approved";
    }
    order.paymentMethod = order.paymentMethod || "Owner manual approval";
    order.manualApproved = true;
    order.manualApprovedAt = approvedAt;
    order.manualApprovedBy = actor;
    order.manualApprovalReason = reason;
    db.activities = db.activities || [];
    db.activities.unshift({
      id: makeId("act"),
      type: "order",
      title: `Order ${order.id} di-approve manual`,
      description: `${actor} melanjutkan order tanpa pembayaran QRIS otomatis. Alasan: ${reason}.`,
      createdAt: approvedAt,
      orderId: order.id,
      resellerId: order.resellerId || "",
      whatsapp: normalizeWhatsappNumber(order.whatsapp || ""),
    });
    return { ok: true, order };
  }


  return {
    pakasirStatusIsPaid,
    prepareManualApprovedOrderForFulfillment,
    preparePaidOrderForFulfillment,
    reconcilePakasirPaymentInDb,
  };
}
