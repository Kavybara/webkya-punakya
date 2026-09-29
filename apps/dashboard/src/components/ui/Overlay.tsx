import { useEffect, useId, useRef, type ReactNode } from "react";
import { LoaderCircle, X } from "lucide-react";

/**
 * The modal surface: a centred dialog and a side drawer, one implementation.
 *
 * The focus management here is the reseller's, and it is the reason the owner
 * console's dialog was worth deleting rather than keeping. That one closed on
 * Escape and did nothing else: it did not move focus into the panel, so a
 * keyboard user stayed on the page behind it and Tab walked the hidden page;
 * it did not restore focus on close, so dismissing dropped the caret at the top
 * of the document; and it left `aria-modal` as a claim it could not keep. None
 * of that is visible in a screenshot, and all of it makes a dialog unusable
 * without a mouse.
 *
 * Both variants are `presentational` overlays: the backdrop dismisses on
 * mousedown, Escape dismisses, focus is trapped while open, and the element
 * that had focus before opening gets it back on close.
 */

const FOCUSABLE = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';

function useDismissable(open: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    restoreRef.current = document.activeElement as HTMLElement | null;
    // Focus the close button, not the panel: it is the first thing inside and
    // it is always present, so the trap has a guaranteed first node.
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
        .filter((node) => !node.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      restoreRef.current?.focus();
    };
  }, [onClose, open]);

  return { panelRef, closeRef };
}

function OverlayFrame({
  open,
  onClose,
  variant,
  wide,
  title,
  description,
  eyebrow,
  children,
  footer,
  closeLabel,
}: {
  open: boolean;
  onClose: () => void;
  variant: "dialog" | "drawer";
  wide?: boolean;
  title: string;
  description?: string;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel: string;
}) {
  const titleId = useId();
  const { panelRef, closeRef } = useDismissable(open, onClose);
  if (!open) return null;

  return (
    <div
      className="ui-overlay"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        className={`ui-panel is-${variant}${wide ? " is-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <div>
            {eyebrow ? <span className="ui-panel-eyebrow">{eyebrow}</span> : null}
            <h2 id={titleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button ref={closeRef} type="button" className="ui-icon-button" onClick={onClose} aria-label={closeLabel}>
            <X size={18} />
          </button>
        </header>
        <div className="ui-panel-body">{children}</div>
        {footer ? <footer className="ui-panel-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Dialog({ open, title, description, eyebrow, onClose, footer, wide, children }: {
  open: boolean;
  title: string;
  description?: string;
  eyebrow?: string;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <OverlayFrame
      open={open}
      onClose={onClose}
      variant="dialog"
      wide={wide}
      title={title}
      description={description}
      eyebrow={eyebrow}
      footer={footer}
      closeLabel="Tutup dialog"
    >
      {children}
    </OverlayFrame>
  );
}

export function Drawer({ open, title, description, onClose, children }: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <OverlayFrame
      open={open}
      onClose={onClose}
      variant="drawer"
      title={title}
      description={description}
      closeLabel="Tutup detail"
    >
      {children}
    </OverlayFrame>
  );
}

/**
 * The confirm/cancel pair.
 *
 * `ConfirmDialog` is the reseller's shape -- a description and a question,
 * because a destructive action that only says "are you sure?" tells the reader
 * nothing about what they are agreeing to. The owner console's equivalent
 * (`ConsoleDialogActions`) was a bare pair of buttons that the caller had to
 * place by hand, which is how a confirm ends up with no explanation attached.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Konfirmasi",
  busy,
  danger,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Drawer open={open} title={title} onClose={onClose}>
      <p>{description}</p>
      <DialogActions
        onCancel={onClose}
        onConfirm={onConfirm}
        confirmLabel={confirmLabel}
        busy={busy}
        danger={danger}
      />
    </Drawer>
  );
}

export function DialogActions({ onCancel, onConfirm, confirmLabel, busy = false, danger = false }: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="ui-dialog-actions">
      <button type="button" className="ui-button is-secondary" onClick={onCancel} disabled={busy}>Batal</button>
      <button type="button" className={danger ? "ui-button is-danger" : "ui-button is-primary"} onClick={onConfirm} disabled={busy}>
        {busy ? <LoaderCircle className="ui-spin" size={15} /> : null}
        {busy ? "Memproses..." : confirmLabel}
      </button>
    </div>
  );
}
