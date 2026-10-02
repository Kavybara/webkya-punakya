import { useEffect, useState } from "react";
import { Check, CircleAlert, Copy, Eye, EyeOff } from "lucide-react";

/**
 * A value that is masked until someone asks for it, and masks itself again.
 *
 * Only the reseller console had this. The owner console's account-access page
 * shows sign-in codes and OTPs and simply did not mask them at all, so the
 * single place in the product where a credential is deliberately on screen was
 * also the one place it was on screen permanently and in a shoulder-surfable
 * row. Revealing here is a deliberate act, and the reveal expires.
 *
 * `kind` decides what "masked" means, because the two are opposites. An identity
 * -- an email, a login phone -- is shown partially on purpose: the reader has to
 * recognise *which* account it is, and the tail is often how people tell two
 * of their own accounts apart. A secret has no such job. Revealing the last
 * three characters of a password tells the reader nothing useful and hands over
 * most of the answer, so a secret shows no characters at all.
 *
 * Every caller used the identity mask for both, which meant a masked password
 * still displayed its first and last three digits -- for a purely numeric
 * seven-character password, six of its seven characters. The row read
 * "masked" while being nearly readable.
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

/**
 * Masks a secret, showing nothing of it by default.
 *
 * The count of asterisks is the value's length, so a short PIN and a long
 * password are distinguishable by shape without either being readable -- which
 * is the only thing a masked secret is allowed to give away.
 */
export function maskSecret(value = "", visibleHead = 0, visibleTail = 0) {
  const clean = String(value || "").trim();
  if (!clean) return "-";
  if (clean.length <= visibleHead + visibleTail) return "*".repeat(clean.length);
  return `${clean.slice(0, visibleHead)}${"*".repeat(clean.length - visibleHead - visibleTail)}${visibleTail ? clean.slice(-visibleTail) : ""}`;
}

const REVEAL_AFTER_MS = 15000;

export function SensitiveValue({ value, kind = "identity", concealAfterMs = REVEAL_AFTER_MS }: { value: string; kind?: "identity" | "secret"; concealAfterMs?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!visible) return undefined;
    const timer = window.setTimeout(() => setVisible(false), concealAfterMs);
    return () => window.clearTimeout(timer);
  }, [concealAfterMs, visible]);

  const masked = kind === "secret" ? maskSecret(value) : maskIdentity(value);

  return (
    <span className="ui-sensitive">
      <code>{visible ? value : masked}</code>
      <button type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? "Sembunyikan nilai" : "Tampilkan nilai"}>
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </span>
  );
}

/**
 * The two states a copy can end in, kept apart on purpose.
 *
 * `idle` is not a failure -- it is the button before it is pressed. Only
 * `failed` means the value did not reach the clipboard.
 */
type CopyState = "idle" | "copied" | "failed";

export function CopyButton({ value, label = "Salin", onCopied }: { value: string; label?: string; onCopied?: () => void }) {
  const [state, setState] = useState<CopyState>("idle");

  async function copy() {
    // A clipboard write can reject: no permission, an insecure context, a
    // browser with no clipboard at all. The old version caught that and reset
    // the label to "Salin" -- which is indistinguishable from never having
    // pressed the button, so a reseller reading a code could believe they had
    // copied it and typed the old one into a customer chat. The failure now
    // says so in the button itself.
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    onCopied?.();
    window.setTimeout(() => setState("idle"), 1500);
  }

  return (
    <button
      type="button"
      className={`ui-copy${state === "failed" ? " is-failed" : ""}`}
      onClick={() => void copy()}
    >
      {state === "copied" ? <Check size={15} /> : state === "failed" ? <CircleAlert size={15} /> : <Copy size={15} />}
      {state === "copied" ? "Tersalin" : state === "failed" ? "Gagal" : label}
    </button>
  );
}
