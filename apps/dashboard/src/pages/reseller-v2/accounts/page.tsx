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
import { ResellerShell } from "../../../components/reseller-v2/ResellerShell";
import { systemStateFor } from "../../../components/attention";
import {
  normalizeResellerAccountStatus,
  resellerAccountStatusLabel,
  summarizeResellerAccounts,
} from "../../../lib/resellerAccounts";
import { useSearchParams } from "react-router-dom";
import { Badge, Drawer, EmptyState, ErrorState, LoadingSkeleton } from "../../../components/ui";

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

/**
 * The two account rows a warranty replacement leaves behind, and which one
 * this is.
 *
 * The condition badge above cannot cover this case, and it is worth being exact
 * about why: `accountCondition: "REPLACED"` is written to the *stock* row
 * (warranty-service.js:645), never to the managed account. The managed account
 * only gets `status = "replaced"`, which `normalizeResellerAccountStatus` folds
 * into `inactive` (resellerAccounts.ts:85) -- so the old row used to land under
 * "Kadaluarsa" wearing a "Tidak Aktif" pill and nothing else, while the new row
 * appeared as an ordinary active account.
 *
 * Both rows are in `accounts`, so resolving the other one is a find, not a
 * fetch. It is passed in rather than closed over so the helper stays pure.
 */
function accountReplacementBadge(account: ApiAccount, accounts: ApiAccount[]) {
  if (account.replacementOfAccountId) {
    const replaced = accounts.find((item) => item.id === account.replacementOfAccountId) || null;
    return {
      label: "Pengganti",
      tone: "success" as const,
      // "Menggantikan" -- this account is the fix for that one.
      relation: "replaces" as const,
      related: replaced,
      at: account.replacementCreatedAt || "",
      // The reason is stamped on the row that failed, not the row that fixed
      // it, so it has to be read off `replaced` or it is always empty.
      reason: replaced?.replacementReason || "",
    };
  }
  if (account.replacedByAccountId) {
    const successor = accounts.find((item) => item.id === account.replacedByAccountId) || null;
    return {
      label: "Diganti",
      tone: "muted" as const,
      relation: "replacedBy" as const,
      related: successor,
      at: account.replacedAt || "",
      reason: account.replacementReason || "",
    };
  }
  return null;
}

/**
 * How to name the other row of a replacement.
 *
 * The identity of a replaced account is deliberately blanked by the server --
 * `replaced` is terminal in `isTerminalManagedAccountStatus` (index.js:3064), so
 * `redactExpiredAccountSecrets` (account-routes.js:112) empties its email and
 * loginPhone, and `accountIdentity` falls through to "-". Falling back to that
 * would render a confident, empty "Menggantikan akun -". So when the identity
 * is gone, the order and the expiry say which account it was instead.
 */
function relatedAccountLabel(account: ApiAccount | null) {
  if (!account) return "akun sebelumnya tidak ada di daftar ini";
  const identity = accountIdentity(account);
  if (identity !== "-") return identity;
  const order = account.orderId || account.sourceOrderId;
  if (order) return `akun lama untuk pesanan ${order}`;
  if (account.expiresAt) return `akun lama (berlaku sampai ${dateTime(account.expiresAt)})`;
  return "akun lama";
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
  /* `summarizeResellerAccounts` already partitions the list by status, so both
     halves of the answer come from one pass. Expiring and expired are in;
     `inactive` is not -- an inactive account was switched off deliberately,
     and counting it would put a permanently amber pill on a healthy panel. */
  const accountsAttention = accountSummary.expiring + accountSummary.expired;
  const selectedCondition = selected ? accountConditionBadge(selected) : null;
  const selectedReplacement = selected ? accountReplacementBadge(selected, accounts) : null;
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
      attentionCount={accountsAttention}
      systemState={systemStateFor(accountsAttention, { error: Boolean(error), loading })}
      onRefresh={() => load({ refreshSheets: true })}
    >
      {error ? <ErrorState message={error} onRetry={load} /> : null}
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
            <LoadingSkeleton lines={5} />
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
              const replacement = accountReplacementBadge(account, accounts);
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
                    <Badge tone={status.tone}>
                      {status.label}
                    </Badge>
                    {condition ? <Badge tone={condition.tone}>{condition.label}</Badge> : null}
                    {replacement ? <Badge tone={replacement.tone}>{replacement.label}</Badge> : null}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="Akun tidak ditemukan"
            description={
              query
                ? "Coba gunakan kata pencarian lain."
                : "Akun yang Anda peroleh akan tampil di sini."
            }
          />
        )}
      </section> : null}
      <Drawer
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
            {deliveryLoading ? <LoadingSkeleton lines={4} /> : null}
            {deliveryError ? <ErrorState message={deliveryError} onRetry={() => openDetail(selected, detailTab)} /> : null}
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
                <dd><Badge tone={selectedCondition.tone}>{selectedCondition.label}</Badge></dd>
              </div> : null}
              {/*
                The three questions a replacement raises, answered in the order
                they are asked: which account, since when, and why.

                Without this the WhatsApp message is the only place any of it
                exists, and it names the successor without naming the failure --
                so a reseller holding several accounts of the same product has
                no way to tell which dead row this new one belongs to.
              */}
              {selectedReplacement ? <>
                <div>
                  <dt>{selectedReplacement.relation === "replaces" ? "Menggantikan" : "Diganti oleh"}</dt>
                  <dd>
                    {selectedReplacement.relation === "replaces"
                      ? relatedAccountLabel(selectedReplacement.related)
                      : selectedReplacement.related
                        ? `${accountIdentity(selectedReplacement.related)} (${selectedReplacement.related.product}${selectedReplacement.related.variant ? ` - ${selectedReplacement.related.variant}` : ""})`
                        : "akun pengganti tidak ada di daftar ini"}
                  </dd>
                </div>
                {selectedReplacement.at ? <div>
                  <dt>Waktu penggantian</dt>
                  <dd>{dateTime(selectedReplacement.at)}</dd>
                </div> : null}
                {selectedReplacement.reason ? <div>
                  <dt>Alasan penggantian</dt>
                  <dd>{selectedReplacement.reason}</dd>
                </div> : null}
              </> : null}
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
                <EmptyState title="Akses credential sudah berakhir" description="Akun ini sudah expired atau tidak aktif, jadi password/PIN tidak lagi ditampilkan." />
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
                  <ErrorState message="Detail akun belum lengkap. Owner perlu melengkapi field pengiriman sebelum template dapat digunakan." />
                ) : (
                  <EmptyState title="Template belum tersedia" description="Owner belum mengonfigurasi template pengiriman untuk varian ini." />
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </ResellerShell>
  );
}
