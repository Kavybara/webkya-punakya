import { handleInboundMessage, fulfillPaidOrder } from "../auto-order.js";
import { readDb } from "../store.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const sourceDb = await readDb();
const db = clone(sourceDb);

db.products = db.products || [];
db.stock = db.stock || [];
db.orders = db.orders || [];
db.payments = db.payments || [];
db.activities = db.activities || [];
db.managedAccounts = db.managedAccounts || [];
db.whatsappMessages = db.whatsappMessages || [];
db.resellers = db.resellers || [];

const reseller = {
  id: "res-whatsapp-check",
  name: "WhatsApp Check Reseller",
  username: "whatsapp.check",
  email: "whatsapp-check@kavya.local",
  whatsapp: "6280000000099",
  password: "check-password",
  isActive: true,
  deposit: 0,
  joinedAt: "2026-01-01",
};
const product = {
  id: "prod-whatsapp-check",
  name: "WhatsApp Check Product",
  description: "Produk test untuk validasi flow WhatsApp.",
  isActive: true,
  variants: [
    {
      id: "var-whatsapp-check",
      name: "2 Qty",
      code: "CHK2QTY",
      description: "Varian test qty dua.",
      durationModes: { daily: true, monthly: true },
      prices: { "1 Hari": 500, "1 Bulan": 1000 },
      snk: "S&K test bulanan: akun dipakai sesuai aturan.",
      snkMonthly: "S&K test bulanan: akun dipakai sesuai aturan.",
      snkDaily: "S&K test harian: akun dipakai sesuai aturan.",
    },
  ],
};
const stockItems = [
  {
    id: "stk-whatsapp-check-1",
    productId: product.id,
    variantId: product.variants[0].id,
    email: "check1@kavya.local",
    password: "pass-check-1",
    profile: "P1",
    pin: "1111",
    status: "available",
    createdAt: "2026-01-01",
  },
  {
    id: "stk-whatsapp-check-2",
    productId: product.id,
    variantId: product.variants[0].id,
    email: "check2@kavya.local",
    password: "pass-check-2",
    profile: "P2",
    pin: "2222",
    status: "available",
    createdAt: "2026-01-01",
  },
  {
    id: "stk-whatsapp-check-3",
    productId: product.id,
    variantId: product.variants[0].id,
    email: "check3@kavya.local",
    password: "pass-check-3",
    profile: "P3",
    pin: "3333",
    status: "available",
    createdAt: "2026-01-01",
  },
];

db.resellers.unshift(reseller);
db.products.unshift(product);
db.stock.unshift(...stockItems);
db.settings = {
  ...(db.settings || {}),
  ownerWhatsAppNumber: "6280000000010",
};

const blocked = await handleInboundMessage(db, { from: "6280000000001", body: "#stock" });
if (!blocked.reply.includes("Order reseller via WhatsApp sudah dimatikan")) {
  throw new Error("#stock tidak diarahkan ke website");
}

const groupIgnored = await handleInboundMessage(db, {
  from: reseller.whatsapp,
  chat_jid: "120363000000000000@g.us",
  body: "#stock",
});
if (!groupIgnored.ignored || groupIgnored.reason !== "private_chat_only") {
  throw new Error("command grup tidak diabaikan");
}

const stock = await handleInboundMessage(db, { from: reseller.whatsapp, body: "#stock" });
if (!stock.reply.includes("dashboard reseller")) {
  throw new Error("#stock reseller tidak diarahkan ke website");
}

const ownerStock = await handleInboundMessage(db, { from: db.settings.ownerWhatsAppNumber, body: "#stock" });
if (!ownerStock.reply.includes("dashboard reseller")) {
  throw new Error("#stock owner tidak diarahkan ke website");
}

const buy = await handleInboundMessage(db, { from: reseller.whatsapp, body: "#buynow CHK2QTY 2" });
if (buy.order?.id || !buy.reply.includes("Order reseller via WhatsApp sudah dimatikan")) {
  throw new Error("#buynow WA masih bisa membuat order");
}

const dailyBuy = await handleInboundMessage(db, { from: reseller.whatsapp, body: "#buynow CHK2QTY 1 1h" });
if (dailyBuy.order?.id || !dailyBuy.reply.includes("Order reseller via WhatsApp sudah dimatikan")) {
  throw new Error("#buynow harian WA masih bisa membuat order");
}

const netflixProduct = {
  id: "prod-netflix-check",
  name: "Netflix Premium Check",
  description: "Produk test pool Netflix.",
  category: "Netflix",
  code: "NET",
  isActive: true,
  variants: [
    {
      id: "net-1p1u",
      name: "Sharing 1P1U",
      code: "NET-1P1U",
      description: "Pool bersama 1P1U dan semi private.",
      prices: { "1 Bulan": 35000, "2 Bulan": 65000, "3 Bulan": 90000 },
      snk: "S&K Netflix shared.",
    },
    {
      id: "net-semi-private",
      name: "Semi Private",
      code: "NET-SEMI",
      description: "Pool bersama 1P1U dan semi private.",
      prices: { "1 Bulan": 60000, "2 Bulan": 90000, "3 Bulan": 115000 },
      snk: "S&K Netflix semi.",
    },
    {
      id: "net-2p1u",
      name: "Sharing 2U",
      code: "NET-2U",
      description: "Pool sendiri 2U.",
      prices: { "1 Bulan": 25000, "2 Bulan": 45000, "3 Bulan": 65000 },
      snk: "S&K Netflix 2U.",
    },
    {
      id: "net-private",
      name: "Private",
      code: "NET-PRIVATE",
      description: "Private sedang nonaktif.",
      isActive: false,
      prices: { "1 Bulan": 155000 },
      snk: "S&K Netflix private.",
    },
  ],
};
db.products.unshift(netflixProduct);
db.stock.unshift(
  {
    id: "stk-netflix-shared-check",
    productId: netflixProduct.id,
    variantId: "net-1p1u",
    email: "netflix-shared@kavya.local",
    password: "netflix-shared-pass",
    profile: "P1",
    pin: "1001",
    status: "available",
    createdAt: "2026-01-01",
  },
  {
    id: "stk-netflix-2u-check",
    productId: netflixProduct.id,
    variantId: "net-2p1u",
    email: "netflix-2u@kavya.local",
    password: "netflix-2u-pass",
    profile: "P2",
    pin: "2002",
    status: "available",
    createdAt: "2026-01-01",
  },
);

const netflixStock = await handleInboundMessage(db, { from: reseller.whatsapp, body: "#stock" });
if (!netflixStock.reply.includes("dashboard reseller")) {
  throw new Error("#stock Netflix tidak diarahkan ke website");
}

const semiOrder = await handleInboundMessage(db, { from: reseller.whatsapp, body: "#buynow semipriv 1 2" });
if (semiOrder.order?.id || !semiOrder.reply.includes("Order reseller via WhatsApp sudah dimatikan")) {
  throw new Error("#buynow semipriv WA masih bisa membuat order");
}

const twoUserOrder = await handleInboundMessage(db, { from: reseller.whatsapp, body: "#buynow 2u 1 3" });
if (twoUserOrder.order?.id || !twoUserOrder.reply.includes("Order reseller via WhatsApp sudah dimatikan")) {
  throw new Error("#buynow 2u WA masih bisa membuat order");
}

const privateOrder = await handleInboundMessage(db, { from: reseller.whatsapp, body: "#buynow priv 1" });
if (privateOrder.order?.id || !privateOrder.reply.includes("Order reseller via WhatsApp sudah dimatikan")) {
  throw new Error("#buynow private WA masih bisa membuat order");
}

const deniedAddBalance = await handleInboundMessage(db, { from: reseller.whatsapp, body: ".addbalance 5000" });
if (!deniedAddBalance.reply.includes("khusus owner")) {
  throw new Error(".addbalance non-owner tidak diblokir");
}

const deniedFromMeAddBalance = await handleInboundMessage(db, { from: reseller.whatsapp, from_me: true, body: ".addbalance 5000" });
if (!deniedFromMeAddBalance.reply.includes("khusus owner")) {
  throw new Error(".addbalance from_me non-owner tidak diblokir");
}

const deniedGroupAdminAddBalance = await handleInboundMessage(db, {
  from: reseller.whatsapp,
  sender_aliases: [reseller.whatsapp],
  is_group_admin: true,
  group_admin_checked: true,
  body: ".addbalance 5000",
});
if (!deniedGroupAdminAddBalance.reply.includes("khusus owner")) {
  throw new Error(".addbalance group admin tidak diblokir");
}

const deniedGroupOwnerAddBalance = await handleInboundMessage(db, {
  from: "6280000000020",
  sender_aliases: ["6280000000020"],
  group_owner: true,
  ownerNumber: "6280000000020",
  body: ".addbalance 5000",
});
if (!deniedGroupOwnerAddBalance.reply.includes("khusus owner")) {
  throw new Error(".addbalance dashboard group owner tidak diblokir");
}

const addBalance = await handleInboundMessage(db, { from: db.settings.ownerWhatsAppNumber, body: `.addbalance ${reseller.whatsapp} 5000` });
if (!addBalance.reply.includes("Saldo sekarang") || reseller.deposit !== 5000) {
  throw new Error(".addbalance owner tidak menambah deposit reseller");
}

const balance = await handleInboundMessage(db, { from: reseller.whatsapp, body: "#balance" });
if (!balance.reply.includes("Rp 5.000")) {
  throw new Error("#balance tidak membaca saldo deposit reseller");
}

const deniedDeposit = await handleInboundMessage(db, { from: "6280000000001", body: "#deposit 7000" });
if (!deniedDeposit.reply.includes("belum terdaftar sebagai reseller")) {
  throw new Error("#deposit non-reseller tidak diblokir");
}

const invalidDeposit = await handleInboundMessage(db, { from: reseller.whatsapp, body: "#deposit" });
if (!invalidDeposit.reply.includes("#deposit 5000")) {
  throw new Error("#deposit tanpa nominal tidak memberi format");
}

const depositTopup = await handleInboundMessage(db, { from: reseller.whatsapp, body: "#deposit 7000" });
if (depositTopup.order?.type !== "deposit_topup" || !depositTopup.reply.includes("Deposit dibuat")) {
  throw new Error("#deposit tidak membuat QRIS top up saldo");
}
if (reseller.deposit !== 5000) {
  throw new Error("#deposit menambah saldo sebelum pembayaran paid");
}

const paidDeposit = fulfillPaidOrder(db, depositTopup.order.id);
if (!paidDeposit.ok || reseller.deposit !== 12000 || !paidDeposit.reply.includes("Saldo Sekarang : Rp 12.000")) {
  throw new Error("deposit paid tidak menambah saldo reseller");
}

console.log("whatsapp:check OK");
console.log("private reseller gate OK");
console.log("qty 2 reservation + fulfill OK");
console.log("managedAccounts sync OK");
console.log("netflix shared/2u pool + duration OK");
console.log("owner addbalance + balance OK");
console.log("deposit qris topup OK");
