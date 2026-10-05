import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Bell, Plus, WalletCards } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api, subscribeRealtime } from "../../lib/api";
import { formatRupiah } from "../../lib/format";
import { AppShell } from "../ui";
// The same two pieces the owner console uses, for the same reason: the pill is
// drawn by the shared frame and its wording is shared, so a reseller cannot
// end up with a differently-worded version of the same three states.
import { systemStateLabel, type SystemState } from "../attention/attention";
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
 * The one item that carries a count, and only while the count is not zero --
 * a badge reading "0" is noise on a nav rail that is scanned, not read.
 */
function withBadge(item: ResellerNavigationItem, count: number) {
  return item.path === ACCOUNTS_PATH && count > 0 ? { ...item, badge: count } : item;
}

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
  attentionCount,
  systemState,
  onRefresh,
  children,
}: {
  title: string;
  description: string;
  balance?: string;
  lastUpdated?: string;
  loading?: boolean;
  attentionCount?: number;
  systemState?: SystemState;
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
    // Already `.catch`ed above. The badge is a nicety -- a failed count must
    // not take down the shell that draws it.
    void loadUnread();
    return subscribeRealtime(loadUnread);
  }, []);

  const openTopUp = useCallback(() => setTopUpOpen(true), []);

  const shownBalance = (balance ?? loadedBalance) || "Memuat...";

  // The unread count rides on the navigation itself rather than being painted
  // into this file's markup, so the badge and the item it belongs to cannot
  // drift apart.
  const navigation = useMemo(
    () =>
      resellerNavigation.map((group) => ({
        ...group,
        items: group.items.map((item) => withBadge(item, unreadDeliveryCount)),
      })),
    [unreadDeliveryCount],
  );

  const bottomNavigation = useMemo(
    () => resellerBottomNavigation.map((item) => withBadge(item, unreadDeliveryCount)),
    [unreadDeliveryCount],
  );

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
      topbarLeading={
        /* Rendered only when the page says what its attention is.

           The alternative -- defaulting to "healthy" the way a prop default
           would -- is the exact failure this whole refactor exists to remove.
           A green pill on a page that never computed anything is a claim the
           page cannot support, and it is indistinguishable from a page that
           checked and found nothing wrong. Silence is at least honest, and
           `attention-invariant.test.mjs` fails on any page that renders a
           shell without one of the two props rather than letting the default
           paper over it. */
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
      sidebarTop={({ collapsed }) =>
          /* A collapsed rail is 72px wide. This card's own margin, padding and
             border used to be resolved inside that anyway, leaving six pixels
             of content box: the figure clipped to an ellipsis while the two
             labels beside it overflowed the rail. Nothing in this file could
             know the rail had collapsed, because the slot arrived as a node.

             It arrives as a render function now, so the branch is here and the
             shell keeps no knowledge of this card.

             Collapsed, the figure stays -- a balance a reseller cannot see is
             worse than a cramped one, and the expanded rail shows the same
             number in the top bar, so this is the smaller of the two rather
             than the only one. Only the words go; the icons carry the
             accessible name, as the rail's own icon-only controls do. */
          collapsed ? (
            <div className="reseller-v2-side-balance is-compact">
              <Link
                className="reseller-v2-balance-link"
                to={`${SUMMARY_PATH}#saldo`}
                title={`Saldo ${shownBalance}`}
              >
                <WalletCards size={16} aria-hidden="true" />
                {shownBalance}
              </Link>
              <button type="button" onClick={openTopUp} aria-label="Top Up saldo" title="Top Up">
                <Plus size={14} aria-hidden="true" />
              </button>
            </div>
          ) : (
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
          )
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
