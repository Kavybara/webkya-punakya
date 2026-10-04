import type { Activity, ManagedAccount, Order, Product, ProductVariant, Reseller, StockItem } from "./types";
import { clearSession, readSession } from "./session";

type JsonBody = Record<string, unknown> | Array<unknown> | undefined;

export type ApiProduct = Product;
export type ApiStockItem = StockItem & {
  availableCount?: number;
  notes?: string;
  reservedFor?: string;
};
export type ApiDeliveredAccount = Pick<
  ManagedAccount,
  "id" | "stockId" | "orderId" | "product" | "variant" | "email" | "profile" | "startedAt" | "expiresAt" | "status" | "reseller" | "buyer" | "device" | "source"
> & {
  loginPhone?: string;
  password?: string;
  pin?: string;
  canvaLink?: string;
  sheetName?: string;
  sheetRow?: number;
  sheetPool?: string;
};
export type ApiOrderTraceEvent = {
  id: string;
  type: string;
  tone: string;
  title: string;
  detail: string;
  createdAt: string;
};
export type ApiOrder = Order & {
  customer?: string;
  whatsapp?: string;
  paidAt?: string;
  reseller?: string;
  resellerId?: string;
  resellerName?: string;
  isSmokeTest?: boolean;
  excludeFromSalesMetrics?: boolean;
  smokeTestLabel?: string;
  quotedTotal?: number;
  smokeTestCatalogTotal?: number;
  manualApproved?: boolean;
  manualApprovedAt?: string;
  manualApprovedBy?: string;
  manualApprovalReason?: string;
  deliveredAccounts?: ApiDeliveredAccount[];
  deliveredAccountCount?: number;
  traceEvents?: ApiOrderTraceEvent[];
  trackingToken?: string;
};
export type DeliveryTemplateConfig = {
  productId: string;
  variantId: string;
  sku: string;
  source: string;
  version: number;
  requiredFields: Array<string | string[]>;
  updatedAt: string;
  updatedBy: string;
  placeholders: string[];
};
export type DeliveryTemplatePreview = {
  previewData: true;
  validation: { ok: boolean; errors: string[]; warnings: string[]; usedFields: string[] };
  rendered: { ok: boolean; text: string; errors: string[]; warnings: string[]; missingFields: string[]; usedFields: string[] };
};
export type AccountDeliveryDetail = {
  account: {
    id: string;
    orderId: string;
    product: string;
    variant: string;
    email?: string;
    loginPhone?: string;
    password?: string;
    canvaLink?: string;
    profile?: string;
    pin?: string;
    duration?: string;
    startedAt?: string;
    expiresAt?: string;
    status?: string;
  };
  deliveryTemplateSnapshot: ManagedAccount["deliveryTemplateSnapshot"];
};
export type PublicTrackingOrder = {
  orderId: string;
  product: string;
  variant: string;
  paymentStatus: string;
  orderStatus: string;
  processStatus: string;
  createdAt: string;
  paidAt?: string;
  customerContact?: string;
  helpAvailable: boolean;
};
export type ApiReseller = Reseller;
export type ApiAccount = ManagedAccount;
export type WarrantyClaimStatus = "submitted" | "reviewing" | "waiting_evidence" | "replaced" | "resolved" | "rejected";
export type WarrantyClaim = {
  id: string;
  resellerId: string;
  resellerName?: string;
  accountId: string;
  orderId: string;
  stockId: string;
  productId: string;
  variantId: string;
  product: string;
  variant: string;
  accountIdentity: string;
  profile?: string;
  issue: string;
  status: WarrantyClaimStatus;
  createdAt: string;
  updatedAt: string;
  ownerNote?: string;
  submissionSource?: "reseller_dashboard" | "owner_manual_whatsapp" | string;
  createdByRole?: "owner" | "reseller" | string;
  createdBy?: string;
  ownerNotificationStatus?: "pending" | "sent" | "failed" | string;
  replacementNotificationStatus?: "pending" | "sent" | "failed" | string;
  replacementNotificationError?: string;
  ownerReplacementNotificationStatus?: "pending" | "sent" | "failed" | string;
  ownerReplacementNotificationError?: string;
  statusNotificationStatus?: "pending" | "sent" | "failed" | string;
  statusNotificationError?: string;
  replacementSyncStatus?: "pending" | "failed" | "synced" | string;
  replacementSyncError?: string;
  stockReviewTriggered?: boolean;
  stockReviewProfileCount?: number;
  stockReviewProfiles?: string[];
  stockReviewStockIds?: string[];
  stockReviewSyncStatus?: "pending" | "failed" | "synced" | "not_required" | string;
  stockReviewSyncError?: string;
  stockReviewSyncUpdatedAt?: string;
  warrantyDays?: number;
  warrantyStartedAt?: string;
  warrantyEndsAt?: string;
  holdStartedAt?: string;
  holdEndedAt?: string;
  holdAppliedMinutes?: number;
  reviewElapsedMinutes?: number;
  reviewDueAt?: string;
  reviewOverdue?: boolean;
  evidence?: Array<{
    id: string;
    mimeType: string;
    originalName: string;
    size: number;
    createdAt: string;
  }>;
  replacement?: {
    id: string;
    oldAccountId: string;
    oldStockId: string;
    newAccountId: string;
    newStockId: string;
    createdAt: string;
    originalExpiresAt?: string;
    adjustedExpiresAt?: string;
    holdAppliedMinutes?: number;
    manualByOrder?: boolean;
  };
};
export type WarrantyManualReplacementPayload = {
  reason?: string;
  account: {
    email?: string;
    login?: string;
    username?: string;
    loginPhone?: string;
    password: string;
    profile?: string;
    pin?: string;
    expiresAt?: string;
    otpEmail?: string;
    canvaLink?: string;
    signInCode?: string;
    verificationCode?: string;
    resetLink?: string;
    householdLink?: string;
  };
};
export type WarrantyManualClaimOption = {
  accountId: string;
  orderId: string;
  resellerId: string;
  resellerName: string;
  product: string;
  variant: string;
  accountIdentity: string;
  profile: string;
  status: string;
  warrantyDays: number;
  warrantyEndsAt: string;
  remainingDays: number;
};
export type WarrantyReplacementCandidate = {
  id: string;
  productId: string;
  variantId: string;
  stockPoolKey: string;
  sheetPool: string;
  sheetName: string;
  sheetRow: number;
  identity: string;
  profile: string;
  status: string;
};
export type ApiActivity = Omit<Activity, "type"> & { type: Activity["type"] | "security" };
export type AccountAccessLookupType = "signin" | "verification" | "reset" | "household" | "disney_otp";
export type ApiDepositRequest = {
  id: string;
  resellerId: string;
  resellerName: string;
  whatsapp?: string;
  amount: number;
  method: string;
  note?: string;
  status?: "pending" | "approved" | "rejected" | string;
  deliveryStatus?: string;
  deliveryMessageKey?: string | null;
  paymentStatus?: string;
  orderId?: string;
  paymentRef?: string;
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
};

export type OperationIssue = {
  id: string;
  severity: "high" | "medium" | "low" | string;
  kind: string;
  title: string;
  detail: string;
  /**
   * Whether the owner can resolve this by correcting something they control --
   * almost always a row in Google Sheets -- as opposed to the system
   * disagreeing with itself.
   *
   * The distinction matters because the queues mix both under one count. A
   * malformed account row is a typo the owner can fix in a minute. A stale
   * reservation or a duplicated managed account is an internal inconsistency
   * that no edit to Sheets resolves, and pointing the owner at Sheets for one
   * sends them hunting for a mistake they did not make. Absent means "not the
   * owner's to fix".
   */
  ownerFixable?: boolean;
  createdAt?: string;
  href?: string;
  orderId?: string;
  accountId?: string;
  stockId?: string;
  requestId?: string;
  groupId?: string;
  resellerId?: string;
  code?: string;
  sheetName?: string;
  sheetRow?: number;
  identity?: string;
};

export type SheetsAuditSummary = {
  rowsRead: number;
  matched: number;
  invalid: number;
  ambiguous: number;
  mismatch: number;
  duplicateStock: number;
  paidNotDelivered: number;
};

export type ExpiryQueueItem = {
  id: string;
  accountId: string;
  stockId?: string;
  orderId?: string;
  product: string;
  variant: string;
  email: string;
  buyer?: string;
  reseller?: string;
  status: string;
  startedAt: string;
  expiresAt: string;
  daysLeft: number | null;
  severity: "high" | "medium" | "low" | string;
  needsAction: string;
  href?: string;
};

export type WalletLedgerEntry = {
  id: string;
  type: string;
  kind: "credit" | "debit" | string;
  resellerId?: string;
  resellerName: string;
  whatsapp?: string;
  amount: number;
  balanceBefore?: number;
  balanceAfter?: number;
  orderId?: string;
  requestId?: string;
  createdAt: string;
  status?: string;
  detail: string;
};

export type WalletLedgerResellerSummary = {
  resellerId?: string;
  resellerName: string;
  whatsapp?: string;
  currentBalance: number;
  totalTopup: number;
  totalSpent: number;
  totalRefund: number;
  totalLateCredit: number;
  totalOrders: number;
};

export type WhatsappHealthConnection = {
  connected: boolean;
  state: string;
  error?: string;
  publicQrUrl?: string;
  ownerWhatsAppNumber?: string;
  lastReconnectAt?: string;
  nextReconnectDelayMs?: number;
  lastDisconnectAt?: string;
  lastDisconnectReason?: string;
  reconnectAttempts?: number;
  warmingUp?: boolean;
};

export type WhatsappHealthMessage = {
  id: string;
  direction: string;
  from?: string;
  to?: string;
  body: string;
  createdAt: string;
};

export type WhatsappSilentGroup = {
  id: string;
  groupId?: string;
  name: string;
  groupJid?: string;
  daysLeft?: number;
  joinStatus?: string;
  joinError?: string;
  listCount?: number;
  severity: "high" | "medium" | "low" | string;
  reason: string;
  href?: string;
};

export type OperationsCenterResult = {
  generatedAt?: string;
  readOnly?: boolean;
  snapshotVersion?: string;
  findings?: OperationIssue[];
  checkedAt: string;
  deliveryAudit: {
    summary: { total: number; high: number; missingAccounts: number; duplicateDrops: number; sheetPending: number; whatsappFailed: number };
    items: OperationIssue[];
  };
  stockLocks: {
    summary: { total: number; stale: number; waitingPayment: number; linkedDaily: number };
    items: OperationIssue[];
  };
  reconcile: {
    summary: { total: number; high: number; medium: number; low: number; managedDuplicates: number; highOwnerFixable?: number; highSystemSide?: number };
    issues: OperationIssue[];
  };
  expiry: {
    summary: { expiringSoon: number; expiredActive: number; durationAnomalies: number };
    expiringSoon: ExpiryQueueItem[];
    expiredActive: ExpiryQueueItem[];
    durationAnomalies: ExpiryQueueItem[];
  };
  wallet: {
    summary: { totalBalance: number; totalTopup: number; totalSpent: number; resellerCount: number; pendingRequests: number };
    resellerSummaries: WalletLedgerResellerSummary[];
    entries: WalletLedgerEntry[];
  };
  reseller: {
    summary: { total: number; high: number; medium: number; missingOwner: number; legacyLinkOwnerless: number; orderMissingAccounts: number; duplicateDrops: number; managedDuplicates: number };
    items: OperationIssue[];
  };
  sheetsAudit?: {
    checkedAt: string;
    automatedCheckedAt?: string;
    automatedSummary?: SheetsAuditSummary | null;
    summary: SheetsAuditSummary;
    issues: OperationIssue[];
  };
  whatsapp: {
    summary: { connected: boolean; recentInbound: number; recentOutbound: number; silentGroups: number; failures: number };
    connection: WhatsappHealthConnection;
    recentMessages: WhatsappHealthMessage[];
    silentGroups: WhatsappSilentGroup[];
    recentFailures: OperationIssue[];
  };
  manual: {
    summary: { total: number; high: number; medium: number; low: number; pendingDeposits: number };
    items: OperationIssue[];
  };
};

export type AccountAccessLookupResult = {
  ok: boolean;
  type: AccountAccessLookupType;
  account: Pick<ManagedAccount, "id" | "product" | "variant" | "email" | "profile" | "startedAt" | "expiresAt" | "status" | "loginPhone">;
  result: {
    source: "gmail" | "managed_account" | "mapping" | "fallback" | string;
    mode?: "imap" | "oauth" | string;
    kind?: "code" | "link" | "form";
    value?: string;
    label?: string;
    reason?: string;
    error?: string;
    messageId?: string;
    subject?: string;
    from?: string;
    date?: string;
    internalDate?: string;
    /**
     * Only present when `reason` is `"stale"` -- the code is in the mailbox but
     * arrived outside the window. That is a different instruction to the
     * reseller than "it has not arrived", so it is not folded into `not_found`.
     */
    staleMessage?: {
      subject: string;
      from: string;
      date: string;
      internalDate: string;
      dateMs: number;
      ageMinutes: number;
      windowMinutes: number;
    };
  };
  refreshedAt: string;
  expiresInSeconds: number | null;
  gmail: {
    configured: boolean;
    connected: boolean;
    mode?: "imap" | "oauth" | string;
    needsOAuth?: boolean;
    error?: string;
  };
};
export type OwnerAccountAccessAccount = AccountAccessLookupResult["account"];

export type CatalogVariant = ProductVariant & {
  stockCount: number;
};

export type CatalogProduct = Omit<Product, "variants"> & {
  variants: CatalogVariant[];
  stockCount: number;
};

export type ApiPayment = {
  ref: string;
  orderId: string;
  status: "pending" | "paid" | "expired" | string;
  amount: number;
  provider: string;
  createdAt: string;
  expiresAt?: string;
  paymentUrl?: string;
  qrisText?: string;
  qrString?: string;
  // No `qrImageUrl`: the provider returns the raw string only, and the code is
  // drawn from it in the browser. See lib/qrisQr.ts. Leaving the field off the
  // type is deliberate -- a payment image fetched over the network is a payment
  // image we neither control nor vouch for, and this makes reaching for one a
  // compile error rather than a code review question.
  paymentNumber?: string;
  providerStatus?: string;
  providerError?: string;
  fee?: number;
  depositBefore?: number;
  depositUsed?: number;
  depositAfter?: number;
  totalPayment?: number;
  paymentMethod?: string;
  order?: ApiOrder;
};

export type OwnerProfile = {
  name: string;
  username: string;
  email: string;
  whatsapp: string;
  initial: string;
};

type IntegrationStatus = "connected" | "degraded" | "needs_oauth" | "disconnected";

export type OwnerPaymentSettings = {
  ownerQrisImageUrl: string;
  ownerQrisNote: string;
  danaNumber: string;
  danaName: string;
  livinNumber: string;
  livinName: string;
  bcaNumber: string;
  bcaName: string;
  gopayNumber: string;
  gopayName: string;
  shopeepayNumber: string;
  shopeepayName: string;
};

export type ResellerDepositInstructionChannel = {
  label: string;
  accountNumber?: string;
  accountName?: string;
  note?: string;
  imageUrl?: string;
  available: boolean;
};

export type ResellerDepositInstructions = {
  ownerName: string;
  ownerWhatsapp: string;
  pakasirConnected?: boolean;
  methods: Record<string, ResellerDepositInstructionChannel>;
};

export type OwnerSettings = {
  profile: OwnerProfile;
  pakasir: {
    apiKey: string;
    merchantId: string;
    webhookSecret: string;
  };
  bailey: {
    sessionId: string;
    botNumber: string;
    publicUrl: string;
    webhookUrl: string;
    qrisGenerateUrl: string;
    botToken: string;
    inboundToken: string;
  };
  gmail: {
    mode: "imap" | "oauth" | string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    inboxEmail: string;
    refreshToken?: string;
    imapHost: string;
    imapPort: number;
    imapUser: string;
    imapPassword: string;
    imapSecure: boolean;
  };
  googleSheets: {
    spreadsheetId: string;
    sheetName: string;
    serviceAccountEmail: string;
    privateKey: string;
  };
  cloudflare: {
    publicDomain: string;
    tunnelToken: string;
  };
  payment: OwnerPaymentSettings;
  status: {
    pakasir: IntegrationStatus;
    bailey: IntegrationStatus;
    gmail: IntegrationStatus;
    googleSheets: IntegrationStatus;
  };
};

export type GoogleSheetsStatus = {
  configured: boolean;
  settings: OwnerSettings["googleSheets"];
  lastSyncAt?: string;
  lastSyncAttemptAt?: string;
  healthy?: boolean;
  failedSections?: string[];
  lastSyncSummary?: Record<string, unknown> | null;
};

export type MaintenanceState = {
  enabled: boolean;
  reason: string;
  source: string;
  updatedAt: string;
};

export type GoogleSheetsPreview = {
  addStock: number;
  soldStock: number;
  availableStock: number;
  removedStock: number;
  expiredAccounts: number;
  warnings: string[];
  changes: Array<{ stockId: string; sheetName: string; sheetRow: number; identity: string; profile?: string; type: string; fields: string[] }>;
  rowAudit: { checkedAt: string; summary: SheetsAuditSummary; issues: OperationIssue[] };
  summary: Record<string, unknown>;
};

export type AccountAuditResult = {
  accountId: string;
  stockId: string;
  orderId: string;
  sheet: { name: string; row: number };
  timeline: Array<{ id: string; type: string; title: string; detail: string; createdAt: string; source: string }>;
};

/**
 * One account's credentials, fetched only because that account was opened.
 *
 * A separate type from `ApiAccount` on purpose. The listing endpoint blanks
 * every secret, so a row and a credential are different shapes with different
 * lifetimes -- a credential exists in the browser for as long as its dialog is
 * open and not one moment longer.
 */
export type AccountCredentials = {
  accountId: string;
  email: string;
  loginPhone: string;
  password: string;
  pin: string;
  signInCode: string;
  verificationCode: string;
  resetLink: string;
  householdLink: string;
  otpEmail: string;
  canvaLink: string;
  profile: string;
  product: string;
  variant: string;
  reseller: string;
  status: string;
  expiresAt: string;
};

export type WhatsappRental = {
  id: string;
  groupJid?: string;
  name: string;
  owner?: string;
  contact?: string;
  startedAt: string;
  endsAt: string;
  daysLeft: number;
  monthlyPrice: number;
  status: "active" | "paused" | "expired";
  linkGrub?: string;
  joinStatus?: string;
  joinError?: string;
  listCount?: number;
  sent: number;
  helpedOrders: number;
  replies: number;
};

export type WhatsappListHistory = {
  group: {
    id?: string;
    groupJid?: string;
    name?: string;
    owner?: string;
    contact?: string;
  } | null;
  total: number;
  items: Array<{
    id: string;
    source: "audit" | "snapshot";
    action: string;
    groupJid: string;
    groupName: string;
    keyword: string;
    sender: string;
    senderName: string;
    textPreview: string;
    media: string;
    updatedAt: string;
  }>;
};

export type WhatsappGroupSync = {
  /* `last_synced_at` is null until the bot has synced at least once, which is a
     different situation from a sync that failed -- hence `last_error`. */
  last_synced_at?: string | null;
  last_error?: string;
  group_count?: number;
};

export type WhatsappStatus = {
  connected: boolean;
  state?: string;
  error?: string;
  lastError?: string;
  qrAvailable?: boolean;
  pairingAvailable?: boolean;
  pairingCode?: string;
  publicQrUrl?: string;
  publicUrl?: string;
  botUrl?: string;
  ownerWhatsAppNumber?: string;
  inboundWebhookUrl?: string;
  supportedCommands?: string[];
  group_sync?: WhatsappGroupSync;
};

export type WhatsappGroupSyncResult = {
  success: boolean;
  skipped?: boolean;
  groupCount?: number;
  message?: string;
};

export type PasswordResetRequestResult = {
  ok: boolean;
  botConfigured?: boolean;
  deliveryStatus?: string;
  destination?: string;
  message: string;
};

export type PasswordResetVerifyResult = {
  ok: boolean;
  resetToken: string;
};

export type ResellerCheckResult = {
  ok: boolean;
  active: boolean;
  message: string;
};

export type HealthResult = {
  ok: boolean;
  ownerWhatsAppNumber?: string;
  warrantyWhatsAppNumber?: string;
  whatsappInboundConfigured?: boolean;
  pakasirConfigured?: boolean;
  googleSheetsConfigured?: boolean;
  googleSheetsLastSyncAt?: string;
  googleSheetsLastSyncAttemptAt?: string;
  googleSheetsHealthy?: boolean;
  googleSheetsFailedSections?: string[];
  maintenance?: MaintenanceState;
  /**
   * Whether `kavya-db.json` looks lost rather than merely empty.
   *
   * `store.js` answers a missing database file with `defaultData`, which has an
   * empty `resellers` array -- so a total loss renders as a healthy site with
   * an empty reseller table and no error. The server decides which case this is
   * (see `services/data-loss-detector.js`) and sends the owner-facing wording
   * alongside it, so the client never re-derives the condition.
   */
  databaseLoss?: {
    lost: boolean;
    reason: string;
    resellerCount: number;
    orderCount: number;
    orphanedOrderCount: number;
    paymentCount: number;
  };
  /** Empty string unless a loss was detected. */
  databaseLossMessage?: string;
};

export type SystemStatus = {
  ok: boolean;
  checkedAt: string;
  server: {
    hostname: string;
    platform: string;
    arch: string;
    os: string;
    cpus: number;
    uptime: number;
    loadavg: number[];
  };
  memory: {
    total: number;
    used: number;
    free: number;
    available: number;
    percent: number;
  };
  disk: {
    mount: string;
    total: number;
    used: number;
    free: number;
    percent: number;
  };
  swap: {
    total: number;
    used: number;
    free: number;
    enabled: boolean;
  };
  pm2: {
    available: boolean;
    name: string;
    status: string;
    restartCount: number;
    memory: number;
    cpu: number;
    uptime: number;
  };
  whatsapp: {
    connected: boolean;
    state: string;
    error?: string;
    last_reconnect_at?: string;
    next_reconnect_delay_ms?: number;
    last_disconnect_at?: string;
    last_disconnect_reason?: string;
    reconnect_attempts?: number;
    warming_up?: boolean;
  };
  tunnel: {
    configured: boolean;
    running: boolean;
    publicDomain: string;
  };
  integrations?: {
    pakasir: {
      configured: boolean;
      merchantId: string;
    };
    gmail: {
      connected: boolean;
      needsOAuth?: boolean;
      error?: string;
      inboxEmail: string;
    };
    googleSheets: {
      configured: boolean;
      lastSyncAt: string;
      lastSyncAttemptAt?: string;
      healthy?: boolean;
      failedSections?: string[];
      lastSyncSummary: unknown;
    };
    whatsapp: {
      connected: boolean;
      state: string;
      inboundConfigured: boolean;
      ownerWhatsAppNumber: string;
    };
    cloudflare: {
      configured: boolean;
      running: boolean;
      publicDomain: string;
    };
  };
  database?: {
    path: string;
    exists: boolean;
    size: number;
    modifiedAt: string;
    version: number;
  };
  backup?: {
    path: string;
    exists: boolean;
    count: number;
    totalSize: number;
    latestName: string;
    latestSize: number;
    latestAt: string;
  };
  warnings: string[];
};

export type OwnerSearchHit = {
  id: string;
  type: string;
  group: "orders" | "accounts" | "stock" | "resellers" | "products";
  title: string;
  subtitle: string;
  detail: string;
  href: string;
  createdAt?: string;
  status?: string;
};

export type OwnerSearchResult = {
  query: string;
  total: number;
  groups: {
    orders: OwnerSearchHit[];
    accounts: OwnerSearchHit[];
    stock: OwnerSearchHit[];
    resellers: OwnerSearchHit[];
    products: OwnerSearchHit[];
  };
};

export type ResellerRepairResult = {
  ok: boolean;
  changedTotal: number;
  statusUpdated: boolean;
  ownershipUpdated: number;
  rebuiltAccounts: number;
  rebuildResults: Array<{ orderId: string; created: number }>;
  matchedAccounts: number;
  changedAccountIds: string[];
  changedOrderIds: string[];
  postSyncUpdated: number;
  sheets?: Record<string, unknown>;
};

export type OperationsRepairPreview = {
  ok: boolean;
  action: string;
  scope: { accountId: string; orderId: string; resellerId: string };
  previewToken: string;
  generatedAt: string;
  readOnly: true;
  syncSheetsRequested: boolean;
  reason: string;
  risk: string;
  affectedObjects: number;
  before: Record<string, Array<Record<string, unknown>>>;
  after: Record<string, Array<Record<string, unknown>>>;
  result: Partial<ResellerRepairResult>;
};

function apiOrigin() {
  const configured = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
  if (configured) return configured.replace(/\/api$/, "");
  if (typeof window === "undefined") return "http://127.0.0.1:4174";
  const { protocol, hostname, port, origin } = window.location;
  if (port === "5174") return `${protocol}//${hostname}:4174`;
  return origin;
}

function apiUrl(path: string) {
  return `${apiOrigin()}/api${path.startsWith("/") ? path : `/${path}`}`;
}

async function parseResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(path: string, options: { method?: string; body?: JsonBody; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Cache-Control": "no-cache, no-store, max-age=0",
    Pragma: "no-cache",
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(apiUrl(path), {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    credentials: "include",
  });
  const data = await parseResponse(response);
  if (!response.ok) {
    const message = typeof data === "object" && data && "error" in data ? String(data.error) : `Request gagal (${response.status})`;
    if (response.status === 401 && options.auth !== false && typeof window !== "undefined") {
      clearSession();
      const currentPath = `${window.location.pathname}${window.location.search}`;
      const next = currentPath && !currentPath.startsWith("/login") ? `?next=${encodeURIComponent(currentPath)}&reason=session` : "?reason=session";
      window.location.replace(`/login${next}`);
    }
    throw new Error(message);
  }
  return data as T;
}

export function subscribeRealtime(callback: () => void) {
  if (typeof EventSource === "undefined") return () => undefined;
  const events = new EventSource(apiUrl("/events"), { withCredentials: true });
  let refreshTimer: ReturnType<typeof window.setTimeout> | null = null;
  const scheduleRefresh = () => {
    if (refreshTimer) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      callback();
    }, 150);
  };
  events.addEventListener("db-change", scheduleRefresh);
  return () => {
    if (refreshTimer) window.clearTimeout(refreshTimer);
    events.close();
  };
}

export const api = {
  health() {
    return request<HealthResult>("/health", { auth: false });
  },
  login(payload: { email: string; password: string; remember?: boolean; role?: "owner" | "reseller" | "auto" }) {
    return request<{ ok: boolean; role: "owner" | "reseller"; user: Record<string, unknown>; token?: string }>("/auth/login", {
      method: "POST",
      auth: false,
      body: payload,
    });
  },
  authSession() {
    return request<{ ok: boolean; role: "owner" | "reseller"; user: Record<string, unknown> }>("/auth/session");
  },
  registrationConfig() {
    return request<{ enabled: boolean }>("/auth/register/config", { auth: false });
  },
  requestRegistration(payload: { name: string; username: string; email: string; whatsapp: string; password: string; confirmPassword: string }) {
    return request<{ ok: boolean; registrationId: string; expiresInSeconds: number; message: string }>("/auth/register/request", {
      method: "POST",
      auth: false,
      body: payload,
    });
  },
  verifyRegistration(payload: { registrationId: string; code: string }) {
    return request<{ ok: boolean; role: "reseller"; user: Record<string, unknown>; token?: string }>("/auth/register/verify", {
      method: "POST",
      auth: false,
      body: payload,
    });
  },
  logout() {
    return request<{ ok: boolean }>("/auth/logout", { method: "POST" });
  },
  requestPasswordReset(payload: { identifier: string }) {
    return request<PasswordResetRequestResult>("/auth/password-reset/request", { method: "POST", auth: false, body: payload });
  },
  verifyPasswordReset(payload: { identifier: string; code: string }) {
    return request<PasswordResetVerifyResult>("/auth/password-reset/verify", { method: "POST", auth: false, body: payload });
  },
  confirmPasswordReset(payload: { resetToken: string; newPassword: string; confirmPassword: string }) {
    return request<{ ok: boolean }>("/auth/password-reset/confirm", { method: "POST", auth: false, body: payload });
  },
  changePassword(payload: { currentPassword: string; newPassword: string; confirmPassword: string }) {
    return request<{ ok: boolean; token?: string }>("/auth/change-password", { method: "POST", body: payload });
  },
  ownerProfile() {
    return request<OwnerProfile>("/owner-profile");
  },
  updateOwnerProfile(payload: Partial<OwnerProfile>) {
    return request<OwnerProfile>("/owner-profile", { method: "PUT", body: payload });
  },
  ownerSettings() {
    return request<OwnerSettings>("/owner-settings");
  },
  updateOwnerSettings(payload: Partial<OwnerSettings>) {
    return request<OwnerSettings>("/owner-settings", { method: "PUT", body: payload as Record<string, unknown> });
  },
  startGmailOAuth() {
    return request<{ ok: boolean; url: string }>("/gmail/oauth/start");
  },
  googleSheetsStatus() {
    return request<GoogleSheetsStatus>("/google-sheets/status");
  },
  googleSheetsPreview() {
    return request<{ ok: boolean; preview: GoogleSheetsPreview }>("/google-sheets/preview", { method: "POST" });
  },
  setupNetflixSheetsTemplate() {
    return request<{ ok: boolean; sheetName: string; frozenRowCount: number }>("/google-sheets/netflix/template", { method: "POST" });
  },
  setupSheetsTemplate() {
    return request<{ ok: boolean; netflix: unknown; canva: unknown }>("/google-sheets/template", { method: "POST" });
  },
  syncNetflixSheets() {
    return request<Record<string, unknown>>("/google-sheets/netflix/sync", { method: "POST" });
  },
  syncGoogleSheets() {
    return request<Record<string, unknown>>("/google-sheets/sync", { method: "POST" });
  },
  syncGoogleSheetsResellers() {
    return request<{
      ok: boolean;
      checked: number;
      added: number;
      updated: number;
      skippedCount: number;
      conflicts: number;
    }>("/google-sheets/resellers/sync", { method: "POST" });
  },
  maintenance() {
    return request<{ ok: boolean; maintenance: MaintenanceState }>("/maintenance");
  },
  updateMaintenance(payload: { enabled: boolean; reason?: string }) {
    return request<{ ok: boolean; maintenance: MaintenanceState }>("/maintenance", { method: "POST", body: payload });
  },
  previewWaPriceSync() {
    return request<{ ok: boolean; source: Record<string, unknown>; changes: Array<Record<string, unknown>>; cleanup?: Array<Record<string, unknown>>; skipped: Array<Record<string, unknown>>; parsedRows: number }>("/products/price-sync/preview");
  },
  applyWaPriceSync() {
    return request<{ ok: boolean; updated: number; source: Record<string, unknown>; changes: Array<Record<string, unknown>>; cleanup?: Array<Record<string, unknown>> }>("/products/price-sync/apply", { method: "POST" });
  },
  products() {
    return request<ApiProduct[]>("/products");
  },
  createProduct(payload: Omit<ApiProduct, "id">) {
    return request<ApiProduct>("/products", { method: "POST", body: payload as unknown as Record<string, unknown> });
  },
  updateProduct(id: string, payload: Omit<ApiProduct, "id">) {
    return request<ApiProduct>(`/products/${encodeURIComponent(id)}`, { method: "PUT", body: payload as unknown as Record<string, unknown> });
  },
  setProductOrderLock(id: string, payload: { enabled: boolean; reason?: string }) {
    return request<ApiProduct>(`/products/${encodeURIComponent(id)}/lock`, { method: "POST", body: payload });
  },
  setVariantOrderLock(productId: string, variantId: string, payload: { enabled: boolean; reason?: string }) {
    return request<ApiProduct>(`/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}/lock`, { method: "POST", body: payload });
  },
  deliveryTemplate(productId: string, variantId: string) {
    return request<DeliveryTemplateConfig>(`/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}/delivery-template`);
  },
  previewDeliveryTemplate(productId: string, variantId: string, payload: { source: string; requiredFields: Array<string | string[]>; duration?: string; durationDays?: number }) {
    return request<DeliveryTemplatePreview>(`/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}/delivery-template/preview`, { method: "POST", body: payload });
  },
  saveDeliveryTemplate(productId: string, variantId: string, payload: { source: string; requiredFields: Array<string | string[]> }) {
    return request<{ product: ApiProduct; variant: ApiProduct["variants"][number]; validation: DeliveryTemplatePreview["validation"] }>(`/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}/delivery-template`, { method: "PUT", body: payload });
  },
  copyDeliveryTemplate(productId: string, variantId: string, payload: { sourceProductId: string; sourceVariantId: string }) {
    return request<{ product: ApiProduct; variant: ApiProduct["variants"][number] }>(`/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}/delivery-template/copy`, { method: "POST", body: payload });
  },
  archiveProduct(id: string, archived = true) {
    return request<ApiProduct>(`/products/${encodeURIComponent(id)}/${archived ? "archive" : "unarchive"}`, { method: "POST" });
  },
  deleteProduct(id: string) {
    return request<{ ok: boolean }>(`/products/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  catalog() {
    return request<CatalogProduct[]>("/public/catalog", { auth: false });
  },
  catalogAll() {
    return request<CatalogProduct[]>("/public/catalog?includeEmpty=1", { auth: false });
  },
  precheckCatalog(payload: { productId: string; variantId: string }) {
    return request<{ ok: boolean; productId: string; variantId: string; stockCount: number; catalog: CatalogProduct[] }>("/public/catalog/precheck", { method: "POST", auth: false, body: payload });
  },
  checkReseller(whatsapp: string) {
    return request<ResellerCheckResult>(`/public/reseller-check?whatsapp=${encodeURIComponent(whatsapp)}`, { auth: false });
  },
  stock() {
    return request<ApiStockItem[]>("/stock");
  },
  createStock(payload: Partial<ApiStockItem>) {
    return request<ApiStockItem>("/stock", { method: "POST", body: payload as Record<string, unknown> });
  },
  updateStock(id: string, payload: Partial<ApiStockItem>) {
    return request<ApiStockItem>(`/stock/${encodeURIComponent(id)}`, { method: "PUT", body: payload as Record<string, unknown> });
  },
  assignDailyStock(id: string, payload: { resellerId: string; variantId?: string; startedAt: string; durationDays: number; buyer?: string; device?: string }) {
    return request<{ account: ApiAccount; stock: ApiStockItem }>(`/stock/${encodeURIComponent(id)}/assign-daily`, { method: "POST", body: payload });
  },
  deleteStock(id: string) {
    return request<{ ok: boolean }>(`/stock/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  orders() {
    return request<ApiOrder[]>("/orders");
  },
  order(id: string) {
    return request<ApiOrder>(`/orders/${encodeURIComponent(id)}`);
  },
  trackOrder(payload: { trackingToken?: string; orderId?: string; verification?: string }) {
    return request<PublicTrackingOrder>("/public/order-tracking", {
      method: "POST",
      auth: false,
      body: payload,
    });
  },
  createOrder(payload: Record<string, unknown>) {
    return request<ApiOrder>("/orders", { method: "POST", body: payload });
  },
  createSmokeTestOrder(payload: Record<string, unknown>) {
    return request<ApiOrder>("/orders/smoke-test", { method: "POST", body: payload });
  },
  markOrderPaid(id: string) {
    return request<{ ok: boolean; order?: ApiOrder; reply?: string }>(`/orders/${encodeURIComponent(id)}/mark-paid`, { method: "POST" });
  },
  approveOrderManual(id: string, payload: { reason: string }) {
    return request<{ ok: boolean; order?: ApiOrder; reply?: string }>(`/orders/${encodeURIComponent(id)}/approve-manual`, { method: "POST", body: payload });
  },
  retryDelivery(id: string) {
    // `delivery.skipped` is the whole point of reading this. Re-running a
    // delivery that already succeeded is refused by the fulfilment guard, and
    // the server reports that refusal as `{ sent: true, skipped: true }` --
    // which reads as success if the caller only looks at `sent`. Without the
    // flag in the type, the owner page has nothing to tell "sent" apart from
    // "nothing happened", and shows a green toast for the second case.
    return request<{ ok: boolean; order?: ApiOrder; reply?: string; delivery?: { sent?: boolean; skipped?: boolean; reason?: string } }>(`/orders/${encodeURIComponent(id)}/retry-delivery`, { method: "POST" });
  },
  rerenderDeliveryTemplate(id: string) {
    return request<ApiOrder>(`/orders/${encodeURIComponent(id)}/delivery-template/rerender`, { method: "POST" });
  },
  repairOrderSheets(id: string) {
    return request<{ ok: boolean; order: ApiOrder; restored: number; rebuilt: number; sheetResult?: Record<string, unknown> }>(
      `/orders/${encodeURIComponent(id)}/repair-sheets`,
      { method: "POST" },
    );
  },
  releaseStockReservation(id: string) {
    return request<{ ok: boolean; stock: ApiStockItem }>(`/stock/${encodeURIComponent(id)}/release-reservation`, { method: "POST" });
  },
  payment(ref: string) {
    return request<ApiPayment>(`/payments/${encodeURIComponent(ref)}`);
  },
  reconcilePayment(orderId: string) {
    return request<{
      ok: boolean;
      checked: boolean;
      paid: boolean;
      skipped: boolean;
      reason: string;
      payment: ApiPayment;
    }>(`/operations/payments/${encodeURIComponent(orderId)}/reconcile`, { method: "POST" });
  },
  resellers() {
    return request<ApiReseller[]>("/resellers");
  },
  createReseller(payload: Partial<ApiReseller>) {
    return request<ApiReseller>("/resellers", { method: "POST", body: payload as Record<string, unknown> });
  },
  updateReseller(id: string, payload: Partial<ApiReseller>) {
    return request<ApiReseller>(`/resellers/${encodeURIComponent(id)}`, { method: "PUT", body: payload as Record<string, unknown> });
  },
  deleteReseller(id: string) {
    return request<{ ok: boolean }>(`/resellers/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  requestResellerDeposit(payload: { amount: number; method: string; note?: string }) {
    return request<{ ok: boolean; requestId: string; orderId?: string; paymentRef?: string; payment?: ApiPayment; ttlMinutes?: number; deliveryStatus?: string; message: string }>("/resellers/deposit-request", {
      method: "POST",
      body: payload as Record<string, unknown>,
    });
  },
  resellerDepositInstructions() {
    return request<ResellerDepositInstructions>("/resellers/deposit-instructions");
  },
  depositRequests() {
    return request<ApiDepositRequest[]>("/resellers/deposit-requests");
  },
  archiveDepositRequests(ids: string[]) {
    return request<{ ok: boolean; archived: number; ids: string[] }>("/resellers/deposit-requests/archive", {
      method: "POST",
      body: { ids },
    });
  },
  approveDepositRequest(id: string, payload?: { note?: string }) {
    return request<{ ok: boolean; request: ApiDepositRequest; reseller: ApiReseller }>(`/resellers/deposit-requests/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      body: (payload || {}) as Record<string, unknown>,
    });
  },
  rejectDepositRequest(id: string, payload?: { note?: string }) {
    return request<{ ok: boolean; request: ApiDepositRequest }>(`/resellers/deposit-requests/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      body: (payload || {}) as Record<string, unknown>,
    });
  },
  accounts(options?: { view?: "overview" | "full" | "light" }) {
    const view = options?.view && options.view !== "full" ? `?view=${encodeURIComponent(options.view)}` : "";
    return request<ApiAccount[]>(`/accounts${view}`);
  },
  /**
   * One account's credentials, fetched because this one account was opened.
   *
   * The listing deliberately withholds every secret, so this is the only route
   * that returns one -- and it is owner-only and audited server-side.
   */
  accountCredentials(id: string) {
    return request<AccountCredentials>(`/accounts/${encodeURIComponent(id)}/credentials`);
  },
  warrantyClaims() {
    return request<WarrantyClaim[]>("/warranty-claims");
  },
  warrantyManualClaimOptions() {
    return request<WarrantyManualClaimOption[]>("/warranty-claims/manual-options");
  },
  createWarrantyClaim(payload: {
    accountId: string;
    issue: string;
    evidence?: { name: string; mimeType: string; dataUrl: string };
  }) {
    return request<WarrantyClaim>("/warranty-claims", { method: "POST", body: payload });
  },
  updateWarrantyClaim(id: string, payload: { status?: WarrantyClaimStatus; ownerNote?: string }) {
    return request<WarrantyClaim>(`/warranty-claims/${encodeURIComponent(id)}`, { method: "PATCH", body: payload });
  },
  retryWarrantyStockReviewSync(id: string) {
    return request<WarrantyClaim>(`/warranty-claims/${encodeURIComponent(id)}/retry-stock-review-sync`, { method: "POST" });
  },
  warrantyReplacementCandidates(id: string) {
    return request<WarrantyReplacementCandidate[]>(`/warranty-claims/${encodeURIComponent(id)}/replacement-candidates`);
  },
  replaceWarrantyAccount(id: string, payload: { stockId: string; reason?: string }) {
    return request<{
      ok: boolean;
      idempotent: boolean;
      claim: WarrantyClaim;
      notifications: { recipient: { status: "sent" | "failed"; reason: string }; owner: { status: "sent" | "failed"; reason: string } };
      account: { id: string; stockId: string; orderId: string; product: string; variant: string; expiresAt: string; status: string };
    }>(`/warranty-claims/${encodeURIComponent(id)}/replace`, { method: "POST", body: payload });
  },
  replaceWarrantyAccountManual(id: string, payload: WarrantyManualReplacementPayload) {
    return request<{
      ok: boolean;
      idempotent: boolean;
      claim: WarrantyClaim;
      notifications: { recipient: { status: "sent" | "failed"; reason: string }; owner: { status: "sent" | "failed"; reason: string } };
      account: { id: string; stockId: string; orderId: string; product: string; variant: string; expiresAt: string; status: string };
    }>(`/warranty-claims/${encodeURIComponent(id)}/replace-manual`, { method: "POST", body: payload });
  },
  retryWarrantyNotification(id: string) {
    return request<{
      claim: WarrantyClaim;
      notifications: { recipient: { status: "sent" | "failed"; reason: string }; owner: { status: "sent" | "failed"; reason: string } };
    }>(`/warranty-claims/${encodeURIComponent(id)}/retry-notification`, { method: "POST" });
  },
  warrantyEvidenceUrl(claimId: string, evidenceId: string) {
    return apiUrl(`/warranty-claims/${encodeURIComponent(claimId)}/evidence/${encodeURIComponent(evidenceId)}`);
  },
  unreadDeliveryCount() {
    return request<{ count: number }>("/accounts/unread-delivery-count");
  },
  accountDelivery(id: string) {
    return request<AccountDeliveryDetail>(`/accounts/${encodeURIComponent(id)}/delivery`);
  },
  markAccountDeliveryOpened(id: string) {
    return request<{ ok: boolean }>(`/accounts/${encodeURIComponent(id)}/delivery/opened`, { method: "POST" });
  },
  recordDeliveryTemplateCopied(id: string) {
    return request<{ ok: boolean }>(`/accounts/${encodeURIComponent(id)}/delivery/copied`, { method: "POST" });
  },
  createAccount(payload: Partial<ApiAccount>) {
    return request<ApiAccount>("/accounts", { method: "POST", body: payload as Record<string, unknown> });
  },
  lookupAccountAccess(payload: { email?: string; target?: string; type: AccountAccessLookupType; silent?: boolean }) {
    return request<AccountAccessLookupResult>("/account-access/lookup", { method: "POST", body: payload });
  },
  ownerAccountAccessAccounts(provider: "netflix" | "disney") {
    return request<OwnerAccountAccessAccount[]>(`/owner/account-access/accounts?provider=${encodeURIComponent(provider)}`);
  },
  ownerAccountAccessLookup(payload: { email?: string; target?: string; type: AccountAccessLookupType }) {
    return request<AccountAccessLookupResult>("/owner/account-access/lookup", { method: "POST", body: payload });
  },
  updateAccount(id: string, payload: Partial<ApiAccount>) {
    return request<ApiAccount>(`/accounts/${encodeURIComponent(id)}`, { method: "PUT", body: payload as Record<string, unknown> });
  },
  accountAudit(id: string) {
    return request<AccountAuditResult>(`/accounts/${encodeURIComponent(id)}/audit`);
  },
  reassignAccount(id: string, payload: { resellerId: string; buyer?: string; whatsapp?: string; reseller?: string }) {
    return request<ApiAccount>(`/accounts/${encodeURIComponent(id)}`, { method: "PUT", body: payload });
  },
  deleteAccount(id: string, payload?: { password?: string }) {
    return request<{ ok: boolean; returned?: number; archived?: boolean; accounts?: ApiAccount[]; stocks?: ApiStockItem[]; sheets?: { ok?: boolean; skipped?: boolean; error?: string }; credentialSync?: Record<string, unknown> }>(
      `/accounts/${encodeURIComponent(id)}`,
      { method: "DELETE", body: payload },
    );
  },
  activities() {
    return request<ApiActivity[]>("/activities");
  },
  operationsCenter() {
    return request<OperationsCenterResult>("/operations/center");
  },
  ownerSearch(query: string) {
    return request<OwnerSearchResult>(`/owner-search?q=${encodeURIComponent(query)}`);
  },
  previewOperationsRepair(payload: { accountId?: string; orderId?: string; resellerId?: string; syncSheets?: boolean } = {}) {
    return request<OperationsRepairPreview>("/operations/actions/preview", {
      method: "POST",
      body: { action: "reseller_repair", ...payload },
    });
  },
  applyOperationsRepair(
    previewToken: string,
    payload: { accountId?: string; orderId?: string; resellerId?: string; syncSheets?: boolean } = {},
  ) {
    return request<ResellerRepairResult>("/operations/actions/apply", {
      method: "POST",
      body: {
        action: "reseller_repair",
        ...payload,
        previewToken,
        confirmed: true,
      },
    });
  },
  repairResellerData(payload: { accountId?: string; orderId?: string; resellerId?: string; syncSheets?: boolean } = {}) {
    return request<OperationsRepairPreview>("/operations/actions/preview", {
      method: "POST",
      body: { action: "reseller_repair", ...payload },
    }).then((preview) => request<ResellerRepairResult>("/operations/actions/apply", {
      method: "POST",
      body: {
        action: "reseller_repair",
        ...payload,
        previewToken: preview.previewToken,
        confirmed: true,
      },
    }));
  },
  systemStatus() {
    return request<SystemStatus>("/system/status");
  },
  restartSystem() {
    return request<{ ok: boolean; message: string }>("/system/restart", { method: "POST" });
  },
  whatsappStatus() {
    return request<WhatsappStatus>("/whatsapp/status");
  },
  whatsappSyncGroups() {
    return request<WhatsappGroupSyncResult>("/whatsapp/groups/sync-now", { method: "POST" });
  },
  whatsappRentals() {
    return request<WhatsappRental[]>("/whatsapp/rentals");
  },
  whatsappGroupLists() {
    return request<Array<Record<string, unknown>>>("/whatsapp/group-lists");
  },
  whatsappListHistory(id: string) {
    return request<WhatsappListHistory>(`/whatsapp/rentals/${encodeURIComponent(id)}/list-history`);
  },
  syncWhatsappGroups(payload: Record<string, unknown>) {
    return request<{ success: boolean; result?: unknown }>("/whatsapp/groups/sync", { method: "POST", body: payload });
  },
  previewWhatsappGroupPriceSync(group: Pick<WhatsappRental, "id" | "groupJid" | "name" | "linkGrub">) {
    const params = new URLSearchParams();
    if (group.groupJid) params.set("groupJid", group.groupJid);
    if (group.name) params.set("groupName", group.name);
    if (group.linkGrub) params.set("linkGrub", group.linkGrub);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<{ ok: boolean; source: Record<string, unknown>; changes: Array<Record<string, unknown>>; cleanup?: Array<Record<string, unknown>>; skipped: Array<Record<string, unknown>>; parsedRows: number }>(`/whatsapp/rentals/${encodeURIComponent(group.id)}/price-sync/preview${suffix}`);
  },
  applyWhatsappGroupPriceSync(group: Pick<WhatsappRental, "id" | "groupJid" | "name" | "linkGrub">) {
    return request<{ ok: boolean; updated: number; source: Record<string, unknown>; changes: Array<Record<string, unknown>>; cleanup?: Array<Record<string, unknown>> }>(`/whatsapp/rentals/${encodeURIComponent(group.id)}/price-sync/apply`, {
      method: "POST",
      body: { groupJid: group.groupJid || "", groupName: group.name || "", linkGrub: group.linkGrub || "" },
    });
  },
  createWhatsappRental(payload: Partial<WhatsappRental> & { linkGrub?: string; daysLeft?: number }) {
    return request<WhatsappRental>("/whatsapp/rentals", { method: "POST", body: payload as Record<string, unknown> });
  },
  updateWhatsappRental(id: string, payload: Partial<WhatsappRental>) {
    return request<WhatsappRental>(`/whatsapp/rentals/${encodeURIComponent(id)}`, { method: "PUT", body: payload as Record<string, unknown> });
  },
  adjustWhatsappRental(id: string, payload: number | { direction: "add" | "subtract"; unit: "month" | "day"; amount: number }) {
    const body = typeof payload === "number" ? { days: payload } : {
      adjustmentDirection: payload.direction,
      adjustmentUnit: payload.unit,
      adjustmentAmount: payload.amount,
    };
    return request<WhatsappRental>(`/whatsapp/rentals/${encodeURIComponent(id)}/adjust`, { method: "POST", body });
  },
};
