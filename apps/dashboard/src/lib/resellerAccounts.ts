import type { ManagedAccount } from "../mocks/data";

export type ResellerAccountStatus =
  | "active"
  | "expiring"
  | "expired"
  | "inactive";

type AccountStatusInput = {
  status?: string;
  expiresAt?: string;
  durationDays?: number;
  accountCondition?: string;
  accountConditionKnown?: boolean;
};

function monthNumber(value = "") {
  const key = String(value).trim().toLowerCase().replace(/\./g, "");
  const months: Record<string, number> = {
    jan: 0, januari: 0,
    feb: 1, februari: 1,
    mar: 2, maret: 2,
    apr: 3, april: 3,
    mei: 4, may: 4,
    jun: 5, juni: 5,
    jul: 6, juli: 6,
    agu: 7, agustus: 7, aug: 7,
    sep: 8, september: 8,
    okt: 9, oktober: 9, oct: 9,
    nov: 10, november: 10,
    des: 11, desember: 11, dec: 11,
  };
  return months[key];
}

export function resellerAccountDate(
  value = "",
  options: { endOfDay?: boolean } = {},
) {
  const raw = String(value || "").trim();
  if (!raw) return new Date(Number.NaN);
  const monthMatch = raw.match(
    /^(\d{1,2})[\s/-]*([a-zA-Z]+)(?:[\s/-]+(\d{4}))?(?:[\s,]+(\d{1,2})[:.](\d{2}))?$/,
  );
  if (monthMatch) {
    const month = monthNumber(monthMatch[2]);
    if (month !== undefined) {
      const date = new Date(
        Number(monthMatch[3] || new Date().getFullYear()),
        month,
        Number(monthMatch[1]),
        Number(monthMatch[4] || 0),
        Number(monthMatch[5] || 0),
      );
      if (options.endOfDay && !monthMatch[4]) date.setHours(23, 59, 59, 999);
      return date;
    }
  }
  const hasTime = /\d{1,2}:\d{2}/.test(raw);
  const date = new Date(hasTime ? raw.replace(" ", "T") : `${raw}T00:00:00`);
  if (!Number.isNaN(date.getTime()) && options.endOfDay && !hasTime) {
    date.setHours(23, 59, 59, 999);
  }
  return date;
}

export function resellerAccountDaysLeft(
  account: AccountStatusInput,
  now = Date.now(),
) {
  const expiry = resellerAccountDate(account.expiresAt, { endOfDay: true });
  if (Number.isNaN(expiry.getTime())) return null;
  return Math.ceil((expiry.getTime() - now) / 86_400_000);
}

export function normalizeResellerAccountStatus(
  account: AccountStatusInput,
  now = Date.now(),
): ResellerAccountStatus {
  const rawStatus = String(account.status || "").toLowerCase();
  const accountCondition = String(account.accountCondition || "NORMAL").trim().toUpperCase();
  if (account.accountConditionKnown === false || accountCondition === "DISABLED" || accountCondition === "REPLACED") {
    return "inactive";
  }
  if (rawStatus === "disabled" || rawStatus === "replaced") return "inactive";
  const remaining = resellerAccountDaysLeft(account, now);
  if (rawStatus === "expired" || (remaining !== null && remaining <= 0)) {
    return "expired";
  }
  const durationDays = Number(account.durationDays || 0);
  if (
    rawStatus === "expiring" ||
    (durationDays >= 30 && remaining !== null && remaining <= 5)
  ) {
    return "expiring";
  }
  return "active";
}

export function summarizeResellerAccounts(accounts: ManagedAccount[]) {
  const summary = { active: 0, expiring: 0, expired: 0, inactive: 0, total: accounts.length };
  accounts.forEach((account) => {
    summary[normalizeResellerAccountStatus(account)] += 1;
  });
  return summary;
}

export function resellerAccountStatusLabel(status: ResellerAccountStatus) {
  if (status === "expiring") return "Hampir Berakhir";
  if (status === "expired") return "Kedaluwarsa";
  if (status === "inactive") return "Tidak Aktif";
  return "Aktif";
}

export function resellerAccountUsable(account: ManagedAccount) {
  return ["active", "expiring"].includes(normalizeResellerAccountStatus(account));
}
