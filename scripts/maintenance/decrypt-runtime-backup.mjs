import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env");
if (fsSync.existsSync(envPath) && process.env.BACKUP_ENCRYPTION_KEY === undefined) {
  const line = fsSync.readFileSync(envPath, "utf8").split(/\r?\n/).find((item) => item.trim().startsWith("BACKUP_ENCRYPTION_KEY="));
  if (line) {
    let value = line.slice(line.indexOf("=") + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env.BACKUP_ENCRYPTION_KEY = value;
  }
}

const input = process.argv[2];
if (!input) throw new Error("Usage: npm run runtime:backup:decrypt -- <File Backup.tar.gz.enc> [output.tar.gz]");

const passphrase = String(process.env.BACKUP_ENCRYPTION_KEY || "");
if (passphrase.length < 16) throw new Error("BACKUP_ENCRYPTION_KEY minimal 16 karakter wajib tersedia di environment");

const payload = await fs.readFile(path.resolve(input));
const magic = Buffer.from("KAVYA-BACKUP-V1\n");
if (!payload.subarray(0, magic.length).equals(magic)) throw new Error("Format backup terenkripsi tidak dikenali");
const headerEnd = payload.indexOf(10, magic.length);
if (headerEnd < 0) throw new Error("Header backup terenkripsi rusak");
const header = JSON.parse(payload.subarray(magic.length, headerEnd).toString("utf8"));
const key = crypto.scryptSync(passphrase, Buffer.from(header.salt, "base64url"), 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64url"));
decipher.setAuthTag(Buffer.from(header.tag, "base64url"));
const plaintext = Buffer.concat([decipher.update(payload.subarray(headerEnd + 1)), decipher.final()]);
const output = path.resolve(process.argv[3] || input.replace(/\.enc$/i, ""));
await fs.writeFile(output, plaintext, { mode: 0o600 });
console.log(output);
