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
  const palette = await source("components/ui/CommandPalette.tsx");
  // The console no longer trims the query itself -- the palette hands it an
  // already-trimmed one. What still has to be true is that the only data
  // source this search may reach is the owner-scoped search endpoint, and
  // that it is not asked on every single keystroke.
  assert.match(search, /api\.ownerSearch\(query\)/);
  assert.doesNotMatch(search, /api\.(accounts|stock|orders|resellers)\(/);
  assert.match(search, /minChars=\{2\}/);
  assert.match(search, /debounceMs=\{250\}/);
  assert.match(palette, /const trimmed = query\.trim\(\)/);
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
  // The operations work queue is a real destination, not a redirect to Health
  // Center. Health Center reports infrastructure health only and cannot run
  // the recovery actions that live on this page.
  assert.match(navigation, /path: "\/owner-v2\/operations"/);
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
  assert.match(warranty, /\bToast\b/);
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

test("Owner Console keeps a responsive drawer and honours reduced motion", async () => {
  // The frame moved into the shared kit when the two shells became one, so
  // the drawer and the reduced-motion opt-out are asserted where they now
  // live. Reading console.css alone would have kept passing while the sidebar
  // it used to draw went unstyled.
  const frame = await source("components/ui/shell.css");
  const styles = await source("components/console/console.css");
  // Assert a drawer-style breakpoint exists rather than a specific pixel
  // value, so the breakpoint can move without breaking the contract.
  assert.match(frame, /\.ui-shell-sidebar\.is-drawer/, "the frame must still have a drawer for a phone");
  assert.match(frame, /@media\s*\(max-width:\s*\d+px\)/);
  assert.match(frame, /prefers-reduced-motion/);
  // And the console's own page-level rules still respond to a narrow screen.
  assert.match(styles, /@media\s*\(max-width:\s*\d+px\)/);
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
  assert.match(operations, /\bDialogActions\b/);
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
  // The shell may be refactored into a shared AppShell, so search the whole
  // console component tree rather than one file for the wiring.
  const [shell, notifications, ...rest] = await Promise.all([
    source("components/console/ConsoleShell.tsx"),
    source("components/console/ownerNotifications.ts"),
    source("components/ui/Toast.tsx"),
  ]);
  const consoleTree = [shell, ...rest].join("\n");
  assert.match(consoleTree, /api\.operationsCenter\(\)/);
  assert.match(consoleTree, /api\.warrantyClaims\(\)/);
  assert.match(consoleTree, /api\.whatsappRentals\(\)/);
  assert.match(consoleTree, /buildOwnerNotifications/);
  assert.match(consoleTree, /Tandai dibaca/);
  assert.match(consoleTree, /owner-notification-seen-v1/);
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
  const table = await source("components/ui/DataTable.tsx");
  // Selection UI must be conditional on an actual bulkAction being supplied,
  // so read-only tables never render checkboxes. Assert the conditional and
  // the checkbox cell rather than one exact JSX class string.
  assert.match(table, /selectable\s*=\s*Boolean\(bulkAction\)/);
  assert.match(table, /selectable\s*\?[\s\S]{0,200}?<th/);
  assert.match(table, /selectable\s*\?[\s\S]{0,400}?<td[^>]*data-label="Pilih"/);
  assert.doesNotMatch(table, /Pilihan dapat dibersihkan tanpa mengubah data/);
});

test("shared data tables keep column context on narrow screens", async () => {
  const [table, styles] = await Promise.all([
    source("components/ui/DataTable.tsx"),
    source("components/ui/ui.css"),
  ]);
  // Every body cell must carry its column header as data-label, and the
  // stylesheet must surface that attribute on narrow screens, so a table
  // that scrolls horizontally stays readable.
  assert.match(table, /data-label=\{column\.header\}/);
  assert.match(styles, /content:\s*attr\(data-label\)/);
  assert.match(styles, /\.ui-table-scroll tbody tr/);
});

test("public store aliases reach the live catalog instead of the not-found page", async () => {
  const [router, priceList] = await Promise.all([
    source("router/config.tsx"),
    source("pages/pricelist/ProductCatalog.tsx"),
  ]);
  // The alias used to be a redirect to `/#produk` -- an anchor on the landing
  // page. The catalogue now lives on its own route, so the alias points at the
  // route and the anchor moved with the section. Both halves are asserted: a
  // redirect with no `id="produk"` behind it lands the reader at the top of a
  // long page with nothing marked, which is the not-found experience this test
  // exists to prevent.
  assert.match(router, /path: "\/store"[\s\S]{0,80}Navigate to="\/harga"/);
  assert.match(priceList, /id="produk"/);
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
  // Slice out just the delivery-audit builder by brace matching from its
  // declaration, rather than by a second sibling declaration that a future
  // refactor may move. Falls back to the whole file if the marker is absent,
  // so a later extraction of this function cannot silently empty the slice
  // and make the assertions vacuously pass.
  const start = server.indexOf("function buildDeliveryAuditQueue");
  let scope = server;
  if (start !== -1) {
    let depth = 0;
    let opened = false;
    let end = start;
    for (; end < server.length; end += 1) {
      if (server[end] === "{") {
        depth += 1;
        opened = true;
      } else if (server[end] === "}") {
        depth -= 1;
        if (opened && depth === 0) break;
      }
    }
    scope = server.slice(start, end);
  }
  assert.notEqual(start, -1, "buildDeliveryAuditQueue is no longer declared in server/index.js; import it from its new module in this test");
  assert.match(scope, /historical: uniqueLinkedAccounts/);
  assert.match(scope, /active: activeLinkedAccounts/);
  assert.match(scope, /activeLinkedAccounts\.length > qty/);
  assert.doesNotMatch(scope, /linkedAccounts\.length > qty/);
});

test("attention queue stops counting cancelled orders as paid awaiting delivery", async () => {
  const analytics = await source("pages/owner-v2/overview/analytics.ts");
  // `isPaid` accepts qrisStatus "manual", and a manually-tagged order that was
  // later cancelled is still `qrisStatus: "manual"`. Without the cancelled
  // guard it satisfied all three terms of the paidNotSent predicate at once,
  // so cancelled orders were counted twice -- once as "Delivery gagal" and once
  // as "Paid belum terkirim" -- and the header sum overstated the number of
  // orders actually holding money. Verified against the demo runtime DB: the
  // two cancelled orders were the *entire* content of both rows.
  // Asserted on behaviour, not spelling. The guard exists as a named helper so
  // both rows can share one definition; pinning the inline expression instead
  // would fail on a refactor that changed nothing observable.
  assert.match(analytics, /isCancelled[\s\S]{0,120}cancelled/, "the cancelled-order guard is gone");
  // It has to be applied to BOTH rows, or a cancelled order still counts once.
  assert.match(analytics, /isLiveDeliveryFailure[\s\S]{0,80}!isCancelled/);
  assert.match(analytics, /paidNotSent = live\.filter\(\(order\) =>[^\n]*!isCancelled/);
});

test("attention queue surfaces the per-order delivery reason instead of a bare count", async () => {
  const analytics = await source("pages/owner-v2/overview/analytics.ts");
  const queue = await source("pages/owner-v2/overview/AttentionQueue.tsx");
  // The server already persists the reason on `order.deliveryError` and the
  // order drawer already renders it. It was absent from the queue row itself,
  // so the owner had to open orders one by one to learn why four deliveries
  // were failing -- when the reason is usually one shared sentence, and often
  // one he has to fix in Sheets. The row now carries it.
  assert.match(analytics, /deliveryError/);
  assert.match(analytics, /detail:/);
  assert.match(queue, /item\.detail/);
  // And the money-at-risk framing: "unpaid" is what makes a row urgent, so the
  // hint may not describe a row as waiting on money it never received.
  assert.doesNotMatch(analytics, /label: "Paid belum terkirim"[\s\S]{0,200}belum menerima pembayaran/);
});

test("fulfillment repair gives up instead of retrying a broken order forever", async () => {
  const server = await readFile(new URL("../../server/index.js", import.meta.url), "utf8");
  const start = server.indexOf("function runFulfillmentRepairJob");
  let depth = 0;
  let opened = false;
  let end = start;
  for (; end < server.length; end += 1) {
    if (server[end] === "{") {
      depth += 1;
      opened = true;
    } else if (server[end] === "}") {
      depth -= 1;
      if (opened && depth === 0) break;
    }
  }
  const scope = server.slice(start, end);
  assert.notEqual(start, -1, "runFulfillmentRepairJob is no longer declared in server/index.js");
  // The repair job runs every 45s and re-selects every paid, unsent order with
  // no attempt counter and no backoff. A product that is misconfigured, or a
  // template missing a customer email, therefore retried indefinitely -- the
  // failure is deterministic, so retrying cannot succeed, and each pass burned
  // a stock allocation attempt for nothing. It must stop and surface instead.
  assert.match(scope, /FULFILLMENT_REPAIR_MAX_ATTEMPTS/);
  assert.match(scope, /fulfillmentRepairAttempts/);
  // Giving up has to be visible, not silent: the owner is the only one who can
  // fix a bad product config, so a stopped order must reach the attention queue.
  assert.match(scope, /deliveryStatus = "abandoned"/);
});
