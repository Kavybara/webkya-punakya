import { ArrowUpRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, type OwnerSearchHit, type OwnerSearchResult } from "../../lib/api";
import { CommandKeyHint, CommandPalette, type CommandGroup } from "../ui";

/** A group key the API returns, as a heading a person would use. */
const GROUP_LABELS: Record<string, string> = {
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

/**
 * Owner search is the one place the console asks the server what it has,
 * because the owner's data is every order, every account and every reseller in
 * the system and the browser is never sent all of it. So this is the half of
 * the palette that does not already know its results: `search` returns a
 * promise, and the palette waits for the reader to stop typing before it makes
 * the request.
 */
export function ConsoleSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();

  return (
    <CommandPalette
      open={open}
      onClose={onClose}
      onSelect={(hit) => navigate(hit.href)}
      title="Pencarian global"
      label="Pencarian global"
      placeholder="Cari pesanan, pelanggan, reseller, produk, atau stok..."
      hint={<CommandKeyHint />}
      // Two characters, then a pause. A server round trip per keystroke is a
      // cost the owner pays on every character, and one character matches most
      // of the system anyway.
      minChars={2}
      debounceMs={250}
      idle="Ketik minimal 2 karakter untuk mencari data owner."
      search={async (query): Promise<CommandGroup[]> => {
        const result: OwnerSearchResult = await api.ownerSearch(query);
        return (Object.entries(result.groups) as Array<[string, OwnerSearchHit[]]>)
          .filter(([, hits]) => hits.length)
          .map(([group, hits]) => ({
            label: GROUP_LABELS[group] || group,
            hits: hits.map((hit) => ({
              id: `${group}-${hit.id}`,
              label: hit.title,
              detail: hit.subtitle || hit.detail,
              href: toConsoleHref(hit.href),
              icon: ArrowUpRight,
            })),
          }));
      }}
    />
  );
}
