/**
 * The shape of every record the dashboard reads from the API.
 *
 * These used to live in `mocks/data.ts`, which made the entire data
 * contract of the app look like disposable fixture data sitting in a
 * `mocks/` directory. Nothing in that file was a mock except its seed
 * values, and the seed values were all dead.
 */

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
  checkoutFields?: CheckoutField[];
  sheetCheckoutFields?: CheckoutField[];
  deliveryTemplate?: string;
  deliveryTemplateVersion?: number;
  requiredDeliveryFields?: Array<string | string[]>;
  deliveryTemplateUpdatedAt?: string;
  deliveryTemplateUpdatedBy?: string;
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

export type CheckoutField = {
  key: "customerDevice" | "customerEmail" | "customerWhatsapp" | "customerPlan";
  label: string;
  type: "text" | "email" | "tel" | "select";
  required: boolean;
  minItems?: number;
  placeholder?: string;
  helperText?: string;
  options?: string[];
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
  checkoutFields?: CheckoutField[];
  sheetCheckoutFields?: CheckoutField[];
  messageTemplates?: MessageTemplates;
  deliveryTemplate?: string;
  deliveryTemplateVersion?: number;
  requiredDeliveryFields?: Array<string | string[]>;
  deliveryTemplateUpdatedAt?: string;
  deliveryTemplateUpdatedBy?: string;
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
  status: "available" | "reserved" | "sold" | "blocked";
  accountCondition?: "NORMAL" | "BERMASALAH" | "DIPERIKSA" | "REPLACED" | "DISABLED" | "UNKNOWN" | string;
  accountConditionRaw?: string;
  accountConditionKnown?: boolean;
  accountConditionBlocked?: boolean;
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
  /**
   * `manual` is set by `payment-reconciliation-service` when the owner approves
   * a payment by hand, and by the Sheets importer for rows a human entered.
   * It is a real paid state, not a variant of `paid` -- it is how the audit
   * trail records that a human, not the gateway, confirmed the money. Omitting
   * it here made the compiler flag correct branches as unreachable, so the
   * type was lying about a value the server writes on live orders.
   */
  qrisStatus: "paid" | "manual" | "pending" | "expired";
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
  deliveryTemplateSnapshot?: DeliveryTemplateSnapshot | null;
  deliveryTemplateSnapshots?: DeliveryTemplateSnapshot[];
};

export type DeliveryTemplateSnapshot = {
  status: "ready" | "incomplete" | "invalid" | "not_configured" | string;
  scope?: "variant" | "product" | "none" | string;
  accountId?: string;
  stockId?: string;
  variantId?: string;
  sku?: string;
  templateSource?: string;
  renderedText?: string;
  templateVersion?: number;
  renderedAt?: string;
  usedFields?: string[];
  missingFields?: string[];
  errors?: string[];
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
  accountCondition?: "NORMAL" | "BERMASALAH" | "DIPERIKSA" | "REPLACED" | "DISABLED" | "UNKNOWN" | string;
  accountConditionRaw?: string;
  accountConditionKnown?: boolean;
  signInCode?: string;
  verificationCode?: string;
  resetLink?: string;
  householdLink?: string;
  startedAt: string;
  expiresAt: string;
  status: "active" | "expiring" | "expired" | "replaced" | "disabled";
  hidden?: boolean;
  /**
   * Both directions of a warranty replacement, because a replacement is two
   * rows and each one only knows half of it.
   *
   * The account that was replaced gets `replacedAt` / `replacedByAccountId` /
   * `replacementReason` (warranty-service.js:632-641). The account that
   * replaced it gets `replacementOfAccountId` / `replacementCreatedAt`
   * (lines 562-570) -- and note its own `replacementReason` is deliberately
   * blank there, because the reason belongs to the failure, not the fix.
   *
   * A reseller looking at either row needs the other one, or "Diganti" is a
   * label with no referent.
   */
  replacedAt?: string;
  replacedByAccountId?: string;
  replacedByStockId?: string;
  replacementReason?: string;
  replacementDisposition?: string;
  replacementOfAccountId?: string;
  replacementOfStockId?: string;
  replacementId?: string;
  replacementCreatedAt?: string;
  deliveryTemplateSnapshot?: DeliveryTemplateSnapshot | null;
  deliveryTemplateUnreadAt?: string;
  deliveryTemplateOpenedAt?: string;
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

