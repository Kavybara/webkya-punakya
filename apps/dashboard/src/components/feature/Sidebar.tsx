import { NavLink } from "react-router-dom";
import { clearSession } from "../../lib/session";
import type { Role } from "../../mocks/data";

export type NavItem = {
  label: string;
  path: string;
  icon: string;
  roles: Role[];
};

const navItems: NavItem[] = [
  { label: "Overview", path: "/dashboard", icon: "ri-dashboard-line", roles: ["owner"] },
  { label: "Search", path: "/dashboard/search", icon: "ri-search-line", roles: ["owner"] },
  { label: "Stok Akun", path: "/dashboard/stock", icon: "ri-database-2-line", roles: ["owner"] },
  { label: "Produk", path: "/dashboard/products", icon: "ri-stack-line", roles: ["owner"] },
  { label: "Manajemen Akun", path: "/dashboard/accounts", icon: "ri-shield-keyhole-line", roles: ["owner"] },
  { label: "Reseller", path: "/dashboard/resellers", icon: "ri-user-shared-line", roles: ["owner"] },
  { label: "Order & QRIS", path: "/dashboard/orders", icon: "ri-shopping-cart-2-line", roles: ["owner"] },
  { label: "Operations", path: "/dashboard/operations", icon: "ri-radar-line", roles: ["owner"] },
  { label: "WhatsApp Group", path: "/dashboard/whatsapp", icon: "ri-whatsapp-line", roles: ["owner"] },
  { label: "Activity Log", path: "/dashboard/activities", icon: "ri-history-line", roles: ["owner"] },
  { label: "Overview", path: "/reseller", icon: "ri-dashboard-line", roles: ["reseller"] },
  { label: "Katalog Produk", path: "/reseller/catalog", icon: "ri-shopping-bag-3-line", roles: ["reseller"] },
  { label: "Kelola Akun", path: "/reseller/manage-account", icon: "ri-table-line", roles: ["reseller"] },
  { label: "Riwayat", path: "/reseller/history", icon: "ri-history-line", roles: ["reseller"] },
  { label: "Akses Akun", path: "/reseller/accounts", icon: "ri-search-line", roles: ["reseller"] },
  { label: "Garansi", path: "/reseller/warranty", icon: "ri-shield-check-line", roles: ["reseller"] },
];

export function Sidebar({ role }: { role: Role }) {
  const visibleItems = navItems.filter((item) => item.roles.includes(role));

  return (
    <aside className="fixed left-0 top-0 hidden h-screen w-[238px] border-r border-gray-100 bg-white md:flex md:flex-col">
      <div className="flex h-[86px] items-center border-b border-gray-100 px-5">
        <div>
          <div className="font-serif text-lg font-semibold leading-none text-slate-950">Kavya</div>
          <div className="mt-2 text-[10px] font-medium uppercase tracking-widest text-slate-400">{role === "owner" ? "Owner Panel" : "Reseller Panel"}</div>
        </div>
      </div>
      <nav className="flex-1 space-y-2 px-3 py-5">
        {visibleItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === "/dashboard" || item.path === "/reseller"}
            className={({ isActive }) =>
              `flex h-10 items-center gap-3 rounded-lg px-4 text-sm transition-colors ${
                isActive
                  ? "bg-red-50 font-semibold text-red-600"
                  : "font-medium text-slate-600 hover:bg-red-50 hover:text-red-600"
              }`
            }
          >
            <span className="flex h-4 w-4 items-center justify-center text-current">
              <i className={`${item.icon} text-sm`} />
            </span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-gray-100 p-4">
        <NavLink
          to="/login"
          onClick={clearSession}
          className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <span className="flex h-4 w-4 items-center justify-center">
            <i className="ri-logout-box-line text-sm" />
          </span>
          <span>Logout</span>
        </NavLink>
      </div>
    </aside>
  );
}

export { navItems };
