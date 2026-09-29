import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Bell, Plus, WalletCards } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api, subscribeRealtime } from "../../lib/api";
import { formatRupiah } from "../../lib/format";
import { AppShell } from "../ui";
import { ResellerSearch } from "./ResellerSearch";
import { TopUpDialog } from "./TopUpDialog";
import {
  resellerBottomNavigation,
  resellerNavigation,
  type ResellerNavigationGroup,
  type ResellerNavigationItem,
} from "./navigation";
import "./reseller-v2.css";

const ACCOUNTS_PATH = "/reseller-v2/accounts";
const SUMMARY_PATH = "/reseller-v2/ringkasan";

type ResellerShellActions = { openTopUp: () => void };

/**
 * The reseller's half of the shared frame.
 *
 * The frame is the shell's; what is left here is the balance and the top-up,
 * which exist because a reseller buys with money and an owner does not. The
 * render-prop children signature stays because the summary page opens the
 * top-up dialog from a card far below the top of the page.
 */
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
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [loadedBalance, setLoadedBalance] = useState("");
  const [unreadDeliveryCount, setUnreadDeliveryCount] = useState(0);

  const loadBalance = useCallback(() => {
    // A page that already holds the figure must not ask for it again, or the
    // two numbers disagree for the length of a frame.
    if (balance !== undefined) return;
    api
      .resellers()
      .then((rows) => setLoadedBalance(formatRupiah(Number(rows[0]?.deposit || 0))))
      .catch(() => setLoadedBalance("-"));
  }, [balance]);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  useEffect(() => {
    const loadUnread = () =>
      api
        .unreadDeliveryCount()
        .then((result) => setUnreadDeliveryCount(Math.max(0, Number(result.count || 0))))
        .catch(() => undefined);
    loadUnread();
    return subscribeRealtime(loadUnread);
  }, []);

  const openTopUp = useCallback(() => setTopUpOpen(true), []);

  const shownBalance = (balance ?? loadedBalance) || "Memuat...";

  // The unread count rides on the navigation itself rather than being painted
  // into this file's markup, so the badge and the item it belongs to cannot
  // drift apart.
  const badge = (item: ResellerNavigationItem) =>
    item.path === ACCOUNTS_PATH && unreadDeliveryCount > 0
      ? { ...item, badge: unreadDeliveryCount }
      : item;

  const navigation = useMemo(
    () => resellerNavigation.map((group) => ({ ...group, items: group.items.map(badge) })),
    [unreadDeliveryCount],
  );

  const bottomNavigation = useMemo(() => resellerBottomNavigation.map(badge), [unreadDeliveryCount]);

  return (
    <AppShell
      role="reseller"
      product="Kavya Reseller"
      homePath={SUMMARY_PATH}
      homeLabel="Kavya Reseller Ringkasan"
      deniedPath="/owner-v2"
      navigation={navigation as ResellerNavigationGroup[]}
      bottomNavigation={bottomNavigation}
      settings={{ path: "/reseller-v2/settings", label: "Pengaturan" }}
      title={title}
      description={description}
      lastUpdated={lastUpdated}
      refreshing={loading}
      onRefresh={onRefresh}
      searchPlaceholder="Cari produk, pesanan, akun..."
      sidebarTop={
        <div className="reseller-v2-side-balance">
          <span>
            <WalletCards size={15} aria-hidden="true" /> Saldo
          </span>
          <Link className="reseller-v2-balance-link" to={`${SUMMARY_PATH}#saldo`}>
            {shownBalance}
          </Link>
          <button type="button" onClick={openTopUp} aria-label="Top Up saldo">
            <Plus size={14} aria-hidden="true" /> Top Up
          </button>
        </div>
      }
      topbarActions={() => (
        <>
          <button type="button" onClick={openTopUp} className="reseller-v2-topup">
            <Plus size={15} aria-hidden="true" />
            <span>Top Up</span>
          </button>
          <Link to={`${SUMMARY_PATH}#saldo`} className="reseller-v2-top-balance">
            <WalletCards size={15} aria-hidden="true" />
            {shownBalance}
          </Link>
          <button
            type="button"
            className="ui-shell-icon-button"
            aria-label={unreadDeliveryCount > 0 ? `${unreadDeliveryCount} akun baru masuk` : "Tidak ada akun baru"}
            onClick={() => unreadDeliveryCount > 0 && navigate(ACCOUNTS_PATH)}
          >
            <Bell size={18} />
            {unreadDeliveryCount > 0 ? (
              <span className="reseller-v2-notification-dot">{unreadDeliveryCount}</span>
            ) : null}
          </button>
        </>
      )}
      search={({ close }) => <ResellerSearch open onClose={close} />}
    >
      {typeof children === "function" ? children({ openTopUp }) : children}
      <TopUpDialog
        open={topUpOpen}
        onClose={() => setTopUpOpen(false)}
        onBalanceChanged={loadBalance}
      />
    </AppShell>
  );
}
