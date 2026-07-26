import { createHash } from "node:crypto";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

export function snapshotVersion(snapshot = {}) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(snapshot)))
    .digest("hex")
    .slice(0, 20);
}
