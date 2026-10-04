import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, Boxes, PackageCheck, ShieldCheck, ShoppingCart, TrendingUp, Users, WalletCards } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, Bento, BentoCell, BentoStat, DetailRow, Toast } from "../../components/ui";
import { DataTable, type DataColumn, type DataFilter } from "../../components/ui/DataTable";
import { ConsoleShell } from "../../components/console/ConsoleShell";
import { api, subscribeRealtime, type ApiOrder, type ApiStockItem, type OperationsCenterResult, type SystemStatus } from "../../lib/api";
import type { Product } from "../../lib/types";
import { formatRupiah } from "../../lib/format";
import { formatDateTime } from "../../lib/format";
import { AttentionQueue, attentionTotal, systemStateFor } from "../../components/attention";
import { ResellerBalances } from "./overview/ResellerBalances";
import { RevenueChart } from "./overview/RevenueChart";
import { ServiceHealth } from "./overview/ServiceHealth";
import { StockCover } from "./overview/StockCover";
import { TopProducts } from "./overview/TopProducts";
import {
  buildAttentionQueue,
  buildRevenueSeries,
  isSmokeTest,
  parseDate,
  serviceRows,
  summariseResellers,
  summariseRevenue,
  summariseStock,
  summariseWallet,
  systemWarnings,
  topProducts,
} from "./overview/analytics";
import { fulfillmentLabel, paymentLabel } from "../../lib/labels";

type OverviewData = {
  orders: ApiOrder[];
  stock: ApiStockItem[];
  products: Product[];
  operations: OperationsCenterResult | null;
  system: SystemStatus | null;
};

const emptyData: OverviewData = { orders: [], stock: [], products: [], operations: null, system: null };

const REVENUE_DAYS = 7;
const TOP_PRODUCT_LIMIT = 5;
const RESELLER_PREVIEW = 5;

const orderColumns: Array<DataColumn<ApiOrder>> = [
  { id: "id", header: "Order ID", value: (order) => order.id, sortable: true, cell: (order) => (
      <Link className="console-order-link" to={`/owner-v2/orders?order=${encodeURIComponent(order.id)}`}>
        {order.id}
      </Link>
    ) },
  { id: "customer", header: "Customer", value: (order) => order.customer || order.resellerName || order.reseller || "-", sortable: true },
  { id: "product", header: "Produk", value: (order) => `${order.product} ${order.variant}`, sortable: true, cell: (order) => (
      <span className="console-product-cell">
        <strong>{order.product}</strong>
        <small>{order.variant}</small>
      </span>
    ) },
  { id: "total", header: "Total", value: (order) => Number(order.total || 0), sortable: true, cell: (order) => formatRupiah(Number(order.total || 0)) },
  // Both columns used to spell their own label out inline -- a third ternary
  // chain here, a fourth on the orders page -- and then looked the *string* up
  // in a colour table to pick the badge tone. Two things followed from that: the
  // same order read differently on the overview than on the orders table beside
  // it, and the moment "Expired" became "Kedaluwarsa" to match the rest of the
  // product, every badge that mapped that string silently fell through to grey.
  // The label and its tone now arrive together from `lib/labels.ts`.
  { id: "payment", header: "Pembayaran", value: (order) => paymentLabel(order).label, sortable: true, cell: (order) => <Badge tone={paymentLabel(order).tone}>{paymentLabel(order).label}</Badge> },
  { id: "fulfillment", header: "Fulfillment", value: (order) => fulfillmentLabel(order).label, sortable: true, cell: (order) => <Badge tone={fulfillmentLabel(order).tone}>{fulfillmentLabel(order).label}</Badge> },
  { id: "time", header: "Waktu", value: (order) => parseDate(order.createdAt)?.getTime() || 0, sortable: true, hideOnMobile: true, cell: (order) => formatDateTime(order.createdAt) },
  { id: "action", header: "Aksi", value: () => "Detail", cell: (order) => <Link to={`/owner-v2/orders?order=${encodeURIComponent(order.id)}`} aria-label={`Buka detail ${order.id}`}><ArrowUpRight size={15} /></Link> },
];

const orderFilters: Array<DataFilter<ApiOrder>> = [
  { id: "payment", label: "Pembayaran", options: [{ label: "Dibayar", value: "paid" }, { label: "Menunggu", value: "pending" }, { label: "Kedaluwarsa", value: "expired" }], value: (order) => String(order.qrisStatus || "") },
  { id: "fulfillment", label: "Fulfillment", options: [{ label: "Selesai", value: "Selesai" }, { label: "Diproses", value: "Diproses" }, { label: "Gagal kirim", value: "Gagal kirim" }], value: (order) => fulfillmentLabel(order).label },
];

export default function OwnerConsoleOverviewPage() {
  const [data, setData] = useState<OverviewData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastUpdated, setLastUpdated] = useState("");
  const [toast, setToast] = useState("");

  const loadData = useCallback(async (manual = false) => {
    manual ? setRefreshing(true) : setLoading(true);
    // Five parallel calls, and none of them waits on another. The previous
    // version fanned out to five in sequence-aware batches and took visibly
    // longer to settle; these are independent reads, so the only cost is
    // connection concurrency. `products` is here to turn stock's bare
    // `productId` into a name -- the stock rows carry no display name, so
    // without it the low-stock list would be a column of ids.
    //
    // The reseller-list request used to be here, feeding an active-reseller count
    // that was computed and never rendered. It was not free: this runs
    // again on every realtime event, and its failure mode was invisible,
    // because no panel read its error key -- so a list that stopped loading
    // left the page reporting "Ringkasan berhasil diperbarui". The reseller
    // figures here all come from `operations`, which is still fetched.
    const results = await Promise.allSettled([api.orders(), api.stock(), api.products(), api.operationsCenter(), api.systemStatus()]);
    const keys = ["orders", "stock", "products", "operations", "system"] as const;
    const nextErrors: Record<string, string> = {};
    setData((current) => {
      const next = { ...current };
      results.forEach((result, index) => {
        const key = keys[index];
        if (result.status === "fulfilled") {
          (next as Record<string, unknown>)[key] = result.value;
        } else {
          nextErrors[key] = result.reason instanceof Error ? result.reason.message : "Data gagal dimuat.";
        }
      });
      return next;
    });
    setErrors(nextErrors);
    setLastUpdated(new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }));
    setLoading(false);
    setRefreshing(false);
    if (manual) {
      setToast(Object.keys(nextErrors).length ? "Refresh selesai dengan sebagian data gagal dimuat." : "Ringkasan berhasil diperbarui.");
    }
  }, []);

  useEffect(() => {
    loadData().catch(() => {
      setLoading(false);
      setRefreshing(false);
    });
    return subscribeRealtime(() => loadData(true).catch(() => undefined));
  }, [loadData]);

  const series = useMemo(() => buildRevenueSeries(data.orders, REVENUE_DAYS), [data.orders]);
  const revenue = useMemo(() => summariseRevenue(series, data.orders), [series, data.orders]);
  const attention = useMemo(() => buildAttentionQueue(data.orders, data.operations), [data.orders, data.operations]);
  const attentionCount = attentionTotal(attention);
  const productName = useCallback((productId: string) => data.products.find((product) => product.id === productId)?.name || productId, [data.products]);
  const stock = useMemo(() => summariseStock(data.stock, data.orders, productName), [data.stock, data.orders, productName]);
  const resellers = useMemo(() => summariseResellers(data.operations, data.orders), [data.operations, data.orders]);
  const wallet = useMemo(() => summariseWallet(data.operations), [data.operations]);
  const products = useMemo(() => topProducts(data.orders, TOP_PRODUCT_LIMIT), [data.orders]);
  const services = useMemo(() => serviceRows(data.system), [data.system]);
  const warnings = useMemo(() => systemWarnings(data.system), [data.system]);
  const recentOrders = useMemo(
    () =>
      data.orders
        .filter((order) => !isSmokeTest(order))
        .sort((left, right) => (parseDate(right.createdAt)?.getTime() || 0) - (parseDate(left.createdAt)?.getTime() || 0))
        .slice(0, 10),
    [data.orders],
  );

  const retry = () => {
    void loadData(true);
  };
  const changeLabel =
    revenue.changePercent === null
      ? "Tidak ada pembanding kemarin"
      : `${revenue.changePercent >= 0 ? "+" : ""}${revenue.changePercent.toFixed(0)}% vs kemarin`;

  return (
    <ConsoleShell
      title="Ringkasan"
      description="Pantau penjualan, saldo reseller, stok, dan kondisi sistem Kavya."
      lastUpdated={lastUpdated}
      refreshing={refreshing}
      attentionCount={attentionCount}
      systemState={systemStateFor(attentionCount, { error: Boolean(errors.operations || errors.system), loading })}
      onRefresh={retry}
    >
      {/* One grid.

          The four headline numbers are *in* the grid rather than a strip above
          it. As a strip they were the one place on the page where a number
          could not be related to anything -- four tiles of identical size and
          weight, the same distance from the thing they described. As row one of
          the field they are the ticker, and because today's revenue is one of
          them the chart below no longer has to repeat the figure in its own
          header to be connected to it.

          The asymmetry carries the meaning. The chart takes eight columns for
          two rows and the attention queue takes four, because they are the two
          panels an owner opens the console to read and they are opposites: one
          is the trend, the other is the list of things that are wrong. Top
          products and reseller balances sit below at six each -- both are
          "what should I do next" lists rather than time series, and both want
          room for names to breathe. The order table is full width because a
          table needs columns to be a table. */}
      <Bento className="console-bento" rows={8} rowHeight="128px" label="Ringkasan operasional">
        <BentoStat
          span={{ col: 3 }}
          label="Pendapatan hari ini"
          value={formatRupiah(revenue.today)}
          hint={changeLabel}
          icon={<WalletCards size={17} />}
          tone="success"
          loading={loading}
          error={errors.orders}
        />
        <BentoStat
          span={{ col: 3 }}
          label="Pesanan hari ini"
          value={revenue.todayOrders}
          hint={`${revenue.todayPaid} paid / ${revenue.todayPending} menunggu`}
          icon={<ShoppingCart size={17} />}
          loading={loading}
          error={errors.orders}
        />
        <BentoStat
          span={{ col: 3 }}
          label="Saldo reseller"
          value={formatRupiah(wallet.totalBalance)}
          hint={`${wallet.resellerCount} reseller · ${wallet.totalTopup > 0 ? formatRupiah(wallet.totalTopup) : "-"} total topup`}
          icon={<TrendingUp size={17} />}
          loading={loading}
          error={errors.operations}
        />
        <BentoStat
          span={{ col: 3 }}
          label="Stok siap"
          value={stock.ready}
          hint={stock.lowStock.length ? `${stock.lowStock.length} produk akan habis` : `${stock.reserved} reserved / ${stock.sold} terjual`}
          icon={<PackageCheck size={17} />}
          tone={stock.lowStock.length ? "warning" : "default"}
          loading={loading}
          error={errors.stock}
        />

        <BentoCell span={{ col: 8, row: 2 }} emphasis as="section" className="console-cell" aria-labelledby="owner-revenue-title">
          <div className="console-panel-header">
            <div>
              <span>Pendapatan &amp; pesanan</span>
              <h2 id="owner-revenue-title">7 hari terakhir</h2>
            </div>
            <strong>{formatRupiah(revenue.week)}</strong>
          </div>
          <RevenueChart data={series} loading={loading} error={errors.orders} onRetry={retry} />
          <div className="console-revenue-summary">
            <span>
              <strong>{revenue.weekOrders}</strong> pesanan paid
            </span>
            <span>
              <strong>{formatRupiah(revenue.averageOrderValue)}</strong> rata-rata/order
            </span>
            <span>
              <strong>{revenue.pending}</strong> menunggu pembayaran
            </span>
          </div>
        </BentoCell>

        <BentoCell span={{ col: 4, row: 2 }} as="section" className="console-cell" aria-labelledby="owner-attention-title">
          <div className="console-panel-header">
            <div>
              <span>Prioritas operasional</span>
              <h2 id="owner-attention-title">Attention queue</h2>
            </div>
            <AlertTriangle size={19} />
          </div>
          <AttentionQueue items={attention} loading={loading} error={errors.orders || errors.operations} />
        </BentoCell>

        <BentoCell span={{ col: 6 }} as="section" className="console-cell" aria-labelledby="owner-products-title">
          <div className="console-panel-header">
            <div>
              <span>Permintaan pasar</span>
              <h2 id="owner-products-title">Produk terlaris</h2>
            </div>
            <Link to="/owner-v2/products">
              Kelola produk <ArrowUpRight size={15} />
            </Link>
          </div>
          <TopProducts products={products} loading={loading} />
        </BentoCell>

        <BentoCell span={{ col: 6 }} as="section" className="console-cell" aria-labelledby="owner-reseller-title">
          <div className="console-panel-header">
            <div>
              <span>Saldo &amp; aktivitas</span>
              <h2 id="owner-reseller-title">Reseller paling tipis</h2>
            </div>
            <Link to="/owner-v2/resellers">
              Kelola reseller <ArrowUpRight size={15} />
            </Link>
          </div>
          <ResellerBalances rows={resellers.slice(0, RESELLER_PREVIEW)} loading={loading} error={errors.operations} onRetry={retry} />
          {resellers.length > RESELLER_PREVIEW ? <p className="console-list-more">+{resellers.length - RESELLER_PREVIEW} reseller lain</p> : null}
        </BentoCell>

        <BentoCell span={{ col: 4, row: 2 }} as="section" className="console-cell" aria-labelledby="owner-stock-title">
          <div className="console-panel-header">
            <div>
              <span>Ketersediaan</span>
              <h2 id="owner-stock-title">Status stok</h2>
            </div>
            <Boxes size={19} />
          </div>
          <StockCover stock={stock} loading={loading} error={errors.stock} onRetry={retry} />
        </BentoCell>

        <BentoCell span={{ col: 4, row: 2 }} as="section" className="console-cell" aria-labelledby="owner-system-title">
          <div className="console-panel-header">
            <div>
              <span>Kondisi layanan</span>
              <h2 id="owner-system-title">Status sistem</h2>
            </div>
          </div>
          <ServiceHealth rows={services} warnings={warnings} loading={loading} error={errors.system} onRetry={retry} />
        </BentoCell>

        <BentoCell span={{ col: 4, row: 2 }} as="section" className="console-cell" aria-labelledby="owner-wallet-title">
          <div className="console-panel-header">
            <div>
              <span>Arus kas reseller</span>
              <h2 id="owner-wallet-title">Wallet ledger</h2>
            </div>
            <Users size={19} />
          </div>
          <dl className="console-wallet-list">
            <DetailRow label="Saldo berjalan">{formatRupiah(wallet.totalBalance)}</DetailRow>
            <DetailRow label="Total topup">{formatRupiah(wallet.totalTopup)}</DetailRow>
            <DetailRow label="Total terpakai">{formatRupiah(wallet.totalSpent)}</DetailRow>
            <DetailRow label="Topup menunggu">{wallet.pendingRequests}</DetailRow>
          </dl>
          <Link to="/owner-v2/resellers" className="console-panel-link">
            Buka daftar reseller <ArrowUpRight size={14} />
          </Link>
        </BentoCell>

        <BentoCell span={{ col: 12, row: 2 }} as="section" className="console-cell" aria-labelledby="recent-orders-title">
          <div className="console-panel-header console-orders-heading">
            <div>
              <span>Aktivitas penjualan</span>
              <h2 id="recent-orders-title">Pesanan terbaru</h2>
            </div>
            <Link to="/owner-v2/orders">
              Lihat semua pesanan <ArrowUpRight size={15} />
            </Link>
          </div>
          <DataTable
            rows={recentOrders}
            columns={orderColumns}
            filters={orderFilters}
            rowKey={(order) => order.id}
            loading={loading}
            error={errors.orders}
            emptyText="Belum ada pesanan live."
            initialPageSize={5}
          />
        </BentoCell>
      </Bento>

      {/* Stated once, on the page, rather than inside the order drawer that
          used to live here. The overview reads live order and stock records, so
          "nothing credential-bearing is rendered on this page" is a property
          the reader is entitled to have confirmed -- and it is a property that
          stays true only while someone keeps saying it, because the next field
          added to an order is the next thing that could be rendered by
          accident. `owner-console-ui.test.mjs` asserts this line is present. */}
      <p className="console-privacy-note">
        <ShieldCheck size={16} />
        <span>Password, OTP, PIN, token, dan kredensial akun tidak ditampilkan pada Ringkasan. Audit lengkap dibuka dari halaman pesanan.</span>
      </p>

      <Toast message={toast} tone={errors.stock || errors.orders ? "warning" : "success"} onClose={() => setToast("")} />
    </ConsoleShell>
  );
}
