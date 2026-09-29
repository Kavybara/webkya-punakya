import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifyPassword } from "../security.js";
import { DEMO_OWNER, DEMO_RESELLERS } from "../../scripts/demo-credentials.mjs";

const dashboardRoot = new URL("../../", import.meta.url);
const seedScript = fileURLToPath(new URL("../../scripts/seed-demo-database.mjs", import.meta.url));

/**
 * Run the seeder into a throwaway directory and return what it wrote.
 *
 * The seeder is spawned rather than imported because importing it would run it
 * -- the write and the console output are top-level -- and a test that cannot
 * point the seeder somewhere disposable is a test that can only ever write to
 * one place.
 */
function seedInto(directory, name = "kavya-db.json") {
  const target = path.join(directory, name);
  const result = spawnSync(process.execPath, [seedScript, target], { encoding: "utf8" });
  assert.equal(result.status, 0, `the seeder must succeed: ${result.stderr || result.stdout}`);
  return { target, db: JSON.parse(readFileSync(target, "utf8")) };
}

async function withTempDir(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kavya-demo-seed-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("the demo accounts can actually sign in", async () => {
  await withTempDir((dir) => {
    const { db } = seedInto(dir);

    assert.ok(
      verifyPassword(DEMO_OWNER.password, db.settings.ownerPasswordHash),
      "the seeded owner password must verify against the seeded hash, or the demo login is a fiction",
    );

    for (const demo of DEMO_RESELLERS) {
      const reseller = db.resellers.find((item) => item.username === demo.username);
      assert.ok(reseller, `${demo.username} is missing from the seeded database`);
      assert.equal(reseller.isActive, true, `${demo.username} must be seeded active`);
      assert.ok(
        verifyPassword(demo.password, reseller.passwordHash),
        `${demo.username}'s seeded hash does not match its published password`,
      );
    }
  });
});

test("the seed covers every account state the console can paint", async () => {
  await withTempDir((dir) => {
    const { db } = seedInto(dir);
    const byStatus = db.managedAccounts.reduce((acc, account) => {
      acc[account.status] = (acc[account.status] || 0) + 1;
      return acc;
    }, {});

    // An empty table teaches you nothing about a redesign, and the real
    // database has none of these rows at all -- which is the whole reason this
    // seed exists. Each state needs at least two rows, or the reviewer sees a
    // single lonely line where the real thing would be a group.
    for (const status of ["active", "expiring", "expired"]) {
      assert.ok(
        (byStatus[status] || 0) >= 2,
        `expected at least 2 ${status} accounts to review, found ${byStatus[status] || 0}`,
      );
    }

    // The seeded `status` is only a convenience; the server recomputes it from
    // `expiresAt` on read. If the two ever disagree the file misleads whoever
    // reads it, so assert the one rule that decides it.
    const day = 86400000;
    for (const account of db.managedAccounts) {
      const expires = Date.parse(String(account.expiresAt).replace(" ", "T"));
      assert.ok(Number.isFinite(expires), `${account.id} has an unparseable expiresAt: ${account.expiresAt}`);
      const expected = expires <= Date.now()
        ? "expired"
        : (Number(account.durationDays) >= 30 && Math.ceil((expires - Date.now()) / day) <= 5 ? "expiring" : "active");
      assert.equal(account.status, expected, `${account.id} is seeded ${account.status} but its dates say ${expected}`);
    }
  });
});

test("orders, payments, stock and accounts agree with each other", async () => {
  await withTempDir((dir) => {
    const { db } = seedInto(dir);

    // A console that lists an order with no matching payment, or a delivered
    // order with no stock behind it, is a rendering fault the reviewer would
    // report against the redesign rather than against the seed.
    for (const order of db.orders) {
      assert.ok(
        db.payments.some((payment) => payment.orderId === order.id),
        `${order.id} has no matching payment row`,
      );
      if (order.deliveryStatus !== "sent") continue;

      assert.ok(order.deliveredStockIds.length > 0, `${order.id} is sent but delivered nothing`);
      for (const stockId of order.deliveredStockIds) {
        const stock = db.stock.find((item) => item.id === stockId);
        assert.ok(stock, `${order.id} references missing stock ${stockId}`);
        assert.equal(stock.status, "sold", `${stockId} was delivered but its status is ${stock.status}`);
      }
      assert.ok(
        db.managedAccounts.some((account) => account.orderId === order.id),
        `${order.id} was delivered but produced no managed account`,
      );
    }

    // Every warranty claim hangs off an account that actually exists, or the
    // claim list renders rows whose account column is blank.
    for (const claim of db.warrantyClaims) {
      assert.ok(
        db.managedAccounts.some((account) => account.id === claim.accountId),
        `warranty claim ${claim.id} points at missing account ${claim.accountId}`,
      );
    }
  });
});

test("the seed carries no live integration credentials", async () => {
  await withTempDir((dir) => {
    const { db } = seedInto(dir);
    const secretKeys = [
      "pakasirApiKey",
      "pakasirMerchantId",
      "pakasirWebhookSecret",
      "baileyBotToken",
      "baileySessionId",
      "whatsappBotToken",
      "whatsappInboundToken",
      "gmailClientId",
      "gmailClientSecret",
      "gmailRedirectUri",
    ];
    for (const key of secretKeys) {
      assert.equal(
        String(db.settings[key] || "").trim(),
        "",
        `settings.${key} must be blank -- a demo database with a live API key is one npm run away from charging a real card`,
      );
    }

    // Every contact in the seed is `@demo.invalid`, a reserved TLD that cannot
    // resolve. A real address here would mean a real customer's address had
    // leaked into a file meant to be shareable.
    const emails = [
      ...db.orders.map((order) => order.email),
      ...db.stock.map((item) => item.email),
      ...db.managedAccounts.map((account) => account.email),
      ...db.resellers.map((reseller) => reseller.email),
    ].filter(Boolean);
    assert.ok(emails.length > 0, "the seed should contain contact details to check");
    for (const email of emails) {
      assert.ok(
        String(email).endsWith("@demo.invalid"),
        `${email} is not a reserved demo address; a real one may have leaked into the seed`,
      );
    }
  });
});

test("the seeder refuses to overwrite the real database", async () => {
  const realDb = fileURLToPath(new URL("runtime/kavya-db.json", dashboardRoot));
  await stat(realDb); // fail loudly rather than pass vacuously if it moved

  const before = await readFile(realDb);
  const result = spawnSync(process.execPath, [seedScript, realDb], { encoding: "utf8" });

  assert.equal(result.status, 1, "writing over the production database must fail");
  assert.match(result.stderr, /refusing to write into the real runtime directory/);
  assert.deepEqual(
    await readFile(realDb),
    before,
    "the real database must be byte-identical after a refused seed",
  );
});

test("the generated demo database is kept out of the repository", async () => {
  // Assert the pattern that exists rather than the literal path. `runtime/*`
  // and `runtime-*/` are different rules, and only one of them covers the
  // directory the seeder writes into -- so the test has to check the generated
  // path is actually matched, not that some similarly-named line is present.
  const ignore = await readFile(new URL("../../.gitignore", dashboardRoot), "utf8");

  const check = spawnSync("git", ["check-ignore", "-q", "apps/dashboard/runtime-demo/kavya-db.json"], {
    cwd: fileURLToPath(dashboardRoot),
    encoding: "utf8",
  });
  assert.equal(
    check.status,
    0,
    "the generated demo database must be git-ignored; it is a large file that goes stale on every date the accounts are generated relative to",
  );
  assert.ok(ignore.includes("apps/*/runtime-*/"), "the root .gitignore should keep per-run runtime directories out");
});
