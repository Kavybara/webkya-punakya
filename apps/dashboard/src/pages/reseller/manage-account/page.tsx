import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DashboardLayout } from "../../../components/feature/DashboardLayout";
import { api, subscribeRealtime } from "../../../lib/api";
import { readSession } from "../../../lib/session";
import type { ManagedAccount } from "../../../mocks/data";
import {
  FilterPill,
  MiniBadge,
  ResellerPageTitle,
  ResellerSearch,
  ResellerStatCard,
  accountStatus,
  accountStatusClass,
  daysLeft,
  durationLabel,
  productLabel,
  remainingShort,
} from "../resellerUi";

type FilterStatus = "active" | "expiring" | "expired";

function isDisneyAccount(account: ManagedAccount) {
  return [account.product, account.productId, account.variant, account.variantCode]
    .join(" ")
    .toLowerCase()
    .includes("disney");
}

function accountIdentityLabel(account: ManagedAccount) {
  return isDisneyAccount(account) ? "Nomor Login" : "Email";
}

function accountIdentityValue(account: ManagedAccount) {
  return isDisneyAccount(account) ? (account.loginPhone || account.email || "-") : (account.email || "-");
}

function remainingPercent(account: ManagedAccount) {
  const duration = Number(account.durationDays || durationLabel(account).match(/\d+/)?.[0] || 1);
  const remaining = Math.max(0, daysLeft(account.expiresAt));
  return Math.max(0, Math.min(100, (remaining / duration) * 100));
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function sessionFingerprint() {
  const session = readSession() as Record<string, unknown> | null;
  const user = session && typeof session.user === "object" && session.user ? session.user as Record<string, unknown> : null;
  return JSON.stringify({
    role: session?.role || "",
    token: session?.token || "",
    id: user?.id || "",
    email: user?.email || "",
    username: user?.username || "",
  });
}

export default function ResellerManageAccountPage() {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterStatus>("active");
  const [copiedId, setCopiedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadSeq = useRef(0);
  const mounted = useRef(false);
  const activeSession = useRef("");

  const loadAccounts = useCallback(async (options: { silent?: boolean } = {}) => {
    const seq = loadSeq.current + 1;
    loadSeq.current = seq;
    if (!options.silent) {
      setLoading(true);
      setError("");
    }

    let lastError: unknown;
    const maxAttempts = options.silent ? 1 : 2;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const rows = await api.accounts(options.silent ? { view: "light" } : { view: "full" });
        if (!mounted.current || seq !== loadSeq.current) return;
        setAccounts(rows);
        setError("");
        setLoading(false);
        return;
      } catch (loadError) {
        lastError = loadError;
        if (attempt < maxAttempts - 1) await wait(350 * (attempt + 1));
      }
    }

    if (!mounted.current || seq !== loadSeq.current) return;
    setError(lastError instanceof Error ? lastError.message : "Gagal memuat akun reseller.");
    setLoading(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    activeSession.current = sessionFingerprint();
    loadAccounts().catch(console.error);
    const unsubscribe = subscribeRealtime(() => {
      loadAccounts({ silent: true }).catch(console.error);
    });
    const refresh = () => {
      loadAccounts({ silent: true }).catch(console.error);
    };
    const handleSessionUpdate = () => {
      const nextSession = sessionFingerprint();
      if (nextSession !== activeSession.current) {
        activeSession.current = nextSession;
        setAccounts([]);
        setCopiedId("");
        setQuery("");
        setFilter("active");
        setError("");
        setLoading(true);
      }
      loadAccounts().catch(console.error);
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("kavya-session:update", handleSessionUpdate);
    return () => {
      mounted.current = false;
      unsubscribe();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("kavya-session:update", handleSessionUpdate);
    };
  }, [loadAccounts]);

  async function copyValue(id: string, value = "") {
    await navigator.clipboard.writeText(value);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(""), 1500);
  }

  const activeAccounts = accounts.filter((account) => accountStatus(account) === "Aktif");
  const expiringAccounts = accounts.filter((account) => accountStatus(account) === "Expiring");
  const expiredAccounts = accounts.filter((account) => accountStatus(account) === "Expired");
  const rows = useMemo(
    () =>
      accounts
        .filter((account) => {
          if (filter === "active") return accountStatus(account) === "Aktif";
          if (filter === "expiring") return accountStatus(account) === "Expiring";
          return accountStatus(account) === "Expired";
        })
        .filter((account) =>
          [account.email, account.loginPhone, account.product, account.variant, account.profile, account.stockId]
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase()),
        ),
    [accounts, filter, query],
  );

  return (
    <DashboardLayout role="reseller" title="Manage Account">
      <div className="space-y-5">
        <ResellerPageTitle title="Manage Account" subtitle="Kelola semua akun yang telah Anda beli" />

        <div className="sticky top-16 z-30 -mx-4 space-y-4 bg-[#f2ece2] px-4 py-3 shadow-sm shadow-slate-950/5 md:-mx-6 md:px-6">
          <div className="grid gap-4 md:grid-cols-3">
            <ResellerStatCard label="Akun Aktif" value={activeAccounts.length} tone="emerald" icon="ri-checkbox-circle-line" hint="Tampilkan akun yang masih aman dipakai" active={filter === "active"} onClick={() => setFilter("active")} />
            <ResellerStatCard label="Akun Expiring" value={expiringAccounts.length} tone="amber" icon="ri-time-line" hint="Fokus ke akun yang masa aktifnya menipis" active={filter === "expiring"} onClick={() => setFilter("expiring")} />
            <ResellerStatCard label="Akun Expired" value={expiredAccounts.length} tone="red" icon="ri-close-circle-line" hint="Cek akun yang sudah habis masa aktif" active={filter === "expired"} onClick={() => setFilter("expired")} />
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-white p-4 lg:flex-row">
            <ResellerSearch value={query} onChange={setQuery} placeholder="Cari email, nomor, atau profil..." className="flex-1" />
            <div className="flex gap-2">
              <FilterPill active={filter === "active"} onClick={() => setFilter("active")}>Aktif</FilterPill>
              <FilterPill active={filter === "expiring"} onClick={() => setFilter("expiring")}>Expiring</FilterPill>
              <FilterPill active={filter === "expired"} onClick={() => setFilter("expired")}>Expired</FilterPill>
            </div>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
            {error} Data lama tetap ditahan. Coba pindah tab/refresh jika koneksi belum stabil.
          </div>
        ) : null}

        {!loading && rows.length ? (
          <div className="rounded-xl border border-slate-100 bg-white px-4 py-3 text-xs text-slate-500 shadow-sm shadow-slate-950/5">
            Menampilkan <span className="font-semibold text-slate-900">{rows.length}</span> akun pada filter <span className="font-semibold text-slate-900">{filter === "active" ? "Aktif" : filter === "expiring" ? "Expiring" : "Expired"}</span>.
          </div>
        ) : null}

        <section className="grid gap-3 md:hidden">
          {rows.map((account) => {
            const copyFullId = `${account.id}-full-mobile`;
            const status = accountStatus(account);
            const barColor = status === "Expired" || status === "Replaced" || status === "Disabled" ? "bg-red-500" : status === "Expiring" ? "bg-amber-500" : "bg-emerald-500";
            const code = account.id.replace("acc", "ACC");
            const detailText = [
              productLabel(account),
              `Kode: ${code}`,
              `${accountIdentityLabel(account)}: ${accountIdentityValue(account)}`,
              `Password / Link: ${account.password || "-"}`,
              account.profile ? `Profile: ${account.profile}` : "",
              account.pin ? `PIN: ${account.pin}` : "",
              `Durasi: ${durationLabel(account)}`,
              `Sisa: ${remainingShort(account)}`,
            ].filter(Boolean).join("\n");

            return (
              <article key={account.id} className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm shadow-slate-950/5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] font-semibold uppercase text-slate-400">{code}</p>
                    <h2 className="mt-1 break-words text-sm font-bold text-slate-950">{accountIdentityValue(account)}</h2>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{productLabel(account)}</p>
                  </div>
                  <MiniBadge className={accountStatusClass(account)}>{status}</MiniBadge>
                </div>

                <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-3 text-xs">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Password / Link</p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="min-w-0 flex-1 break-all font-mono text-slate-800">{account.password || "-"}</span>
                      {account.password ? (
                        <button type="button" onClick={() => copyValue(`${account.id}-password-mobile`, account.password)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-slate-400">
                          <i className={copiedId === `${account.id}-password-mobile` ? "ri-check-line" : "ri-file-copy-line"} />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Profil</p>
                      <p className="mt-1 break-words font-medium text-slate-800">{account.profile || "-"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">PIN</p>
                      <p className="mt-1 font-mono font-medium text-slate-800">{account.pin || "-"}</p>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-slate-700">{durationLabel(account)}</span>
                      <span className={status === "Expired" ? "font-semibold text-red-600" : status === "Expiring" ? "font-semibold text-amber-600" : "font-semibold text-emerald-600"}>{remainingShort(account)}</span>
                    </div>
                    <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-white">
                      <span className={`block h-full rounded-full ${barColor}`} style={{ width: `${remainingPercent(account)}%` }} />
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => copyValue(copyFullId, detailText)}
                  className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-100 bg-white text-xs font-semibold text-slate-700"
                >
                  <i className={copiedId === copyFullId ? "ri-check-line" : "ri-file-copy-line"} />
                  {copiedId === copyFullId ? "Detail disalin" : "Copy Detail Akun"}
                </button>
              </article>
            );
          })}
          {!rows.length ? (
            <div className="rounded-xl border border-slate-100 bg-white px-4 py-10 text-center text-sm text-slate-500">
              {loading ? "Memuat akun..." : "Akun tidak ditemukan."}
            </div>
          ) : null}
        </section>

        <section className="hidden overflow-hidden rounded-xl border border-slate-100 bg-white md:block">
          <div className="max-h-[calc(100vh-330px)] min-h-[360px] overflow-auto">
            <table className="w-full min-w-[1120px] text-left text-xs">
              <thead className="sticky top-0 z-20 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400 shadow-sm shadow-slate-950/5">
                <tr>
                  <th className="px-4 py-3 font-semibold">Kode</th>
                  <th className="px-4 py-3 font-semibold">Identitas</th>
                  <th className="px-4 py-3 font-semibold">Password / Link</th>
                  <th className="px-4 py-3 font-semibold">Profil</th>
                  <th className="px-4 py-3 font-semibold">PIN</th>
                  <th className="px-4 py-3 font-semibold">Durasi</th>
                  <th className="px-4 py-3 font-semibold">Sisa</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="sticky right-0 z-30 bg-slate-50 px-4 py-3 text-right font-semibold shadow-[-10px_0_14px_-16px_rgba(15,23,42,0.45)]">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((account) => {
                  const copyFullId = `${account.id}-full`;
                  const status = accountStatus(account);
                  const barColor = status === "Expired" || status === "Replaced" || status === "Disabled" ? "bg-red-500" : status === "Expiring" ? "bg-amber-500" : "bg-emerald-500";
                  const code = account.id.replace("acc", "ACC");
                  return (
                    <tr key={account.id} className="border-t border-slate-50 text-slate-700">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-50 text-slate-400">
                            <i className="ri-shield-keyhole-line" />
                          </span>
                          <div>
                            <div className="font-mono font-semibold uppercase text-slate-900">{code}</div>
                            <div className="text-[11px] text-slate-400">{productLabel(account)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 font-medium text-slate-800">{accountIdentityValue(account)}</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-slate-800">{account.password || "-"}</span>
                          {account.password ? (
                            <button type="button" onClick={() => copyValue(`${account.id}-password`, account.password)} className="text-slate-400 hover:text-emerald-600">
                              <i className={copiedId === `${account.id}-password` ? "ri-check-line" : "ri-file-copy-line"} />
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-4 font-medium text-slate-800">{account.profile || "-"}</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-slate-800">{account.pin || "-"}</span>
                          {account.pin ? (
                            <button type="button" onClick={() => copyValue(`${account.id}-pin`, account.pin)} className="text-slate-400 hover:text-emerald-600">
                              <i className={copiedId === `${account.id}-pin` ? "ri-check-line" : "ri-file-copy-line"} />
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-4">{durationLabel(account)}</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                            <span className={`block h-full rounded-full ${barColor}`} style={{ width: `${remainingPercent(account)}%` }} />
                          </span>
                          <span className={status === "Expired" ? "font-semibold text-red-600" : status === "Expiring" ? "font-semibold text-amber-600" : "font-semibold text-emerald-600"}>{remainingShort(account)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <MiniBadge className={accountStatusClass(account)}>{accountStatus(account)}</MiniBadge>
                      </td>
                      <td className="sticky right-0 bg-white px-4 py-4 text-right shadow-[-10px_0_14px_-16px_rgba(15,23,42,0.45)]">
                        <button
                          type="button"
                          onClick={() =>
                            copyValue(
                              copyFullId,
                              [
                                productLabel(account),
                                `Kode: ${code}`,
                                `${accountIdentityLabel(account)}: ${accountIdentityValue(account)}`,
                                `Password / Link: ${account.password || "-"}`,
                                account.profile ? `Profile: ${account.profile}` : "",
                                account.pin ? `PIN: ${account.pin}` : "",
                              ]
                                .filter(Boolean)
                                .join("\n"),
                            )
                          }
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-100 text-slate-400 hover:border-emerald-100 hover:bg-emerald-50 hover:text-emerald-600"
                          title="Copy detail akun"
                        >
                          <i className={copiedId === copyFullId ? "ri-check-line" : "ri-file-copy-line"} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!rows.length ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-500">
                      {loading ? "Memuat akun..." : "Akun tidak ditemukan."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}

