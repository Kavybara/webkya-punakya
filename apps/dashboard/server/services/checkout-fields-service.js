const FIELD_DEFINITIONS = {
  customerDevice: {
    key: "customerDevice",
    label: "Device Customer",
    type: "text",
    placeholder: "Contoh: Samsung A15, iPhone 13, Android TV",
    helperText: "Wajib diisi agar admin dapat melakukan audit akun.",
  },
  customerEmail: {
    key: "customerEmail",
    label: "Email Customer",
    type: "email",
    placeholder: "contoh@gmail.com",
    helperText: "Email yang akan menerima akses produk.",
  },
  customerWhatsapp: {
    key: "customerWhatsapp",
    label: "Nomor WhatsApp",
    type: "tel",
    placeholder: "08123456789",
    helperText: "Nomor WhatsApp customer untuk data pesanan.",
  },
  customerPlan: {
    key: "customerPlan",
    label: "Plan",
    type: "text",
    placeholder: "Masukkan plan customer",
    helperText: "",
  },
};

const HEADER_TO_FIELD = new Map([
  ["DEVICE", "customerDevice"],
  ["PERANGKAT", "customerDevice"],
  ["DEVICECUSTOMER", "customerDevice"],
  ["CUSTOMERDEVICE", "customerDevice"],
  ["EMAILCUSTOMER", "customerEmail"],
  ["EMAILCUST", "customerEmail"],
  ["EMAILCUSTOMERCANVA", "customerEmail"],
  ["CUSTOMEREMAIL", "customerEmail"],
  ["MEMBEREMAIL", "customerEmail"],
  ["PLAN", "customerPlan"],
]);

export function normalizeCheckoutHeader(value = "") {
  return String(value || "")
    .replace(/\r?\n/g, " ")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

export function normalizeCheckoutField(input = {}) {
  if (!input || typeof input !== "object") return null;
  const key = String(input.key || "").trim();
  const defaults = FIELD_DEFINITIONS[key];
  if (!defaults) return null;
  return {
    ...defaults,
    label: String(input.label || defaults.label).trim(),
    type: ["text", "email", "tel", "select"].includes(String(input.type || ""))
      ? String(input.type)
      : defaults.type,
    required: input.required !== false,
    placeholder: String(input.placeholder ?? defaults.placeholder).trim(),
    helperText: String(input.helperText ?? input.helper ?? defaults.helperText).trim(),
    minItems: Math.max(1, Math.floor(Number(input.minItems || 1))),
    options: Array.isArray(input.options)
      ? input.options.map((item) => String(item || "").trim()).filter(Boolean)
      : undefined,
  };
}

export function checkoutFieldsFromHeaders(headers = [], options = {}) {
  const seen = new Set();
  const fields = [];
  for (const header of headers) {
    const key = HEADER_TO_FIELD.get(normalizeCheckoutHeader(header));
    if (!key || seen.has(key)) continue;
    if (key === "customerPlan" && options.customerChoosesPlan !== true) continue;
    seen.add(key);
    fields.push(normalizeCheckoutField({ key, required: true }));
  }
  return fields.filter(Boolean);
}

export function legacyRequirementToCheckoutFields(requirement = {}, qty = 1) {
  const field = String(requirement?.customerField || "").trim().toLowerCase();
  const key = field === "email" ? "customerEmail" : field === "device" ? "customerDevice" : "";
  if (!key) return [];
  return [
    normalizeCheckoutField({
      key,
      required: requirement.required !== false,
      minItems: field === "email"
        ? Math.max(Number(qty || 1), Number(requirement.minItems || 1))
        : Number(requirement.minItems || 1),
      label: requirement.label,
      placeholder: requirement.placeholder,
      helperText: requirement.helper || requirement.helperText,
    }),
  ].filter(Boolean);
}

export function checkoutFieldsForVariant(product = {}, variant = {}, options = {}) {
  const qty = Math.max(1, Math.floor(Number(options.qty || 1)));
  const configured = Array.isArray(variant.checkoutFields)
    ? variant.checkoutFields
    : Array.isArray(product.checkoutFields)
      ? product.checkoutFields
      : null;
  const sheetConfigured = Array.isArray(variant.sheetCheckoutFields)
    ? variant.sheetCheckoutFields
    : Array.isArray(product.sheetCheckoutFields)
      ? product.sheetCheckoutFields
      : null;
  const source = configured || sheetConfigured;
  if (source) {
    return source
      .map((field) => normalizeCheckoutField(field))
      .filter(Boolean)
      .map((field) => field.key === "customerEmail" ? { ...field, minItems: Math.max(qty, field.minItems) } : field);
  }
  return legacyRequirementToCheckoutFields(
    variant.checkoutRequirements || product.checkoutRequirements || options.legacyRequirements,
    qty,
  );
}

function normalizeFieldValue(field, rawValue, options = {}) {
  const raw = Array.isArray(rawValue) ? rawValue.join(", ") : String(rawValue || "");
  if (field.key === "customerEmail") {
    return raw
      .split(/[\s,;]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }
  if (field.key === "customerWhatsapp") {
    return options.normalizeWhatsapp ? options.normalizeWhatsapp(raw) : raw.trim();
  }
  return raw.trim();
}

export function validateCheckoutFieldValues(fields = [], values = {}, options = {}) {
  const normalized = {};
  const errors = {};
  for (const field of fields.map(normalizeCheckoutField).filter(Boolean)) {
    const value = normalizeFieldValue(field, values[field.key], options);
    normalized[field.key] = value;
    const count = Array.isArray(value) ? value.length : value ? 1 : 0;
    if (field.required && count < field.minItems) {
      errors[field.key] = `${field.label} wajib diisi${field.minItems > 1 ? ` minimal ${field.minItems} item` : ""}.`;
      continue;
    }
    if (field.key === "customerEmail" && Array.isArray(value)) {
      const invalid = value.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
      if (invalid || (field.required && value.length < field.minItems)) {
        errors[field.key] = `${field.label} harus berisi email yang valid.`;
      }
    }
  }
  return { ok: Object.keys(errors).length === 0, values: normalized, errors };
}

export function checkoutValuesForOrder(validatedValues = {}) {
  const customerEmails = Array.isArray(validatedValues.customerEmail) ? validatedValues.customerEmail : [];
  return {
    checkoutData: {
      customerDevice: String(validatedValues.customerDevice || ""),
      customerEmail: customerEmails.join(", "),
      customerWhatsapp: String(validatedValues.customerWhatsapp || ""),
      customerPlan: String(validatedValues.customerPlan || ""),
    },
    email: customerEmails.join(", "),
    customerEmails,
    device: String(validatedValues.customerDevice || ""),
    customerWhatsapp: String(validatedValues.customerWhatsapp || ""),
    customerPlan: String(validatedValues.customerPlan || ""),
  };
}
