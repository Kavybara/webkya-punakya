import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronRight,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { clearSession, readSession } from "../../lib/session";
import { Button } from "./Button";
import { ShellNav } from "./ShellNav";

const COLLAPSE_KEY = "kavya-shell-collapsed";

export type AppShellNavItem = {
  label: string;
  path: string;
  icon: LucideIcon;
  /** The label used under the icon on a phone. Falls back to `label`. */
  shortLabel?: string;
  /** A count to show on the item. Nothing renders when it is 0. */
  badge?: number;
  /**
   * Match the path exactly. A link to `/owner-v2` stays lit on every page
   * under it otherwise, which reads as "you are still on the overview".
   */
  end?: boolean;
};

export type AppShellNavGroup = {
  label: string;
  items: AppShellNavItem[];
};

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    // Storage can be blocked outright. A shell that forgets the width is a
    // much smaller problem than one that throws on mount.
    return false;
  }
}

/**
 * A popover that closes the way a reader expects: Escape, or a click that
 * lands outside it.
 *
 * Neither console did this. The profile menu stayed open behind whatever the
 * reader clicked next, so a second click went somewhere the menu was covering
 * and the reader had to press Escape to find out.
 *
 * Exported because a popover that lives in a slot -- the notification centre
 * is one -- needs the same behaviour, and a second implementation of it would
 * drift within a month.
 */
export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    function onMouseDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);
  return ref;
}

/**
 * The frame every signed-in page sits in.
 *
 * There were two of these, 79% identical, and they had drifted: the owner
 * console had a notification centre and no bottom bar, the reseller had a
 * bottom bar and no notification centre, the owner collapsed its sidebar for
 * the length of a visit while the reseller remembered nothing, and both
 * spelled the same refresh button two different ways. This is the one frame.
 *
 * What it owns -- the session gate, the collapsible rail, the mobile drawer,
 * the search trigger and its Ctrl+K, the profile popover, the sign-out, the
 * page header -- is the part that must behave identically for an owner and a
 * reseller, because a reader who switches roles should not have to relearn
 * where anything is.
 *
 * What it does not own is passed in as slots: the notification centre, the
 * balance and top-up controls, the search palette. Those know what data they
 * are showing; the shell only knows where to put them.
 */
export function AppShell({
  role,
  product,
  homePath,
  homeLabel,
  deniedPath,
  navigation,
  bottomNavigation,
  settings,
  title,
  description,
  lastUpdated,
  refreshing,
  onRefresh,
  sidebarTop,
  topbarLeading,
  topbarActions,
  search,
  searchPlaceholder = "Cari di Kavya...",
  searchLabel = "Buka pencarian global",
  children,
}: {
  role: "owner" | "reseller";
  /** Used for the brand, the breadcrumb and the page eyebrow, so they cannot disagree. */
  product: string;
  homePath: string;
  homeLabel: string;
  /** Where someone with the other role is sent. */
  deniedPath: string;
  navigation: AppShellNavGroup[];
  /** Rendered as a bar along the bottom edge on a phone. */
  bottomNavigation?: AppShellNavItem[];
  settings: { path: string; label: string };
  title: string;
  description: string;
  lastUpdated?: string;
  refreshing?: boolean;
  /**
   * `Promise<void>` is allowed because every caller's reload is async -- it
   * refetches from the API. The shell only ever calls this from a click
   * handler, where a returned promise is discarded by design, so awaiting it
   * here would buy nothing. Declaring `() => void` instead made every one of
   * those call sites a type error the only escape from which was to wrap the
   * function in a `void` operator that promised nothing was awaited.
   */
  onRefresh?: () => void | Promise<void>;
  /** Sits under the brand, above the navigation. The reseller's balance. */
  sidebarTop?: ReactNode;
  /** Left of the search field. The owner's system status. */
  topbarLeading?: ReactNode;
  topbarActions?: (controls: { closePopovers: () => void }) => ReactNode;
  /** The search palette itself, opened by the trigger and by Ctrl+K. */
  search?: (controls: { close: () => void }) => ReactNode;
  searchPlaceholder?: string;
  searchLabel?: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState(() => readSession()?.role === role);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const session = readSession();
  const displayName = String(
    session?.user?.name || session?.user?.username || (role === "owner" ? "Owner" : "Reseller"),
  );

  const closeOverlays = useCallback(() => {
    setDrawerOpen(false);
    setProfileOpen(false);
  }, []);

  const closePopovers = useCallback(() => setProfileOpen(false), []);

  // One gate, both consoles. An owner reaching a reseller page goes to the
  // console, a reseller reaching an owner page goes to their own summary, and
  // anyone signed out goes to sign-in with somewhere to come back to.
  useEffect(() => {
    const current = readSession();
    if (!current?.role) {
      void navigate(`/login?next=${encodeURIComponent(homePath)}`, { replace: true });
      return;
    }
    if (current.role !== role) {
      void navigate(deniedPath, { replace: true });
      return;
    }
    setAllowed(true);
  }, [deniedPath, homePath, navigate, role]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      // A narrower sidebar next time is not worth surfacing an error for.
    }
  }, [collapsed]);

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

  const signOut = useCallback(() => {
    // The local session goes first and unconditionally. If the request fails
    // the reader is still signed out here, and a stale token on the server
    // expires on its own.
    clearSession();
    void api.logout().catch(() => undefined);
    void navigate("/login", { replace: true });
  }, [navigate]);

  const profileRef = useDismiss(profileOpen, closePopovers);

  if (!allowed) return null;

  /* The rail, as four regions rather than one list of children.

     It was a fragment with a conditional in it, and the conditional was the
     problem: the settings link and the sign-out lived in a footer that was
     separated from the navigation only by a border, so a reader had no way to
     know the settings were part of the same place they could reach and the
     sign-out was somewhere else entirely. Signing out was reachable from
     exactly one control -- a popover in the top bar, which is the first thing
     a phone layout drops.

     The two are now peers in the rail's own last region, and signing out does
     not require finding a menu. */
  const rail = (
    <>
      <div className="ui-shell-brand-row">
        <Link to={homePath} className="ui-shell-brand" aria-label={homeLabel}>
          <span>K</span>
          {!collapsed ? <strong>{product}</strong> : null}
        </Link>
        <button
          type="button"
          className="ui-shell-collapse is-desktop-only"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Perbesar sidebar" : "Perkecil sidebar"}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
        <button
          type="button"
          className="ui-shell-collapse is-mobile-only"
          onClick={() => setDrawerOpen(false)}
          aria-label="Tutup menu"
        >
          <X size={18} />
        </button>
      </div>

      {/* The reseller's balance sits here, between the brand and the
          navigation, so the number is above the list of things that spend it. */}
      {sidebarTop}

      <ShellNav
        groups={navigation}
        collapsed={collapsed}
        label={`Navigasi ${product}`}
        onNavigate={() => setDrawerOpen(false)}
      />

      <div className="ui-shell-rail-foot">
        <NavLink
          to={settings.path}
          className="ui-shell-nav-item is-static"
          title={collapsed ? settings.label : undefined}
          onClick={() => setDrawerOpen(false)}
        >
          <i className="ui-shell-nav-rail" aria-hidden="true" />
          <Settings size={18} aria-hidden="true" />
          {!collapsed ? <span>{settings.label}</span> : null}
        </NavLink>
        <button
          type="button"
          className="ui-shell-nav-item is-static ui-shell-signout"
          onClick={signOut}
          title={collapsed ? "Keluar" : undefined}
        >
          <i className="ui-shell-nav-rail" aria-hidden="true" />
          <LogOut size={18} aria-hidden="true" />
          {!collapsed ? <span>Keluar</span> : null}
        </button>
      </div>
    </>
  );

  return (
    <div className={`ui-shell${collapsed ? " is-collapsed" : ""}`}>
      <aside className="ui-shell-sidebar is-desktop">{rail}</aside>
      {drawerOpen ? (
        <div
          className="ui-shell-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDrawerOpen(false);
          }}
        >
          <aside className="ui-shell-sidebar is-drawer" aria-label={`Menu ${product}`}>
            {rail}
          </aside>
        </div>
      ) : null}

      <div className="ui-shell-workspace">
        <header className="ui-shell-topbar">
          <div className="ui-shell-context">
            <button
              type="button"
              className="ui-shell-icon-button is-mobile-only"
              onClick={() => setDrawerOpen(true)}
              aria-label="Buka menu"
            >
              <Menu size={19} />
            </button>
            <div>
              <span>{product}</span>
              <ChevronRight size={13} aria-hidden="true" />
              <strong>{title}</strong>
            </div>
          </div>
          <button
            type="button"
            className="ui-shell-search"
            onClick={() => setSearchOpen(true)}
            aria-label={searchLabel}
          >
            <Search size={17} aria-hidden="true" />
            <span>{searchPlaceholder}</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="ui-shell-actions">
            {topbarLeading}
            {topbarActions?.({ closePopovers })}
            <div className="ui-shell-profile" ref={profileRef}>
              <button
                type="button"
                className="ui-shell-profile-button"
                onClick={() => setProfileOpen((value) => !value)}
                aria-expanded={profileOpen}
                aria-haspopup="menu"
              >
                <span aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span>
                <strong>{displayName}</strong>
              </button>
              {/* An account menu, not a two-item list.

                  It used to open straight onto "settings" and "sign out", both
                  of which are now also in the rail, which made it a menu that
                  duplicated the rail and told you nothing. It opens onto who
                  you are signed in as and what you can do, so opening it is
                  worth the click. Signing out stays here as well as in the
                  rail: it is the one action in the product where two doors is
                  the right answer, and on a phone the rail is behind a
                  hamburger while this is one tap away. */}
              {profileOpen ? (
                <div className="ui-shell-profile-menu">
                  <div className="ui-shell-profile-head">
                    <span aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span>
                    <div>
                      <strong>{displayName}</strong>
                      <small>
                        {session?.user?.username ? `@${session.user.username}` : role === "owner" ? "Owner" : "Reseller"}
                      </small>
                    </div>
                  </div>
                  <div role="menu">
                    <Link to={settings.path} onClick={() => setProfileOpen(false)} role="menuitem">
                      <Settings size={16} aria-hidden="true" /> {settings.label}
                    </Link>
                    <button type="button" role="menuitem" onClick={signOut}>
                      <LogOut size={16} aria-hidden="true" /> Keluar
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="ui-shell-main">
          {/* The page header is a region of the frame, not a div a page
              happens to start with, so it lives here and every page inherits
              the same rhythm. The eyebrow, the title and the sentence under
              it are one block that is allowed to wrap as a block; the refresh
              control is the other half of the row and is pinned to the end of
              it, so a long product name pushes the description down and never
              shoves a button off the edge. */}
          <header className="ui-shell-page-header">
            <div className="ui-shell-page-title">
              <p className="ui-shell-page-eyebrow">
                <i aria-hidden="true" />
                {product}
              </p>
              <h1>{title}</h1>
              <span className="ui-shell-page-description">{description}</span>
            </div>
            {lastUpdated || onRefresh ? (
              <div className="ui-shell-page-actions">
                {lastUpdated ? <small>Diperbarui {lastUpdated}</small> : null}
                {onRefresh ? (
                  <Button
                    weight="secondary"
                    onClick={onRefresh}
                    disabled={refreshing}
                  >
                    <RefreshCw size={16} className={refreshing ? "ui-spin" : ""} aria-hidden="true" />
                    {refreshing ? "Memuat" : "Perbarui"}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </header>
          {children}
        </main>
      </div>

      {bottomNavigation?.length ? (
        <nav className="ui-shell-bottom-nav" aria-label={`Navigasi ${product} ringkas`}>
          {bottomNavigation.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.path} to={item.path} className={({ isActive }) => (isActive ? "is-active" : "")}>
                <Icon size={19} aria-hidden="true" />
                <span>{item.shortLabel || item.label}</span>
                {item.badge ? <b>{item.badge}</b> : null}
              </NavLink>
            );
          })}
        </nav>
      ) : null}

      {searchOpen && search ? search({ close: () => setSearchOpen(false) }) : null}
    </div>
  );
}
