function activityDate(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? null : date;
}

export function createReadMaintenanceService(deps) {
  const {
    archiveOldActivities,
    expirePendingOrders,
    hasExpiredPendingOrders,
    readDbSnapshot,
    updateDb,
  } = deps;

  let expiryRunning = false;
  let archiveRunning = false;

  async function runExpiredOrders(now = new Date()) {
    if (expiryRunning) return { skipped: true, reason: "already_running" };
    expiryRunning = true;
    try {
      const snapshot = await readDbSnapshot();
      if (!hasExpiredPendingOrders(snapshot, now)) {
        return { skipped: true, reason: "no_expired_orders" };
      }
      return updateDb((db) => ({
        changed: Boolean(expirePendingOrders(db, now)),
        processedAt: now.toISOString(),
      }));
    } finally {
      expiryRunning = false;
    }
  }

  async function runActivityArchive(options = {}) {
    if (archiveRunning) return { skipped: true, reason: "already_running" };
    archiveRunning = true;
    try {
      const keepDays = Math.max(1, Number(options.keepDays || 5));
      const now = options.now instanceof Date ? options.now : new Date();
      const cutoff = now.getTime() - keepDays * 86400000;
      const snapshot = await readDbSnapshot();
      const hasArchivable = (snapshot.activities || []).some((activity) => {
        const date = activityDate(activity.createdAt);
        return Boolean(date && date.getTime() < cutoff);
      });
      if (!hasArchivable) {
        return { skipped: true, reason: "no_archivable_activities" };
      }
      return updateDb((db) => ({
        changed: Boolean(archiveOldActivities(db, keepDays)),
        processedAt: now.toISOString(),
      }));
    } finally {
      archiveRunning = false;
    }
  }

  return { runExpiredOrders, runActivityArchive };
}
