import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
} from "react";
import {
  ChevronRight,
  CircleAlert,
  Clock,
  ExternalLink,
  HouseWifi,
  Info,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MailCheck,
  MailX,
  Search,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import {
  api,
  subscribeRealtime,
  type AccountAccessLookupResult,
  type AccountAccessLookupType,
  type ApiReseller,
} from "../../../lib/api";
import type { ManagedAccount } from "../../../lib/types";
import {
  normalizeResellerAccountStatus,
  resellerAccountStatusLabel,
} from "../../../lib/resellerAccounts";
import { ResellerShell } from "../../../components/reseller-v2/ResellerShell";
import { systemStateFor } from "../../../components/attention";
import {
  Badge,
  CopyButton,
  DetailRow,
  EmptyState,
  ErrorState,
  Field,
  LoadingSkeleton,
  LoadingState,
  MetricRow,
  Notice,
  SensitiveValue,
} from "../../../components/ui";
import "./access.css";

type AccessSource = "netflix" | "disney";
type AccessTool = AccountAccessLookupType;
type ToolDefinition = {
  id: AccessTool;
  label: string;
  icon: ComponentType<{ size?: number }>;
  hint: string;
};
type AccountGroup = {
  key: string;
  label: string;
  accounts: ManagedAccount[];
  primary: ManagedAccount;
};

const netflixTools: ToolDefinition[] = [
  { id: "signin", label: "Sign-in Code", icon: KeyRound, hint: "Ambil 4 digit kode login terbaru" },
  { id: "verification", label: "Verification Code", icon: ShieldCheck, hint: "Ambil 6 digit kode verifikasi" },
  { id: "reset", label: "Reset Password", icon: LockKeyhole, hint: "Ambil link reset password" },
  { id: "household", label: "Household", icon: HouseWifi, hint: "Ambil link household" },
];

const disneyTools: ToolDefinition[] = [
  { id: "disney_otp", label: "Disney OTP", icon: Smartphone, hint: "Ambil 4 digit OTP Disney dari label Gmail owner" },
];

const allTools = [...netflixTools, ...disneyTools];

function toolLabel(type: AccessTool) {
  return allTools.find((tool) => tool.id === type)?.label || "Akses & Kode";
}

function valueLabel(type: AccessTool) {
  if (type === "signin") return "Sign-in code 4 digit";
  if (type === "verification") return "Verification code 6 digit";
  if (type === "reset") return "Link reset password";
  if (type === "household") return "Link household";
  return "Disney OTP 4 digit";
}

function emptyText(type: AccessTool) {
  if (type === "signin") return "Belum ada sign-in code 4 digit untuk email ini.";
  if (type === "verification") return "Belum ada verification code 6 digit untuk email ini.";
  if (type === "reset") return "Belum ada link reset password untuk email ini.";
  if (type === "household") return "Belum ada link household untuk email ini.";
  return "Belum ada Disney OTP 4 digit untuk nomor ini.";
}

/**
 * The code is in the mailbox, but it aged out before anyone looked.
 *
 * This used to render the same words as "the email has not arrived yet", which
 * is the answer that costs the reseller a second message to the customer: they
 * ask the customer to trigger another code, and nothing changes, because the
 * first one is sitting in `NF_VERIF` the whole time. The remedy here is the
 * opposite -- stop waiting, ask for a fresh code.
 *
 * Returns null for every other outcome, so the caller keeps one branch to
 * reason about rather than a third string it has to keep in sync.
 */
function staleNotice(result: AccountAccessLookupResult) {
  const stale = result.result.staleMessage;
  if (!stale) return null;
  const age = stale.ageMinutes >= 60
    ? `${Math.floor(stale.ageMinutes / 60)} jam ${stale.ageMinutes % 60} menit lalu`
    : `${stale.ageMinutes} menit lalu`;
  return {
    title: "Kode sudah masuk, tapi sudah kedaluwarsa",
    description: `Emailnya ada di Gmail owner, dikirim ${age} — melewati jendela ${stale.windowMinutes} menit. Kode lama tidak akan bisa dipakai; minta pelanggan mengirim ulang kode, lalu tekan Cari Akun lagi.`,
  };
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  return digits;
}

function productLabel(account: ManagedAccount) {
  return [account.product, account.variant].filter(Boolean).join(" - ");
}

function isNetflixAccount(account: ManagedAccount) {
  return [account.product, account.productId, account.variant, account.variantCode]
    .join(" ")
    .toLowerCase()
    .includes("netflix");
}

function isDisneyAccount(account: ManagedAccount) {
  return [account.product, account.productId, account.variant, account.variantCode]
    .join(" ")
    .toLowerCase()
    .includes("disney");
}

function isExpiredAccount(account?: ManagedAccount | AccountAccessLookupResult["account"] | null) {
  if (!account) return false;
  return ["expired", "inactive"].includes(normalizeResellerAccountStatus(account));
}

function inactiveLookupMessage(account?: ManagedAccount | AccountAccessLookupResult["account"] | null) {
  if (account?.status === "replaced") return "Akun sudah replaced, lookup kode tidak aktif.";
  if (account?.status === "disabled") return "Akun sudah nonaktif, lookup kode tidak aktif.";
  return "Akun sudah expired, lookup kode tidak aktif.";
}

function isUrl(value = "") {
  return /^https?:\/\//i.test(value.trim());
}

function sourceText(result: AccountAccessLookupResult) {
  if (result.result.source === "gmail") return result.gmail.mode === "imap" || result.result.mode === "imap" ? "Diambil dari Gmail owner via IMAP" : "Diambil dari Gmail owner";
  if (result.result.source === "managed_account") return "Data lama akun tidak dipakai untuk lookup otomatis";
  if (result.result.source === "mapping") return "Diambil dari mapping backend";
  if (result.result.source === "history") return "Akun ditemukan di riwayat reseller, tetapi statusnya sudah nonaktif";
  if (!result.gmail.connected) return result.gmail.mode === "imap" ? "Gmail IMAP owner belum tersambung" : "Gmail owner belum tersambung OAuth";
  return "Belum ditemukan di label Gmail owner";
}

function formatEmailDateWib(date = "", internalDate = "") {
  const timestamp = Number(internalDate || 0) || Date.parse(date || "");
  if (!Number.isFinite(timestamp) || timestamp <= 0) return date || "-";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function accountStatusBadge(account: ManagedAccount) {
  const status = normalizeResellerAccountStatus(account);
  const tone = status === "expired"
    ? "danger" as const
    : status === "expiring"
      ? "warning" as const
      : status === "inactive"
        ? "muted" as const
        : "success" as const;
  return { label: resellerAccountStatusLabel(status), tone };
}

function accountActiveBadge(account: AccountAccessLookupResult["account"]) {
  if (account.status === "replaced") return { label: "Replaced", tone: "danger" as const };
  if (account.status === "disabled") return { label: "Disabled", tone: "danger" as const };
  return isExpiredAccount(account)
    ? { label: "Non-aktif", tone: "danger" as const }
    : { label: "Aktif", tone: "success" as const };
}

function preferredAccount(accounts: ManagedAccount[]) {
  return accounts.find((account) => !isExpiredAccount(account)) || accounts[0];
}

function groupAccounts(accounts: ManagedAccount[], source: AccessSource): AccountGroup[] {
  const groups = new Map<string, ManagedAccount[]>();
  for (const account of accounts) {
    const key = source === "disney" ? normalizePhone(account.loginPhone || account.email || "") : normalizeEmail(account.email);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), account]);
  }
  return Array.from(groups.entries())
    .map(([key, groupRows]) => ({
      key,
      label: source === "disney" ? (groupRows[0]?.loginPhone || key) : key,
      accounts: groupRows,
      primary: preferredAccount(groupRows),
    }))
    .sort((a, b) => {
      const aActive = isExpiredAccount(a.primary) ? 0 : 1;
      const bActive = isExpiredAccount(b.primary) ? 0 : 1;
      if (aActive !== bActive) return bActive - aActive;
      return a.label.localeCompare(b.label);
    });
}

function groupDescription(group: AccountGroup, source: AccessSource) {
  const variants = Array.from(new Set(group.accounts.map((account) => productLabel(account)).filter(Boolean)));
  const profileCount = group.accounts.length;
  if (source === "disney") {
    const profiles = Array.from(new Set(group.accounts.map((account) => account.profile).filter(Boolean))).slice(0, 3);
    const base = variants.slice(0, 2).join(" / ") || productLabel(group.primary);
    const profileText = profiles.length ? ` - profil ${profiles.join(", ")}` : "";
    return `${base}${profileText}${profileCount > profiles.length ? ` +${profileCount - profiles.length}` : ""}`;
  }
  const base = variants.slice(0, 2).join(" / ") || productLabel(group.primary);
  return profileCount > 1 ? `${base} - ${profileCount} profil` : base;
}

/** A code the reseller can read for fifteen seconds and then has to ask for again. */
function CodeValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="reseller-v2-access-value">
      <div>
        <p>{label}</p>
        <SensitiveValue value={value} />
      </div>
      <CopyButton value={value} />
    </div>
  );
}

/** A link is never printed in full; only its host, its length, and the two ways out. */
function LinkValue({ label, value }: { label: string; value: string }) {
  const fullUrl = value.trim();
  const host = (() => {
    try {
      return new URL(fullUrl).hostname;
    } catch {
      return "link";
    }
  })();
  return (
    <div className="reseller-v2-access-value is-link">
      <div>
        <p>{label}</p>
        <strong>{host}</strong>
        <small>Link lengkap siap disalin ({fullUrl.length} karakter).</small>
      </div>
      <div className="reseller-v2-access-value-actions">
        <CopyButton value={fullUrl} />
        <a href={fullUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={15} aria-hidden="true" />
          Buka Link
        </a>
      </div>
    </div>
  );
}

/**
 * A household link is a trigger, not a result.
 *
 * Netflix's household mail does not carry the code. It carries a `travel/verify`
 * link, and the code only exists after someone opens it -- either on the page
 * that opens, or in a second email. The panel used to label it "Link household"
 * and stop there, which reads as a finished answer. A reseller who treats it as
 * one sends the customer a link and calls the ticket closed, and the code never
 * arrives for either of them.
 *
 * The server never opens this link. It cannot be probed for "still valid"
 * without spending it -- a spent link degrades to an inactive page rather than
 * failing, so there is no way to ask without consuming. So the wording has to
 * do the work the server cannot.
 */
function HouseholdLinkValue({ value }: { value: string }) {
  return (
    <>
      <LinkValue label="Link household" value={value} />
      <p className="reseller-v2-access-next-step">
        Link ini belum berisi kode. Pelanggan harus membukanya lebih dulu; setelah
        itu kode households-nya muncul di halaman tersebut atau di email lanjutan.
        Tekan Cari Akun lagi untuk mengambilnya.
      </p>
    </>
  );
}

export default function ResellerV2AccessPage() {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [reseller, setReseller] = useState<ApiReseller | null>(null);
  const [lookup, setLookup] = useState("");
  const [activeSource, setActiveSource] = useState<AccessSource>("netflix");
  const [activeTool, setActiveTool] = useState<AccessTool>("signin");
  const [lookupResult, setLookupResult] = useState<AccountAccessLookupResult | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [accountsState, setAccountsState] = useState<"loading" | "success" | "error">("loading");
  const [accountsError, setAccountsError] = useState("");
  const [lastRefresh, setLastRefresh] = useState("");
  const lookupRequestRef = useRef(0);

  const loadAccounts = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setAccountsState("loading");
    try {
      const [accountRows, resellerRows] = await Promise.all([
        api.accounts({ view: "light" }),
        api.resellers(),
      ]);
      setAccounts(accountRows);
      setReseller(resellerRows[0] || null);
      setAccountsError("");
      setAccountsState("success");
      setLastRefresh(new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch {
      if (!options.silent) {
        setAccountsError("Daftar akun belum dapat dimuat. Periksa koneksi lalu coba lagi.");
        setAccountsState("error");
      }
    }
  }, []);

  const netflixAccounts = useMemo(() => accounts.filter(isNetflixAccount), [accounts]);
  const disneyAccounts = useMemo(() => accounts.filter(isDisneyAccount), [accounts]);
  const netflixGroups = useMemo(() => groupAccounts(netflixAccounts, "netflix"), [netflixAccounts]);
  const disneyGroups = useMemo(() => groupAccounts(disneyAccounts, "disney"), [disneyAccounts]);

  const netflixAllowedTools = useMemo(() => {
    const fallback: Array<"signin" | "verification" | "reset" | "household"> = ["signin", "verification", "household"];
    const source = Array.isArray(reseller?.allowedAccessTools) ? reseller.allowedAccessTools : fallback;
    return netflixTools.filter((tool) => source.includes(tool.id as "signin" | "verification" | "reset" | "household"));
  }, [reseller]);

  const disneyAllowedTools = useMemo(() => (
    netflixAllowedTools.some((tool) => tool.id === "signin") ? disneyTools : []
  ), [netflixAllowedTools]);

  const currentGroups = activeSource === "disney" ? disneyGroups : netflixGroups;
  const currentTools = activeSource === "disney" ? disneyAllowedTools : netflixAllowedTools;
  const currentLookupLabel = activeSource === "disney" ? "Nomor Aktif" : "Email Aktif";
  const currentInactiveLabel = activeSource === "disney" ? "Nomor Non-Aktif" : "Email Non-Aktif";

  const activeCount = currentGroups.filter((group) => !isExpiredAccount(group.primary)).length;
  const inactiveCount = Math.max(0, currentGroups.length - activeCount);
  /* Counted over `accounts`, not over `currentGroups`. `currentGroups` is the
     Netflix tab or the Disney tab, so counting it would make the pill mean
     something different depending on which tab the reseller last opened -- the
     same number changing because a different filter is applied. */
  const accessAttention = accounts.filter((account) => isExpiredAccount(account)).length;
  const lookupToolLabel = currentTools.find((tool) => tool.id === activeTool)?.label || "Lookup";

  const runLookup = useCallback(async (payload: { target: string; type: AccessTool }, options: { silent?: boolean } = {}) => {
    const requestId = lookupRequestRef.current + 1;
    lookupRequestRef.current = requestId;
    if (!options.silent) setLookupLoading(true);
    try {
      const result = await api.lookupAccountAccess({ target: payload.target, type: payload.type, silent: Boolean(options.silent) });
      if (requestId !== lookupRequestRef.current) return;
      setLookupResult(result);
      setLookupError("");
    } catch (error) {
      if (requestId !== lookupRequestRef.current) return;
      setLookupResult(null);
      if (!options.silent) {
        setLookupError(error instanceof Error ? error.message : "Lookup gagal");
      }
    } finally {
      if (!options.silent && requestId === lookupRequestRef.current) setLookupLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts().catch(() => undefined);
    const unsubscribe = subscribeRealtime(() => {
      loadAccounts({ silent: true }).catch(() => undefined);
    });
    return () => {
      unsubscribe();
    };
  }, [loadAccounts]);

  useEffect(() => {
    if (!currentTools.length) {
      if (activeTool !== "signin" && activeTool !== "disney_otp") setActiveTool("signin");
      setLookupResult(null);
      setLookupError("");
      return;
    }
    if (currentTools.some((tool) => tool.id === activeTool)) return;
    setActiveTool(currentTools[0].id);
    setLookupResult(null);
    setLookupError("");
  }, [activeTool, currentTools]);

  function clearResult() {
    lookupRequestRef.current += 1;
    setLookupLoading(false);
    setLookupResult(null);
    setLookupError("");
  }

  function changeAccessSource(source: AccessSource) {
    lookupRequestRef.current += 1;
    setActiveSource(source);
    setActiveTool(source === "disney" ? "disney_otp" : "signin");
    setLookup("");
    setLookupResult(null);
    setLookupError("");
    setLookupLoading(false);
  }

  function accountForTarget(target: string) {
    if (activeSource === "disney") {
      const normalized = normalizePhone(target);
      const matched = disneyAccounts.filter((account) => normalizePhone(account.loginPhone || account.email || "") === normalized);
      return matched.find((account) => !isExpiredAccount(account)) || matched[0] || null;
    }
    const normalized = normalizeEmail(target);
    const matched = netflixAccounts.filter((account) => normalizeEmail(account.email) === normalized);
    return matched.find((account) => !isExpiredAccount(account)) || matched[0] || null;
  }

  function submitLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = activeSource === "disney" ? normalizePhone(lookup) : normalizeEmail(lookup);
    if (!target) {
      setLookupError(activeSource === "disney" ? "Nomor login Disney wajib diisi" : "Email akun wajib diisi");
      return;
    }
    const selectedAccount = accountForTarget(target);
    if (isExpiredAccount(selectedAccount)) {
      setLookupResult(null);
      setLookupError(inactiveLookupMessage(selectedAccount));
      return;
    }
    runLookup({ target, type: activeTool }).catch(() => undefined);
  }

  const typedAccount = lookup.trim() ? accountForTarget(lookup) : null;
  const lookupDisabled = !currentTools.length || Boolean(typedAccount && isExpiredAccount(typedAccount));
  const sourceLabel = activeSource === "disney" ? "Nomor yang Tersedia" : "Email yang Tersedia";
  const sourceHint = activeSource === "disney"
    ? "Klik nomor login Disney untuk mengisi kolom pencarian, lalu klik Cari Akun."
    : "Klik email untuk mengisi kolom pencarian, lalu klik Cari Akun.";
  const sourceRefreshText = activeSource === "disney"
    ? `Tersedia ${currentGroups.length} nomor Disney untuk akses OTP.`
    : `Tersedia ${currentGroups.length} email Netflix untuk akses bantuan.`;

  function renderResult() {
    if (!lookupResult) return null;
    const value = String(lookupResult.result.value || "").trim();
    const activeToolConfig = allTools.find((tool) => tool.id === lookupResult.type) || netflixTools[0];
    const ToolIcon = activeToolConfig.icon;
    const source = sourceText(lookupResult);
    const targetLabel = lookupResult.type === "disney_otp"
      ? (lookupResult.account.loginPhone || lookupResult.account.email)
      : lookupResult.account.email;
    const stale = staleNotice(lookupResult);
    const detail = stale?.description || lookupResult.result.error || (lookupResult.result.reason === "not_found"
      ? lookupResult.type === "disney_otp"
        ? "Nomor ditemukan, tapi Disney OTP terbaru belum ada di label Gmail owner."
        : "Email ditemukan, tetapi pesan/kode terbaru belum masuk ke Gmail owner. Coba lagi setelah email diterima."
      : source);
    const active = accountActiveBadge(lookupResult.account);

    return (
      <>
        <section className="reseller-v2-panel reseller-v2-access-result-head">
          <div className="reseller-v2-access-result-identity">
            <span aria-hidden="true"><ShieldCheck size={18} /></span>
            <div>
              <strong>{targetLabel}</strong>
              <small>{[lookupResult.account.product, lookupResult.account.variant].filter(Boolean).join(" - ")}</small>
            </div>
          </div>
          <Badge tone={active.tone}>{active.label}</Badge>
          <p>
            Lookup manual dari label Gmail. Klik Cari Akun untuk membaca email terbaru. Update akun terakhir: {lastRefresh || lookupResult.refreshedAt}
          </p>
        </section>

        <section className="reseller-v2-panel reseller-v2-access-result">
          <header>
            <span aria-hidden="true"><ToolIcon size={17} /></span>
            <h2>{toolLabel(lookupResult.type)}</h2>
          </header>
          {value ? (
            <div className="reseller-v2-access-result-body">
              {lookupResult.result.kind === "link" && isUrl(value) ? (
                lookupResult.type === "household" ? (
                  <HouseholdLinkValue value={value} />
                ) : (
                  <LinkValue label={lookupResult.result.label || valueLabel(lookupResult.type)} value={value} />
                )
              ) : (
                <CodeValue label={lookupResult.result.label || valueLabel(lookupResult.type)} value={value} />
              )}
              <p>{source}</p>
              {lookupResult.result.date ? (
                <dl className="ui-detail-list reseller-v2-access-meta">
                  <DetailRow label="Email date (WIB)">
                    {formatEmailDateWib(lookupResult.result.date, lookupResult.result.internalDate)}
                  </DetailRow>
                </dl>
              ) : null}
            </div>
          ) : (
            <div className="reseller-v2-access-result-body">
              <EmptyState
                title={stale?.title || (lookupResult.result.error ? "Lookup tidak bisa diselesaikan" : emptyText(lookupResult.type))}
                description={detail}
              />
            </div>
          )}
        </section>
      </>
    );
  }

  return (
    <ResellerShell
      title="Akses & Kode"
      description="Ambil kode masuk, kode verifikasi, reset password, household, dan OTP Disney dari label Gmail owner tanpa membuka email owner."
      attentionCount={accessAttention}
      systemState={systemStateFor(accessAttention, { error: accountsState === "error", loading: accountsState === "loading" })}
    >
      <MetricRow
        label="Ringkasan akses"
        items={[
          {
            label: currentLookupLabel,
            value: activeCount,
            icon: activeSource === "disney" ? <Smartphone size={16} /> : <MailCheck size={16} />,
            tone: "success",
            hint: "Masih bisa dipakai untuk lookup",
            loading: accountsState === "loading",
          },
          {
            label: currentInactiveLabel,
            value: inactiveCount,
            icon: activeSource === "disney" ? <Smartphone size={16} /> : <MailX size={16} />,
            tone: "danger",
            hint: "Sudah expired atau nonaktif",
            loading: accountsState === "loading",
          },
          {
            label: "Tool Dipilih",
            value: currentTools.length ? lookupToolLabel : "Dikunci Owner",
            icon: <KeyRound size={16} />,
            tone: "info",
            hint: currentTools.length ? "Mode lookup yang sedang aktif" : "Owner belum memberi akses tool",
          },
        ]}
      />

      <div className="reseller-v2-access-source" role="tablist" aria-label="Penyedia akses">
        {(["netflix", "disney"] as const).map((source) => (
          <button
            key={source}
            type="button"
            role="tab"
            aria-selected={activeSource === source}
            className={activeSource === source ? "is-active" : ""}
            onClick={() => changeAccessSource(source)}
          >
            {source === "disney" ? <Smartphone size={15} aria-hidden="true" /> : <Mail size={15} aria-hidden="true" />}
            {source === "disney" ? "Disney" : "Netflix"}
          </button>
        ))}
      </div>

      <Notice tone="warning">
        <Clock size={16} />
        <div>
          <strong>{activeSource === "disney" ? "Disney OTP 15 menit" : "Kode 15 menit, link 24 jam"}</strong>
          <p>
            {activeSource === "disney"
              ? "Mode Disney membaca label Gmail khusus DISNEY_CODE. Reseller cukup pakai nomor login Disney; email OTP owner tetap disembunyikan dari panel reseller."
              : "Mode Netflix membaca label Gmail khusus NF_SIGNIN, NF_VERIF, NF_RESET, dan NF_HOUSE. Lookup dilakukan manual saat tombol Cari Akun ditekan."}
          </p>
        </div>
      </Notice>

      <section className="reseller-v2-access-workbench">
        <div className="reseller-v2-access-tools" role="tablist" aria-label="Tool lookup">
          {currentTools.map((tool) => {
            const ToolIcon = tool.icon;
            return (
              <button
                key={tool.id}
                type="button"
                role="tab"
                aria-selected={activeTool === tool.id}
                className={activeTool === tool.id ? "is-active" : ""}
                onClick={() => {
                  setActiveTool(tool.id);
                  clearResult();
                }}
              >
                <span><ToolIcon size={15} aria-hidden="true" />{tool.label}</span>
                <small>{tool.hint}</small>
              </button>
            );
          })}
        </div>

        {!currentTools.length ? (
          <Notice tone="warning">
            <Info size={16} />
            <span>Owner belum mengaktifkan akses tool untuk mode {activeSource === "disney" ? "Disney" : "Netflix"} di akun reseller ini.</span>
          </Notice>
        ) : null}

        <form className="reseller-v2-access-form" onSubmit={submitLookup}>
          <Field
            label={activeSource === "disney" ? "Nomor login Disney" : "Email akun"}
          >
            <input
              value={lookup}
              onChange={(event) => {
                setLookup(event.target.value);
                clearResult();
              }}
              placeholder={activeSource === "disney" ? "Masukkan nomor login Disney" : "Masukkan email akun"}
            />
          </Field>
          <button type="submit" className="reseller-v2-access-submit" disabled={lookupLoading || lookupDisabled}>
            {lookupLoading ? <LoaderCircle size={16} className="reseller-v2-access-spin" aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
            {lookupLoading ? "Mencari..." : "Cari Akun"}
          </button>
        </form>
      </section>

      {accountsState === "loading" ? (
        <LoadingState label={`Memuat akun ${activeSource === "disney" ? "Disney" : "Netflix"}...`} />
      ) : null}

      {accountsState === "error" ? (
        <ErrorState message={accountsError} onRetry={() => { loadAccounts().catch(() => undefined); }} />
      ) : null}

      {accountsState === "success" && currentGroups.length ? (
        <p className="reseller-v2-access-freshness" role="status">
          {sourceRefreshText} Refresh terakhir <strong>{lastRefresh || "-"}</strong>.
        </p>
      ) : null}

      {lookupError ? <Notice tone="danger"><CircleAlert size={16} /><span>{lookupError}</span></Notice> : null}

      {lookupLoading ? <LoadingSkeleton lines={2} /> : null}

      {renderResult()}

      <section className="reseller-v2-panel reseller-v2-access-list">
        <header>
          <h2>{sourceLabel}</h2>
          <p>{sourceHint}</p>
        </header>
        {accountsState === "success" && currentGroups.length ? (
          <div>
            {currentGroups.map((group) => {
              const status = accountStatusBadge(group.primary);
              return (
                <button
                  key={group.key}
                  type="button"
                  className={isExpiredAccount(group.primary) ? "is-muted" : ""}
                  onClick={() => {
                    setLookup(group.label);
                    clearResult();
                    if (isExpiredAccount(group.primary)) {
                      setLookupError(inactiveLookupMessage(group.primary));
                    }
                  }}
                >
                  <span className="reseller-v2-access-list-icon" aria-hidden="true">
                    {activeSource === "disney" ? <Smartphone size={15} /> : <Mail size={15} />}
                  </span>
                  <div>
                    <strong>{group.label}</strong>
                    <small>{groupDescription(group, activeSource)}</small>
                  </div>
                  <Badge tone={status.tone}>{status.label}</Badge>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        ) : null}
        {accountsState === "success" && !currentGroups.length ? (
          <EmptyState
            title={`Belum ada ${activeSource === "disney" ? "nomor Disney" : "email Netflix"} yang bisa diakses.`}
            description={sourceHint}
          />
        ) : null}
        {accountsState === "loading" ? <div className="reseller-v2-access-list-loading"><LoadingSkeleton lines={4} /></div> : null}
      </section>
    </ResellerShell>
  );
}
