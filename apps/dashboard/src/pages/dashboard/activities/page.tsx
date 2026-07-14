import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../../components/base/Badge";
import { DashboardLayout } from "../../../components/feature/DashboardLayout";
import { DataPanel, FilterPill, PageToolbar, SearchBox } from "../../../components/feature/OwnerUi";
import { api, subscribeRealtime, type ApiActivity } from "../../../lib/api";

const filters = [
  ["all", "Semua", "ri-file-list-3-line"],
  ["order", "Order", "ri-shopping-cart-2-line"],
  ["account", "Akun", "ri-shield-keyhole-line"],
  ["stock", "Stok", "ri-database-2-line"],
  ["reseller", "Reseller", "ri-user-shared-line"],
  ["security", "Akses", "ri-key-2-line"],
  ["whatsapp", "WhatsApp", "ri-whatsapp-line"],
];

function typeIcon(type: string) {
  if (type === "order") return "ri-shopping-cart-2-line";
  if (type === "stock") return "ri-database-2-line";
  if (type === "reseller") return "ri-user-shared-line";
  if (type === "security") return "ri-key-2-line";
  if (type === "whatsapp") return "ri-whatsapp-line";
  if (type === "account") return "ri-shield-keyhole-line";
  return "ri-login-box-line";
}

function actorLabel(activity: ApiActivity) {
  if (activity.type !== "security") return "Sistem";
  const name = String(activity.actorName || "").trim();
  const whatsapp = String(activity.actorWhatsapp || activity.whatsapp || "").trim();
  if (name && whatsapp) return `${name} / +${whatsapp}`;
  return name || (whatsapp ? `+${whatsapp}` : "Reseller");
}

function detailChips(activity: ApiActivity) {
  const chips = [];
  if (activity.type === "security") {
    if (activity.accountEmail) chips.push(`Akun: ${activity.accountEmail}`);
    if (activity.product) chips.push(activity.variant ? `${activity.product} - ${activity.variant}` : activity.product);
    if (activity.lookupLabel || activity.lookupType) chips.push(`Request: ${activity.lookupLabel || activity.lookupType}`);
    if (activity.lookupStatus) chips.push(`Status: ${activity.lookupStatus}`);
  } else {
    if (activity.orderId) chips.push(activity.orderId);
    if (activity.accountEmail) chips.push(activity.accountEmail);
    if (activity.product) chips.push(activity.variant ? `${activity.product} - ${activity.variant}` : activity.product);
  }
  return chips;
}

function isDataChangeActivity(activity: ApiActivity) {
  const text = `${activity.title || ""} ${activity.description || ""}`.toLowerCase();
  return /update|ubah|diganti|replace|lock|repair|sync|arsip|pulih|hapus/.test(text);
}

export default function ActivitiesPage() {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [activities, setActivities] = useState<ApiActivity[]>([]);

  async function loadActivities() {
    setActivities(await api.activities());
  }

  useEffect(() => {
    loadActivities().catch(console.error);
    return subscribeRealtime(() => {
      loadActivities().catch(console.error);
    });
  }, []);

  const rows = useMemo(
    () =>
      activities.filter((item) =>
        (filter === "all" || item.type === filter)
        && [
          item.title,
          item.description,
          item.actorName,
          item.actorWhatsapp,
          item.whatsapp,
          item.accountEmail,
          item.product,
          item.variant,
          item.orderId,
          item.lookupLabel,
          item.lookupType,
          item.lookupStatus,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [activities, filter, query],
  );
  const changeRows = useMemo(() => rows.filter(isDataChangeActivity).slice(0, 8), [rows]);
  const changeStats = useMemo(() => ({
    changes: activities.filter(isDataChangeActivity).length,
    locks: activities.filter((item) => /lock/i.test(`${item.title} ${item.description}`)).length,
    repairs: activities.filter((item) => /repair|sync/i.test(`${item.title} ${item.description}`)).length,
  }), [activities]);

  return (
    <DashboardLayout role="owner" title="Log Aktivitas Sistem">
      <div className="sticky top-16 z-40 isolate -mx-3 mb-5 border-b border-white/60 bg-[#f2ece2] px-3 py-3 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.45)] sm:-mx-4 sm:px-4 md:-mx-6 md:px-6">
        <PageToolbar className="flex flex-col gap-3 rounded-2xl border border-white/60 bg-white px-4 py-4 shadow-sm shadow-slate-950/5 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex gap-2 overflow-x-auto pb-1 pr-1 md:max-h-24 md:flex-wrap md:overflow-y-auto md:pb-0">
            {filters.map(([id, label, icon]) => (
              <FilterPill key={id} active={filter === id} onClick={() => setFilter(id)}>
                <span className="flex h-4 w-4 items-center justify-center">
                  <i className={icon} />
                </span>
                {label}
                <span className="ml-1 text-[10px]">({id === "all" ? activities.length : activities.filter((item) => item.type === id).length})</span>
              </FilterPill>
            ))}
          </div>
          <div className="w-full xl:max-w-xs">
            <SearchBox value={query} onChange={setQuery} placeholder="Cari aktivitas..." />
          </div>
        </PageToolbar>
      </div>

      <DataPanel className="mb-4 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 px-4 py-4">
          <div>
            <p className="text-sm font-semibold text-slate-950">Riwayat Perubahan Data</p>
            <p className="mt-1 text-xs text-slate-500">Spotlight perubahan penting seperti update akun, freeze produk, repair reseller, dan sinkronisasi.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"><strong>{changeStats.changes}</strong> perubahan</span>
            <span className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-red-700"><strong>{changeStats.locks}</strong> lock</span>
            <span className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-amber-800"><strong>{changeStats.repairs}</strong> repair/sync</span>
          </div>
        </div>
        <div className="divide-y divide-gray-100">
          {changeRows.map((activity) => (
            <div key={`change-${activity.id}`} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={activity.type === "stock" ? "emerald" : activity.type === "reseller" ? "info" : "amber"}>{activity.type}</Badge>
                <span className="text-sm font-semibold text-slate-900">{activity.title}</span>
                <span className="text-[11px] text-slate-400">{activity.createdAt}</span>
              </div>
              {activity.description ? <div className="mt-1 text-xs text-slate-500">{activity.description}</div> : null}
            </div>
          ))}
          {!changeRows.length ? <div className="px-4 py-8 text-center text-sm text-slate-500">Belum ada perubahan data penting pada filter ini.</div> : null}
        </div>
      </DataPanel>

      <DataPanel className="overflow-hidden px-4 py-4">
        {rows.map((activity) => (
          <div key={activity.id} className="flex items-start gap-4 border-b border-gray-100 px-3 py-4 last:border-b-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-50 text-red-600">
              <i className={typeIcon(activity.type)} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-800">{activity.title}</p>
              {activity.description ? <p className="mt-1 text-xs leading-5 text-slate-500">{activity.description}</p> : null}
              {detailChips(activity).length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {detailChips(activity).map((chip) => (
                    <span key={chip} className="rounded-full bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-500">
                      {chip}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant={activity.type === "stock" || activity.type === "whatsapp" ? "emerald" : activity.type === "reseller" || activity.type === "security" ? "info" : "red"}>
                  {activity.type}
                </Badge>
                <span className="text-[11px] text-slate-400">{actorLabel(activity)}</span>
                <span className="text-[11px] text-slate-400">{activity.createdAt.slice(11)}</span>
              </div>
            </div>
            <span className="hidden text-[11px] text-slate-300 sm:block">{activity.createdAt.slice(11)}</span>
          </div>
        ))}
      </DataPanel>
    </DashboardLayout>
  );
}

