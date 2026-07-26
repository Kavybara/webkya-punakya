import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Eye,
  EyeOff,
  LoaderCircle,
  X,
} from "lucide-react";

export type ResellerTone =
  "default" | "success" | "warning" | "danger" | "info" | "muted";

export function maskIdentity(value = "") {
  const clean = String(value || "").trim();
  if (!clean) return "-";
  if (clean.includes("@")) {
    const [name, domain] = clean.split("@");
    const visible = name.slice(0, Math.min(2, name.length));
    return `${visible}${"*".repeat(Math.max(3, name.length - visible.length))}@${domain}`;
  }
  const digits = clean.replace(/\D/g, "");
  if (digits.length >= 7)
    return `${digits.slice(0, 3)}${"*".repeat(Math.max(4, digits.length - 6))}${digits.slice(-3)}`;
  return `${clean.slice(0, 2)}${"*".repeat(Math.max(3, clean.length - 2))}`;
}

export function ResellerStatusBadge({
  tone = "default",
  children,
}: {
  tone?: ResellerTone;
  children: ReactNode;
}) {
  return <span className={`reseller-v2-badge is-${tone}`}>{children}</span>;
}

export function ResellerLoadingSkeleton({ lines = 1 }: { lines?: number }) {
  return (
    <div className="reseller-v2-skeleton" aria-label="Memuat data">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

export function ResellerEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="reseller-v2-state">
      <span className="reseller-v2-state-icon">
        <Check size={19} />
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function ResellerErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="reseller-v2-state is-error" role="alert">
      <span className="reseller-v2-state-icon">
        <AlertCircle size={19} />
      </span>
      <strong>Data belum dapat dimuat</strong>
      <p>{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          Coba Lagi
        </button>
      ) : null}
    </div>
  );
}

export function ResellerSummaryMetric({
  label,
  value,
  hint,
  icon,
  tone = "default",
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint: string;
  icon: ReactNode;
  tone?: ResellerTone;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="reseller-v2-metric-head">
        <span>{label}</span>
        <i className={`is-${tone}`}>{icon}</i>
      </div>
      <strong>{value}</strong>
      <small>{hint}</small>
    </>
  );
  return onClick ? (
    <button
      type="button"
      className="reseller-v2-metric is-interactive"
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <article className="reseller-v2-metric">{content}</article>
  );
}

export function ResellerActionCard({
  title,
  description,
  icon,
  onClick,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className="reseller-v2-action" onClick={onClick}>
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <small>{description}</small>
      </div>
    </button>
  );
}

export function ResellerBalanceCard({
  balance,
  held,
  loading,
  onTopUp,
  onHistory,
}: {
  balance: string;
  held?: string;
  loading?: boolean;
  onTopUp: () => void;
  onHistory: () => void;
}) {
  return (
    <article id="saldo" className="reseller-v2-panel reseller-v2-balance-card">
      <div>
        <span>Saldo reseller</span>
        <h2>{loading ? <ResellerLoadingSkeleton /> : balance}</h2>
        <p>
          {held ? `Saldo tertahan ${held}` : "Siap digunakan untuk transaksi."}
        </p>
      </div>
      <div className="reseller-v2-balance-actions">
        <button type="button" className="reseller-v2-primary" onClick={onTopUp}>
          Top Up
        </button>
        <button
          type="button"
          className="reseller-v2-secondary"
          onClick={onHistory}
        >
          Riwayat saldo
        </button>
      </div>
    </article>
  );
}

export function ResellerDetailDrawer({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const drawer = closeRef.current?.closest("[role=dialog]");
      const focusable = Array.from(
        drawer?.querySelectorAll<HTMLElement>(
          'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
        ) || [],
      ).filter((node) => !node.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [onClose, open]);
  if (!open) return null;
  return (
    <div
      className="reseller-v2-overlay"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside
        className="reseller-v2-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reseller-drawer-title"
      >
        <header>
          <div>
            <h2 id="reseller-drawer-title">{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Tutup detail"
          >
            <X size={19} />
          </button>
        </header>
        <div className="reseller-v2-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

export function ResellerConfirmationDialog({
  open,
  title,
  description,
  confirmLabel = "Konfirmasi",
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <ResellerDetailDrawer open={open} title={title} onClose={onClose}>
      <p>{description}</p>
      <div className="reseller-v2-dialog-actions">
        <button
          type="button"
          className="reseller-v2-secondary"
          onClick={onClose}
          disabled={busy}
        >
          Batal
        </button>
        <button
          type="button"
          className="reseller-v2-primary"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? (
            <LoaderCircle className="reseller-v2-spin" size={16} />
          ) : null}
          {confirmLabel}
        </button>
      </div>
    </ResellerDetailDrawer>
  );
}

export function ResellerSensitiveValue({
  value,
  concealAfterMs = 15000,
}: {
  value: string;
  concealAfterMs?: number;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => setVisible(false), concealAfterMs);
    return () => window.clearTimeout(timer);
  }, [concealAfterMs, visible]);
  return (
    <span className="reseller-v2-sensitive">
      <code>{visible ? value : maskIdentity(value)}</code>
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "Sembunyikan nilai" : "Tampilkan nilai"}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </span>
  );
}

export function ResellerCopyButton({
  value,
  label = "Salin",
  onCopied,
}: {
  value: string;
  label?: string;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    onCopied?.();
    window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      type="button"
      className="reseller-v2-copy"
      onClick={() => copy().catch(() => undefined)}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
      {copied ? "Tersalin" : label}
    </button>
  );
}

export function ResellerToast({
  message,
  tone = "default",
  onClose,
}: {
  message: string;
  tone?: ResellerTone;
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 3500);
    return () => window.clearTimeout(timer);
  }, [onClose]);
  return (
    <div className={`reseller-v2-toast is-${tone}`} role="status">
      <span>{message}</span>
      <button type="button" onClick={onClose} aria-label="Tutup notifikasi">
        <X size={15} />
      </button>
    </div>
  );
}

export function ResellerResponsiveCardList({
  children,
}: {
  children: ReactNode;
}) {
  return <div className="reseller-v2-responsive-list">{children}</div>;
}
