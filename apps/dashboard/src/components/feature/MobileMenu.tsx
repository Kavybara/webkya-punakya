import { NavLink } from "react-router-dom";
import type { Role } from "../../mocks/data";
import { navItems } from "./Sidebar";

export function MobileMenu({
  open,
  role,
  onClose,
}: {
  open: boolean;
  role: Role;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }

  const visibleItems = navItems.filter((item) => item.roles.includes(role));

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button aria-label="Tutup menu" className="absolute inset-0 animate-fade-in bg-slate-900/40" onClick={onClose} />
      <aside className="relative flex h-full w-[min(86vw,320px)] animate-drawer-in flex-col border-r border-gray-100 bg-white shadow-2xl shadow-slate-950/20">
        <div className="flex h-20 items-center justify-between border-b border-gray-100 px-5">
          <div>
            <div className="font-serif text-lg font-semibold text-slate-950">Kavya</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              {role === "owner" ? "Owner Panel" : "Reseller Panel"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-100 text-slate-600"
            aria-label="Tutup menu"
          >
            <i className="ri-close-line text-lg" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3 pt-4">
          {visibleItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/dashboard" || item.path === "/reseller"}
              onClick={onClose}
              className={({ isActive }) =>
                `flex h-12 items-center gap-3 rounded-xl px-4 text-[15px] transition-colors ${
                  isActive
                    ? "bg-red-50 font-semibold text-red-600"
                    : "text-slate-700 hover:bg-red-50 hover:text-red-600"
                }`
              }
            >
              <span className="flex h-5 w-5 items-center justify-center">
                <i className={`${item.icon} text-base`} />
              </span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-gray-100 px-5 py-4 text-xs leading-5 text-slate-400">
          Pilih menu untuk berpindah halaman.
        </div>
      </aside>
    </div>
  );
}
