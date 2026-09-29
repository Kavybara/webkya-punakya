import { useEffect, useMemo, useRef, useState } from "react";
import { Grid2X2, LoaderCircle, PackageCheck, ReceiptText, Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, type ApiAccount, type ApiOrder, type CatalogProduct } from "../../lib/api";
import { maskIdentity } from "../../components/ui";

type SearchData = { products: CatalogProduct[]; orders: ApiOrder[]; accounts: ApiAccount[] };
type SearchHit = { id: string; label: string; detail: string; group: "Produk" | "Pesanan" | "Akun"; href: string };

export function ResellerSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchData>({ products: [], orders: [], accounts: [] });
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || loaded || loading) return;
    setLoading(true);
    setError("");
    Promise.all([api.catalog(), api.orders(), api.accounts({ view: "overview" })])
      .then(([products, orders, accounts]) => { setData({ products, orders, accounts }); setLoaded(true); })
      .catch(() => setError("Pencarian belum dapat dimuat. Coba lagi beberapa saat."))
      .finally(() => setLoading(false));
  }, [loaded, loading, open]);

  const hits = useMemo<SearchHit[]>(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const productHits = data.products.filter((item) => `${item.name} ${item.code} ${item.category}`.toLowerCase().includes(needle)).slice(0, 4).map((item) => ({ id: item.id, label: item.name, detail: item.category || "Produk digital", group: "Produk" as const, href: "/reseller-v2/catalog" }));
    const orderHits = data.orders.filter((item) => `${item.id} ${item.product} ${item.variant}`.toLowerCase().includes(needle)).slice(0, 4).map((item) => ({ id: item.id, label: item.id, detail: `${item.product} / ${item.variant}`, group: "Pesanan" as const, href: "/reseller-v2/orders" }));
    const accountHits = data.accounts.filter((item) => `${item.product} ${item.variant} ${item.email} ${item.loginPhone} ${item.profile}`.toLowerCase().includes(needle)).slice(0, 4).map((item) => ({ id: item.id, label: item.product, detail: `${maskIdentity(item.loginPhone || item.email)} / ${item.profile || "Tanpa profil"}`, group: "Akun" as const, href: "/reseller-v2/accounts" }));
    return [...productHits, ...orderHits, ...accountHits].slice(0, 10);
  }, [data, query]);

  if (!open) return null;
  return <div className="reseller-v2-search-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="reseller-v2-search" role="dialog" aria-modal="true" aria-labelledby="reseller-search-title"><header><Search size={18} /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari produk, pesanan, atau akun..." aria-label="Pencarian reseller" /><kbd>Esc</kbd><button type="button" onClick={onClose} aria-label="Tutup pencarian"><X size={18} /></button></header><div className="reseller-v2-search-body"><h2 id="reseller-search-title">Pencarian reseller</h2>{loading ? <div className="reseller-v2-search-message"><LoaderCircle className="ui-spin" size={17} /> Memuat data milik Anda...</div> : error ? <div className="reseller-v2-search-message is-error">{error}</div> : !query.trim() ? <div className="reseller-v2-search-shortcuts"><button type="button" onClick={() => navigate("/reseller-v2/catalog")}><Grid2X2 size={17} /> Buka katalog</button><button type="button" onClick={() => navigate("/reseller-v2/orders")}><ReceiptText size={17} /> Lihat pesanan</button><button type="button" onClick={() => navigate("/reseller-v2/accounts")}><PackageCheck size={17} /> Buka akun saya</button></div> : hits.length ? <div className="reseller-v2-search-results">{hits.map((hit) => <button key={`${hit.group}-${hit.id}`} type="button" onClick={() => { onClose(); navigate(hit.href); }}><span>{hit.group === "Produk" ? <Grid2X2 size={16} /> : hit.group === "Pesanan" ? <ReceiptText size={16} /> : <PackageCheck size={16} />}</span><div><strong>{hit.label}</strong><small>{hit.detail}</small></div><em>{hit.group}</em></button>)}</div> : <div className="reseller-v2-search-message">Tidak ada hasil pada data Anda.</div>}</div></section></div>;
}
