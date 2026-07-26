import type { ReactNode } from "react";
import type { ManagedAccount, Order } from "../../mocks/data";
import { formatRupiah } from "../../mocks/data";
import {
  normalizeResellerAccountStatus,
  resellerAccountDate,
  resellerAccountStatusLabel,
  resellerAccountUsable,
} from "../../lib/resellerAccounts";

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
  return normalizeResellerAccountStatus(account);
}

export function accountActive(account: ManagedAccount) {
  return resellerAccountUsable(account);
}

export function accountStatus(account: ManagedAccount) {
  return resellerAccountStatusLabel(accountWarrantyStatus(account));
}

export function accountStatusClass(account: ManagedAccount) {
  const status = accountWarrantyStatus(account);
  if (status === "inactive") return "bg-slate-100 text-slate-600";
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

function accountDate(value = "", options: { endOfDay?: boolean } = {}) {
  return resellerAccountDate(value, options);
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

export function orderStatusLabel(order: Order) {
  if (order.orderStatus === "cancelled") return "Dibatalkan";
  if (order.qrisStatus === "expired") return "Kedaluwarsa";
  if (order.qrisStatus === "pending") return "Menunggu Pembayaran";
  if (orderPaid(order)) return "Sukses";
  if (order.orderStatus === "processing") return "Diproses";
  return "Menunggu";
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
