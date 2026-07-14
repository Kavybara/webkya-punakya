export type Role = "owner" | "reseller";

export type DurationLabel = "1 Bulan" | "3 Bulan" | "6 Bulan" | "12 Bulan";

export type DurationModes = {
  daily?: boolean;
  monthly?: boolean;
};

export type ManualOrderLock = {
  enabled: boolean;
  reason?: string;
  updatedAt?: string;
  updatedBy?: string;
  scope?: "product" | "variant";
};

export type ProductVariant = {
  id: string;
  code: string;
  name: string;
  description: string;
  isActive?: boolean;
  orderLock?: ManualOrderLock;
  checkoutRequirements?: CheckoutRequirements;
  deliveryTemplate?: string;
  warrantyTemplate?: string;
  durationModes?: DurationModes;
  prices: Record<string, number>;
  snk: string;
  snkMonthly?: string;
  snkDaily?: string;
};

export type CheckoutRequirements = {
  customerField: "email" | "device" | "optional";
  required?: boolean;
  minItems?: number;
  label?: string;
  placeholder?: string;
  helper?: string;
};

export type MessageTemplates = {
  delivery?: string;
  warranty?: string;
};

export type Product = {
  id: string;
  name: string;
  description: string;
  category: string;
  isActive: boolean;
  orderLock?: ManualOrderLock;
  isArchived?: boolean;
  archivedAt?: string;
  resellerOnly?: boolean;
  needsProfile: boolean;
  needsPin: boolean;
  checkoutRequirements?: CheckoutRequirements;
  messageTemplates?: MessageTemplates;
  code: string;
  variants: ProductVariant[];
};

export type StockItem = {
  id: string;
  productId: string;
  variantId: string;
  email: string;
  loginPhone?: string;
  otpEmail?: string;
  password: string;
  profile?: string;
  pin?: string;
  status: "available" | "reserved" | "sold";
  createdAt?: string;
  signInCode?: string;
  verificationCode?: string;
  resetLink?: string;
  householdLink?: string;
  reservedFor?: string;
  reservedAccountId?: string;
  reservedUntil?: string;
  soldDuration?: string;
  soldDurationDays?: number;
  device?: string;
  sheetSource?: string;
  sheetStockKey?: string;
  sheetPool?: string;
  sheetPoolSchema?: string;
  sheetRow?: number;
  sheetStartColumn?: number;
  sheetName?: string;
  sheetOrderId?: string;
  sheetLastSyncedAt?: string;
  stockType?: string;
  linkPoolId?: string;
};

export type Order = {
  id: string;
  paymentRef?: string;
  customer: string;
  whatsapp: string;
  resellerId?: string;
  product: string;
  productId?: string;
  variant: string;
  variantId?: string;
  variantCode?: string;
  customerVariant?: string;
  customerVariantId?: string;
  customerVariantCode?: string;
  duration: string;
  durationDays?: number;
  qty?: number;
  total: number;
  depositBefore?: number;
  depositUsed?: number;
  depositAfter?: number;
  depositRefunded?: boolean;
  depositRefundedAt?: string;
  paymentDue?: number;
  paymentMethod?: string;
  totalPaid?: number;
  paymentFee?: number;
  email?: string;
  device?: string;
  note?: string;
  qrisStatus: "paid" | "pending" | "expired";
  orderStatus: "pending" | "processing" | "completed" | "cancelled";
  deliveryStatus?: "waiting_payment" | "paid_by_deposit" | "sent" | "failed" | "stock_unavailable_deposit";
  deliveryError?: string;
  qrisUrl?: string;
  paymentError?: string;
  paymentExpiresAt?: string;
  fulfillmentText?: string;
  snkText?: string;
  fulfillmentSentAt?: string;
  stockPolicy?: string;
  stockRaceDepositAmount?: number;
  stockRaceDepositCreditedAt?: string;
  latePaidDepositCredited?: boolean;
  latePaidDepositCreditedAt?: string;
  latePaidDepositAmount?: number;
  source?: string;
  whatsappDeliveryStatus?: "sent" | "failed" | string;
  whatsappNotificationStatus?: "sent" | "failed" | string;
  whatsappNotificationSentAt?: string;
  whatsappNotificationError?: string;
  channel: string;
  createdAt: string;
  deliveredStockIds?: string[];
};

export type Reseller = {
  id: string;
  name: string;
  username: string;
  password: string;
  email?: string;
  whatsapp: string;
  allowedAccessTools?: Array<"signin" | "verification" | "reset" | "household">;
  isActive: boolean;
  orders: number;
  revenue: number;
  deposit?: number;
  joinedAt?: string;
};

export type ManagedAccount = {
  id: string;
  stockId: string;
  resellerId?: string;
  product: string;
  productId?: string;
  variant?: string;
  variantId?: string;
  variantCode?: string;
  stockPoolKey?: string;
  duration?: string;
  durationDays?: number;
  source?: "web_order" | "manual_input" | "assign_daily" | string;
  usageMode?: "monthly" | "daily" | "manual" | string;
  snapshotAt?: string;
  returnedToStockAt?: string;
  device?: string;
  sheetStockKey?: string;
  sheetSource?: string;
  sheetPool?: string;
  sheetPoolSchema?: string;
  sheetRow?: number;
  sheetStartColumn?: number;
  sheetName?: string;
  accountType?: string;
  canvaLink?: string;
  canvaPoolId?: string;
  orderId?: string;
  sourceOrderId?: string;
  googleSheetsSyncedAt?: string;
  email: string;
  loginPhone?: string;
  otpEmail?: string;
  password?: string;
  buyer: string;
  reseller?: string;
  whatsapp?: string;
  profile?: string;
  pin?: string;
  signInCode?: string;
  verificationCode?: string;
  resetLink?: string;
  householdLink?: string;
  startedAt: string;
  expiresAt: string;
  status: "active" | "expiring" | "expired" | "replaced" | "disabled";
  hidden?: boolean;
  replacedAt?: string;
  replacedByAccountId?: string;
  replacedByStockId?: string;
  replacementReason?: string;
  replacementDisposition?: string;
};

export type WhatsAppGroup = {
  id: string;
  name: string;
  product: string;
  memberCount: number;
  limit: number;
  monthlyRent: number;
  isOpen: boolean;
  accounts: Array<{
    id: string;
    email: string;
    buyer: string;
    startedAt: string;
    expiresAt: string;
  }>;
};

export type Activity = {
  id: string;
  type: "order" | "stock" | "reseller" | "whatsapp" | "account" | "security";
  title: string;
  description: string;
  createdAt: string;
  resellerId?: string;
  whatsapp?: string;
  accountId?: string;
  accountEmail?: string;
  product?: string;
  variant?: string;
  orderId?: string;
  amount?: number;
  depositBefore?: number;
  depositUsed?: number;
  depositAdded?: number;
  depositAfter?: number;
  lookupType?: "signin" | "verification" | "reset" | "household" | string;
  lookupSource?: string;
  lookupStatus?: string;
  lookupLabel?: string;
  lookupSuccess?: boolean;
  actorName?: string;
  actorRole?: string;
  actorWhatsapp?: string;
};

export const ownerContact = {
  name: "Kavya Owner",
  whatsapp: "6287777655549",
};

export const products: Product[] = [
  {
    id: "prod-netflix",
    name: "Netflix Premium",
    description: "Akun Netflix premium untuk profile private dan sharing.",
    category: "Streaming",
    isActive: true,
    needsProfile: true,
    needsPin: true,
    code: "NET",
    variants: [
      {
        id: "net-1p1u",
        code: "NET-1P1U",
        name: "1 Profile 1 User",
        description: "Profile private dengan PIN.",
        prices: { "1 Bulan": 45000, "3 Bulan": 120000, "6 Bulan": 220000, "12 Bulan": 400000 },
        snk: "Dilarang ubah email, password, dan PIN tanpa izin owner.",
      },
      {
        id: "net-2p1u",
        code: "NET-2P1U",
        name: "2 Profile 1 User",
        description: "Dua profile untuk satu buyer.",
        prices: { "1 Bulan": 65000, "3 Bulan": 180000, "6 Bulan": 330000 },
        snk: "Gunakan profile sesuai nama buyer.",
      },
    ],
  },
  {
    id: "prod-spotify",
    name: "Spotify Premium",
    description: "Akun musik premium siap pakai.",
    category: "Music",
    isActive: true,
    needsProfile: false,
    needsPin: false,
    code: "SPO",
    variants: [
      {
        id: "spo-ind",
        code: "SPO-IND",
        name: "Individual",
        description: "Akun individual premium.",
        prices: { "1 Bulan": 25000, "3 Bulan": 70000, "6 Bulan": 130000 },
        snk: "Tidak boleh mengganti data login.",
      },
    ],
  },
  {
    id: "prod-wetv",
    name: "WeTV VIP",
    description: "Akun VIP untuk series Asia.",
    category: "Streaming",
    isActive: true,
    needsProfile: false,
    needsPin: false,
    code: "WETV",
    variants: [
      {
        id: "wetv-vip",
        code: "WETV-VIP",
        name: "VIP Shared",
        description: "Shared login untuk tontonan harian.",
        prices: { "1 Bulan": 18000, "3 Bulan": 50000 },
        snk: "Pemakaian wajar, satu perangkat aktif.",
      },
    ],
  },
  {
    id: "prod-iqiyi",
    name: "iQiyi Premium",
    description: "Premium drama dan anime.",
    category: "Streaming",
    isActive: true,
    needsProfile: false,
    needsPin: false,
    code: "IQIYI",
    variants: [
      {
        id: "iqiyi-prem",
        code: "IQIYI-PREM",
        name: "Premium",
        description: "Akun premium shared.",
        prices: { "1 Bulan": 20000, "3 Bulan": 55000 },
        snk: "Jangan ubah password.",
      },
    ],
  },
  {
    id: "prod-hbo",
    name: "HBO GO",
    description: "Akun HBO dengan profile dan PIN.",
    category: "Streaming",
    isActive: true,
    needsProfile: true,
    needsPin: true,
    code: "HBO",
    variants: [
      {
        id: "hbo-go",
        code: "HBO-GO",
        name: "Shared Profile",
        description: "Profile terpisah untuk buyer.",
        prices: { "1 Bulan": 28000, "3 Bulan": 75000 },
        snk: "Gunakan profile yang diberikan admin.",
      },
    ],
  },
];

export const stockItems: StockItem[] = [
  {
    id: "stk-001",
    productId: "prod-netflix",
    variantId: "net-1p1u",
    email: "nf.account.a001@gmail.com",
    password: "NfPrem2026!",
    profile: "Profile 1",
    pin: "3847",
    status: "available",
    createdAt: "2026-05-20",
    signInCode: "728194",
    verificationCode: "492817",
  },
  {
    id: "stk-002",
    productId: "prod-netflix",
    variantId: "net-2p1u",
    email: "nf.account.b002@gmail.com",
    password: "NfDuo2026!",
    profile: "Ayu",
    pin: "1928",
    status: "reserved",
    createdAt: "2026-05-21",
  },
  {
    id: "stk-003",
    productId: "prod-spotify",
    variantId: "spo-ind",
    email: "spotify.premium.03@mail.com",
    password: "Spot2026!",
    status: "available",
    createdAt: "2026-05-23",
  },
  {
    id: "stk-004",
    productId: "prod-hbo",
    variantId: "hbo-go",
    email: "hbo.shared.04@mail.com",
    password: "HboGo2026!",
    profile: "Kavya 4",
    pin: "9041",
    status: "sold",
    createdAt: "2026-05-18",
  },
  {
    id: "stk-005",
    productId: "prod-wetv",
    variantId: "wetv-vip",
    email: "wetv.vip.05@mail.com",
    password: "Wetv2026!",
    status: "available",
    createdAt: "2026-05-22",
  },
  {
    id: "stk-006",
    productId: "prod-netflix",
    variantId: "net-1p1u",
    email: "nf.extramember@email.com",
    password: "ExtraNf77",
    profile: "Extra",
    pin: "9999",
    status: "available",
    createdAt: "2026-05-19",
  },
  {
    id: "stk-007",
    productId: "prod-iqiyi",
    variantId: "iqiyi-prem",
    email: "iqiyi.premium@email.com",
    password: "IqiyiPre55",
    status: "available",
    createdAt: "2026-05-23",
  },
  {
    id: "stk-008",
    productId: "prod-spotify",
    variantId: "spo-ind",
    email: "spotify.individual@email.com",
    password: "SpotInd99",
    status: "available",
    createdAt: "2026-05-23",
  },
];

export const orders: Order[] = [
  {
    id: "ORD-2026-001",
    customer: "Budi Santoso",
    whatsapp: "6281234567890",
    product: "Netflix Premium",
    variant: "1 Profile 1 User",
    duration: "1 Bulan",
    total: 45000,
    qrisStatus: "paid",
    orderStatus: "completed",
    channel: "Public",
    createdAt: "2026-05-25 14:35",
  },
  {
    id: "ORD-2026-002",
    customer: "Jaya Digital",
    whatsapp: "6289876543210",
    product: "Spotify Premium",
    variant: "Individual",
    duration: "3 Bulan",
    total: 70000,
    qrisStatus: "pending",
    orderStatus: "processing",
    channel: "Reseller",
    createdAt: "2026-05-25 15:10",
  },
  {
    id: "ORD-2026-003",
    customer: "Siti Aminah",
    whatsapp: "6282223445566",
    product: "HBO GO",
    variant: "Shared Profile",
    duration: "1 Bulan",
    total: 28000,
    qrisStatus: "expired",
    orderStatus: "cancelled",
    channel: "Public",
    createdAt: "2026-05-24 19:12",
  },
  {
    id: "ORD-2026-004",
    customer: "Nusantara Stream",
    whatsapp: "6281122334455",
    product: "iQiyi Premium",
    variant: "Premium",
    duration: "3 Bulan",
    total: 55000,
    qrisStatus: "paid",
    orderStatus: "completed",
    channel: "Reseller",
    createdAt: "2026-05-23 11:45",
  },
  {
    id: "ORD-2026-005",
    customer: "Dewi Lestari",
    whatsapp: "6285566778899",
    product: "Netflix Premium",
    variant: "2 Profile 1 User",
    duration: "12 Bulan",
    total: 480000,
    qrisStatus: "paid",
    orderStatus: "processing",
    channel: "Reseller",
    createdAt: "2026-05-24 17:22",
  },
  {
    id: "ORD-2026-006",
    customer: "Lina Kusuma",
    whatsapp: "6283344556677",
    product: "WeTV VIP",
    variant: "VIP Shared",
    duration: "3 Bulan",
    total: 60000,
    qrisStatus: "expired",
    orderStatus: "cancelled",
    channel: "Public",
    createdAt: "2026-05-23 08:20",
  },
  {
    id: "ORD-2026-007",
    customer: "Rian Mahendra",
    whatsapp: "6287788990011",
    product: "Netflix Premium",
    variant: "1 Profile 1 User",
    duration: "1 Bulan",
    total: 42000,
    qrisStatus: "paid",
    orderStatus: "completed",
    channel: "Public",
    createdAt: "2026-05-22 19:55",
  },
  {
    id: "ORD-2026-008",
    customer: "Dian Permata",
    whatsapp: "6286677889900",
    product: "Spotify Premium",
    variant: "Individual",
    duration: "6 Bulan",
    total: 180000,
    qrisStatus: "paid",
    orderStatus: "completed",
    channel: "Reseller",
    createdAt: "2026-05-22 16:10",
  },
];

export const resellers: Reseller[] = [
  {
    id: "res-001",
    name: "Jaya Digital",
    username: "jaya.digital",
    password: "jaya12345",
    whatsapp: "6289876543210",
    isActive: true,
    orders: 34,
    revenue: 3525000,
  },
  {
    id: "res-002",
    name: "Nusantara Stream",
    username: "nusantara",
    password: "nusa12345",
    whatsapp: "6281122334455",
    isActive: true,
    orders: 21,
    revenue: 1850000,
  },
  {
    id: "res-003",
    name: "Streamindo",
    username: "streamindo",
    password: "stream123",
    whatsapp: "6285566778899",
    isActive: false,
    orders: 8,
    revenue: 610000,
  },
];

export const managedAccounts: ManagedAccount[] = [
  {
    id: "acc-001",
    stockId: "stk-001",
    product: "Netflix Premium",
    variant: "1p1u",
    email: "nf.account.a001@gmail.com",
    buyer: "Ayu Lestari",
    reseller: "Jaya Digital",
    profile: "Profile 1",
    pin: "1234",
    startedAt: "2026-05-01",
    expiresAt: "2026-05-26",
    status: "expiring",
  },
  {
    id: "acc-002",
    stockId: "stk-003",
    product: "Spotify Premium",
    variant: "Family",
    email: "spotify.premium.03@mail.com",
    buyer: "Budi Santoso",
    reseller: "Budi Santoso",
    startedAt: "2026-05-10",
    expiresAt: "2026-06-04",
    status: "active",
  },
  {
    id: "acc-003",
    stockId: "stk-004",
    product: "HBO GO",
    variant: "Shared",
    email: "hbo.shared.04@mail.com",
    buyer: "Rani Putri",
    reseller: "Rina Marlina",
    startedAt: "2026-04-20",
    expiresAt: "2026-05-15",
    status: "expired",
  },
  {
    id: "acc-004",
    stockId: "stk-002",
    product: "Netflix Premium",
    variant: "1p2u",
    email: "nf.account.b002@gmail.com",
    buyer: "Siti Aminah",
    reseller: "Siti Aminah",
    profile: "Profile 2",
    pin: "5678",
    startedAt: "2026-05-20",
    expiresAt: "2026-06-14",
    status: "active",
  },
  {
    id: "acc-005",
    stockId: "stk-006",
    product: "Netflix Premium",
    variant: "Extra Member",
    email: "nf.extramember@email.com",
    buyer: "Dimas Ardi",
    reseller: "Rina Marlina",
    profile: "Extra",
    pin: "9999",
    startedAt: "2026-04-28",
    expiresAt: "2026-05-23",
    status: "expired",
  },
  {
    id: "acc-006",
    stockId: "stk-005",
    product: "WeTV VIP",
    variant: "VIP",
    email: "wetv.vip.05@mail.com",
    buyer: "Siti Aminah",
    reseller: "Siti Aminah",
    startedAt: "2026-05-22",
    expiresAt: "2026-06-16",
    status: "active",
  },
  {
    id: "acc-007",
    stockId: "stk-007",
    product: "iQiyi Premium",
    variant: "Premium",
    email: "iqiyi.premium@email.com",
    buyer: "Dimas Ardi",
    reseller: "Dimas Ardi",
    startedAt: "2026-05-01",
    expiresAt: "2026-05-26",
    status: "expiring",
  },
];

export const whatsappGroups: WhatsAppGroup[] = [
  {
    id: "grp-001",
    name: "Netflix Premium Members #1",
    product: "Netflix Premium",
    memberCount: 48,
    limit: 100,
    monthlyRent: 50000,
    isOpen: true,
    accounts: [
      {
        id: "ga-001",
        email: "nf.account.a001@gmail.com",
        buyer: "Ayu Lestari",
        startedAt: "2026-05-01",
        expiresAt: "2026-05-26",
      },
    ],
  },
  {
    id: "grp-002",
    name: "HBO GO Lounge",
    product: "HBO GO",
    memberCount: 35,
    limit: 60,
    monthlyRent: 75000,
    isOpen: false,
    accounts: [],
  },
];

export const activities: Activity[] = [
  {
    id: "act-001",
    type: "order",
    title: "Order baru dari Ahmad Fauzi",
    description: "Netflix 1p1u 1 Bulan",
    createdAt: "2026-05-25 14:37",
  },
  {
    id: "act-002",
    type: "account",
    title: "Reseller Budi Santoso login ke dashboard",
    description: "Login berhasil dari panel reseller.",
    createdAt: "2026-05-25 13:50",
  },
  {
    id: "act-003",
    type: "stock",
    title: "Stok akun Netflix 1p2u ditambahkan",
    description: "+5 item masuk ke stok tersedia.",
    createdAt: "2026-05-25 12:15",
  },
  {
    id: "act-004",
    type: "reseller",
    title: "Reseller baru didaftarkan: Siti Aminah",
    description: "Akun reseller aktif.",
    createdAt: "2026-05-25 11:40",
  },
  {
    id: "act-005",
    type: "order",
    title: "Order ORD-20260524-002 status: Dibayar",
    description: "QRIS sudah masuk.",
    createdAt: "2026-05-25 10:55",
  },
  {
    id: "act-006",
    type: "whatsapp",
    title: "Grup Netflix Jakarta diperpanjang",
    description: "Durasi sewa +7 hari.",
    createdAt: "2026-05-25 09:30",
  },
  {
    id: "act-007",
    type: "stock",
    title: "Akun spotify.family@email.com status: Terjual",
    description: "Stok berubah otomatis setelah order selesai.",
    createdAt: "2026-05-25 08:45",
  },
  {
    id: "act-008",
    type: "order",
    title: "Order ORD-20260523-089 status: Selesai",
    description: "Akun terkirim ke customer.",
    createdAt: "2026-05-23 09:15",
  },
  {
    id: "act-009",
    type: "account",
    title: "Owner login ke dashboard",
    description: "Login panel owner.",
    createdAt: "2026-05-23 08:00",
  },
  {
    id: "act-010",
    type: "reseller",
    title: "Reseller Budi Santoso status diubah menjadi Nonaktif",
    description: "Perubahan status manual oleh owner.",
    createdAt: "2026-05-23 07:30",
  },
];

export const chartRevenue = [
  { month: "Sen", revenue: 4100000, orders: 16 },
  { month: "Sel", revenue: 6800000, orders: 21 },
  { month: "Rab", revenue: 3500000, orders: 12 },
  { month: "Kam", revenue: 8200000, orders: 27 },
  { month: "Jum", revenue: 6100000, orders: 19 },
  { month: "Sab", revenue: 9400000, orders: 34 },
  { month: "Min", revenue: 7600000, orders: 28 },
];

export const categoryChart = [
  { name: "Streaming", value: 68 },
  { name: "Music", value: 18 },
  { name: "Tools", value: 9 },
  { name: "Other", value: 5 },
];

export const dashboardStats = {
  todayOrders: 23,
  pendingQris: 3,
  activeAccounts: 148,
  revenueThisMonth: 48750000,
  lowStock: 3,
  activeResellers: 18,
};

export function formatRupiah(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  })
    .format(value)
    .replace("IDR", "Rp")
    .trim();
}

export function getProduct(productId: string) {
  return products.find((product) => product.id === productId);
}

export function getVariant(productId: string, variantId: string) {
  return getProduct(productId)?.variants.find((variant) => variant.id === variantId);
}
