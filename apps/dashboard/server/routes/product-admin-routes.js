import {
  DELIVERY_TEMPLATE_FIELDS,
  buildDeliveryTemplateContext,
  renderDeliveryTemplate,
  validateDeliveryTemplate,
} from "../services/delivery-template-service.js";

const DELIVERY_PREVIEW_ACCOUNT = Object.freeze({
  email: "contoh@kavya.test",
  username: "contoh-user",
  loginPhone: "628123456789",
  password: "passwordcontoh",
  profile: "Profil 2",
  pin: "1234",
  canvaLink: "https://contoh.kavya.test/invite",
  startedAt: "2026-07-20 10:00",
  expiresAt: "2026-07-28 10:00",
});

export function registerProductAdminRoutes(app, deps) {
  const {
    makeId,
    normalizeProductInput,
    nowText,
    productDependencyMessage,
    productDependencySummary,
    readDb,
    requireAuth,
    updateDb,
  } = deps;

  app.post("/api/products", requireAuth(["owner"]), async (req, res) => {
    const created = await updateDb((db) => {
      const product = {
        ...normalizeProductInput(req.body),
        isArchived: false,
        archivedAt: "",
        id: makeId("prod"),
      };
      db.products.unshift(product);
      return product;
    });
    res.status(201).json(created);
  });

  app.put("/api/products/:id", requireAuth(["owner"]), async (req, res) => {
    const updated = await updateDb((db) => {
      const index = db.products.findIndex((product) => product.id === req.params.id);
      if (index === -1) return null;
      const current = db.products[index];
      const product = {
        ...current,
        ...normalizeProductInput(req.body, current),
        id: current.id,
      };
      db.products[index] = product;
      return product;
    });
    if (!updated) return res.status(404).json({ error: "Produk tidak ditemukan" });
    res.json(updated);
  });

  app.post("/api/products/:id/lock", requireAuth(["owner"]), async (req, res) => {
    const updated = await updateDb((db) => {
      const product = db.products.find((item) => item.id === req.params.id);
      if (!product) return null;
      const enabled = Boolean(req.body?.enabled);
      const updatedAt = nowText();
      product.orderLock = {
        enabled,
        reason: enabled ? String(req.body?.reason || "").trim() : "",
        updatedAt,
        updatedBy: "owner",
        scope: "product",
      };
      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "stock",
        title: enabled ? `${product.name} di-lock untuk order baru` : `Lock order ${product.name} dibuka`,
        description: enabled
          ? `Order baru untuk ${product.name} ditahan manual.${product.orderLock.reason ? ` Alasan: ${product.orderLock.reason}` : ""}`
          : `Order baru untuk ${product.name} aktif lagi.`,
        createdAt: updatedAt,
        productId: product.id,
      });
      return product;
    });
    if (!updated) return res.status(404).json({ error: "Produk tidak ditemukan" });
    res.json(updated);
  });

  app.post("/api/products/:id/variants/:variantId/lock", requireAuth(["owner"]), async (req, res) => {
    const updated = await updateDb((db) => {
      const product = db.products.find((item) => item.id === req.params.id);
      const variant = product?.variants?.find((item) => item.id === req.params.variantId);
      if (!product || !variant) return null;
      const enabled = Boolean(req.body?.enabled);
      const updatedAt = nowText();
      variant.orderLock = {
        enabled,
        reason: enabled ? String(req.body?.reason || "").trim() : "",
        updatedAt,
        updatedBy: "owner",
        scope: "variant",
      };
      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "stock",
        title: enabled ? `${product.name} ${variant.name} di-lock` : `Lock order ${product.name} ${variant.name} dibuka`,
        description: enabled
          ? `Order baru untuk ${product.name} ${variant.name} ditahan manual.${variant.orderLock.reason ? ` Alasan: ${variant.orderLock.reason}` : ""}`
          : `Order baru untuk ${product.name} ${variant.name} aktif lagi.`,
        createdAt: updatedAt,
        productId: product.id,
        variant: variant.name,
      });
      return product;
    });
    if (!updated) return res.status(404).json({ error: "Produk atau variant tidak ditemukan" });
    res.json(updated);
  });

  app.get("/api/products/:id/variants/:variantId/delivery-template", requireAuth(["owner"]), async (req, res) => {
    const db = await readDb();
    const product = db.products.find((item) => item.id === req.params.id);
    const variant = product?.variants?.find((item) => item.id === req.params.variantId);
    const result = product && variant ? {
      productId: product.id,
      variantId: variant.id,
      sku: variant.sku || variant.code || "",
      source: String(variant.deliveryTemplate || ""),
      version: Math.max(0, Number(variant.deliveryTemplateVersion || (variant.deliveryTemplate ? 1 : 0))),
      requiredFields: Array.isArray(variant.requiredDeliveryFields) ? variant.requiredDeliveryFields : [],
      updatedAt: variant.deliveryTemplateUpdatedAt || "",
      updatedBy: variant.deliveryTemplateUpdatedBy || "",
      placeholders: DELIVERY_TEMPLATE_FIELDS,
    } : null;
    if (!result) return res.status(404).json({ error: "Produk atau varian tidak ditemukan" });
    res.json(result);
  });

  app.post("/api/products/:id/variants/:variantId/delivery-template/preview", requireAuth(["owner"]), async (req, res) => {
    const db = await readDb();
    const product = db.products.find((item) => item.id === req.params.id);
    const variant = product?.variants?.find((item) => item.id === req.params.variantId);
    let result = null;
    if (product && variant) {
      const source = String(req.body?.source ?? variant.deliveryTemplate ?? "");
      const requiredFields = Array.isArray(req.body?.requiredFields)
        ? req.body.requiredFields
        : Array.isArray(variant.requiredDeliveryFields)
          ? variant.requiredDeliveryFields
          : [];
      const order = {
        id: "ORD-PREVIEW",
        product: product.name,
        variant: variant.name,
        variantCode: variant.sku || variant.code || "",
        duration: "1 Bulan",
        customer: "Customer Preview",
        email: "customer@kavya.test",
        whatsapp: "628123456789",
        createdAt: "2026-07-20 10:00",
        expiresAt: DELIVERY_PREVIEW_ACCOUNT.expiresAt,
      };
      const context = buildDeliveryTemplateContext({ order, product, variant, account: DELIVERY_PREVIEW_ACCOUNT });
      result = {
        validation: validateDeliveryTemplate(source, requiredFields),
        rendered: renderDeliveryTemplate(source, context, { requiredFields }),
        previewData: true,
      };
    }
    if (!result) return res.status(404).json({ error: "Produk atau varian tidak ditemukan" });
    res.json(result);
  });

  app.put("/api/products/:id/variants/:variantId/delivery-template", requireAuth(["owner"]), async (req, res) => {
    const updated = await updateDb((db) => {
      const product = db.products.find((item) => item.id === req.params.id);
      const variant = product?.variants?.find((item) => item.id === req.params.variantId);
      if (!product || !variant) return null;
      const source = String(req.body?.source ?? "");
      const requiredFields = Array.isArray(req.body?.requiredFields)
        ? req.body.requiredFields.map((field) => Array.isArray(field) ? field.map(String) : String(field)).filter(Boolean)
        : [];
      const validation = validateDeliveryTemplate(source, requiredFields);
      if (!validation.ok) {
        const error = new Error(validation.errors.join(" "));
        error.status = 400;
        error.code = "invalid_delivery_template";
        error.details = validation;
        throw error;
      }
      const updatedAt = nowText();
      variant.deliveryTemplate = source;
      variant.requiredDeliveryFields = requiredFields;
      variant.deliveryTemplateVersion = Math.max(0, Number(variant.deliveryTemplateVersion || 0)) + 1;
      variant.deliveryTemplateUpdatedAt = updatedAt;
      variant.deliveryTemplateUpdatedBy = req.auth?.sub || "owner";
      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "stock",
        title: `Template pengiriman ${product.name} ${variant.name} diperbarui`,
        description: `Varian ${variant.id}; SKU ${variant.sku || variant.code || "-"}; versi ${variant.deliveryTemplateVersion}.`,
        createdAt: updatedAt,
        productId: product.id,
        variantId: variant.id,
        templateVersion: variant.deliveryTemplateVersion,
        actorId: req.auth?.sub || "owner",
      });
      return { product, variant, validation };
    });
    if (!updated) return res.status(404).json({ error: "Produk atau varian tidak ditemukan" });
    res.json(updated);
  });

  app.post("/api/products/:id/variants/:variantId/delivery-template/copy", requireAuth(["owner"]), async (req, res) => {
    const updated = await updateDb((db) => {
      const product = db.products.find((item) => item.id === req.params.id);
      const variant = product?.variants?.find((item) => item.id === req.params.variantId);
      const sourceProduct = db.products.find((item) => item.id === String(req.body?.sourceProductId || req.params.id));
      const sourceVariant = sourceProduct?.variants?.find((item) => item.id === String(req.body?.sourceVariantId || ""));
      if (!product || !variant || !sourceProduct || !sourceVariant) return null;
      if (!String(sourceVariant.deliveryTemplate || "").trim()) {
        const error = new Error("Varian sumber belum memiliki template pengiriman.");
        error.status = 400;
        throw error;
      }
      const updatedAt = nowText();
      variant.deliveryTemplate = String(sourceVariant.deliveryTemplate);
      variant.requiredDeliveryFields = Array.isArray(sourceVariant.requiredDeliveryFields)
        ? structuredClone(sourceVariant.requiredDeliveryFields)
        : [];
      variant.deliveryTemplateVersion = Math.max(0, Number(variant.deliveryTemplateVersion || 0)) + 1;
      variant.deliveryTemplateUpdatedAt = updatedAt;
      variant.deliveryTemplateUpdatedBy = req.auth?.sub || "owner";
      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "stock",
        title: `Template ${product.name} ${variant.name} disalin`,
        description: `Disalin dari varian ${sourceVariant.id} sebagai versi independen ${variant.deliveryTemplateVersion}.`,
        createdAt: updatedAt,
        productId: product.id,
        variantId: variant.id,
        sourceVariantId: sourceVariant.id,
        templateVersion: variant.deliveryTemplateVersion,
        actorId: req.auth?.sub || "owner",
      });
      return { product, variant };
    });
    if (!updated) return res.status(404).json({ error: "Produk atau varian sumber tidak ditemukan" });
    res.json(updated);
  });

  app.post("/api/products/:id/archive", requireAuth(["owner"]), async (req, res) => {
    const archived = await updateDb((db) => {
      const product = db.products.find((item) => item.id === req.params.id);
      if (!product) return null;
      const archivedAt = nowText();
      product.isArchived = true;
      product.isActive = false;
      product.archivedAt = archivedAt;
      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "stock",
        title: `${product.name} diarsipkan`,
        description: "Produk disembunyikan dari katalog dan order baru. Order, stok, dan akun lama tetap disimpan.",
        createdAt: archivedAt,
        productId: product.id,
      });
      return product;
    });
    if (!archived) return res.status(404).json({ error: "Produk tidak ditemukan" });
    res.json(archived);
  });

  app.post("/api/products/:id/unarchive", requireAuth(["owner"]), async (req, res) => {
    const restored = await updateDb((db) => {
      const product = db.products.find((item) => item.id === req.params.id);
      if (!product) return null;
      const restoredAt = nowText();
      product.isArchived = false;
      product.archivedAt = "";
      product.isActive = true;
      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "stock",
        title: `${product.name} dipulihkan`,
        description: "Produk kembali aktif dan bisa tampil di katalog jika punya stok ready.",
        createdAt: restoredAt,
        productId: product.id,
      });
      return product;
    });
    if (!restored) return res.status(404).json({ error: "Produk tidak ditemukan" });
    res.json(restored);
  });

  app.delete("/api/products/:id", requireAuth(["owner"]), async (req, res) => {
    const deleted = await updateDb((db) => {
      const index = db.products.findIndex((product) => product.id === req.params.id);
      if (index === -1) return null;
      const product = db.products[index];
      const dependencies = productDependencySummary(db, product);
      if (dependencies.total > 0) {
        const error = new Error(`Produk masih punya ${productDependencyMessage(dependencies)}. Pakai Arsipkan supaya data lama tetap aman.`);
        error.status = 409;
        throw error;
      }
      db.products.splice(index, 1);
      db.activities = db.activities || [];
      db.activities.unshift({
        id: makeId("act"),
        type: "stock",
        title: `${product.name} dihapus permanen`,
        description: "Produk dihapus karena tidak memiliki stok, akun reseller, atau order terkait.",
        createdAt: nowText(),
        productId: product.id,
      });
      return true;
    });
    if (!deleted) return res.status(404).json({ error: "Produk tidak ditemukan" });
    res.json({ ok: true });
  });
}
