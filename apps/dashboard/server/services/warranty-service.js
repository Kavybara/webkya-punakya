const OPEN_CLAIM_STATUSES = new Set(["submitted", "reviewing", "waiting_evidence"]);
const TERMINAL_ACCOUNT_STATUSES = new Set(["expired", "replaced", "disabled"]);
const BLOCKED_STOCK_CONDITIONS = new Set(["BERMASALAH", "DIPERIKSA", "REPLACED", "DISABLED", "UNKNOWN"]);
const EDITABLE_CLAIM_STATUSES = new Set(["submitted", "reviewing", "resolved", "rejected"]);
const TERMINAL_CLAIM_STATUSES = new Set(["resolved", "rejected"]);
const WARRANTY_REVIEW_EXCLUDED_STATUSES = new Set(["rejected"]);
const WARRANTY_REVIEW_PROFILE_THRESHOLD = 2;
const WARRANTY_REVIEW_MAX_HOLD_MINUTES = 3 * 24 * 60;

function text(value = "") {
  return String(value ?? "").trim();
}

function fail(message, status = 400, code = "warranty_error") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

function accountOrderId(account = {}) {
  return text(account.orderId || account.sourceOrderId);
}

function accountIdentity(account = {}) {
  return text(account.loginPhone || account.email || account.username || account.id);
}

function maskIdentity(value = "") {
  const source = text(value);
  if (!source) return "-";
  if (source.includes("@")) {
    const [local, domain] = source.split("@");
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
  }
  const digits = source.replace(/\D/g, "");
  if (digits.length >= 7) return `${digits.slice(0, 4)}${"*".repeat(Math.max(3, digits.length - 7))}${digits.slice(-3)}`;
  if (source.length <= 3) return "***";
  return `${source.slice(0, 2)}${"*".repeat(Math.max(3, source.length - 2))}`;
}

function joinWarrantyMessage(lines = []) {
  return lines
    .map((line) => String(line ?? "").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatElapsedDays(minutes = 0) {
  const value = Number(minutes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 hari";
  const days = Math.max(1, Math.ceil(value / (24 * 60)));
  return `${days} hari`;
}

function normalizedPoolKey(record = {}) {
  return text(record.stockPoolKey || record.sheetPool).toUpperCase();
}

function normalizedIdentity(record = {}) {
  return accountIdentity(record).toLocaleLowerCase("en-US");
}

function warrantyPhysicalAccount(db = {}, account = {}) {
  const stock = (db.stock || []).find((item) => text(item.id) === text(account.stockId)) || null;
  return {
    account,
    stock,
    identity: normalizedIdentity(account) || normalizedIdentity(stock || {}),
    productId: text(account.productId || stock?.productId),
    poolKey: normalizedPoolKey(account) || normalizedPoolKey(stock || {}),
  };
}

function sameWarrantyPhysicalAccount(candidate = {}, target = {}) {
  if (!candidate.identity || !target.identity || candidate.identity !== target.identity) return false;
  if (candidate.productId && target.productId && candidate.productId !== target.productId) return false;
  if (candidate.poolKey || target.poolKey) return Boolean(candidate.poolKey && target.poolKey && candidate.poolKey === target.poolKey);
  return true;
}

export function evaluateWarrantyStockReview(db = {}, options = {}) {
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const makeId = typeof options.makeId === "function"
    ? options.makeId
    : (prefix) => `${prefix}-${Date.now().toString(36)}`;
  const account = (db.managedAccounts || []).find((item) => text(item.id) === text(options.accountId));
  if (!account) return { triggered: false, profileCount: 0, profiles: [], stockIds: [] };
  const target = warrantyPhysicalAccount(db, account);
  if (!target.identity) return { triggered: false, profileCount: 0, profiles: [], stockIds: [] };

  const profiles = new Map();
  const claimIds = [];
  for (const claim of db.warrantyClaims || []) {
    if (WARRANTY_REVIEW_EXCLUDED_STATUSES.has(text(claim.status).toLowerCase())) continue;
    const claimedAccount = claimAccount(db, claim);
    if (!claimedAccount) continue;
    const physical = warrantyPhysicalAccount(db, claimedAccount);
    if (!sameWarrantyPhysicalAccount(physical, target)) continue;
    const profile = text(claim.profile || claimedAccount.profile || physical.stock?.profile);
    if (!profile) continue;
    const key = profile.toLocaleLowerCase("en-US");
    if (!profiles.has(key)) profiles.set(key, profile);
    claimIds.push(text(claim.id));
  }

  const profileNames = [...profiles.values()].sort((left, right) => left.localeCompare(right, "id"));
  const result = {
    triggered: profileNames.length >= WARRANTY_REVIEW_PROFILE_THRESHOLD,
    profileCount: profileNames.length,
    profiles: profileNames,
    stockIds: [],
  };
  if (!result.triggered) return result;

  const affectedStocks = (db.stock || []).filter((stock) => sameWarrantyPhysicalAccount({
    account: null,
    stock,
    identity: normalizedIdentity(stock),
    productId: text(stock.productId),
    poolKey: normalizedPoolKey(stock),
  }, target));
  const alreadyTriggered = affectedStocks.some((stock) => stock.warrantyReviewTriggeredAt);
  const reviewedAt = now();
  const reviewId = affectedStocks.find((stock) => stock.warrantyReviewId)?.warrantyReviewId
    || makeId("WRV").toUpperCase();

  for (const stock of affectedStocks) {
    stock.accountCondition = "DIPERIKSA";
    stock.accountConditionRaw = "DIPERIKSA";
    stock.accountConditionKnown = true;
    stock.accountConditionBlocked = true;
    stock.warrantyReviewBlocked = true;
    stock.warrantyReviewId = reviewId;
    stock.warrantyReviewTriggeredAt = stock.warrantyReviewTriggeredAt || reviewedAt;
    stock.warrantyReviewProfiles = profileNames;
    stock.warrantyReviewClaimIds = [...new Set(claimIds.filter(Boolean))];
    if (text(stock.status).toLowerCase() === "available") stock.status = "blocked";
    result.stockIds.push(text(stock.id));
  }

  for (const managed of db.managedAccounts || []) {
    if (!sameWarrantyPhysicalAccount(warrantyPhysicalAccount(db, managed), target)) continue;
    managed.accountCondition = "DIPERIKSA";
    managed.accountConditionRaw = "DIPERIKSA";
    managed.accountConditionKnown = true;
    managed.warrantyReviewId = reviewId;
    managed.warrantyReviewTriggeredAt = managed.warrantyReviewTriggeredAt || reviewedAt;
  }

  if (!alreadyTriggered) {
    db.activities = db.activities || [];
    db.activities.unshift({
      id: makeId("act"),
      type: "warranty",
      title: "Stok otomatis perlu diperiksa",
      description: `${profileNames.length} profil pada satu akun login memiliki klaim garansi. Stok dikunci sampai diperiksa Owner.`,
      reviewId,
      claimIds: [...new Set(claimIds.filter(Boolean))],
      stockIds: result.stockIds,
      profileCount: profileNames.length,
      createdAt: reviewedAt,
    });
  }
  return { ...result, reviewId };
}

function stockIsBlocked(stock = {}) {
  const condition = text(stock.accountCondition || "NORMAL").toUpperCase();
  return stock.accountConditionKnown === false
    || stock.accountConditionBlocked === true
    || BLOCKED_STOCK_CONDITIONS.has(condition);
}

function stockHasLiveAssignment(db = {}, stock = {}) {
  const stockId = text(stock.id);
  const sheetStockKey = text(stock.sheetStockKey);
  return (db.managedAccounts || []).some((account) => {
    if (account.hidden || account.returnedToStockAt) return false;
    if (TERMINAL_ACCOUNT_STATUSES.has(text(account.status).toLowerCase())) return false;
    return (stockId && text(account.stockId) === stockId)
      || (sheetStockKey && text(account.sheetStockKey) === sheetStockKey);
  });
}

function statusFromExpiry(expiresAt = "", now = () => new Date().toISOString()) {
  const expiry = new Date(text(expiresAt).replace(" ", "T"));
  if (Number.isNaN(expiry.getTime())) return "active";
  const current = new Date(text(now()).replace(" ", "T"));
  if (Number.isNaN(current.getTime())) return "active";
  const remaining = expiry.getTime() - current.getTime();
  if (remaining <= 0) return "expired";
  if (remaining <= 5 * 86400000) return "expiring";
  return "active";
}

function parseDate(value = "") {
  const parsed = new Date(text(value).replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTime(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function addMinutesToDateText(value = "", minutes = 0) {
  const parsed = parseDate(value);
  if (!parsed) return text(value);
  return formatDateTime(new Date(parsed.getTime() + Math.max(0, Number(minutes || 0)) * 60000));
}

function warrantyReviewTiming(claim = {}, endedAt = "") {
  const startedAt = parseDate(claim.holdStartedAt || claim.createdAt || "");
  const finishedAt = parseDate(endedAt);
  if (!startedAt || !finishedAt) {
    return {
      elapsedMinutes: 0,
      appliedMinutes: 0,
      overdue: false,
    };
  }
  const elapsedMinutes = Math.max(0, Math.ceil((finishedAt.getTime() - startedAt.getTime()) / 60000));
  return {
    elapsedMinutes,
    appliedMinutes: Math.min(elapsedMinutes, WARRANTY_REVIEW_MAX_HOLD_MINUTES),
    overdue: elapsedMinutes > WARRANTY_REVIEW_MAX_HOLD_MINUTES,
  };
}

export function warrantyPolicyForAccount(account = {}, now = () => new Date().toISOString()) {
  const durationDays = Math.max(1, Number(account.durationDays || 1));
  const configuredDays = Number(account.warrantyDays || 0);
  const warrantyDays = configuredDays > 0
    ? Math.min(durationDays, Math.floor(configuredDays))
    : Math.min(durationDays, 25);
  let startedAt = parseDate(account.startedAt || account.purchasedAt || account.purchaseDate || "");
  if (!startedAt) {
    const expiry = parseDate(account.expiresAt);
    if (expiry) startedAt = new Date(expiry.getTime() - durationDays * 86400000);
  }
  if (!startedAt) startedAt = parseDate(account.createdAt);
  if (!startedAt) {
    return {
      warrantyDays,
      warrantyStartedAt: "",
      warrantyEndsAt: "",
      eligible: false,
      remainingDays: 0,
    };
  }
  const endsAt = new Date(startedAt.getTime() + warrantyDays * 86400000);
  const current = parseDate(now()) || new Date();
  const remainingMs = endsAt.getTime() - current.getTime();
  return {
    warrantyDays,
    warrantyStartedAt: formatDateTime(startedAt),
    warrantyEndsAt: formatDateTime(endsAt),
    eligible: remainingMs >= 0,
    remainingDays: Math.max(0, Math.ceil(remainingMs / 86400000)),
  };
}

function claimAccount(db = {}, claim = {}) {
  return (db.managedAccounts || []).find((account) => text(account.id) === text(claim.accountId)) || null;
}

function claimOrder(db = {}, claim = {}, account = null) {
  const orderId = text(claim.orderId || accountOrderId(account || {}));
  return [...(db.orders || []), ...(db.manualOrders || [])].find((order) => text(order.id) === orderId) || null;
}

function claimReseller(db = {}, claim = {}, account = null) {
  const resellerId = text(claim.resellerId || account?.resellerId);
  return (db.resellers || []).find((reseller) => text(reseller.id) === resellerId) || null;
}

function safeClaim(claim = {}, now = () => new Date().toISOString()) {
  const open = OPEN_CLAIM_STATUSES.has(text(claim.status).toLowerCase());
  const liveTiming = open ? warrantyReviewTiming(claim, now()) : null;
  return {
    ...claim,
    status: text(claim.status).toLowerCase() === "waiting_evidence" ? "reviewing" : claim.status,
    accountIdentity: claim.accountIdentity || "",
    reviewElapsedMinutes: liveTiming?.elapsedMinutes ?? Number(claim.reviewElapsedMinutes || 0),
    reviewOverdue: liveTiming?.overdue ?? Boolean(claim.reviewOverdue),
  };
}

export function warrantyClaimsForAuth(db = {}, auth = {}, now = () => new Date().toISOString()) {
  const claims = (db.warrantyClaims || []).map((claim) => safeClaim(claim, now));
  if (auth.role === "owner") return claims;
  if (auth.role !== "reseller") return [];
  return claims.filter((claim) => text(claim.resellerId) === text(auth.sub));
}

export function warrantyManualClaimOptions(db = {}, now = () => new Date().toISOString()) {
  const openAccountIds = new Set((db.warrantyClaims || [])
    .filter((claim) => OPEN_CLAIM_STATUSES.has(text(claim.status).toLowerCase()))
    .map((claim) => text(claim.accountId))
    .filter(Boolean));

  return (db.managedAccounts || []).flatMap((account) => {
    if (!text(account.resellerId) || openAccountIds.has(text(account.id))) return [];
    if (TERMINAL_ACCOUNT_STATUSES.has(text(account.status).toLowerCase())) return [];
    const warranty = warrantyPolicyForAccount(account, now);
    if (!warranty.eligible) return [];
    const reseller = (db.resellers || []).find((item) => text(item.id) === text(account.resellerId)) || null;
    return [{
      accountId: text(account.id),
      orderId: accountOrderId(account),
      resellerId: text(account.resellerId),
      resellerName: text(reseller?.username || reseller?.name || account.reseller || account.buyer),
      product: text(account.product),
      variant: text(account.variant),
      accountIdentity: maskIdentity(accountIdentity(account)),
      profile: text(account.profile),
      status: text(account.status || "active"),
      warrantyDays: warranty.warrantyDays,
      warrantyEndsAt: warranty.warrantyEndsAt,
      remainingDays: warranty.remainingDays,
    }];
  });
}

export function createWarrantyClaim(db = {}, options = {}) {
  const {
    auth = {},
    accountId = "",
    issue = "",
    evidence = [],
    submissionSource = "reseller_dashboard",
    now = () => new Date().toISOString(),
    makeId,
  } = options;
  const account = (db.managedAccounts || []).find((candidate) => text(candidate.id) === text(accountId));
  if (!account || (auth.role === "reseller" && text(account.resellerId) !== text(auth.sub))) {
    fail("Akun garansi tidak ditemukan", 404, "account_not_found");
  }
  if (!text(issue)) fail("Kendala wajib diisi", 400, "issue_required");
  if (TERMINAL_ACCOUNT_STATUSES.has(text(account.status).toLowerCase())) {
    fail("Akun ini tidak dapat diklaim", 409, "account_not_claimable");
  }
  const warranty = warrantyPolicyForAccount(account, now);
  if (!warranty.eligible) {
    fail("Masa garansi akun ini sudah berakhir", 409, "warranty_period_ended");
  }

  db.warrantyClaims = db.warrantyClaims || [];
  const duplicate = db.warrantyClaims.find((claim) => (
    text(claim.accountId) === text(account.id)
    && OPEN_CLAIM_STATUSES.has(text(claim.status).toLowerCase())
  ));
  if (duplicate) fail("Klaim untuk akun ini masih aktif", 409, "claim_already_open");

  const createdAt = now();
  const reviewDueAt = addMinutesToDateText(createdAt, WARRANTY_REVIEW_MAX_HOLD_MINUTES);
  const orderId = accountOrderId(account);
  const reseller = (db.resellers || []).find((item) => text(item.id) === text(account.resellerId)) || null;
  const claim = {
    id: makeId("CLM").toUpperCase(),
    resellerId: text(account.resellerId),
    resellerName: text(reseller?.username || reseller?.name),
    accountId: text(account.id),
    orderId,
    stockId: text(account.stockId),
    productId: text(account.productId),
    variantId: text(account.variantId),
    product: text(account.product),
    variant: text(account.variant),
    accountIdentity: maskIdentity(accountIdentity(account)),
    profile: text(account.profile),
    issue: text(issue).slice(0, 1000),
    status: "submitted",
    createdAt,
    updatedAt: createdAt,
    ownerNote: "",
    ownerNotificationStatus: "pending",
    evidence: Array.isArray(evidence) ? evidence : [],
    submissionSource: text(submissionSource || "reseller_dashboard"),
    createdByRole: text(auth.role || "reseller"),
    createdBy: text(auth.sub || account.resellerId),
    warrantyDays: warranty.warrantyDays,
    warrantyStartedAt: warranty.warrantyStartedAt,
    warrantyEndsAt: warranty.warrantyEndsAt,
    holdStartedAt: createdAt,
    holdEndedAt: "",
    holdAppliedMinutes: 0,
    reviewElapsedMinutes: 0,
    reviewDueAt,
    reviewOverdue: false,
  };
  db.warrantyClaims.unshift(claim);
  db.activities = db.activities || [];
  db.activities.unshift({
    id: makeId("act"),
    type: "warranty",
    title: auth.role === "owner" ? "Klaim garansi manual dibuat" : "Klaim garansi dibuat",
    description: auth.role === "owner"
      ? `Owner mencatat klaim ${claim.id} dari WhatsApp untuk order ${orderId || "-"}.`
      : `Klaim ${claim.id} untuk order ${orderId || "-"} menunggu pemeriksaan Owner.`,
    claimId: claim.id,
    accountId: account.id,
    orderId,
    resellerId: account.resellerId || "",
    createdAt,
  });
  const stockReview = evaluateWarrantyStockReview(db, {
    accountId: account.id,
    now,
    makeId,
  });
  claim.stockReviewTriggered = stockReview.triggered;
  claim.stockReviewProfileCount = stockReview.profileCount;
  claim.stockReviewProfiles = stockReview.profiles;
  claim.stockReviewStockIds = stockReview.stockIds;
  if (stockReview.triggered) {
    claim.stockReviewId = stockReview.reviewId;
    claim.stockReviewSyncStatus = stockReview.stockIds.some((stockId) => {
      const stock = (db.stock || []).find((item) => text(item.id) === text(stockId));
      return Boolean(stock?.sheetRow && (stock.sheetSource === "google_sheets" || stock.sheetStockKey || stock.sheetName));
    }) ? "pending" : "not_required";
  }
  return claim;
}

export function updateWarrantyClaim(db = {}, options = {}) {
  const {
    claimId = "",
    status = "",
    ownerNote = "",
    actorId = "owner",
    now = () => new Date().toISOString(),
    makeId,
  } = options;
  const claim = (db.warrantyClaims || []).find((item) => text(item.id) === text(claimId));
  if (!claim) fail("Klaim garansi tidak ditemukan", 404, "claim_not_found");
  if (text(claim.status).toLowerCase() === "replaced") {
    fail("Klaim yang sudah diganti tidak dapat dibuka kembali", 409, "claim_already_replaced");
  }
  const nextStatus = text(status || claim.status).toLowerCase() === "waiting_evidence"
    ? "reviewing"
    : text(status || claim.status).toLowerCase();
  if (!EDITABLE_CLAIM_STATUSES.has(nextStatus)) {
    fail("Status klaim tidak valid", 400, "invalid_claim_status");
  }
  const note = text(ownerNote).slice(0, 1000);
  if (TERMINAL_CLAIM_STATUSES.has(nextStatus) && !note) {
    fail("Catatan Owner wajib diisi untuk klaim selesai atau ditolak", 400, "owner_note_required");
  }
  claim.status = nextStatus;
  claim.ownerNote = note;
  claim.updatedAt = now();
  if (TERMINAL_CLAIM_STATUSES.has(nextStatus)) {
    const timing = warrantyReviewTiming(claim, claim.updatedAt);
    claim.resolvedAt = claim.resolvedAt || claim.updatedAt;
    claim.resolvedBy = text(actorId);
    claim.holdEndedAt = claim.holdEndedAt || claim.updatedAt;
    claim.reviewElapsedMinutes = timing.elapsedMinutes;
    claim.reviewOverdue = timing.overdue;
    claim.holdAppliedMinutes = 0;
  }
  db.activities = db.activities || [];
  db.activities.unshift({
    id: makeId("act"),
    type: "warranty",
    title: "Status klaim garansi diperbarui",
    description: `Klaim ${claim.id} menjadi ${claim.status}.`,
    claimId: claim.id,
    accountId: claim.accountId || "",
    orderId: claim.orderId || "",
    actorId: text(actorId),
    createdAt: claim.updatedAt,
  });
  return claim;
}

export function markWarrantyReplacementSync(db = {}, options = {}) {
  const claim = (db.warrantyClaims || []).find((item) => text(item.id) === text(options.claimId));
  if (!claim) fail("Klaim garansi tidak ditemukan", 404, "claim_not_found");
  const status = text(options.status).toLowerCase();
  if (!new Set(["pending", "failed", "synced"]).has(status)) {
    fail("Status sinkronisasi replacement tidak valid", 400, "invalid_replacement_sync_status");
  }
  claim.replacementSyncStatus = status;
  claim.replacementSyncError = status === "failed" ? text(options.error).slice(0, 200) : "";
  claim.replacementSyncUpdatedAt = options.now();
  if (status === "synced") claim.replacementSyncedAt = claim.replacementSyncUpdatedAt;
  return claim;
}

export function replacementCandidatesForClaim(db = {}, claimId = "") {
  const claim = (db.warrantyClaims || []).find((item) => text(item.id) === text(claimId));
  if (!claim) fail("Klaim garansi tidak ditemukan", 404, "claim_not_found");
  const account = claimAccount(db, claim);
  if (!account) fail("Akun lama tidak ditemukan", 409, "claim_account_missing");
  const expectedPool = normalizedPoolKey(account);
  return (db.stock || [])
    .filter((stock) => text(stock.id) !== text(account.stockId))
    .filter((stock) => text(stock.status).toLowerCase() === "available")
    .filter((stock) => !stockIsBlocked(stock))
    .filter((stock) => text(stock.productId) === text(account.productId))
    .filter((stock) => {
      const candidatePool = normalizedPoolKey(stock);
      if (expectedPool || candidatePool) return Boolean(expectedPool && candidatePool && expectedPool === candidatePool);
      return text(stock.variantId) === text(account.variantId);
    })
    .filter((stock) => !stockHasLiveAssignment(db, stock))
    .map((stock) => ({
      id: stock.id,
      productId: stock.productId || "",
      variantId: stock.variantId || "",
      stockPoolKey: stock.stockPoolKey || "",
      sheetPool: stock.sheetPool || "",
      sheetName: stock.sheetName || "",
      sheetRow: Number(stock.sheetRow || 0),
      identity: maskIdentity(accountIdentity(stock)),
      profile: stock.profile || "",
      status: stock.status || "available",
    }));
}

function newAccountFromStock(oldAccount = {}, stock = {}, options = {}) {
  const replacementAt = options.replacementAt;
  const holdAppliedMinutes = Math.max(0, Number(options.holdAppliedMinutes || 0));
  const adjustedStartedAt = addMinutesToDateText(
    oldAccount.warrantyAdjustedStartedAt || oldAccount.startedAt || oldAccount.purchasedAt || oldAccount.purchaseDate || "",
    holdAppliedMinutes,
  );
  const adjustedExpiresAt = addMinutesToDateText(oldAccount.expiresAt || "", holdAppliedMinutes);
  return {
    ...oldAccount,
    id: options.makeId("acc"),
    stockId: stock.id,
    sheetStockKey: stock.sheetStockKey || "",
    email: stock.email || "",
    loginPhone: stock.loginPhone || "",
    otpEmail: stock.otpEmail || "",
    password: stock.password || "",
    canvaLink: stock.canvaLink || "",
    profile: stock.profile || "",
    pin: stock.pin || "",
    signInCode: stock.signInCode || "",
    verificationCode: stock.verificationCode || "",
    resetLink: stock.resetLink || "",
    householdLink: stock.householdLink || "",
    sheetSource: stock.sheetSource || oldAccount.sheetSource || "",
    sheetName: stock.sheetName || "",
    sheetRow: Number(stock.sheetRow || 0),
    sheetPool: stock.sheetPool || "",
    sheetPoolSchema: stock.sheetPoolSchema || "",
    sheetStartColumn: Number(stock.sheetStartColumn || 0),
    stockPoolKey: stock.stockPoolKey || oldAccount.stockPoolKey || "",
    expiresAt: adjustedExpiresAt || oldAccount.expiresAt || "",
    warrantyOriginalStartedAt: oldAccount.warrantyOriginalStartedAt || oldAccount.startedAt || oldAccount.purchasedAt || "",
    warrantyAdjustedStartedAt: adjustedStartedAt,
    warrantyOriginalExpiresAt: oldAccount.warrantyOriginalExpiresAt || oldAccount.expiresAt || "",
    warrantyHoldAppliedMinutes: holdAppliedMinutes,
    status: statusFromExpiry(adjustedExpiresAt || oldAccount.expiresAt, options.now),
    replacementId: options.replacementId,
    replacementOfAccountId: oldAccount.id,
    replacementOfStockId: oldAccount.stockId || "",
    replacedAt: "",
    replacedByAccountId: "",
    replacedByStockId: "",
    replacementReason: "",
    replacementDisposition: "",
    replacementCreatedAt: replacementAt,
    updatedAt: replacementAt,
    hidden: false,
    returnedToStockAt: "",
    deliveryTemplateOpenedAt: "",
    deliveryTemplateUnreadAt: replacementAt,
  };
}

function manualWarrantyStockFromAccount(oldAccount = {}, account = {}, options = {}) {
  const replacementAt = options.replacementAt;
  const stockId = text(options.stockId) || options.makeId("stk").toUpperCase();
  return {
    id: stockId,
    productId: oldAccount.productId || "",
    variantId: oldAccount.variantId || "",
    product: oldAccount.product || "",
    variant: oldAccount.variant || "",
    stockPoolKey: oldAccount.stockPoolKey || "",
    sheetPool: oldAccount.sheetPool || "",
    email: text(account.email || account.login || account.username),
    loginPhone: text(account.loginPhone || account.phone),
    otpEmail: text(account.otpEmail),
    password: text(account.password),
    canvaLink: text(account.canvaLink),
    profile: text(account.profile || oldAccount.profile),
    pin: text(account.pin),
    signInCode: text(account.signInCode),
    verificationCode: text(account.verificationCode),
    resetLink: text(account.resetLink),
    householdLink: text(account.householdLink),
    sheetSource: "manual_by_order",
    sheetName: "",
    sheetRow: 0,
    status: "sold",
    manualByOrder: true,
    accountCondition: "NORMAL",
    accountConditionKnown: true,
    accountConditionBlocked: false,
    createdAt: replacementAt,
    updatedAt: replacementAt,
  };
}

function applyWarrantyReplacement(db = {}, context = {}) {
  const {
    claim,
    oldAccount,
    stock,
    oldStock,
    order,
    actorId = "owner",
    reason = "",
    replacementAt = "",
    replacementId = "",
    hold = {},
    newAccount,
    manualByOrder = false,
  } = context;
  const oldStockId = text(oldAccount.stockId);
  const note = text(reason || claim.issue);

  oldAccount.status = "replaced";
  oldAccount.replacedAt = replacementAt;
  oldAccount.replacedByAccountId = newAccount.id;
  oldAccount.replacedByStockId = stock.id;
  oldAccount.replacementReason = note;
  oldAccount.replacementDisposition = manualByOrder ? "warranty_manual_by_order" : "warranty_replacement";
  oldAccount.replacementId = replacementId;
  oldAccount.updatedAt = replacementAt;
  oldAccount.deliveryTemplateUnreadAt = "";
  oldAccount.deliveryTemplateOpenedAt = replacementAt;

  if (oldStock) {
    oldStock.status = "blocked";
    oldStock.accountCondition = "REPLACED";
    oldStock.accountConditionKnown = true;
    oldStock.accountConditionBlocked = true;
    oldStock.replacedAt = replacementAt;
    oldStock.replacedByStockId = stock.id;
    oldStock.replacementId = replacementId;
  }

  stock.status = "sold";
  stock.soldAt = replacementAt;
  stock.soldDuration = oldAccount.duration || order.duration || "";
  stock.soldDurationDays = Number(oldAccount.durationDays || order.durationDays || 0);
  stock.soldExpiresAt = newAccount.expiresAt || oldAccount.expiresAt || order.expiresAt || "";
  stock.sheetOrderId = order.id;
  stock.resellerId = oldAccount.resellerId || order.resellerId || "";
  stock.reseller = oldAccount.reseller || order.reseller || "";
  stock.buyer = oldAccount.buyer || order.customer || "";
  stock.whatsapp = oldAccount.whatsapp || order.whatsapp || "";
  stock.replacementId = replacementId;
  delete stock.reservedFor;
  delete stock.reservedAccountId;
  delete stock.reservedUntil;
  delete stock.reservedAt;

  db.managedAccounts = db.managedAccounts || [];
  db.managedAccounts.unshift(newAccount);
  order.deliveredStockIds = [...new Set([
    ...(order.deliveredStockIds || []).filter((id) => text(id) !== oldStockId),
    stock.id,
  ].filter(Boolean))];
  order.replacementHistory = order.replacementHistory || [];
  order.replacementHistory.push({
    id: replacementId,
    claimId: claim.id,
    oldAccountId: oldAccount.id,
    oldStockId,
    newAccountId: newAccount.id,
    newStockId: stock.id,
    reason: note,
    actorId: text(actorId),
    createdAt: replacementAt,
    holdAppliedMinutes: hold.appliedMinutes,
    reviewElapsedMinutes: hold.elapsedMinutes,
    reviewOverdue: hold.overdue,
    manualByOrder,
  });

  claim.status = "replaced";
  claim.updatedAt = replacementAt;
  claim.resolvedAt = replacementAt;
  claim.resolvedBy = text(actorId);
  claim.ownerNote = note;
  claim.holdEndedAt = replacementAt;
  claim.holdAppliedMinutes = hold.appliedMinutes;
  claim.reviewElapsedMinutes = hold.elapsedMinutes;
  claim.reviewOverdue = hold.overdue;
  claim.replacement = {
    id: replacementId,
    oldAccountId: oldAccount.id,
    oldStockId,
    newAccountId: newAccount.id,
    newStockId: stock.id,
    createdAt: replacementAt,
    originalExpiresAt: oldAccount.expiresAt || "",
    adjustedExpiresAt: newAccount.expiresAt || "",
    holdAppliedMinutes: hold.appliedMinutes,
    manualByOrder,
  };
  claim.replacementNotificationStatus = "pending";
  claim.replacementSyncStatus = manualByOrder ? "not_required" : "pending";
  claim.replacementSyncError = "";
  claim.replacementSyncUpdatedAt = replacementAt;

  db.activities = db.activities || [];
  db.activities.unshift({
    id: context.makeId("act"),
    type: "warranty",
    title: manualByOrder ? "Akun garansi diganti manual" : "Akun garansi diganti",
    description: `Klaim ${claim.id}; order ${order.id}; stok lama ${oldStockId || "-"} diganti dengan ${stock.id}.`,
    claimId: claim.id,
    replacementId,
    accountId: newAccount.id,
    orderId: order.id,
    stockId: stock.id,
    resellerId: claim.resellerId || "",
    actorId: text(actorId),
    createdAt: replacementAt,
  });
}

export function replaceWarrantyAccount(db = {}, options = {}) {
  const {
    claimId = "",
    stockId = "",
    actorId = "owner",
    reason = "",
    now = () => new Date().toISOString(),
    makeId,
  } = options;
  if (!text(reason)) fail("Catatan Owner wajib diisi untuk penggantian akun", 400, "replacement_reason_required");
  const claim = (db.warrantyClaims || []).find((item) => text(item.id) === text(claimId));
  if (!claim) fail("Klaim garansi tidak ditemukan", 404, "claim_not_found");

  if (text(claim.status).toLowerCase() === "replaced") {
    if (text(claim.replacement?.newStockId) !== text(stockId)) {
      fail("Klaim ini sudah diganti dengan stok lain", 409, "claim_already_replaced");
    }
    const oldAccount = (db.managedAccounts || []).find((account) => text(account.id) === text(claim.replacement?.oldAccountId));
    const newAccount = (db.managedAccounts || []).find((account) => text(account.id) === text(claim.replacement?.newAccountId));
    return { claim, oldAccount, newAccount, order: claimOrder(db, claim, oldAccount), idempotent: true };
  }

  const oldAccount = claimAccount(db, claim);
  if (!oldAccount) fail("Akun lama tidak ditemukan", 409, "claim_account_missing");
  if (text(oldAccount.status).toLowerCase() === "replaced") {
    fail("Akun lama sudah pernah diganti", 409, "account_already_replaced");
  }
  const candidate = replacementCandidatesForClaim(db, claim.id).find((item) => text(item.id) === text(stockId));
  if (!candidate) fail("Stok pengganti tidak tersedia atau tidak satu pool", 409, "replacement_stock_unavailable");
  const stock = (db.stock || []).find((item) => text(item.id) === text(stockId));
  const oldStock = (db.stock || []).find((item) => text(item.id) === text(oldAccount.stockId)) || null;
  const order = claimOrder(db, claim, oldAccount);
  if (!order) fail("Order asal akun tidak ditemukan", 409, "claim_order_missing");

  const replacementAt = now();
  const replacementId = makeId("RPL").toUpperCase();
  const hold = warrantyReviewTiming(claim, replacementAt);
  const newAccount = newAccountFromStock(oldAccount, stock, {
    replacementAt,
    replacementId,
    makeId,
    now,
    holdAppliedMinutes: hold.appliedMinutes,
  });

  applyWarrantyReplacement(db, {
    claim,
    oldAccount,
    stock,
    oldStock,
    order,
    actorId,
    reason,
    replacementAt,
    replacementId,
    hold,
    newAccount,
    makeId,
  });

  return { claim, oldAccount, newAccount, order, idempotent: false };
}

export function replaceWarrantyAccountManually(db = {}, options = {}) {
  const {
    claimId = "",
    account = {},
    actorId = "owner",
    reason = "",
    now = () => new Date().toISOString(),
    makeId,
  } = options;
  if (!text(reason)) fail("Catatan Owner wajib diisi untuk penggantian akun", 400, "replacement_reason_required");
  if (!text(account.email || account.login || account.username || account.loginPhone || account.phone)) {
    fail("Login atau email akun pengganti wajib diisi", 400, "manual_replacement_identity_required");
  }
  if (!text(account.password)) fail("Password akun pengganti wajib diisi", 400, "manual_replacement_password_required");

  const claim = (db.warrantyClaims || []).find((item) => text(item.id) === text(claimId));
  if (!claim) fail("Klaim garansi tidak ditemukan", 404, "claim_not_found");
  if (text(claim.status).toLowerCase() === "replaced") {
    if (!claim.replacement?.manualByOrder) fail("Klaim ini sudah diganti dengan stok lain", 409, "claim_already_replaced");
    const oldAccount = (db.managedAccounts || []).find((item) => text(item.id) === text(claim.replacement?.oldAccountId));
    const newAccount = (db.managedAccounts || []).find((item) => text(item.id) === text(claim.replacement?.newAccountId));
    return { claim, oldAccount, newAccount, order: claimOrder(db, claim, oldAccount), idempotent: true };
  }

  const oldAccount = claimAccount(db, claim);
  if (!oldAccount) fail("Akun lama tidak ditemukan", 409, "claim_account_missing");
  if (text(oldAccount.status).toLowerCase() === "replaced") {
    fail("Akun lama sudah pernah diganti", 409, "account_already_replaced");
  }
  const order = claimOrder(db, claim, oldAccount);
  if (!order) fail("Order asal akun tidak ditemukan", 409, "claim_order_missing");

  const replacementAt = now();
  const replacementId = makeId("RPL").toUpperCase();
  const hold = warrantyReviewTiming(claim, replacementAt);
  const stock = manualWarrantyStockFromAccount(oldAccount, account, {
    replacementAt,
    stockId: options.stockId,
    makeId,
  });
  db.stock = db.stock || [];
  db.stock.unshift(stock);
  const oldStock = (db.stock || []).find((item) => text(item.id) === text(oldAccount.stockId)) || null;
  const newAccount = {
    ...newAccountFromStock(oldAccount, stock, {
      replacementAt,
      replacementId,
      makeId,
      now,
      holdAppliedMinutes: hold.appliedMinutes,
    }),
    sheetSource: "manual_by_order",
    sheetName: "",
    sheetRow: 0,
    manualByOrder: true,
    source: "warranty_manual_by_order",
  };
  const explicitExpiresAt = text(account.expiresAt);
  if (explicitExpiresAt) {
    newAccount.expiresAt = explicitExpiresAt;
    newAccount.status = statusFromExpiry(explicitExpiresAt, now);
    stock.soldExpiresAt = explicitExpiresAt;
  }

  applyWarrantyReplacement(db, {
    claim,
    oldAccount,
    stock,
    oldStock,
    order,
    actorId,
    reason,
    replacementAt,
    replacementId,
    hold,
    newAccount,
    manualByOrder: true,
    makeId,
  });

  return { claim, oldAccount, newAccount, order, idempotent: false };
}

export function validateWarrantyReplacementState(db = {}, claimId = "") {
  const claim = (db.warrantyClaims || []).find((item) => text(item.id) === text(claimId));
  if (!claim || text(claim.status).toLowerCase() !== "replaced" || !claim.replacement) {
    fail("Status penggantian garansi tidak lengkap", 409, "replacement_state_incomplete");
  }
  const oldAccount = (db.managedAccounts || []).find((item) => text(item.id) === text(claim.replacement.oldAccountId));
  const newAccount = (db.managedAccounts || []).find((item) => text(item.id) === text(claim.replacement.newAccountId));
  const order = [...(db.orders || []), ...(db.manualOrders || [])].find((item) => text(item.id) === text(claim.orderId));
  if (!oldAccount || !newAccount || !order) {
    fail("Relasi penggantian garansi tidak lengkap", 409, "replacement_relation_missing");
  }
  const invariants = [
    [text(oldAccount.status).toLowerCase() === "replaced", "replacement_old_account_not_archived"],
    [text(newAccount.resellerId) === text(oldAccount.resellerId), "replacement_reseller_mismatch"],
    [accountOrderId(newAccount) === text(order.id), "replacement_order_mismatch"],
    [text(newAccount.expiresAt) === text(claim.replacement.adjustedExpiresAt || oldAccount.expiresAt), "replacement_expiry_mismatch"],
    [text(newAccount.stockId) === text(claim.replacement.newStockId), "replacement_stock_mismatch"],
    [(order.deliveredStockIds || []).some((id) => text(id) === text(newAccount.stockId)), "replacement_order_stock_missing"],
    [!(order.deliveredStockIds || []).some((id) => text(id) === text(oldAccount.stockId)), "replacement_old_stock_still_delivered"],
  ];
  const failed = invariants.find(([valid]) => !valid);
  if (failed) fail("Validasi penggantian garansi gagal", 409, failed[1]);
  return { claim, oldAccount, newAccount, order };
}

export function buildWarrantyOwnerNotification(db = {}, claim = {}, options = {}) {
  const account = claimAccount(db, claim);
  const reseller = claimReseller(db, claim, account);
  return joinWarrantyMessage([
    "Klaim Garansi Baru",
    "",
    `Claim ID : ${claim.id || "-"}`,
    `Reseller : ${reseller?.username || reseller?.name || claim.resellerId || "-"}`,
    `Nomor Reseller : ${reseller?.whatsapp || account?.whatsapp || "-"}`,
    `Produk : ${[claim.product, claim.variant].filter(Boolean).join(" - ") || "-"}`,
    `Order ID : ${claim.orderId || "-"}`,
    `Akun : ${claim.accountIdentity || maskIdentity(accountIdentity(account || {}))}`,
    `Kendala : ${claim.issue || "-"}`,
    `Bukti : ${(claim.evidence || []).length ? `${claim.evidence.length} screenshot tersimpan di tiket` : "Belum tersedia"}`,
    claim.reviewDueAt ? `Batas Review : ${claim.reviewDueAt}` : "",
    ...(claim.stockReviewTriggered ? [
      `Peringatan : ${Number(claim.stockReviewProfileCount || 0)} profil pada akun login yang sama terindikasi bermasalah`,
      `Kondisi stok : DIPERIKSA (${claim.stockReviewSyncStatus === "synced" ? "sudah tersinkron ke Sheets" : "perlu cek sinkronisasi Sheets"})`,
    ] : []),
    "",
    options.ownerUrl ? `Aksi Owner : Buka Warranty Center ${options.ownerUrl}?claim=${encodeURIComponent(claim.id || "")}` : "Aksi Owner : Buka menu Garansi di Kavya Console.",
  ]);
}

export function buildWarrantyReplacementNotifications(db = {}, replacement = {}, options = {}) {
  const { claim = {}, newAccount = {}, order = {} } = replacement;
  const reseller = claimReseller(db, claim, newAccount);
  const product = [newAccount.product, newAccount.variant].filter(Boolean).join(" - ") || claim.product || "akun";
  const accountUrl = options.accountUrl || "";
  return {
    reseller: joinWarrantyMessage([
      "Penggantian Akun Garansi",
      "",
      `Halo ${reseller?.username || reseller?.name || "Reseller"}, akun garansi kamu sudah diganti.`,
      "",
      `Claim ID : ${claim.id || "-"}`,
      `Produk : ${product}`,
      `Order ID : ${order.id || claim.orderId || "-"}`,
      `Akun baru : ${accountIdentity(newAccount) || "Lihat di Akun Saya"}`,
      `Berlaku sampai : ${newAccount.expiresAt || "-"}`,
      claim.ownerNote ? `Catatan Owner : ${claim.ownerNote}` : "",
      "",
      "Credential lengkap lihat di menu Akun Saya.",
      accountUrl ? `Buka Akun Saya : ${accountUrl}?account=${encodeURIComponent(newAccount.id || "")}` : "",
    ]),
    owner: joinWarrantyMessage([
      "Penggantian Garansi Selesai",
      "",
      `Claim ID : ${claim.id || "-"}`,
      `Reseller : ${reseller?.username || reseller?.name || claim.resellerId || "-"}`,
      `Produk : ${product}`,
      `Order ID : ${order.id || claim.orderId || "-"}`,
      `Stock baru : ${newAccount.stockId || "-"}`,
      claim.ownerNote ? `Catatan : ${claim.ownerNote}` : "",
      "",
      "Credential tidak dikirim melalui WhatsApp. Detail tersedia di Kavya Console.",
    ]),
  };
}

export function buildWarrantyStatusNotification(db = {}, claim = {}) {
  const label = ({
    submitted: "DIAJUKAN",
    reviewing: "SEDANG DIPERIKSA",
    resolved: "SELESAI",
    rejected: "DITOLAK",
    replaced: "DIGANTI",
  })[claim.status] || text(claim.status).toUpperCase();
  return joinWarrantyMessage([
    "Status Klaim Garansi",
    "",
    `Claim ID : ${claim.id || "-"}`,
    `Produk : ${[claim.product, claim.variant].filter(Boolean).join(" - ") || "-"}`,
    `Status : ${label}`,
    `Catatan Owner : ${claim.ownerNote || "-"}`,
    "Credential akun tidak dikirim lewat WhatsApp. Detail tetap aman di menu Akun Saya.",
  ]);
}

export function buildWarrantyOverdueNotification(db = {}, claim = {}, options = {}) {
  const account = claimAccount(db, claim);
  const reseller = claimReseller(db, claim, account);
  return joinWarrantyMessage([
    "Garansi Perlu Ditangani",
    "",
    `Claim ID : ${claim.id || "-"}`,
    `Reseller : ${reseller?.username || reseller?.name || claim.resellerId || "-"}`,
    `Produk : ${[claim.product, claim.variant].filter(Boolean).join(" - ") || "-"}`,
    `Order ID : ${claim.orderId || "-"}`,
    `Kendala : ${claim.issue || "-"}`,
    `Batas Review : ${claim.reviewDueAt || "-"}`,
    `Terlambat : ${formatElapsedDays(claim.reviewElapsedMinutes)}`,
    "",
    options.ownerUrl ? `Aksi Owner : Buka Warranty Center ${options.ownerUrl}?claim=${encodeURIComponent(claim.id || "")}` : "Aksi Owner : Buka menu Garansi di Kavya Console.",
  ]);
}
