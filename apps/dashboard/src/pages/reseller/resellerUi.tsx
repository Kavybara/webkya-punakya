import type { ReactNode } from "react";
import type { ManagedAccount, Order } from "../../mocks/data";
import { formatRupiah } from "../../mocks/data";

export function daysLeft(date: string) {
  if (!date) return 0;
  const target = accountDate(date, { endOfDay: true });
  if (Number.isNaN(target.getTime())) return 0;
  return Math.ceil((target.getTime() - Date.now()) / 86400000);
}

export function daysUsed(account: ManagedAccount) {
  if (!account.startedAt) return 0;
  const start = accountDate(account.startedAt);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000));
}

export function accountWarrantyStatus(account: ManagedAccount) {
  if (account.status === "replaced" || account.status === "disabled") return account.status;
  const remaining = daysLeft(account.expiresAt);
  const durationDays = Number(account.durationDays || 0);
  if (account.status === "expired" || remaining <= 0) return "expired";
  if (durationDays >= 30 && (account.status === "expiring" || remaining <= 5)) return "expiring";
  return "active";
}

export function accountActive(account: ManagedAccount) {
  return ["active", "expiring"].includes(accountWarrantyStatus(account));
}

export function accountStatus(account: ManagedAccount) {
  const status = accountWarrantyStatus(account);
  if (status === "replaced") return "Replaced";
  if (status === "disabled") return "Disabled";
  if (status === "expired") return "Expired";
  if (status === "expiring") return "Expiring";
  return "Aktif";
}

export function accountStatusClass(account: ManagedAccount) {
  const status = accountWarrantyStatus(account);
  if (status === "replaced") return "bg-slate-100 text-slate-600";
  if (status === "disabled") return "bg-red-50 text-red-600";
  if (status === "expired") return "bg-red-50 text-red-600";
  if (status === "expiring") return "bg-amber-50 text-amber-700";
  return "bg-emerald-50 text-emerald-700";
}

export function durationLabel(account: ManagedAccount) {
  const rawDuration = String(account.duration || "").trim();
  const amount = Number(rawDuration.match(/\d+/)?.[0] || 0);
  if (/^\d+\s*b$/i.test(rawDuration) || /\bbulan\b|\bmonth/i.test(rawDuration)) return `${amount || 1} Bulan`;
  if (/^\d+\s*[dh]$/i.test(rawDuration) || /\bhari\b|\bday/i.test(rawDuration)) return `${amount || account.durationDays || 1} Hari`;
  if (/\bjam\b|\bhour\b|\bhr\b/i.test(rawDuration)) return `${amount || 1} Jam`;
  if (rawDuration) return rawDuration;
  if (account.durationDays && !account.duration) return `${account.durationDays} hari`;
  const start = accountDate(account.startedAt);
  const end = accountDate(account.expiresAt, { endOfDay: true });
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "-";
  const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
  return `${days} hari`;
}

export function remainingShort(account: ManagedAccount) {
  if (account.status === "replaced") return "Replaced";
  if (account.status === "disabled") return "Disabled";
  const target = accountDate(account.expiresAt, { endOfDay: true });
  if (Number.isNaN(target.getTime())) return "0 hari";
  const msLeft = target.getTime() - Date.now();
  if (msLeft <= 0) return "0 hari";
  const hours = Math.ceil(msLeft / 3600000);
  if (hours < 48) return `${hours} jam`;
  const remainingDays = Math.ceil(hours / 24);
  const durationDays = Number(account.durationDays || 0);
  return `${durationDays > 0 ? Math.min(remainingDays, durationDays) : remainingDays} hari`;
}

function hasTimePart(value = "") {
  return /\d{1,2}:\d{2}/.test(String(value));
}

function monthNumber(value = "") {
  const key = String(value || "").trim().toLowerCase().replace(/\./g, "");
  const months: Record<string, number> = {
    jan: 0,
    januari: 0,
    feb: 1,
    februari: 1,
    mar: 2,
    maret: 2,
    apr: 3,
    april: 3,
    mei: 4,
    may: 4,
    jun: 5,
    juni: 5,
    jul: 6,
    juli: 6,
    agu: 7,
    agustus: 7,
    aug: 7,
    sep: 8,
    september: 8,
    okt: 9,
    oktober: 9,
    oct: 9,
    nov: 10,
    november: 10,
    des: 11,
    desember: 11,
    dec: 11,
  };
  return months[key];
}

function accountDate(value = "", options: { endOfDay?: boolean } = {}) {
  const raw = String(value || "").trim();
  if (!raw) return new Date(Number.NaN);
  const monthMatch = raw.match(/^(\d{1,2})[\s/-]*([a-zA-Z]+)(?:[\s/-]+(\d{4}))?(?:[\s,]+(\d{1,2})[:.](\d{2}))?$/);
  if (monthMatch) {
    const month = monthNumber(monthMatch[2]);
    if (month !== undefined) {
      const date = new Date(Number(monthMatch[3] || new Date().getFullYear()), month, Number(monthMatch[1]), Number(monthMatch[4] || 0), Number(monthMatch[5] || 0));
      if (options.endOfDay && !monthMatch[4]) date.setHours(23, 59, 59, 999);
      return date;
    }
  }
  const normalized = raw.replace(" ", "T");
  const date = new Date(hasTimePart(raw) ? normalized : `${raw}T00:00:00`);
  if (!Number.isNaN(date.getTime()) && options.endOfDay && !hasTimePart(raw)) {
    date.setHours(23, 59, 59, 999);
  }
  return date;
}

export function orderPaid(order: Order) {
  if (order.orderStatus === "cancelled") return false;
  return order.qrisStatus === "paid" || order.orderStatus === "completed";
}

export function orderStatusClass(order: Order) {
  if (order.orderStatus === "cancelled" || order.qrisStatus === "expired") return "bg-red-50 text-red-600";
  if (orderPaid(order)) return "bg-emerald-50 text-emerald-700";
  return "bg-amber-50 text-amber-700";
}

export function compactDate(value: string) {
  if (!value) return "-";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function productLabel(account: ManagedAccount) {
  return [account.product, account.variant].filter(Boolean).join(" - ");
}

export function maskSecret(value = "") {
  return value ? "********" : "-";
}

export function ResellerPageTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-xl font-bold text-slate-950">{title}</h1>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
    </div>
  );
}

export function ResellerStatCard({
  label,
  value,
  icon,
  tone = "emerald",
  active = false,
  onClick,
  hint,
  className = "",
}: {
  label: string;
  value: ReactNode;
  icon?: string;
  tone?: "emerald" | "blue" | "red" | "amber";
  active?: boolean;
  onClick?: () => void;
  hint?: string;
  className?: string;
}) {
  const toneClass = {
    emerald: "bg-emerald-50 text-emerald-600",
    blue: "bg-blue-50 text-blue-600",
    red: "bg-red-50 text-red-600",
    amber: "bg-amber-50 text-amber-600",
  }[tone];

  const Component = onClick ? "button" : "div";

  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`w-full rounded-xl border bg-white p-3 text-left transition ${
        active ? "border-slate-300 shadow-sm shadow-slate-950/5" : "border-slate-100"
      } ${onClick ? "hover:border-slate-200 hover:bg-slate-50/60" : ""} ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">{label}</p>
          <p className="mt-1.5 text-xl font-bold text-slate-950">{value}</p>
          {hint ? <p className="mt-1 text-[11px] text-slate-400">{hint}</p> : null}
        </div>
        {icon ? (
          <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${toneClass}`}>
            <i className={`${icon} text-sm`} />
          </span>
        ) : null}
      </div>
    </Component>
  );
}

export function ResellerSearch({
  value,
  onChange,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <label className={`relative block ${className}`}>
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
        <i className="ri-search-line text-sm" />
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-slate-100 bg-white pl-10 pr-4 text-xs text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-emerald-200"
      />
    </label>
  );
}

export function FilterPill({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-11 rounded-xl px-4 text-xs font-semibold transition-colors ${
        active ? "bg-emerald-600 text-white" : "border border-slate-100 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

export function MiniBadge({ children, className }: { children: ReactNode; className: string }) {
  return <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${className}`}>{children}</span>;
}

export function money(value: number) {
  return formatRupiah(value);
}

