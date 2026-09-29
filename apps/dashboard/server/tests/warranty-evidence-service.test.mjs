import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  decodeWarrantyEvidence,
  readWarrantyEvidence,
  removeWarrantyEvidence,
  saveWarrantyEvidence,
} from "../services/warranty-evidence-service.js";

const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB", "base64");

test("warranty evidence accepts a small real image and stores it outside the database", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "kavya-warranty-evidence-"));
  try {
    const decoded = decodeWarrantyEvidence({
      name: "bukti.png",
      mimeType: "image/png",
      dataUrl: `data:image/png;base64,${pngBytes.toString("base64")}`,
    });
    const metadata = await saveWarrantyEvidence(decoded, {
      claimId: "CLM-1",
      evidenceId: "EVD-1",
      runtimeDir: rootDir,
      createdAt: "2026-08-03 12:00",
    });
    assert.equal("dataUrl" in metadata, false);
    assert.equal(metadata.mimeType, "image/png");
    assert.deepEqual(await readWarrantyEvidence(metadata, { runtimeDir: rootDir }), pngBytes);
    await removeWarrantyEvidence(metadata, { runtimeDir: rootDir });
    await assert.rejects(() => readWarrantyEvidence(metadata, { runtimeDir: rootDir }), /tidak ditemukan/i);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("warranty evidence rejects executable content, MIME mismatch, and oversized payloads", () => {
  assert.throws(() => decodeWarrantyEvidence({
    name: "bukti.html",
    mimeType: "text/html",
    dataUrl: "data:text/html;base64,PHNjcmlwdD4=",
  }), /format bukti/i);
  assert.throws(() => decodeWarrantyEvidence({
    name: "bukti.png",
    mimeType: "image/png",
    dataUrl: `data:image/png;base64,${Buffer.from("not-a-png").toString("base64")}`,
  }), /tidak cocok/i);
  assert.throws(() => decodeWarrantyEvidence({
    name: "besar.png",
    mimeType: "image/png",
    dataUrl: `data:image/png;base64,${Buffer.alloc(800_000).toString("base64")}`,
  }), /terlalu besar/i);
});
