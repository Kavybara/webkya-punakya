import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/base/Button";
import { Card, CardBody, CardHeader, CardTitle } from "../../../components/base/Card";
import { DashboardLayout } from "../../../components/feature/DashboardLayout";
import { api, subscribeRealtime, type ApiOrder, type CatalogProduct } from "../../../lib/api";
import { firstAllowedPriceEntry } from "../../../lib/durations";
import { readSession } from "../../../lib/session";
import { formatRupiah, type DurationLabel } from "../../../mocks/data";
import { compactDate } from "../resellerUi";

const presetStorageKey = "kavya-reseller-order-presets";

type OrderPreset = {
  id: string;
  label: string;
  productId: string;
  buyer?: string;
};

function readPresets(): OrderPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(presetStorageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePresets(rows: OrderPreset[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(presetStorageKey, JSON.stringify(rows.slice(0, 8)));
}

export default function ResellerOrdersPage() {
  const [step, setStep] = useState(0);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [productId, setProductId] = useState("");
  const [buyer, setBuyer] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [createdOrder, setCreatedOrder] = useState<ApiOrder | null>(null);
  const [presets, setPresets] = useState<OrderPreset[]>([]);
  const product = products.find((item) => item.id === productId) || products[0];
  const variant = product?.variants[0];
  const [duration, price] = firstAllowedPriceEntry(variant?.prices || {}, variant?.durationModes);

  async function loadData() {
    const [productRows, orderRows] = await Promise.all([api.catalogAll(), api.orders()]);
    setProducts(productRows);
    setOrders(orderRows);
    setProductId((current) => current || productRows[0]?.id || "");
  }

  useEffect(() => {
    const session = readSession();
    const number = String(session?.user?.whatsapp || "");
    if (number) setWhatsapp(number);
    setPresets(readPresets());
    loadData().catch(console.error);
    return subscribeRealtime(() => {
      loadData().catch(console.error);
    });
  }, []);

  const recentProducts = useMemo(
    () => Array.from(new Set(orders.map((order) => order.product))).slice(0, 6),
    [orders],
  );
  const buyerHistory = useMemo(
    () => orders.filter((order) => buyer.trim() && String(order.customer || "").toLowerCase().includes(buyer.trim().toLowerCase())).slice(0, 5),
    [buyer, orders],
  );

  async function nextStep() {
    if (step < 1) {
      setStep((value) => value + 1);
      return;
    }
    if (step === 1 && product && variant) {
      const order = await api.createOrder({
        customer: buyer || "Buyer Reseller",
        whatsapp,
        productId: product.id,
        variantId: variant.id,
        duration: duration as DurationLabel,
        qty: 1,
        channel: "Reseller",
      });
      setCreatedOrder(order);
      const nextPresets = [
        {
          id: `${product.id}:${Date.now()}`,
          label: `${product.name}${buyer ? ` - ${buyer}` : ""}`,
          productId: product.id,
          buyer: buyer || "",
        },
        ...presets.filter((item) => !(item.productId === product.id && String(item.buyer || "") === String(buyer || ""))),
      ];
      setPresets(nextPresets);
      writePresets(nextPresets);
      setStep(2);
    }
  }

  return (
    <DashboardLayout role="reseller" title="New Order">
      <Card className="mx-auto max-w-4xl">
        <CardHeader>
          <CardTitle>Quick Order Preset</CardTitle>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {["Customer", "Product", "Submit"].map((item, index) => (
              <div key={item} className={`rounded-full px-2 py-1 text-center text-xs ${index <= step ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-500"}`}>{item}</div>
            ))}
          </div>
        </CardHeader>
        <CardBody>
          <div className="mb-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase text-slate-500">Preset Tersimpan</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setProductId(preset.productId);
                      setBuyer(preset.buyer || "");
                      setStep(1);
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {preset.label}
                  </button>
                ))}
                {!presets.length ? <span className="text-xs text-slate-400">Preset akan muncul otomatis dari order yang sudah kamu buat.</span> : null}
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase text-slate-500">Produk Favorit Terbaru</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {recentProducts.map((name) => {
                  const matched = products.find((item) => item.name === name);
                  if (!matched) return null;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => {
                        setProductId(matched.id);
                        setStep(1);
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {name}
                    </button>
                  );
                })}
                {!recentProducts.length ? <span className="text-xs text-slate-400">Belum ada history order untuk dijadikan shortcut.</span> : null}
              </div>
            </div>
          </div>

          {step === 0 ? (
            <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
              <div className="grid gap-4">
                <input value={buyer} onChange={(event) => setBuyer(event.target.value)} className="rounded-md border border-gray-100 px-3 py-2 text-sm" placeholder="Nama buyer" />
                <input value={whatsapp} readOnly className="rounded-md border border-gray-100 bg-slate-50 px-3 py-2 text-sm text-slate-500" placeholder="WhatsApp reseller" />
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase text-slate-500">Customer History Mini</div>
                <div className="mt-3 space-y-2">
                  {buyerHistory.map((order) => (
                    <div key={`buyer-${order.id}`} className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600">
                      <div className="font-semibold text-slate-900">{order.customer}</div>
                      <div className="mt-1">{order.product} {order.duration} - {compactDate(order.createdAt)}</div>
                    </div>
                  ))}
                  {buyer.trim()
                    ? (!buyerHistory.length ? <div className="text-xs text-slate-400">Belum ada order sebelumnya untuk buyer ini.</div> : null)
                    : <div className="text-xs text-slate-400">Ketik nama buyer untuk lihat history singkatnya.</div>}
                </div>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="grid gap-4">
              <select value={productId} onChange={(event) => setProductId(event.target.value)} className="rounded-md border border-gray-100 px-3 py-2 text-sm">
                {products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <div className="rounded-xl border border-gray-100 p-4 text-sm text-slate-600">
                {variant?.code || "-"} - {formatRupiah(price)}
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-5 text-center text-emerald-700">
              Order reseller {createdOrder?.id || ""} masuk ke queue owner.
            </div>
          ) : null}

          <div className="mt-6 flex justify-between">
            <Button variant="outline" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>Back</Button>
            <Button onClick={nextStep} disabled={step === 2 || !product || !variant}>{step === 2 ? "Submit" : "Next"}</Button>
          </div>
        </CardBody>
      </Card>
    </DashboardLayout>
  );
}
