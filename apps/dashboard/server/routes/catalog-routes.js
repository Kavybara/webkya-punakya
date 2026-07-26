export function registerCatalogRoutes(app, deps) {
  const {
    activeResellerByWhatsapp,
    applyWaPriceSync,
    availableStockCount,
    durationAllowedForVariant,
    findWaPriceSource,
    getProduct,
    isVariantOrderable,
    legacyRootDir,
    makeId,
    normalizeDurationLabel,
    nowText,
    orderLockError,
    previewWaPriceSync,
    publicCatalog,
    readDb,
    readDbSnapshot,
    requireAuth,
    resellerRequiredMessage,
    syncSheetsForProductOrThrow,
    updateDb,
  } = deps;

  app.get("/api/products", requireAuth(["owner"]), async (_req, res) => {
    const db = await readDb();
    res.json(db.products);
  });

  app.get("/api/products/price-sync/preview", requireAuth(["owner"]), async (_req, res, next) => {
    try {
      const db = await readDb();
      const source = await findWaPriceSource(legacyRootDir);
      if (!source) {
        res.status(404).json({ error: "Sumber pricelist WA reseller tidak ditemukan" });
        return;
      }
      const preview = previewWaPriceSync(db, source.text);
      res.json({
        ok: true,
        source: { keyword: source.keyword, groupJid: source.groupJid, filePath: source.filePath, score: source.score },
        ...preview,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/products/price-sync/apply", requireAuth(["owner"]), async (_req, res, next) => {
    try {
      const result = await updateDb(async (db) => {
        const source = await findWaPriceSource(legacyRootDir);
        if (!source) {
          const error = new Error("Sumber pricelist WA reseller tidak ditemukan");
          error.status = 404;
          throw error;
        }
        const preview = previewWaPriceSync(db, source.text);
        const updated = applyWaPriceSync(db, preview);
        db.activities = db.activities || [];
        db.activities.unshift({
          id: makeId("act"),
          type: "stock",
          title: "Harga produk disinkronkan dari list WA",
          description: `${updated} harga produk diperbarui dari ${source.keyword}.`,
          createdAt: nowText(),
        });
        return {
          ok: true,
          updated,
          source: { keyword: source.keyword, groupJid: source.groupJid, filePath: source.filePath, score: source.score },
          ...preview,
        };
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/public/catalog", async (req, res) => {
    const db = await readDbSnapshot();
    const includeEmpty = ["1", "true", "yes"].includes(String(req.query.includeEmpty || "").toLowerCase());
    res.json(publicCatalog(db, { includeEmpty }));
  });

  app.post("/api/public/catalog/precheck", async (req, res, next) => {
    try {
      const result = await updateDb(async (db) => {
        const product = getProduct(db, req.body.productId);
        const variant = product?.variants?.find((item) => item.id === req.body.variantId) || null;
        if (!product || product.isArchived || product.isActive === false || !variant || !isVariantOrderable(product, variant)) {
          const error = new Error("Produk atau varian tidak tersedia untuk order baru");
          error.status = 409;
          error.catalog = publicCatalog(db, { includeEmpty: false });
          throw error;
        }
        await syncSheetsForProductOrThrow(db, product, "catalog_precheck", { force: true });
        const lockError = orderLockError(product, variant);
        if (lockError) {
          lockError.catalog = publicCatalog(db, { includeEmpty: false });
          throw lockError;
        }
        const duration = normalizeDurationLabel(req.body.duration || "", variant);
        if (!durationAllowedForVariant(variant, duration)) {
          const error = new Error(`Durasi ${duration} sedang tidak aktif untuk ${variant.name}.`);
          error.status = 409;
          error.catalog = publicCatalog(db, { includeEmpty: false });
          throw error;
        }
        const stockCount = availableStockCount(db, product, variant);
        return {
          ok: true,
          productId: product?.id || req.body.productId || "",
          variantId: variant?.id || req.body.variantId || "",
          stockCount,
          catalog: publicCatalog(db, { includeEmpty: false }),
        };
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/public/reseller-check", async (req, res) => {
    const db = await readDb();
    const reseller = activeResellerByWhatsapp(db, req.query.whatsapp || "");
    res.json({
      ok: true,
      active: Boolean(reseller),
      message: reseller ? "Nomor reseller aktif terverifikasi." : resellerRequiredMessage,
    });
  });
}
