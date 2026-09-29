import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QrCode, ShoppingBag, Wallet } from "lucide-react";
import {
  api,
  subscribeRealtime,
  type AccountDeliveryDetail,
  type ApiOrder,
  type ApiPayment,
} from "../../../lib/api";
import { formatDateTime, formatRupiah } from "../../../lib/format";
import {
  deliveryIsComplete,
  orderCanReopenQris,
  orderPaid,
  orderStatus,
} from "../../../lib/orders";
import { ResellerShell } from "../../../components/reseller-v2/ResellerShell";
import {
  Badge,
  Button,
  CopyButton,
  DataTable,
  type DataColumn,
  Dialog,
  DialogActions,
  Drawer,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  MetricRow,
  Notice,
  SensitiveValue,
} from "../../../components/ui";
import "./orders.css";

/** How long a revealed credential stays on screen. Matches the accounts page. */
const REVEAL_AFTER_MS = 60_000;

/** How often an open payment is re-checked while it is still pending. */
const PAYMENT_POLL_MS = 7_000;

/**
 * The QR image, when the payment provider drew one for us.
 *
 * The old page had a fallback: it handed the raw QRIS payload to
 * `api.qrserver.com` to have an outsider draw the code. That is the payment
 * string for a live order leaving the site, and it happens in the public
 * checkout too, where the person paying is a customer who never logged in.
 *
 * This page does not do that. If the provider returned an image we show it; if
 * it did not, the direct payment link is the way through, and it is a better
 * one anyway -- it is the provider's own page rather than a picture of it.
 */
function qrisImageSource(payment: ApiPayment | null) {
  return payment?.qrImageUrl || "";
}

export default function ResellerV2OrdersPage() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [requestState, setRequestState] = useState<"loading" | "success" | "error">("loading");
  const [ordersError, setOrdersError] = useState("");

  const [pendingOpen, setPendingOpen] = useState(false);
  const [qrisOrder, setQrisOrder] = useState<ApiOrder | null>(null);
  const [qrisPayment, setQrisPayment] = useState<ApiPayment | null>(null);
  const [qrisLoading, setQrisLoading] = useState(false);
  const [qrisError, setQrisError] = useState("");

  const [deliveryOrder, setDeliveryOrder] = useState<ApiOrder | null>(null);
  const [deliveryAccounts, setDeliveryAccounts] = useState<AccountDeliveryDetail[]>([]);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliveryError, setDeliveryError] = useState("");

  const loadOrders = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setRequestState("loading");
    try {
      setOrders(await api.orders());
      setOrdersError("");
      setRequestState("success");
    } catch {
      // A silent refresh that fails leaves what is on screen alone. Replacing a
      // table of a reseller's real orders with an error because a background
      // poll hiccuped is a worse lie than a table a few seconds out of date.
      if (!options.silent) {
        setOrdersError("Pesanan belum dapat dimuat. Periksa koneksi lalu coba lagi.");
        setRequestState("error");
      }
    }
  }, []);

  useEffect(() => {
    loadOrders().catch(() => undefined);
    return subscribeRealtime(() => {
      loadOrders({ silent: true }).catch(() => undefined);
    });
  }, [loadOrders]);

  const openQris = useCallback(async (order: ApiOrder) => {
    if (!order.paymentRef) return;
    setQrisOrder(order);
    setQrisPayment(null);
    setQrisError("");
    setQrisLoading(true);
    try {
      const payment = await api.payment(order.paymentRef);
      setQrisPayment(payment);
      await loadOrders({ silent: true });
      // Only spend a second request when the payment has actually landed --
      // asking for the order on every poll is how a 7-second timer becomes a
      // hundred requests an hour.
      if (String(payment?.status || "").toLowerCase() === "paid") {
        setQrisOrder(await api.order(order.id));
      }
    } catch (loadError) {
      setQrisError(loadError instanceof Error ? loadError.message : "QRIS belum bisa dibuka.");
    } finally {
      setQrisLoading(false);
    }
  }, [loadOrders]);

  const closeQris = useCallback(() => {
    setQrisOrder(null);
    setQrisPayment(null);
    setQrisError("");
  }, []);

  const openDelivery = useCallback(async (order: ApiOrder) => {
    setDeliveryOrder(order);
    setDeliveryAccounts([]);
    setDeliveryError("");
    setDeliveryLoading(true);
    try {
      const detail = await api.order(order.id);
      setDeliveryOrder(detail);
      const accountIds = (detail.deliveredAccounts || [])
        .map((account) => account.id)
        .filter(Boolean);
      const results = await Promise.all(
        accountIds.map((accountId) => api.accountDelivery(accountId)),
      );
      setDeliveryAccounts(results);
      // Marked opened so the account page's unread badge is honest. Failures are
      // ignored on purpose: this is bookkeeping, and refusing to show the
      // credentials because a counter did not tick would be a worse outcome.
      await Promise.all(
        accountIds.map((accountId) => api.markAccountDeliveryOpened(accountId).catch(() => undefined)),
      );
    } catch (loadError) {
      setDeliveryError(
        loadError instanceof Error ? loadError.message : "Detail pengiriman belum dapat dimuat.",
      );
    } finally {
      setDeliveryLoading(false);
    }
  }, []);

  const closeDelivery = useCallback(() => {
    setDeliveryOrder(null);
    setDeliveryAccounts([]);
    setDeliveryError("");
  }, []);

  // While a payment is on screen and still pending, keep asking. The dialog is
  // the one place a reseller sits and waits for the customer to scan, so it is
  // the one place a stale "pending" is actively misleading.
  useEffect(() => {
    if (qrisOrder?.qrisStatus !== "pending" || !qrisOrder.paymentRef) return undefined;
    const timer = window.setInterval(() => {
      openQris(qrisOrder).catch(() => undefined);
    }, PAYMENT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [openQris, qrisOrder]);

  const paidOrders = useMemo(() => orders.filter(orderPaid), [orders]);
  const pendingOrders = useMemo(() => orders.filter(orderCanReopenQris), [orders]);
  const totalSpent = useMemo(
    () => paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0),
    [paidOrders],
  );

  const columns: Array<DataColumn<ApiOrder>> = [
    {
      id: "id",
      header: "ID Transaksi",
      value: (order) => order.id,
      cell: (order) => <strong className="reseller-v2-orders-ref">{order.id}</strong>,
    },
    {
      id: "created",
      header: "Tanggal",
      value: (order) => order.createdAt,
      cell: (order) => <span className="reseller-v2-orders-muted">{formatDateTime(order.createdAt)}</span>,
      hideOnMobile: true,
    },
    {
      id: "item",
      header: "Item",
      value: (order) => `${order.product} ${order.variant} ${order.duration}`,
      cell: (order) => (
        <div className="reseller-v2-orders-item">
          <strong>
            {order.product} {order.duration}
          </strong>
          <small>{order.variant}</small>
        </div>
      ),
    },
    {
      id: "qty",
      header: "Jumlah",
      value: (order) => order.qty || 1,
      cell: (order) => <span className="reseller-v2-orders-muted">{order.qty || 1}x</span>,
    },
    {
      id: "total",
      header: "Total",
      value: (order) => Number(order.total || 0),
      cell: (order) => (
        <div className="reseller-v2-orders-total">
          <strong>{formatRupiah(Number(order.total || 0))}</strong>
          <small>
            {formatRupiah(Number(order.total || 0) / Math.max(1, Number(order.qty || 1)))} / item
          </small>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      value: (order) => orderStatus(order).label,
      cell: (order) => {
        const status = orderStatus(order);
        return <Badge tone={status.tone}>{status.label}</Badge>;
      },
    },
    {
      id: "action",
      header: "Aksi",
      value: (order) => actionLabel(order),
      cell: (order) => {
        if (orderCanReopenQris(order)) {
          return (
            <div className="reseller-v2-orders-actions">
              <Button
                weight="primary"
                onClick={() => openQris(order).catch(() => undefined)}
                disabled={qrisLoading && qrisOrder?.id === order.id}
              >
                {qrisLoading && qrisOrder?.id === order.id ? "Membuka..." : "Lihat QRIS"}
              </Button>
              {order.paymentRef ? <CopyButton value={order.paymentRef} label="Copy Ref" /> : null}
            </div>
          );
        }
        if (deliveryIsComplete(order)) {
          return (
            <Button weight="secondary" onClick={() => openDelivery(order).catch(() => undefined)}>
              {order.deliveryTemplateSnapshot?.status === "incomplete"
                ? "Detail akun belum lengkap"
                : "Lihat Pengiriman"}
            </Button>
          );
        }
        if (orderPaid(order)) {
          return <span className="reseller-v2-orders-waiting">Sedang disiapkan</span>;
        }
        return <span className="reseller-v2-orders-muted">-</span>;
      },
    },
  ];

  const qrisImage = qrisImageSource(qrisPayment);
  const qrisTotal = Number(
    qrisPayment?.totalPayment || qrisPayment?.amount || qrisOrder?.paymentDue || qrisOrder?.total || 0,
  );
  const qrisRef = qrisPayment?.ref || qrisOrder?.paymentRef || "";

  return (
    <ResellerShell
      title="Riwayat Pembelian"
      description="Semua transaksi pembelian akun Anda, beserta detail pengiriman dan QRIS yang masih bisa dibuka."
      onRefresh={() => loadOrders().catch(() => undefined)}
      loading={requestState === "loading"}
    >
      <div className="reseller-v2-orders">
        <MetricRow
          label="Ringkasan pembelian"
          items={[
            {
              label: "Total Transaksi",
              value: orders.length,
              hint: "Semua transaksi, termasuk yang gagal",
              icon: <ShoppingBag size={16} />,
              loading: requestState === "loading",
            },
            {
              label: "Menunggu Pembayaran",
              value: pendingOrders.length,
              hint: "QRIS yang masih bisa dibuka",
              icon: <QrCode size={16} />,
              tone: "warning",
              onClick: () => setPendingOpen(true),
            },
            {
              label: "Total Pengeluaran",
              value: formatRupiah(totalSpent),
              hint: "Hanya transaksi yang sudah lunas",
              icon: <Wallet size={16} />,
              tone: "success",
            },
          ]}
        />

        <DataTable
          rows={orders}
          columns={columns}
          rowKey={(order) => order.id}
          initialPageSize={8}
          loading={requestState === "loading"}
          error={requestState === "error" ? ordersError : ""}
          emptyText="Riwayat pembelian belum ada."
          filters={[
            {
              id: "status",
              label: "Status",
              options: [
                { label: "Semua status", value: "" },
                { label: "Sukses", value: "Sukses" },
                { label: "Menunggu Pembayaran", value: "Menunggu Pembayaran" },
                { label: "Diproses", value: "Diproses" },
                { label: "Dibatalkan", value: "Dibatalkan" },
                { label: "Kedaluwarsa", value: "Kedaluwarsa" },
              ],
              value: (order) => orderStatus(order).label,
            },
          ]}
        />

        <Drawer
          open={pendingOpen}
          title="Pembayaran Menunggu"
          description="QRIS yang masih bisa dibuka ulang dan dibayar."
          onClose={() => setPendingOpen(false)}
        >
          {pendingOrders.length ? (
            <div className="reseller-v2-orders-pending">
              {pendingOrders.map((order) => (
                <article key={`pending-${order.id}`} className="reseller-v2-orders-pending-card">
                  <header>
                    <div>
                      <strong>
                        {order.product} {order.duration}
                      </strong>
                      <small>
                        {order.id} · {order.variant}
                      </small>
                      <small>
                        {formatDateTime(order.createdAt)} · {formatRupiah(Number(order.total || 0))}
                      </small>
                    </div>
                    <Badge tone="warning">Menunggu Pembayaran</Badge>
                  </header>
                  <div className="reseller-v2-orders-actions">
                    <Button
                      weight="primary"
                      onClick={() => {
                        setPendingOpen(false);
                        openQris(order).catch(() => undefined);
                      }}
                    >
                      Buka QRIS
                    </Button>
                    {order.paymentRef ? <CopyButton value={order.paymentRef} label="Copy Ref" /> : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Tidak ada pembayaran yang menunggu"
              description="Semua QRIS pada pesanan Anda sudah lunas atau kedaluwarsa."
            />
          )}
        </Drawer>

        <Dialog
          open={Boolean(qrisOrder)}
          title="QRIS Pembayaran"
          description={qrisOrder?.id}
          onClose={closeQris}
        >
          {qrisOrder ? (
            <div className="reseller-v2-orders-qris">
              <div className="reseller-v2-orders-item">
                <strong>
                  {qrisOrder.product} {qrisOrder.duration}
                </strong>
                <small>{qrisOrder.variant}</small>
              </div>

              {qrisError ? <Notice tone="danger">{qrisError}</Notice> : null}

              {qrisLoading ? <LoadingSkeleton lines={3} /> : null}

              {qrisImage ? (
                <img
                  className="reseller-v2-orders-qr"
                  src={qrisImage}
                  alt="Kode QRIS pembayaran"
                  width={240}
                  height={240}
                />
              ) : !qrisLoading ? (
                // No image from the provider. The link below is the way through
                // -- the provider's own payment page, which is both safer and
                // more reliable than a picture of one.
                <Notice tone="warning">
                  QRIS belum tersedia dari penyedia pembayaran. Gunakan tombol Buka QRIS di bawah
                  untuk membayar langsung di halaman penyedia.
                </Notice>
              ) : null}

              <dl className="reseller-v2-orders-summary">
                <div>
                  <dt>Ref</dt>
                  <dd>{qrisRef || "-"}</dd>
                </div>
                <div>
                  <dt>Total</dt>
                  <dd>{formatRupiah(qrisTotal)}</dd>
                </div>
                <div>
                  <dt>Batas Bayar</dt>
                  <dd>{qrisPayment?.expiresAt || qrisOrder.paymentExpiresAt || "-"}</dd>
                </div>
              </dl>

              <DialogActions
                onCancel={closeQris}
                onConfirm={() => {
                  if (!qrisPayment?.paymentUrl) return;
                  window.open(qrisPayment.paymentUrl, "_blank", "noopener,noreferrer");
                }}
                confirmLabel="Buka QRIS"
                busy={qrisLoading}
              />
            </div>
          ) : null}
        </Dialog>

        <Drawer
          open={Boolean(deliveryOrder)}
          title={deliveryOrder?.id || "Detail Pengiriman"}
          description={
            deliveryOrder
              ? `${deliveryOrder.product} · ${deliveryOrder.variant}`
              : "Credential akun yang dikirim untuk pesanan ini."
          }
          onClose={closeDelivery}
        >
          {deliveryLoading ? <LoadingSkeleton lines={4} /> : null}
          {deliveryError ? <ErrorState message={deliveryError} /> : null}

          {!deliveryLoading && !deliveryError ? (
            <>
              <Notice tone="info">
                Credential ditampilkan sementara, lalu otomatis disembunyikan kembali setelah 60
                detik.
              </Notice>

              {deliveryAccounts.map((detail, index) => {
                const account = detail.account;
                const snapshot = detail.deliveryTemplateSnapshot;
                return (
                  <article key={account.id} className="reseller-v2-orders-delivery">
                    <header>
                      <div>
                        <strong>Akun {index + 1}</strong>
                        <small>
                          {account.product} · {account.variant}
                        </small>
                      </div>
                      <Button
                        weight="quiet"
                        onClick={() =>
                          navigate(
                            `/reseller-v2/accounts?account=${encodeURIComponent(account.id)}&tab=template`,
                          )
                        }
                      >
                        Buka di Akun Saya
                      </Button>
                    </header>

                    <dl className="reseller-v2-orders-summary is-grid">
                      <div>
                        <dt>Email / login</dt>
                        <dd>
                          <SensitiveValue
                            value={account.loginPhone || account.email || "-"}
                            concealAfterMs={REVEAL_AFTER_MS}
                          />
                        </dd>
                      </div>
                      <div>
                        <dt>Password / link</dt>
                        <dd>
                          <SensitiveValue
                            value={account.password || account.canvaLink || "-"}
                            concealAfterMs={REVEAL_AFTER_MS}
                          />
                        </dd>
                      </div>
                      <div>
                        <dt>Profil</dt>
                        <dd>{account.profile || "-"}</dd>
                      </div>
                      <div>
                        <dt>PIN</dt>
                        <dd>
                          <SensitiveValue value={account.pin || "-"} concealAfterMs={REVEAL_AFTER_MS} />
                        </dd>
                      </div>
                      <div>
                        <dt>Masa aktif</dt>
                        <dd>{account.duration || "-"}</dd>
                      </div>
                      <div>
                        <dt>Berakhir</dt>
                        <dd>{account.expiresAt || "-"}</dd>
                      </div>
                    </dl>

                    {snapshot?.status === "ready" && snapshot.renderedText ? (
                      <div className="reseller-v2-orders-template">
                        <header>
                          <div>
                            <strong>Template Siap Kirim</strong>
                            <small>Versi {snapshot.templateVersion || 1}</small>
                          </div>
                          <CopyButton
                            value={snapshot.renderedText}
                            label="Salin Semua"
                            onCopied={() => {
                              api.recordDeliveryTemplateCopied(account.id).catch(() => undefined);
                            }}
                          />
                        </header>
                        <pre>{snapshot.renderedText}</pre>
                      </div>
                    ) : snapshot?.status === "incomplete" ? (
                      <Notice tone="warning">
                        Detail akun belum lengkap:{" "}
                        {(snapshot.missingFields || []).join(", ") || "perlu diperiksa Owner"}.
                      </Notice>
                    ) : (
                      <Notice tone="muted">
                        Template pengiriman belum dikonfigurasi untuk varian ini.
                      </Notice>
                    )}
                  </article>
                );
              })}

              {!deliveryAccounts.length ? (
                <Notice tone="warning">
                  Akun sedang disiapkan atau detail akun belum tertaut ke pesanan.
                </Notice>
              ) : null}
            </>
          ) : null}
        </Drawer>
      </div>
    </ResellerShell>
  );
}

/**
 * The text the table's own search box matches against for the action column.
 *
 * A cell can be a button with an icon in it, and a reader typing "Lihat" into
 * the search expects the rows offering that to be the ones that survive. The
 * column's `cell` is not searchable text, so it gets an explicit one.
 */
function actionLabel(order: ApiOrder) {
  if (orderCanReopenQris(order)) return "Lihat QRIS Copy Ref";
  if (deliveryIsComplete(order)) {
    return order.deliveryTemplateSnapshot?.status === "incomplete"
      ? "Detail akun belum lengkap"
      : "Lihat Pengiriman";
  }
  if (orderPaid(order)) return "Sedang disiapkan";
  return "-";
}
