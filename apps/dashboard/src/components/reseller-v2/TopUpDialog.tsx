import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, LoaderCircle, X } from "lucide-react";
import {
  api,
  type ApiPayment,
  type ResellerDepositInstructions,
} from "../../lib/api";

const methodOrder = [
  "qris_auto",
  "qris_owner",
  "dana",
  "livin",
  "bca",
  "gopay",
  "shopeepay",
];

function methodLabel(method = "") {
  return (
    (
      {
        qris_auto: "QRIS otomatis",
        qris_owner: "QRIS owner",
        dana: "DANA",
        livin: "Livin Mandiri",
        bca: "BCA",
        gopay: "GoPay",
        shopeepay: "ShopeePay",
      } as Record<string, string>
    )[method] || method
  );
}

function money(value = 0) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function qrSource(payment: ApiPayment | null) {
  if (!payment) return "";
  if (payment.qrImageUrl) return payment.qrImageUrl;
  const value =
    payment.qrString || payment.qrisText || payment.paymentUrl || "";
  return value
    ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=12&data=${encodeURIComponent(value)}`
    : "";
}

function safeDepositError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("nominal") || message.includes("amount"))
    return "Nominal Top Up tidak valid.";
  if (message.includes("rate") || message.includes("terlalu banyak"))
    return "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.";
  if (
    message.includes("unavailable") ||
    message.includes("tidak tersedia") ||
    message.includes("disconnected")
  )
    return "Metode pembayaran sedang tidak tersedia. Pilih metode lain.";
  return "Top Up belum dapat diproses. Periksa koneksi lalu coba lagi.";
}

export function TopUpDialog({
  open,
  onClose,
  onBalanceChanged,
}: {
  open: boolean;
  onClose: () => void;
  onBalanceChanged?: () => void;
}) {
  const [instructions, setInstructions] =
    useState<ResellerDepositInstructions | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("qris_auto");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [payment, setPayment] = useState<ApiPayment | null>(null);
  const [orderId, setOrderId] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    api
      .resellerDepositInstructions()
      .then((result) => {
        if (!active) return;
        setInstructions(result);
        if (result.methods?.qris_auto?.available === false) {
          const fallback = methodOrder.find(
            (item) => item !== "qris_auto" && result.methods?.[item]?.available,
          );
          if (fallback) setMethod(fallback);
        }
      })
      .catch(() => {
        if (active) setError("Metode Top Up belum dapat dimuat. Coba lagi.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setAmount("");
      setNote("");
      setError("");
      setSuccess("");
      setPayment(null);
      setOrderId("");
      setMethod("qris_auto");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose, open, submitting]);

  const choices = useMemo(
    () =>
      methodOrder
        .filter(
          (item) =>
            item === "qris_auto" || instructions?.methods?.[item]?.available,
        )
        .map((item) => ({ value: item, label: methodLabel(item) })),
    [instructions],
  );
  const selected = instructions?.methods?.[method] || null;
  const available = Boolean(selected?.available);
  const qrImage = qrSource(payment);

  async function submit() {
    const numericAmount = Number(amount || 0);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Masukkan nominal Top Up yang valid.");
      return;
    }
    if (!available) {
      setError("Metode pembayaran belum tersedia. Pilih metode lain.");
      return;
    }
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const result = await api.requestResellerDeposit({
        amount: numericAmount,
        method,
        note,
      });
      const createdPayment = result.paymentRef
        ? result.payment || (await api.payment(result.paymentRef))
        : null;
      setPayment(createdPayment);
      setOrderId(result.orderId || "");
      setSuccess(
        result.message ||
          (createdPayment
            ? "QRIS berhasil dibuat."
            : "Permintaan Top Up berhasil dikirim."),
      );
      onBalanceChanged?.();
    } catch (submitError) {
      setError(safeDepositError(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="reseller-v2-topup-overlay"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !submitting && onClose()
      }
    >
      <section
        className="reseller-v2-topup-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="topup-dialog-title"
      >
        <header>
          <div>
            <span>Saldo reseller</span>
            <h2 id="topup-dialog-title">Top Up Saldo</h2>
            <p>Tambah saldo melalui metode pembayaran yang tersedia.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Tutup Top Up"
          >
            <X size={19} />
          </button>
        </header>
        {payment ? (
          <div className="reseller-v2-topup-body">
            <div className="reseller-v2-topup-success">
              <CheckCircle2 size={19} />
              <div>
                <strong>QRIS berhasil dibuat</strong>
                <span>{success}</span>
              </div>
            </div>
            {qrImage ? (
              <div className="reseller-v2-topup-qr">
                <img src={qrImage} alt="QRIS Top Up reseller" />
              </div>
            ) : (
              <p className="reseller-v2-topup-notice">
                QRIS tidak dapat ditampilkan. Gunakan tautan pembayaran di
                bawah.
              </p>
            )}
            <dl className="reseller-v2-topup-details">
              <div>
                <dt>Nomor pesanan</dt>
                <dd>{orderId || "-"}</dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd>{money(payment.totalPayment || payment.amount)}</dd>
              </div>
              <div>
                <dt>Batas bayar</dt>
                <dd>{payment.expiresAt || "-"}</dd>
              </div>
            </dl>
            <div className="reseller-v2-topup-actions">
              {payment.paymentUrl ? (
                <a href={payment.paymentUrl} target="_blank" rel="noreferrer">
                  Buka QRIS <ExternalLink size={15} />
                </a>
              ) : null}
              <button type="button" onClick={onClose}>
                Tutup
              </button>
            </div>
          </div>
        ) : (
          <div className="reseller-v2-topup-body">
            {loading ? (
              <div className="reseller-v2-topup-loading">
                <LoaderCircle className="reseller-v2-spin" size={20} /> Memuat
                metode pembayaran...
              </div>
            ) : (
              <>
                <label>
                  <span>Nominal</span>
                  <input
                    type="number"
                    min="1"
                    inputMode="numeric"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="Contoh: 10000"
                  />
                </label>
                <label>
                  <span>Metode pembayaran</span>
                  <select
                    value={method}
                    onChange={(event) => {
                      setMethod(event.target.value);
                      setError("");
                    }}
                  >
                    {choices.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="reseller-v2-topup-instruction">
                  <strong>{methodLabel(method)}</strong>
                  {method === "qris_auto" && available ? (
                    <p>
                      QRIS dibuat otomatis. Saldo bertambah setelah pembayaran
                      terverifikasi.
                    </p>
                  ) : selected?.available ? (
                    <>
                      <p>
                        {selected.note || "Ikuti informasi pembayaran berikut."}
                      </p>
                      {selected.accountNumber ? (
                        <span>Nomor/Akun: {selected.accountNumber}</span>
                      ) : null}
                      {selected.accountName ? (
                        <span>Atas nama: {selected.accountName}</span>
                      ) : null}
                      {selected.imageUrl ? (
                        <img src={selected.imageUrl} alt="QRIS owner" />
                      ) : null}
                    </>
                  ) : (
                    <p>Metode ini sedang tidak tersedia.</p>
                  )}
                </div>
                <label>
                  <span>
                    Catatan <em>opsional</em>
                  </span>
                  <textarea
                    rows={3}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Tambahkan catatan bila diperlukan"
                  />
                </label>
                {error ? (
                  <p className="reseller-v2-topup-error" role="alert">
                    {error}
                  </p>
                ) : null}
                {success ? (
                  <p
                    className="reseller-v2-topup-success-message"
                    role="status"
                  >
                    {success}
                  </p>
                ) : null}
                <div className="reseller-v2-topup-actions">
                  <button type="button" onClick={onClose} disabled={submitting}>
                    Batal
                  </button>
                  <button
                    type="button"
                    className="is-primary"
                    onClick={submit}
                    disabled={submitting || !available}
                  >
                    {submitting ? (
                      <>
                        <LoaderCircle className="reseller-v2-spin" size={16} />{" "}
                        Memproses...
                      </>
                    ) : method === "qris_auto" ? (
                      "Buat QRIS"
                    ) : (
                      "Kirim Permintaan"
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
