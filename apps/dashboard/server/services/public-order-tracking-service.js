import crypto from "node:crypto";

import { createAttemptLimiter } from "../lib/attempt-limiter.js";

const GENERIC_TRACKING_ERROR = "Pesanan tidak ditemukan atau data verifikasi tidak sesuai.";

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value = "") {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

function constantTimeEqual(left = "", right = "") {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function contactCandidates(order = {}) {
  const candidates = new Set();
  const add = (value) => {
    const text = normalizeText(value);
    if (text) candidates.add(text);
    const phone = normalizePhone(value);
    if (phone) candidates.add(phone);
  };
  add(order.whatsapp);
  for (const email of String(order.email || "").split(/[\s,;]+/)) add(email);
  for (const email of order.customerEmails || []) add(email);
  return candidates;
}

function maskEmail(value = "") {
  const [name, domain] = String(value || "").split("@");
  if (!name || !domain) return "";
  return `${name.slice(0, 2)}${"*".repeat(Math.max(3, name.length - 2))}@${domain}`;
}

function maskPhone(value = "") {
  const phone = normalizePhone(value);
  if (!phone) return "";
  const suffix = phone.slice(-3);
  return `${phone.slice(0, Math.min(2, phone.length))}${"*".repeat(Math.max(5, phone.length - 5))}${suffix}`;
}

export function createTrackingToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function ensureOrderTrackingToken(order = {}) {
  if (!order.trackingToken) order.trackingToken = createTrackingToken();
  return order.trackingToken;
}

export function findOrderForPublicTracking(orders = [], input = {}) {
  const token = String(input.trackingToken || "").trim();
  if (token) {
    return orders.find((order) => (
      order.trackingToken
      && constantTimeEqual(order.trackingToken, token)
    )) || null;
  }

  const orderId = normalizeText(input.orderId);
  const verificationText = normalizeText(input.verification);
  const verificationPhone = normalizePhone(input.verification);
  if (!orderId || (!verificationText && !verificationPhone)) return null;

  const order = orders.find((item) => normalizeText(item.id) === orderId);
  if (!order) return null;
  const candidates = contactCandidates(order);
  return candidates.has(verificationText) || candidates.has(verificationPhone) ? order : null;
}

export function safeTrackingOrder(order = {}) {
  const maskedEmail = maskEmail(order.customerEmails?.[0] || String(order.email || "").split(/[\s,;]+/)[0] || "");
  const maskedPhone = maskPhone(order.whatsapp || "");
  return {
    orderId: order.id || "",
    product: order.product || "",
    variant: order.variant || "",
    paymentStatus: order.qrisStatus || "",
    orderStatus: order.orderStatus || "",
    processStatus: order.deliveryStatus || "",
    createdAt: order.createdAt || "",
    paidAt: order.paidAt || order.paymentPaidAt || "",
    customerContact: maskedEmail || maskedPhone,
    helpAvailable: true,
  };
}

export function safeTrackingPayment(payment = {}, order = {}) {
  return {
    ref: payment.ref || "",
    orderId: order.id || payment.orderId || "",
    status: payment.status || order.qrisStatus || "",
    amount: Number(payment.amount || order.paymentDue || 0),
    createdAt: payment.createdAt || order.createdAt || "",
    expiresAt: payment.expiresAt || order.paymentExpiresAt || "",
    paymentUrl: payment.paymentUrl || order.qrisUrl || "",
    qrisText: payment.qrisText || payment.qrString || payment.paymentUrl || "",
    qrString: payment.qrString || "",
    totalPayment: Number(payment.totalPayment || payment.amount || order.paymentDue || 0),
    paymentMethod: payment.paymentMethod || order.paymentMethod || "QRIS",
  };
}

export function createPublicTrackingLimiter(options = {}) {
  return createAttemptLimiter({
    maxAttempts: options.maxAttempts || process.env.TRACKING_MAX_ATTEMPTS || 8,
    windowMs: options.windowMs || process.env.TRACKING_WINDOW_MS || 15 * 60 * 1000,
    now: options.now,
  });
}

export { GENERIC_TRACKING_ERROR };
