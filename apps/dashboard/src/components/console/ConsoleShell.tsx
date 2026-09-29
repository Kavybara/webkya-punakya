import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bell,
  CalendarClock,
  ChevronRight,
  CircleAlert,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  WifiOff,
  X,
} from "lucide-react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { clearSession, readSession } from "../../lib/session";
import { ConsoleSearch } from "./ConsoleSearch";
import { consoleNavigation } from "./navigation";
import { buildOwnerNotifications, type OwnerNotification } from "./ownerNotifications";
import "./console.css";

const notificationSeenKey = "owner-notification-seen-v1";

function notificationTime(value = "") {
  if (!value) return "Baru saja";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return "Baru saja";
  return date.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function NotificationIcon({ notification }: { notification: OwnerNotification }) {
  if (notification.kind === "warranty") return <ShieldAlert size={17} />;
  if (notification.kind === "rental") return <CalendarClock size={17} />;
  if (notification.kind === "connection") return <WifiOff size={17} />;
  return <CircleAlert size={17} />;
}

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
  const [notifications, setNotifications] = useState<OwnerNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsError, setNotificationsError] = useState("");
  const [seenNotificationIds, setSeenNotificationIds] = useState<Set<string>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(notificationSeenKey) || "[]");
      return new Set(Array.isArray(stored) ? stored.map(String) : []);
    } catch {
      return new Set();
    }
  });
  const session = sessionOwner();
  const displayName = String(session?.user?.name || session?.user?.username || "Owner");

  const loadNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    const [operations, warranties, rentals] = await Promise.allSettled([
      api.operationsCenter(),
      api.warrantyClaims(),
      api.whatsappRentals(),
    ]);
    if ([operations, warranties, rentals].every((result) => result.status === "rejected")) {
      setNotificationsError("Notifikasi belum dapat dimuat.");
      setNotificationsLoading(false);
      return;
    }
    setNotifications(buildOwnerNotifications({
      operations: operations.status === "fulfilled" ? operations.value : null,
      warranties: warranties.status === "fulfilled" ? warranties.value : [],
      rentals: rentals.status === "fulfilled" ? rentals.value : [],
    }));
    setNotificationsError([operations, warranties, rentals].some((result) => result.status === "rejected") ? "Sebagian sumber belum dapat dimuat." : "");
    setNotificationsLoading(false);
  }, []);

  const unreadNotifications = useMemo(
    () => notifications.filter((notification) => !seenNotificationIds.has(notification.id)),
    [notifications, seenNotificationIds],
  );
  const notificationBadgeCount = notificationsLoading && !notifications.length ? attentionCount : unreadNotifications.length;

  const storeSeenNotifications = useCallback((next: Set<string>) => {
    setSeenNotificationIds(next);
    try {
      localStorage.setItem(notificationSeenKey, JSON.stringify([...next].slice(-200)));
    } catch {
      // Reading notifications remains available when browser storage is blocked.
    }
  }, []);

  const markNotificationRead = useCallback((id: string) => {
    const next = new Set(seenNotificationIds);
    next.add(id);
    storeSeenNotifications(next);
  }, [seenNotificationIds, storeSeenNotifications]);

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

  useEffect(() => {
    void loadNotifications();
    const timer = window.setInterval(() => void loadNotifications(), 90_000);
    return () => window.clearInterval(timer);
  }, [loadNotifications]);

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
              <button type="button" className="console-icon-button" aria-label={`${notificationBadgeCount} notifikasi belum dibaca`} title="Pusat notifikasi" aria-expanded={notificationsOpen} onClick={() => { setProfileOpen(false); setNotificationsOpen((value) => !value); }}>
                <Bell size={18} />
                {notificationBadgeCount ? <span className="console-notification-count">{Math.min(notificationBadgeCount, 99)}</span> : null}
              </button>
              {notificationsOpen ? (
                <div className="console-notification-menu" role="dialog" aria-label="Pusat notifikasi">
                  <header>
                    <div><strong>Pusat notifikasi</strong><span>{notifications.length ? `${unreadNotifications.length} belum dibaca / ${notifications.length} aktif` : "Tidak ada antrean aktif"}</span></div>
                    <div className="console-notification-header-actions">
                      <button type="button" onClick={() => void loadNotifications()} disabled={notificationsLoading} aria-label="Perbarui notifikasi"><RefreshCw size={14} className={notificationsLoading ? "console-spin" : ""} /></button>
                      {unreadNotifications.length ? <button type="button" onClick={() => storeSeenNotifications(new Set([...seenNotificationIds, ...notifications.map((item) => item.id)]))}>Tandai dibaca</button> : null}
                    </div>
                  </header>
                  {notificationsLoading && !notifications.length ? <div className="console-notification-empty"><RefreshCw className="console-spin" size={18} /><span>Memuat antrean terbaru...</span></div> : null}
                  {notificationsError ? <div className="console-notification-warning">{notificationsError}</div> : null}
                  {notifications.length ? <div className="console-notification-list">
                    {notifications.map((notification) => {
                      const unread = !seenNotificationIds.has(notification.id);
                      return <Link key={notification.id} to={notification.href} className={`console-notification-item is-${notification.severity} ${unread ? "is-unread" : ""}`} onClick={() => { markNotificationRead(notification.id); setNotificationsOpen(false); }}>
                        <span className="console-notification-icon"><NotificationIcon notification={notification} /></span>
                        <span><strong>{notification.title}</strong><small>{notification.detail}</small><time>{notificationTime(notification.createdAt)}</time></span>
                        {unread ? <i aria-label="Belum dibaca" /> : null}
                      </Link>;
                    })}
                  </div> : !notificationsLoading ? <div className="console-notification-empty"><Bell size={18} /><span>Semua antrean operasional sudah bersih.</span></div> : null}
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
