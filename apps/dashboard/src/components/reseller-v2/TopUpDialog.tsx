import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, LoaderCircle, X } from "lucide-react";
import {
  api,
  type ApiPayment,
  type ResellerDepositInstructions,
} from "../../lib/api";
import { formatDateTime, formatRupiah } from "../../lib/format";
import { useQrisQr } from "../../lib/useQrisQr";
import { qrisPayloadFrom } from "../../lib/qrisQr";

const methodOrder = [
  "qris_auto",
  "qris_owner",
  "dana",
  "livin",
  "bca",
  "gopay",
  "shopeepay",
];

/**
 * The readable name for a payment method.
 *
 * The server already names these -- `deposit-instructions` returns a `label`
 * per method ("Deposit otomatis QRIS", "QRIS owner manual", "Livin Mandiri") --
 * and this function ignored all of it in favour of a private copy. The copy was
 * never worse for the seven known methods, which is why nobody noticed; the
 * cost showed up the moment the owner configures an eighth, and the fallback
 * `|| method` printed the raw key into the dropdown: `shopee` or `qris_manual`
 * sitting next to "BCA".
 *
 * The owner's wording wins over ours, so a label they change in settings
 * reaches the dealer without a code change. Ours is the fallback for the
 * initial render and for the receipt, which can render before `instructions`
 * resolves.
 */
function methodLabel(method = "", instructions?: ResellerDepositInstructions | null) {
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
    )[method] || instructions?.methods?.[method]?.label || method
  );
}

/**
 * What the amount field accepts, and what the server will actually store.
 *
 * `POST /api/resellers/deposit-request` validates exactly one thing about the
 * amount: `Math.max(0, Number(amount || 0))` must not be falsy. There is no
 * minimum and no maximum anywhere in the server -- not in the route, not in
 * `createDepositTopupOrder`, not in `createPakasirQris`. So this is not a
 * minimum, and the field deliberately does not claim to be one; inventing a
 * floor the backend does not enforce would be a promise the product cannot
 * keep, and the owner would approve the request anyway.
 *
 * What *is* real, and was missing: fractional rupiah. `min="1"` on a
 * `<input type="number">` does not stop 1.5 being typed, and a deposit of
 * `1500.5` becomes `deposit: 1500.5` in the reseller's own balance. Rupiah has
 * no subunit in circulation, and every other amount on this page goes through
 * `formatRupiah`, which rounds -- so the field accepted a number the rest of
 * the product would not even be able to show back to them.
 */
export function parseTopUpAmount(value: string): {
  amount: number;
  error: string;
} {
  const trimmed = String(value || "").trim();
  if (!trimmed) return { amount: 0, error: "Masukkan nominal Top Up yang valid." };

  const amount = Number(trimmed);
  if (!Number.isFinite(amount)) return { amount: 0, error: "Nominal hanya boleh berisi angka." };
  if (amount <= 0) return { amount: 0, error: "Nominal Top Up harus lebih besar dari nol." };
  if (!Number.isInteger(amount)) {
    return {
      amount: 0,
      error: "Nominal harus bilangan bulat rupiah, tanpa pecahan.",
    };
  }
  return { amount, error: "" };
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
  /* A ref, not the `submitting` state above.
     `disabled={submitting}` does not close the window this button has: React
     has to re-render before the attribute lands, and two clicks inside that
     window both reach `submit`. The second request is not a duplicate that
     fails quietly -- for `qris_auto` it calls `createPakasirQris`, which makes
     a real transaction at the provider, and it messages the owner. So the
     dealer pays for the same top-up twice and the owner is told twice.
     Checked synchronously, before the first `await`. */
  const submitLock = useRef(false);
  const [receipt, setReceipt] = useState<{ reference: string; message: string } | null>(null);

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
      setReceipt(null);
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
        .map((item) => ({ value: item, label: methodLabel(item, instructions) })),
    [instructions],
  );
  const selected = instructions?.methods?.[method] || null;
  const available = Boolean(selected?.available);
  // Always drawn here, from the provider's raw string. See lib/qrisQr.ts.
  const qrImage = useQrisQr(qrisPayloadFrom(payment));

  async function submit() {
    if (submitLock.current) return;
    const { amount: numericAmount, error: amountError } = parseTopUpAmount(amount);
    if (amountError) {
      setError(amountError);
      return;
    }
    if (!available) {
      setError("Metode pembayaran belum tersedia. Pilih metode lain.");
      return;
    }
    submitLock.current = true;
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
      const reference = result.orderId || result.requestId || "";
      setOrderId(reference);
      const message =
        result.message ||
        (createdPayment
          ? "QRIS berhasil dibuat."
          : "Permintaan Top Up berhasil dikirim.");
      setSuccess(message);
      /* A manual method gets no `payment` back -- the server only creates one
         for `qris_auto` -- so before this, `payment` stayed null and the dialog
         fell back to showing the *form again*, with the green confirmation
         sitting under the amount field. Nothing stopped the dealer from reading
         that as "it did not send" and pressing "Kirim Permintaan" again, which
         files a second request and messages the owner a second time. The
         receipt is what the no-payment path now renders instead. */
      if (!createdPayment) setReceipt({ reference, message });
      onBalanceChanged?.();
    } catch (submitError) {
      setError(safeDepositError(submitError));
    } finally {
      submitLock.current = false;
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
                <dd>{formatRupiah(payment.totalPayment || payment.amount)}</dd>
              </div>
              <div>
                <dt>Batas bayar</dt>
                {/* Was a raw `payment.expiresAt`, i.e. `2026-01-02 03:04:05`
                    from `addMinutesText`. Every other timestamp on the reseller
                    side goes through `formatDateTime`; this one was the only
                    ISO string left on the page. */}
                <dd>{payment.expiresAt ? formatDateTime(payment.expiresAt) : "-"}</dd>
              </div>
            </dl>
            <div className="reseller-v2-topup-actions">
              {payment.paymentUrl ? (
                <a href={payment.paymentUrl} target="_blank" rel="noreferrer">
                  Buka QRIS <ExternalLink size={15} />
                </a>
              ) : (
                /* No link means no way to pay, and the QR only shows when the
                   provider returned a drawable string. Saying so is the whole
                   difference between "your top-up is stuck" and "here is what
                   to do about it". */
                <p className="reseller-v2-topup-notice">
                  Tautan pembayaran tidak tersedia dari penyedia. Tutup dialog
                  ini lalu hubungi owner bila QRIS tidak tampil.
                </p>
              )}
              <button type="button" onClick={onClose}>
                Tutup
              </button>
            </div>
          </div>
        ) : receipt ? (
          /* The manual-method success path. It has no QR and no link -- the
             owner approves it after the dealer transfers to a bank account --
             so it says which reference to quote and stops. */
          <div className="reseller-v2-topup-body">
            <div className="reseller-v2-topup-success">
              <CheckCircle2 size={19} />
              <div>
                <strong>Permintaan terkirim</strong>
                <span>{receipt.message}</span>
              </div>
            </div>
            <dl className="reseller-v2-topup-details">
              <div>
                <dt>Nomor permintaan</dt>
                <dd>{receipt.reference || "-"}</dd>
              </div>
              <div>
                <dt>Nominal</dt>
                <dd>{formatRupiah(Number(amount || 0))}</dd>
              </div>
              <div>
                <dt>Metode</dt>
                <dd>{methodLabel(method, instructions)}</dd>
              </div>
            </dl>
            <p className="reseller-v2-topup-notice">
              Saldo bertambah setelah owner memverifikasi transfer. Simpan
              nomor permintaan di atas sebagai bukti.
            </p>
            <div className="reseller-v2-topup-actions">
              <button type="button" onClick={onClose}>
                Selesai
              </button>
            </div>
          </div>
        ) : (
          <div className="reseller-v2-topup-body">
            {loading ? (
              <div className="reseller-v2-topup-loading">
                <LoaderCircle className="ui-spin" size={20} /> Memuat
                metode pembayaran...
              </div>
            ) : (
              <>
                <label>
                  <span>Nominal</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="Contoh: 10000"
                  />
                  <small className="reseller-v2-topup-hint">
                    Nominal harus bilangan bulat rupiah. Saldo bertambah
                    setelah pembayaran diverifikasi.
                  </small>
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
                  <strong>{methodLabel(method, instructions)}</strong>
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
                        <LoaderCircle className="ui-spin" size={16} />{" "}
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
