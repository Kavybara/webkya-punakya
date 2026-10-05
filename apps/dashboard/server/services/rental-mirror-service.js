import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export function canonicalRentalMap(db = {}) {
  if (!Array.isArray(db.whatsappRentals)) throw new Error("canonical_rentals_missing");
  return Object.fromEntries(db.whatsappRentals.flatMap((row) => {
    const id = String(row.groupJid || row.id || "");
    if (!id.endsWith("@g.us")) return [];
    const parsed = Date.parse(row.endsAt || "");
    const expired = Number(row.expired || row.expiresAt || row.expiredAt) || (Number.isFinite(parsed) ? parsed : 0);
    return [[id, { ...row, start: row.startedAt || row.start || "", expired }]];
  }));
}

const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function createRentalMirror({ readCanonical, targets, journalPath, io = fs }) {
  let queue = Promise.resolve();
  async function atomic(file, content) {
    await io.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await io.writeFile(temp, content, { mode: 0o600 });
      await io.chmod(temp, 0o600);
      for (let attempt = 0; ; attempt++) {
        try { await io.rename(temp, file); break; }
        catch (error) {
          if (!["EACCES", "EBUSY", "EPERM"].includes(error.code) || attempt >= 9) throw error;
          await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
        }
      }
    } finally {
      await io.rm(temp, { force: true }).catch(() => undefined);
    }
  }
  async function read(file) {
    try { return await io.readFile(file, "utf8"); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
  async function health() {
    const expected = digest(canonicalRentalMap(await readCanonical()));
    if (await read(journalPath) !== null) return { status: "pending" };
    for (const file of targets) {
      try { if (digest(JSON.parse(await read(file))) !== expected) return { status: "pending" }; }
      catch { return { status: "pending" }; }
    }
    return { status: "synced" };
  }
  async function reconcileNow() {
    const data = canonicalRentalMap(await readCanonical());
    const content = `${JSON.stringify(data, null, 2)}\n`;
    const before = await Promise.all(targets.map(read));
    const changed = [];
    await atomic(journalPath, JSON.stringify({ status: "pending", hash: digest(data), createdAt: new Date().toISOString() }));
    try {
      for (let index = 0; index < targets.length; index++) {
        await atomic(targets[index], content);
        changed.push(index);
      }
      await io.rm(journalPath, { force: true });
      return { status: "synced" };
    } catch (error) {
      let rollbackFailed = false;
      for (const index of changed.reverse()) {
        try {
          if (before[index] === null) await io.rm(targets[index], { force: true });
          else await atomic(targets[index], before[index]);
        } catch { rollbackFailed = true; }
      }
      // The durable journal survives failures and restart. Readers never use mirrors.
      return { status: "pending", errorCode: error.code || "mirror_write_failed", rollbackFailed };
    }
  }
  return {
    health,
    reconcile() {
      const run = queue.then(reconcileNow, reconcileNow);
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
