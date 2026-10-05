import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  expect: { timeout: 15_000 },
  testDir: "./e2e",
  timeout: 120_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
