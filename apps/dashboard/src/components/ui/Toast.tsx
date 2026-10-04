import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { Tone } from "./types";

/**
 * A transient confirmation.
 *
 * Two existed and they disagreed about how long to stay: 4.5s in the owner
 * console, 3.5s in the reseller, and the reseller's variant was the one that
 * disappeared while a reader was still reaching for the copy button beside it.
 * 6s is the shared value -- long enough to read and act, short enough that a
 * stale "tersimpan" does not sit on screen claiming something that is no
 * longer true.
 */
const DISMISS_AFTER_MS = 6000;

/**
 * How many toasts may be on screen at once.
 *
 * Three, because that is the number of things a single action can honestly
 * report at once ("tersimpan", "notifikasi terkirim", "pengiriman dilewati")
 * before the panel stops being a confirmation and becomes a log. Past the
 * limit the *oldest* is dropped: the newest is the one about what the reader
 * just did.
 */
const MAX_TOASTS = 3;

export function Toast({ message, tone = "default", onClose }: { message: string; tone?: Tone; onClose: () => void }) {
  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(onClose, DISMISS_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [message, onClose]);

  if (!message) return null;
  return (
    <div className={`ui-toast is-${tone}`} role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" onClick={onClose} aria-label="Tutup notifikasi"><X size={15} /></button>
    </div>
  );
}

export type QueuedToast = { id: number; message: string; tone: Tone };

/**
 * A toast that can hold more than one message.
 *
 * `Toast` takes a single string because most pages have exactly one thing to
 * say. A page that can finish an action in more than one way -- the orders
 * console saves the order, *and* may report that delivery was skipped -- used
 * to have to pick one and drop the other, which is how "pengiriman dilewati"
 * ended up rendered as a green success.
 *
 * The identity is an incrementing number rather than the message string,
 * because the same message can legitimately arrive twice ("Kirim ulang" on two
 * orders) and React would collapse those into one keyed node and keep the first
 * timer attached to the wrong card.
 */
export function useToastQueue() {
  const [toasts, setToasts] = useState<QueuedToast[]>([]);
  const sequence = useRef(0);

  const push = useCallback((message: string, tone: Tone = "default") => {
    if (!message) return;
    sequence.current += 1;
    const entry: QueuedToast = { id: sequence.current, message, tone };
    // The drop is on the head, so the newest stays and the oldest goes.
    setToasts((current) => [...current, entry].slice(-MAX_TOASTS));
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const clear = useCallback(() => setToasts([]), []);

  return { toasts, push, dismiss, clear };
}

/**
 * Renders a queue from `useToastQueue`.
 *
 * `aria-live="polite"` on the container rather than per toast, so a toast
 * joining an existing stack is announced once as part of the region instead of
 * interrupting whatever is being read. `aria-relevant="additions"` keeps a
 * toast quietly expiring from re-announcing itself.
 */
export function ToastStack({ toasts, onDismiss }: {
  toasts: QueuedToast[];
  onDismiss: (id: number) => void;
}) {
  if (!toasts.length) return null;
  return (
    <div className="ui-toast-stack" role="status" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          tone={toast.tone}
          onClose={() => onDismiss(toast.id)}
        />
      ))}
    </div>
  );
}

/** A closeable banner for information that must stay on screen. */
export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: Tone }) {
  return <div className={`ui-notice is-${tone}`} role={tone === "danger" ? "alert" : "status"}>{children}</div>;
}
