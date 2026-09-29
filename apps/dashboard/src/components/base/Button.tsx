import type { ComponentType, ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideProps } from "lucide-react";

/*
 * The oldest button in the product, and the last one still on a raw palette.
 *
 * It was `bg-red-600` with a `hover:bg-red-700` -- a colour that appeared in
 * exactly two places in the whole app, both of them here and in the error
 * screen, and neither of which is a red brand. Red reads as "delete" and
 * "failure"; a primary action that carries it teaches people to flinch.
 *
 * The primary variant is now the same near-white plate the sign-in button, the
 * landing page's calls to action and both consoles' primary buttons use, and it
 * hovers the same way. Nothing about the component's API changed.
 *
 * These are the base kit's own classes rather than the shared `ui` kit's,
 * because this file predates it and is still reachable from two surfaces. The
 * duplication is bounded -- six rules -- and Phase 6 removes this file once the
 * last two callers move to `ui/`.
 */

type ButtonVariant = "primary" | "outline" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

const variants: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-[var(--text-primary)] text-[var(--text-on-inverse)] hover:bg-[color-mix(in_srgb,var(--text-primary)_58%,white)]",
  outline: "border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]",
  // The one variant that keeps a colour, because a destructive action should
  // not look like every other button on the page.
  danger: "border-[color-mix(in_srgb,var(--status-danger)_32%,transparent)] bg-[color-mix(in_srgb,var(--status-danger)_12%,transparent)] text-[var(--status-danger)] hover:bg-[color-mix(in_srgb,var(--status-danger)_20%,transparent)]",
  ghost: "border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
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
      className={`inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-pill)] border font-medium transition-[background-color,border-color,box-shadow,transform] duration-[--duration-normal] ease-[--ease-out-expo] hover:-translate-y-px hover:shadow-[var(--shadow-lift)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-cyan)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}
