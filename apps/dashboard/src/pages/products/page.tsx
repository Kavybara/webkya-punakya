import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../../components/base/Button";
import { PageTransition } from "../../components/feature/PageTransition";
import { api, subscribeRealtime, type ApiOrder, type ApiPayment, type CatalogProduct, type CatalogVariant } from "../../lib/api";
import { durationAllowedByModes, firstAllowedPriceEntry, sortedAllowedPriceEntries } from "../../lib/durations";
import { productBrandAsset, productLogoUrl } from "../../lib/productBrandAssets";
import { readSession } from "../../lib/session";
import { formatRupiah } from "../../mocks/data";

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

const steps: Array<{ id: CheckoutStep; label: string }> = [
  { id: "details", label: "Isi Data" },
  { id: "payment", label: "Bayar" },
  { id: "process", label: "Proses" },
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

function splitFulfillmentText(text = "") {
  const lines = text.split("\n");
  const snkIndex = lines.findIndex((line) => /^S&K:/i.test(line.trim()));
  const accountLines = snkIndex === -1 ? lines : lines.slice(0, snkIndex);
  const detailIndex = accountLines.findIndex((line) =>
    /^(?:〔\s*ACCOUNT DETAIL\s*〕|ACCOUNT DETAIL|DETAIL (?:AKUN|CANVA|LINK))$/i.test(line.trim()),
  );
  return {
    account: accountLines.slice(detailIndex >= 0 ? detailIndex : 0).join("\n").trim(),
    snk: snkIndex === -1 ? "" : lines.slice(snkIndex).join("\n").trim(),
  };
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
  return message || "Order gagal dibuat.";
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
  const [whatsapp, setWhatsapp] = useState("");
  const [note, setNote] = useState("");
  const [createdOrder, setCreatedOrder] = useState<ApiOrder | null>(null);
  const [payment, setPayment] = useState<ApiPayment | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [prechecking, setPrechecking] = useState(false);
  const [resellerCheck, setResellerCheck] = useState<ResellerCheckState>({ status: "idle", message: "" });
  const [ownerWhatsApp, setOwnerWhatsApp] = useState("");
  const [autoCheckoutKey, setAutoCheckoutKey] = useState("");
  const submitLockRef = useRef(false);

  const isResellerCheckout = location.pathname.startsWith("/reseller/checkout");

  function backToCatalog() {
    if (isResellerCheckout) {
      navigate("/reseller/catalog");
      return;
    }
    setStep("catalog");
  }

  async function loadCatalog() {
    try {
      setProducts(isResellerCheckout ? await api.catalogAll() : await api.catalog());
    } finally {
      setCatalogLoaded(true);
    }
  }

  useEffect(() => {
    loadCatalog().catch(console.error);
    api.health().then((health) => {
      if (health.ownerWhatsAppNumber) setOwnerWhatsApp(health.ownerWhatsAppNumber);
    }).catch(console.error);
    return subscribeRealtime(() => {
      loadCatalog().catch(console.error);
    });
  }, []);

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
      if (isResellerCheckout) navigate("/reseller/catalog", { replace: true });
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
    function updateColumnCount() {
      if (window.innerWidth >= 1280) setColumnCount(3);
      else if (window.innerWidth >= 768) setColumnCount(2);
      else setColumnCount(1);
    }
    updateColumnCount();
    window.addEventListener("resize", updateColumnCount);
    return () => window.removeEventListener("resize", updateColumnCount);
  }, []);

  useEffect(() => {
    if (!createdOrder?.id) return;
    const refresh = async () => {
      const latest = await api.order(createdOrder.id);
      setCreatedOrder((current) => ({
        ...latest,
        fulfillmentText: latest.fulfillmentText || current?.fulfillmentText || "",
        snkText: latest.snkText || current?.snkText || "",
      }));
      if (latest.paymentRef) {
        api.payment(latest.paymentRef).then(setPayment).catch(console.error);
      }
      if (latest.orderStatus === "completed" || latest.deliveryStatus === "stock_unavailable_deposit") setStep("done");
      else if (latest.qrisStatus === "paid") setStep("process");
    };
    const timer = window.setInterval(() => {
      refresh().catch(console.error);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [createdOrder?.id]);

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

  async function submitOrder() {
    if (!selection || submitLockRef.current) return;
    submitLockRef.current = true;
    const cleanWhatsapp = normalizeWhatsapp(whatsapp);
    const orderQty = clampOrderQuantity(quantity, selection.variant.stockCount);
    if (!customer.trim() || !cleanWhatsapp) {
      setError("Nama lengkap dan nomor WhatsApp wajib diisi.");
      submitLockRef.current = false;
      return;
    }
    const rules = checkoutRules(selection, orderQty);
    if (rules.required && rules.customerField === "device" && splitDeviceNames(email).length < rules.minItems) {
      setError(rules.minItems > 1 ? `${rules.label} wajib isi minimal ${rules.minItems} device. Pisahkan dengan koma atau baris baru.` : `${rules.label} wajib diisi.`);
      submitLockRef.current = false;
      return;
    }
    if (rules.required && rules.customerField === "email" && splitCustomerEmails(email).length < rules.minItems) {
      setError(`${rules.label} wajib isi minimal ${rules.minItems} email. Pisahkan dengan koma, spasi, atau baris baru.`);
      submitLockRef.current = false;
      return;
    }
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
        email: rules.customerField === "email" ? splitCustomerEmails(email).join(", ") : "",
        device: rules.customerField === "device" ? email.trim() : "",
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

  const activeStep = Math.max(0, steps.findIndex((item) => item.id === step));
  const qrSrc = qrImageSource(payment);
  const whatsappReady = resellerCheck.status === "valid";
  const fulfillment = splitFulfillmentDisplayText(createdOrder?.fulfillmentText || "");
  const stockRaceDeposit = createdOrder?.deliveryStatus === "stock_unavailable_deposit";
  const depositUsed = Number(createdOrder?.depositUsed || payment?.depositUsed || 0);
  const paymentDue = Number(createdOrder?.paymentDue ?? payment?.amount ?? createdOrder?.total ?? 0);
  const qrisNominal = Number(payment?.amount ?? createdOrder?.paymentDue ?? paymentDue ?? 0);
  const qrisFee = Number(payment?.fee ?? createdOrder?.paymentFee ?? 0);
  const qrisProviderTotal = Number(payment?.totalPayment || 0);
  const qrisComputedTotal = qrisNominal > 0 ? qrisNominal + qrisFee : 0;
  const qrisTotal = Math.max(qrisProviderTotal, qrisComputedTotal);
  const snkText = createdOrder?.snkText || fulfillment.snk || "S&K belum diatur untuk produk ini.";
  const activeCheckoutRules = checkoutRules(selection, clampOrderQuantity(quantity, selection?.variant.stockCount || 1));
  const resellerCheckoutWaiting = isResellerCheckout && step !== "catalog" && !selection;

  if (resellerCheckoutWaiting) {
    return (
      <PageTransition>
        <main className="min-h-screen bg-[#f4eee4] px-4 py-8 text-slate-950">
          <header className="mx-auto flex max-w-6xl items-center justify-between">
            <button type="button" onClick={backToCatalog} className="font-serif text-lg font-semibold">
              Kavya
            </button>
            <Link to="/reseller/catalog" className="rounded-full bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm">
              Katalog
            </Link>
          </header>
          <section className="mx-auto mt-16 max-w-xl rounded-md border border-gray-100 bg-white p-6 text-center shadow-sm">
            {error ? (
              <>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
                  <i className="ri-error-warning-line text-xl" />
                </div>
                <h1 className="mt-4 text-lg font-semibold text-slate-950">Checkout tidak tersedia</h1>
                <p className="mt-2 text-sm leading-6 text-slate-500">{error}</p>
                <Button onClick={backToCatalog} className="mt-5 bg-red-500 hover:bg-red-600">
                  Pilih Produk Lain
                </Button>
              </>
            ) : (
              <>
                <div className="mx-auto h-12 w-12 animate-spin rounded-full border-2 border-red-100 border-t-red-500" />
                <h1 className="mt-4 text-lg font-semibold text-slate-950">Menyiapkan checkout</h1>
                <p className="mt-2 text-sm leading-6 text-slate-500">Menyiapkan paket order dari katalog reseller.</p>
              </>
            )}
          </section>
        </main>
      </PageTransition>
    );
  }

  if (step !== "catalog") {
    return (
      <PageTransition>
        <main className="min-h-screen bg-[#f4eee4] px-4 py-8 text-slate-950">
          <header className="mx-auto flex max-w-6xl items-center justify-between">
            <button type="button" onClick={backToCatalog} className="font-serif text-lg font-semibold">
              Kavya
            </button>
            <Link to={isResellerCheckout ? "/reseller/catalog" : "/"} className="rounded-full bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm">
              {isResellerCheckout ? "Katalog" : "Home"}
            </Link>
          </header>

          <div className="mx-auto mt-8 flex max-w-xl items-center justify-center gap-1 overflow-x-auto px-1 text-[11px] sm:mt-12 sm:gap-3 sm:text-xs">
            {steps.map((item, index) => (
              <div key={item.id} className="flex items-center gap-2 sm:gap-3">
                <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold sm:h-8 sm:w-8 ${index <= activeStep ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-400"}`}>
                  {index + 1}
                </div>
                <span className={`${index <= activeStep ? "font-semibold text-slate-900" : "text-slate-400"} whitespace-nowrap`}>{item.label}</span>
                {index < steps.length - 1 ? <span className="h-px w-4 shrink-0 bg-slate-200 sm:w-12" /> : null}
              </div>
            ))}
          </div>

          <section className="mx-auto mt-10 max-w-2xl overflow-hidden rounded-md border border-gray-100 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-5 py-4">
              <h1 className="text-base font-semibold">Pesan {selection?.product.name || "Produk"}</h1>
            </div>

            {step === "details" ? (
              <div className="p-5">
                {selection ? (
                  <div className="mb-5 rounded-md border border-red-100 bg-red-50/40 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-xs font-medium uppercase text-red-500">Paket Dipilih</p>
                        <h2 className="mt-1 text-lg font-semibold">{selection.product.name} - {selection.variant.name}</h2>
                        <p className="mt-1 text-sm text-slate-500">
                          {selection.duration} / {formatRupiah(selection.price)} - stok tersedia {selection.variant.stockCount}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-slate-800">
                          Total {quantity} akun: {formatRupiah(selection.price * quantity)}
                        </p>
                      </div>
                      <button type="button" onClick={backToCatalog} className="h-9 rounded-md border border-red-100 bg-white px-3 text-sm font-medium text-red-600">
                        Ganti Paket
                      </button>
                    </div>
                    <div className="mt-4 flex flex-col gap-3 border-t border-red-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Jumlah akun</p>
                        <p className="text-xs text-slate-500">Bisa beli lebih dari 1 selama stok varian mencukupi.</p>
                      </div>
                      <div className="inline-flex h-10 w-fit items-center overflow-hidden rounded-md border border-red-100 bg-white">
                        <button
                          type="button"
                          onClick={() => changeQuantity(quantity - 1)}
                          disabled={quantity <= 1}
                          className="flex h-10 w-10 items-center justify-center text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white"
                          aria-label="Kurangi jumlah akun"
                        >
                          <i className="ri-subtract-line" />
                        </button>
                        <input
                          value={quantity}
                          onChange={(event) => changeQuantity(Number(event.target.value))}
                          className="h-10 w-14 border-x border-red-100 text-center text-sm font-semibold outline-none"
                          inputMode="numeric"
                          aria-label="Jumlah akun"
                        />
                        <button
                          type="button"
                          onClick={() => changeQuantity(quantity + 1)}
                          disabled={quantity >= selection.variant.stockCount}
                          className="flex h-10 w-10 items-center justify-center text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-white"
                          aria-label="Tambah jumlah akun"
                        >
                          <i className="ri-add-line" />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-4">
                  <label className="block">
                    <span className="text-sm font-medium">Nama Lengkap <span className="text-red-500">*</span></span>
                    <input value={customer} onChange={(event) => setCustomer(event.target.value)} className="mt-2 h-11 w-full rounded-md border border-gray-200 px-4 text-sm outline-none focus:border-red-200" placeholder="Masukkan nama lengkap" />
                  </label>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="text-sm font-medium">
                        {activeCheckoutRules.label}
                        {activeCheckoutRules.required ? <span className="text-red-500"> *</span> : null}
                      </span>
                      <input value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 h-11 w-full rounded-md border border-gray-200 px-4 text-sm outline-none focus:border-red-200" placeholder={activeCheckoutRules.placeholder} />
                      {activeCheckoutRules.helper ? <span className="mt-2 block text-xs text-amber-600">{activeCheckoutRules.helper}</span> : null}
                    </label>
                    <label className="block">
                      <span className="text-sm font-medium">WhatsApp Reseller <span className="text-red-500">*</span></span>
                      <input value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} className="mt-2 h-11 w-full rounded-md border border-gray-200 px-4 text-sm outline-none focus:border-red-200" placeholder="08123456789" />
                      {resellerCheck.message ? (
                        <span
                          className={`mt-2 block rounded-md px-3 py-2 text-xs font-medium ${
                            resellerCheck.status === "valid"
                              ? "bg-emerald-50 text-emerald-700"
                              : resellerCheck.status === "checking"
                                ? "bg-slate-50 text-slate-500"
                                : "bg-red-50 text-red-700"
                          }`}
                        >
                          {resellerCheck.message}
                        </span>
                      ) : null}
                    </label>
                  </div>

                  <label className="block">
                    <span className="text-sm font-medium">Catatan (opsional)</span>
                    <textarea value={note} onChange={(event) => setNote(event.target.value.slice(0, 500))} className="mt-2 h-24 w-full rounded-md border border-gray-200 px-4 py-3 text-sm outline-none focus:border-red-200" placeholder="Catatan tambahan..." />
                    <span className="mt-1 block text-xs text-slate-400">{note.length}/500 karakter</span>
                  </label>
                </div>

                {error ? <div className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

                <Button onClick={submitOrder} disabled={submitting || !selection || !whatsappReady} className="mt-5 h-12 w-full bg-red-500 hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-slate-300">
                  <span className="flex h-4 w-4 items-center justify-center"><i className="ri-shopping-cart-line" /></span>
                  {submitting ? "Membuat order..." : resellerCheck.status === "checking" ? "Mengecek reseller..." : "Lanjutkan Order"}
                </Button>
              </div>
            ) : null}

            {step === "payment" ? (
              <div className="grid gap-5 p-5 md:grid-cols-[0.85fr_1fr]">
                <div className="flex min-h-0 items-center rounded-md border border-gray-100 bg-[#fbf7f0] p-4 md:min-h-[420px]">
                  <div className="w-full">
                    <p className="text-xs font-medium uppercase text-slate-400">Ringkasan</p>
                    <h2 className="mt-2 text-lg font-semibold">{createdOrder?.product}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {createdOrder?.variant} - {createdOrder?.duration} x{createdOrder?.qty || 1} akun
                    </p>
                    <div className="mt-4 text-2xl font-bold">{formatRupiah(createdOrder?.total || 0)}</div>
                    <div className="mt-4 rounded-md bg-white/70 p-3 text-sm">
                      {depositUsed > 0 ? (
                        <div className="flex items-center justify-between gap-3 text-slate-500">
                          <span>Deposit dipakai</span>
                          <span className="font-semibold text-slate-800">{formatRupiah(depositUsed)}</span>
                        </div>
                      ) : null}
                      <div className={`${depositUsed > 0 ? "mt-2" : ""} flex items-center justify-between gap-3 text-slate-500`}>
                        <span>Nominal QRIS</span>
                        <span className="font-semibold text-slate-800">{formatRupiah(qrisNominal || paymentDue)}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3 text-slate-500">
                        <span>Biaya Admin</span>
                        <span className="font-semibold text-slate-800">{formatRupiah(qrisFee)}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3 border-t border-slate-100 pt-2 text-slate-700">
                        <span>Total Bayar QRIS</span>
                        <span className="font-semibold text-red-600">{formatRupiah(qrisTotal || paymentDue)}</span>
                      </div>
                    </div>
                    <div className="mt-3 text-sm text-slate-500">Order ID: {createdOrder?.id}</div>
                    <div className="text-sm text-slate-500">Ref: {createdOrder?.paymentRef}</div>
                    <div className="text-sm text-slate-500">Batas bayar: {createdOrder?.paymentExpiresAt || payment?.expiresAt || "-"}</div>
                  </div>
                </div>
                <div className="rounded-md border border-gray-100 p-4 text-center">
                  <p className="text-sm font-semibold">QRIS Pakasir</p>
                  <p className="mt-1 text-xs text-slate-500">Scan QRIS sebesar {formatRupiah(qrisTotal || paymentDue)}, lalu status akan ikut update ke dashboard dan WhatsApp flow.</p>
                  <div className="mx-auto mt-4 flex aspect-square w-full max-w-[284px] items-center justify-center rounded-md border border-gray-100 bg-white p-3">
                    {qrSrc ? <img src={qrSrc} alt="QRIS Pakasir" className="h-full w-full object-contain" /> : <span className="text-sm text-slate-400">QRIS belum tersedia</span>}
                  </div>
                  {payment?.providerError || createdOrder?.paymentError ? (
                    <div className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-left text-xs text-amber-700">
                      {payment?.providerError || createdOrder?.paymentError}
                    </div>
                  ) : null}
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {payment?.paymentUrl || createdOrder?.qrisUrl ? (
                      <a href={payment?.paymentUrl || createdOrder?.qrisUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center rounded-md bg-[#2b2b2b] px-4 text-sm font-medium text-white">
                        Buka Pakasir
                      </a>
                    ) : null}
                    <Link to={`/order-tracking?order=${createdOrder?.id || ""}`} className="inline-flex h-10 items-center justify-center rounded-md border border-gray-200 bg-white px-4 text-sm font-medium text-slate-700">
                      Lacak Order
                    </Link>
                  </div>
                </div>
              </div>
            ) : null}

            {step === "process" || step === "done" ? (
              <div className="p-8 text-center">
                <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${step === "done" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
                  <i className={step === "done" ? "ri-check-line text-2xl" : "ri-time-line text-2xl"} />
                </div>
                <h2 className="mt-4 text-xl font-semibold">{stockRaceDeposit ? "Stok habis, saldo bertambah" : step === "done" ? "Order selesai" : "Pembayaran diterima, pesanan diproses"}</h2>
                <p className="mt-2 text-sm text-slate-500">
                  {stockRaceDeposit
                    ? "Pembayaran sudah diterima, tapi stok produk sudah habis. Nominal order otomatis masuk ke saldo reseller untuk order berikutnya."
                    : step === "done"
                      ? `Pembelian berhasil. ${createdOrder?.qty && createdOrder.qty > 1 ? `${createdOrder.qty} detail akun sudah tersedia. ` : ""}Simpan Order ID untuk bantuan owner jika ada kendala.`
                      : "Sistem sedang menyiapkan stok akun. Stok diberikan ke pembayar tercepat."}
                </p>
                {step === "done" && createdOrder ? (
                  <div className="mx-auto mt-4 inline-flex rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                    Order ID: {createdOrder.id}
                  </div>
                ) : null}
                {step === "done" && createdOrder?.fulfillmentText ? (
                  <div className="mx-auto mt-5 grid max-w-4xl gap-4 text-left md:grid-cols-2">
                    <div className="min-w-0 rounded-md border border-emerald-100 bg-emerald-50/40 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-emerald-900">Detail Akun</p>
                        <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold uppercase text-emerald-700">Paid</span>
                      </div>
                      <pre className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-white p-4 font-mono text-xs leading-5 text-slate-700">
                        {fulfillment.account}
                      </pre>
                    </div>
                    <div className="min-w-0 rounded-md border border-amber-100 bg-amber-50/50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-amber-900">S&K Produk</p>
                        <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold uppercase text-amber-700">Scroll jika panjang</span>
                      </div>
                      <pre className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-white p-4 font-mono text-xs leading-5 text-slate-700">
                        {snkText}
                      </pre>
                    </div>
                  </div>
                ) : null}
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <Link to={`/order-tracking?order=${createdOrder?.id || ""}`} className="inline-flex h-10 items-center justify-center rounded-md bg-[#2b2b2b] px-4 text-sm font-medium text-white">
                    Lacak Order
                  </Link>
                  <a href={ownerContactHref(ownerWhatsApp, createdOrder?.id || "")} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center rounded-md border border-red-100 bg-white px-4 text-sm font-medium text-red-600 hover:bg-red-50">
                    Hubungi Owner
                  </a>
                </div>
              </div>
            ) : null}
          </section>

          <p className="mt-20 text-center text-sm text-slate-400">Pembayaran aman - Proses cepat - Garansi penuh</p>
        </main>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
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
              <select value={sort} onChange={(event) => setSort(event.target.value)} className="h-9 rounded-md border border-gray-100 bg-[#f7f1e8] px-3 text-xs outline-none">
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
    </PageTransition>
  );
}
