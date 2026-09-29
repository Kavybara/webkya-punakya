import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api, subscribeRealtime, type ApiOrder, type ApiPayment, type CatalogProduct, type CatalogVariant } from "../../lib/api";
import { durationAllowedByModes, firstAllowedPriceEntry, sortedAllowedPriceEntries } from "../../lib/durations";
import { productBrandAsset, productLogoUrl } from "../../lib/productBrandAssets";
import { customerPaymentBreakdown } from "../../lib/payment";
import { readSession, updateSession } from "../../lib/session";
import type { CheckoutField } from "../../lib/types";
import { formatRupiah } from "../../lib/format";

type CheckoutStep = "catalog" | "details" | "payment" | "process" | "done";

type SelectedPackage = {
  product: CatalogProduct;
  variant: CatalogVariant;
  duration: string;
  price: number;
};

type CheckoutLocationState = {
  checkoutSelection?: SelectedPackage;
  quantity?: number;
};

type ResellerCheckState = {
  status: "idle" | "checking" | "valid" | "invalid";
  message: string;
};

type CheckoutTouchedState = {
  customer: boolean;
  customerData: boolean;
  whatsapp: boolean;
};

const steps: Array<{ id: CheckoutStep; label: string }> = [
  { id: "details", label: "Pesanan" },
  { id: "payment", label: "Pembayaran" },
  { id: "done", label: "Selesai" },
];

const resellerOnlyMessage = "Nomor WhatsApp ini belum terdaftar sebagai reseller Kavya. Pembelian hanya untuk reseller aktif. Hubungi owner untuk daftar atau aktivasi reseller.";

function firstDuration(variant?: CatalogVariant) {
  const [duration, price] = firstAllowedPriceEntry(variant?.prices || {}, variant?.durationModes);
  return { duration, price: Number(price || 0) };
}

function minPrice(product: CatalogProduct) {
  const prices = product.variants
    .flatMap((variant) => sortedAllowedPriceEntries(variant.prices || {}, variant.durationModes).map(([, price]) => Number(price)))
    .filter((price) => Number.isFinite(price));
  return prices.length ? Math.min(...prices) : 0;
}

function durationCount(product: CatalogProduct) {
  return product.variants.reduce((total, variant) => total + sortedAllowedPriceEntries(variant.prices || {}, variant.durationModes).length, 0);
}

function productTone(product: CatalogProduct) {
  return productBrandAsset(product).tone;
}

function productLabel(product: CatalogProduct) {
  const text = `${product.name} ${product.category}`.toLowerCase();
  if (text.includes("spotify")) return "Music";
  if (text.includes("mobile")) return "Mobile";
  if (product.needsProfile) return "Premium";
  return "Streaming";
}

function qrImageSource(payment: ApiPayment | null) {
  if (!payment) return "";
  if (payment.qrImageUrl) return payment.qrImageUrl;
  const qrData = payment.qrString || payment.qrisText || payment.paymentUrl || "";
  if (!qrData) return "";
  return `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=12&data=${encodeURIComponent(qrData)}`;
}

function normalizeWhatsapp(value: string) {
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

function splitFulfillmentDisplayText(text = "") {
  const lines = text.split("\n");
  const snkIndex = lines.findIndex((line) => /^S&K:/i.test(line.trim()));
  const accountLines = snkIndex === -1 ? lines : lines.slice(0, snkIndex);
  const detailIndex = accountLines.findIndex((line) => {
    const value = line.trim();
    return (
      /^ACCOUNT DETAIL$/i.test(value) ||
      /^DETAIL (?:AKUN|CANVA|LINK|PRODUK)$/i.test(value) ||
      /ACCOUNT DETAIL/i.test(value)
    );
  });
  const genericTransactionLine = /^(?:TRANSAKSI SUKSES|Order ID:|Nama Produk:|Nomor Buyer:|Jumlah Beli:|Harga:|Fee(?: Pakasir)?:|Total Dibayar:|Metode Pay:|Tanggal\/Jam Transaksi:)/i;
  const detailLines = detailIndex >= 0
    ? accountLines.slice(detailIndex)
    : accountLines.filter((line) => !genericTransactionLine.test(line.trim()));

  return {
    account: detailLines.join("\n").trim(),
    snk: snkIndex === -1 ? "" : lines.slice(snkIndex).join("\n").trim(),
  };
}

function checkoutErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Order gagal dibuat.";
  if (/quota exceeded|read requests per minute|sheets\.googleapis/i.test(message)) {
    return "Google Sheets sedang limit sebentar. Coba lagi 1-2 menit, stok tidak akan diproses dua kali.";
  }
  if (/internal server|econn|fetch failed|unexpected token|stack trace|sql/i.test(message)) {
    return "Pesanan belum dapat diproses. Coba lagi tanpa membuat pesanan baru.";
  }
  return message || "Order gagal dibuat.";
}

function paymentCountdown(expiresAt = "", now = Date.now()) {
  if (!expiresAt) return { label: "-", expired: false };
  const normalized = expiresAt.includes("T") ? expiresAt : expiresAt.replace(" ", "T");
  const expires = new Date(normalized).getTime();
  if (!Number.isFinite(expires)) return { label: expiresAt, expired: false };
  const remaining = Math.max(0, expires - now);
  if (remaining <= 0) return { label: "00:00", expired: true };
  const totalSeconds = Math.floor(remaining / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return {
    label: [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":"),
    expired: false,
  };
}

function paymentStatusLabel(status = "") {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "paid") return "Berhasil";
  if (normalized === "expired") return "Kedaluwarsa";
  if (normalized === "cancelled") return "Dibatalkan";
  if (normalized === "failed") return "Gagal";
  if (normalized === "checking") return "Sedang Memeriksa";
  return "Menunggu Pembayaran";
}

function paymentStatusTone(status = "") {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "paid") return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
  if (["expired", "cancelled", "failed"].includes(normalized)) return "border-rose-400/20 bg-rose-400/10 text-rose-300";
  if (normalized === "checking") return "border-cyan-300/20 bg-cyan-300/10 text-cyan-200";
  return "border-amber-300/20 bg-amber-300/10 text-amber-200";
}

function isTerminalCheckoutState(order: ApiOrder | null, payment: ApiPayment | null, now = Date.now()) {
  const paymentStatus = String(payment?.status || order?.qrisStatus || "").toLowerCase();
  const orderStatus = String(order?.orderStatus || "").toLowerCase();
  const deliveryStatus = String(order?.deliveryStatus || "").toLowerCase();
  const countdown = paymentCountdown(order?.paymentExpiresAt || payment?.expiresAt || "", now);
  return (
    ["expired", "cancelled", "failed"].includes(paymentStatus)
    || ["completed", "cancelled", "expired"].includes(orderStatus)
    || ["sent", "stock_unavailable_deposit"].includes(deliveryStatus)
    || countdown.expired
  );
}

function formatCheckoutDate(value = "") {
  if (!value) return "-";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function ownerContactHref(ownerWhatsApp: string, orderId = "") {
  const number = normalizeWhatsapp(ownerWhatsApp || "");
  if (!number) return "/";
  const message = [
    "Halo owner Kavya, saya butuh bantuan untuk order ini.",
    orderId ? `Order ID: ${orderId}` : "",
  ].filter(Boolean).join("\n");
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

function clampOrderQuantity(value: number, maxStock: number) {
  const numericValue = Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.min(Math.max(1, numericValue), Math.max(1, maxStock));
}

type CheckoutRules = {
  customerField: "email" | "device" | "optional";
  required: boolean;
  minItems: number;
  label: string;
  placeholder: string;
  helper: string;
};

function selectionText(selection: SelectedPackage | null) {
  const product = selection?.product;
  const variant = selection?.variant;
  return [product?.id, product?.code, product?.name, product?.category, variant?.id, variant?.code, variant?.name].join(" ").toLowerCase();
}

function isNetflixSelection(selection: SelectedPackage | null) {
  const product = selection?.product;
  if (!product) return false;
  return [product.id, product.code, product.name, product.category].join(" ").toLowerCase().includes("netflix") || String(product.code || "").toUpperCase() === "NET";
}

function isNetflixSemiPrivateSelection(selection: SelectedPackage | null) {
  if (!isNetflixSelection(selection)) return false;
  const variant = selection?.variant;
  const text = [variant?.id, variant?.code, variant?.name].join(" ").toLowerCase();
  return text.includes("semi");
}

function isCanvaSelection(selection: SelectedPackage | null) {
  const product = selection?.product;
  if (!product) return false;
  const text = [product.id, product.code, product.name, product.category].join(" ").toLowerCase();
  return text.includes("canva") || String(product.code || "").toUpperCase() === "CANVA";
}

function isLinkPoolSelection(selection: SelectedPackage | null) {
  const product = selection?.product;
  if (!product) return false;
  const text = selectionText(selection);
  return (
    isCanvaSelection(selection)
    || text.includes("ms365")
    || text.includes("m365")
    || text.includes("microsoft 365")
    || text.includes("office 365")
  );
}

function checkoutRules(selection: SelectedPackage | null, qty = 1): CheckoutRules {
  const configured = selection?.variant.checkoutRequirements || selection?.product.checkoutRequirements;
  if (configured?.customerField) {
    const field = configured.customerField === "optional" ? "optional" : configured.customerField;
    return {
      customerField: field,
      required: configured.required ?? field !== "optional",
      minItems: Math.max(field === "email" ? qty : 1, Number(configured.minItems || 1)),
      label: configured.label || (field === "email" ? "Email Customer" : field === "device" ? "Device Customer" : "Data Customer"),
      placeholder: configured.placeholder || (field === "email" ? "email customer, pisahkan jika beli banyak" : field === "device" ? "Contoh: Smart TV Samsung" : "Email, device, atau catatan customer"),
      helper: configured.helper || "",
    };
  }

  const text = selectionText(selection);
  if (isLinkPoolSelection(selection)) {
    return {
      customerField: "email",
      required: true,
      minItems: Math.max(1, qty),
      label: `Email Customer ${selection?.product.name || "Produk"}`,
      placeholder: "email customer, pisahkan jika beli banyak",
      helper: "Wajib isi email customer. Jika qty lebih dari 1, isi sejumlah qty.",
    };
  }
  if (isNetflixSelection(selection) || text.includes("hbo") || text.includes("max")) {
    const labelProduct = isNetflixSelection(selection) ? "Netflix" : "HBO";
    const minItems = isNetflixSemiPrivateSelection(selection) ? 2 : 1;
    return {
      customerField: "device",
      required: true,
      minItems,
      label: `${labelProduct} Device${minItems > 1 ? ` (${minItems} device)` : ""}`,
      placeholder: minItems > 1 ? "Contoh: Smart TV Samsung, iPhone 13" : "Contoh: Smart TV Samsung",
      helper: minItems > 1
        ? `${labelProduct} Semi Private wajib isi ${minItems} device customer. Pisahkan dengan koma atau baris baru.`
        : `Wajib diisi dan sesuaikan dengan device customer untuk audit ${labelProduct}.`,
    };
  }
  if (text.includes("wetv")) {
    return {
      customerField: "device",
      required: true,
      minItems: 1,
      label: "Device Customer",
      placeholder: "Contoh: Android TV, iPhone, Smart TV",
      helper: "Wajib isi device customer supaya admin bisa audit akun WeTV.",
    };
  }
  return {
    customerField: "optional",
    required: false,
    minItems: 1,
    label: "Data Customer",
    placeholder: "Email, device, atau catatan customer",
    helper: "",
  };
}

function splitCustomerEmails(value = "") {
  return String(value || "")
    .split(/[\s,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
}

function splitDeviceNames(value = "") {
  return String(value || "")
    .split(/\r?\n|[,;]+|\s+\+\s+|\s+dan\s+/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function ProductsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const checkoutState = location.state as CheckoutLocationState | null;
  const stateSelection = checkoutState?.checkoutSelection || null;
  const stateQuantity = Number(checkoutState?.quantity || 1);
  const [searchParams] = useSearchParams();
  const initialCheckoutStep = useMemo(() => {
    const productId = searchParams.get("productId") || searchParams.get("product") || "";
    const variantId = searchParams.get("variantId") || searchParams.get("variant") || "";
    return location.pathname.startsWith("/reseller/checkout") && (stateSelection || (productId && variantId)) ? "details" : "catalog";
  }, [location.pathname, searchParams, stateSelection]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Semua");
  const [sort, setSort] = useState("Termurah");
  const [columnCount, setColumnCount] = useState(1);
  const [openProductId, setOpenProductId] = useState("");
  const [catalogSelection, setCatalogSelection] = useState<SelectedPackage | null>(null);
  const [step, setStep] = useState<CheckoutStep>(initialCheckoutStep);
  const [selection, setSelection] = useState<SelectedPackage | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [customer, setCustomer] = useState("");
  const [email, setEmail] = useState("");
  const [checkoutData, setCheckoutData] = useState<Record<string, string>>({});
  const [whatsapp, setWhatsapp] = useState("");
  const [note, setNote] = useState("");
  const [createdOrder, setCreatedOrder] = useState<ApiOrder | null>(null);
  const [payment, setPayment] = useState<ApiPayment | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
  const [prechecking, setPrechecking] = useState(false);
  const [resellerCheck, setResellerCheck] = useState<ResellerCheckState>({ status: "idle", message: "" });
  const [ownerWhatsApp, setOwnerWhatsApp] = useState("");
  const [autoCheckoutKey, setAutoCheckoutKey] = useState("");
  const [touched, setTouched] = useState<CheckoutTouchedState>({
    customer: false,
    customerData: false,
    whatsapp: false,
  });
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [credentialsVisible, setCredentialsVisible] = useState(false);
  const [copiedValue, setCopiedValue] = useState("");
  const [qrExpanded, setQrExpanded] = useState(false);
  const submitLockRef = useRef(false);
  const paymentRefreshLockRef = useRef(false);
  const verifiedCheckoutSessionRef = useRef("");
  const resumedOrderRef = useRef("");
  const credentialTimerRef = useRef<number | null>(null);

  const isResellerCheckout = location.pathname.startsWith("/reseller/checkout");
  const checkoutSession = readSession();
  const resellerUser = checkoutSession?.role === "reseller" ? checkoutSession.user || {} : {};
  const isAuthenticatedResellerCheckout = isResellerCheckout && checkoutSession?.role === "reseller";
  const resellerNameLocked = Boolean(isAuthenticatedResellerCheckout && (resellerUser.name || resellerUser.username));
  const resellerWhatsappLocked = Boolean(isAuthenticatedResellerCheckout && resellerUser.whatsapp);

  function backToCatalog() {
    if (isResellerCheckout) {
      navigate("/reseller-v2/catalog");
      return;
    }
    setStep("catalog");
  }

  const loadCatalog = useCallback(async () => {
    try {
      setProducts(isResellerCheckout ? await api.catalogAll() : await api.catalog());
    } finally {
      setCatalogLoaded(true);
    }
  }, [isResellerCheckout]);

  useEffect(() => {
    loadCatalog().catch(console.error);
    api.health().then((health) => {
      if (health.ownerWhatsAppNumber) setOwnerWhatsApp(health.ownerWhatsAppNumber);
    }).catch(console.error);
    return subscribeRealtime(() => {
      loadCatalog().catch(console.error);
    });
  }, [loadCatalog]);

  useEffect(() => {
    const productId = searchParams.get("productId") || searchParams.get("product") || "";
    const variantId = searchParams.get("variantId") || searchParams.get("variant") || "";
    if (stateSelection) {
      const key = `${stateSelection.product.id}|${stateSelection.variant.id}|${stateSelection.duration}|${stateQuantity}`;
      if (autoCheckoutKey === key) return;
      const session = readSession();
      const user = session?.user || {};
      setSelection(stateSelection);
      setCatalogSelection(stateSelection);
      setOpenProductId(stateSelection.product.id);
      setQuantity(clampOrderQuantity(stateQuantity, stateSelection.variant.stockCount));
      setCreatedOrder(null);
      setPayment(null);
      setError("");
      setResellerCheck({ status: "idle", message: "" });
      if (session?.role === "reseller") {
        setCustomer((current) => current || user.name || user.username || "");
        setWhatsapp((current) => current || normalizeWhatsapp(user.whatsapp || ""));
      }
      setStep("details");
      setAutoCheckoutKey(key);
      return;
    }
    if (!productId || !variantId) {
      if (isResellerCheckout) navigate("/reseller-v2/catalog", { replace: true });
      return;
    }
    if (!products.length) {
      if (catalogLoaded && isResellerCheckout) setError("Katalog ready sedang kosong atau produk checkout sudah tidak tersedia. Pilih ulang dari katalog reseller.");
      return;
    }

    const durationParam = searchParams.get("duration") || "";
    const qtyParam = Number(searchParams.get("qty") || 1);
    const key = `${productId}|${variantId}|${durationParam}|${qtyParam}`;
    if (autoCheckoutKey === key) return;

    const product = products.find((item) => item.id === productId || item.code === productId);
    const variant = product?.variants.find((item) => item.id === variantId || item.code === variantId);
    if (!product || !variant) {
      if (isResellerCheckout) setError("Paket checkout tidak ditemukan. Pilih ulang produk dari katalog reseller.");
      return;
    }

    const fallback = firstDuration(variant);
    const hasDuration =
      durationParam &&
      Object.prototype.hasOwnProperty.call(variant.prices || {}, durationParam) &&
      durationAllowedByModes(durationParam, variant.durationModes);
    const duration = hasDuration ? durationParam : fallback.duration;
    const price = hasDuration ? Number(variant.prices?.[durationParam] || 0) : fallback.price;
    const selected = { product, variant, duration, price };
    const session = readSession();
    const user = session?.user || {};

    setSelection(selected);
    setCatalogSelection(selected);
    setQuantity(clampOrderQuantity(qtyParam, variant.stockCount));
    setCreatedOrder(null);
    setPayment(null);
    setError("");
    setResellerCheck({ status: "idle", message: "" });
    if (session?.role === "reseller") {
      setCustomer((current) => current || user.name || user.username || "");
      setWhatsapp((current) => current || normalizeWhatsapp(user.whatsapp || ""));
    }
    setStep("details");
    setAutoCheckoutKey(key);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [autoCheckoutKey, catalogLoaded, isResellerCheckout, navigate, products, searchParams, stateQuantity, stateSelection]);

  useEffect(() => {
    const orderId = searchParams.get("order") || "";
    if (!orderId || resumedOrderRef.current === orderId || !selection) return;
    resumedOrderRef.current = orderId;
    let cancelled = false;
    const resume = async () => {
      try {
        const latest = await api.order(orderId);
        if (cancelled) return;
        setCreatedOrder(latest);
        if (latest.paymentRef && Number(latest.paymentDue ?? latest.total ?? 0) > 0) {
          const latestPayment = await api.payment(latest.paymentRef);
          if (!cancelled) setPayment(latestPayment);
        }
        if (latest.orderStatus === "completed" || latest.deliveryStatus === "sent" || latest.deliveryStatus === "stock_unavailable_deposit") {
          setStep("done");
        } else if (latest.qrisStatus === "paid") {
          setStep("process");
        } else {
          setStep("payment");
        }
      } catch (resumeError) {
        if (!cancelled) {
          resumedOrderRef.current = "";
          setError(checkoutErrorMessage(resumeError));
        }
      }
    };
    resume().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [searchParams, selection]);

  useEffect(() => {
    function updateColumnCount() {
      if (window.innerWidth >= 1280) setColumnCount(3);
      else if (window.innerWidth >= 768) setColumnCount(2);
      else setColumnCount(1);
    }
    updateColumnCount();
    window.addEventListener("resize", updateColumnCount);
    return () => window.removeEventListener("resize", updateColumnCount);
  }, []);

  async function refreshCurrentOrder(options: { manual?: boolean } = {}) {
    if (!createdOrder?.id || paymentRefreshLockRef.current) return;
    paymentRefreshLockRef.current = true;
    if (options.manual) {
      setCheckingPayment(true);
      setError("");
    }
    try {
      const latest = await api.order(createdOrder.id);
      setCreatedOrder((current) => ({
        ...latest,
        fulfillmentText: latest.fulfillmentText || current?.fulfillmentText || "",
        snkText: latest.snkText || current?.snkText || "",
      }));
      if (latest.paymentRef && String(latest.qrisStatus || "").toLowerCase() !== "paid") {
        const nextPayment = await api.payment(latest.paymentRef);
        setPayment(nextPayment);
      }
      if (latest.orderStatus === "completed" || latest.deliveryStatus === "stock_unavailable_deposit") setStep("done");
      else if (latest.qrisStatus === "paid") setStep("process");
    } catch (refreshError) {
      if (options.manual) setError(checkoutErrorMessage(refreshError));
    } finally {
      paymentRefreshLockRef.current = false;
      if (options.manual) setCheckingPayment(false);
    }
  }

  const checkoutPollingTerminal = isTerminalCheckoutState(createdOrder, payment, countdownNow);

  useEffect(() => {
    if (
      !createdOrder?.id
      || (step !== "payment" && step !== "process")
      || checkoutPollingTerminal
    ) return;
    const timer = window.setInterval(() => {
      refreshCurrentOrder().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
    // The order id owns this polling lifecycle. The lock prevents overlapping requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutPollingTerminal, createdOrder?.id, step]);

  useEffect(() => {
    if (step !== "payment") return;
    setCountdownNow(Date.now());
    const timer = window.setInterval(() => setCountdownNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [step]);

  useEffect(() => {
    if (!isResellerCheckout || step !== "done" || !createdOrder?.id) return;
    if (verifiedCheckoutSessionRef.current === createdOrder.id) return;
    verifiedCheckoutSessionRef.current = createdOrder.id;
    api.authSession()
      .then((session) => updateSession(session))
      .catch(() => undefined);
  }, [createdOrder?.id, isResellerCheckout, step]);

  useEffect(() => {
    if (!credentialsVisible) return;
    if (credentialTimerRef.current) window.clearTimeout(credentialTimerRef.current);
    credentialTimerRef.current = window.setTimeout(() => {
      setCredentialsVisible(false);
      credentialTimerRef.current = null;
    }, 60_000);
    return () => {
      if (credentialTimerRef.current) window.clearTimeout(credentialTimerRef.current);
      credentialTimerRef.current = null;
    };
  }, [credentialsVisible]);

  useEffect(() => {
    if (step === "done") return;
    setCredentialsVisible(false);
    setCopiedValue("");
    setQrExpanded(false);
  }, [step]);

  useEffect(() => {
    if (!qrExpanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setQrExpanded(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [qrExpanded]);

  useEffect(() => {
    setTouched({ customer: false, customerData: false, whatsapp: false });
    setCheckoutData({});
    setEmail("");
    setSubmitAttempted(false);
  }, [selection?.product.id, selection?.variant.id]);

  useEffect(() => {
    const cleanWhatsapp = normalizeWhatsapp(whatsapp);
    if (step !== "details" || !cleanWhatsapp) {
      setResellerCheck({ status: "idle", message: "" });
      return;
    }
    if (cleanWhatsapp.length < 8) {
      setResellerCheck({ status: "idle", message: "Masukkan nomor WhatsApp reseller yang terdaftar." });
      return;
    }

    let cancelled = false;
    setResellerCheck({ status: "checking", message: "Mengecek nomor reseller..." });
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.checkReseller(cleanWhatsapp);
        if (cancelled) return;
        setResellerCheck(
          result.active
            ? { status: "valid", message: result.message || "Nomor reseller aktif, lanjut pembayaran bisa dilakukan." }
            : { status: "invalid", message: result.message || resellerOnlyMessage },
        );
      } catch (checkError) {
        if (cancelled) return;
        setResellerCheck({
          status: "invalid",
          message: checkError instanceof Error ? checkError.message : "Nomor reseller belum bisa diverifikasi.",
        });
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [step, whatsapp]);

  const categories = useMemo(() => ["Semua", ...Array.from(new Set(products.map((product) => product.category).filter(Boolean)))], [products]);

  const visibleProducts = useMemo(() => {
    const search = query.trim().toLowerCase();
    const rows = products.filter((product) => {
      const matchCategory = category === "Semua" || product.category === category;
      const matchQuery = !search || [product.name, product.category, product.code, product.description].join(" ").toLowerCase().includes(search);
      return matchCategory && matchQuery;
    });
    return [...rows].sort((a, b) => {
      if (sort === "Stok") return b.stockCount - a.stockCount;
      if (sort === "Termahal") return minPrice(b) - minPrice(a);
      return minPrice(a) - minPrice(b);
    });
  }, [category, products, query, sort]);

  const productColumns = useMemo(() => {
    const columns = Array.from({ length: columnCount }, () => [] as CatalogProduct[]);
    visibleProducts.forEach((product, index) => {
      columns[index % columnCount].push(product);
    });
    return columns;
  }, [columnCount, visibleProducts]);

  function selectPackage(product: CatalogProduct, variant = product.variants[0], duration?: string, price?: number) {
    const selectedDuration = duration ? { duration, price: Number(price || 0) } : firstDuration(variant);
    setSelection({
      product,
      variant,
      duration: selectedDuration.duration,
      price: selectedDuration.price,
    });
    setCreatedOrder(null);
    setPayment(null);
    setError("");
    setQuantity(1);
    setResellerCheck({ status: "idle", message: "" });
    setStep("details");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleProduct(product: CatalogProduct) {
    const nextOpenId = openProductId === product.id ? "" : product.id;
    setOpenProductId(nextOpenId);
    setCatalogSelection((current) => (nextOpenId && current?.product.id === nextOpenId ? current : null));
  }

  function selectCatalogVariant(product: CatalogProduct, variant: CatalogVariant, duration?: string, price?: number) {
    const selectedDuration = duration ? { duration, price: Number(price || 0) } : firstDuration(variant);
    setOpenProductId(product.id);
    setCatalogSelection({
      product,
      variant,
      duration: selectedDuration.duration,
      price: selectedDuration.price,
    });
  }

  function selectCatalogDuration(duration: string, price: number) {
    setCatalogSelection((current) => (current ? { ...current, duration, price: Number(price || 0) } : current));
  }

  async function startCatalogOrder() {
    if (!catalogSelection || prechecking) return;
    setError("");
    const session = readSession();
    const params = new URLSearchParams({
      productId: catalogSelection.product.id,
      variantId: catalogSelection.variant.id,
      duration: catalogSelection.duration,
      qty: "1",
      from: session?.role === "reseller" ? "reseller" : "products",
    });
    const target = `/reseller/checkout?${params.toString()}`;
    if (session?.role === "reseller") {
      navigate(target);
      return;
    }
    navigate(`/login?next=${encodeURIComponent(target)}`);
  }

  function changeQuantity(nextQuantity: number) {
    setQuantity(clampOrderQuantity(nextQuantity, selection?.variant.stockCount || 1));
  }

  const activeCheckoutRules = useMemo(
    () => checkoutRules(selection, clampOrderQuantity(quantity, selection?.variant.stockCount || 1)),
    [quantity, selection],
  );
  const hasStructuredCheckoutMetadata = Array.isArray(selection?.variant.checkoutFields)
    || Array.isArray(selection?.product.checkoutFields);
  const activeCheckoutFields = useMemo<CheckoutField[]>(() => {
    const configured = Array.isArray(selection?.variant.checkoutFields)
      ? selection.variant.checkoutFields
      : Array.isArray(selection?.product.checkoutFields)
        ? selection.product.checkoutFields
        : null;
    if (configured) {
      return configured.map((field) => field.key === "customerEmail"
        ? { ...field, minItems: Math.max(clampOrderQuantity(quantity, selection?.variant.stockCount || 1), Number(field.minItems || 1)) }
        : field);
    }
    if (activeCheckoutRules.customerField === "optional") return [];
    return [{
      key: activeCheckoutRules.customerField === "email" ? "customerEmail" : "customerDevice",
      label: activeCheckoutRules.label,
      type: activeCheckoutRules.customerField === "email" ? "email" : "text",
      required: activeCheckoutRules.required,
      minItems: activeCheckoutRules.minItems,
      placeholder: activeCheckoutRules.placeholder,
      helperText: activeCheckoutRules.helper,
    }];
  }, [activeCheckoutRules, quantity, selection]);

  const checkoutFieldErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const field of activeCheckoutFields) {
      const value = String(checkoutData[field.key] || "").trim();
      if (field.key === "customerEmail") {
        const emails = splitCustomerEmails(value);
        if (field.required && emails.length < Number(field.minItems || 1)) {
          errors[field.key] = `${field.label} wajib berisi minimal ${field.minItems || 1} email valid.`;
        } else if (value && emails.length !== value.split(/[\s,;]+/).filter(Boolean).length) {
          errors[field.key] = `${field.label} harus berisi email yang valid.`;
        }
      } else if (field.required && !value) {
        errors[field.key] = `${field.label} wajib diisi.`;
      } else if (field.key === "customerDevice" && field.required && splitDeviceNames(value).length < Number(field.minItems || 1)) {
        errors[field.key] = `${field.label} wajib berisi minimal ${field.minItems || 1} item.`;
      }
    }
    return errors;
  }, [activeCheckoutFields, checkoutData]);

  const fieldErrors = useMemo(() => {
    const next: Partial<Record<keyof CheckoutTouchedState, string>> = {};
    const cleanWhatsapp = normalizeWhatsapp(whatsapp);
    if (!customer.trim()) next.customer = "Nama reseller wajib diisi.";
    if (!cleanWhatsapp) next.whatsapp = "Nomor WhatsApp wajib diisi.";
    else if (cleanWhatsapp.length < 8) next.whatsapp = "Nomor WhatsApp belum lengkap.";

    if (Object.keys(checkoutFieldErrors).length) next.customerData = Object.values(checkoutFieldErrors)[0];
    return next;
  }, [checkoutFieldErrors, customer, whatsapp]);

  async function submitOrder() {
    if (!selection || submitLockRef.current) return;
    submitLockRef.current = true;
    setSubmitAttempted(true);
    setTouched({ customer: true, customerData: true, whatsapp: true });
    const cleanWhatsapp = normalizeWhatsapp(whatsapp);
    const orderQty = clampOrderQuantity(quantity, selection.variant.stockCount);
    if (Object.keys(fieldErrors).length > 0) {
      submitLockRef.current = false;
      return;
    }
    const rules = activeCheckoutRules;
    setSubmitting(true);
    setError("");
    try {
      const check = resellerCheck.status === "valid" ? { active: true, message: resellerCheck.message } : await api.checkReseller(cleanWhatsapp);
      if (!check.active) {
        const message = check.message || resellerOnlyMessage;
        setResellerCheck({ status: "invalid", message });
        setError(message);
        return;
      }
      setResellerCheck({ status: "valid", message: check.message || "Nomor reseller aktif, lanjut pembayaran bisa dilakukan." });

      const orderSession = readSession();
      const order = await api.createOrder({
        customer: customer.trim(),
        checkoutData,
        email: checkoutData.customerEmail || (rules.customerField === "email" ? email : ""),
        device: checkoutData.customerDevice || (rules.customerField === "device" ? email.trim() : ""),
        customerWhatsapp: checkoutData.customerWhatsapp || "",
        customerPlan: checkoutData.customerPlan || "",
        customerData: rules.customerField === "optional" ? email.trim() : "",
        whatsapp: cleanWhatsapp,
        note: note.trim(),
        productId: selection.product.id,
        variantId: selection.variant.id,
        duration: selection.duration,
        qty: orderQty,
        channel: orderSession?.role === "reseller" ? "Reseller Panel" : "Public Store",
      });
      setCreatedOrder(order);
      resumedOrderRef.current = order.id;
      const resumeParams = new URLSearchParams(searchParams);
      resumeParams.set("order", order.id);
      navigate(`${location.pathname}?${resumeParams.toString()}`, {
        replace: true,
        state: checkoutState || undefined,
      });
      if (order.orderStatus === "completed" || order.deliveryStatus === "sent" || order.deliveryStatus === "stock_unavailable_deposit") {
        setPayment(null);
        setStep("done");
        return;
      }
      if (order.paymentRef && Number(order.paymentDue ?? order.total ?? 0) > 0) {
        const paymentData = await api.payment(order.paymentRef);
        setPayment(paymentData);
        setStep("payment");
        return;
      }
      setStep("process");
    } catch (orderError) {
      setError(checkoutErrorMessage(orderError));
    } finally {
      setSubmitting(false);
      submitLockRef.current = false;
    }
  }

  const activeStep = step === "details" ? 0 : step === "done" ? 2 : 1;
  const qrSrc = qrImageSource(payment);
  const fulfillment = splitFulfillmentDisplayText(createdOrder?.fulfillmentText || "");
  const stockRaceDeposit = createdOrder?.deliveryStatus === "stock_unavailable_deposit";
  const depositUsed = Number(createdOrder?.depositUsed || payment?.depositUsed || 0);
  const paymentDue = Number(createdOrder?.paymentDue ?? payment?.amount ?? createdOrder?.total ?? 0);
  const qrisNominal = Number(payment?.amount ?? createdOrder?.paymentDue ?? paymentDue ?? 0);
  const qrisFee = Number(payment?.fee ?? createdOrder?.paymentFee ?? 0);
  const qrisProviderTotal = Number(payment?.totalPayment || 0);
  const qrisBreakdown = customerPaymentBreakdown(qrisNominal, qrisFee, qrisProviderTotal);
  const qrisCustomerFee = qrisBreakdown.customerFee;
  const qrisTotal = qrisBreakdown.total;
  const countdown = paymentCountdown(createdOrder?.paymentExpiresAt || payment?.expiresAt || "", countdownNow);
  const currentPaymentStatus = checkingPayment
    ? "checking"
    : countdown.expired
      ? "expired"
      : String(payment?.status || createdOrder?.qrisStatus || "pending").toLowerCase();
  const trackingHref = createdOrder?.trackingToken
    ? `/order-tracking?token=${encodeURIComponent(createdOrder.trackingToken)}`
    : `/order-tracking?order=${encodeURIComponent(createdOrder?.id || "")}`;
  const deliveredCredentialText = (createdOrder?.deliveredAccounts || [])
    .map((account, index) => [
      `Akun ${index + 1}`,
      account.email ? `Email/Identitas: ${account.email}` : "",
      account.password ? `Password/Link: ${account.password}` : "",
      account.profile ? `Profil: ${account.profile}` : "",
      account.pin ? `PIN: ${account.pin}` : "",
    ].filter(Boolean).join("\n"))
    .join("\n\n");
  const credentialText = deliveredCredentialText || fulfillment.account;
  const deliverySnapshot = createdOrder?.deliveryTemplateSnapshot;
  const fallbackDeliveryText = String(createdOrder?.fulfillmentText || credentialText || "").trim();
  const deliveryTemplateText = deliverySnapshot?.status === "ready"
    ? deliverySnapshot.renderedText || fallbackDeliveryText
    : fallbackDeliveryText;
  const deliveryTemplateLabel = deliverySnapshot?.status === "ready"
    ? "Siap dikirim ke customer"
    : deliveryTemplateText
      ? "Siap dari detail akun"
      : deliverySnapshot?.status === "incomplete"
        ? "Detail akun belum lengkap"
        : "Template belum dikonfigurasi";
  const deliveryTemplateEmptyText = deliverySnapshot?.status === "incomplete"
    ? `Owner perlu melengkapi: ${(deliverySnapshot.missingFields || []).join(", ") || "detail akun"}.`
    : "Template pengiriman untuk varian ini belum tersedia.";
  const deliveredAccountId = createdOrder?.deliveredAccounts?.[0]?.id || "";
  const deliveredAccount = createdOrder?.deliveredAccounts?.[0];
  const templateFields = new Set(deliverySnapshot?.usedFields || []);
  const deliveryCredentialFields = [
    {
      key: "identity",
      label: deliveredAccount?.loginPhone ? "Nomor Login" : "Email / Username",
      value: deliveredAccount?.loginPhone || deliveredAccount?.email || "",
      used: templateFields.has("login_identifier") || templateFields.has("email") || templateFields.has("username"),
    },
    {
      key: "password",
      label: deliveredAccount?.canvaLink ? "Link" : "Password",
      value: deliveredAccount?.canvaLink || deliveredAccount?.password || "",
      used: templateFields.has("password") || templateFields.has("link"),
    },
    { key: "profile", label: "Profil", value: deliveredAccount?.profile || "", used: templateFields.has("profile") },
    { key: "pin", label: "PIN", value: deliveredAccount?.pin || "", used: templateFields.has("pin") },
  ].filter((field) => field.value && (deliverySnapshot ? field.used : true));
  const canShowCredentials = Boolean(
    isAuthenticatedResellerCheckout
    && step === "done"
    && credentialText,
  );
  const resellerCheckoutWaiting = isResellerCheckout && step !== "catalog" && !selection;

  async function copyCheckoutValue(key: string, value: string) {
    if (!value || !navigator.clipboard) return;
    await navigator.clipboard.writeText(value);
    if (key === "template" && deliveredAccountId) {
      api.recordDeliveryTemplateCopied(deliveredAccountId).catch(() => undefined);
    }
    setCopiedValue(key);
    window.setTimeout(() => setCopiedValue((current) => (current === key ? "" : current)), 1800);
  }

  if (resellerCheckoutWaiting) {
    return (
      
        <main className="kavya-public-dark min-h-screen bg-[var(--bg-canvas)] px-4 py-8 text-[var(--text-primary)]">
          <header className="mx-auto flex max-w-6xl items-center justify-between">
            <button type="button" onClick={backToCatalog} className="inline-flex min-h-11 items-center gap-3 rounded-lg font-semibold">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] font-serif">K</span>
              <span>Kavya</span>
            </button>
            <Link to="/reseller-v2/catalog" className="inline-flex min-h-11 items-center rounded-full border border-[var(--border)] px-5 text-sm font-medium text-[var(--text-secondary)]">
              Katalog
            </Link>
          </header>
          <section className="mx-auto mt-16 max-w-xl rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
            {error ? (
              <>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-rose-400/20 bg-rose-400/10 text-rose-300">
                  <i className="ri-error-warning-line text-xl" />
                </div>
                <h1 className="mt-4 text-lg font-semibold">Checkout tidak tersedia</h1>
                <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{error}</p>
                <button type="button" onClick={backToCatalog} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-zinc-200">
                  Pilih Produk Lain
                </button>
              </>
            ) : (
              <>
                <div className="mx-auto h-12 w-12 animate-spin rounded-full border-2 border-white/10 border-t-[var(--accent-cyan)]" />
                <h1 className="mt-4 text-lg font-semibold">Menyiapkan checkout</h1>
                <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">Menyiapkan paket order dari katalog reseller.</p>
              </>
            )}
          </section>
        </main>
      
    );
  }

  if (step !== "catalog") {
    return (
      
        <main className="kavya-public-dark min-h-screen bg-[var(--bg-canvas)] px-4 py-6 text-[var(--text-primary)] sm:px-6 sm:py-8">
          <header className="mx-auto flex max-w-6xl items-center justify-between">
            <button type="button" onClick={backToCatalog} className="inline-flex min-h-11 items-center gap-3 rounded-lg font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] font-serif">K</span>
              <span>Kavya</span>
            </button>
            <Link to={isResellerCheckout ? "/reseller-v2/catalog" : "/"} className="inline-flex min-h-11 items-center rounded-lg border border-white/10 px-4 text-sm font-medium text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-white">
              {isResellerCheckout ? "Katalog" : "Beranda"}
            </Link>
          </header>

          <div aria-label="Tahap checkout" className="mx-auto mt-8 grid max-w-xl grid-cols-3 gap-2 px-1 text-xs sm:mt-10 sm:flex sm:items-center sm:justify-center sm:gap-4">
            {steps.map((item, index) => (
              <div key={item.id} className="flex min-w-0 flex-col items-center gap-2 sm:flex-row sm:gap-4" aria-current={index === activeStep ? "step" : undefined}>
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${index <= activeStep ? "border-white bg-white text-black" : "border-white/10 bg-white/[0.03] text-zinc-600"}`}>
                  {index + 1}
                </div>
                <span className={`${index <= activeStep ? "font-semibold text-zinc-100" : "text-zinc-600"} text-center text-[11px] leading-4 sm:whitespace-nowrap sm:text-xs`}>{item.label}</span>
                {index < steps.length - 1 ? <span className={`hidden h-px w-14 shrink-0 sm:block ${index < activeStep ? "bg-white/50" : "bg-white/10"}`} /> : null}
              </div>
            ))}
          </div>

          <section className="mx-auto mt-8 max-w-6xl overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="border-b border-white/[0.09] px-5 py-4 sm:px-7">
              <h1 className="text-base font-semibold text-white">
                {step === "payment" ? "Selesaikan pembayaran" : step === "done" ? "Pembayaran berhasil" : step === "process" ? "Pesanan sedang diproses" : `Pesan ${selection?.product.name || "Produk"}`}
              </h1>
            </div>

            {step === "details" ? (
              <div className="grid gap-6 p-5 text-zinc-200 sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)] lg:items-start">
                <div className="min-w-0 space-y-6">
                  {isAuthenticatedResellerCheckout ? (
                    <div className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-white">Data reseller</p>
                        <span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-2.5 py-1 text-[11px] font-semibold text-violet-200">
                          Terisi dari akun reseller
                        </span>
                      </div>
                      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                        <div><dt className="text-xs text-zinc-500">Username</dt><dd className="mt-1 text-zinc-200">{resellerUser.username || "-"}</dd></div>
                        <div><dt className="text-xs text-zinc-500">Email akun</dt><dd className="mt-1 break-all text-zinc-200">{resellerUser.email || "-"}</dd></div>
                      </dl>
                    </div>
                  ) : null}

                  <div className="grid gap-4">
                    <label className="block">
                      <span className="flex items-center justify-between gap-3 text-sm font-medium">
                        <span>Nama reseller <span className="text-rose-400">*</span></span>
                        {resellerNameLocked ? <span className="text-[11px] font-normal text-zinc-500">Terisi dari akun reseller</span> : null}
                      </span>
                      <input
                        value={customer}
                        onChange={(event) => setCustomer(event.target.value)}
                        onBlur={() => setTouched((current) => ({ ...current, customer: true }))}
                        readOnly={resellerNameLocked}
                        aria-invalid={Boolean((touched.customer || submitAttempted) && fieldErrors.customer)}
                        aria-describedby={fieldErrors.customer ? "checkout-customer-error" : undefined}
                        className="mt-2 h-12 w-full rounded-lg border border-white/10 bg-[var(--bg-raised)] px-4 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet-400/70 focus:ring-2 focus:ring-violet-400/15 read-only:cursor-not-allowed read-only:border-white/[0.06] read-only:bg-white/[0.025] read-only:text-zinc-400"
                        placeholder="Masukkan nama reseller"
                      />
                      {(touched.customer || submitAttempted) && fieldErrors.customer ? <span id="checkout-customer-error" className="mt-2 block text-xs text-rose-300">{fieldErrors.customer}</span> : null}
                    </label>

                    {activeCheckoutFields.map((field) => {
                      const fieldId = `checkout-${field.key}`;
                      const fieldError = checkoutFieldErrors[field.key];
                      const showError = Boolean((touched.customerData || submitAttempted) && fieldError);
                      return <label className="block" key={field.key}>
                        <span className="text-sm font-medium">
                          {field.label}
                          {field.required ? <span className="text-rose-400"> *</span> : null}
                        </span>
                        {field.type === "select" ? (
                          <select
                            value={checkoutData[field.key] || ""}
                            onChange={(event) => setCheckoutData((current) => ({ ...current, [field.key]: event.target.value }))}
                            onBlur={() => setTouched((current) => ({ ...current, customerData: true }))}
                            aria-invalid={showError}
                            aria-describedby={showError ? `${fieldId}-error` : field.helperText ? `${fieldId}-help` : undefined}
                            className="mt-2 h-12 w-full rounded-lg border border-white/10 bg-[var(--bg-raised)] px-4 text-sm text-white outline-none focus:border-violet-400/70 focus:ring-2 focus:ring-violet-400/15"
                          >
                            <option value="">Pilih {field.label.toLowerCase()}</option>
                            {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        ) : (
                          <input
                            type={field.type}
                            autoComplete={field.type === "email" ? "email" : field.type === "tel" ? "tel" : undefined}
                            value={checkoutData[field.key] || ""}
                            onChange={(event) => setCheckoutData((current) => ({ ...current, [field.key]: event.target.value }))}
                            onBlur={() => setTouched((current) => ({ ...current, customerData: true }))}
                            aria-invalid={showError}
                            aria-describedby={showError ? `${fieldId}-error` : field.helperText ? `${fieldId}-help` : undefined}
                            className="mt-2 h-12 w-full rounded-lg border border-white/10 bg-[var(--bg-raised)] px-4 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet-400/70 focus:ring-2 focus:ring-violet-400/15"
                            placeholder={field.placeholder}
                          />
                        )}
                        {showError ? (
                          <span id={`${fieldId}-error`} className="mt-2 block text-xs text-rose-300">{fieldError}</span>
                        ) : field.helperText ? (
                          <span id={`${fieldId}-help`} className="mt-2 block text-xs leading-5 text-zinc-500">{field.helperText}</span>
                        ) : null}
                      </label>;
                    })}
                    {!hasStructuredCheckoutMetadata && !activeCheckoutFields.length && activeCheckoutRules.customerField === "optional" ? (
                      <label className="block">
                        <span className="text-sm font-medium">{activeCheckoutRules.label} <span className="font-normal text-zinc-500">(opsional)</span></span>
                        <input
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          className="mt-2 h-12 w-full rounded-lg border border-white/10 bg-[var(--bg-raised)] px-4 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet-400/70 focus:ring-2 focus:ring-violet-400/15"
                          placeholder={activeCheckoutRules.placeholder}
                        />
                      </label>
                    ) : null}

                    <label className="block">
                      <span className="flex items-center justify-between gap-3 text-sm font-medium">
                        <span>WhatsApp reseller <span className="text-rose-400">*</span></span>
                        {resellerWhatsappLocked ? <span className="text-[11px] font-normal text-zinc-500">Terisi dari akun reseller</span> : null}
                      </span>
                      <input
                        value={whatsapp}
                        onChange={(event) => setWhatsapp(event.target.value)}
                        onBlur={() => setTouched((current) => ({ ...current, whatsapp: true }))}
                        readOnly={resellerWhatsappLocked}
                        aria-invalid={Boolean((touched.whatsapp || submitAttempted) && fieldErrors.whatsapp)}
                        aria-describedby={fieldErrors.whatsapp ? "checkout-whatsapp-error" : resellerCheck.message ? "checkout-whatsapp-status" : undefined}
                        className="mt-2 h-12 w-full rounded-lg border border-white/10 bg-[var(--bg-raised)] px-4 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet-400/70 focus:ring-2 focus:ring-violet-400/15 read-only:cursor-not-allowed read-only:border-white/[0.06] read-only:bg-white/[0.025] read-only:text-zinc-400"
                        placeholder="08123456789"
                      />
                      {(touched.whatsapp || submitAttempted) && fieldErrors.whatsapp ? <span id="checkout-whatsapp-error" className="mt-2 block text-xs text-rose-300">{fieldErrors.whatsapp}</span> : null}
                      {resellerCheck.message && !fieldErrors.whatsapp ? (
                        <span
                          id="checkout-whatsapp-status"
                          className={`mt-2 block rounded-md border px-3 py-2 text-xs font-medium ${
                            resellerCheck.status === "valid"
                              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                              : resellerCheck.status === "checking"
                                ? "border-white/10 bg-white/[0.03] text-zinc-400"
                                : "border-rose-400/20 bg-rose-400/10 text-rose-300"
                          }`}
                        >
                          {resellerCheck.message}
                        </span>
                      ) : null}
                    </label>

                    <label className="block">
                      <span className="text-sm font-medium">Catatan <span className="font-normal text-zinc-500">(opsional)</span></span>
                      <textarea value={note} onChange={(event) => setNote(event.target.value.slice(0, 500))} className="mt-2 h-24 w-full resize-none rounded-lg border border-white/10 bg-[var(--bg-raised)] px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet-400/70 focus:ring-2 focus:ring-violet-400/15" placeholder="Catatan tambahan untuk pesanan..." />
                      <span className="mt-1 block text-right text-xs text-zinc-600">{note.length}/500</span>
                    </label>
                  </div>
                </div>

                <aside className="rounded-lg border border-white/[0.09] bg-[var(--bg-raised)] p-5 lg:sticky lg:top-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Ringkasan pesanan</p>
                      <h2 className="mt-3 text-lg font-semibold text-white">{selection?.product.name || "Produk"}</h2>
                      <p className="mt-1 text-sm text-zinc-400">{selection?.variant.name || "-"}</p>
                    </div>
                    <button type="button" onClick={backToCatalog} className="min-h-11 shrink-0 rounded-lg border border-white/10 px-3 text-xs font-semibold text-zinc-300 hover:border-white/20 hover:bg-white/[0.04]">
                      Ganti
                    </button>
                  </div>

                  <dl className="mt-5 space-y-3 border-y border-white/[0.08] py-5 text-sm">
                    <div className="flex items-center justify-between gap-3"><dt className="text-zinc-500">Durasi</dt><dd className="font-medium text-zinc-200">{selection?.duration || "-"}</dd></div>
                    <div className="flex items-center justify-between gap-3"><dt className="text-zinc-500">Harga per akun</dt><dd className="font-medium text-zinc-200">{formatRupiah(selection?.price || 0)}</dd></div>
                    <div className="flex items-center justify-between gap-3"><dt className="text-zinc-500">Stok tersedia</dt><dd className="font-medium text-zinc-200">{selection?.variant.stockCount || 0}</dd></div>
                  </dl>

                  <div className="mt-5 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-zinc-200">Jumlah akun</p>
                      <p className="mt-1 text-xs text-zinc-500">Maksimal sesuai stok aktif.</p>
                    </div>
                    <div className="inline-flex h-11 items-center overflow-hidden rounded-lg border border-white/10 bg-black/20">
                      <button type="button" onClick={() => changeQuantity(quantity - 1)} disabled={quantity <= 1} className="flex h-11 w-11 items-center justify-center text-zinc-400 hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:text-zinc-700" aria-label="Kurangi jumlah akun">
                        <i className="ri-subtract-line" />
                      </button>
                      <input value={quantity} onChange={(event) => changeQuantity(Number(event.target.value))} className="h-11 w-12 border-x border-white/10 bg-transparent text-center text-sm font-semibold text-white outline-none focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400/70" inputMode="numeric" aria-label="Jumlah akun" />
                      <button type="button" onClick={() => changeQuantity(quantity + 1)} disabled={quantity >= (selection?.variant.stockCount || 1)} className="flex h-11 w-11 items-center justify-center text-zinc-400 hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:text-zinc-700" aria-label="Tambah jumlah akun">
                        <i className="ri-add-line" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 flex items-end justify-between gap-4 border-t border-white/[0.08] pt-5">
                    <span className="text-sm text-zinc-400">Total pembayaran</span>
                    <strong className="text-2xl font-semibold tracking-tight text-white">{formatRupiah((selection?.price || 0) * quantity)}</strong>
                  </div>

                  {error ? <div role="alert" className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

                  <button
                    type="button"
                    onClick={submitOrder}
                    disabled={submitting || !selection || resellerCheck.status === "checking" || resellerCheck.status === "invalid"}
                    className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                  >
                    {submitting ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" aria-hidden="true" /> : <i className="ri-arrow-right-line" aria-hidden="true" />}
                    {submitting ? "Memproses pesanan..." : "Lanjut ke Pembayaran"}
                  </button>
                  <p className="mt-3 text-center text-xs leading-5 text-zinc-600">Tombol dikunci selama proses agar pesanan tidak dibuat dua kali.</p>
                </aside>
              </div>
            ) : null}

            {step === "payment" ? (
              <div className="grid gap-6 p-5 sm:p-7 md:grid-cols-[0.92fr_1.08fr]">
                <div className="rounded-lg border border-white/[0.08] bg-[var(--bg-raised)] p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.15em] text-zinc-600">Ringkasan pesanan</p>
                  <h2 className="mt-4 text-xl font-semibold text-white">{createdOrder?.product}</h2>
                  <p className="mt-1 text-sm leading-6 text-zinc-400">
                    {createdOrder?.variant} / {createdOrder?.duration} / {createdOrder?.qty || 1} akun
                  </p>
                  <div className="mt-5 text-3xl font-semibold tracking-tight text-white">{formatRupiah(createdOrder?.total || 0)}</div>
                  <dl className="mt-6 space-y-3 border-t border-white/[0.08] pt-5 text-sm">
                      {depositUsed > 0 ? (
                        <div className="flex items-center justify-between gap-3 text-zinc-500">
                          <dt>Deposit dipakai</dt>
                          <dd className="font-medium text-zinc-200">{formatRupiah(depositUsed)}</dd>
                        </div>
                      ) : null}
                      <div className="flex items-center justify-between gap-3 text-zinc-500">
                        <dt>Nominal</dt>
                        <dd className="font-medium text-zinc-200">{formatRupiah(qrisNominal || paymentDue)}</dd>
                      </div>
                      {qrisCustomerFee > 0 ? (
                        <div className="flex items-center justify-between gap-3 text-zinc-500">
                          <dt>Biaya admin</dt>
                          <dd className="font-medium text-zinc-200">{formatRupiah(qrisCustomerFee)}</dd>
                        </div>
                      ) : null}
                      <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] pt-3 text-zinc-300">
                        <dt>Total pembayaran</dt>
                        <dd className="font-semibold text-white">{formatRupiah(qrisTotal || paymentDue)}</dd>
                      </div>
                  </dl>
                  <dl className="mt-6 space-y-3 border-t border-white/[0.08] pt-5 text-sm">
                    <div>
                      <dt className="text-xs uppercase tracking-wider text-zinc-600">Nomor pesanan</dt>
                      <dd className="mt-2 flex min-w-0 items-center gap-2">
                        <span className="min-w-0 break-all font-mono text-xs text-zinc-300">{createdOrder?.id}</span>
                        <button type="button" onClick={() => copyCheckoutValue("order", createdOrder?.id || "")} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 text-zinc-400 hover:border-white/20 hover:text-white" aria-label="Salin nomor pesanan">
                          <i className={copiedValue === "order" ? "ri-check-line text-emerald-300" : "ri-file-copy-line"} />
                        </button>
                      </dd>
                    </div>
                    <div><dt className="text-xs uppercase tracking-wider text-zinc-600">Metode pembayaran</dt><dd className="mt-1 text-zinc-300">{payment?.paymentMethod || createdOrder?.paymentMethod || "QRIS"}</dd></div>
                    <div><dt className="text-xs uppercase tracking-wider text-zinc-600">Status pembayaran</dt><dd className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${paymentStatusTone(currentPaymentStatus)}`}>{paymentStatusLabel(currentPaymentStatus)}</dd></div>
                    <div><dt className="text-xs uppercase tracking-wider text-zinc-600">Batas pembayaran</dt><dd className="mt-1 text-zinc-300">{formatCheckoutDate(createdOrder?.paymentExpiresAt || payment?.expiresAt || "")}</dd></div>
                  </dl>
                </div>

                <div className="rounded-lg border border-white/[0.08] bg-[var(--bg-raised)] p-5 text-center">
                  <div className="flex items-center justify-between gap-3 text-left">
                    <div>
                      <p className="text-base font-semibold text-white">{paymentStatusLabel(currentPaymentStatus)}</p>
                      <p className="mt-1 text-sm text-zinc-500">Status pembayaran akan diperbarui secara otomatis.</p>
                    </div>
                    <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${countdown.expired ? "border-rose-400/20 bg-rose-400/10 text-rose-300" : "border-cyan-300/20 bg-cyan-300/10 text-cyan-200"}`}>
                      {countdown.label}
                    </span>
                  </div>
                  {qrSrc ? (
                    <button type="button" onClick={() => setQrExpanded(true)} className="mx-auto mt-5 flex aspect-square w-full max-w-[280px] items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-white p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-400 sm:max-w-[300px]" aria-label="Perbesar QRIS">
                      <img src={qrSrc} alt="QRIS pembayaran Kavya" className="h-full w-full object-contain" />
                    </button>
                  ) : (
                    <div className="mx-auto mt-5 flex aspect-square w-full max-w-[280px] items-center justify-center rounded-lg border border-white/10 bg-white/[0.025] p-4 text-sm text-zinc-500">
                      QRIS belum tersedia. Coba periksa status.
                    </div>
                  )}
                  {qrSrc ? <p className="mt-2 text-xs text-zinc-600">Tekan QRIS untuk memperbesar.</p> : null}
                  {payment?.providerError || createdOrder?.paymentError ? (
                    <div role="alert" className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-left text-sm text-amber-200">
                      Pembayaran belum dapat diperiksa. Coba lagi atau hubungi bantuan.
                    </div>
                  ) : null}
                  {error ? <div role="alert" className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-left text-sm text-rose-200">{error}</div> : null}
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => refreshCurrentOrder({ manual: true })}
                      disabled={checkingPayment || paymentRefreshLockRef.current}
                      className="inline-flex min-h-12 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {checkingPayment ? <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" aria-hidden="true" /> : null}
                      {checkingPayment ? "Sedang memeriksa..." : "Cek Status Pembayaran"}
                    </button>
                    {payment?.paymentUrl || createdOrder?.qrisUrl ? (
                      <a href={payment?.paymentUrl || createdOrder?.qrisUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/10 px-4 text-sm font-semibold text-zinc-200 transition-colors hover:border-white/20 hover:bg-white/[0.04]">
                        Buka Halaman Pembayaran
                      </a>
                    ) : null}
                  </div>
                  <div className="mt-5 border-t border-white/[0.08] pt-4 text-left text-sm text-zinc-500">
                    Bermasalah saat membayar? <a href={ownerContactHref(ownerWhatsApp, createdOrder?.id || "")} target="_blank" rel="noreferrer" className="font-medium text-zinc-200 underline decoration-white/20 underline-offset-4 hover:text-white">Hubungi bantuan</a>
                  </div>
                </div>
                {qrExpanded && qrSrc ? (
                  <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="QRIS diperbesar" onClick={() => setQrExpanded(false)}>
                    <div className="w-full max-w-md rounded-xl border border-white/10 bg-[var(--surface)] p-4" onClick={(event) => event.stopPropagation()}>
                      <div className="flex items-center justify-between gap-3">
                        <div><p className="font-semibold text-white">QRIS Pembayaran</p><p className="mt-1 break-all font-mono text-xs text-zinc-500">{createdOrder?.id}</p></div>
                        <button type="button" onClick={() => setQrExpanded(false)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 text-zinc-400 hover:text-white" aria-label="Tutup QRIS">
                          <i className="ri-close-line text-xl" />
                        </button>
                      </div>
                      <div className="mt-4 aspect-square overflow-hidden rounded-lg bg-white p-3">
                        <img src={qrSrc} alt="QRIS pembayaran Kavya diperbesar" className="h-full w-full object-contain" />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {step === "process" || step === "done" ? (
              <div className="p-6 text-center sm:p-10">
                <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full border ${step === "done" ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-amber-300/20 bg-amber-300/10 text-amber-200"}`}>
                  <i className={step === "done" ? "ri-check-line text-2xl" : "ri-time-line text-2xl"} />
                </div>
                <h2 className="mt-5 text-2xl font-semibold text-white">{stockRaceDeposit ? "Stok habis, saldo bertambah" : step === "done" ? "Pesanan selesai" : "Pembayaran berhasil"}</h2>
                <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-zinc-400">
                  {stockRaceDeposit
                    ? "Pembayaran sudah diterima, tapi stok produk sudah habis. Nominal order otomatis masuk ke saldo reseller untuk order berikutnya."
                    : step === "done"
                      ? `Akun ${createdOrder?.product || "produk"} berhasil diberikan dan sudah tersimpan di menu Akun Saya.`
                      : "Pesananmu sudah diterima dan sedang diproses."}
                </p>
                {createdOrder ? (
                  <dl className="mx-auto mt-6 grid max-w-3xl gap-px overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.08] text-left sm:grid-cols-2 lg:grid-cols-4">
                    <div className="bg-[var(--bg-raised)] p-4"><dt className="text-xs uppercase tracking-wider text-zinc-600">Nomor pesanan</dt><dd className="mt-2 break-all font-mono text-xs text-zinc-300">{createdOrder.id}</dd></div>
                    <div className="bg-[var(--bg-raised)] p-4"><dt className="text-xs uppercase tracking-wider text-zinc-600">Produk</dt><dd className="mt-2 text-sm font-medium text-zinc-200">{createdOrder.product}<span className="mt-1 block text-xs font-normal text-zinc-500">{createdOrder.variant}</span></dd></div>
                    <div className="bg-[var(--bg-raised)] p-4"><dt className="text-xs uppercase tracking-wider text-zinc-600">Nominal</dt><dd className="mt-2 text-sm font-medium text-zinc-200">{formatRupiah(createdOrder.total || 0)}</dd></div>
                    <div className="bg-[var(--bg-raised)] p-4"><dt className="text-xs uppercase tracking-wider text-zinc-600">Waktu pembayaran</dt><dd className="mt-2 text-sm text-zinc-300">{formatCheckoutDate(createdOrder.paidAt || "")}</dd></div>
                  </dl>
                ) : null}
                {step === "done" && canShowCredentials ? (
                  <div className="mx-auto mt-5 max-w-4xl rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] px-4 py-3 text-left text-sm text-emerald-200">
                    Akun baru berhasil ditambahkan ke Akun Saya.
                  </div>
                ) : null}
                {canShowCredentials ? (
                  <div className="mx-auto mt-5 grid max-w-4xl gap-4 text-left md:grid-cols-2">
                    <div className="min-w-0 rounded-lg border border-emerald-400/15 bg-emerald-400/[0.04] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-zinc-100">Detail Akun</p>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setCredentialsVisible((visible) => !visible)} className="min-h-9 rounded-lg border border-white/10 px-3 text-xs font-semibold text-zinc-300 hover:border-white/20 hover:text-white">
                            {credentialsVisible ? "Sembunyikan" : "Tampilkan"}
                          </button>
                          <button type="button" onClick={() => copyCheckoutValue("credential", credentialText)} disabled={!credentialsVisible} className="min-h-9 rounded-lg border border-white/10 px-3 text-xs font-semibold text-zinc-300 hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
                            {copiedValue === "credential" ? "Tersalin" : "Salin"}
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 min-h-36 rounded-md border border-white/[0.06] bg-black/20 p-4">
                        {credentialsVisible ? (
                          <div className="space-y-2">
                            {deliveryCredentialFields.length ? deliveryCredentialFields.map((field) => (
                              <div key={field.key} className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-white/[0.06] px-3 py-2">
                                <div className="min-w-0"><span className="block text-[11px] uppercase tracking-wide text-zinc-600">{field.label}</span><strong className="mt-0.5 block break-all font-mono text-xs font-medium text-zinc-300">{field.value}</strong></div>
                                <button type="button" onClick={() => copyCheckoutValue(field.key, field.value)} className="shrink-0 rounded-md border border-white/10 px-2.5 py-2 text-[11px] font-semibold text-zinc-300 hover:text-white">{copiedValue === field.key ? "Tersalin" : "Salin"}</button>
                              </div>
                            )) : <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-zinc-300">{credentialText}</pre>}
                          </div>
                        ) : (
                          <div className="flex min-h-28 items-center justify-center text-center text-sm leading-6 text-zinc-500">
                            Credential disembunyikan. Tekan Tampilkan untuk melihat selama 60 detik.
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="min-w-0 rounded-lg border border-violet-300/15 bg-violet-300/[0.04] p-4">
                      <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
                        <div><p className="text-sm font-semibold text-zinc-100">Template Siap Kirim</p><p className="mt-1 text-xs text-zinc-500">{deliveryTemplateLabel}</p></div>
                        {deliveryTemplateText ? <button type="button" onClick={() => copyCheckoutValue("template", deliveryTemplateText)} className="min-h-9 rounded-lg bg-white px-3 text-xs font-semibold text-black hover:bg-zinc-200">{copiedValue === "template" ? "Template berhasil disalin" : "Salin Semua"}</button> : null}
                      </div>
                      {deliveryTemplateText ? <pre className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-white/[0.06] bg-black/20 p-4 font-mono text-xs leading-5 text-zinc-300">{deliveryTemplateText}</pre> : <div className="mt-3 flex min-h-36 items-center justify-center rounded-md border border-white/[0.06] bg-black/20 p-4 text-center text-sm leading-6 text-zinc-500">{deliveryTemplateEmptyText}</div>}
                    </div>
                  </div>
                ) : null}
                <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap">
                  <Link to={isAuthenticatedResellerCheckout && deliveredAccountId ? `/reseller-v2/accounts?account=${encodeURIComponent(deliveredAccountId)}&tab=template` : isResellerCheckout ? "/reseller-v2/accounts" : trackingHref} className="inline-flex min-h-12 items-center justify-center rounded-lg bg-white px-5 text-sm font-semibold text-black transition-colors hover:bg-zinc-200">
                    {isAuthenticatedResellerCheckout ? "Lihat Akun yang Dibeli" : "Lacak Pesanan"}
                  </Link>
                  {isAuthenticatedResellerCheckout ? <Link to="/reseller-v2/orders" className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/10 px-5 text-sm font-semibold text-zinc-200 transition-colors hover:border-white/20 hover:bg-white/[0.04]">Lihat Pesanan</Link> : null}
                  <Link to={isAuthenticatedResellerCheckout ? "/reseller-v2/ringkasan" : "/"} className="inline-flex min-h-12 items-center justify-center rounded-lg px-5 text-sm font-medium text-zinc-500 transition-colors hover:text-white">
                    {isAuthenticatedResellerCheckout ? "Kembali ke Ringkasan" : "Kembali ke Beranda"}
                  </Link>
                </div>
              </div>
            ) : null}
          </section>

          <p className="mt-10 text-center text-sm text-zinc-600">Pembayaran terhubung langsung dengan status pesanan Kavya.</p>
        </main>
      
    );
  }

  return (
    
      <main className="min-h-screen bg-[#f4eee4] px-4 py-6 text-slate-950">
        <section className="mx-auto min-h-[calc(100vh-48px)] max-w-6xl rounded-md border border-gray-200 bg-[#fbf6ef] px-5 py-5">
          <header className="flex items-center justify-between">
            <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[#2b2b2b] text-white">K</span>
              Kavya
            </Link>
            <nav className="flex items-center gap-5 text-xs font-medium">
              <Link to="/" className="text-slate-600 hover:text-red-600">Beranda</Link>
              <Link to="/products" className="text-slate-900">Produk</Link>
              <Link to="/order-tracking" className="text-slate-600 hover:text-red-600">Lacak Pesanan</Link>
              <Link to="/login" className="rounded-md bg-[#2b2b2b] px-4 py-2 text-white">Masuk</Link>
            </nav>
          </header>

          <div className="mx-auto mt-8 max-w-2xl text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">Digital Account Catalog</p>
            <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight md:text-5xl">Pilih Paket Akun Digital</h1>
            <p className="mx-auto mt-4 max-w-lg text-base leading-7 text-slate-500">
              Semua akun premium dengan garansi penuh selama masa langganan. Harga terjangkau, proses cepat, aman terpercaya.
            </p>
          </div>

          <div className="mx-auto mt-10 max-w-5xl rounded-md border border-gray-100 bg-white p-4">
            <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto] lg:items-center">
              <label className="relative block">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <i className="ri-search-line" />
                </span>
                <input value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 w-full rounded-md border border-gray-100 bg-[#f7f1e8] pl-9 pr-3 text-sm outline-none focus:border-red-200" placeholder="Cari produk..." />
              </label>
              <div className="flex flex-wrap gap-2">
                {categories.map((item) => (
                  <button key={item} type="button" onClick={() => setCategory(item)} className={`h-9 rounded-md px-3 text-xs font-medium ${category === item ? "bg-[#2b2b2b] text-white" : "bg-[#f7f1e8] text-slate-700 hover:bg-red-50 hover:text-red-600"}`}>
                    {item}
                  </button>
                ))}
              </div>
              <select value={sort} onChange={(event) => setSort(event.target.value)} className="h-9 rounded-md border border-gray-100 bg-[#f7f1e8] px-3 text-xs outline-none focus:border-red-200 focus:ring-2 focus:ring-red-200/40">
                <option>Termurah</option>
                <option>Termahal</option>
                <option>Stok</option>
              </select>
            </div>
          </div>

          {error ? <div className="mx-auto mt-4 max-w-5xl rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

          <p className="mx-auto mt-6 max-w-5xl text-xs text-slate-400">Menampilkan {visibleProducts.length} produk</p>

          <div className="mx-auto mt-4 grid max-w-5xl items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
            {productColumns.map((column, columnIndex) => (
              <div key={columnIndex} className="grid gap-5">
                {column.map((product) => {
              const expanded = openProductId === product.id;
              const selectedForProduct = catalogSelection?.product.id === product.id ? catalogSelection : null;
              const brand = productBrandAsset(product);
              const logoUrl = productLogoUrl(product);
              return (
                <article key={product.id} className={`overflow-hidden rounded-md border bg-white shadow-sm transition-colors ${expanded ? "border-red-200" : "border-gray-100"}`}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleProduct(product)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleProduct(product);
                      }
                    }}
                    className="block w-full cursor-pointer text-left"
                  >
                    <div className={`relative flex h-44 items-center justify-center bg-gradient-to-br ${productTone(product)}`}>
                    <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold text-slate-700">{product.code}</span>
                    <span className={`absolute right-3 top-3 rounded-full px-2 py-1 text-[10px] font-semibold ${product.stockCount > 0 ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {product.stockCount > 0 ? "Tersedia" : "Stok kosong"}
                    </span>
                    <span className="absolute bottom-3 left-3 rounded-full bg-black/70 px-2 py-1 text-[10px] font-semibold text-white">{product.stockCount} stok</span>
                    <span className="absolute bottom-3 right-3 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold text-slate-700">
                      {expanded ? "Tutup varian" : "Lihat varian"}
                    </span>
                    <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-white/90 text-slate-950 shadow-2xl backdrop-blur">
                      <span className="px-2 text-center text-xs font-black leading-tight tracking-wide">{product.code || brand.label}</span>
                      {logoUrl ? (
                        <img
                          src={logoUrl}
                          alt={`${brand.label} logo`}
                          className="absolute h-12 w-12 object-contain"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          onError={(event) => {
                            event.currentTarget.style.display = "none";
                          }}
                        />
                      ) : null}
                    </div>
                    </div>

                    <div className="p-4 pb-3">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold">{product.name}</h2>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">{productLabel(product)}</span>
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Reseller</span>
                    </div>
                    <p className="mt-2 min-h-[44px] text-sm leading-5 text-slate-500">{product.description}</p>
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                      <span>{product.variants.length} varian</span>
                      <span>{durationCount(product)} pilihan durasi</span>
                    </div>
                    </div>
                  </div>

                  {expanded ? (
                    <div className="border-t border-gray-100 px-4 pb-4 pt-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Pilih varian</p>
                    <div className="mt-4 space-y-2">
                      {product.variants.slice(0, 4).map((variant) => {
                        const duration = firstDuration(variant);
                        const selectedVariant = selectedForProduct?.variant.id === variant.id;
                        return (
                          <button key={variant.id} type="button" onClick={() => selectCatalogVariant(product, variant, duration.duration, duration.price)} className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border p-3 text-left transition-colors ${selectedVariant ? "border-red-200 bg-red-50" : "border-gray-100 hover:border-red-100 hover:bg-red-50/40"}`}>
                            <span className={`flex h-7 w-7 items-center justify-center rounded-full ${selectedVariant ? "bg-red-500 text-white" : variant.stockCount > 0 ? "bg-red-50 text-red-500" : "bg-slate-50 text-slate-300"}`}>
                              <i className={`${selectedVariant ? "ri-check-line" : "ri-checkbox-blank-circle-line"} text-xs`} />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold">{variant.name} <span className="text-[10px] font-medium text-slate-400">{variant.code}</span></span>
                              <span className="block truncate text-xs text-slate-400">{variant.stockCount} akun tersedia</span>
                            </span>
                            <span className="text-right text-sm font-bold">{formatRupiah(duration.price)}<span className="block text-[10px] font-medium text-slate-400">mulai</span></span>
                          </button>
                        );
                      })}
                      {product.variants.length > 4 ? <p className="text-center text-xs text-slate-400">+ {product.variants.length - 4} varian lainnya</p> : null}
                    </div>

                      {selectedForProduct ? (
                        <>
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      {sortedAllowedPriceEntries(selectedForProduct.variant.prices || {}, selectedForProduct.variant.durationModes).slice(0, 6).map(([duration, price]) => (
                        <button key={duration} type="button" onClick={() => selectCatalogDuration(duration, Number(price))} className={`rounded-md border px-2 py-2 text-left text-[11px] transition-colors ${selectedForProduct.duration === duration ? "border-red-200 bg-red-50 text-red-700" : "border-gray-100 bg-[#fbf7f0] hover:border-red-100 hover:bg-red-50"}`}>
                          <span className="block text-slate-500">{duration}</span>
                          <span className="font-semibold">{formatRupiah(Number(price))}</span>
                        </button>
                      ))}
                    </div>

                    <button type="button" onClick={startCatalogOrder} disabled={prechecking} className="mt-4 h-10 w-full rounded-md bg-[#2b2b2b] text-sm font-semibold text-white hover:bg-red-600 disabled:cursor-wait disabled:bg-slate-300">
                      Pesan Sekarang
                    </button>
                        </>
                      ) : (
                        <button type="button" disabled className="mt-4 h-10 w-full cursor-not-allowed rounded-md bg-slate-200 text-sm font-semibold text-slate-500">
                          Pilih varian dulu
                        </button>
                      )}
                    </div>
                  ) : null}
                </article>
              );
                })}
              </div>
            ))}
          </div>

          {!visibleProducts.length ? (
            <div className="mx-auto mt-8 max-w-5xl rounded-md border border-gray-100 bg-white p-8 text-center text-sm text-slate-500">
              Belum ada produk dengan stok ready.
            </div>
          ) : null}
        </section>
      </main>
    
  );
}
