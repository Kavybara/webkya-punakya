import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { clearSession, readSession } from "../../lib/session";
import type { Role } from "../../mocks/data";

type NotificationItem = {
  id: string;
  title: string;
  description: string;
  icon: string;
  tone: string;
  to?: string;
};

const notificationRefreshMs = 10 * 60 * 1000;

function readSessionDisplay(role: Role) {
  let displayName = role === "owner" ? "Owner" : "Reseller";
  let avatarText = role === "owner" ? "O" : "B";
  try {
    const session = readSession();
    if (session?.role === role && session?.user?.name) {
      displayName = String(session.user.name);
      avatarText = displayName.slice(0, 1).toUpperCase();
    }
  } catch {
    displayName = role === "owner" ? "Owner" : "Reseller";
    avatarText = role === "owner" ? "O" : "B";
  }
  return { displayName, avatarText };
}

export function Navbar({
  title,
  role,
  onMenuClick,
}: {
  title: string;
  role: Role;
  onMenuClick: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [dismissedNotifications, setDismissedNotifications] = useState<Record<string, number>>({});
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const settingsPath = role === "owner" ? "/dashboard/settings?tab=profile" : "/reseller/settings";
  const [{ displayName, avatarText }, setSessionDisplay] = useState(() => readSessionDisplay(role));
  const nowMs = Date.now();
  const visibleNotifications = notifications.filter((item) => (dismissedNotifications[item.id] || 0) <= nowMs);
  const hiddenNotificationCount = notifications.length - visibleNotifications.length;

  async function loadNotifications() {
    setLoadingNotifications(true);
    try {
      if (role === "reseller") {
        const activities = await api.activities();
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const rows = activities
          .filter((activity) => {
            const createdAt = new Date(String(activity.createdAt || "").replace(" ", "T")).getTime();
            return activity.type === "account" && /replace|direplace|diganti|diperbarui/i.test(`${activity.title} ${activity.description}`) && (!createdAt || createdAt >= oneDayAgo);
          })
          .slice(0, 3)
          .map((activity) => ({
            id: `activity-${activity.id}`,
            title: activity.title,
            description: activity.description || "Data akun kamu diperbarui.",
            icon: "ri-shield-check-line",
            tone: "bg-red-50 text-red-600",
            to: "/reseller/manage-account",
          }));
        setNotifications(rows);
        setDismissedNotifications((current) => {
          const activeIds = new Set(rows.map((item) => item.id));
          return Object.fromEntries(Object.entries(current).filter(([id, hiddenUntil]) => activeIds.has(id) && hiddenUntil > Date.now()));
        });
        return;
      }

      const [whatsappResult, settingsResult] = await Promise.allSettled([api.whatsappStatus(), api.ownerSettings()]);
      const rows: NotificationItem[] = [];
      if (
        settingsResult.status === "fulfilled" &&
        (settingsResult.value.status.pakasir !== "connected" || !settingsResult.value.pakasir.apiKey || !settingsResult.value.pakasir.merchantId)
      ) {
        rows.push({
          id: "pakasir-qris",
          title: "QRIS Pakasir belum siap",
          description: "API Key atau Merchant ID Pakasir belum lengkap.",
          icon: "ri-qr-code-line",
          tone: "bg-amber-50 text-amber-600",
          to: "/dashboard/settings?tab=api#pakasir-qris",
        });
      }
      if (whatsappResult.status === "fulfilled" && !whatsappResult.value.connected) {
        rows.push({
          id: "whatsapp-disconnected",
          title: "WhatsApp bot disconnected",
          description: whatsappResult.value.qrAvailable ? "QR pairing tersedia. Buka setting untuk scan ulang." : "Service Baileys belum connected.",
          icon: "ri-whatsapp-line",
          tone: "bg-emerald-50 text-emerald-600",
          to: "/dashboard/settings?tab=api#whatsapp-bailey",
        });
      }
      if (settingsResult.status === "fulfilled" && settingsResult.value.status.gmail !== "connected") {
        const gmailMode = settingsResult.value.gmail?.mode === "imap" ? "IMAP" : "OAuth";
        rows.push({
          id: "gmail-oauth",
          title: `Gmail ${gmailMode} belum siap`,
          description: `Lookup code email belum siap sampai Gmail ${gmailMode} tersambung.`,
          icon: "ri-mail-settings-line",
          tone: "bg-sky-50 text-sky-600",
          to: "/dashboard/settings?tab=api#gmail-auth",
        });
      }
      setNotifications(rows);
      setDismissedNotifications((current) => {
        const activeIds = new Set(rows.map((item) => item.id));
        return Object.fromEntries(Object.entries(current).filter(([id, hiddenUntil]) => activeIds.has(id) && hiddenUntil > Date.now()));
      });
    } finally {
      setLoadingNotifications(false);
    }
  }

  useEffect(() => {
    const refreshDisplay = () => setSessionDisplay(readSessionDisplay(role));
    refreshDisplay();
    window.addEventListener("storage", refreshDisplay);
    window.addEventListener("focus", refreshDisplay);
    window.addEventListener("kavya-session:update", refreshDisplay);
    return () => {
      window.removeEventListener("storage", refreshDisplay);
      window.removeEventListener("focus", refreshDisplay);
      window.removeEventListener("kavya-session:update", refreshDisplay);
    };
  }, [role]);

  useEffect(() => {
    loadNotifications().catch(console.error);
    const timer = window.setInterval(() => {
      loadNotifications().catch(console.error);
    }, notificationRefreshMs);
    return () => window.clearInterval(timer);
  }, [role]);

  return (
    <header className="sticky top-0 z-40 bg-[#f2ece2]/95 shadow-sm shadow-slate-950/5 backdrop-blur supports-[backdrop-filter]:bg-[#f2ece2]/85 md:shadow-none">
      <div className="flex h-16 items-center justify-between gap-2 px-3 sm:px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onMenuClick}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-100 bg-white text-slate-600 shadow-sm shadow-slate-950/5 md:hidden"
            aria-label="Buka menu"
          >
            <i className="ri-menu-line text-lg" />
          </button>
          <div>
            <h1 className="max-w-[52vw] truncate text-base font-semibold text-slate-950 sm:max-w-none">{title}</h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setNotificationOpen((current) => !current);
                loadNotifications().catch(console.error);
              }}
              className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-100 bg-white text-slate-600 shadow-sm shadow-slate-950/5 transition-colors hover:bg-red-50 hover:text-red-600"
              aria-expanded={notificationOpen}
              aria-label="Notifikasi"
              title="Notifikasi"
            >
              <i className="ri-notification-3-line text-base" />
              {visibleNotifications.length ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white">
                  {visibleNotifications.length}
                </span>
              ) : null}
            </button>
            {notificationOpen ? (
              <div className="absolute right-[-0.25rem] top-12 z-50 w-[calc(100vw-1.5rem)] max-w-[360px] overflow-hidden rounded-xl border border-gray-100 bg-white shadow-xl shadow-slate-950/10 sm:right-0 sm:w-[320px]">
                <div className="h-1 bg-slate-100">
                  <div
                    className="h-full rounded-r-full bg-red-500 transition-all"
                    style={{ width: visibleNotifications.length ? `${Math.min(100, visibleNotifications.length * 50)}%` : "0%" }}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2.5">
                  <div>
                    <p className="text-xs font-semibold text-slate-950">Notifikasi</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">Status dashboard</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const hiddenUntil = Date.now() + notificationRefreshMs;
                      setDismissedNotifications((current) => ({
                        ...current,
                        ...Object.fromEntries(notifications.map((item) => [item.id, hiddenUntil])),
                      }));
                    }}
                    disabled={!visibleNotifications.length}
                    className="rounded-full px-2 py-1 text-[10px] font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:text-slate-300 disabled:hover:bg-transparent"
                  >
                    Clear all
                  </button>
                </div>
                <div className="max-h-60 overflow-y-auto p-1.5" style={{ scrollbarWidth: "thin" }}>
                  {loadingNotifications ? (
                    <div className="px-3 py-5 text-center text-xs text-slate-400">Memuat notifikasi...</div>
                  ) : visibleNotifications.length ? (
                    visibleNotifications.map((item) => {
                      const content = (
                        <>
                          <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.tone}`}>
                            <i className={`${item.icon} text-sm`} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-xs font-semibold text-slate-900">{item.title}</span>
                            <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{item.description}</span>
                          </span>
                        </>
                      );
                      return item.to ? (
                        <Link
                          key={item.id}
                          to={item.to}
                          onClick={() => setNotificationOpen(false)}
                          className="flex gap-2.5 rounded-lg px-2.5 py-2.5 hover:bg-red-50"
                        >
                          {content}
                        </Link>
                      ) : (
                        <div key={item.id} className="flex gap-2.5 rounded-lg px-2.5 py-2.5">
                          {content}
                        </div>
                      );
                    })
                  ) : (
                    <div className="px-3 py-5 text-center">
                      <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                        <i className={hiddenNotificationCount ? "ri-inbox-archive-line text-base" : "ri-check-line text-base"} />
                      </div>
                      <p className="mt-2 text-xs font-semibold text-slate-900">
                        {hiddenNotificationCount ? "Notifikasi dibersihkan" : "Tidak ada notifikasi"}
                      </p>
                      <p className="mt-1 text-[11px] leading-4 text-slate-400">
                        {hiddenNotificationCount
                          ? "Peringatan aktif akan muncul lagi setelah 10 menit kalau belum selesai."
                          : "Pakasir, WhatsApp, dan Gmail tidak punya peringatan aktif."}
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2 text-[10px] text-slate-400">
                  <span>Refresh 10 menit</span>
                  <span>{visibleNotifications.length} terlihat</span>
                </div>
              </div>
            ) : null}
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setNotificationOpen(false);
                setMenuOpen((current) => !current);
              }}
              className="flex h-10 max-w-[150px] cursor-pointer items-center gap-2 rounded-full border border-gray-100 bg-white py-1 pl-1 pr-2 text-sm font-semibold text-slate-800 shadow-sm shadow-slate-950/5 transition-colors hover:bg-red-50 sm:pr-3"
              aria-expanded={menuOpen}
              aria-label={role === "owner" ? "Menu owner" : "Menu reseller"}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-xs font-semibold text-red-600">
                {avatarText}
              </span>
              <span className="hidden max-w-[120px] truncate sm:inline">{displayName}</span>
              <i className="ri-arrow-down-s-line text-sm text-slate-400" />
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-12 z-50 w-[calc(100vw-1.5rem)] max-w-56 overflow-hidden rounded-lg border border-gray-100 bg-white py-1 shadow-xl shadow-slate-950/10 sm:w-56">
                <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-slate-900">
                  {displayName}
                </div>
                <Link
                  to={settingsPath}
                  onClick={() => setMenuOpen(false)}
                  className="flex h-9 items-center gap-2 px-3 text-xs font-medium text-slate-700 hover:bg-red-50 hover:text-red-600"
                >
                  <i className="ri-settings-3-line text-sm" />
                  Settings
                </Link>
                <Link
                  to="/login"
                  onClick={() => {
                    clearSession();
                    setMenuOpen(false);
                  }}
                  className="flex h-9 items-center gap-2 border-t border-gray-100 px-3 text-xs font-medium text-slate-700 hover:bg-red-50 hover:text-red-600"
                >
                  <i className="ri-logout-box-line text-sm" />
                  Log out
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

