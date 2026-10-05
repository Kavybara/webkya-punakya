import crypto from "node:crypto";
import { formatWithOptions } from "node:util";

const secrets = new Set();
const sensitive = /password|passwd|secret|token|api.?key|private.?key|credential|\bpin\b|otp/i;

export function registerLogSecrets(values = {}) {
  for (const [key, value] of Object.entries(values)) {
    if (sensitive.test(key) && typeof value === "string" && value.length >= 4) secrets.add(value);
  }
}

function redactText(text) {
  let value = text.replace(/Bearer\s+[^\s"',}]+/gi, "Bearer [REDACTED]")
    .replace(/((?:password|passwd|api[_-]?key|token|secret|pin|otp)\s*[=:]\s*)[^\s&"',}]+/gi, "$1[REDACTED]")
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]");
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) value = value.split(secret).join("[REDACTED]");
  return value;
}

export function redactLogValue(value, seen = new WeakSet()) {
  if (typeof value === "string") return redactText(value);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (value instanceof Error) return { name: value.name, code: value.code, message: redactText(value.message) };
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitive.test(key) ? "[REDACTED]" : redactLogValue(item, seen)]));
}

export function installConsoleRedaction({ structured = false } = {}) {
  registerLogSecrets(process.env);
  const originals = {};
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    originals[level] = console[level];
    console[level] = (...args) => {
      const message = redactText(formatWithOptions({ colors: false }, ...args.map((arg) => redactLogValue(arg))));
      originals[level].call(console, structured ? JSON.stringify({ timestamp: new Date().toISOString(), level, message }) : message);
    };
  }
  return () => { for (const [level, original] of Object.entries(originals)) console[level] = original; };
}

export function requestTelemetry(write = (record) => console.info(JSON.stringify(record))) {
  return (req, res, next) => {
    const started = performance.now();
    req.requestId = crypto.randomUUID();
    res.setHeader("X-Request-ID", req.requestId);
    res.once("finish", () => write({ event: "http_request", requestId: req.requestId,
      method: req.method, route: req.route?.path || "unmatched", status: res.statusCode,
      durationMs: Math.round(performance.now() - started) }));
    next();
  };
}
