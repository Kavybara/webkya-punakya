/**
 * Build a synthetic database for reviewing the consoles.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A COPY
 *
 * The real database in `runtime/kavya-db.json` is production data: customer
 * WhatsApp numbers, the credentials of accounts that have been sold, order
 * history. It is also almost empty -- one reseller, three orders, and no
 * managed accounts or warranty claims at all. So it is no use for reviewing a
 * redesign: the tables you most want to look at are the ones with nothing in
 * them, and the ones that do have rows hold real people's data.
 *
 * This writes a *synthetic* database instead: the same shape, plausible
 * volumes, a deliberate spread of account states, and no real customer data at
 * all. Every credential in it is made up, and every integration secret is
 * blank, so a run started against it cannot reach a payment provider, a Google
 * Sheet, or a customer's phone.
 *
 * The one thing it cannot fake is time. Account status is derived from
 * `expiresAt` at read time, so the seed is generated relative to the moment it
 * runs -- which is what makes "expiring in 3 days" actually mean that.
 *
 *   node scripts/seed-demo-database.mjs
 *
 * See `demo:seed` in package.json, and the note on refusal below.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../server/security.js";
import { DEMO_OWNER, DEMO_RESELLERS } from "./demo-credentials.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dashboardRoot = path.resolve(here, "..");

/** Never write into the real runtime directory, whatever the caller asks for. */
const REAL_RUNTIME = path.resolve(dashboardRoot, "runtime");
const target = path.resolve(
  process.argv[2] || process.env.DEMO_DATABASE_PATH || path.join(dashboardRoot, "runtime-demo", "kavya-db.json"),
);

const DAY = 86400000;
const now = Date.now();

/** The same shape `nowText()` produces: "YYYY-MM-DD HH:mm", in local time. */
function stamp(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const daysFromNow = (n) => stamp(now + n * DAY);

/**
 * The server's own rule for an account's status, copied so the seeded rows and
 * the ones the server would compute agree. If this ever drifts from
 * `accountStatusFromDate` the console still gets the right answer -- it
 * recomputes on read -- but the seeded `status` field would be misleading to
 * anyone reading the file.
 */
function accountStatus(expiresAtMs, durationDays) {
  if (expiresAtMs <= now) return "expired";
  const daysLeft = Math.ceil((expiresAtMs - now) / DAY);
  return durationDays >= 30 && daysLeft <= 5 ? "expiring" : "active";
}

const durationDaysFor = (months) => months * 30;

const PRODUCTS = [
  { code: "NFLX", name: "Netflix Premium", category: "Streaming", needsProfile: true, needsPin: false, price: 38000 },
  { code: "DSNP", name: "Disney+ Hotstar", category: "Streaming", needsProfile: true, needsPin: false, price: 32000 },
  { code: "SPOT", name: "Spotify Premium", category: "Musik", needsProfile: true, needsPin: false, price: 25000 },
  { code: "PRIM", name: "Prime Video", category: "Streaming", needsProfile: true, needsPin: false, price: 27000 },
  { code: "YTPB", name: "YouTube Premium", category: "Streaming", needsProfile: true, needsPin: false, price: 21000 },
  { code: "VIU", name: "Viu Premium", category: "Streaming", needsProfile: false, needsPin: false, price: 18000 },
];

const DURATIONS = [
  { name: "1 Bulan", months: 1, label: "1 Bulan" },
  { name: "2 Bulan", months: 2, label: "2 Bulan" },
  { name: "3 Bulan", months: 3, label: "3 Bulan" },
];

const products = PRODUCTS.map((product) => ({
  id: `prd_${product.code.toLowerCase()}`,
  name: product.name,
  description: `Akses ${product.name} ${product.needsProfile ? "dengan profil khusus" : "tanpa profil"}.`,
  category: product.category,
  isActive: true,
  needsProfile: product.needsProfile,
  needsPin: product.needsPin,
  code: product.code,
  resellerOnly: false,
  orderLock: { enabled: false, reason: "", updatedAt: "", updatedBy: "", scope: "" },
  variants: DURATIONS.map((duration) => ({
    id: `var_${product.code.toLowerCase()}_${duration.months}m`,
    code: `${product.code}-${duration.months}M`,
    name: duration.name,
    description: `Masa aktif ${duration.name.toLowerCase()}.`,
    prices: Object.fromEntries(
      DURATIONS.map((other) => [other.label, product.price * other.months - (other.months > 1 ? 3000 * (other.months - 1) : 0)]),
    ),
    snk: "",
  })),
}));

const resellers = DEMO_RESELLERS.map((reseller, index) => ({
  id: `res_demo_${index + 1}`,
  name: reseller.name,
  username: reseller.username,
  email: `${reseller.username.replace(".", "-")}@demo.invalid`,
  whatsapp: `6281200000${index + 10}00`,
  isActive: true,
  orders: 0,
  revenue: 0,
  deposit: index === 0 ? 750000 : 150000,
  joinedAt: daysFromNow(-(120 - index * 30)),
  passwordHash: hashPassword(reseller.password),
}));

const stock = [];
const orders = [];
const payments = [];
const managedAccounts = [];
const activities = [];
const warrantyClaims = [];

/**
 * How each seeded order should look, chosen to exercise every state the
 * console can paint rather than a wall of identical success rows.
 */
const SCENARIOS = [
  { count: 10, orderStatus: "completed", deliveryStatus: "sent", qrisStatus: "paid", ageDays: [1, 55] },
  { count: 3, orderStatus: "completed", deliveryStatus: "sent", qrisStatus: "paid", ageDays: [56, 74], expireIn: [-6, -1] },
  { count: 4, orderStatus: "completed", deliveryStatus: "sent", qrisStatus: "paid", ageDays: [20, 50], expireIn: [1, 5] },
  { count: 3, orderStatus: "pending", deliveryStatus: "waiting_payment", qrisStatus: "pending", ageDays: [0, 1] },
  { count: 2, orderStatus: "expired", deliveryStatus: "waiting_payment", qrisStatus: "expired", ageDays: [3, 9] },
  { count: 2, orderStatus: "cancelled", deliveryStatus: "failed", qrisStatus: "manual", ageDays: [10, 30] },
];

let sequence = 0;
const nextId = (prefix) => `${prefix}_demo_${String(++sequence).padStart(4, "0")}`;

/** Deterministic per index, so a re-run differs only in the dates. */
const pick = (list, index) => list[index % list.length];

for (const scenario of SCENARIOS) {
  for (let i = 0; i < scenario.count; i += 1) {
    const product = pick(products, sequence);
    const variant = pick(product.variants, sequence);
    const duration = pick(DURATIONS, sequence);
    const reseller = pick(resellers, sequence);
    const orderId = nextId("ord");
    const stockId = nextId("stk");
    const createdAtMs = now - pick(scenario.ageDays, i) * DAY - (i % 7) * 3600000;
    const durationDays = durationDaysFor(duration.months);
    const fulfilled = scenario.deliveryStatus === "sent";
    const expiresAtMs = scenario.expireIn
      ? now + pick(scenario.expireIn, i) * DAY
      : createdAtMs + durationDays * DAY;
    const total = Number(variant.prices[duration.label]);
    const buyerEmail = `pembeli${sequence}@demo.invalid`;

    stock.push({
      id: stockId,
      productId: product.id,
      variantId: variant.id,
      email: buyerEmail,
      password: `Demo#${1000 + sequence}`,
      profile: product.needsProfile ? `profil${sequence}` : "",
      pin: product.needsPin ? String(1000 + sequence) : "",
      signInCode: "",
      verificationCode: "",
      resetLink: "",
      status: fulfilled ? "sold" : "available",
      createdAt: stamp(createdAtMs - DAY),
      notes: "",
      reservedFor: "",
      soldAt: fulfilled ? stamp(createdAtMs) : "",
    });

    orders.push({
      id: orderId,
      paymentRef: `PAKASIR-DEMO-${sequence}`,
      customer: `Pembeli Demo ${sequence}`,
      whatsapp: `6281300000${String(sequence).padStart(3, "0")}0`,
      resellerId: reseller.id,
      product: product.name,
      productId: product.id,
      variant: variant.name,
      variantId: variant.id,
      variantCode: variant.code,
      duration: duration.name,
      durationDays,
      qty: 1,
      total,
      email: buyerEmail,
      note: "",
      qrisStatus: scenario.qrisStatus,
      orderStatus: scenario.orderStatus,
      deliveryStatus: scenario.deliveryStatus,
      channel: "web",
      createdAt: stamp(createdAtMs),
      paidAt: fulfilled ? stamp(createdAtMs + 120000) : "",
      paymentExpiresAt: stamp(createdAtMs + 30 * 60000),
      deliveredStockIds: fulfilled ? [stockId] : [],
      qrisUrl: "",
      paymentError: "",
      processingAt: fulfilled ? stamp(createdAtMs + 180000) : "",
      fulfillmentText: fulfilled ? `Akun ${product.name} siap digunakan.` : "",
      whatsappNotificationStatus: fulfilled ? "sent" : "",
      whatsappNotificationError: "",
      reseller: reseller.name,
      googleSheetsSyncStatus: "skipped",
      googleSheetsSyncAt: "",
      googleSheetsSyncError: "",
      expiresAt: stamp(expiresAtMs),
    });

    payments.push({
      ref: `PAKASIR-DEMO-${sequence}`,
      orderId,
      status: scenario.qrisStatus === "paid" ? "paid" : scenario.qrisStatus,
      amount: total,
      provider: "pakasir",
      createdAt: stamp(createdAtMs),
      expiresAt: stamp(createdAtMs + 30 * 60000),
      paymentUrl: "",
      qrisText: "",
      providerStatus: scenario.qrisStatus,
      providerError: "",
    });

    if (fulfilled) {
      managedAccounts.push({
        id: nextId("acc"),
        stockId,
        orderId,
        sourceOrderId: orderId,
        resellerId: reseller.id,
        product: product.name,
        productId: product.id,
        variant: variant.name,
        variantId: variant.id,
        variantCode: variant.code,
        stockPoolKey: `${product.code}-${duration.months}M`,
        duration: duration.name,
        durationDays,
        email: buyerEmail,
        password: `Demo#${1000 + sequence}`,
        buyer: `Pembeli Demo ${sequence}`,
        reseller: reseller.name,
        whatsapp: `6281300000${String(sequence).padStart(3, "0")}0`,
        profile: product.needsProfile ? `profil${sequence}` : "",
        pin: "",
        signInCode: "",
        verificationCode: "",
        resetLink: "",
        householdLink: "",
        device: "",
        sheetSource: "",
        sheetName: "",
        sheetRow: 0,
        sheetPool: "",
        sheetPoolSchema: "",
        sheetStartColumn: 0,
        sheetStockKey: "",
        startedAt: stamp(createdAtMs + 120000),
        expiresAt: stamp(expiresAtMs),
        status: accountStatus(expiresAtMs, durationDays),
        source: "demo_seed",
        rebuiltAt: stamp(now),
      });
    }

    if (fulfilled) {
      activities.push({
        id: nextId("act"),
        type: "order",
        title: `Order ${orderId} selesai`,
        description: `${product.name} ${variant.name} untuk ${reseller.name}.`,
        createdAt: stamp(createdAtMs + 300000),
        actorRole: "reseller",
        actorName: reseller.name,
      });
    }
  }
}

resellers[0].orders = orders.filter((order) => order.resellerId === resellers[0].id).length;
resellers[0].revenue = orders
  .filter((order) => order.resellerId === resellers[0].id && order.orderStatus === "completed")
  .reduce((sum, order) => sum + order.total, 0);
resellers[1].orders = orders.filter((order) => order.resellerId === resellers[1].id).length;
resellers[1].revenue = orders
  .filter((order) => order.resellerId === resellers[1].id && order.orderStatus === "completed")
  .reduce((sum, order) => sum + order.total, 0);

// A few claims so the warranty page is not an empty state. Only accounts that
// are still inside their warranty period are eligible, which is why these hang
// off the recent, unexpired orders rather than arbitrary ones.
const claimable = managedAccounts.filter((account) => accountStatus(Date.parse(account.expiresAt.replace(" ", "T")), account.durationDays) !== "expired").slice(0, 3);
claimable.forEach((account, index) => {
  const reseller = resellers.find((item) => item.id === account.resellerId);
  const createdAt = stamp(now - (index + 1) * 6 * 3600000);
  warrantyClaims.push({
    id: `CLM-DEMO-${index + 1}`,
    resellerId: account.resellerId,
    resellerName: reseller?.username || reseller?.name || "",
    accountId: account.id,
    orderId: account.orderId,
    stockId: account.stockId,
    productId: account.productId,
    variantId: account.variantId,
    product: account.product,
    variant: account.variant,
    accountIdentity: account.email,
    profile: account.profile,
    issue: ["Akun tidak bisa login", "Video tidak bisa diputar", "Muncul error di aplikasi"][index % 3],
    status: index === 0 ? "submitted" : index === 1 ? "in_review" : "replaced",
    createdAt,
    updatedAt: createdAt,
    ownerNote: index === 2 ? "Sudah diganti dengan akun baru." : "",
    ownerNotificationStatus: "sent",
    evidence: [],
    submissionSource: "reseller_dashboard",
    createdByRole: "reseller",
    createdBy: account.resellerId,
    warrantyDays: 7,
    warrantyStartedAt: account.startedAt,
    warrantyEndsAt: stamp(Date.parse(account.startedAt.replace(" ", "T")) + 7 * DAY),
    holdStartedAt: createdAt,
    holdEndedAt: "",
    holdAppliedMinutes: 0,
    reviewElapsedMinutes: (index + 1) * 40,
    reviewDueAt: stamp(now + (index === 0 ? 2 : -1) * 3600000),
    reviewOverdue: index === 1,
  });
});

const db = {
  settings: {
    ownerName: "Demo Owner",
    ownerUsername: DEMO_OWNER.username,
    ownerEmail: "owner@demo.invalid",
    ownerInitial: "DO",
    ownerWhatsAppNumber: "628110000000",
    ownerPasswordHash: hashPassword(DEMO_OWNER.password),
    ownerSessionVersion: 1,
    publicDomain: "demo.invalid",
    botPublicUrl: "",
    whatsappBotPublicUrl: "",
    // Every integration secret is blank on purpose. A demo database that
    // carried a live API key would be one `npm run` away from charging
    // somebody a real card.
    pakasirProject: "",
    pakasirApiKey: "",
    pakasirMerchantId: "",
    pakasirWebhookSecret: "",
    baileySessionId: "",
    baileyBotNumber: "",
    baileyWebhookUrl: "",
    baileyQrisGenerateUrl: "",
    gmailClientId: "",
    gmailClientSecret: "",
    gmailRedirectUri: "",
    gmailInboxEmail: "",
    whatsappBotToken: "",
    whatsappInboundToken: "",
    maintenance: { enabled: false, reason: "", source: "demo_seed", updatedAt: stamp(now) },
    settingsSchemaVersion: 1,
    settingsMigratedAt: stamp(now),
    settingsMigrationFromVersion: 0,
  },
  products,
  stock,
  orders,
  resellers,
  managedAccounts,
  whatsappRentals: [],
  whatsappMessages: [],
  payments,
  activities,
  whatsappGroupLists: {},
  passwordResets: [],
  maintenance: { enabled: false, reason: "", source: "demo_seed", updatedAt: stamp(now) },
  archivedActivities: [],
  whatsappRentalNotices: {},
  warrantyClaims,
};

if (path.resolve(target).startsWith(REAL_RUNTIME + path.sep) || path.resolve(target) === REAL_RUNTIME) {
  console.error(`[seed] refusing to write into the real runtime directory: ${REAL_RUNTIME}`);
  console.error("[seed] the demo database is synthetic; it has no business replacing production data.");
  process.exit(1);
}

await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(db, null, 2)}\n`, "utf8");

console.log(`[seed] wrote ${target}`);
console.log(`[seed]   products ${products.length} | stock ${stock.length} | orders ${orders.length}`);
console.log(`[seed]   managed accounts ${managedAccounts.length} | warranty claims ${warrantyClaims.length}`);
const byStatus = managedAccounts.reduce((acc, account) => ({ ...acc, [account.status]: (acc[account.status] || 0) + 1 }), {});
console.log(`[seed]   account states ${JSON.stringify(byStatus)}`);
console.log("");
console.log("[seed] owner    " + `${DEMO_OWNER.username} / ${DEMO_OWNER.password}`);
for (const reseller of DEMO_RESELLERS) {
  console.log("[seed] reseller " + `${reseller.username} / ${reseller.password}`);
}
console.log("");
console.log(`[seed] start the API against it with:  DATABASE_PATH="${target}" npm run api`);
