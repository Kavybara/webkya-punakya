import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWarrantyOwnerNotification,
  buildWarrantyOverdueNotification,
  buildWarrantyReplacementNotifications,
  buildWarrantyStatusNotification,
  createWarrantyClaim,
  evaluateWarrantyStockReview,
  markWarrantyReplacementSync,
  replacementCandidatesForClaim,
  replaceWarrantyAccount,
  replaceWarrantyAccountManually,
  updateWarrantyClaim,
  validateWarrantyReplacementState,
  warrantyPolicyForAccount,
  warrantyClaimsForAuth,
  warrantyManualClaimOptions,
} from "../services/warranty-service.js";

function fixture() {
  return {
    products: [
      {
        id: "prod-netflix",
        name: "Netflix Premium",
        variants: [
          { id: "variant-1u", code: "NET-1U", name: "Sharing 1P1U" },
          { id: "variant-2u", code: "NET-2U", name: "Sharing 1P2U" },
        ],
      },
    ],
    resellers: [
      { id: "reseller-a", username: "nadia", name: "Nadia", whatsapp: "628111111111" },
      { id: "reseller-b", username: "sena", name: "Sena", whatsapp: "628222222222" },
    ],
    orders: [
      {
        id: "ORD-WARRANTY-1",
        resellerId: "reseller-a",
        productId: "prod-netflix",
        variantId: "variant-1u",
        deliveredStockIds: ["stock-old"],
        deliveryStatus: "sent",
        orderStatus: "completed",
        duration: "1 Bulan",
        durationDays: 30,
      },
    ],
    stock: [
      {
        id: "stock-old",
        productId: "prod-netflix",
        variantId: "variant-1u",
        stockPoolKey: "prod-netflix::netflix-1p1u-semi",
        sheetPool: "NETFLIX_SHARED",
        sheetName: "Netflix",
        sheetRow: 10,
        email: "old@example.test",
        password: "old-secret",
        profile: "Caramel",
        pin: "1111",
        status: "sold",
        accountCondition: "NORMAL",
      },
      {
        id: "stock-new",
        productId: "prod-netflix",
        variantId: "variant-1u",
        stockPoolKey: "prod-netflix::netflix-1p1u-semi",
        sheetPool: "NETFLIX_SHARED",
        sheetName: "Netflix",
        sheetRow: 11,
        email: "new@example.test",
        password: "new-secret",
        profile: "Pretzel",
        pin: "2222",
        status: "available",
        accountCondition: "NORMAL",
      },
      {
        id: "stock-other-pool",
        productId: "prod-netflix",
        variantId: "variant-2u",
        stockPoolKey: "prod-netflix::netflix-2u",
        sheetPool: "NETFLIX_2U",
        sheetName: "Netflix",
        sheetRow: 12,
        email: "other@example.test",
        password: "other-secret",
        profile: "Cocoa",
        pin: "3333",
        status: "available",
        accountCondition: "NORMAL",
      },
      {
        id: "stock-blocked",
        productId: "prod-netflix",
        variantId: "variant-1u",
        stockPoolKey: "prod-netflix::netflix-1p1u-semi",
        sheetPool: "NETFLIX_SHARED",
        status: "blocked",
        accountCondition: "DIPERIKSA",
      },
    ],
    managedAccounts: [
      {
        id: "account-old",
        stockId: "stock-old",
        orderId: "ORD-WARRANTY-1",
        sourceOrderId: "ORD-WARRANTY-1",
        resellerId: "reseller-a",
        reseller: "nadia",
        whatsapp: "628111111111",
        product: "Netflix Premium",
        productId: "prod-netflix",
        variant: "Sharing 1P1U",
        variantId: "variant-1u",
        variantCode: "NET-1U",
        stockPoolKey: "prod-netflix::netflix-1p1u-semi",
        email: "old@example.test",
        password: "old-secret",
        profile: "Caramel",
        pin: "1111",
        startedAt: "2026-08-01 10:00",
        expiresAt: "2026-08-31 10:00",
        duration: "1 Bulan",
        durationDays: 30,
        status: "active",
        sheetSource: "google_sheets",
        sheetName: "Netflix",
        sheetPool: "NETFLIX_SHARED",
        sheetRow: 10,
      },
    ],
    warrantyClaims: [],
    activities: [],
  };
}

const clock = () => "2026-08-03 12:00";
let idSequence = 0;
const makeId = (prefix) => `${prefix}-${++idSequence}`;

test("reseller creates one warranty ticket for an owned account", () => {
  idSequence = 0;
  const db = fixture();
  const claim = createWarrantyClaim(db, {
    auth: { role: "reseller", sub: "reseller-a" },
    accountId: "account-old",
    issue: "Akun tidak bisa login",
    now: clock,
    makeId,
  });

  assert.equal(claim.id, "CLM-1");
  assert.equal(claim.status, "submitted");
  assert.equal(claim.resellerId, "reseller-a");
  assert.equal(claim.warrantyDays, 25);
  assert.equal(claim.warrantyEndsAt, "2026-08-26 10:00");
  assert.equal(claim.holdStartedAt, "2026-08-03 12:00");
  assert.equal(claim.reviewDueAt, "2026-08-06 12:00");
  assert.equal(db.warrantyClaims.length, 1);
  assert.throws(() => createWarrantyClaim(db, {
    auth: { role: "reseller", sub: "reseller-a" },
    accountId: "account-old",
    issue: "Klaim duplikat",
    now: clock,
    makeId,
  }), /masih aktif/i);
});

test("owner can create a manual warranty claim from a safe account option", () => {
  idSequence = 0;
  const db = fixture();
  const options = warrantyManualClaimOptions(db, clock);
  assert.equal(options.length, 1);
  assert.equal(options[0].accountId, "account-old");
  assert.equal(options[0].resellerName, "nadia");
  assert.equal("password" in options[0], false);
  assert.equal("pin" in options[0], false);

  const claim = createWarrantyClaim(db, {
    auth: { role: "owner", sub: "owner" },
    accountId: options[0].accountId,
    issue: "Klaim diterima Owner melalui WhatsApp",
    submissionSource: "owner_manual_whatsapp",
    now: clock,
    makeId,
  });

  assert.equal(claim.resellerId, "reseller-a");
  assert.equal(claim.submissionSource, "owner_manual_whatsapp");
  assert.equal(claim.createdByRole, "owner");
  assert.equal(claim.createdBy, "owner");
  assert.match(db.activities[0].title, /manual/i);
});

test("two distinct claimed profiles on one physical account trigger stock review", () => {
  idSequence = 0;
  const db = fixture();
  db.resellers.push({ id: "reseller-c", username: "sena", whatsapp: "628333333333" });
  db.orders.push({
    id: "ORD-WARRANTY-2",
    resellerId: "reseller-c",
    productId: "prod-netflix",
    variantId: "variant-1u",
    deliveredStockIds: ["stock-sibling"],
    deliveryStatus: "sent",
    orderStatus: "completed",
    duration: "1 Bulan",
    durationDays: 30,
  });
  db.stock.push(
    {
      id: "stock-sibling",
      productId: "prod-netflix",
      variantId: "variant-1u",
      stockPoolKey: "prod-netflix::netflix-1p1u-semi",
      sheetPool: "NETFLIX_SHARED",
      sheetName: "Netflix",
      sheetRow: 13,
      email: "OLD@example.test",
      profile: "Pretzel",
      status: "sold",
      accountCondition: "NORMAL",
    },
    {
      id: "stock-third-profile",
      productId: "prod-netflix",
      variantId: "variant-1u",
      stockPoolKey: "prod-netflix::netflix-1p1u-semi",
      sheetPool: "NETFLIX_SHARED",
      sheetName: "Netflix",
      sheetRow: 14,
      email: "old@example.test",
      profile: "Cookie",
      status: "available",
      accountCondition: "NORMAL",
    },
  );
  db.managedAccounts.push({
    ...db.managedAccounts[0],
    id: "account-sibling",
    stockId: "stock-sibling",
    orderId: "ORD-WARRANTY-2",
    sourceOrderId: "ORD-WARRANTY-2",
    resellerId: "reseller-c",
    reseller: "sena",
    profile: "Pretzel",
    sheetRow: 13,
  });

  const first = createWarrantyClaim(db, {
    auth: { role: "reseller", sub: "reseller-a" },
    accountId: "account-old",
    issue: "Profil Caramel gagal digunakan",
    now: clock,
    makeId,
  });
  assert.equal(first.stockReviewTriggered, false);

  const second = createWarrantyClaim(db, {
    auth: { role: "reseller", sub: "reseller-c" },
    accountId: "account-sibling",
    issue: "Profil Pretzel gagal digunakan",
    now: clock,
    makeId,
  });

  assert.equal(second.stockReviewTriggered, true);
  assert.equal(second.stockReviewProfileCount, 2);
  assert.deepEqual(second.stockReviewProfiles, ["Caramel", "Pretzel"]);
  assert.deepEqual(new Set(second.stockReviewStockIds), new Set(["stock-old", "stock-sibling", "stock-third-profile"]));
  for (const stockId of second.stockReviewStockIds) {
    const stock = db.stock.find((item) => item.id === stockId);
    assert.equal(stock.accountCondition, "DIPERIKSA");
    assert.equal(stock.accountConditionBlocked, true);
  }
  assert.equal(db.stock.find((item) => item.id === "stock-third-profile").status, "blocked");
  assert.equal(db.stock.find((item) => item.id === "stock-new").accountCondition, "NORMAL");
  assert.match(db.activities[0].title, /stok.*diperiksa/i);
});

test("stock review counts unique profiles and excludes rejected claims", () => {
  const db = fixture();
  db.warrantyClaims = [
    { id: "claim-a", accountId: "account-old", stockId: "stock-old", profile: "Caramel", status: "submitted" },
    { id: "claim-a-copy", accountId: "account-old", stockId: "stock-old", profile: "caramel", status: "resolved" },
    { id: "claim-rejected", accountId: "account-pretzel", stockId: "stock-pretzel", profile: "Pretzel", status: "rejected" },
  ];
  db.stock.push({
    id: "stock-pretzel",
    productId: "prod-netflix",
    variantId: "variant-1u",
    stockPoolKey: "prod-netflix::netflix-1p1u-semi",
    sheetPool: "NETFLIX_SHARED",
    email: "old@example.test",
    profile: "Pretzel",
    status: "sold",
    accountCondition: "NORMAL",
  });
  db.managedAccounts.push({
    ...db.managedAccounts[0],
    id: "account-pretzel",
    stockId: "stock-pretzel",
    profile: "Pretzel",
  });

  const result = evaluateWarrantyStockReview(db, {
    accountId: "account-old",
    now: clock,
    makeId,
  });

  assert.equal(result.triggered, false);
  assert.equal(result.profileCount, 1);
  assert.equal(db.stock[0].accountCondition, "NORMAL");
});

test("monthly warranty is limited to 25 days while shorter rentals use their real duration", () => {
  const db = fixture();
  assert.deepEqual(warrantyPolicyForAccount(db.managedAccounts[0], clock), {
    warrantyDays: 25,
    warrantyStartedAt: "2026-08-01 10:00",
    warrantyEndsAt: "2026-08-26 10:00",
    eligible: true,
    remainingDays: 23,
  });

  db.managedAccounts[0].duration = "7 Hari";
  db.managedAccounts[0].durationDays = 7;
  db.managedAccounts[0].expiresAt = "2026-08-08 10:00";
  const shortPolicy = warrantyPolicyForAccount(db.managedAccounts[0], clock);
  assert.equal(shortPolicy.warrantyDays, 7);
  assert.equal(shortPolicy.warrantyEndsAt, "2026-08-08 10:00");

  assert.throws(() => createWarrantyClaim(fixture(), {
    auth: { role: "reseller", sub: "reseller-a" },
    accountId: "account-old",
    issue: "Klaim lewat batas",
    now: () => "2026-08-27 10:01",
    makeId,
  }), /masa garansi/i);
});

test("terminal warranty status requires an owner note visible to the reseller", () => {
  idSequence = 0;
  const db = fixture();
  const claim = createWarrantyClaim(db, {
    auth: { role: "reseller", sub: "reseller-a" },
    accountId: "account-old",
    issue: "Akun bermasalah",
    now: clock,
    makeId,
  });

  assert.throws(() => updateWarrantyClaim(db, {
    claimId: claim.id,
    status: "rejected",
    ownerNote: "",
    actorId: "owner",
    now: clock,
    makeId,
  }), /catatan owner/i);

  const updated = updateWarrantyClaim(db, {
    claimId: claim.id,
    status: "rejected",
    ownerNote: "Bukti menunjukkan akun masih dapat digunakan.",
    actorId: "owner",
    now: clock,
    makeId,
  });
  assert.equal(updated.status, "rejected");
  assert.equal(updated.ownerNote, "Bukti menunjukkan akun masih dapat digunakan.");
  const message = buildWarrantyStatusNotification(db, updated);
  assert.match(message, /^Status Klaim Garansi/);
  assert.match(message, /Claim ID\s+: CLM-1/);
  assert.match(message, /Produk\s+: Netflix Premium - Sharing 1P1U/);
  assert.match(message, /DITOLAK/);
  assert.match(message, /Bukti menunjukkan akun masih dapat digunakan/);
  assert.match(message, /Credential akun tidak dikirim lewat WhatsApp/);
  assert.doesNotMatch(message, /old-secret|1111/);
});

test("reseller cannot create or list another reseller warranty claim", () => {
  idSequence = 0;
  const db = fixture();
  assert.throws(() => createWarrantyClaim(db, {
    auth: { role: "reseller", sub: "reseller-b" },
    accountId: "account-old",
    issue: "Mencoba akses akun lain",
    now: clock,
    makeId,
  }), /tidak ditemukan/i);

  createWarrantyClaim(db, {
    auth: { role: "reseller", sub: "reseller-a" },
    accountId: "account-old",
    issue: "Akun tidak bisa login",
    now: clock,
    makeId,
  });
  assert.equal(warrantyClaimsForAuth(db, { role: "reseller", sub: "reseller-b" }).length, 0);
  assert.equal(warrantyClaimsForAuth(db, { role: "owner", sub: "owner" }).length, 1);
});

test("replacement candidates stay in the exact stock group and exclude blocked rows", () => {
  idSequence = 0;
  const db = fixture();
  const claim = createWarrantyClaim(db, {
    auth: { role: "reseller", sub: "reseller-a" },
    accountId: "account-old",
    issue: "Akun tidak bisa login",
    now: clock,
    makeId,
  });
  const candidates = replacementCandidatesForClaim(db, claim.id);
  assert.deepEqual(candidates.map((item) => item.id), ["stock-new"]);
  assert.equal("password" in candidates[0], false, "candidate response must not expose credentials");
  assert.equal("pin" in candidates[0], false, "candidate response must not expose PIN");
});

test("replacement preserves expiry, archives the old assignment, and is idempotent", () => {
  idSequence = 0;
  const db = fixture();
  const claim = createWarrantyClaim(db, {
    auth: { role: "reseller", sub: "reseller-a" },
    accountId: "account-old",
    issue: "Akun tidak bisa login",
    now: clock,
    makeId,
  });
  const first = replaceWarrantyAccount(db, {
    claimId: claim.id,
    stockId: "stock-new",
    actorId: "owner",
    reason: "Akun lama tidak dapat digunakan",
    now: clock,
    makeId,
  });

  assert.equal(first.idempotent, false);
  assert.equal(first.oldAccount.status, "replaced");
  assert.equal(first.oldAccount.replacedByAccountId, first.newAccount.id);
  assert.equal(first.newAccount.expiresAt, "2026-08-31 10:00");
  assert.equal(first.newAccount.startedAt, "2026-08-01 10:00");
  assert.equal(first.newAccount.stockId, "stock-new");
  assert.deepEqual(db.orders[0].deliveredStockIds, ["stock-new"]);
  assert.equal(db.stock[0].accountCondition, "REPLACED");
  assert.equal(db.stock[0].status, "blocked");
  assert.equal(db.stock[1].status, "sold");
  assert.equal(db.warrantyClaims[0].status, "replaced");
  assert.equal(db.warrantyClaims[0].replacementSyncStatus, "pending");
  const verified = validateWarrantyReplacementState(db, claim.id);
  assert.equal(verified.newAccount.resellerId, "reseller-a");
  assert.equal(verified.newAccount.orderId, "ORD-WARRANTY-1");
  assert.equal(verified.newAccount.deliveryTemplateUnreadAt, "2026-08-03 12:00");

  markWarrantyReplacementSync(db, {
    claimId: claim.id,
    status: "failed",
    error: "replacement_target_already_assigned",
    now: clock,
  });
  assert.equal(db.warrantyClaims[0].replacementSyncStatus, "failed");
  markWarrantyReplacementSync(db, { claimId: claim.id, status: "synced", now: clock });
  assert.equal(db.warrantyClaims[0].replacementSyncStatus, "synced");
  assert.equal(db.warrantyClaims[0].replacementSyncError, "");

  const second = replaceWarrantyAccount(db, {
    claimId: claim.id,
    stockId: "stock-new",
    actorId: "owner",
    reason: "Retry request",
    now: clock,
    makeId,
  });
  assert.equal(second.idempotent, true);
  assert.equal(db.managedAccounts.length, 2, "retry must not create a third assignment");
});

test("replacement resumes the rental after the actual warranty review time", () => {
  idSequence = 0;
  const db = fixture();
  const claim = createWarrantyClaim(db, {
    auth: { role: "reseller", sub: "reseller-a" },
    accountId: "account-old",
    issue: "Akun tidak bisa dipakai",
    now: () => "2026-08-10 10:00",
    makeId,
  });
  const replacement = replaceWarrantyAccount(db, {
    claimId: claim.id,
    stockId: "stock-new",
    actorId: "owner",
    reason: "Akun lama rusak",
    now: () => "2026-08-11 16:00",
    makeId,
  });

  assert.equal(replacement.claim.holdEndedAt, "2026-08-11 16:00");
  assert.equal(replacement.claim.holdAppliedMinutes, 30 * 60);
  assert.equal(replacement.claim.reviewOverdue, false);
  assert.equal(replacement.newAccount.warrantyAdjustedStartedAt, "2026-08-02 16:00");
  assert.equal(replacement.newAccount.expiresAt, "2026-09-01 16:00");
  assert.equal(replacement.newAccount.warrantyHoldAppliedMinutes, 30 * 60);
  assert.equal(db.stock[1].soldExpiresAt, "2026-09-01 16:00");
  assert.equal(replacement.claim.replacement.originalExpiresAt, "2026-08-31 10:00");
  assert.equal(replacement.claim.replacement.adjustedExpiresAt, "2026-09-01 16:00");
  validateWarrantyReplacementState(db, claim.id);
});

test("warranty rental hold is capped at three days and marks late reviews", () => {
  idSequence = 0;
  const db = fixture();
  const claim = createWarrantyClaim(db, {
    auth: { role: "reseller", sub: "reseller-a" },
    accountId: "account-old",
    issue: "Akun tidak bisa dipakai",
    now: () => "2026-08-03 12:00",
    makeId,
  });
  const replacement = replaceWarrantyAccount(db, {
    claimId: claim.id,
    stockId: "stock-new",
    actorId: "owner",
    reason: "Pemeriksaan melewati SLA",
    now: () => "2026-08-08 12:00",
    makeId,
  });

  assert.equal(replacement.claim.reviewElapsedMinutes, 5 * 24 * 60);
  assert.equal(replacement.claim.holdAppliedMinutes, 3 * 24 * 60);
  assert.equal(replacement.claim.reviewOverdue, true);
  assert.equal(replacement.newAccount.expiresAt, "2026-09-03 10:00");
  assert.equal(replacement.newAccount.warrantyAdjustedStartedAt, "2026-08-04 10:00");
  validateWarrantyReplacementState(db, claim.id);
});

test("post-replacement validation rejects ownership, order, and expiry drift", () => {
  idSequence = 0;
  const db = fixture();
  const claim = createWarrantyClaim(db, {
    auth: { role: "reseller", sub: "reseller-a" },
    accountId: "account-old",
    issue: "Akun tidak bisa login",
    now: clock,
    makeId,
  });
  const replacement = replaceWarrantyAccount(db, {
    claimId: claim.id,
    stockId: "stock-new",
    actorId: "owner",
    reason: "Akun lama tidak dapat digunakan",
    now: clock,
    makeId,
  });
  replacement.newAccount.resellerId = "reseller-b";
  assert.throws(() => validateWarrantyReplacementState(db, claim.id), /validasi penggantian/i);
});

test("manual Sheet order relation supports warranty replacement without a website order", () => {
  idSequence = 0;
  const db = fixture();
  db.orders = [];
  db.managedAccounts[0].orderId = "MNL-1234567890ABCD";
  db.managedAccounts[0].sourceOrderId = "MNL-1234567890ABCD";
  db.manualOrders = [{
    id: "MNL-1234567890ABCD",
    source: "google_sheets_manual",
    resellerId: "reseller-a",
    duration: "1 Bulan",
    durationDays: 30,
    expiresAt: "2026-08-20 10:00",
    deliveredStockIds: ["stock-old"],
    replacementHistory: [],
  }];
  const claim = createWarrantyClaim(db, {
    auth: { role: "reseller", sub: "reseller-a" },
    accountId: "account-old",
    issue: "Akun tidak bisa login",
    now: clock,
    makeId,
  });
  const replacement = replaceWarrantyAccount(db, {
    claimId: claim.id,
    stockId: "stock-new",
    actorId: "owner",
    reason: "Akun lama tidak dapat digunakan",
    now: clock,
    makeId,
  });
  assert.equal(replacement.order.id, "MNL-1234567890ABCD");
  assert.deepEqual(replacement.order.deliveredStockIds, ["stock-new"]);
  assert.equal(replacement.order.replacementHistory.length, 1);
  validateWarrantyReplacementState(db, claim.id);
});

test("manual by-order warranty replacement creates a reseller account without exposing secrets in WhatsApp text", () => {
  idSequence = 0;
  const db = fixture();
  const claim = createWarrantyClaim(db, {
    auth: { role: "reseller", sub: "reseller-a" },
    accountId: "account-old",
    issue: "Akun maker belum bisa login",
    now: clock,
    makeId,
  });
  const replacement = replaceWarrantyAccountManually(db, {
    claimId: claim.id,
    actorId: "owner",
    reason: "Ambil satuan langsung ke maker",
    account: {
      email: "maker-new@example.test",
      password: "manual-secret",
      profile: "Cocoa",
      pin: "3333",
      expiresAt: "2026-09-15 10:00",
    },
    now: clock,
    makeId,
  });

  assert.equal(replacement.idempotent, false);
  assert.equal(replacement.oldAccount.status, "replaced");
  assert.equal(replacement.newAccount.resellerId, "reseller-a");
  assert.equal(replacement.newAccount.email, "maker-new@example.test");
  assert.equal(replacement.newAccount.password, "manual-secret");
  assert.equal(replacement.newAccount.pin, "3333");
  assert.equal(replacement.newAccount.profile, "Cocoa");
  assert.equal(replacement.newAccount.sheetSource, "manual_by_order");
  assert.equal(replacement.claim.status, "replaced");
  assert.equal(replacement.claim.replacement.manualByOrder, true);
  assert.equal(replacement.claim.replacementSyncStatus, "not_required");
  assert.deepEqual(db.orders[0].deliveredStockIds, [replacement.newAccount.stockId]);
  assert.equal(db.orders[0].replacementHistory[0].manualByOrder, true);
  assert.equal(db.stock.find((stock) => stock.id === replacement.newAccount.stockId)?.manualByOrder, true);

  const verified = validateWarrantyReplacementState(db, claim.id);
  assert.equal(verified.newAccount.id, replacement.newAccount.id);

  const messages = buildWarrantyReplacementNotifications(db, replacement, {
    accountUrl: "https://www.vya.baby/reseller-v2/accounts",
  });
  assert.match(messages.reseller, /maker-new@example\.test/);
  assert.doesNotMatch(`${messages.reseller}\n${messages.owner}`, /manual-secret|3333|Password\s*:|PIN\s*:/i);
});

test("owner and reseller WhatsApp notifications never include password or PIN", () => {
  idSequence = 0;
  const db = fixture();
  const claim = createWarrantyClaim(db, {
    auth: { role: "reseller", sub: "reseller-a" },
    accountId: "account-old",
    issue: "Akun tidak bisa login",
    now: clock,
    makeId,
  });
  claim.evidence = [{ id: "EVD-1", mimeType: "image/png" }];
  const ownerText = buildWarrantyOwnerNotification(db, claim, {
    ownerUrl: "https://www.vya.baby/owner-v2/warranty",
  });
  assert.match(ownerText, /Klaim Garansi Baru/);
  assert.match(ownerText, /CLM-1/);
  assert.match(ownerText, /1 screenshot tersimpan di tiket/);
  assert.match(ownerText, /Aksi Owner : Buka Warranty Center/);
  assert.doesNotMatch(ownerText, /old-secret|PIN\s*:|Password\s*:/i);

  const replacement = replaceWarrantyAccount(db, {
    claimId: claim.id,
    stockId: "stock-new",
    actorId: "owner",
    reason: "Akun lama tidak dapat digunakan",
    now: clock,
    makeId,
  });
  const messages = buildWarrantyReplacementNotifications(db, replacement, {
    accountUrl: "https://www.vya.baby/reseller-v2/accounts",
  });
  assert.match(messages.reseller, /new@example\.test/);
  assert.match(messages.owner, /Penggantian Garansi Selesai/);
  assert.match(messages.reseller, /Credential lengkap lihat di menu Akun Saya/);
  assert.doesNotMatch(`${messages.reseller}\n${messages.owner}`, /new-secret|PIN\s*:|Password\s*:/i);
});

test("overdue warranty notification tells owner which claim needs action", () => {
  idSequence = 0;
  const db = fixture();
  const claim = createWarrantyClaim(db, {
    auth: { role: "reseller", sub: "reseller-a" },
    accountId: "account-old",
    issue: "Akun tidak bisa login",
    now: clock,
    makeId,
  });
  const message = buildWarrantyOverdueNotification(db, {
    ...claim,
    reviewElapsedMinutes: 4 * 24 * 60,
  }, {
    ownerUrl: "https://www.vya.baby/owner-v2/warranty",
  });

  assert.match(message, /^Garansi Perlu Ditangani/);
  assert.match(message, /Claim ID : CLM-1/);
  assert.match(message, /Terlambat : 4 hari/);
  assert.match(message, /Aksi Owner : Buka Warranty Center/);
  assert.doesNotMatch(message, /old-secret|PIN\s*:|Password\s*:/i);
});
