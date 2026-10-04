import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, Clipboard, KeyRound, Link2, Mail, RefreshCw, Search, ShieldCheck, Smartphone } from "lucide-react";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
import { Badge, Button, MetricRow, Notice } from "../../../components/ui";
import { systemStateFor } from "../../../components/attention";
import { accountStatus, type Label } from "../../../lib/labels";
import {
  api,
  type AccountAccessLookupResult,
  type AccountAccessLookupType,
  type OwnerAccountAccessAccount,
} from "../../../lib/api";

type Provider = "netflix" | "disney";

const netflixTools: Array<{ id: AccountAccessLookupType; label: string; hint: string }> = [
  { id: "signin", label: "Sign-in Code", hint: "Kode masuk Netflix 4 digit" },
  { id: "verification", label: "Verification Code", hint: "Kode verifikasi Netflix 6 digit" },
  { id: "household", label: "Household", hint: "Link household terbaru" },
  { id: "reset", label: "Reset Password", hint: "Link reset password terbaru" },
];

const disneyTools: Array<{ id: AccountAccessLookupType; label: string; hint: string }> = [
  { id: "disney_otp", label: "Disney OTP", hint: "OTP Disney 4 digit" },
];

function accountTarget(account: OwnerAccountAccessAccount, provider: Provider) {
  return provider === "disney" ? String(account.loginPhone || account.email || "").trim() : String(account.email || "").trim().toLowerCase();
}

/** Inside this window an active account is reported as ending soon. */
const EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * An account's status, plus the one judgement the stored value cannot make.
 *
 * The words and the colours come from `lib/labels`, like every other status in
 * the console. What this page adds is the expiry window: an `active` account
 * whose expiry is inside a week is not "Aktif" in any sense an owner needs, and
 * no column in the store knows that.
 *
 * It used to define its own answers instead -- "Kedaluwarsa" for `expired`,
 * "Diganti" for `replaced`, "Tidak aktif" for `disabled` -- which put a sixth
 * set of words on a status the rest of the product already names three ways.
 * "Kedaluwarsa" was the worst of them: it is the word the order vocabulary
 * reserves for a QRIS payment that timed out, so an account that simply ran
 * out of days read as an unpaid order.
 */
function accountAccessStatus(account: OwnerAccountAccessAccount): Label {
  const base = accountStatus(account.status);
  const stored = String(account.status || "active").trim().toLowerCase();

  // Only `active` can be improved on by the clock. An account already replaced
  // or disabled is in trouble whatever its expiry date says, and warning about
  // its date instead of its state would point the owner at the wrong problem.
  if (stored !== "active" || !account.expiresAt) return base;

  const remaining = new Date(account.expiresAt).getTime() - Date.now();
  if (Number.isFinite(remaining) && remaining <= EXPIRY_WARNING_MS) {
    return { label: "Segera berakhir", tone: "warning" };
  }
  return base;
}

function lookupErrorText(result: AccountAccessLookupResult) {
  if (result.result.error) return result.result.error;
  if (result.result.reason === "gmail_not_connected" || result.result.reason === "imap_not_connected") return "Gmail Owner belum terhubung.";
  if (result.result.reason === "not_found") return "Email terbaru belum masuk ke Gmail Owner. Sistem sudah memeriksa label, All Mail, dan Inbox; periksa Email Routing @vya.baby lalu coba lagi.";
  if (result.result.reason === "account_expired") return "Akun sudah kedaluwarsa dan lookup dinonaktifkan.";
  if (result.result.reason === "account_replaced") return "Akun sudah diganti dan lookup dinonaktifkan.";
  if (result.result.reason === "account_disabled") return "Akun sudah tidak aktif.";
  return "Kode atau link belum tersedia. Coba lagi setelah email masuk.";
}

export default function OwnerConsoleAccountAccessPage() {
  const [provider, setProvider] = useState<Provider>("netflix");
  const [tool, setTool] = useState<AccountAccessLookupType>("signin");
  const [query, setQuery] = useState("");
  const [accounts, setAccounts] = useState<OwnerAccountAccessAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [result, setResult] = useState<AccountAccessLookupResult | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [updatedAt, setUpdatedAt] = useState("");
  const requestRef = useRef(0);
  const copyTimerRef = useRef<number | null>(null);
  const COPY_STATE_MS = 1800;

  const tools = provider === "disney" ? disneyTools : netflixTools;

  const loadAccounts = useCallback(async (nextProvider: Provider) => {
    setAccountsLoading(true);
    setAccountsError("");
    try {
      const rows = await api.ownerAccountAccessAccounts(nextProvider);
      setAccounts(rows);
      setUpdatedAt(new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }));
    } catch (cause) {
      setAccounts([]);
      setAccountsError(cause instanceof Error ? cause.message : "Daftar akun gagal dimuat.");
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts(provider).catch(() => undefined);
  }, [loadAccounts, provider]);

  useEffect(() => {
    if (!result) return undefined;
    const timer = window.setTimeout(() => {
      setResult(null);
      setCopyState("idle");
    }, 60_000);
    return () => window.clearTimeout(timer);
  }, [result]);

  // The credential auto-hide above is cleared by its own effect. The copy
  // confirmation's timer is not -- it belongs to an event, not to a value, so
  // there is no dependency that would ever retire it. Without this it fires
  // 1.8s after the owner has navigated away, into a component that no longer
  // exists.
  useEffect(() => clearCopyTimer, []);

  /**
   * Cancel a pending "Tersalin" reset.
   *
   * Without this the timer survives a tool switch, a provider switch, and the
   * unmount of the page itself, and fires 1.8s later into whatever is on screen
   * now. It is harmless in isolation -- it only writes "idle" -- but it is the
   * same class of omission as the untracked timers the reveal fix removed, and
   * leaving one behind while fixing the others makes the next reader unsure
   * which timers in this file are owned.
   */
  const clearCopyTimer = () => {
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
  };

  /*
   * Switching provider, switching tool, typing a different target, or picking a
   * different account from the list all make whatever is on screen wrong, so
   * they all go through one function.
   *
   * This is `reseller-v2/access`'s `clearResult`, copied because the omission
   * was a bug three times over in this file:
   *
   *   - The page bumped `requestRef` without clearing `lookupLoading`. The
   *     in-flight lookup then failed its own `finally` check and never cleared
   *     the flag, so the button stayed disabled showing "Mencari..." for the
   *     rest of the session.
   *   - Switching tool bumped nothing at all. The pending response came back,
   *     matched its request id, and rendered -- under the label of the tool that
   *     had just been selected. A sign-in code displayed as "Reset password" is
   *     worse than no code, because the owner stops looking.
   *   - Picking an account from the list bumped nothing either, which is the
   *     worst of the three. The handler set the query and blanked the result,
   *     so the owner saw a lookup for account A vanish and the input switch to
   *     account B -- then A's sign-in code arrived, still matched its own
   *     request id, and rendered under B. Two different customers' credentials
   *     on one screen, with the input naming the wrong one.
   *
   * Incrementing the request id is what makes the in-flight response stale; the
   * rest is what stops it being visible if it arrives anyway.
   */
  const clearResult = () => {
    requestRef.current += 1;
    clearCopyTimer();
    setLookupLoading(false);
    setResult(null);
    setLookupError("");
    setCopyState("idle");
  };

  const changeProvider = (nextProvider: Provider) => {
    requestRef.current += 1;
    clearCopyTimer();
    setProvider(nextProvider);
    setTool(nextProvider === "disney" ? "disney_otp" : "signin");
    setQuery("");
    setLookupLoading(false);
    setResult(null);
    setLookupError("");
    setCopyState("idle");
  };

  const visibleAccounts = useMemo(() => {
    const search = query.trim().toLowerCase();
    const unique = new Map<string, OwnerAccountAccessAccount>();
    for (const account of accounts) {
      const target = accountTarget(account, provider);
      if (!target) continue;
      const key = target.toLowerCase();
      const existing = unique.get(key);
      if (!existing || (accountAccessStatus(existing).tone !== "success" && accountAccessStatus(account).tone === "success")) unique.set(key, account);
    }
    return [...unique.values()]
      .filter((account) => !search || [accountTarget(account, provider), account.product, account.variant, account.profile].join(" ").toLowerCase().includes(search))
      .slice(0, 30);
  }, [accounts, provider, query]);

  const runLookup = async () => {
    const target = query.trim();
    if (!target) {
      setLookupError(provider === "disney" ? "Pilih atau masukkan nomor login Disney." : "Pilih atau masukkan email akun.");
      return;
    }
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLookupLoading(true);
    setLookupError("");
    setResult(null);
    setCopyState("idle");
    try {
      const response = await api.ownerAccountAccessLookup({ target, type: tool });
      if (requestRef.current !== requestId) return;
      setResult(response);
      setUpdatedAt(new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }));
    } catch (cause) {
      if (requestRef.current !== requestId) return;
      setLookupError(cause instanceof Error ? cause.message : "Lookup akun gagal.");
    } finally {
      if (requestRef.current === requestId) setLookupLoading(false);
    }
  };

  /*
   * A clipboard write can reject: no permission, an insecure context, a browser
   * with no clipboard API. This used to `.catch(() => undefined)` at the call
   * site, so a rejection was indistinguishable from never having pressed the
   * button -- the label reset to "Salin Kode" and the owner went on believing
   * they had copied a code they had not. `copyState` is what the kit's
   * `CopyButton` does with the same problem, kept here because this button is a
   * `Button weight="secondary"` and not a kit component.
   *
   * The reset timer is now owned. Pressing copy, switching tool, and leaving
   * the page all clear it, so "Tersalin" can never outlive the value it was
   * confirming -- which matters here specifically, because the confirmation
   * refers to a credential that may already have been cleared off the screen.
   */
  const copyResult = async () => {
    const value = String(result?.result.value || "");
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    clearCopyTimer();
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = null;
      setCopyState("idle");
    }, COPY_STATE_MS);
  };

  const activeCount = accounts.filter((account) => accountAccessStatus(account).tone === "success").length;
  /* `accountAccessStatus` already encodes the judgement: expired, replaced or
     disabled is a problem, and anything expiring inside a week is a
     problem that is about to become one. So the attention count is the
     complement of the active count -- one filter, two answers, which is
     what stops them drifting apart. */
  const accessAttention = accounts.length - activeCount;
  const resultValue = String(result?.result.value || "");
  const selectedTool = tools.find((item) => item.id === tool) || tools[0];

  return (
    <ConsoleShell
      title="Akses & Kode"
      description="Ambil kode dan link akses akun melalui Gmail Owner."
      lastUpdated={updatedAt}
      refreshing={accountsLoading || lookupLoading}
      attentionCount={accessAttention}
      systemState={systemStateFor(accessAttention, { error: Boolean(accountsError), loading: accountsLoading })}
      onRefresh={() => loadAccounts(provider)}
    >
      <MetricRow items={[
        { label: "Akun tersedia", value: accounts.length, hint: provider === "disney" ? "Identitas login Disney" : "Email Netflix" },
        { label: "Akun aktif", value: activeCount, tone: "success" },
        { label: "Provider", value: provider === "disney" ? "Disney" : "Netflix", tone: "info" },
        { label: "Tool dipilih", value: selectedTool.label },
      ]} />

      <section className="console-access-layout">
        <div className="console-panel console-access-lookup">
          <div className="console-panel-header">
            <div><span>Akses akun</span><h2>Lookup Gmail Owner</h2></div>
            <KeyRound size={18} />
          </div>
          <div className="console-access-body">
            <div className="console-access-provider" role="tablist" aria-label="Pilih provider">
              <button type="button" role="tab" aria-selected={provider === "netflix"} className={provider === "netflix" ? "is-active" : ""} onClick={() => changeProvider("netflix")}><Mail size={16} />Netflix</button>
              <button type="button" role="tab" aria-selected={provider === "disney"} className={provider === "disney" ? "is-active" : ""} onClick={() => changeProvider("disney")}><Smartphone size={16} />Disney</button>
            </div>

            <div className="console-access-tools" role="radiogroup" aria-label="Pilih jenis lookup">
              {tools.map((item) => (
                <button key={item.id} type="button" role="radio" aria-checked={tool === item.id} className={tool === item.id ? "is-active" : ""} onClick={() => { setTool(item.id); clearResult(); }}>
                  <strong>{item.label}</strong><span>{item.hint}</span>
                </button>
              ))}
            </div>

            <form className="console-access-search" onSubmit={(event) => { event.preventDefault(); runLookup().catch(() => undefined); }}>
              <label htmlFor="owner-account-access-target">{provider === "disney" ? "Nomor login Disney" : "Email akun"}</label>
              <div>
                <Search size={17} aria-hidden="true" />
                <input id="owner-account-access-target" value={query} onChange={(event) => { setQuery(event.target.value); clearResult(); }} placeholder={provider === "disney" ? "Masukkan nomor login" : "nama@domain.com"} autoComplete="off" />
                <Button type="submit" weight="primary" disabled={lookupLoading}>{lookupLoading ? <RefreshCw className="animate-spin" size={16} /> : <Search size={16} />}{lookupLoading ? "Mencari..." : "Cari Kode"}</Button>
              </div>
            </form>

            {lookupError ? <Notice tone="danger">{lookupError}</Notice> : null}
            {result ? (
              <div className="console-access-result" aria-live="polite">
                <div>
                  <span>{selectedTool.label}</span>
                  <Badge tone={resultValue ? "success" : "warning"}>{resultValue ? "Ditemukan" : "Belum tersedia"}</Badge>
                </div>
                <strong className={resultValue ? "" : "is-empty"}>{resultValue || lookupErrorText(result)}</strong>
                {/*
                 * Which account. Without it the only thing on screen naming an
                 * account is the search input, which the owner can edit freely
                 * and which this panel does not observe -- a code fetched for
                 * one customer could be read as belonging to another, and the
                 * number below is the thing they hand to a customer. So the
                 * answer travels with the code instead of being inferred from
                 * the field next to it.
                 *
                 * Read off `result.account`, not off the live `provider`: the
                 * provider tab decides which field is the identity, and a
                 * reader should never have to reconstruct that mapping to know
                 * whose code they are looking at.
                 */}
                <p className="console-access-result-account">{[result.account.email, result.account.loginPhone, result.account.product, result.account.variant, result.account.profile].map((part) => String(part || "").trim()).filter(Boolean).join(" - ")}</p>
                {resultValue ? <Button weight="secondary" onClick={() => copyResult().catch(() => undefined)}>{copyState === "copied" ? <Check size={16} /> : copyState === "failed" ? <CircleAlert size={16} /> : result.result.kind === "link" ? <Link2 size={16} /> : <Clipboard size={16} />}{copyState === "copied" ? "Tersalin" : copyState === "failed" ? "Gagal" : result.result.kind === "link" ? "Salin Link" : "Salin Kode"}</Button> : null}
                <small>Hasil otomatis dihapus dari layar setelah 60 detik dan tidak disimpan di browser.</small>
              </div>
            ) : null}
          </div>
        </div>

        <div className="console-panel console-access-accounts">
          <div className="console-panel-header">
            <div><span>Identitas aman</span><h2>Akun yang tersedia</h2></div>
            <ShieldCheck size={18} />
          </div>
          <div className="console-access-account-list">
            {accountsLoading ? <div className="console-access-state"><RefreshCw className="animate-spin" size={18} />Memuat akun...</div> : null}
            {!accountsLoading && accountsError ? <div className="console-access-state is-error">{accountsError}<Button weight="secondary" onClick={() => loadAccounts(provider)}>Coba lagi</Button></div> : null}
            {!accountsLoading && !accountsError && !visibleAccounts.length ? <div className="console-access-state">Tidak ada akun yang cocok.</div> : null}
            {!accountsLoading && !accountsError ? visibleAccounts.map((account) => {
              const target = accountTarget(account, provider);
              return <button key={`${account.id}-${target}`} type="button" className="console-access-account" onClick={() => { clearResult(); setQuery(target); }}>
                <span className="console-access-account-icon">{provider === "disney" ? <Smartphone size={16} /> : <Mail size={16} />}</span>
                <span><strong>{target}</strong><small>{[account.product, account.variant, account.profile].filter(Boolean).join(" - ")}</small></span>
                <Badge tone={accountAccessStatus(account).tone}>{accountAccessStatus(account).label}</Badge>
              </button>;
            }) : null}
          </div>
        </div>
      </section>
    </ConsoleShell>
  );
}
