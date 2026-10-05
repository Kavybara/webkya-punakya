import { test, expect } from "@playwright/test";
import { withServer, fixtureDatabase } from "../server/tests/helpers/boot-server.mjs";
import { hashPassword } from "../server/security.js";

const testPassword = "fixture-browser-password";
function database() {
  const db = fixtureDatabase();
  db.resellers[0].passwordHash = hashPassword(testPassword);
  return db;
}

async function login(page, base, username, password) {
  await page.goto(`${base}/login`);
  await page.getByLabel("Username atau email", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk ke Kavya", exact: true }).click();
}

test("owner can sign in and see protected diagnostics without bootstrap credentials", async ({ page }) => {
  await withServer(async ({ base }) => {
    const health = await page.request.get(`${base}/api/health`);
    expect(await health.json()).toEqual({ ok: true });
    expect((await page.request.get(`${base}/api/health/details`)).status()).toBe(401);
    await login(page, base, "owner", "boot-test-password");
    await expect(page).toHaveURL(/\/owner-v2(?:\/|$)/);
    await page.goto(`${base}/owner-v2/health`);
    await expect(page.getByRole("heading", { name: "Health Center", exact: true })).toBeVisible();
    const details = await page.request.get(`${base}/api/health/details`);
    expect(details.status()).toBe(200);
    const bootstrap = await page.request.get(`${base}/api/bootstrap`);
    expect(Object.keys(await bootstrap.json()).sort()).toEqual(["whatsappGroupLists", "whatsappRentals"]);
    const cookie = (await page.context().cookies()).find((item) => item.name === "kavya_session");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
  }, { database: database() });
});

test("reseller can open accounts but cannot read owner diagnostics or bootstrap", async ({ page }) => {
  await withServer(async ({ base }) => {
    await login(page, base, "kya", testPassword);
    await expect(page).toHaveURL(/\/reseller-v2\//);
    await page.goto(`${base}/reseller-v2/accounts`);
    await expect(page.getByRole("heading", { name: "Akun Saya", exact: true })).toBeVisible();
    expect((await page.request.get(`${base}/api/health/details`)).status()).toBe(403);
    expect((await page.request.get(`${base}/api/bootstrap`)).status()).toBe(403);
    const stock = await page.request.get(`${base}/api/stock`);
    expect(stock.status()).toBe(200);
    for (const row of await stock.json()) {
      expect(row.password || "").toBe("");
      expect(row.pin || "").toBe("");
    }
  }, { database: database() });
});
