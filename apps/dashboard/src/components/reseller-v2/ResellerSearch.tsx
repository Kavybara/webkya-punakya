import { useEffect, useState } from "react";
import { Grid2X2, PackageCheck, ReceiptText } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, type ApiAccount, type ApiOrder, type CatalogProduct } from "../../lib/api";
import { CommandPalette, maskIdentity, type CommandGroup } from "../ui";

type SearchData = { products: CatalogProduct[]; orders: ApiOrder[]; accounts: ApiAccount[] };

const EMPTY: SearchData = { products: [], orders: [], accounts: [] };

/** How many hits one group may contribute, so a broad term cannot bury the rest. */
const PER_GROUP = 4;

const DESTINATIONS = [
  { href: "/reseller-v2/catalog", label: "Buka katalog", Icon: Grid2X2 },
  { href: "/reseller-v2/orders", label: "Lihat pesanan", Icon: ReceiptText },
  { href: "/reseller-v2/accounts", label: "Buka akun saya", Icon: PackageCheck },
];

/** Whether a haystack mentions the needle, without a regular expression the reader's text has to survive. */
function mentions(needle: string, ...parts: Array<string | undefined | null>) {
  return parts.some((part) => part?.toLowerCase().includes(needle));
}

/**
 * Reseller search is the other half: the data is the reseller's own catalogue,
 * their own orders and their own accounts, all of which the console has
 * already loaded and none of which is allowed to reach another reseller. So
 * there is nothing to ask the server -- `search` below is a plain filter over
 * what is already in memory, and the palette runs it on every keystroke.
 *
 * The load still happens on open rather than on page load, because the three
 * requests are not free and a reader who never searches should not pay for it.
 */
export function ResellerSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [data, setData] = useState<SearchData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || ready || loading) return undefined;
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([api.catalog(), api.orders(), api.accounts({ view: "overview" })])
      .then(([products, orders, accounts]) => {
        if (!active) return;
        setData({ products, orders, accounts });
        setReady(true);
      })
      .catch(() => {
        if (active) setError("Pencarian belum dapat dimuat. Coba lagi beberapa saat.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loading, open, ready]);

  return (
    <CommandPalette
      open={open}
      onClose={onClose}
      onSelect={(hit) => navigate(hit.href)}
      title="Pencarian reseller"
      label="Pencarian reseller"
      placeholder="Cari produk, pesanan, atau akun..."
      // The three requests are still in the air. Saying "no matches" now would
      // be a lie the reader cannot check.
      busy={loading || !ready}
      empty="Tidak ada hasil pada data Anda."
      idle={
        error ? (
          <p className="ui-command-alert" role="alert">
            {error}
          </p>
        ) : (
          <div className="ui-command-shortcuts">
            {DESTINATIONS.map(({ href, label, Icon }) => (
              <button key={href} type="button" onClick={() => navigate(href)}>
                <Icon size={16} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        )
      }
      search={(query): CommandGroup[] => {
        const needle = query.trim().toLowerCase();
        if (!needle) return [];
        return [
          {
            label: "Produk",
            hits: data.products
              .filter((item) => mentions(needle, item.name, item.code, item.category))
              .slice(0, PER_GROUP)
              .map((item) => ({
                id: item.id,
                label: item.name,
                detail: item.category || "Produk digital",
                href: "/reseller-v2/catalog",
                icon: Grid2X2,
              })),
          },
          {
            label: "Pesanan",
            hits: data.orders
              .filter((item) => mentions(needle, item.id, item.product, item.variant))
              .slice(0, PER_GROUP)
              .map((item) => ({
                id: item.id,
                label: item.id,
                detail: `${item.product} / ${item.variant}`,
                href: "/reseller-v2/orders",
                icon: ReceiptText,
              })),
          },
          {
            label: "Akun",
            hits: data.accounts
              .filter((item) => mentions(needle, item.product, item.variant, item.email, item.loginPhone, item.profile))
              .slice(0, PER_GROUP)
              .map((item) => ({
                id: item.id,
                label: item.product,
                detail: `${maskIdentity(item.loginPhone || item.email)} / ${item.profile || "Tanpa profil"}`,
                href: "/reseller-v2/accounts",
                icon: PackageCheck,
              })),
          },
        ];
      }}
    />
  );
}
