import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

export type ConsoleTone = "success" | "warning" | "danger" | "muted" | "info";

export function ConsoleBadge({ children, tone = "muted" }: { children: ReactNode; tone?: ConsoleTone }) {
  return <span className={`console-status-badge is-${tone}`}><span />{children}</span>;
}

export function ConsoleMetrics({ items }: { items: Array<{ label: string; value: ReactNode; hint?: string; tone?: ConsoleTone; onClick?: () => void }> }) {
  return (
    <section className="console-resource-metrics" aria-label="Ringkasan data">
      {items.map((item) => {
        const content = <><span>{item.label}</span><strong>{item.value}</strong>{item.hint ? <small>{item.hint}</small> : null}</>;
        return item.onClick ? <button key={item.label} type="button" className={`is-${item.tone || "muted"}`} onClick={item.onClick}>{content}</button> : <article key={item.label} className={`is-${item.tone || "muted"}`}>{content}</article>;
      })}
    </section>
  );
}

export function ConsoleNotice({ children, tone = "info" }: { children: ReactNode; tone?: ConsoleTone }) {
  return <div className={`console-resource-notice is-${tone}`} role={tone === "danger" ? "alert" : "status"}>{tone === "danger" || tone === "warning" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}{children}</div>;
}

export function ConsoleActionToast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    if (!message) return undefined;
    const timeout = window.setTimeout(onClose, 4500);
    return () => window.clearTimeout(timeout);
  }, [message, onClose]);
  if (!message) return null;
  return <div className="console-action-toast" role="status" aria-live="polite"><CheckCircle2 size={17} /><span>{message}</span><button type="button" onClick={onClose} aria-label="Tutup notifikasi"><X size={15} /></button></div>;
}

export function ConsoleField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="console-resource-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

export function ConsoleDialog({ title, eyebrow, onClose, children, footer, wide = false }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
  return (
    <div className="console-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`console-resource-dialog ${wide ? "is-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="console-resource-dialog-title">
        <header><div>{eyebrow ? <span>{eyebrow}</span> : null}<h2 id="console-resource-dialog-title">{title}</h2></div><button type="button" className="console-icon-button" onClick={onClose} aria-label="Tutup dialog"><X size={18} /></button></header>
        <div className="console-resource-dialog-body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </section>
    </div>
  );
}

export function ConsoleDialogActions({ onCancel, onConfirm, confirmLabel, busy = false, danger = false }: { onCancel: () => void; onConfirm: () => void; confirmLabel: string; busy?: boolean; danger?: boolean }) {
  return <div className="console-dialog-actions"><button type="button" className="console-secondary-button" onClick={onCancel} disabled={busy}>Batal</button><button type="button" className={danger ? "console-danger-button" : "console-primary-button"} onClick={onConfirm} disabled={busy}>{busy ? "Memproses..." : confirmLabel}</button></div>;
}
