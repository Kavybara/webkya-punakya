export const DELIVERY_TEMPLATE_FIELDS = Object.freeze([
  "product_name",
  "variant_name",
  "sku",
  "email",
  "username",
  "login_identifier",
  "password",
  "profile",
  "pin",
  "duration",
  "duration_days",
  "is_daily",
  "is_monthly",
  "start_date",
  "rental_end",
  "expiry_date",
  "order_id",
  "customer_name",
  "customer_email",
  "customer_whatsapp",
  "link",
]);

const FIELD_SET = new Set(DELIVERY_TEMPLATE_FIELDS);
const TOKEN_PATTERN = /\{\{\s*(#if\s+)?(\/if|[\w.-]+)\s*\}\}/g;
const CONDITIONAL_PATTERN = /\{\{\s*#if\s+([\w.-]+)\s*\}\}([\s\S]*?)\{\{\s*\/if\s*\}\}/g;
const EMPTY_OPTIONAL_LINE = "\uE000";

function normalizeTemplateTokens(source = "") {
  return String(source || "").replace(/\{\{[\s\S]*?\}\}/g, (token) => token.replace(/\\_/g, "_"));
}

function scalar(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).replace(/\0/g, "");
  }
  return "";
}

function hasValue(value) {
  return scalar(value).trim().length > 0;
}

function normalizeRequiredFields(fields = []) {
  return (Array.isArray(fields) ? fields : [])
    .map((entry) => {
      if (Array.isArray(entry)) return entry.map((field) => String(field || "").trim()).filter(Boolean).join("|");
      return String(entry || "").trim();
    })
    .filter(Boolean);
}

function fieldsForRequirement(requirement = "") {
  return String(requirement)
    .split("|")
    .map((field) => field.trim())
    .filter(Boolean);
}

function templateMentionsField(source, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\{\\{\\s*(?:#if\\s+)?${escaped}\\s*\\}\\}`).test(source);
}

function selectDurationSpecificPlainSection(source = "", context = {}) {
  const template = String(source || "");
  if (/\{\{\s*#if\s+is_(daily|monthly)\s*\}\}/i.test(template)) return template;

  const wantDaily = hasValue(context.is_daily);
  const wantMonthly = hasValue(context.is_monthly);
  if (!wantDaily && !wantMonthly) return template;

  const lines = template.split(/\r?\n/);
  const headers = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed || /^[\-*•○യ➝]/.test(trimmed)) continue;
    const match = trimmed.match(/\b\d+\s*(hari|day|bulan|month|bln)\b/i);
    if (!match) continue;
    headers.push({
      index,
      kind: /hari|day/i.test(match[1]) ? "daily" : "monthly",
    });
  }
  const hasDaily = headers.some((header) => header.kind === "daily");
  const hasMonthly = headers.some((header) => header.kind === "monthly");
  if (!hasDaily || !hasMonthly) return template;

  const wantedKind = wantDaily ? "daily" : "monthly";
  const selected = headers.find((header) => header.kind === wantedKind);
  if (!selected) return template;
  const next = headers.find((header) => header.index > selected.index);
  return lines.slice(selected.index, next?.index ?? lines.length).join("\n").trim();
}

export function validateDeliveryTemplate(source = "", requiredFields = []) {
  const template = normalizeTemplateTokens(source);
  const errors = [];
  const warnings = [];
  const stack = [];
  const usedFields = new Set();
  let match;

  TOKEN_PATTERN.lastIndex = 0;
  while ((match = TOKEN_PATTERN.exec(template))) {
    const conditionalStart = Boolean(match[1]);
    const token = match[2];
    if (token === "/if") {
      if (!stack.length) errors.push("Conditional {{/if}} tidak memiliki pembuka.");
      else stack.pop();
      continue;
    }
    if (!FIELD_SET.has(token)) {
      errors.push(`Placeholder tidak dikenal: {{${conditionalStart ? `#if ${token}` : token}}}.`);
      continue;
    }
    usedFields.add(token);
    if (conditionalStart) {
      if (stack.length) errors.push("Conditional bertingkat belum didukung.");
      stack.push(token);
    }
  }

  if (stack.length) errors.push(`Conditional untuk "${stack.at(-1)}" belum ditutup dengan {{/if}}.`);

  const knownTokenPattern = /\{\{[\s\S]*?\}\}/g;
  for (const raw of template.match(knownTokenPattern) || []) {
    TOKEN_PATTERN.lastIndex = 0;
    if (!TOKEN_PATTERN.test(raw)) errors.push(`Sintaks placeholder tidak valid: ${raw}.`);
  }

  for (const requirement of normalizeRequiredFields(requiredFields)) {
    const alternatives = fieldsForRequirement(requirement);
    const unknown = alternatives.filter((field) => !FIELD_SET.has(field));
    if (unknown.length) {
      errors.push(`Field wajib tidak dikenal: ${unknown.join(", ")}.`);
      continue;
    }
    if (!alternatives.some((field) => templateMentionsField(template, field))) {
      warnings.push(`Template belum memakai field wajib: ${requirement}.`);
    }
  }

  if (!template.trim()) errors.push("Template pengiriman masih kosong.");

  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    usedFields: [...usedFields],
  };
}

export function renderDeliveryTemplate(source = "", context = {}, options = {}) {
  const requiredFields = normalizeRequiredFields(options.requiredFields);
  const effectiveSource = selectDurationSpecificPlainSection(normalizeTemplateTokens(source), context);
  const validation = validateDeliveryTemplate(effectiveSource, requiredFields);
  const missingFields = requiredFields.filter((requirement) => (
    !fieldsForRequirement(requirement).some((field) => hasValue(context[field]))
  ));

  let text = String(effectiveSource || "");
  for (let pass = 0; pass < 20 && CONDITIONAL_PATTERN.test(text); pass += 1) {
    CONDITIONAL_PATTERN.lastIndex = 0;
    text = text.replace(CONDITIONAL_PATTERN, (_, field, body) => (
      FIELD_SET.has(field) && hasValue(context[field]) ? body : EMPTY_OPTIONAL_LINE
    ));
  }
  CONDITIONAL_PATTERN.lastIndex = 0;

  text = text.replace(
    /^[ \t]*\{\{\s*([\w.-]+)\s*\}\}[ \t]*$/gm,
    (_, field) => (FIELD_SET.has(field) && hasValue(context[field]) ? scalar(context[field]) : EMPTY_OPTIONAL_LINE),
  );
  text = text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, field) => (
    FIELD_SET.has(field) ? scalar(context[field]) : ""
  ));
  text = text
    .split(/\r?\n/)
    .filter((line) => !line.includes(EMPTY_OPTIONAL_LINE))
    .join("\n");

  const renderErrors = [...validation.errors];
  const invalidFields = validation.usedFields.filter((field) => (
    context[field] !== null
    && context[field] !== undefined
    && !["string", "number", "boolean"].includes(typeof context[field])
  ));
  if (invalidFields.length) renderErrors.push(`Nilai field bukan plain text: ${invalidFields.join(", ")}.`);
  if (missingFields.length) renderErrors.push(`Detail akun belum lengkap: ${missingFields.join(", ")}.`);
  if (/\{\{[\s\S]*?\}\}/.test(text)) renderErrors.push("Template masih memiliki placeholder yang belum diproses.");

  return {
    ok: renderErrors.length === 0,
    text,
    errors: [...new Set(renderErrors)],
    warnings: validation.warnings,
    missingFields,
    usedFields: validation.usedFields.filter((field) => hasValue(context[field])),
  };
}

export function resolveDeliveryTemplateConfig(product = {}, variant = {}) {
  const variantSource = String(variant.deliveryTemplate || "");
  const productSource = String(product.deliveryTemplate || product.messageTemplates?.delivery || "");
  const variantId = String(variant.id || "");
  const sku = String(variant.sku || variant.code || "");

  if (variantSource.trim()) {
    return {
      configured: true,
      scope: "variant",
      source: variantSource,
      version: Math.max(1, Number(variant.deliveryTemplateVersion || 1)),
      requiredFields: normalizeRequiredFields(variant.requiredDeliveryFields),
      updatedAt: String(variant.deliveryTemplateUpdatedAt || variant.updatedAt || ""),
      updatedBy: String(variant.deliveryTemplateUpdatedBy || variant.updatedBy || ""),
      variantId,
      sku,
    };
  }
  if (productSource.trim()) {
    return {
      configured: true,
      scope: "product",
      source: productSource,
      version: Math.max(1, Number(product.deliveryTemplateVersion || product.messageTemplates?.deliveryVersion || 1)),
      requiredFields: normalizeRequiredFields(product.requiredDeliveryFields),
      updatedAt: String(product.deliveryTemplateUpdatedAt || product.updatedAt || ""),
      updatedBy: String(product.deliveryTemplateUpdatedBy || product.updatedBy || ""),
      variantId,
      sku,
    };
  }
  const siblingVariant = (Array.isArray(product.variants) ? product.variants : [])
    .find((item) => String(item.id || "") !== variantId && String(item.deliveryTemplate || "").trim());
  if (siblingVariant) {
    return {
      configured: true,
      scope: "sibling_variant",
      source: String(siblingVariant.deliveryTemplate || ""),
      version: Math.max(1, Number(siblingVariant.deliveryTemplateVersion || 1)),
      requiredFields: normalizeRequiredFields(siblingVariant.requiredDeliveryFields),
      updatedAt: String(siblingVariant.deliveryTemplateUpdatedAt || siblingVariant.updatedAt || ""),
      updatedBy: String(siblingVariant.deliveryTemplateUpdatedBy || siblingVariant.updatedBy || ""),
      variantId,
      sku,
      sourceVariantId: String(siblingVariant.id || ""),
      sourceSku: String(siblingVariant.sku || siblingVariant.code || ""),
    };
  }
  return {
    configured: false,
    scope: "none",
    source: "",
    version: 0,
    requiredFields: [],
    updatedAt: "",
    updatedBy: "",
    variantId,
    sku,
  };
}

export function buildDeliveryTemplateContext({ order = {}, product = {}, variant = {}, account = {} } = {}) {
  const expiry = account.expiresAt || order.expiresAt || "";
  const loginIdentifier = account.loginPhone || account.email || account.username || "";
  const duration = order.duration || account.duration || "";
  const durationDays = Math.max(0, Number(order.durationDays || account.durationDays || 0));
  const normalizedDuration = String(duration).toLowerCase();
  const isDaily = durationDays > 0
    ? durationDays < 30
    : /\bhari\b|\bday\b/.test(normalizedDuration);
  const isMonthly = durationDays > 0
    ? durationDays >= 30
    : /\bbulan\b|\bmonth\b|\bbln\b/.test(normalizedDuration);
  return {
    product_name: product.name || order.product || "",
    variant_name: order.customerVariant || order.variant || variant.name || "",
    sku: order.customerVariantCode || order.variantCode || variant.sku || variant.code || "",
    email: account.email || account.otpEmail || "",
    username: account.username || "",
    login_identifier: loginIdentifier,
    password: account.password || account.canvaLink || account.link || "",
    profile: account.profile || "",
    pin: account.pin || "",
    duration,
    duration_days: durationDays || "",
    is_daily: isDaily ? "1" : "",
    is_monthly: isMonthly ? "1" : "",
    start_date: account.startedAt || order.paidAt || order.createdAt || "",
    rental_end: expiry,
    expiry_date: expiry,
    order_id: order.id || "",
    customer_name: order.customer || account.buyer || "",
    customer_email: order.email || "",
    customer_whatsapp: order.whatsapp || account.whatsapp || "",
    link: account.canvaLink || account.link || "",
  };
}

export function createDeliveryTemplateSnapshot({ order = {}, product = {}, variant = {}, account = {}, renderedAt = "" } = {}) {
  const config = resolveDeliveryTemplateConfig(product, variant);
  if (!config.configured) {
    return {
      status: "not_configured",
      variantId: config.variantId,
      sku: config.sku,
      templateSource: "",
      renderedText: "",
      templateVersion: 0,
      renderedAt,
      usedFields: [],
      missingFields: [],
      errors: ["Template pengiriman belum dikonfigurasi."],
    };
  }

  const context = buildDeliveryTemplateContext({ order, product, variant, account });
  const rendered = renderDeliveryTemplate(config.source, context, {
    requiredFields: config.requiredFields,
  });
  return {
    status: rendered.ok ? "ready" : rendered.missingFields.length ? "incomplete" : "invalid",
    scope: config.scope,
    variantId: config.variantId,
    sku: config.sku,
    templateSource: config.source,
    renderedText: rendered.ok ? rendered.text : "",
    templateVersion: config.version,
    renderedAt,
    usedFields: rendered.usedFields,
    missingFields: rendered.missingFields,
    errors: rendered.errors,
  };
}
