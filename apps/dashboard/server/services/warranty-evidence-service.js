import fs from "node:fs/promises";
import path from "node:path";

const MAX_EVIDENCE_BYTES = 700_000;
const MIME_EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
]);

function fail(message, status = 400, code = "warranty_evidence_error") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function evidenceRoot(options = {}) {
  const runtimeDir = options.runtimeDir || process.env.RUNTIME_PATH || path.join(process.cwd(), "runtime");
  return path.join(path.resolve(runtimeDir), "warranty-evidence");
}

function validSignature(buffer, mimeType) {
  if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/webp") return buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

export function decodeWarrantyEvidence(payload = {}) {
  const mimeType = String(payload.mimeType || "").trim().toLowerCase();
  if (!MIME_EXTENSIONS.has(mimeType)) fail("Format bukti harus PNG, JPEG, atau WebP", 400, "unsupported_evidence_type");
  const dataUrl = String(payload.dataUrl || "");
  const match = dataUrl.match(/^data:([^;,]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match || match[1].toLowerCase() !== mimeType) fail("Format bukti tidak valid", 400, "invalid_evidence_data");
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (!buffer.length || buffer.length > MAX_EVIDENCE_BYTES) fail("Ukuran bukti terlalu besar", 413, "evidence_too_large");
  if (!validSignature(buffer, mimeType)) fail("Isi bukti tidak cocok dengan format file", 400, "evidence_signature_mismatch");
  return {
    buffer,
    mimeType,
    originalName: path.basename(String(payload.name || `bukti${MIME_EXTENSIONS.get(mimeType)}`)).slice(0, 120),
    extension: MIME_EXTENSIONS.get(mimeType),
  };
}

export async function saveWarrantyEvidence(decoded, options = {}) {
  const claimId = String(options.claimId || "").replace(/[^a-z0-9_-]/gi, "");
  const evidenceId = String(options.evidenceId || "").replace(/[^a-z0-9_-]/gi, "");
  if (!claimId || !evidenceId) fail("Identitas bukti tidak valid", 400, "invalid_evidence_identity");
  const root = evidenceRoot(options);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const storageName = `${claimId}-${evidenceId}${decoded.extension}`;
  await fs.writeFile(path.join(root, storageName), decoded.buffer, { mode: 0o600, flag: "wx" });
  return {
    id: evidenceId,
    mimeType: decoded.mimeType,
    originalName: decoded.originalName,
    storageName,
    size: decoded.buffer.length,
    createdAt: options.createdAt || "",
  };
}

function evidencePath(metadata = {}, options = {}) {
  const storageName = path.basename(String(metadata.storageName || ""));
  if (!storageName || storageName !== metadata.storageName) fail("Bukti tidak ditemukan", 404, "evidence_not_found");
  return path.join(evidenceRoot(options), storageName);
}

export async function readWarrantyEvidence(metadata = {}, options = {}) {
  try {
    return await fs.readFile(evidencePath(metadata, options));
  } catch (error) {
    if (error.code === "ENOENT") fail("Bukti tidak ditemukan", 404, "evidence_not_found");
    throw error;
  }
}

export async function removeWarrantyEvidence(metadata = {}, options = {}) {
  await fs.rm(evidencePath(metadata, options), { force: true });
}
