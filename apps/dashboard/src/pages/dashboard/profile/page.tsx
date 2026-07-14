import { useEffect, useState, type FormEvent } from "react";
import { DashboardLayout } from "../../../components/feature/DashboardLayout";
import { api, type OwnerProfile } from "../../../lib/api";

const emptyProfile: OwnerProfile = {
  name: "",
  username: "",
  email: "",
  whatsapp: "",
  initial: "O",
};

function Field({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        readOnly={readOnly}
        className={`mt-2 h-10 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none transition-colors focus:border-red-300 ${
          readOnly ? "bg-slate-50 text-slate-500" : "bg-white text-slate-900"
        }`}
      />
    </label>
  );
}

export default function DashboardProfile() {
  const [profile, setProfile] = useState<OwnerProfile>(emptyProfile);
  const [draft, setDraft] = useState<OwnerProfile>(emptyProfile);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");

  async function loadProfile() {
    const data = await api.ownerProfile();
    setProfile(data);
    setDraft(data);
  }

  useEffect(() => {
    loadProfile().catch(console.error);
  }, []);

  function showMessage(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 2000);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const updated = await api.updateOwnerProfile(draft);
    setProfile(updated);
    setDraft(updated);
    setEditing(false);
    showMessage("Profil berhasil disimpan");
  }

  return (
    <DashboardLayout role="owner" title="Edit Profil Owner">
      <div className="space-y-5">
        {message ? <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-700">{message}</div> : null}

        <section id="profile" className="rounded-xl border border-gray-100 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-600">
                <i className="ri-user-settings-line text-base" />
              </span>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-900">Profil Owner</h2>
            </div>
            <button
              type="button"
              onClick={() => setEditing((current) => !current)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-slate-500 hover:border-red-100 hover:bg-red-50 hover:text-red-600"
              aria-label="Edit profil owner"
            >
              <i className="ri-settings-3-line" />
            </button>
          </div>

          <form onSubmit={saveProfile} className="space-y-4 p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Nama" value={draft.name} readOnly={!editing} onChange={(value) => setDraft({ ...draft, name: value })} />
              <Field label="Username" value={draft.username} readOnly={!editing} onChange={(value) => setDraft({ ...draft, username: value })} />
              <Field label="Email" value={draft.email} readOnly={!editing} onChange={(value) => setDraft({ ...draft, email: value })} />
              <Field label="Nomor WA" value={draft.whatsapp} readOnly={!editing} onChange={(value) => setDraft({ ...draft, whatsapp: value })} />
            </div>

            {editing ? (
              <div className="flex gap-2">
                <button type="submit" className="h-9 rounded-md bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700">
                  Simpan
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(profile);
                    setEditing(false);
                  }}
                  className="h-9 rounded-md border border-gray-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Batal
                </button>
              </div>
            ) : null}
          </form>
        </section>
      </div>
    </DashboardLayout>
  );
}
