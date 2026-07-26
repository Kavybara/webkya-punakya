import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Bell,
  ChevronRight,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings,
  X,
} from "lucide-react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { clearSession, readSession } from "../../lib/session";
import { ConsoleSearch } from "./ConsoleSearch";
import { consoleNavigation } from "./navigation";
import "./console.css";

function sessionOwner() {
  const session = readSession();
  return session?.role === "owner" ? session : null;
}

export function ConsoleShell({
  title,
  description,
  lastUpdated,
  refreshing,
  attentionCount = 0,
  systemState = "healthy",
  onRefresh,
  children,
}: {
  title: string;
  description: string;
  lastUpdated?: string;
  refreshing?: boolean;
  attentionCount?: number;
  systemState?: "loading" | "healthy" | "warning" | "unknown";
  onRefresh?: () => void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState(() => Boolean(sessionOwner()));
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const session = sessionOwner();
  const displayName = String(session?.user?.name || session?.user?.username || "Owner");

  const closeOverlays = useCallback(() => {
    setDrawerOpen(false);
    setProfileOpen(false);
    setNotificationsOpen(false);
  }, []);

  useEffect(() => {
    const current = readSession();
    if (!current?.role) {
      navigate("/login?next=/owner-v2", { replace: true });
      return;
    }
    if (current.role !== "owner") {
      navigate("/reseller", { replace: true });
      return;
    }
    setAllowed(true);
  }, [navigate]);

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

  const sidebar = (
    <>
      <div className="console-brand-row">
        <Link to="/owner-v2" className="console-brand" aria-label="Kavya Console overview">
          <span>K</span>
          {!collapsed ? <strong>Kavya Console</strong> : null}
        </Link>
        <button type="button" className="console-collapse-button console-desktop-only" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Perbesar sidebar" : "Perkecil sidebar"}>
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
        <button type="button" className="console-collapse-button console-mobile-only" onClick={() => setDrawerOpen(false)} aria-label="Tutup menu">
          <X size={18} />
        </button>
      </div>
      <nav className="console-nav" aria-label="Navigasi owner console">
        {consoleNavigation.map((group) => (
          <div key={group.label} className="console-nav-group">
            {!collapsed ? <p>{group.label}</p> : <span className="console-nav-divider" />}
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === "/owner-v2"}
                  title={collapsed ? item.label : undefined}
                  onClick={() => setDrawerOpen(false)}
                  className={({ isActive }) => `console-nav-link ${isActive ? "is-active" : ""}`}
                >
                  <Icon size={18} aria-hidden="true" />
                  {!collapsed ? <span>{item.label}</span> : null}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="console-sidebar-footer">
        <Link to="/owner-v2/settings" className="console-nav-link" title={collapsed ? "Pengaturan owner" : undefined}>
          <Settings size={18} />
          {!collapsed ? <span>Pengaturan owner</span> : null}
        </Link>
      </div>
    </>
  );

  return (
    <div className={`kavya-console ${collapsed ? "console-is-collapsed" : ""}`}>
      <aside className="console-sidebar console-desktop-sidebar">{sidebar}</aside>
      {drawerOpen ? (
        <div className="console-mobile-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDrawerOpen(false)}>
          <aside className="console-sidebar console-mobile-sidebar" aria-label="Menu owner console">{sidebar}</aside>
        </div>
      ) : null}

      <div className="console-workspace">
        <header className="console-topbar">
          <div className="console-topbar-context">
            <button type="button" className="console-icon-button console-mobile-only" onClick={() => setDrawerOpen(true)} aria-label="Buka menu">
              <Menu size={19} />
            </button>
            <div>
              <span>Owner Console</span>
              <ChevronRight size={13} aria-hidden="true" />
              <strong>{title}</strong>
            </div>
          </div>
          <button type="button" className="console-search-trigger" onClick={() => setSearchOpen(true)} aria-label="Buka pencarian global">
            <Search size={17} />
            <span>Cari di Kavya...</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="console-topbar-actions">
            <div className="console-status-pill" title="Status berasal dari respons API Overview terbaru">
              <span className={systemState === "healthy" ? "is-online" : systemState === "warning" ? "is-warning" : "is-unknown"} />
              <span>{systemState === "loading" ? "Memeriksa sistem" : systemState === "unknown" ? "Status belum tersedia" : systemState === "warning" ? `${attentionCount} perlu perhatian` : "Operasional normal"}</span>
            </div>
            <div className="console-notification-wrap">
              <button type="button" className="console-icon-button" aria-label={`${attentionCount} notifikasi operasional`} title="Notifikasi operasional" aria-expanded={notificationsOpen} onClick={() => { setProfileOpen(false); setNotificationsOpen((value) => !value); }}>
                <Bell size={18} />
                {attentionCount ? <span className="console-notification-count">{Math.min(attentionCount, 99)}</span> : null}
              </button>
              {notificationsOpen ? (
                <div className="console-notification-menu" role="dialog" aria-label="Notifikasi operasional">
                  <header><div><strong>Perlu perhatian</strong><span>{attentionCount ? `${attentionCount} item pada halaman ini` : "Tidak ada peringatan pada halaman ini"}</span></div></header>
                  <Link to="/owner-v2/operations" onClick={() => setNotificationsOpen(false)}><span>Operations Center</span><small>Audit anomali dan recovery</small></Link>
                  <Link to="/owner-v2/orders?status=delivery-failed" onClick={() => setNotificationsOpen(false)}><span>Pesanan bermasalah</span><small>Cek pembayaran dan fulfillment</small></Link>
                  <Link to="/owner-v2/resellers" onClick={() => setNotificationsOpen(false)}><span>Permintaan deposit</span><small>Proses antrean reseller</small></Link>
                  <Link to="/owner-v2/integrations" onClick={() => setNotificationsOpen(false)}><span>Status integrasi</span><small>WhatsApp, Sheets, dan layanan lain</small></Link>
                </div>
              ) : null}
            </div>
            <div className="console-profile-wrap">
              <button type="button" className="console-profile-button" onClick={() => { setNotificationsOpen(false); setProfileOpen((value) => !value); }} aria-expanded={profileOpen}>
                <span>{displayName.slice(0, 1).toUpperCase()}</span>
                <strong>{displayName}</strong>
              </button>
              {profileOpen ? (
                <div className="console-profile-menu">
                  <Link to="/owner-v2/settings" onClick={() => setProfileOpen(false)}><Settings size={16} /> Pengaturan owner</Link>
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

        <main className="console-main">
          <header className="console-page-header">
            <div>
              <p>Kavya Console</p>
              <h1>{title}</h1>
              <span>{description}</span>
            </div>
            <div className="console-page-actions">
              {lastUpdated ? <span className="console-updated-at">Diperbarui {lastUpdated}</span> : null}
              {onRefresh ? (
                <button type="button" className="console-secondary-button" onClick={onRefresh} disabled={refreshing}>
                  <RefreshCw size={16} className={refreshing ? "console-spin" : ""} />
                  {refreshing ? "Memuat" : "Refresh"}
                </button>
              ) : null}
            </div>
          </header>
          {children}
        </main>
      </div>
      <ConsoleSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
