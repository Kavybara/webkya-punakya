import type { HTMLAttributes, ReactNode } from "react";
import { Badge } from "../base/Badge";

export function OwnerStat({
  label,
  value,
  icon,
  delta,
  deltaClassName = "text-emerald-600",
  active = false,
  onClick,
}: {
  label: string;
  value: ReactNode;
  icon?: string;
  delta?: string;
  deltaClassName?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const clickable = typeof onClick === "function";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border bg-white px-4 py-4 text-left shadow-sm shadow-slate-950/5 transition-colors ${
        active ? "border-red-200 bg-red-50" : "border-gray-100"
      } ${clickable ? "cursor-pointer hover:border-red-100 hover:bg-red-50/40" : "cursor-default"}`}
      disabled={!clickable}
    >
      <div className="flex items-start justify-between gap-3">
        {icon ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-red-50 text-red-600">
            <i className={`${icon} text-base`} />
          </span>
        ) : (
          <span className="text-xs text-slate-400">{label}</span>
        )}
        {delta ? <span className={`text-xs font-semibold ${deltaClassName}`}>{delta}</span> : null}
      </div>
      <div className="mt-3 text-xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 flex items-center justify-between gap-3 text-xs text-slate-500">
        <span>{label}</span>
        {clickable ? <i className="ri-arrow-right-s-line text-sm text-slate-400" /> : null}
      </div>
    </button>
  );
}

export function FilterPill({
  active,
  children,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-10 shrink-0 items-center justify-center gap-1 rounded-lg border px-3 text-xs font-medium transition-colors sm:h-8 sm:rounded-md ${
        active
          ? "border-red-200 bg-red-50 text-red-600"
          : "border-gray-100 bg-white text-slate-600 hover:border-red-100 hover:bg-red-50 hover:text-red-600"
      }`}
    >
      {children}
    </button>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="relative block">
      <span className="pointer-events-none absolute left-3 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center text-slate-400">
        <i className="ri-search-line" />
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-[16px] text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-red-200 sm:h-9 sm:rounded-md sm:text-sm"
      />
    </label>
  );
}

export function DataPanel({
  children,
  className = "",
  ...props
}: {
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLElement>) {
  return (
    <section {...props} className={`rounded-xl border border-gray-100 bg-white shadow-sm shadow-slate-950/5 ${className}`}>
      {children}
    </section>
  );
}

export function PageToolbar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`rounded-xl border border-gray-100 bg-white p-3 shadow-sm shadow-slate-950/5 sm:p-4 ${className}`}>{children}</div>;
}

export function StatusBadge({ tone, children }: { tone: "emerald" | "red" | "amber" | "slate"; children: ReactNode }) {
  return <Badge variant={tone}>{children}</Badge>;
}
