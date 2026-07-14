import type { ComponentType, ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideProps } from "lucide-react";

type ButtonVariant = "primary" | "outline" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-red-600 text-white border-red-600 hover:bg-red-700",
  outline: "bg-white text-slate-700 border-gray-200 hover:bg-slate-50",
  danger: "bg-red-50 text-red-600 border-red-200 hover:bg-red-100",
  ghost: "bg-transparent text-slate-600 border-transparent hover:bg-slate-100",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ComponentType<LucideProps>;
  children: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  icon: Icon,
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}
