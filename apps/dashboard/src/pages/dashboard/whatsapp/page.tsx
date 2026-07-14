import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "../../../components/base/Badge";
import { DashboardLayout } from "../../../components/feature/DashboardLayout";
import { DataPanel } from "../../../components/feature/OwnerUi";
import { api, subscribeRealtime, type WhatsappRental } from "../../../lib/api";
import { formatRupiah } from "../../../mocks/data";

const statusFilters = ["Semua", "Aktif", "Dihentikan"];

type RentalForm = {
  linkGrub: string;
  daysLeft: number;
  name: string;
  owner: string;
  contact: string;
  startedAt: string;
  endsAt: string;
  monthlyPrice: number;
  status: WhatsappRental["status"];
};

function emptyRentalForm(): RentalForm {
  return {
    linkGrub: "",
    daysLeft: 30,
    name: "",
    owner: "",
    contact: "",
    startedAt: "",
    endsAt: "",
    monthlyPrice: 0,
    status: "active",
  };
}

function formFromRental(group: WhatsappRental): RentalForm {
  return {
    linkGrub: group.linkGrub || "",
    daysLeft: Number(group.daysLeft || 0),
    name: group.name || "",
    owner: group.owner || "",
    contact: group.contact || "",
    startedAt: group.startedAt || "",
    endsAt: group.endsAt || "",
    monthlyPrice: Number(group.monthlyPrice || 0),
    status: group.status,
  };
}

function statusBadge(status: WhatsappRental["status"]) {
  if (status === "active") return <Badge variant="emerald">Aktif</Badge>;
  if (status === "expired") return <Badge variant="red">Kadaluarsa</Badge>;
  return <Badge variant="slate">Dihentikan</Badge>;
}

function statusMatches(group: WhatsappRental, filter: string) {
  if (filter === "Semua") return true;
  if (filter === "Aktif") return group.status === "active";
  return group.status === "paused";
}

function remainingLabel(daysLeft: number) {
  if (daysLeft > 0) return `${daysLeft} hari`;
  if (daysLeft === 0) return "Hari ini";
  return "Kadaluarsa";
}

function displayName(group: WhatsappRental) {
  return group.name || group.groupJid || group.id;
}

function joinStatusLabel(group: WhatsappRental) {
  if (group.joinStatus === "joined") return "Bot sudah bergabung";
  if (group.joinStatus === "pending") return "Menunggu bot bergabung";
  if (group.joinError) return `Bot belum bergabung: ${group.joinError}`;
  return "";
}

function hasValidGroupJid(group: WhatsappRental) {
  return Boolean(String(group.groupJid || "").trim().endsWith("@g.us"));
}

function syncStatusBadge(group: WhatsappRental) {
  return hasValidGroupJid(group)
    ? <Badge variant="emerald">Tersinkron</Badge>
    : <Badge variant="amber">Belum sinkron</Badge>;
}

function groupJidText(group: WhatsappRental) {
  return group.groupJid || "-";
}

function scrollToElement(id = "") {
  if (!id || typeof document === "undefined") return;
  window.requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  });
}

export default function WhatsAppPage() {
  const [params] = useSearchParams();
  const groupParam = params.get("group")?.trim() || "";
  const [groups, setGroups] = useState<WhatsappRental[]>([]);
  const [waStatus, setWaStatus] = useState<{ connected: boolean; state?: string; error?: string } | null>(null);
  const [openId, setOpenId] = useState("");
  const [focusedGroupId, setFocusedGroupId] = useState("");
  const [statusFilter, setStatusFilter] = useState("Semua");
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState<RentalForm>(() => emptyRentalForm());
  const [adjustDays, setAdjustDays] = useState(30);
  const [priceSyncLoadingId, setPriceSyncLoadingId] = useState("");
  const [priceSyncMessage, setPriceSyncMessage] = useState("");

  async function loadData() {
    const [rows, status] = await Promise.all([api.whatsappRentals(), api.whatsappStatus()]);
    setGroups(rows);
    setWaStatus(status);
    setOpenId((current) => (current && rows.some((row) => row.id === current) ? current : ""));
  }

  useEffect(() => {
    loadData().catch(console.error);
    return subscribeRealtime(() => {
      loadData().catch(console.error);
    });
  }, []);

  useEffect(() => {
    if (!groupParam) return;
    setStatusFilter("Semua");
    const matched = groups.find((group) =>
      [group.id, group.groupJid, group.linkGrub, group.name]
        .map((value) => String(value || "").trim())
        .some((value) => value === groupParam),
    );
    if (matched) {
      setOpenId(matched.id);
      setFocusedGroupId(matched.id);
    }
  }, [groupParam, groups]);

  const filteredGroups = useMemo(() => groups.filter((group) => statusMatches(group, statusFilter)), [groups, statusFilter]);

  useEffect(() => {
    if (!focusedGroupId || !filteredGroups.some((group) => group.id === focusedGroupId)) return;
    scrollToElement(`group-card-${focusedGroupId}`);
  }, [filteredGroups, focusedGroupId]);

  function changeFilter(filter: string) {
    setStatusFilter(filter);
    const nextGroup = groups.find((group) => statusMatches(group, filter));
    setOpenId(nextGroup?.id || "");
  }

  function openGroup(groupId: string) {
    setOpenId((current) => (current === groupId ? "" : groupId));
  }

  function onHeaderKeyDown(event: KeyboardEvent<HTMLDivElement>, groupId: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openGroup(groupId);
  }

  function openCreateModal() {
    setForm(emptyRentalForm());
    setEditingId("");
    setModalMode("create");
  }

  function openEditModal(group: WhatsappRental) {
    setForm(formFromRental(group));
    setEditingId(group.id);
    setModalMode("edit");
  }

  function closeModal() {
    setForm(emptyRentalForm());
    setEditingId("");
    setModalMode(null);
  }

  async function saveRental() {
    if (modalMode === "create") {
      if (!form.linkGrub || Number(form.daysLeft || 0) <= 0) return;
      const created = await api.createWhatsappRental({
        linkGrub: form.linkGrub,
        daysLeft: Number(form.daysLeft || 0),
        contact: form.contact,
      });
      setOpenId(created.id);
    } else if (editingId) {
      await api.updateWhatsappRental(editingId, {
        name: form.name,
        contact: form.contact,
        startedAt: form.startedAt,
        endsAt: form.endsAt,
        daysLeft: Number(form.daysLeft || 0),
        linkGrub: form.linkGrub,
        status: form.status,
      });
      setOpenId(editingId);
    }
    closeModal();
    await loadData();
  }

  async function adjustRental(group: WhatsappRental, direction: 1 | -1) {
    const days = Math.max(1, Number(adjustDays || 1)) * direction;
    await api.adjustWhatsappRental(group.id, days);
    setOpenId(group.id);
    await loadData();
  }

  async function syncPricesFromGroup(group: WhatsappRental) {
    setPriceSyncLoadingId(group.id);
    setPriceSyncMessage("");
    try {
      const preview = await api.previewWhatsappGroupPriceSync(group);
      const changes = Array.isArray(preview.changes) ? preview.changes : [];
      const cleanup = Array.isArray(preview.cleanup) ? preview.cleanup : [];
      const groupName = displayName(group);
      if (!changes.length && !cleanup.length) {
        setPriceSyncMessage(`Tidak ada harga yang perlu diubah dari ${groupName}. ${Number(preview.parsedRows || 0)} baris harga terbaca.`);
        return;
      }
      const sample = changes.slice(0, 12).map((change) => {
        const product = String(change.productName || "-");
        const variant = String(change.variantName || "-");
        const duration = String(change.duration || "-");
        const before = formatRupiah(Number(change.oldPrice || 0));
        const after = formatRupiah(Number(change.newPrice || 0));
        return `- ${product} / ${variant} / ${duration}: ${before} -> ${after}`;
      });
      const confirmed = window.confirm(
        [
          `Sync harga produk dari grup ${groupName}?`,
          "",
          `${changes.length} harga bulanan akan diperbarui. ${cleanup.length} harga harian lama akan dihapus. ${Number(preview.parsedRows || 0)} baris harga bulanan terbaca.`,
          "",
          ...sample,
          changes.length > sample.length ? `...dan ${changes.length - sample.length} harga lain.` : "",
          cleanup.length ? `Harga harian yang dihapus: ${cleanup.slice(0, 8).map((item) => `${String(item.productName || "-")} / ${String(item.variantName || "-")} / ${String(item.duration || "-")}`).join(", ")}${cleanup.length > 8 ? `, dan ${cleanup.length - 8} lagi` : ""}.` : "",
        ].filter(Boolean).join("\n"),
      );
      if (!confirmed) return;
      const applied = await api.applyWhatsappGroupPriceSync(group);
      const removed = Array.isArray(applied.cleanup) ? applied.cleanup.length : cleanup.length;
      setPriceSyncMessage(`${Number(applied.updated || 0)} item harga berhasil disinkronkan dari ${groupName}. ${removed ? `${removed} harga harian dihapus.` : ""}`.trim());
    } catch (error) {
      setPriceSyncMessage(error instanceof Error ? error.message : "Sync harga produk dari grup gagal.");
    } finally {
      setPriceSyncLoadingId("");
    }
  }

  return (
    <DashboardLayout role="owner" title="Sewa Bot WhatsApp">
      <div className="sticky top-16 z-40 isolate -mx-3 mb-5 space-y-3 border-b border-white/60 bg-[#f2ece2] px-3 py-3 shadow-[0_12px_30px_-22px_rgba(15,23,42,0.45)] sm:-mx-4 sm:px-4 md:-mx-6 md:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm text-slate-500">Menampilkan grup sewa aktif dari backup. Grup expired tidak ditampilkan.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <Badge variant={waStatus?.connected ? "emerald" : "red"}>{waStatus?.connected ? "Bot Terhubung" : "Bot Tidak Terhubung"}</Badge>
              <span>Status: {waStatus?.state || "disconnected"}</span>
              {waStatus?.error ? <span className="text-red-600">{waStatus.error}</span> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#2b2b2b] px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-900 sm:h-9 sm:rounded-md"
          >
            <span className="flex h-4 w-4 items-center justify-center">
              <i className="ri-add-line" />
            </span>
            Sewa Grup Baru
          </button>
        </div>

        {priceSyncMessage ? (
          <DataPanel className="border border-emerald-100 bg-emerald-50/50 p-3 text-xs font-medium text-emerald-700">
            {priceSyncMessage}
          </DataPanel>
        ) : null}

        <DataPanel className="p-4">
          <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
            {statusFilters.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => changeFilter(item)}
                className={`h-10 shrink-0 rounded-lg border px-3 text-xs font-medium transition-colors sm:h-8 sm:rounded-md ${
                  statusFilter === item ? "border-[#2b2b2b] bg-[#2b2b2b] text-white" : "border-[#ded6ca] bg-white text-slate-700 hover:bg-[#f7f1e8]"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
          {groupParam ? (
            <div className="mt-3 rounded-md border border-sky-100 bg-sky-50 px-4 py-3 text-xs font-medium text-sky-700">
              Fokus ke grup <span className="font-semibold">{groupParam}</span>. Accordion dibuka otomatis saat grup ditemukan.
            </div>
          ) : null}
        </DataPanel>
      </div>

      <div className="mt-5 space-y-4">
        {filteredGroups.map((group) => {
          const expanded = openId === group.id;
          return (
            <DataPanel
              key={group.id}
              id={`group-card-${group.id}`}
              className={`overflow-hidden p-4 transition-colors ${expanded ? "border-[#2b2b2b]" : "border-[#ded6ca]"} ${group.id === focusedGroupId ? "bg-sky-50/40" : ""}`}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start">
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={expanded}
                  onClick={() => openGroup(group.id)}
                  onKeyDown={(event) => onHeaderKeyDown(event, group.id)}
                  className="flex min-w-0 flex-1 cursor-pointer gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-red-200 sm:gap-4"
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${group.status === "paused" ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-600"}`}>
                    <i className="ri-group-line text-lg" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h2 className="flex max-w-[68vw] items-center gap-2 truncate text-base font-semibold text-slate-950 sm:max-w-none">
                          {displayName(group)}
                          <span className="flex h-4 w-4 items-center justify-center text-slate-500">
                            <i className={expanded ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} />
                          </span>
                        </h2>
                        <p className="mt-1 truncate text-xs text-slate-500">{group.linkGrub || group.groupJid || group.id}</p>
                        {joinStatusLabel(group) ? <p className="mt-1 text-xs font-medium text-emerald-600">{joinStatusLabel(group)}</p> : null}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                          {syncStatusBadge(group)}
                          <span className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-600">
                            Group JID: {groupJidText(group)}
                          </span>
                        </div>
                        {!hasValidGroupJid(group) ? (
                          <p className="mt-2 text-xs font-medium text-amber-700">
                            Rental ini belum terhubung ke JID grup WhatsApp asli. Bot bisa diam walaupun status di web terlihat aktif.
                          </p>
                        ) : null}
                      </div>
                      {statusBadge(group.status)}
                    </div>
                    <div className="mt-3 grid gap-2 rounded-lg bg-[#f7f1e8] p-3 text-xs text-slate-600 sm:bg-transparent sm:p-0 md:grid-cols-4">
                      <span>Sisa: {remainingLabel(group.daysLeft)}</span>
                      <span>Mulai: {group.startedAt || "-"}</span>
                      <span>Berakhir: {group.endsAt || "-"}</span>
                      <span>Total list: {group.listCount || 0}</span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openEditModal(group)}
                  className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md border border-[#ded6ca] bg-white px-3 text-xs font-medium text-slate-700 hover:border-red-100 hover:text-red-600"
                >
                  <i className="ri-edit-line" />
                  Edit
                </button>
              </div>

              {expanded ? (
                <div className="mt-5 space-y-5 pl-0 md:pl-14">
                  <div className="grid gap-3 md:grid-cols-3">
                    {[
                      [group.sent.toLocaleString("id-ID"), "Pesan Terkirim"],
                      [group.helpedOrders.toLocaleString("id-ID"), "Order Dibantu"],
                      [group.replies.toLocaleString("id-ID"), "Balasan Terkirim"],
                    ].map(([value, label]) => (
                      <div key={label} className="rounded-md bg-[#f2ece2] px-4 py-4 text-center">
                        <p className="text-xl font-semibold text-slate-950">{value}</p>
                        <p className="text-xs text-slate-500">{label}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-md bg-[#f2ece2] p-5">
                      <p className="mb-4 text-sm font-medium text-slate-900">Informasi Sewa</p>
                      <div className="grid gap-4 text-sm sm:grid-cols-3">
                        <div>
                          <p className="text-xs text-slate-500">Mulai Sewa</p>
                          <p className="font-semibold">{group.startedAt || "-"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Berakhir</p>
                          <p className="font-semibold">{group.endsAt || "-"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Sisa Hari</p>
                          <p className="font-semibold">{remainingLabel(group.daysLeft)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md bg-[#f2ece2] p-5">
                      <p className="mb-4 text-sm font-medium text-slate-900">Kontak Owner</p>
                      <div className="grid gap-4 text-sm">
                        <div>
                          <p className="text-xs text-slate-500">Nomor Notifikasi</p>
                          <p className="font-semibold">{group.contact || "-"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">Group JID</p>
                          <p className="break-all font-semibold">{groupJidText(group)}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 rounded-md bg-[#f2ece2] p-4 md:flex-row md:items-end md:justify-between">
                    <div className="grid gap-1 text-sm">
                      <p className="font-medium text-slate-900">Total list grup: {group.listCount || 0}</p>
                      <p className="text-xs text-slate-500">{group.linkGrub || group.groupJid || group.id}</p>
                    </div>
                    <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
                      <button
                        type="button"
                        onClick={() => syncPricesFromGroup(group)}
                        disabled={priceSyncLoadingId === group.id || !group.listCount}
                        className="h-8 rounded-md border border-blue-100 bg-blue-50 px-3 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <i className={priceSyncLoadingId === group.id ? "ri-loader-4-line mr-1 animate-spin" : "ri-refresh-line mr-1"} />
                        Sync Harga Produk
                      </button>
                      <label className="block">
                        <span className="text-xs text-slate-500">Hari</span>
                        <input
                          type="number"
                          min="1"
                          value={adjustDays}
                          onChange={(event) => setAdjustDays(Number(event.target.value))}
                          className="mt-1 h-8 w-20 rounded-md border border-[#ded6ca] bg-white px-2 text-sm outline-none focus:border-[#2b2b2b]"
                        />
                      </label>
                      <button type="button" onClick={() => adjustRental(group, 1)} className="h-8 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-700">
                        Tambah Sewa
                      </button>
                      <button type="button" onClick={() => adjustRental(group, -1)} className="h-8 rounded-md border border-red-200 bg-red-50 px-3 text-xs font-medium text-red-700">
                        Kurangi Sewa
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </DataPanel>
          );
        })}

        {!filteredGroups.length ? <DataPanel className="p-5 text-sm text-slate-500">Tidak ada grup aktif untuk filter ini.</DataPanel> : null}
      </div>

      {modalMode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-7">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-950">{modalMode === "edit" ? "Edit Grup Sewa" : "Sewa Grup Baru"}</h2>
              <button className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" onClick={closeModal}>
                <i className="ri-close-line" />
              </button>
            </div>
            {modalMode === "create" ? (
              <div className="mt-6 grid gap-4">
                <label className="block">
                  <span className="text-sm text-slate-700">Link Grup</span>
                  <input value={form.linkGrub} onChange={(event) => setForm({ ...form, linkGrub: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" placeholder="https://chat.whatsapp.com/..." />
                </label>
                <label className="block">
                  <span className="text-sm text-slate-700">Kontak Owner</span>
                  <input value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" placeholder="0812..." />
                </label>
                <label className="block">
                  <span className="text-sm text-slate-700">Sisa Hari</span>
                  <input type="number" min="1" value={form.daysLeft} onChange={(event) => setForm({ ...form, daysLeft: Number(event.target.value) })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" />
                </label>
              </div>
            ) : (
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <label className="block md:col-span-2">
                  <span className="text-sm text-slate-700">Link Grup</span>
                  <input value={form.linkGrub} onChange={(event) => setForm({ ...form, linkGrub: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" placeholder="https://chat.whatsapp.com/..." />
                </label>
                <label className="block">
                  <span className="text-sm text-slate-700">Nama Grup</span>
                  <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" placeholder="Akan diisi dari hasil join/nama grup" />
                </label>
                <label className="block">
                  <span className="text-sm text-slate-700">Kontak Owner</span>
                  <input value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" placeholder="628..." />
                </label>
                <label className="block">
                  <span className="text-sm text-slate-700">Mulai Sewa</span>
                  <input value={form.startedAt} onChange={(event) => setForm({ ...form, startedAt: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" />
                </label>
                <label className="block">
                  <span className="text-sm text-slate-700">Berakhir</span>
                  <input value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" />
                </label>
                <label className="block">
                  <span className="text-sm text-slate-700">Sisa Hari</span>
                  <input type="number" value={form.daysLeft} onChange={(event) => setForm({ ...form, daysLeft: Number(event.target.value) })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]" />
                </label>
                <label className="block">
                  <span className="text-sm text-slate-700">Status</span>
                  <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as WhatsappRental["status"] })} className="mt-2 h-10 w-full rounded-md border border-[#ded6ca] bg-[#f7f1e8] px-3 text-sm outline-none focus:border-[#2b2b2b]">
                    <option value="active">Aktif</option>
                    <option value="paused">Dihentikan</option>
                  </select>
                </label>
              </div>
            )}
            <div className="mt-6 grid gap-3 md:grid-cols-2">
              <button className="h-11 rounded-md border border-gray-300 text-sm text-slate-700" onClick={closeModal}>Batal</button>
              <button className="h-11 rounded-md bg-[#2b2b2b] text-sm font-medium text-white hover:bg-slate-900" onClick={saveRental}>
                {modalMode === "edit" ? "Simpan Perubahan" : "Sewa & Join"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardLayout>
  );
}

