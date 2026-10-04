import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bell,
  CalendarClock,
  CircleAlert,
  RefreshCw,
  ShieldAlert,
  WifiOff,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { AppShell, useDismiss } from "../ui";
import { formatDateTime } from "../../lib/format";
// `attention/attention` directly, not the barrel. The barrel also re-exports
// `AttentionQueue`, which is the module that pulls in `attention.css` -- and a
// shell has no business loading the queue's stylesheet on a page that never
// renders a queue. The label lives here because the shell is what draws the
// pill, and it should not have to duplicate the words.
import { systemStateLabel, type SystemState } from "../attention/attention";
import { ConsoleSearch } from "./ConsoleSearch";
import { consoleBottomNavigation, consoleNavigation } from "./navigation";
import { buildOwnerNotifications, type OwnerNotification } from "./ownerNotifications";
import "./console.css";

const notificationSeenKey = "owner-notification-seen-v1";

function notificationTime(value = "") {
  if (!value) return "Baru saja";
  // formatDateTime echoes the input back when it cannot parse it, so an
  // unchanged result means the timestamp was unreadable.
  const formatted = formatDateTime(value);
  return formatted === value ? "Baru saja" : formatted;
}

function NotificationIcon({ notification }: { notification: OwnerNotification }) {
  if (notification.kind === "warranty") return <ShieldAlert size={17} />;
  if (notification.kind === "rental") return <CalendarClock size={17} />;
  if (notification.kind === "connection") return <WifiOff size={17} />;
  return <CircleAlert size={17} />;
}

function readSeen() {
  try {
    const stored = JSON.parse(localStorage.getItem(notificationSeenKey) || "[]");
    return new Set(Array.isArray(stored) ? stored.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

/**
 * The owner console's half of the shared frame.
 *
 * The frame itself -- the rail, the drawer, the topbar, the profile, the
 * sign-out, the page header -- belongs to the shell, because an owner and a
 * reseller should not have to learn two arrangements. What is left here is
 * the part that only an owner has: the notification centre, which is the one
 * place in the product where a person is told to go and do something.
 */
export function ConsoleShell({
  title,
  description,
  lastUpdated,
  refreshing,
  attentionCount,
  systemState,
  onRefresh,
  children,
}: {
  title: string;
  description: string;
  lastUpdated?: string;
  refreshing?: boolean;
  attentionCount?: number;
  systemState?: SystemState;
  /** See the note on `AppShell`'s `onRefresh` -- every caller's reload is async. */
  onRefresh?: () => void | Promise<void>;
  children: ReactNode;
}) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<OwnerNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationsError, setNotificationsError] = useState("");
  const [seenNotificationIds, setSeenNotificationIds] = useState(readSeen);

  const loadNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    const [operations, warranties, rentals] = await Promise.allSettled([
      api.operationsCenter(),
      api.warrantyClaims(),
      api.whatsappRentals(),
    ]);
    const settled = [operations, warranties, rentals];
    if (settled.every((result) => result.status === "rejected")) {
      setNotificationsError("Notifikasi belum dapat dimuat.");
      setNotificationsLoading(false);
      return;
    }
    setNotifications(buildOwnerNotifications({
      operations: operations.status === "fulfilled" ? operations.value : null,
      warranties: warranties.status === "fulfilled" ? warranties.value : [],
      rentals: rentals.status === "fulfilled" ? rentals.value : [],
    }));
    setNotificationsError(settled.some((result) => result.status === "rejected") ? "Sebagian sumber belum dapat dimuat." : "");
    setNotificationsLoading(false);
  }, []);

  const unreadNotifications = useMemo(
    () => notifications.filter((notification) => !seenNotificationIds.has(notification.id)),
    [notifications, seenNotificationIds],
  );
  // Before the first response the count comes from the page that opened the
  // shell, so the bell is never briefly wrong at zero.
  const badgeCount = notificationsLoading && !notifications.length ? attentionCount : unreadNotifications.length;

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

  useEffect(() => {
    void loadNotifications();
    const timer = window.setInterval(() => void loadNotifications(), 90_000);
    return () => window.clearInterval(timer);
  }, [loadNotifications]);

  const closeNotifications = useCallback(() => setNotificationsOpen(false), []);
  const notificationsRef = useDismiss(notificationsOpen, closeNotifications);

  return (
    <AppShell
      role="owner"
      product="Kavya Console"
      homePath="/owner-v2"
      homeLabel="Kavya Console overview"
      deniedPath="/reseller-v2/ringkasan"
      navigation={consoleNavigation}
      bottomNavigation={consoleBottomNavigation}
      settings={{ path: "/owner-v2/settings", label: "Pengaturan owner" }}
      title={title}
      description={description}
      lastUpdated={lastUpdated}
      refreshing={refreshing}
      onRefresh={onRefresh}
      searchPlaceholder="Cari pesanan, pelanggan, produk..."
      topbarLeading={
        /* No default `systemState`. Fourteen pages used to pass
           `systemState="healthy"` while computing nothing at all, which is
           indistinguishable in the topbar from a page that checked and found
           nothing wrong. Rendering nothing when the page has not said is the
           honest half; `attention-invariant.test.mjs` is the half that stops
           it from being an excuse. */
        systemState ? (
          <div className="ui-shell-status-pill" title="Status berasal dari respons API terbaru halaman ini">
            <span
              className={
                systemState === "healthy"
                  ? "is-online"
                  : systemState === "warning"
                    ? "is-warning"
                    : "is-unknown"
              }
            />
            <span>{systemStateLabel(systemState, attentionCount ?? 0)}</span>
          </div>
        ) : null
      }
      topbarActions={({ closePopovers }) => (
        <div className="console-notification-wrap" ref={notificationsRef}>
          <button
            type="button"
            className="ui-shell-icon-button"
            aria-label={`${badgeCount} notifikasi belum dibaca`}
            title="Pusat notifikasi"
            aria-expanded={notificationsOpen}
            onClick={() => {
              closePopovers();
              setNotificationsOpen((value) => !value);
            }}
          >
            <Bell size={18} />
            {badgeCount ? <span className="console-notification-count">{Math.min(badgeCount, 99)}</span> : null}
          </button>
          {notificationsOpen ? (
            <div className="console-notification-menu" role="dialog" aria-label="Pusat notifikasi">
              <header>
                <div>
                  <strong>Pusat notifikasi</strong>
                  <span>
                    {notifications.length
                      ? `${unreadNotifications.length} belum dibaca / ${notifications.length} aktif`
                      : "Tidak ada antrean aktif"}
                  </span>
                </div>
                <div className="console-notification-header-actions">
                  <button
                    type="button"
                    onClick={() => void loadNotifications()}
                    disabled={notificationsLoading}
                    aria-label="Perbarui notifikasi"
                  >
                    <RefreshCw size={14} className={notificationsLoading ? "ui-spin" : ""} />
                  </button>
                  {unreadNotifications.length ? (
                    <button
                      type="button"
                      onClick={() => storeSeenNotifications(new Set([...seenNotificationIds, ...notifications.map((item) => item.id)]))}
                    >
                      Tandai dibaca
                    </button>
                  ) : null}
                </div>
              </header>
              {notificationsLoading && !notifications.length ? (
                <div className="console-notification-empty">
                  <RefreshCw className="ui-spin" size={18} />
                  <span>Memuat antrean terbaru...</span>
                </div>
              ) : null}
              {notificationsError ? (
                <div className="console-notification-warning">{notificationsError}</div>
              ) : null}
              {notifications.length ? (
                <div className="console-notification-list">
                  {notifications.map((notification) => {
                    const unread = !seenNotificationIds.has(notification.id);
                    return (
                      <Link
                        key={notification.id}
                        to={notification.href}
                        className={`console-notification-item is-${notification.severity} ${unread ? "is-unread" : ""}`}
                        onClick={() => {
                          markNotificationRead(notification.id);
                          setNotificationsOpen(false);
                        }}
                      >
                        <span className="console-notification-icon">
                          <NotificationIcon notification={notification} />
                        </span>
                        <span>
                          <strong>{notification.title}</strong>
                          <small>{notification.detail}</small>
                          <time>{notificationTime(notification.createdAt)}</time>
                        </span>
                        {unread ? <i aria-label="Belum dibaca" /> : null}
                      </Link>
                    );
                  })}
                </div>
              ) : !notificationsLoading ? (
                <div className="console-notification-empty">
                  <Bell size={18} />
                  <span>Semua antrean operasional sudah bersih.</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      search={({ close }) => <ConsoleSearch open onClose={close} />}
    >
      {children}
    </AppShell>
  );
}
