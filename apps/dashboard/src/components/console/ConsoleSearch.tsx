import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Command, Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, type OwnerSearchHit, type OwnerSearchResult } from "../../lib/api";

const groupLabels: Record<string, string> = {
  orders: "Pesanan",
  accounts: "Akun pelanggan",
  stock: "Stok akun",
  resellers: "Reseller",
  products: "Produk",
};

export function toConsoleHref(href: string) {
  const mappings: Array<[RegExp, string]> = [
    [/^\/dashboard\/orders/, "/owner-v2/orders"],
    [/^\/dashboard\/products/, "/owner-v2/products"],
    [/^\/dashboard\/stock/, "/owner-v2/stock"],
    [/^\/dashboard\/accounts/, "/owner-v2/accounts"],
    [/^\/dashboard\/resellers/, "/owner-v2/resellers"],
    [/^\/dashboard\/operations/, "/owner-v2/operations"],
    [/^\/dashboard\/whatsapp/, "/owner-v2/whatsapp"],
    [/^\/dashboard\/activities/, "/owner-v2/activities"],
    [/^\/dashboard\/(settings|profile)/, "/owner-v2/integrations"],
  ];
  const mapping = mappings.find(([pattern]) => pattern.test(href));
  return mapping ? href.replace(mapping[0], mapping[1]) : href;
}

export function ConsoleSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<OwnerSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResult(null);
      setError("");
      setLoading(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const next = await api.ownerSearch(query.trim());
        if (active) setResult(next);
      } catch (searchError) {
        if (active) setError(searchError instanceof Error ? searchError.message : "Pencarian gagal dimuat.");
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const groups = useMemo(() => {
    if (!result) return [];
    return Object.entries(result.groups).filter(([, hits]) => hits.length) as Array<[string, OwnerSearchHit[]]>;
  }, [result]);

  if (!open) return null;

  return (
    <div className="console-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="console-command" role="dialog" aria-modal="true" aria-labelledby="console-search-title">
        <div className="console-command-input-row">
          <Search size={19} aria-hidden="true" />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari pesanan, pelanggan, reseller, produk, atau stok..." aria-label="Pencarian global" />
          <button type="button" className="console-icon-button" onClick={onClose} aria-label="Tutup pencarian"><X size={18} /></button>
        </div>
        <div className="console-command-body">
          <div className="console-command-heading">
            <span id="console-search-title">Pencarian global</span>
            <span><Command size={13} /> K</span>
          </div>
          {query.trim().length < 2 ? (
            <div className="console-command-state">Ketik minimal 2 karakter untuk mencari data owner.</div>
          ) : loading ? (
            <div className="console-search-skeleton" aria-label="Memuat hasil pencarian">
              {Array.from({ length: 4 }, (_, index) => <span key={index} />)}
            </div>
          ) : error ? (
            <div className="console-command-state console-command-error">{error}</div>
          ) : groups.length ? (
            <div className="console-search-results">
              {groups.map(([group, hits]) => (
                <div key={group} className="console-search-group">
                  <p>{groupLabels[group] || group}</p>
                  {hits.map((hit) => (
                    <button type="button" key={`${hit.group}-${hit.id}`} onClick={() => { navigate(toConsoleHref(hit.href)); onClose(); }}>
                      <span><strong>{hit.title}</strong><small>{hit.subtitle || hit.detail}</small></span>
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="console-command-state">Tidak ada hasil untuk "{query.trim()}".</div>
          )}
        </div>
      </section>
    </div>
  );
}
