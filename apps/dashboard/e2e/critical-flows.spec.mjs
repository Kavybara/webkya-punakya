import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import { withServer, fixtureDatabase } from "../server/tests/helpers/boot-server.mjs";
import { hashPassword } from "../server/security.js";

const password = "fixture-browser-password";
const preload = new URL("./fixtures/provider-transport.mjs", import.meta.url).href;
function fixture() {
  const db = fixtureDatabase();
  db.settings = { pakasirProject: "fixture-project", pakasirApiKey: "fixture-pakasir-key", pakasirWebhookSecret: "fixture-webhook-secret" };
  db.resellers[0].passwordHash = hashPassword(password);
  db.resellers[0].deposit = 0;
  db.stock[0] = { ...db.stock[0], sheetSource: "", email: "fixture-account@example.test", password: "fixture-account-password", profile: "a", pin: "1234" };
  db.products[0].variants[0].deliveryTemplate = "{{email}} {{password}} {{profile}} {{rental_end}}";
  db.products[0].variants[0].requiredDeliveryFields = ["email", "password"];
  db.products[0].variants[0].prices = { "1 Bulan": 25000 };
  return db;
}
async function login(page, base, username, pwd) {
  await page.goto(`${base}/login`);
  await page.getByLabel("Username atau email", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(pwd);
  await page.getByRole("button", { name: "Masuk ke Kavya", exact: true }).click();
  await expect(page).toHaveURL(username === "owner" ? /\/owner-v2/ : /\/reseller-v2/);
}
async function ok(response) {
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBe(true);
  return body;
}

test("purchase, authenticated payment reconciliation and fulfillment are idempotent", async ({ page }) => {
  await withServer(async ({ base, databasePath }) => {
    await login(page, base, "kya", password);
    const order = await ok(await page.request.post(`${base}/api/orders`, { data: { productId: "netflix", variantId: "netflix-1m", duration: "1 Bulan", qty: 1, device: "Android TV" } }));
    expect(order.qrisStatus).toBe("pending");
    expect((await page.request.post(`${base}/api/pakasir/webhook`, { data: { order_id: order.paymentRef, status: "completed" } })).status()).toBe(401);
    const payload = { order_id: order.paymentRef, status: "completed" };
    await ok(await page.request.post(`${base}/api/pakasir/webhook`, { headers: { "x-pakasir-secret": "fixture-webhook-secret" }, data: payload }));
    await ok(await page.request.post(`${base}/api/pakasir/webhook`, { headers: { "x-pakasir-secret": "fixture-webhook-secret" }, data: payload }));
    const completed = await ok(await page.request.get(`${base}/api/orders/${order.id}`));
    expect(completed.orderStatus).toBe("completed");
    const db = JSON.parse(await fs.readFile(databasePath, "utf8"));
    expect(db.managedAccounts.filter((item) => item.orderId === order.id)).toHaveLength(1);
    expect(db.stock[0].status).toBe("sold");
    expect(db.resellers[0].deposit).toBe(0);
    await page.goto(`${base}/reseller-v2/accounts`);
    await expect(page.getByRole("heading", { name: "Akun Saya", exact: true })).toBeVisible();
    const account = db.managedAccounts[0];
    const delivery = await ok(await page.request.get(`${base}/api/accounts/${account.id}/delivery`));
    expect(JSON.stringify(delivery)).toContain("fixture-account-password");
  }, { database: fixture(), preload });
});

test("reseller completes catalog selection, checkout and account delivery through the browser", async ({ page }, testInfo) => {
  await withServer(async ({ base, databasePath }) => {
    await login(page, base, "kya", password);
    await page.goto(`${base}/reseller-v2/catalog`);
    const product = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Netflix", exact: true }) });
    await product.getByRole("button").first().click();
    await product.getByRole("button", { name: /1 Bulan/ }).first().click();
    await product.getByRole("button", { name: "Lanjut ke Checkout", exact: true }).click();
    await expect(page).toHaveURL(/\/reseller\/checkout/);
    await page.getByLabel(/Netflix Device/).fill("Android TV");
    await page.screenshot({ path: testInfo.outputPath("checkout.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const created = page.waitForResponse((response) => response.url().endsWith("/api/orders") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Lanjut ke Pembayaran", exact: true }).click();
    const order = await ok(await created);
    await expect(page.getByRole("heading", { name: "Selesaikan pembayaran", exact: true })).toBeVisible();
    // Simulate the provider callback; every reseller action remains in the UI.
    await ok(await page.request.post(`${base}/api/pakasir/webhook`, {
      headers: { "x-pakasir-secret": "fixture-webhook-secret" },
      data: { order_id: order.paymentRef, status: "completed" },
    }));
    await page.getByRole("button", { name: "Cek Status Pembayaran", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Pesanan selesai", exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Tampilkan", exact: true }).click();
    await expect(page.getByText(/fixture-account-password/).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("delivered.png"), fullPage: true });
    const saved = JSON.parse(await fs.readFile(databasePath, "utf8"));
    expect(saved.orders).toHaveLength(1);
    expect(saved.orders[0].id).toBe(order.id);
    expect(saved.orders[0].orderStatus).toBe("completed");
    expect(saved.managedAccounts.filter((item) => item.orderId === order.id)).toHaveLength(1);
  }, { database: fixture(), preload });
});

test("manual warranty replacement and expired credential access stay isolated", async ({ page }) => {
  const db = fixture();
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 30 * 86400000).toISOString();
  db.orders = [{ id: "ORD-FIXTURE", resellerId: "res-kya", whatsapp: "628111222333", productId: "netflix", variantId: "netflix-1m", deliveredStockIds: ["stk-1"], durationDays: 30, duration: "1 Bulan", orderStatus: "completed", qrisStatus: "paid" }];
  db.stock[0].status = "sold";
  db.managedAccounts = [{ id: "acct-active", stockId: "stk-1", orderId: "ORD-FIXTURE", sourceOrderId: "ORD-FIXTURE", resellerId: "res-kya", productId: "netflix", variantId: "netflix-1m", product: "Netflix", variant: "1 Bulan", email: "fixture-account@example.test", password: "fixture-account-password", profile: "a", startedAt: now, expiresAt: future, durationDays: 30, status: "active" },
    { id: "acct-expired", resellerId: "res-kya", product: "Netflix", email: "expired@example.test", password: "expired-canary-password", pin: "9876", expiresAt: "2020-01-01", status: "expired" }];
  await withServer(async ({ base, databasePath }) => {
    await login(page, base, "owner", "boot-test-password");
    const claimResult = await ok(await page.request.post(`${base}/api/warranty-claims`, { data: { accountId: "acct-active", issue: "Tidak dapat login" } }));
    const claimId = claimResult.claim?.id || claimResult.id;
    const replacementData = { reason: "Fixture replacement", account: { email: "new@example.test", password: "fixture-replacement-password", profile: "b" } };
    const first = await ok(await page.request.post(`${base}/api/warranty-claims/${claimId}/replace-manual`, { data: replacementData }));
    expect(first.claim.status).toBe("replaced");
    const again = await ok(await page.request.post(`${base}/api/warranty-claims/${claimId}/replace-manual`, { data: replacementData }));
    expect(again.idempotent).toBe(true);
    const saved = JSON.parse(await fs.readFile(databasePath, "utf8"));
    expect(saved.managedAccounts.filter((item) => item.email === "new@example.test")).toHaveLength(1);
    await page.goto("about:blank");
    await page.request.post(`${base}/api/auth/logout`);
    await login(page, base, "kya", password);
    const accounts = await ok(await page.request.get(`${base}/api/accounts`));
    expect(JSON.stringify(accounts)).not.toContain("expired-canary-password");
    const delivery = await page.request.get(`${base}/api/accounts/acct-expired/delivery`);
    expect(await delivery.text()).not.toContain("expired-canary-password");
    expect((await page.request.get(`${base}/api/accounts/acct-expired/credentials`)).status()).toBe(403);
    await page.goto(`${base}/reseller-v2/warranty`);
    await expect(page.getByRole("heading", { name: /Garansi/ }).first()).toBeVisible();
  }, { database: db, preload });
});

test("rental active and paused states persist through owner update and page reload", async ({ page }) => {
  const db = fixture();
  db.whatsappRentals = [{ id: "group@g.us", groupJid: "group@g.us", name: "Fixture Rental", status: "active", startedAt: "2026-01-01", endsAt: "2030-01-01", daysLeft: 30 }];
  await withServer(async ({ base, databasePath }) => {
    await login(page, base, "owner", "boot-test-password");
    await ok(await page.request.put(`${base}/api/whatsapp/rentals/group%40g.us`, { data: { status: "paused" } }));
    const rentals = await ok(await page.request.get(`${base}/api/whatsapp/rentals`));
    expect(JSON.stringify(rentals)).toContain("paused");
    expect(JSON.parse(await fs.readFile(databasePath, "utf8")).whatsappRentals[0].status).toBe("paused");
    await page.goto(`${base}/owner-v2/rental`);
    await page.reload();
    await expect(page.getByText("Fixture Rental", { exact: true })).toBeVisible();
  }, { database: db, preload });
});
