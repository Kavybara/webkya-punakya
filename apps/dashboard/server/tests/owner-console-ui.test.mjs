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
  for (const path of ["products", "stock", "accounts", "resellers", "whatsapp", "activities", "integrations"]) {
    assert.match(navigation, new RegExp(`\\/owner-v2\\/${path}`));
  }
  assert.doesNotMatch(navigation, /path: "\/owner-v2\/operations"/);
  assert.doesNotMatch(navigation, /path: "\/dashboard\//);
});

test("Owner Console provides owner-only account access lookup", async () => {
  const [navigation, router, page, api] = await Promise.all([
    source("components/console/navigation.ts"),
    source("router/config.tsx"),
    source("pages/owner-v2/account-access/page.tsx"),
    source("lib/api.ts"),
  ]);
  assert.match(navigation, /path: "\/owner-v2\/account-access"/);
  assert.match(router, /path: "\/owner-v2\/account-access"/);
  assert.match(page, /api\.ownerAccountAccessLookup\(/);
  assert.match(page, /api\.ownerAccountAccessAccounts\(/);
  assert.match(page, /Sign-in Code/);
  assert.match(page, /Verification Code/);
  assert.match(page, /Household/);
  assert.match(page, /Disney OTP/);
  assert.match(page, /label, All Mail, dan Inbox/);
  assert.doesNotMatch(page, /localStorage|console\.log/);
  assert.match(api, /\/owner\/account-access\/lookup/);
  assert.match(api, /\/owner\/account-access\/accounts/);
});

test("Owner Console warranty queue uses the dedicated claim and replacement APIs", async () => {
  const [navigation, router, warranty, operations, server, warrantyRoutes] = await Promise.all([
    source("components/console/navigation.ts"),
    source("router/config.tsx"),
    source("pages/owner-v2/warranty/page.tsx"),
    source("pages/owner-v2/operations/page.tsx"),
    source("../server/index.js"),
    source("../server/routes/warranty-routes.js"),
  ]);
  assert.match(navigation, /path: "\/owner-v2\/warranty"/);
  assert.match(router, /path: "\/owner-v2\/warranty"/);
  assert.match(warranty, /api\.warrantyClaims\(\)/);
  assert.match(warranty, /api\.warrantyReplacementCandidates\(/);
  assert.match(warranty, /api\.replaceWarrantyAccount\(/);
  assert.match(warranty, /api\.warrantyEvidenceUrl\(/);
  assert.match(warranty, /api\.retryWarrantyStockReviewSync\(/);
  assert.match(warranty, /Tambah klaim manual/);
  assert.match(warranty, /label="Reseller"/);
  assert.match(warranty, /manualResellers\.map/);
  assert.match(warranty, /Pilih reseller terlebih dahulu/);
  assert.match(warranty, /option\.resellerId === manualResellerId/);
  assert.match(warranty, /Tanpa Order ID/);
  assert.match(warranty, /actionLockRef\.current/);
  assert.match(warranty, /Aksi tersimpan/);
  assert.match(warranty, /ConsoleActionToast/);
  assert.match(warranty, /Antrean Aktif/);
  assert.match(warranty, /Riwayat/);
  assert.match(warranty, /rows=\{visibleClaims\}/);
  assert.match(warranty, /activeStatuses\.has\(claim\.status\)/);
  assert.doesNotMatch(warranty, /await openClaim\(created\)/);
  assert.match(warranty, /api\.warrantyManualClaimOptions\(\)/);
  assert.match(warranty, /api\.createWarrantyClaim\(/);
  assert.match(warranty, /profil berbeda/);
  assert.match(warranty, /Coba Sync Ulang/);
  assert.match(warranty, /Catatan Owner.*wajib/);
  assert.match(server, /manual-warranty-sync-/);
  assert.match(operations, /warranty_sync/);
  assert.match(warrantyRoutes, /result\.idempotent/);
  assert.match(warrantyRoutes, /normalizedStatus === currentStatus/);
  assert.match(warrantyRoutes, /requestedNote === currentNote/);
  assert.doesNotMatch(warranty, /candidate\.password|candidate\.pin/);
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
  assert.match(shell, /buildOwnerNotifications/);
  assert.match(stock, /previewLoading/);
  assert.match(stock, /Membaca Sheets/);
  assert.match(resellers, /api\.archiveDepositRequests/);
  assert.match(resellers, /rows=\{pending\}/);
  assert.match(resellers, /dipindahkan dari antrean aktif/);
  assert.match(shell, /Semua antrean operasional sudah bersih/);
  assert.match(orders, /closeOrderDetail/);
  assert.match(orders, /next\.delete\("order"\)/);
  assert.match(orders, /detailRequestRef/);
});

test("Owner Console notification center aggregates live operational queues", async () => {
  const [shell, notifications] = await Promise.all([
    source("components/console/ConsoleShell.tsx"),
    source("components/console/ownerNotifications.ts"),
  ]);
  assert.match(shell, /api\.operationsCenter\(\)/);
  assert.match(shell, /api\.warrantyClaims\(\)/);
  assert.match(shell, /api\.whatsappRentals\(\)/);
  assert.match(shell, /Tandai dibaca/);
  assert.match(shell, /owner-notification-seen-v1/);
  assert.match(notifications, /WhatsApp terputus/);
  assert.match(notifications, /Garansi perlu diproses/);
  assert.match(notifications, /Rental hampir berakhir/);
  assert.match(notifications, /new Map/);
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
  assert.match(table, /\{selectable \? <td className="console-checkbox-cell" data-label="Pilih">/);
  assert.doesNotMatch(table, /Pilihan dapat dibersihkan tanpa mengubah data/);
});

test("shared data tables keep column context on narrow screens", async () => {
  const [table, styles] = await Promise.all([
    source("components/console/ConsoleDataTable.tsx"),
    source("components/console/console.css"),
  ]);
  assert.match(table, /data-label=\{column\.header\}/);
  assert.match(styles, /content:\s*attr\(data-label\)/);
  assert.match(styles, /\.console-table-scroll tbody tr/);
});

test("public store aliases reach the live catalog instead of the not-found page", async () => {
  const router = await source("router/config.tsx");
  assert.match(router, /path: "\/store"/);
  assert.match(router, /to="\/#produk"/);
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

test("delivery audit separates historical delivery evidence from active double-drop signals", async () => {
  const server = await readFile(new URL("../../server/index.js", import.meta.url), "utf8");
  const deliveryAudit = server.slice(server.indexOf("function buildDeliveryAuditQueue"), server.indexOf("function buildReservedStockQueue"));
  assert.match(deliveryAudit, /historical: uniqueLinkedAccounts/);
  assert.match(deliveryAudit, /active: activeLinkedAccounts/);
  assert.match(deliveryAudit, /activeLinkedAccounts\.length > qty/);
  assert.doesNotMatch(deliveryAudit, /linkedAccounts\.length > qty/);
});
