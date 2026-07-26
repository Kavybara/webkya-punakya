import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Bell,
  ChevronRight,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Settings,
  WalletCards,
  X,
} from "lucide-react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { api, subscribeRealtime } from "../../lib/api";
import { clearSession, readSession } from "../../lib/session";
import { ResellerSearch } from "./ResellerSearch";
import { resellerNavigation } from "./navigation";
import { TopUpDialog } from "./TopUpDialog";
import "./reseller-v2.css";

function resellerSession() {
  const session = readSession();
  return session?.role === "reseller" ? session : null;
}

type ResellerShellActions = { openTopUp: () => void };

export function ResellerShell({
  title,
  description,
  balance,
  lastUpdated,
  loading,
  onRefresh,
  children,
}: {
  title: string;
  description: string;
  balance?: string;
  lastUpdated?: string;
  loading?: boolean;
  onRefresh?: () => void;
  children: ReactNode | ((actions: ResellerShellActions) => ReactNode);
}) {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState(() => Boolean(resellerSession()));
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [loadedBalance, setLoadedBalance] = useState("");
  const [unreadDeliveryCount, setUnreadDeliveryCount] = useState(0);
  const session = resellerSession();
  const displayName = String(
    session?.user?.name || session?.user?.username || "Reseller",
  );

  const closeOverlays = useCallback(() => {
    setDrawerOpen(false);
    setProfileOpen(false);
    setTopUpOpen(false);
  }, []);

  const loadBalance = useCallback(() => {
    if (balance !== undefined) return;
    api
      .resellers()
      .then((rows) => {
        const amount = Number(rows[0]?.deposit || 0);
        setLoadedBalance(
          new Intl.NumberFormat("id-ID", {
            style: "currency",
            currency: "IDR",
            maximumFractionDigits: 0,
          }).format(amount),
        );
      })
      .catch(() => setLoadedBalance("-"));
  }, [balance]);

  useEffect(() => {
    const current = readSession();
    if (!current?.role) {
      navigate("/login?next=/reseller-v2/ringkasan", { replace: true });
      return;
    }
    if (current.role !== "reseller") {
      navigate("/owner-v2", { replace: true });
      return;
    }
    setAllowed(true);
  }, [navigate]);

  useEffect(() => {
    if (balance !== undefined) return;
    loadBalance();
  }, [balance, loadBalance]);

  useEffect(() => {
    const loadUnread = () => api.unreadDeliveryCount()
      .then((result) => setUnreadDeliveryCount(Math.max(0, Number(result.count || 0))))
      .catch(() => undefined);
    loadUnread();
    return subscribeRealtime(loadUnread);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") closeOverlays();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeOverlays]);

  if (!allowed) return null;

  const shownBalance = (balance ?? loadedBalance) || "Memuat...";
  const openTopUp = () => {
    setDrawerOpen(false);
    setTopUpOpen(true);
  };
  const renderedChildren =
    typeof children === "function" ? children({ openTopUp }) : children;
  const sidebar = (
    <>
      <div className="reseller-v2-brand-row">
        <Link
          to="/reseller-v2/ringkasan"
          className="reseller-v2-brand"
          aria-label="Kavya Reseller Ringkasan"
        >
          <span>K</span>
          {!collapsed ? <strong>Kavya Reseller</strong> : null}
        </Link>
        <button
          type="button"
          className="reseller-v2-collapse reseller-v2-desktop-only"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Perbesar sidebar" : "Perkecil sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen size={17} />
          ) : (
            <PanelLeftClose size={17} />
          )}
        </button>
        <button
          type="button"
          className="reseller-v2-collapse reseller-v2-mobile-only"
          onClick={() => setDrawerOpen(false)}
          aria-label="Tutup menu"
        >
          <X size={18} />
        </button>
      </div>
      {!collapsed ? (
        <div className="reseller-v2-side-balance">
          <span>
            <WalletCards size={15} /> Saldo
          </span>
          <Link
            className="reseller-v2-balance-link"
            to="/reseller-v2/ringkasan#saldo"
          >
            {shownBalance}
          </Link>
          <button type="button" onClick={openTopUp} aria-label="Top Up saldo">
            <Plus size={14} /> Top Up
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={openTopUp}
          className="reseller-v2-side-wallet"
          aria-label="Top Up saldo"
        >
          <WalletCards size={18} />
        </button>
      )}
      <nav className="reseller-v2-nav" aria-label="Navigasi reseller">
        {resellerNavigation.map((group) => (
          <div key={group.label} className="reseller-v2-nav-group">
            {!collapsed ? (
              <p>{group.label}</p>
            ) : (
              <span className="reseller-v2-nav-divider" />
            )}
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  title={collapsed ? item.label : undefined}
                  onClick={() => setDrawerOpen(false)}
                  className={({ isActive }) =>
                    `reseller-v2-nav-link ${isActive ? "is-active" : ""}`
                  }
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                  {item.path === "/reseller-v2/accounts" && unreadDeliveryCount > 0 ? (
                    <b className="reseller-v2-new-count" aria-label={`${unreadDeliveryCount} akun baru`}>
                      {unreadDeliveryCount}
                    </b>
                  ) : null}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="reseller-v2-sidebar-footer">
        <Link to="/reseller-v2/settings" className="reseller-v2-nav-link">
          <Settings size={18} />
          <span>Pengaturan</span>
        </Link>
      </div>
    </>
  );

  const mobileItems = resellerNavigation
    .flatMap((group) => group.items)
    .filter((item) =>
      [
        "/reseller-v2/ringkasan",
        "/reseller-v2/catalog",
        "/reseller-v2/orders",
        "/reseller-v2/accounts",
        "/reseller-v2/warranty",
      ].includes(item.path),
    );

  return (
    <div
      className={`kavya-reseller-v2 ${collapsed ? "reseller-v2-is-collapsed" : ""}`}
    >
      <aside className="reseller-v2-sidebar reseller-v2-desktop-sidebar">
        {sidebar}
      </aside>
      {drawerOpen ? (
        <div
          className="reseller-v2-mobile-backdrop"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setDrawerOpen(false)
          }
        >
          <aside
            className="reseller-v2-sidebar reseller-v2-mobile-sidebar"
            aria-label="Menu reseller"
          >
            {sidebar}
          </aside>
        </div>
      ) : null}
      <div className="reseller-v2-workspace">
        <header className="reseller-v2-topbar">
          <div className="reseller-v2-topbar-context">
            <button
              type="button"
              className="reseller-v2-icon-button reseller-v2-mobile-only"
              onClick={() => setDrawerOpen(true)}
              aria-label="Buka menu"
            >
              <Menu size={19} />
            </button>
            <div>
              <span>Kavya Reseller</span>
              <ChevronRight size={13} />
              <strong>{title}</strong>
            </div>
          </div>
          <button
            type="button"
            className="reseller-v2-search-trigger"
            onClick={() => setSearchOpen(true)}
            aria-label="Buka pencarian global"
          >
            <Search size={17} />
            <span>Cari produk, pesanan, akun...</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="reseller-v2-topbar-actions">
            <button
              type="button"
              onClick={openTopUp}
              className="reseller-v2-topup"
            >
              <Plus size={15} />
              <span>Top Up</span>
            </button>
            <Link
              to="/reseller-v2/ringkasan#saldo"
              className="reseller-v2-top-balance"
            >
              <WalletCards size={15} />
              {shownBalance}
            </Link>
            <button
              type="button"
              className="reseller-v2-icon-button"
              aria-label="Notifikasi reseller"
              onClick={() => unreadDeliveryCount > 0 && navigate("/reseller-v2/accounts")}
            >
              <Bell size={18} />
              {unreadDeliveryCount > 0 ? <span className="reseller-v2-notification-dot">{unreadDeliveryCount}</span> : null}
            </button>
            <div className="reseller-v2-profile-wrap">
              <button
                type="button"
                className="reseller-v2-profile-button"
                onClick={() => setProfileOpen((value) => !value)}
                aria-expanded={profileOpen}
              >
                <span>{displayName.slice(0, 1).toUpperCase()}</span>
                <strong>{displayName}</strong>
              </button>
              {profileOpen ? (
                <div className="reseller-v2-profile-menu">
                  <Link
                    to="/reseller-v2/settings"
                    onClick={() => setProfileOpen(false)}
                  >
                    <Settings size={16} /> Pengaturan
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      api.logout().catch(() => undefined);
                      clearSession();
                      navigate("/login", { replace: true });
                    }}
                  >
                    <LogOut size={16} /> Keluar
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main className="reseller-v2-main">
          <header className="reseller-v2-page-header">
            <div>
              <p>Kavya Reseller</p>
              <h1>{title}</h1>
              <span>{description}</span>
            </div>
            <div className="reseller-v2-page-actions">
              {lastUpdated ? <small>Diperbarui {lastUpdated}</small> : null}
              {onRefresh ? (
                <button type="button" onClick={onRefresh} disabled={loading}>
                  <RefreshCw
                    size={16}
                    className={loading ? "reseller-v2-spin" : ""}
                  />
                  {loading ? "Memuat" : "Perbarui"}
                </button>
              ) : null}
            </div>
          </header>
          {renderedChildren}
        </main>
      </div>
      <nav
        className="reseller-v2-bottom-nav"
        aria-label="Navigasi reseller mobile"
      >
        {mobileItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => (isActive ? "is-active" : "")}
            >
              <Icon size={19} />
              <span>{item.shortLabel}</span>
              {item.path === "/reseller-v2/accounts" && unreadDeliveryCount > 0 ? <b>{unreadDeliveryCount}</b> : null}
            </NavLink>
          );
        })}
      </nav>
      <ResellerSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <TopUpDialog
        open={topUpOpen}
        onClose={() => setTopUpOpen(false)}
        onBalanceChanged={loadBalance}
      />
    </div>
  );
}
