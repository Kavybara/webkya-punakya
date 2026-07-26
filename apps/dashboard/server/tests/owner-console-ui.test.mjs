import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../src/", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("Owner Console is lazy-loaded on a separate rollback-safe route", async () => {
  const router = await source("router/config.tsx");
  assert.match(router, /lazy\(\(\) => import\("\.\.\/pages\/owner-v2\/page"\)\)/);
  assert.match(router, /lazy\([\s\S]{0,100}import\("\.\.\/pages\/owner-v2\/orders\/page"\)[\s\S]{0,20}\)/);
  assert.match(router, /path: "\/owner-v2"/);
  assert.match(router, /path: "\/owner-v2\/orders"/);
  assert.match(router, /path: "\/dashboard"/);
});

test("Owner Console keeps search on the owner-only search API", async () => {
  const search = await source("components/console/ConsoleSearch.tsx");
  assert.match(search, /api\.ownerSearch\(query\.trim\(\)\)/);
  assert.doesNotMatch(search, /api\.(accounts|stock|orders|resellers)\(/);
});

test("Owner Console Overview excludes credential-bearing account APIs and fields", async () => {
  const overview = await source("pages/owner-v2/page.tsx");
  assert.doesNotMatch(overview, /api\.accounts\(/);
  assert.doesNotMatch(overview, /api\.ownerSettings\(/);
  assert.doesNotMatch(overview, /\.password\b|\.resetLink\b|\.signInCode\b|\.verificationCode\b/);
  assert.match(overview, /Password, OTP, PIN, token, dan kredensial akun tidak ditampilkan/);
});

test("Owner Console navigation uses v2 destinations without legacy links", async () => {
  const navigation = await source("components/console/navigation.ts");
  assert.match(navigation, /path: "\/owner-v2\/orders"/);
  for (const path of ["products", "stock", "accounts", "resellers", "operations", "whatsapp", "activities", "integrations"]) {
    assert.match(navigation, new RegExp(`\\/owner-v2\\/${path}`));
  }
  assert.doesNotMatch(navigation, /path: "\/dashboard\//);
});

test("Owner Console orders reuses existing APIs and masks fulfillment credentials", async () => {
  const orders = await source("pages/owner-v2/orders/page.tsx");
  assert.match(orders, /api\.orders\(\)/);
  assert.match(orders, /api\.order\(order\.id\)/);
  assert.match(orders, /api\.markOrderPaid\(/);
  assert.match(orders, /api\.approveOrderManual\(/);
  assert.match(orders, /api\.retryDelivery\(/);
  assert.match(orders, /api\.repairOrderSheets\(/);
  assert.doesNotMatch(orders, /\.password\b|\.pin\b|\.fulfillmentText\b|\.snkText\b/);
  assert.match(orders, /Kredensial akun disembunyikan/);
  assert.match(orders, /Konfirmasi tindakan/);
});

test("Owner Console defines scoped semantic tokens and responsive drawer behavior", async () => {
  const styles = await source("components/console/console.css");
  for (const token of [
    "--console-bg",
    "--console-bg-elevated",
    "--console-surface",
    "--console-text-primary",
    "--console-border",
    "--status-success",
    "--status-warning",
    "--status-danger",
  ]) assert.match(styles, new RegExp(token));
  assert.match(styles, /@media \(max-width: 1023px\)/);
  assert.match(styles, /prefers-reduced-motion/);
});

test("all Owner Console navigation destinations have lazy v2 routes", async () => {
  const router = await source("router/config.tsx");
  for (const path of ["products", "stock", "accounts", "resellers", "operations", "whatsapp", "activities", "integrations", "settings"]) {
    assert.match(router, new RegExp(`path: "\\/owner-v2\\/${path}"`));
  }
  assert.match(router, /path: "\/owner-v2\/integrations\/configure"/);
});

test("Owner Console shell and search do not expose legacy dashboard links", async () => {
  const shell = await source("components/console/ConsoleShell.tsx");
  const search = await source("components/console/ConsoleSearch.tsx");
  assert.doesNotMatch(shell, /to="\/dashboard/);
  assert.match(search, /toConsoleHref/);
});

test("Owner Console integration status does not fetch credential-bearing settings", async () => {
  const integrations = await source("pages/owner-v2/integrations/page.tsx");
  assert.match(integrations, /api\.systemStatus\(\)/);
  assert.doesNotMatch(integrations, /api\.ownerSettings\(\)/);
});

test("Owner Console loads masked integration settings only on the configure route", async () => {
  const configure = await source("pages/owner-v2/integrations/configure/page.tsx");
  assert.match(configure, /api\.ownerSettings\(\)/);
  assert.match(configure, /api\.updateOwnerSettings\(/);
  assert.match(configure, /api\.startGmailOAuth\(\)/);
  assert.match(configure, /api\.setupSheetsTemplate\(\)/);
  assert.match(configure, /type="password"/);
  assert.doesNotMatch(configure, /console\.log/);
});

test("Owner Console catalog and stock preserve advanced owner actions", async () => {
  const products = await source("pages/owner-v2/products/page.tsx");
  const stock = await source("pages/owner-v2/stock/page.tsx");
  assert.match(products, /api\.setVariantOrderLock\(/);
  assert.match(stock, /api\.assignDailyStock\(/);
  assert.match(stock, /api\.googleSheetsPreview\(\)/);
  assert.match(stock, /Belum ada data yang ditulis/);
});

test("Owner Console operations exposes confirmed recovery actions", async () => {
  const operations = await source("pages/owner-v2/operations/page.tsx");
  for (const call of ["releaseStockReservation", "reassignAccount", "retryDelivery", "markOrderPaid", "reconcilePayment"]) {
    assert.match(operations, new RegExp(`api\\.${call}\\(`));
  }
  assert.match(operations, /ConsoleDialogActions/);
  assert.doesNotMatch(operations, /window\.confirm/);
});

test("Owner Console interactive controls are wired to real actions", async () => {
  const shell = await source("components/console/ConsoleShell.tsx");
  const stock = await source("pages/owner-v2/stock/page.tsx");
  const resellers = await source("pages/owner-v2/resellers/page.tsx");
  const orders = await source("pages/owner-v2/orders/page.tsx");
  assert.match(shell, /setNotificationsOpen/);
  assert.match(shell, /to="\/owner-v2\/operations"/);
  assert.match(stock, /previewLoading/);
  assert.match(stock, /Membaca Sheets/);
  assert.match(resellers, /api\.archiveDepositRequests/);
  assert.match(resellers, /Arsip tidak menghapus riwayat audit/);
  assert.match(orders, /closeOrderDetail/);
  assert.match(orders, /next\.delete\("order"\)/);
  assert.match(orders, /detailRequestRef/);
});

test("Owner Console removes automatic account replacement", async () => {
  const accounts = await source("pages/owner-v2/accounts/page.tsx");
  const api = await source("lib/api.ts");
  assert.doesNotMatch(accounts, /replaceAccount|replacementStockId|Terapkan pengganti|Ganti akun/);
  assert.doesNotMatch(api, /replaceAccount\(/);
});

test("data tables only show row selection when a real bulk action exists", async () => {
  const table = await source("components/console/ConsoleDataTable.tsx");
  assert.match(table, /const selectable = Boolean\(bulkAction\)/);
  assert.match(table, /\{selectable \? <th className="console-checkbox-cell">/);
  assert.match(table, /\{selectable \? <td className="console-checkbox-cell">/);
  assert.doesNotMatch(table, /Pilihan dapat dibersihkan tanpa mengubah data/);
});

test("Owner Console rental form only asks for owner-facing rental fields", async () => {
  const whatsapp = await source("pages/owner-v2/whatsapp/page.tsx");
  assert.match(whatsapp, /label="Link grup"/);
  assert.match(whatsapp, /label="Nama owner"/);
  assert.match(whatsapp, /label="Nomor owner"/);
  assert.match(whatsapp, /label="Mulai"/);
  assert.match(whatsapp, /label="Berakhir"/);
  assert.doesNotMatch(whatsapp, /label="Group JID"/);
  assert.doesNotMatch(whatsapp, /label="Harga bulanan"/);
});

test("delivery audit counts rebuilt records once per stock identity", async () => {
  const server = await readFile(new URL("../../server/index.js", import.meta.url), "utf8");
  const deliveryAudit = server.slice(server.indexOf("function buildDeliveryAuditQueue"), server.indexOf("function buildReservedStockQueue"));
  assert.match(deliveryAudit, /const uniqueLinkedAccounts =/);
  assert.match(deliveryAudit, /uniqueLinkedAccounts\.length > qty/);
  assert.doesNotMatch(deliveryAudit, /linkedAccounts\.length > qty/);
});
