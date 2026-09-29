import { useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff } from "lucide-react";

/**
 * A value that is masked until someone asks for it, and masks itself again.
 *
 * Only the reseller console had this. The owner console's account-access page
 * shows sign-in codes and OTPs and simply did not mask them at all, so the
 * single place in the product where a credential is deliberately on screen was
 * also the one place it was on screen permanently and in a shoulder-surfable
 * row. Revealing here is a deliberate act, and the reveal expires.
 */
export function maskIdentity(value = "") {
  const clean = String(value || "").trim();
  if (!clean) return "-";
  if (clean.includes("@")) {
    const [name, domain] = clean.split("@");
    const visible = name.slice(0, Math.min(2, name.length));
    return `${visible}${"*".repeat(Math.max(3, name.length - visible.length))}@${domain}`;
  }
  const digits = clean.replace(/\D/g, "");
  if (digits.length >= 7) {
    return `${digits.slice(0, 3)}${"*".repeat(Math.max(4, digits.length - 6))}${digits.slice(-3)}`;
  }
  return `${clean.slice(0, 2)}${"*".repeat(Math.max(3, clean.length - 2))}`;
}

export function maskSecret(value = "", visibleHead = 0, visibleTail = 0) {
  const clean = String(value || "").trim();
  if (!clean) return "-";
  if (clean.length <= visibleHead + visibleTail) return "*".repeat(clean.length);
  return `${clean.slice(0, visibleHead)}${"*".repeat(clean.length - visibleHead - visibleTail)}${visibleTail ? clean.slice(-visibleTail) : ""}`;
}

const REVEAL_AFTER_MS = 15000;

export function SensitiveValue({ value, concealAfterMs = REVEAL_AFTER_MS }: { value: string; concealAfterMs?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!visible) return undefined;
    const timer = window.setTimeout(() => setVisible(false), concealAfterMs);
    return () => window.clearTimeout(timer);
  }, [concealAfterMs, visible]);

  return (
    <span className="ui-sensitive">
      <code>{visible ? value : maskIdentity(value)}</code>
      <button type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? "Sembunyikan nilai" : "Tampilkan nilai"}>
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </span>
  );
}

export function CopyButton({ value, label = "Salin", onCopied }: { value: string; label?: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    // A clipboard write can reject (no permission, insecure context, a
    // clipboard that is not there). Swallowing it silently would leave the
    // button claiming a copy that never happened, so the failure is reported
    // through the same channel the success uses.
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onCopied?.();
    } catch {
      setCopied(false);
      onCopied?.();
    }
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button type="button" className="ui-copy" onClick={() => void copy()}>
      {copied ? <Check size={15} /> : <Copy size={15} />}
      {copied ? "Tersalin" : label}
    </button>
  );
}
