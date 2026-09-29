import {
  catalogStockIsStale,
  createCatalogPrecheckLimiter,
  evaluateCatalogPrecheck,
} from "../services/catalog-precheck-service.js";
import { clientKey } from "../lib/client-ip.js";

export function registerCatalogRoutes(app, deps) {
  const {
    activeResellerByWhatsapp,
    applyWaPriceSync,
    catalogPrecheckCooldownMs,
    catalogPrecheckHelpers,
    findWaPriceSource,
    legacyRootDir,
    makeId,
    nowText,
    previewWaPriceSync,
    publicCatalog,
    readDb,
    readDbSnapshot,
    refreshCatalogStock,
    requireAuth,
    resellerRequiredMessage,
    updateDb,
  } = deps;
  const catalogPrecheckLimiter = createCatalogPrecheckLimiter();

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
      const client = clientKey(req);
      const rate = catalogPrecheckLimiter.check(client);
      if (!rate.allowed) {
        res.setHeader("Retry-After", String(rate.retryAfterSeconds));
        return res.status(429).json({ error: "Terlalu banyak pemeriksaan katalog. Coba lagi sebentar." });
      }

      const request = {
        productId: req.body?.productId,
        variantId: req.body?.variantId,
        duration: req.body?.duration,
      };

      // Answer "no" from a snapshot. Probing for products that do not exist
      // must not cost a full database rewrite.
      const db = await readDbSnapshot();
      const evaluated = evaluateCatalogPrecheck(db, request, catalogPrecheckHelpers);
      if (!evaluated.ok) {
        catalogPrecheckLimiter.recordFailure(client);
        return next(evaluated.error);
      }

      // Only a cold or expired product sync needs the write lock. `force` here
      // means "ignore the shared read cache", not "ignore the cooldown", so a
      // warm product is answered without touching Sheets or the database file.
      const result = catalogStockIsStale(db, evaluated.product, catalogPrecheckCooldownMs)
        ? await refreshCatalogStock(request)
        : {
            ok: true,
            productId: evaluated.productId,
            variantId: evaluated.variantId,
            stockCount: evaluated.stockCount,
            catalog: evaluated.catalog,
          };

      catalogPrecheckLimiter.clear(client);
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
