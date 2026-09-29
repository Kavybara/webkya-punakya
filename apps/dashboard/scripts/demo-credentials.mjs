/**
 * The demo accounts, in one place.
 *
 * These exist only in the synthetic database that `seed-demo-database.mjs`
 * writes. They are not credentials to anything: the demo database holds
 * invented data and blank integration secrets, so there is no real account,
 * provider, or customer behind any of them.
 *
 * A module of its own because the seeder and the API runner both need them, and
 * importing the seeder from the runner would re-run the seeder -- its writes
 * are top-level.
 */
export const DEMO_OWNER = { username: "owner.demo", password: "DemoOwner#2026" };

export const DEMO_RESELLERS = [
  { username: "reseller.demo", password: "DemoReseller#2026", name: "Demo Reseller Utama" },
  { username: "reseller.dua", password: "DemoReseller#2026", name: "Demo Reseller Dua" },
];
