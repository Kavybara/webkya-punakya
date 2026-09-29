import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeHelp,
  BookOpenCheck,
  Clock3,
  Grid2X2,
  KeyRound,
  PackageCheck,
  ReceiptText,
  ShoppingBag,
  TimerReset,
  WalletCards,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import {
  api,
  subscribeRealtime,
  type ApiAccount,
  type ApiOrder,
  type ApiReseller,
} from "../../lib/api";
import { ResellerShell } from "../../components/reseller-v2/ResellerShell";
import {
  normalizeResellerAccountStatus,
  summarizeResellerAccounts,
} from "../../lib/resellerAccounts";
import { formatRupiah } from "../../lib/format";
import { ActionCard, Badge, EmptyState, ErrorState, LoadingSkeleton, Metric, maskIdentity } from "../../components/ui";

type OverviewData = {
  reseller: ApiReseller | null;
  orders: ApiOrder[];
  accounts: ApiAccount[];
};

function compactDate(value = "") {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value || "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function statusForOrder(order: ApiOrder) {
  if (order.orderStatus === "completed" || order.deliveryStatus === "sent")
    return { label: "Selesai", tone: "success" as const };
  if (
    order.orderStatus === "cancelled" ||
    order.deliveryStatus === "failed" ||
    order.qrisStatus === "expired"
  )
    return { label: "Gagal", tone: "danger" as const };
  if (order.qrisStatus === "pending")
    return { label: "Menunggu pembayaran", tone: "warning" as const };
  return { label: "Diproses", tone: "info" as const };
}

function isActiveOrder(order: ApiOrder) {
  return (
    !["completed", "cancelled"].includes(order.orderStatus) &&
    order.deliveryStatus !== "sent" &&
    order.qrisStatus !== "expired"
  );
}

export default function ResellerV2OverviewPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<OverviewData>({
    reseller: null,
    orders: [],
    accounts: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [resellers, orders, accounts] = await Promise.all([
        api.resellers(),
        api.orders(),
        api.accounts({ view: "overview" }),
      ]);
      setData({ reseller: resellers[0] || null, orders, accounts });
      setUpdatedAt(
        new Intl.DateTimeFormat("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date()),
      );
    } catch {
      setError("Ringkasan belum dapat dimuat. Periksa koneksi lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
    return subscribeRealtime(() => load().catch(() => undefined));
  }, [load]);

  const activeOrders = useMemo(
    () => data.orders.filter(isActiveOrder).slice(0, 3),
    [data.orders],
  );
  const accountSummary = useMemo(
    () => summarizeResellerAccounts(data.accounts),
    [data.accounts],
  );
  const expiringAccounts = useMemo(
    () =>
      data.accounts
        .filter((account) => normalizeResellerAccountStatus(account) === "expiring")
        .slice(0, 3),
    [data.accounts],
  );
  const recentOrders = useMemo(
    () =>
      [...data.orders]
        .sort(
          (left, right) =>
            new Date(right.createdAt).getTime() -
            new Date(left.createdAt).getTime(),
        )
        .slice(0, 7),
    [data.orders],
  );
  const unreadDeliveryAccounts = useMemo(
    () => data.accounts.filter((account) => (
      account.deliveryTemplateSnapshot?.status === "ready"
      && account.deliveryTemplateUnreadAt
      && !account.deliveryTemplateOpenedAt
    )),
    [data.accounts],
  );
  const balance = formatRupiah(Number(data.reseller?.deposit || 0));
  const greeting = data.reseller?.name || data.reseller?.username || "Reseller";

  return (
    <ResellerShell
      title="Ringkasan"
      description="Kelola saldo, pesanan, akun aktif, dan kebutuhan reseller dalam satu tempat."
      balance={loading ? undefined : balance}
      lastUpdated={updatedAt}
      loading={loading}
      onRefresh={load}
    >
      {({ openTopUp }) => (
        <>
          <div className="reseller-v2-greeting">
            <span>Halo, {greeting}</span>
            <p>Berikut kondisi akun reseller Anda saat ini.</p>
          </div>
          {!loading && unreadDeliveryAccounts.length ? (
            <section className="reseller-v2-purchase-banner" role="status">
              <div>
                <strong>Pembelian berhasil</strong>
                <span>
                  {unreadDeliveryAccounts.length === 1
                    ? `Akun ${unreadDeliveryAccounts[0].product} sudah masuk ke Akun Saya.`
                    : `${unreadDeliveryAccounts.length} akun baru sudah masuk ke Akun Saya.`}
                </span>
              </div>
              <Link to={`/reseller-v2/accounts?account=${encodeURIComponent(unreadDeliveryAccounts[0].id)}&tab=template`}>
                Lihat akun
              </Link>
            </section>
          ) : null}
          {error ? <ErrorState message={error} onRetry={load} /> : null}
          <section
            className="reseller-v2-summary-grid"
            aria-label="Ringkasan reseller"
          >
            {loading ? (
              Array.from({ length: 4 }, (_, index) => (
                <article className="reseller-v2-metric" key={index}>
                  <LoadingSkeleton lines={2} />
                </article>
              ))
            ) : (
              <>
                <Metric
                  label="Saldo tersedia"
                  value={balance}
                  hint="Siap digunakan"
                  icon={<WalletCards size={18} />}
                  tone="info"
                  onClick={() =>
                    document
                      .getElementById("saldo")
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                />
                <Metric
                  label="Pesanan aktif"
                  value={activeOrders.length}
                  hint="Perlu dipantau"
                  icon={<ShoppingBag size={18} />}
                  tone={activeOrders.length ? "warning" : "success"}
                  onClick={() => navigate("/reseller-v2/orders")}
                />
                <Metric
                  label="Akun aktif"
                  value={accountSummary.active}
                  hint="Status aktif"
                  icon={<PackageCheck size={18} />}
                  tone="success"
                  onClick={() => navigate("/reseller-v2/accounts")}
                />
                <Metric
                  label="Hampir berakhir"
                  value={accountSummary.expiring}
                  hint="Cek masa aktif"
                  icon={<TimerReset size={18} />}
                  tone={expiringAccounts.length ? "warning" : "muted"}
                  onClick={() => navigate("/reseller-v2/accounts")}
                />
              </>
            )}
          </section>
          <section className="reseller-v2-overview-grid">
            <BalanceCard
              balance={balance}
              loading={loading}
              onTopUp={openTopUp}
              onHistory={() => navigate("/reseller-v2/orders")}
            />
            <article className="reseller-v2-panel reseller-v2-quick-panel">
              <header>
                <span>Aksi cepat</span>
                <h2>Kebutuhan utama</h2>
              </header>
              <div className="reseller-v2-action-grid">
                <ActionCard
                  title="Beli Produk"
                  description="Buka katalog"
                  icon={<Grid2X2 size={18} />}
                  onClick={() => navigate("/reseller-v2/catalog")}
                />
                <ActionCard
                  title="Lacak Pesanan"
                  description="Lihat status"
                  icon={<ReceiptText size={18} />}
                  onClick={() => navigate("/reseller-v2/orders")}
                />
                <ActionCard
                  title="Cari Kode"
                  description="Akses akun"
                  icon={<KeyRound size={18} />}
                  onClick={() => navigate("/reseller-v2/access")}
                />
                <ActionCard
                  title="Klaim Garansi"
                  description="Laporkan kendala"
                  icon={<BadgeHelp size={18} />}
                  onClick={() => navigate("/reseller-v2/warranty")}
                />
                <ActionCard
                  title="Lihat Panduan"
                  description="Video tutorial"
                  icon={<BookOpenCheck size={18} />}
                  onClick={() => navigate("/reseller-v2/guides")}
                />
              </div>
            </article>
            <article className="reseller-v2-panel reseller-v2-active-orders">
              <header>
                <div>
                  <span>Pesanan aktif</span>
                  <h2>Sedang berjalan</h2>
                </div>
                <Link to="/reseller-v2/orders">Lihat semua</Link>
              </header>
              {loading ? (
                <LoadingSkeleton lines={3} />
              ) : activeOrders.length ? (
                <div className="reseller-v2-compact-list">
                  {activeOrders.map((order) => {
                    const status = statusForOrder(order);
                    return (
                      <Link key={order.id} to="/reseller-v2/orders">
                        <div>
                          <strong>{order.product}</strong>
                          <small>
                            {order.id} / {order.variant}
                          </small>
                        </div>
                        <Badge tone={status.tone}>
                          {status.label}
                        </Badge>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  title="Tidak ada pesanan aktif"
                  description="Pesanan baru akan tampil di bagian ini."
                  action={<Link to="/reseller-v2/catalog">Buka katalog</Link>}
                />
              )}
            </article>
            <article className="reseller-v2-panel reseller-v2-expiry-panel">
              <header>
                <div>
                  <span>Masa aktif</span>
                  <h2>Akun hampir berakhir</h2>
                </div>
                <Link to="/reseller-v2/accounts">Kelola akun</Link>
              </header>
              {loading ? (
                <LoadingSkeleton lines={3} />
              ) : expiringAccounts.length ? (
                <div className="reseller-v2-compact-list">
                  {expiringAccounts.map((account) => (
                    <Link key={account.id} to="/reseller-v2/accounts">
                      <div>
                        <strong>{account.product}</strong>
                        <small>
                          {maskIdentity(account.loginPhone || account.email)} /{" "}
                          {account.profile || "Tanpa profil"}
                        </small>
                      </div>
                      <Badge tone="warning">
                        {compactDate(account.expiresAt)}
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="Belum ada akun menipis"
                  description="Akun yang mendekati akhir masa aktif akan tampil di sini."
                />
              )}
            </article>
          </section>
          <section className="reseller-v2-panel reseller-v2-recent">
            <header>
              <div>
                <span>Transaksi</span>
                <h2>Pesanan terbaru</h2>
              </div>
              <Link to="/reseller-v2/orders">Lihat semua pesanan</Link>
            </header>
            {loading ? (
              <LoadingSkeleton lines={5} />
            ) : recentOrders.length ? (
              <div className="reseller-v2-order-list">
                <div className="reseller-v2-order-head">
                  <span>Pesanan</span>
                  <span>Produk</span>
                  <span>Total</span>
                  <span>Status</span>
                  <span>Waktu</span>
                </div>
                {recentOrders.map((order) => {
                  const status = statusForOrder(order);
                  return (
                    <Link
                      key={order.id}
                      to="/reseller-v2/orders"
                      className="reseller-v2-order-row"
                    >
                      <div>
                        <strong>{order.id}</strong>
                        <small>{order.variant}</small>
                      </div>
                      <span>{order.product}</span>
                      <strong>{formatRupiah(order.total)}</strong>
                      <Badge tone={status.tone}>
                        {status.label}
                      </Badge>
                      <span>
                        <Clock3 size={14} />
                        {compactDate(order.createdAt)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                title="Belum ada pesanan"
                description="Mulai transaksi pertama melalui katalog produk."
                action={<Link to="/reseller-v2/catalog">Lihat katalog</Link>}
              />
            )}
          </section>
        </>
      )}
    </ResellerShell>
  );
}

/**
 * The reseller's balance, and the two things they do with it.
 *
 * This was a generic primitive sitting in the shared resource module, but it
 * is not one: it is this page's only card, it knows about top-ups and
 * transaction history, and nothing else in the app renders it. Keeping it in
 * the kit would have meant the kit grew a component for a single consumer.
 */
function BalanceCard({
  balance,
  held,
  loading,
  onTopUp,
  onHistory,
}: {
  balance: string;
  held?: string;
  loading?: boolean;
  onTopUp: () => void;
  onHistory: () => void;
}) {
  return (
    // `id="saldo"` is a live anchor, not decoration: the shell links to
    // `/reseller-v2/ringkasan#saldo` and this page scrolls to it from the
    // "Saldo tersedia" metric above.
    <article id="saldo" className="ui-card ui-balance">
      <div>
        <span>Saldo reseller</span>
        <h2>{loading ? <LoadingSkeleton /> : balance}</h2>
        <p>{held ? `Saldo tertahan ${held}` : "Siap digunakan untuk transaksi."}</p>
      </div>
      <div className="ui-balance-actions">
        <button type="button" className="ui-button is-primary" onClick={onTopUp}>Top Up</button>
        <button type="button" className="ui-button is-secondary" onClick={onHistory}>Riwayat saldo</button>
      </div>
    </article>
  );
}
