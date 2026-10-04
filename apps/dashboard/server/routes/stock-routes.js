import { stockStatusAfterReservationRelease } from "../google-sheets/account-condition.js";

/*
 * The fields a stock edit is allowed to write.
 *
 * This list is the whole reason `PUT /api/stock/:id` is not `Object.assign`
 * any more. That line accepted every key in the request body, so a client could
 * set `id`, `productId`, `reservedFor`, `soldAt` -- the fields that belong to
 * the reservation and fulfilment machinery and are written by `auto-order.js`,
 * not by a person editing a row.
 *
 * Derived from the edit dialog's own fields (`owner-v2/stock/page.tsx`), plus
 * `status` and `notes`, which the same form sends. Anything not named here is
 * rejected with a 409 naming the offending keys, rather than silently dropped:
 * a client that thinks it saved something and did not is worse than an error.
 */
const STOCK_EDITABLE_FIELDS = new Set([
  "productId",
  "variantId",
  "email",
  "loginPhone",
  "otpEmail",
  "password",
  "profile",
  "pin",
  "status",
  "notes",
  "sheetName",
  "sheetRow",
  "displayName",
  "displayNote",
]);

export function registerStockRoutes(app, deps) {
  const {
    buildDailyStockAssignment,
    createdAtMs,
    getProduct,
    getVariant,
    isCanvaProduct,
    isGoogleSheetsBackedStock,
    linkPoolAvailableCount,
    makeId,
    normalizeWhatsappNumber,
    notifyResellerAccountChanged,
    nowText,
    ownerProfile,
    pushAccountsToGoogleSheets,
    readDb,
    requireAuth,
    syncCredentialsToSheetsSafely,
    syncPasswordByEmail,
    todayText,
    updateDb,
  } = deps;

  app.get("/api/stock", requireAuth(["owner", "reseller"]), async (req, res) => {
    const db = await readDb();
    const search = String(req.query.search || "").toLowerCase();
    const status = String(req.query.status || "all");
    const productId = String(req.query.productId || "all");
    if (req.auth.role === "reseller") {
      if (!["all", "available"].includes(status)) {
        res.json([]);
        return;
      }
      const grouped = new Map();
      const addSummary = (nextProductId, nextVariantId, amount, extraSearch = "") => {
        if (!nextProductId || !nextVariantId || amount <= 0) return;
        const product = getProduct(db, nextProductId);
        const variant = getVariant(db, nextProductId, nextVariantId);
        if (!product || !variant || isCanvaProduct(product)) return;
        if (productId !== "all" && nextProductId !== productId) return;
        const matchSearch = !search || [product.name, variant.name, variant.code, extraSearch].join(" ").toLowerCase().includes(search);
        if (!matchSearch) return;
        const key = `${nextProductId}::${nextVariantId}`;
        const current = grouped.get(key) || {
          id: `summary-${nextProductId}-${nextVariantId}`,
          productId: nextProductId,
          variantId: nextVariantId,
          email: "",
          password: "",
          profile: "",
          pin: "",
          status: "available",
          stockType: "summary",
          availableCount: 0,
        };
        current.availableCount += amount;
        current.email = `${current.availableCount} akun ready`;
        grouped.set(key, current);
      };

      for (const item of db.stock || []) {
        if (item.status !== "available") continue;
        addSummary(item.productId, item.variantId, 1, item.email || "");
      }
      for (const pool of db.linkPools || []) {
        const available = linkPoolAvailableCount(db, pool);
        if (available <= 0) continue;
        addSummary(pool.productId, pool.variantId, available, `${pool.poolKey || ""} ${pool.link || ""}`);
      }

      res.json(Array.from(grouped.values()).sort((left, right) => (
        `${left.productId}-${left.variantId}`.localeCompare(`${right.productId}-${right.variantId}`)
      )));
      return;
    }
    const rows = db.stock.filter((item) => {
      const product = getProduct(db, item.productId);
      const variant = getVariant(db, item.productId, item.variantId);
      if (isCanvaProduct(product)) return false;
      const matchStatus = status === "all" || item.status === status;
      const matchProduct = productId === "all" || item.productId === productId;
      const matchSearch = [item.id, item.email, product?.name, variant?.name, variant?.code].join(" ").toLowerCase().includes(search);
      return matchStatus && matchProduct && matchSearch;
    });
    const linkRows = (db.linkPools || [])
      .filter((pool) => {
        const product = getProduct(db, pool.productId);
        const variant = getVariant(db, pool.productId, pool.variantId);
        const available = linkPoolAvailableCount(db, pool);
        if (!product || !variant || available <= 0) return false;
        const matchStatus = status === "all" || status === "available";
        const matchProduct = productId === "all" || pool.productId === productId;
        const matchSearch = [pool.id, pool.link, pool.poolKey, product?.name, variant?.name, variant?.code].join(" ").toLowerCase().includes(search);
        return matchStatus && matchProduct && matchSearch;
      })
      .map((pool) => {
        const available = linkPoolAvailableCount(db, pool);
        return {
          id: pool.id,
          productId: pool.productId,
          variantId: pool.variantId,
          email: `Kuota ${available}/${Number(pool.quota || 0)} tersedia`,
          password: pool.link || "",
          profile: "-",
          pin: "-",
          status: "available",
          stockType: "link_pool",
          /*
           * A pool is one row standing for many accounts. The reseller branch
           * has always set this; the owner branch left it undefined, and the
           * overview's stock summary falls back to 1 per row -- so a pool
           * holding 10 unclaimed accounts counted as 1 and "Stok siap"
           * understated by nine, on the page whose whole job is that number.
           */
          availableCount: available,
          linkPoolId: pool.id,
          sheetSource: "google_sheets",
          sheetPool: pool.poolKey || pool.key || "",
          sheetPoolSchema: "link",
          sheetRow: pool.sheetRow || 0,
          sheetName: pool.sheetName || "",
          notes: pool.notes || "",
        };
      });
    const allRows = [...rows, ...linkRows];
    res.json(allRows);
  });

  app.post("/api/stock", requireAuth(["owner"]), async (req, res) => {
    const created = await updateDb((db) => {
      // No `db.products[0]` fallback -- see the note in `POST /api/orders`.
      // Filing credentials under a product the owner never named is how a
      // catalogue gets quietly wrong, and the stock pool is the one place
      // that mistake is impossible to undo.
      const product = getProduct(db, req.body.productId);
      const variant = product?.variants?.find((item) => item.id === req.body.variantId);
      if (!product || !variant) {
        const error = new Error("Produk atau varian tidak valid");
        error.status = 400;
        throw error;
      }
      const stock = {
        id: makeId("stk"),
        productId: product.id,
        variantId: variant.id,
        email: req.body.email,
        password: req.body.password,
        profile: req.body.profile || "",
        pin: req.body.pin || "",
        signInCode: req.body.signInCode || "",
        verificationCode: req.body.verificationCode || "",
        resetLink: req.body.resetLink || "",
        householdLink: req.body.householdLink || "",
        status: req.body.status || "available",
        createdAt: todayText(),
        notes: req.body.notes || "",
      };
      db.stock.unshift(stock);
      db.activities.unshift({
        id: makeId("act"),
        type: "stock",
        title: `Stok ${product.name} ditambahkan`,
        description: `${stock.email} masuk ke stok ${stock.status}.`,
        createdAt: nowText(),
      });
      return stock;
    });
    res.status(201).json(created);
  });

  app.put("/api/stock/:id", requireAuth(["owner"]), async (req, res) => {
    const updated = await updateDb(async (db) => {
      const item = db.stock.find((stock) => stock.id === req.params.id);
      if (!item) return null;
      const sheetBacked = isGoogleSheetsBackedStock(item);
      if (sheetBacked) {
        const mutableKeys = new Set(["password", "signInCode", "verificationCode", "resetLink", "householdLink"]);
        const blockedKeys = Object.keys(req.body || {}).filter((key) => !mutableKeys.has(key));
        if (blockedKeys.length) {
          const error = new Error(`Stok Google Sheets harus diubah dari Sheets. Field web yang diblokir: ${blockedKeys.join(", ")}`);
          error.status = 409;
          throw error;
        }
      }
      const previousPassword = String(item.password || "");

      // See `STOCK_EDITABLE_FIELDS`. Checked for every row, not just
      // Sheets-backed ones: the old `Object.assign` let a local row have its
      // `reservedFor` rewritten by a hand-rolled request, which would detach it
      // from the order actually holding it.
      const blockedFields = Object.keys(req.body || {}).filter((key) => !STOCK_EDITABLE_FIELDS.has(key));
      if (blockedFields.length) {
        const error = new Error(`Field stok tidak boleh diubah lewat form: ${blockedFields.join(", ")}. Gunakan endpoint yang tersedia untuk perubahan ini.`);
        error.status = 409;
        throw error;
      }

      const previousStatus = String(item.status || "");
      Object.assign(item, req.body);

      // The audit trail said "owner" for every release regardless of who did it.
      // `ownerProfile(db)` is what the deposit approve/reject routes already use
      // to name the reviewer, so this matches the rest of the console's records.
      const profile = ownerProfile(db);
      const actorName = profile?.name || profile?.username || "owner";

      // A status change is the one edit here with consequences beyond this row,
      // so it is the one that gets written down. `releaseStock` below does the
      // same for the guarded path; this covers a status set from the edit form.
      const nextStatus = String(item.status || "");
      if (previousStatus && nextStatus && previousStatus !== nextStatus) {
        db.activities = db.activities || [];
        db.activities.unshift({
          id: makeId("act"),
          type: "stock",
          title: "Status stok diubah",
          description: `${item.email || item.loginPhone || item.id} statusnya ${previousStatus} -> ${nextStatus} oleh ${actorName}.`,
          createdAt: nowText(),
          stockId: item.id,
        });
      }

      const nextPassword = String(item.password || "");
      if (req.body.password !== undefined && previousPassword !== nextPassword) {
        const passwordSync = syncPasswordByEmail(db, item.email, nextPassword, { sourceStockId: item.id });
        item.googleSheetsCredentialSync = await syncCredentialsToSheetsSafely(db, {
          email: item.email,
          password: nextPassword,
          stockIds: [item.id],
          sheetStockKeys: [item.sheetStockKey].filter(Boolean),
        });
        const notificationDedupe = new Set();
        for (const account of passwordSync.affectedAccounts || []) {
          await notifyResellerAccountChanged(db, account, [{ key: "password", label: "Password/Link" }], { dedupeSet: notificationDedupe });
        }
      }
      return item;
    });
    if (!updated) return res.status(404).json({ error: "Stok tidak ditemukan" });
    res.json(updated);
  });

  app.post("/api/stock/:id/release-reservation", requireAuth(["owner"]), async (req, res) => {
    const updated = await updateDb((db) => {
      const stock = (db.stock || []).find((item) => item.id === req.params.id);
      if (!stock) return null;
      if (String(stock.status || "").toLowerCase() !== "reserved") {
        const error = new Error("Stok ini tidak sedang reserved");
        error.status = 400;
        throw error;
      }

      const linkedAccount = (db.managedAccounts || []).find((account) => (
        String(account.id || "").trim() === String(stock.reservedAccountId || "").trim()
        && !account.hidden
        && !account.returnedToStockAt
      ));
      if (linkedAccount) {
        const error = new Error("Stok reserved ini masih dipakai akun harian aktif, jadi tidak boleh dilepas.");
        error.status = 409;
        throw error;
      }

      const order = (db.orders || []).find((item) => String(item.id || "").trim() === String(stock.reservedFor || "").trim()) || null;
      const orderTerminal = !order
        || ["cancelled"].includes(String(order.orderStatus || "").toLowerCase())
        || ["expired"].includes(String(order.qrisStatus || "").toLowerCase())
        || (createdAtMs(order.paymentExpiresAt || "") && createdAtMs(order.paymentExpiresAt || "") < Date.now());
      if (!orderTerminal) {
        const error = new Error("Order yang menahan stok ini masih aktif. Lepas lock hanya untuk reservasi stale/expired.");
        error.status = 409;
        throw error;
      }

      stock.status = stockStatusAfterReservationRelease(stock);
      delete stock.reservedFor;
      delete stock.reservedAccountId;
      delete stock.reservedUntil;
      delete stock.reservedAt;

      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "stock",
        title: "Reserved stock dilepas manual",
        description: `${stock.email || stock.id} lock reservasinya dilepas oleh ${ownerProfile(db)?.name || ownerProfile(db)?.username || "owner"}${order ? ` dari order ${order.id}` : ""}.`,
        createdAt: nowText(),
        stockId: stock.id,
        orderId: order?.id || "",
      });
      return stock;
    });
    if (!updated) return res.status(404).json({ error: "Stok tidak ditemukan" });
    res.json({ ok: true, stock: updated });
  });

  /*
   * Putting a delivered account back on sale.
   *
   * `release-reservation` above covers `reserved`, and refuses anything else.
   * That leaves `sold` with no guarded path at all -- and the UI was reaching it
   * through `PUT /api/stock/:id` with `{ status: "available" }`, which
   * `Object.assign` accepted silently. A customer's working credentials became
   * purchasable again in one click, checked against nothing, recorded nowhere.
   * The stock page even said so in its own warning copy, which is the tell that
   * this was a known hole rather than a decision.
   *
   * This is that guarded path. Same shape as `release-reservation`, for the
   * transition that had none:
   *
   * - **A reason is required.** Not decoration: `db.activities` is archived
   *   after a few days, so this is the only durable record that an account a
   *   customer once held went back on sale, and why. `setMaintenanceMode` sets
   *   the precedent for storing a stated reason rather than deriving one.
   * - **Linked-account check**, same as the reservation path: an active daily
   *   account still pointing at this stock means somebody is using it.
   * - **Status is server-decided** via `stockStatusAfterReservationRelease`, so
   *   Google Sheets can still mark the account `blocked` instead of offering a
   *   dead credential for sale.
   * - **`soldAt` is cleared.** It was left stale, so a row read `available` while
   *   still carrying the date it was sold -- which warranty date fallbacks read.
   */
  app.post("/api/stock/:id/release", requireAuth(["owner"]), async (req, res) => {
    const reason = String(req.body?.reason || "").trim();
    if (!reason) {
      res.status(400).json({ error: "Alasan wajib diisi supaya ada catatan kenapa stok ini dikembalikan." });
      return;
    }

    const updated = await updateDb((db) => {
      const stock = (db.stock || []).find((item) => String(item.id || "") === String(req.params.id || ""));
      if (!stock) return null;

      const current = String(stock.status || "").toLowerCase();
      if (current === "available") {
        const error = new Error("Stok ini sudah tersedia, tidak ada yang perlu dilepas.");
        error.status = 400;
        throw error;
      }
      if (current === "reserved") {
        const error = new Error("Stok reserved harus dilepas lewat endpoint release-reservation.");
        error.status = 400;
        throw error;
      }

      // `stock.reservedAccountId` has to be truthy before the comparison.
      // Without that guard an absent id normalises to "" and then matches any
      // managed account whose id is also missing, which refuses rows that were
      // never linked to anything.
      const linkedAccountId = String(stock.reservedAccountId || "").trim();
      const linkedAccount = linkedAccountId
        ? (db.managedAccounts || []).find((account) => (
          String(account.id || "").trim() === linkedAccountId
          && !account.hidden
          && !account.returnedToStockAt
        ))
        : null;
      if (linkedAccount) {
        const error = new Error("Stok ini masih dipakai akun harian aktif, jadi tidak boleh dikembalikan.");
        error.status = 409;
        throw error;
      }

      const previousStatus = stock.status;
      stock.status = stockStatusAfterReservationRelease(stock);
      delete stock.reservedFor;
      delete stock.reservedAccountId;
      delete stock.reservedUntil;
      delete stock.reservedAt;
      delete stock.soldAt;

      const profile = ownerProfile(db);
      const actorName = profile?.name || profile?.username || "owner";
      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "stock",
        title: "Stok dikembalikan ke pool",
        description: `${stock.email || stock.loginPhone || stock.id} dikembalikan dari ${previousStatus} ke ${stock.status} oleh ${actorName}. Alasan: ${reason}`,
        createdAt: nowText(),
        stockId: stock.id,
      });
      return stock;
    });

    if (!updated) {
      res.status(404).json({ error: "Stok tidak ditemukan" });
      return;
    }
    res.json({ ok: true, stock: updated });
  });

  app.post("/api/stock/:id/assign-daily", requireAuth(["owner"]), async (req, res) => {
    const assigned = await updateDb(async (db) => {
      const stock = db.stock.find((item) => item.id === req.params.id);
      if (!stock) return null;
      const account = buildDailyStockAssignment(db, stock, req.body);
      stock.status = "reserved";
      stock.reservedFor = account.reseller || account.whatsapp || account.resellerId || "";
      stock.reservedAccountId = account.id;
      stock.reservedUntil = account.expiresAt;
      stock.soldVariant = account.variant || "";
      stock.soldVariantId = account.variantId || "";
      stock.soldDuration = account.duration || "";
      stock.soldDurationDays = account.durationDays || 0;
      db.managedAccounts = db.managedAccounts || [];
      db.managedAccounts.unshift(account);
      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "account",
        title: `Akun ${account.email} di-assign harian`,
        description: `${account.email} dipakai ${account.reseller || account.whatsapp || "reseller"} selama ${account.durationDays} hari.`,
        createdAt: nowText(),
        resellerId: account.resellerId || "",
        whatsapp: normalizeWhatsappNumber(account.whatsapp || ""),
        accountId: account.id,
        accountEmail: account.email,
        stockId: stock.id,
      });
      await pushAccountsToGoogleSheets(db, [account], { id: "MANUAL", device: req.body.device || req.body.buyer || "", note: req.body.buyer || "" });
      return { account, stock };
    });
    if (!assigned) return res.status(404).json({ error: "Stok tidak ditemukan" });
    res.status(201).json(assigned);
  });

  app.delete("/api/stock/:id", requireAuth(["owner"]), async (req, res) => {
    const deleted = await updateDb((db) => {
      const index = db.stock.findIndex((stock) => stock.id === req.params.id);
      if (index === -1) return null;
      const existing = db.stock[index];
      if (isGoogleSheetsBackedStock(existing)) {
        const error = new Error("Stok Google Sheets tidak boleh dihapus dari web. Hapus atau kosongkan row di Google Sheets.");
        error.status = 409;
        throw error;
      }
      const [item] = db.stock.splice(index, 1);
      db.activities.unshift({
        id: makeId("act"),
        type: "stock",
        title: "Stok dihapus",
        description: `${item.email || item.id} dihapus dari daftar stok.`,
        createdAt: nowText(),
      });
      return item;
    });
    if (!deleted) return res.status(404).json({ error: "Stok tidak ditemukan" });
    res.json({ ok: true });
  });
}
