import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge } from "../../../components/base/Badge";
import { DashboardLayout } from "../../../components/feature/DashboardLayout";
import { DataPanel, OwnerStat, PageToolbar, SearchBox } from "../../../components/feature/OwnerUi";
import { api, type OwnerSearchHit, type OwnerSearchResult } from "../../../lib/api";

const groupLabels: Array<{ key: keyof OwnerSearchResult["groups"]; label: string }> = [
  { key: "orders", label: "Orders" },
  { key: "accounts", label: "Managed Accounts" },
  { key: "stock", label: "Stock" },
  { key: "resellers", label: "Resellers" },
  { key: "products", label: "Products" },
];

type SearchGroupKey = keyof OwnerSearchResult["groups"];

function parseDate(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  const parsed = new Date(normalized.includes("T") ? normalized : normalized.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateText(value = "") {
  const parsed = parseDate(value);
  if (!parsed) return value || "-";
  return parsed.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toneFromStatus(status = ""): "emerald" | "red" | "amber" | "slate" {
  const value = String(status || "").toLowerCase();
  if (["completed", "sent", "active", "paid"].includes(value)) return "emerald";
  if (["failed", "expired", "cancelled", "inactive", "archived"].includes(value)) return "red";
  if (["processing", "pending", "reserved"].includes(value)) return "amber";
  return "slate";
}

function scrollToElement(id = "") {
  if (!id || typeof document === "undefined") return;
  window.requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  });
}

function ResultSection({ label, rows }: { label: string; rows: OwnerSearchHit[] }) {
  return (
    <DataPanel className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-950">{label}</p>
          <p className="mt-1 text-xs text-slate-500">Hasil yang paling relevan untuk grup ini.</p>
        </div>
        <Badge variant={rows.length ? "emerald" : "slate"}>{rows.length}</Badge>
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map((item) => (
          <Link key={`${item.group}-${item.id}`} to={item.href} className="block px-4 py-3 transition-colors hover:bg-slate-50">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={toneFromStatus(item.status || item.type)}>{item.type}</Badge>
                  <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                </div>
                <p className="mt-1 text-xs text-slate-500">{item.subtitle}</p>
                <p className="mt-2 text-sm text-slate-600">{item.detail}</p>
              </div>
              <div className="text-right text-[11px] text-slate-400">{dateText(item.createdAt || "")}</div>
            </div>
          </Link>
        ))}
        {!rows.length ? <div className="px-4 py-6 text-sm text-slate-500">Tidak ada hasil untuk grup ini.</div> : null}
      </div>
    </DataPanel>
  );
}

export default function DashboardSearchPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q")?.trim() || "");
  const [result, setResult] = useState<OwnerSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeGroup, setActiveGroup] = useState<"all" | SearchGroupKey>("all");

  useEffect(() => {
    const next = params.get("q")?.trim() || "";
    setQuery(next);
  }, [params]);

  useEffect(() => {
    const keyword = query.trim();
    if (!keyword) {
      setResult(null);
      setError("");
      return;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const next = await api.ownerSearch(keyword);
        setResult(next);
      } catch (searchError) {
        setError(searchError instanceof Error ? searchError.message : "Search owner gagal.");
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const totalByGroup = useMemo(() => ({
    orders: result?.groups.orders.length || 0,
    accounts: result?.groups.accounts.length || 0,
    stock: result?.groups.stock.length || 0,
    resellers: result?.groups.resellers.length || 0,
    products: result?.groups.products.length || 0,
  }), [result]);

  function submitQuery(value: string) {
    const next = value.trim();
    setParams(next ? { q: next } : {});
  }

  function focusSearchGroup(nextGroup: "all" | SearchGroupKey) {
    setActiveGroup(nextGroup);
    scrollToElement("owner-search-toolbar");
  }

  return (
    <DashboardLayout role="owner" title="Owner Search">
      <div className="grid gap-3 md:grid-cols-6">
        <OwnerStat label="Total Hit" value={result?.total || 0} active={activeGroup === "all"} icon="ri-search-line" onClick={() => focusSearchGroup("all")} />
        <OwnerStat label="Orders" value={totalByGroup.orders} active={activeGroup === "orders"} icon="ri-shopping-cart-2-line" onClick={() => focusSearchGroup("orders")} />
        <OwnerStat label="Accounts" value={totalByGroup.accounts} active={activeGroup === "accounts"} icon="ri-shield-keyhole-line" onClick={() => focusSearchGroup("accounts")} />
        <OwnerStat label="Stock" value={totalByGroup.stock} active={activeGroup === "stock"} icon="ri-database-2-line" onClick={() => focusSearchGroup("stock")} />
        <OwnerStat label="Resellers" value={totalByGroup.resellers} active={activeGroup === "resellers"} icon="ri-user-shared-line" onClick={() => focusSearchGroup("resellers")} />
        <OwnerStat label="Products" value={totalByGroup.products} active={activeGroup === "products"} icon="ri-stack-line" onClick={() => focusSearchGroup("products")} />
      </div>

      <div className="sticky top-16 z-30 -mx-4 mt-4 bg-[#f2ece2] px-4 py-3 md:-mx-6 md:px-6">
        <div id="owner-search-toolbar">
          <PageToolbar className="shadow-sm shadow-slate-950/5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="w-full max-w-2xl">
              <SearchBox value={query} onChange={(value) => { setQuery(value); submitQuery(value); }} placeholder="Cari order id, email akun, stock id, reseller, WhatsApp, produk..." />
            </div>
            <div className="text-xs text-slate-500">
              Search lintas order, akun, stok, reseller, dan produk.
            </div>
          </div>
          </PageToolbar>
        </div>
      </div>

      {error ? (
        <DataPanel className="mt-4 border border-red-100 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </DataPanel>
      ) : null}

      {!query.trim() ? (
        <DataPanel className="mt-4 p-6 text-sm text-slate-500">
          Masukkan kata kunci untuk mulai cari lintas data owner. Cocok untuk lacak order, akun reseller, stok tertentu, atau reseller tertentu dari satu tempat.
        </DataPanel>
      ) : null}

      {loading ? (
        <DataPanel className="mt-4 p-6 text-sm text-slate-500">
          Mencari data owner...
        </DataPanel>
      ) : null}

      {query.trim() && !loading ? (
        <div className="mt-4 space-y-4">
          {groupLabels.filter((group) => activeGroup === "all" || group.key === activeGroup).map((group) => (
            <ResultSection key={group.key} label={group.label} rows={result?.groups[group.key] || []} />
          ))}
        </div>
      ) : null}
    </DashboardLayout>
  );
}
