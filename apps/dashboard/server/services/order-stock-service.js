import { stockStatusAfterReservationRelease } from "../google-sheets/account-condition.js";

export function createOrderStockService(deps) {
  const {
    isCanvaProduct,
    isLinkPoolProduct,
    isTerminalManagedAccountStatus,
    isVariantOrderable,
    linkPoolAvailableCount,
    linkPoolsForVariant,
    nowText,
    stockForVariant,
    syncGoogleSheetsStockSafely,
    syncSheetsForProductOrThrow,
  } = deps;

  function availableStockCount(db, product, variant) {
    let availableCount = 0;
    if (product && variant && isVariantOrderable(product, variant)) {
      if (isLinkPoolProduct(db, product, variant)) {
        availableCount = linkPoolsForVariant(db, product, variant)
          .reduce((total, pool) => total + linkPoolAvailableCount(db, pool), 0);
        if (availableCount <= 0 && isCanvaProduct(product)) {
          availableCount = stockForVariant(db, product, variant, "available").length;
        }
      } else {
        availableCount = stockForVariant(db, product, variant, "available").length;
      }
    }
    return availableCount;
  }

  function availableStockOrThrow(db, product, variant, qty = 1) {
    const availableCount = availableStockCount(db, product, variant);
    if (availableCount < qty) {
      const error = new Error(`Stok ${product?.name || "produk"} ${variant?.name || ""} tidak cukup. Tersedia ${availableCount}, diminta ${qty}.`);
      error.status = 409;
      throw error;
    }
    return availableCount;
  }

  function clearReservedStockState(stock) {
    stock.status = stockStatusAfterReservationRelease(stock);
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

  async function ensureWebOrderStock(db, order, product, variant, qty = 1) {
    const requestedQty = Math.max(1, Number(qty || 1));
    const linkPoolOrder = isLinkPoolProduct(db, product, variant);
    await syncSheetsForProductOrThrow(db, product, "web_order_stock_authority", { force: true });
    async function retryAfterSync() {
      await syncGoogleSheetsStockSafely(db, { silent: true, reason: "web_order_stock_recheck", force: true });
    }

    if (linkPoolOrder) {
      let availableCount = availableStockCount(db, product, variant);
      if (availableCount < requestedQty) {
        try {
          await retryAfterSync();
          availableCount = availableStockCount(db, product, variant);
        } catch {}
      }
      if (availableCount < requestedQty) {
        const error = new Error(`Stok ${product?.name || "produk"} ${variant?.name || ""} tidak cukup. Tersedia ${availableCount}, diminta ${requestedQty}.`);
        error.status = 409;
        throw error;
      }
      return [];
    }

    let reservedStocks = reserveAvailableStocksForOrder(db, order, product, variant, requestedQty);
    if (reservedStocks.length < requestedQty) {
      try {
        await retryAfterSync();
        reservedStocks = reserveAvailableStocksForOrder(db, order, product, variant, requestedQty);
      } catch {}
    }
    if (reservedStocks.length < requestedQty) {
      const error = new Error(`Stok ${product?.name || "produk"} ${variant?.name || ""} tidak cukup. Tersedia ${reservedStocks.length}, diminta ${requestedQty}.`);
      error.status = 409;
      throw error;
    }
    return reservedStocks;
  }

  return {
    availableStockCount,
    availableStockOrThrow,
    clearReservedStockState,
    ensureWebOrderStock,
    reserveAvailableStocksForOrder,
  };
}
