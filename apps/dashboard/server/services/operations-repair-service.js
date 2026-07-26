const ALLOWED_ACTIONS = new Set(["reseller_repair"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function scopeFromInput(input = {}) {
  return {
    accountId: String(input.accountId || "").trim(),
    orderId: String(input.orderId || "").trim(),
    resellerId: String(input.resellerId || "").trim(),
  };
}

function safeState(db = {}, scope = {}) {
  const related = (item = {}) => (
    (!scope.accountId && !scope.orderId && !scope.resellerId)
    || (scope.accountId && String(item.id || item.accountId || "") === scope.accountId)
    || (scope.orderId && String(item.id || item.orderId || item.sourceOrderId || "") === scope.orderId)
    || (scope.resellerId && String(item.resellerId || "") === scope.resellerId)
  );
  return {
    accounts: (db.managedAccounts || []).filter(related).map((item) => ({
      id: item.id || "",
      orderId: item.orderId || item.sourceOrderId || "",
      stockId: item.stockId || "",
      resellerId: item.resellerId || "",
      status: item.status || "",
      hidden: Boolean(item.hidden),
    })),
    orders: (db.orders || []).filter(related).map((item) => ({
      id: item.id || "",
      resellerId: item.resellerId || "",
      orderStatus: item.orderStatus || "",
      deliveryStatus: item.deliveryStatus || "",
      deliveredStockIds: [...(item.deliveredStockIds || [])],
    })),
    stock: (db.stock || []).filter(related).map((item) => ({
      id: item.id || "",
      status: item.status || "",
      reservedFor: item.reservedFor || "",
      soldOrderId: item.soldOrderId || "",
      managedAccountId: item.managedAccountId || "",
    })),
  };
}

function diffCount(before = {}, after = {}) {
  const beforeRows = JSON.stringify(before);
  const afterRows = JSON.stringify(after);
  if (beforeRows === afterRows) return 0;
  return ["accounts", "orders", "stock"].reduce((total, key) => {
    const previous = new Map((before[key] || []).map((item) => [item.id, JSON.stringify(item)]));
    const next = new Map((after[key] || []).map((item) => [item.id, JSON.stringify(item)]));
    const ids = new Set([...previous.keys(), ...next.keys()]);
    return total + [...ids].filter((id) => previous.get(id) !== next.get(id)).length;
  }, 0);
}

export function createOperationsRepairService(deps) {
  const {
    makeId,
    nowText,
    reconcileGoogleSheetsStockOrderLinks,
    refreshManagedAccountStatuses,
    repairHistoricalStockReuse,
    repairManagedAccountOwnership,
    snapshotVersion,
    syncGoogleSheetsStockSafely,
    syncHistoricalStockConflicts,
    syncManagedAccountWhatsappFromOrders,
    syncSoldStockMetadata,
  } = deps;

  function assertAction(input = {}) {
    const action = String(input.action || "reseller_repair").trim();
    if (!ALLOWED_ACTIONS.has(action)) {
      const error = new Error("Action repair tidak diizinkan");
      error.status = 400;
      throw error;
    }
    return action;
  }

  function runLocalRepair(db, scope) {
    const targeted = Boolean(scope.accountId || scope.orderId || scope.resellerId);
    const sheetOrderLinksUpdated = targeted ? 0 : reconcileGoogleSheetsStockOrderLinks(db);
    const statusUpdated = targeted ? false : refreshManagedAccountStatuses(db);
    const ownership = repairManagedAccountOwnership(db, scope) || {};
    const postSyncUpdated = targeted ? 0 : syncManagedAccountWhatsappFromOrders(db);
    const conflictUpdated = targeted ? 0 : syncHistoricalStockConflicts(db);
    const stockAuditUpdated = targeted ? 0 : repairHistoricalStockReuse(db);
    const stockMetaUpdated = targeted ? 0 : syncSoldStockMetadata(db);
    return {
      changedTotal: Number(sheetOrderLinksUpdated || 0)
        + Number(statusUpdated ? 1 : 0)
        + Number(postSyncUpdated || 0)
        + Number(ownership.repaired || 0)
        + Number(ownership.rebuilt || 0)
        + Number(conflictUpdated || 0)
        + Number(stockAuditUpdated || 0)
        + Number(stockMetaUpdated || 0),
      statusUpdated: Boolean(statusUpdated),
      ownershipUpdated: Number(ownership.repaired || 0),
      rebuiltAccounts: Number(ownership.rebuilt || 0),
      conflictUpdated: Number(conflictUpdated || 0),
      stockAuditUpdated: Number(stockAuditUpdated || 0),
      stockMetaUpdated: Number(stockMetaUpdated || 0),
      rebuildResults: ownership.rebuildResults || [],
      matchedAccounts: Number(ownership.matched || 0),
      changedAccountIds: ownership.changedAccountIds || [],
      changedOrderIds: ownership.changedOrderIds || [],
      postSyncUpdated: Number(postSyncUpdated || 0),
    };
  }

  function preview(db, input = {}) {
    const action = assertAction(input);
    const scope = scopeFromInput(input);
    const before = safeState(db, scope);
    const simulated = clone(db);
    const result = runLocalRepair(simulated, scope);
    const after = safeState(simulated, scope);
    return {
      ok: true,
      action,
      scope,
      previewToken: snapshotVersion(db),
      generatedAt: new Date().toISOString(),
      readOnly: true,
      syncSheetsRequested: Boolean(input.syncSheets),
      reason: "Preview menghitung perubahan lokal pada snapshot. Google Sheets hanya dibaca saat apply.",
      risk: "Relasi ownership, metadata stok, dan managed account dapat berubah.",
      affectedObjects: diffCount(before, after),
      before,
      after,
      result,
    };
  }

  async function apply(db, input = {}, actor = {}) {
    const action = assertAction(input);
    if (input.confirmed !== true) {
      const error = new Error("Konfirmasi eksplisit diperlukan");
      error.status = 400;
      throw error;
    }
    const currentVersion = snapshotVersion(db);
    if (!input.previewToken || input.previewToken !== currentVersion) {
      const error = new Error("Data berubah sejak preview. Muat preview baru sebelum apply.");
      error.status = 409;
      throw error;
    }
    const scope = scopeFromInput(input);
    let sheets = { ok: true, skipped: true, reason: "not_requested" };
    if (input.syncSheets) {
      sheets = await syncGoogleSheetsStockSafely(db, {
        silent: true,
        reason: "owner_reseller_repair",
        force: true,
      });
    }
    const result = runLocalRepair(db, scope);
    db.activities = db.activities || [];
    db.activities.unshift({
      id: makeId("act"),
      type: "reseller",
      title: "Repair reseller diterapkan",
      description: `Repair ${action} dikonfirmasi owner dan menghasilkan ${result.changedTotal} perubahan terhitung.`,
      createdAt: nowText(),
      actorName: actor.name || actor.username || actor.email || "owner",
      actorRole: actor.role || "owner",
      resellerId: scope.resellerId,
      orderId: scope.orderId,
      accountId: scope.accountId,
      action,
      previewToken: input.previewToken,
    });
    return { ok: true, action, scope, ...result, sheets };
  }

  return { preview, apply };
}
