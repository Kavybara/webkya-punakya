import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  Copy,
  Eye,
  EyeOff,
  PackageCheck,
  Search,
  XCircle,
} from "lucide-react";
import { api, type AccountDeliveryDetail, type ApiAccount } from "../../../lib/api";
import {
  ResellerDetailDrawer,
  ResellerEmptyState,
  ResellerErrorState,
  ResellerLoadingSkeleton,
  ResellerStatusBadge,
} from "../../../components/reseller-v2/ResellerResource";
import { ResellerShell } from "../../../components/reseller-v2/ResellerShell";
import {
  normalizeResellerAccountStatus,
  resellerAccountStatusLabel,
  summarizeResellerAccounts,
} from "../../../lib/resellerAccounts";
import { useSearchParams } from "react-router-dom";

export const MASK_AFTER_MS = 60_000;
type AccountView = "usable" | "expired" | "all";

function dateTime(value?: string) {
  if (!value) return "-";
  const parsed = new Date(value.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function accountIdentity(account: ApiAccount) {
  return account.loginPhone || account.email || "-";
}

function accountStatus(account: ApiAccount) {
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

function accountConditionBadge(account: ApiAccount) {
  if (account.accountConditionKnown === false) {
    return { label: "Perlu diperiksa", tone: "danger" as const };
  }
  const condition = String(account.accountCondition || "NORMAL").trim().toUpperCase();
  if (condition === "BERMASALAH") return { label: "Bermasalah", tone: "danger" as const };
  if (condition === "DIPERIKSA") return { label: "Sedang diperiksa", tone: "warning" as const };
  if (condition === "REPLACED") return { label: "Sudah diganti", tone: "muted" as const };
  if (condition === "DISABLED") return { label: "Dinonaktifkan", tone: "danger" as const };
  return null;
}

function accountAllowsCredentialAccess(account: ApiAccount) {
  return ["active", "expiring"].includes(normalizeResellerAccountStatus(account));
}

function accountSortValue(account: ApiAccount) {
  const parsed = account.expiresAt ? new Date(account.expiresAt.replace(" ", "T")).getTime() : Number.MAX_SAFE_INTEGER;
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function sortAccountsForResellerView(accounts: ApiAccount[]) {
  const rank = { expiring: 0, active: 1, expired: 2, inactive: 3 } as const;
  return [...accounts].sort((left, right) => {
    const leftStatus = normalizeResellerAccountStatus(left);
    const rightStatus = normalizeResellerAccountStatus(right);
    if (rank[leftStatus] !== rank[rightStatus]) return rank[leftStatus] - rank[rightStatus];
    return accountSortValue(left) - accountSortValue(right);
  });
}

function masked(value?: string) {
  if (!value) return "-";
  return "*".repeat(Math.max(8, Math.min(14, value.length)));
}

function CredentialRow({
  label,
  value,
  visible,
  onToggle,
}: {
  label: string;
  value?: string;
  visible: boolean;
  onToggle: () => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="reseller-v2-credential-row">
      <div>
        <span>{label}</span>
        <code>{visible ? value || "-" : masked(value)}</code>
      </div>
      <div>
        <button type="button" onClick={onToggle} disabled={!value}>
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
          {visible ? "Sembunyikan" : "Tampilkan"}
        </button>
        <button
          type="button"
          onClick={() => copy().catch(() => undefined)}
          disabled={!value}
        >
          <Copy size={15} />
          {copied ? "Tersalin" : "Salin"}
        </button>
      </div>
    </div>
  );
}

export default function ResellerV2AccountsPage() {
  const [searchParams] = useSearchParams();
  const autoOpenedRef = useRef("");
  const [accounts, setAccounts] = useState<ApiAccount[]>([]);
  const [selected, setSelected] = useState<ApiAccount | null>(null);
  const [query, setQuery] = useState("");
  const [accountView, setAccountView] = useState<AccountView>("usable");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [credentialVisible, setCredentialVisible] = useState(false);
  const [updatedAt, setUpdatedAt] = useState("");
  const [isFreshSync, setIsFreshSync] = useState(false);
  const [deliveryDetail, setDeliveryDetail] = useState<AccountDeliveryDetail | null>(null);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliveryError, setDeliveryError] = useState("");
  const [detailTab, setDetailTab] = useState<"account" | "template">("account");
  const [templateCopied, setTemplateCopied] = useState(false);

  const load = useCallback(async (options: { refreshSheets?: boolean } = {}) => {
    setLoading(true);
    setError("");
    try {
      const rows = await api.accounts({ view: options.refreshSheets ? "full" : "light" });
      setAccounts(rows);
      setUpdatedAt(new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()));
      setIsFreshSync(Boolean(options.refreshSheets));
    } catch {
      setError("Akun belum dapat dimuat. Periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load({ refreshSheets: false }).catch(() => undefined);
  }, [load]);
  useEffect(() => {
    if (!credentialVisible) return;
    const timer = window.setTimeout(
      () => setCredentialVisible(false),
      MASK_AFTER_MS,
    );
    return () => window.clearTimeout(timer);
  }, [credentialVisible]);

  const closeDetail = useCallback(() => {
    setCredentialVisible(false);
    setSelected(null);
    setDeliveryDetail(null);
    setDeliveryError("");
    setDetailTab("account");
  }, []);
  const openDetail = useCallback(async (account: ApiAccount, tab: "account" | "template" = "account") => {
    setCredentialVisible(false);
    setSelected(account);
    setDetailTab(tab);
    setDeliveryLoading(true);
    setDeliveryError("");
    setDeliveryDetail(null);
    try {
      const detail = await api.accountDelivery(account.id);
      setDeliveryDetail(detail);
      api.markAccountDeliveryOpened(account.id).catch(() => undefined);
      setAccounts((current) => current.map((item) => item.id === account.id
        ? { ...item, deliveryTemplateUnreadAt: "", deliveryTemplateOpenedAt: new Date().toISOString() }
        : item));
    } catch {
      setDeliveryError("Detail pengiriman belum dapat dimuat. Coba lagi.");
    } finally {
      setDeliveryLoading(false);
    }
  }, []);
  async function copyTemplate() {
    const text = deliveryDetail?.deliveryTemplateSnapshot?.renderedText || "";
    if (!selected || !text) return;
    await navigator.clipboard.writeText(text);
    setTemplateCopied(true);
    api.recordDeliveryTemplateCopied(selected.id).catch(() => undefined);
    window.setTimeout(() => setTemplateCopied(false), 1800);
  }
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sortAccountsForResellerView(accounts).filter((account) => {
      const status = normalizeResellerAccountStatus(account);
      const matchesView = accountView === "all"
        || (accountView === "usable" && ["active", "expiring"].includes(status))
        || (accountView === "expired" && ["expired", "inactive"].includes(status));
      if (!matchesView) return false;
      if (!needle) return true;
      return `${account.product} ${account.variant || ""} ${accountIdentity(account)} ${account.profile || ""} ${account.orderId || account.sourceOrderId || ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [accounts, accountView, query]);
  const accountSummary = useMemo(
    () => summarizeResellerAccounts(accounts),
    [accounts],
  );
  const selectedCondition = selected ? accountConditionBadge(selected) : null;
  useEffect(() => {
    const accountId = searchParams.get("account") || "";
    if (!accountId || loading || autoOpenedRef.current === accountId) return;
    const account = accounts.find((item) => item.id === accountId);
    if (!account) return;
    autoOpenedRef.current = accountId;
    openDetail(account, searchParams.get("tab") === "template" ? "template" : "account").catch(() => undefined);
  }, [accounts, loading, openDetail, searchParams]);

  return (
    <ResellerShell
      title="Akun Saya"
      description="Lihat akun yang Anda miliki dan buka credential saat diperlukan."
      loading={loading}
      onRefresh={() => load({ refreshSheets: true })}
    >
      {error ? <ResellerErrorState message={error} onRetry={load} /> : null}
      <section
        className="reseller-v2-account-summary"
        aria-label="Ringkasan akun"
      >
        <article>
          <PackageCheck size={18} />
          <span>Akun aktif</span>
          <strong>{loading ? "-" : accountSummary.active}</strong>
        </article>
        <article>
          <CalendarClock size={18} />
          <span>Hampir berakhir</span>
          <strong>{loading ? "-" : accountSummary.expiring}</strong>
        </article>
        <article>
          <XCircle size={18} />
          <span>Kadaluarsa</span>
          <strong>{loading ? "-" : accountSummary.expired + accountSummary.inactive}</strong>
        </article>
        <article>
          <span>Total akun</span>
          <strong>{loading ? "-" : accountSummary.total}</strong>
        </article>
      </section>
      <p className="reseller-v2-accounts-freshness" role="status">
        {isFreshSync
          ? `Google Sheets diperbarui ${updatedAt || "baru saja"}.`
          : `Menampilkan snapshot sinkronisasi terakhir${updatedAt ? `, dimuat ${updatedAt}` : ""}. Klik Perbarui untuk sinkronisasi Google Sheets terbaru.`}
      </p>
      {!error ? <section className="reseller-v2-panel reseller-v2-accounts-panel">
        <div className="reseller-v2-accounts-toolbar">
          <label>
            <Search size={17} />
            <span className="sr-only">Cari akun</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari produk, identitas, profil, atau nomor pesanan"
            />
          </label>
          <div className="reseller-v2-account-view-tabs" role="tablist" aria-label="Filter status akun">
            <button
              type="button"
              role="tab"
              aria-selected={accountView === "usable"}
              className={accountView === "usable" ? "is-active" : ""}
              onClick={() => setAccountView("usable")}
            >
              Aktif & Hampir Berakhir
              <span>{accountSummary.active + accountSummary.expiring}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={accountView === "expired"}
              className={accountView === "expired" ? "is-active" : ""}
              onClick={() => setAccountView("expired")}
            >
              Kadaluarsa
              <span>{accountSummary.expired + accountSummary.inactive}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={accountView === "all"}
              className={accountView === "all" ? "is-active" : ""}
              onClick={() => setAccountView("all")}
            >
              Semua
              <span>{accountSummary.total}</span>
            </button>
          </div>
        </div>
        {loading ? (
          <div className="reseller-v2-accounts-loading">
            <ResellerLoadingSkeleton lines={5} />
          </div>
        ) : filtered.length ? (
          <div className="reseller-v2-account-list">
            <div className="reseller-v2-account-list-head" aria-hidden="true">
              <span>Produk</span>
              <span>Identitas</span>
              <span>Profil</span>
              <span>Masa aktif</span>
              <span>Status</span>
            </div>
            {filtered.map((account) => {
              const status = accountStatus(account);
              const condition = accountConditionBadge(account);
              return (
                <button
                  type="button"
                  key={account.id}
                  onClick={() => openDetail(account)}
                >
                  <div>
                    <strong>{account.product} {account.deliveryTemplateUnreadAt && !account.deliveryTemplateOpenedAt ? <em className="reseller-v2-new-badge">Baru</em> : null}</strong>
                    <small>{account.variant || "Paket akun"}</small>
                  </div>
                  <span data-label="Identitas">{accountIdentity(account)}</span>
                  <span data-label="Profil">{account.profile || "Tanpa profil"}</span>
                  <span data-label="Masa aktif">
                    {account.expiresAt ? dateTime(account.expiresAt) : "-"}
                  </span>
                  <div className="reseller-v2-account-badges">
                    <ResellerStatusBadge tone={status.tone}>
                      {status.label}
                    </ResellerStatusBadge>
                    {condition ? <ResellerStatusBadge tone={condition.tone}>{condition.label}</ResellerStatusBadge> : null}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <ResellerEmptyState
            title="Akun tidak ditemukan"
            description={
              query
                ? "Coba gunakan kata pencarian lain."
                : "Akun yang Anda peroleh akan tampil di sini."
            }
          />
        )}
      </section> : null}
      <ResellerDetailDrawer
        open={Boolean(selected)}
        title="Detail Akun"
        description="Credential hanya ditampilkan sementara dan kembali dimasking setelah 60 detik."
        onClose={closeDetail}
      >
        {selected ? (
          <div className="reseller-v2-account-detail">
            <div className="reseller-v2-detail-tabs" role="tablist" aria-label="Detail akun dan template">
              <button type="button" role="tab" aria-selected={detailTab === "account"} className={detailTab === "account" ? "is-active" : ""} onClick={() => setDetailTab("account")}>Detail Akun</button>
              <button type="button" role="tab" aria-selected={detailTab === "template"} className={detailTab === "template" ? "is-active" : ""} onClick={() => setDetailTab("template")}>Template Siap Kirim</button>
            </div>
            {deliveryLoading ? <ResellerLoadingSkeleton lines={4} /> : null}
            {deliveryError ? <ResellerErrorState message={deliveryError} onRetry={() => openDetail(selected, detailTab)} /> : null}
            {!deliveryLoading && !deliveryError && detailTab === "account" ? <>
            <dl>
              <div>
                <dt>Produk</dt>
                <dd>{selected.product}</dd>
              </div>
              <div>
                <dt>Nomor pesanan</dt>
                <dd>{selected.orderId || selected.sourceOrderId || "-"}</dd>
              </div>
              <div>
                <dt>Identitas</dt>
                <dd>{deliveryDetail?.account.loginPhone || deliveryDetail?.account.email || accountIdentity(selected)}</dd>
              </div>
              <div>
                <dt>Profil</dt>
                <dd>{deliveryDetail?.account.profile || selected.profile || "-"}</dd>
              </div>
              <div>
                <dt>Tanggal pembelian</dt>
                <dd>{dateTime(selected.startedAt)}</dd>
              </div>
              <div>
                <dt>Masa aktif sampai</dt>
                <dd>{dateTime(selected.expiresAt)}</dd>
              </div>
              {selectedCondition ? <div>
                <dt>Kondisi akun</dt>
                <dd><ResellerStatusBadge tone={selectedCondition.tone}>{selectedCondition.label}</ResellerStatusBadge></dd>
              </div> : null}
            </dl>
            <div className="reseller-v2-credential-block">
              <header>
                <div>
                  <span>Credential akun</span>
                  <strong>Terakhir diperbarui</strong>
                  <small>
                    {dateTime(
                      selected.googleSheetsSyncedAt ||
                        selected.snapshotAt ||
                        selected.startedAt,
                    )}
                  </small>
                </div>
              </header>
              {accountAllowsCredentialAccess(selected) ? (
                <>
                  <CredentialRow
                    label="Email / Nomor Login"
                    value={deliveryDetail?.account.loginPhone || deliveryDetail?.account.email || selected.loginPhone || selected.email}
                    visible={credentialVisible}
                    onToggle={() => setCredentialVisible((value) => !value)}
                  />
                  <CredentialRow
                    label="Password / Link"
                    value={deliveryDetail?.account.canvaLink || deliveryDetail?.account.password || selected.canvaLink || selected.password}
                    visible={credentialVisible}
                    onToggle={() => setCredentialVisible((value) => !value)}
                  />
                  <CredentialRow
                    label="Profil"
                    value={deliveryDetail?.account.profile || selected.profile}
                    visible={credentialVisible}
                    onToggle={() => setCredentialVisible((value) => !value)}
                  />
                  <CredentialRow
                    label="PIN"
                    value={deliveryDetail?.account.pin || selected.pin}
                    visible={credentialVisible}
                    onToggle={() => setCredentialVisible((value) => !value)}
                  />
                  <p>
                    Credential mengikuti data terbaru milik akun Anda. Jangan
                    bagikan kepada pihak lain.
                  </p>
                </>
              ) : (
                <ResellerEmptyState title="Akses credential sudah berakhir" description="Akun ini sudah expired atau tidak aktif, jadi password/PIN tidak lagi ditampilkan." />
              )}
            </div>
            </> : null}
            {!deliveryLoading && !deliveryError && detailTab === "template" ? (
              <div className="reseller-v2-delivery-template">
                {deliveryDetail?.deliveryTemplateSnapshot?.status === "ready" && deliveryDetail.deliveryTemplateSnapshot.renderedText ? (
                  <>
                    <header>
                      <div><span>Siap dikirim ke customer</span><small>Template versi {deliveryDetail.deliveryTemplateSnapshot.templateVersion || 1}</small></div>
                      <button type="button" onClick={() => copyTemplate().catch(() => undefined)}><Copy size={15} /> {templateCopied ? "Template berhasil disalin" : "Salin Semua"}</button>
                    </header>
                    <pre>{deliveryDetail.deliveryTemplateSnapshot.renderedText}</pre>
                  </>
                ) : deliveryDetail?.deliveryTemplateSnapshot?.status === "incomplete" ? (
                  <ResellerErrorState message="Detail akun belum lengkap. Owner perlu melengkapi field pengiriman sebelum template dapat digunakan." />
                ) : (
                  <ResellerEmptyState title="Template belum tersedia" description="Owner belum mengonfigurasi template pengiriman untuk varian ini." />
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </ResellerDetailDrawer>
    </ResellerShell>
  );
}
