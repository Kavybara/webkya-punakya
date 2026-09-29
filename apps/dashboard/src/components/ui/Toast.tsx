import { useEffect, type ReactNode } from "react";
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

/** A closeable banner for information that must stay on screen. */
export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: Tone }) {
  return <div className={`ui-notice is-${tone}`} role={tone === "danger" ? "alert" : "status"}>{children}</div>;
}
