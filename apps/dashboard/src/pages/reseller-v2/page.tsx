import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeHelp,
  BookOpenCheck,
  Clock3,
  Grid2X2,
  KeyRound,
  PackageCheck,
  ReceiptText,
  ShoppingBag,
  TimerReset,
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
import { ActionCard, Badge, Bento, BentoCell, BentoStat, Button, EmptyState, ErrorState, LoadingSkeleton, maskIdentity } from "../../components/ui";

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

          {/* One grid.

              This was three stacked sections: a four-across metric row, a
              5/7 panel grid, and a full-width table below both. Every one of
              them picked its own column count, so the eye re-found the left
              edge three times, and the widest object on the screen -- the
              table, which is the *third* thing a reseller looks at -- was the
              only thing that got the full width.

              It is now a single twelve-column field, and the reading order *is*
              the layout. The balance takes five columns over two rows because
              it is the number the page exists to show. The three counters sit
              beside it at half its height, and the row below balances them at
              3 and 4 so the block closes without a seam. The two lists are a
              deliberate 3/7 pair rather than a 5/5: there are at most three
              active orders, while an expiring account has to show a masked
              credential and a date side by side, so it earns the wide cell.
              The order table is full width because a table that is not full
              width is not a table. */}
          <Bento
            className="reseller-v2-bento"
            rows={4}
            /* A shade taller than the kit's 116px: the cells here hold a
               two-line header and a list row, and at 116 the header and the
               first row do not both fit without the body scrolling. */
            rowHeight="132px"
            label="Ringkasan reseller"
          >
            <BalanceCard
              span={{ col: 5, row: 2 }}
              balance={balance}
              loading={loading}
              onTopUp={openTopUp}
              onHistory={() => navigate("/reseller-v2/orders")}
            />

            <BentoStat
              span={{ col: 3 }}
              label="Pesanan aktif"
              value={activeOrders.length}
              hint={activeOrders.length ? "Perlu dipantau" : "Semua beres"}
              icon={<ShoppingBag size={18} />}
              tone={activeOrders.length ? "warning" : "success"}
              onClick={() => navigate("/reseller-v2/orders")}
            />
            <BentoStat
              span={{ col: 4 }}
              label="Akun aktif"
              value={accountSummary.active}
              hint="Siap dijual ulang"
              icon={<PackageCheck size={18} />}
              tone="success"
              onClick={() => navigate("/reseller-v2/accounts")}
            />
            <BentoStat
              span={{ col: 3 }}
              label="Hampir berakhir"
              value={accountSummary.expiring}
              hint={expiringAccounts.length ? "Cek masa aktif" : "Tidak ada"}
              icon={<TimerReset size={18} />}
              tone={expiringAccounts.length ? "warning" : "default"}
              onClick={() => navigate("/reseller-v2/accounts")}
            />

            {/* The quick actions lose their panel chrome. They were a panel
                with a header and a 2x2 grid inside it, which meant six nested
                boxes; inside a cell they are four marks on a surface, which
                is what they are. The fifth action moves out of the grid and
                onto a full-width row under it, because a 2x2 block of four
                tiles plus a fifth orphan is a layout that only looks balanced
                by accident. */}
            <BentoCell span={{ col: 4 }} as="section" className="reseller-v2-cell" aria-labelledby="reseller-actions-h">
              <header>
                <div>
                  <span>Aksi cepat</span>
                  <h2 id="reseller-actions-h">Kebutuhan utama</h2>
                </div>
              </header>
              <div className="reseller-v2-action-grid">
                <ActionCard variant="bare"
                  title="Beli Produk"
                  description="Buka katalog"
                  icon={<Grid2X2 size={18} />}
                  onClick={() => navigate("/reseller-v2/catalog")}
                />
                <ActionCard variant="bare"
                  title="Lacak Pesanan"
                  description="Lihat status"
                  icon={<ReceiptText size={18} />}
                  onClick={() => navigate("/reseller-v2/orders")}
                />
                <ActionCard variant="bare"
                  title="Cari Kode"
                  description="Akses akun"
                  icon={<KeyRound size={18} />}
                  onClick={() => navigate("/reseller-v2/access")}
                />
                <ActionCard variant="bare"
                  title="Klaim Garansi"
                  description="Laporkan kendala"
                  icon={<BadgeHelp size={18} />}
                  onClick={() => navigate("/reseller-v2/warranty")}
                />
              </div>
              {/* The fifth action is a link, not a tile. Four tiles make a
                  2x2; a fifth tile makes a 2x3 with a hole in it. Guides is
                  also the one destination here that is a place to read rather
                  than a place to do something, and a link says that. */}
              <Link to="/reseller-v2/guides" className="reseller-v2-action-more">
                <BookOpenCheck size={16} aria-hidden="true" />
                Lihat panduan reseller
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </BentoCell>

            <BentoCell span={{ col: 4 }} as="section" className="reseller-v2-cell" aria-labelledby="reseller-orders-h">
              <header>
                <div>
                  <span>Pesanan aktif</span>
                  <h2 id="reseller-orders-h">Sedang berjalan</h2>
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
            </BentoCell>

            <BentoCell span={{ col: 8 }} as="section" className="reseller-v2-cell" aria-labelledby="reseller-expiry-h">
              <header>
                <div>
                  <span>Masa aktif</span>
                  <h2 id="reseller-expiry-h">Akun hampir berakhir</h2>
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
            </BentoCell>

            <BentoCell span={{ col: 12, row: 3 }} as="section" className="reseller-v2-cell" aria-labelledby="reseller-recent-h">
              <header>
                <div>
                  <span>Transaksi</span>
                  <h2 id="reseller-recent-h">Pesanan terbaru</h2>
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
            </BentoCell>
          </Bento>
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
 *
 * It is the emphasised cell of the bento rather than a card in the flow. That
 * is not decoration: it is the largest object on the overview, and there is no
 * reason for a reseller to have to hunt for the number they opened the page
 * for.
 */
function BalanceCard({
  span,
  balance,
  held,
  loading,
  onTopUp,
  onHistory,
}: {
  span: { col: number; row: number };
  balance: string;
  held?: string;
  loading?: boolean;
  onTopUp: () => void;
  onHistory: () => void;
}) {
  return (
    // `id="saldo"` is a live anchor, not decoration: the shell links to
    // `/reseller-v2/ringkasan#saldo`, so the id has to survive the move from a
    // card in a section to a cell in a grid.
    <BentoCell
      id="saldo"
      span={span}
      emphasis
      as="section"
      aria-labelledby="saldo-heading"
      className="ui-balance"
    >
      <div>
        <span id="saldo-heading">Saldo reseller</span>
        <h2>{loading ? <LoadingSkeleton /> : balance}</h2>
        <p>{held ? `Saldo tertahan ${held}` : "Siap digunakan untuk transaksi."}</p>
      </div>
      <div className="ui-balance-actions">
        <Button weight="primary" onClick={onTopUp}>Top Up</Button>
        <Button weight="secondary" onClick={onHistory}>Riwayat saldo</Button>
      </div>
    </BentoCell>
  );
}
