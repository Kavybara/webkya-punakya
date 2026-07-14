import type { ReactNode } from "react";

type BadgeVariant = "emerald" | "red" | "amber" | "info" | "slate";

const variants: Record<BadgeVariant, string> = {
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
  red: "bg-red-50 text-red-700 border-red-100",
  amber: "bg-amber-50 text-amber-700 border-amber-100",
  info: "bg-slate-100 text-slate-600 border-slate-200",
  slate: "bg-slate-100 text-slate-600 border-slate-200",
};

export function Badge({
  children,
  variant = "slate",
  className = "",
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
