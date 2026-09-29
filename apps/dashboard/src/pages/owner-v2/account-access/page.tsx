import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Clipboard, KeyRound, Link2, Mail, RefreshCw, Search, ShieldCheck, Smartphone } from "lucide-react";
import { ConsoleBadge, ConsoleMetrics, ConsoleNotice } from "../../../components/console/ConsoleResource";
import { ConsoleShell } from "../../../components/console/ConsoleShell";
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

function statusTone(account: OwnerAccountAccessAccount) {
  const status = String(account.status || "active").toLowerCase();
  if (["expired", "replaced", "disabled"].includes(status)) return "danger" as const;
  if (account.expiresAt) {
    const remaining = new Date(account.expiresAt).getTime() - Date.now();
    if (Number.isFinite(remaining) && remaining <= 7 * 24 * 60 * 60 * 1000) return "warning" as const;
  }
  return "success" as const;
}

function statusLabel(account: OwnerAccountAccessAccount) {
  const status = String(account.status || "active").toLowerCase();
  if (status === "expired") return "Kedaluwarsa";
  if (status === "replaced") return "Diganti";
  if (status === "disabled") return "Tidak aktif";
  return statusTone(account) === "warning" ? "Hampir berakhir" : "Aktif";
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
  const [copied, setCopied] = useState(false);
  const [updatedAt, setUpdatedAt] = useState("");
  const requestRef = useRef(0);

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
      setCopied(false);
    }, 60_000);
    return () => window.clearTimeout(timer);
  }, [result]);

  const changeProvider = (nextProvider: Provider) => {
    requestRef.current += 1;
    setProvider(nextProvider);
    setTool(nextProvider === "disney" ? "disney_otp" : "signin");
    setQuery("");
    setResult(null);
    setLookupError("");
    setCopied(false);
  };

  const visibleAccounts = useMemo(() => {
    const search = query.trim().toLowerCase();
    const unique = new Map<string, OwnerAccountAccessAccount>();
    for (const account of accounts) {
      const target = accountTarget(account, provider);
      if (!target) continue;
      const key = target.toLowerCase();
      const existing = unique.get(key);
      if (!existing || (statusTone(existing) !== "success" && statusTone(account) === "success")) unique.set(key, account);
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
    setCopied(false);
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

  const copyResult = async () => {
    const value = String(result?.result.value || "");
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const activeCount = accounts.filter((account) => statusTone(account) === "success").length;
  const resultValue = String(result?.result.value || "");
  const selectedTool = tools.find((item) => item.id === tool) || tools[0];

  return (
    <ConsoleShell
      title="Akses & Kode"
      description="Ambil kode dan link akses akun melalui Gmail Owner."
      lastUpdated={updatedAt}
      refreshing={accountsLoading || lookupLoading}
      systemState={accountsError ? "warning" : "healthy"}
      onRefresh={() => loadAccounts(provider)}
    >
      <ConsoleMetrics items={[
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
                <button key={item.id} type="button" role="radio" aria-checked={tool === item.id} className={tool === item.id ? "is-active" : ""} onClick={() => { setTool(item.id); setResult(null); setLookupError(""); }}>
                  <strong>{item.label}</strong><span>{item.hint}</span>
                </button>
              ))}
            </div>

            <form className="console-access-search" onSubmit={(event) => { event.preventDefault(); runLookup().catch(() => undefined); }}>
              <label htmlFor="owner-account-access-target">{provider === "disney" ? "Nomor login Disney" : "Email akun"}</label>
              <div>
                <Search size={17} aria-hidden="true" />
                <input id="owner-account-access-target" value={query} onChange={(event) => { setQuery(event.target.value); setLookupError(""); }} placeholder={provider === "disney" ? "Masukkan nomor login" : "nama@domain.com"} autoComplete="off" />
                <button type="submit" className="console-primary-button" disabled={lookupLoading}>{lookupLoading ? <RefreshCw className="animate-spin" size={16} /> : <Search size={16} />}{lookupLoading ? "Mencari..." : "Cari Kode"}</button>
              </div>
            </form>

            {lookupError ? <ConsoleNotice tone="danger">{lookupError}</ConsoleNotice> : null}
            {result ? (
              <div className="console-access-result" aria-live="polite">
                <div>
                  <span>{selectedTool.label}</span>
                  <ConsoleBadge tone={resultValue ? "success" : "warning"}>{resultValue ? "Ditemukan" : "Belum tersedia"}</ConsoleBadge>
                </div>
                <strong className={resultValue ? "" : "is-empty"}>{resultValue || lookupErrorText(result)}</strong>
                <p>{[result.account.product, result.account.variant, result.account.profile].filter(Boolean).join(" - ")}</p>
                {resultValue ? <button type="button" className="console-secondary-button" onClick={() => copyResult().catch(() => undefined)}>{copied ? <Check size={16} /> : result.result.kind === "link" ? <Link2 size={16} /> : <Clipboard size={16} />}{copied ? "Tersalin" : result.result.kind === "link" ? "Salin Link" : "Salin Kode"}</button> : null}
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
            {!accountsLoading && accountsError ? <div className="console-access-state is-error">{accountsError}<button type="button" className="console-secondary-button" onClick={() => loadAccounts(provider)}>Coba lagi</button></div> : null}
            {!accountsLoading && !accountsError && !visibleAccounts.length ? <div className="console-access-state">Tidak ada akun yang cocok.</div> : null}
            {!accountsLoading && !accountsError ? visibleAccounts.map((account) => {
              const target = accountTarget(account, provider);
              return <button key={`${account.id}-${target}`} type="button" className="console-access-account" onClick={() => { setQuery(target); setLookupError(""); setResult(null); }}>
                <span className="console-access-account-icon">{provider === "disney" ? <Smartphone size={16} /> : <Mail size={16} />}</span>
                <span><strong>{target}</strong><small>{[account.product, account.variant, account.profile].filter(Boolean).join(" - ")}</small></span>
                <ConsoleBadge tone={statusTone(account)}>{statusLabel(account)}</ConsoleBadge>
              </button>;
            }) : null}
          </div>
        </div>
      </section>
    </ConsoleShell>
  );
}
