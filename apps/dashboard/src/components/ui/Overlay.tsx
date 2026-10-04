import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LoaderCircle, X } from "lucide-react";
import { Button } from "./Button";

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

/*
 * Which overlay is on top, right now.
 *
 * Every overlay installs its Escape handler on `window`, so a confirm dialog
 * opened on top of a drawer used to close both on one keypress: the handler on
 * the drawer fired, and so did the one on the dialog. Each entry is the
 * identity of a mounted overlay, and a handler only acts if it owns the last
 * slot -- the one the reader can actually see.
 *
 * A stack rather than a counter, because an overlay can unmount out of order
 * (a dialog closing itself, or a parent page navigating), and removal is by
 * identity so the wrong entry can never be dropped.
 */
const overlayStack: symbol[] = [];

/**
 * The focus half of an overlay, for anything that is a dialog without being
 * one of the two shapes below.
 *
 * The command palette is that case: it is a dialog, it is modal, and it owes
 * the keyboard reader exactly what the others do -- focus goes in, Tab stays
 * in, Escape dismisses, focus comes back on the way out -- but its chrome is a
 * search field rather than a title and a close button. Exported so that it can
 * reuse this instead of growing a second, slightly different keyboard story.
 *
 * `busy` is optional and defaults to false: a caller with nothing to submit
 * does not have to say so.
 */
export function useOverlayFocus(open: boolean, onClose: () => void, busy = false) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // `onClose` and `busy` are read from refs, never from the closure.
  //
  // This is the fix for a caret that jumped back to the close button on every
  // keystroke. Pages pass `onClose={() => setDialog(null)}`, so the identity of
  // that function changed on every render of the parent -- and the parent
  // re-renders on every character typed into the form, and on every tick of the
  // duration preview timer. With `onClose` in the dependency list, each of
  // those renders tore down and rebuilt this effect, and its first act is
  // `closeRef.current?.focus()`. The reader was typing, and mid-keystroke the
  // caret was pulled to the X. The dependency list is now `[open]` alone, which
  // is the only thing that should ever re-arm the trap.
  //
  // Same reasoning for `busy`: a dialog that goes busy mid-flight must start
  // ignoring Escape without that re-arming the effect and stealing the caret.
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  });

  // A stable identity for this overlay, for the stack above. Lazily initialised
  // once and never reassigned.
  const [token] = useState(() => Symbol("overlay"));

  useEffect(() => {
    if (!open) return undefined;
    restoreRef.current = document.activeElement as HTMLElement | null;
    // Focus the close button, not the panel: it is the first thing inside and
    // it is always present, so the trap has a guaranteed first node.
    closeRef.current?.focus();
    overlayStack.push(token);

    function onKeyDown(event: KeyboardEvent) {
      // Only the topmost overlay answers. Anything buried under another one is
      // not what the reader is looking at, and Escape must mean "close this",
      // not "close everything".
      if (overlayStack[overlayStack.length - 1] !== token) return;
      if (event.key === "Escape") {
        // A dialog whose confirm is still in flight stays open. Dismissing it
        // here used to leave the request running with nobody watching it -- the
        // reader sees the dialog close, assumes it cancelled, and the mutation
        // lands anyway.
        if (busyRef.current) return;
        onCloseRef.current();
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
      const index = overlayStack.lastIndexOf(token);
      if (index >= 0) overlayStack.splice(index, 1);
      restoreRef.current?.focus();
    };
    // `open` and `token` are the whole list, deliberately. `token` is a
    // `useState` value initialised once, so it is listed only to satisfy
    // `exhaustive-deps`; it can never change identity and can never re-arm
    // this effect. `onClose` and `busy` are read through refs and are NOT
    // listed -- that is the bug being fixed. Listing either would re-arm the
    // trap, which re-focuses the close button, on a parent render that has
    // nothing to do with this overlay opening.
  }, [open, token]);

  return { panelRef, closeRef };
}

function OverlayFrame({
  open,
  onClose,
  busy = false,
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
  /** True while a mutation is in flight. Escape, the backdrop and the close
   *  button all go inert until it settles. */
  busy?: boolean;
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
  const { panelRef, closeRef } = useOverlayFocus(open, onClose, busy);
  if (!open) return null;

  return (
    <div
      className="ui-overlay"
      role="presentation"
      onMouseDown={(event) => {
        // Same guard as Escape, for the same reason: a click on the scrim is a
        // dismiss, and dismissing mid-submit strands a request the reader has
        // stopped watching.
        if (busy) return;
        if (event.target === event.currentTarget) onClose();
      }}
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
          {/* `aria-disabled`, not `disabled`. This button is the trap's first
              node: disabling it while a submit is in flight would drop the
              reader's focus onto <body> and let Tab walk the page behind the
              dialog. It stays focusable and stays announced as the close
              control -- it just does nothing until the work settles. */}
          <button
            ref={closeRef}
            type="button"
            className="ui-icon-button"
            onClick={() => { if (!busy) onClose(); }}
            aria-label={closeLabel}
            aria-disabled={busy || undefined}
          >
            <X size={18} />
          </button>
        </header>
        <div className="ui-panel-body">{children}</div>
        {footer ? <footer className="ui-panel-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Dialog({ open, title, description, eyebrow, onClose, footer, wide, busy, children }: {
  open: boolean;
  title: string;
  description?: string;
  eyebrow?: string;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <OverlayFrame
      open={open}
      onClose={onClose}
      busy={busy}
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

export function Drawer({ open, title, description, eyebrow, onClose, footer, busy, children }: {
  open: boolean;
  title: string;
  description?: string;
  eyebrow?: string;
  onClose: () => void;
  footer?: ReactNode;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <OverlayFrame
      open={open}
      onClose={onClose}
      busy={busy}
      variant="drawer"
      title={title}
      description={description}
      eyebrow={eyebrow}
      footer={footer}
      closeLabel="Tutup detail"
    >
      {children}
    </OverlayFrame>
  );
}

/**
 * The confirm/cancel pair.
 *
 * `DialogActions` is deliberately only the buttons, not the whole dialog. A
 * destructive action that only says "are you sure?" tells the reader nothing
 * about what they are agreeing to, so the description belongs to the caller,
 * who is the only one who knows what is about to happen -- the owner console
 * hand-assembles `Drawer` + `DialogActions` + `Notice` for exactly this reason.
 * A shared wrapper that took the description as a prop would be that assembly
 * frozen at the one point in the flow it was written for.
 *
 * `busy` here and `busy` on the enclosing `Dialog`/`Drawer` are two halves of
 * one guard, and a caller setting only this one leaves Escape and the backdrop
 * live: the buttons grey out, then the reader hits Escape and the dialog
 * vanishes with the request still running. Pass it to both.
 */
export function DialogActions({ onCancel, onConfirm, confirmLabel, busy = false, danger = false }: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="ui-dialog-actions" aria-busy={busy || undefined}>
      <Button weight="secondary" onClick={onCancel} disabled={busy}>Batal</Button>
      <Button weight={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
        {busy ? <LoaderCircle className="ui-spin" size={15} /> : null}
        {busy ? "Memproses..." : confirmLabel}
      </Button>
    </div>
  );
}
