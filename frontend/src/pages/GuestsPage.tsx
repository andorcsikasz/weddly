// Guest list manager. Inline-edit drawer + CSV import.

import type { Guest, GuestGroupTag, MealChoice, RsvpStatus } from "@shared/types";
import { Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import { useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { guestApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

const GROUPS: GuestGroupTag[] = [
  "his_family",
  "her_family",
  "his_friends",
  "her_friends",
  "shared_friends",
  "work",
  "other",
];

const MEALS: MealChoice[] = ["meat", "fish", "vegetarian", "vegan", "child", "none"];
const RSVPS: RsvpStatus[] = ["pending", "yes", "no", "maybe"];

export default function GuestsPage() {
  const { t } = useT();
  const confirm = useConfirm();
  const toast = useToast();
  const [guests, setGuests] = useState<Guest[]>([]);
  const [editing, setEditing] = useState<Guest | "new" | null>(null);
  const [importing, setImporting] = useState(false);

  async function refresh() {
    const r = await guestApi.list();
    setGuests(r.guests);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onDelete(id: number) {
    const ok = await confirm({
      title: t("guests.confirm_delete"),
      body: t("common.confirm_delete_body"),
      confirmLabel: t("common.confirm_delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    await guestApi.remove(id);
    refresh();
  }

  function copyInvite(code: string) {
    const url = `${window.location.origin}/rsvp/${code}`;
    navigator.clipboard?.writeText(url);
    toast.success(t("guests.invite_copied"));
  }

  async function onImport(file: File) {
    setImporting(true);
    try {
      const text = await file.text();
      const r = await guestApi.importCsv(text);
      toast.success(t("guests.import_done", { count: r.created_count }));
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setImporting(false);
    }
  }

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1>{t("guests.title")}</h1>
          <p className="mt-1 text-sm text-ink-500">{guests.length}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-outline"
            onClick={downloadCsvTemplate}
            title={t("guests.download_template")}
          >
            CSV
          </button>
          <label className="btn-outline cursor-pointer">
            <Upload size={16} /> {t("guests.import_csv")}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImport(f);
                e.target.value = "";
              }}
              disabled={importing}
            />
          </label>
          <button type="button" className="btn-primary" onClick={() => setEditing("new")}>
            <Plus size={16} /> {t("guests.add")}
          </button>
        </div>
      </div>

      {guests.length === 0 ? (
        <div className="card stationery text-center">
          <h3 className="text-base font-semibold">{t("guests.empty_title")}</h3>
          <p className="mt-1 text-sm text-ink-600">{t("guests.empty_body")}</p>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead className="bg-paper-100 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-3">{t("guests.full_name")}</th>
                <th className="px-4 py-3 hidden sm:table-cell">{t("guests.group")}</th>
                <th className="px-4 py-3">{t("guests.rsvp")}</th>
                <th className="px-4 py-3 hidden md:table-cell">{t("guests.invite_link")}</th>
                <th className="px-4 py-3 text-right">{t("guests.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {guests.map((g) => (
                <tr key={g.id} className="border-t border-paper-200">
                  <td className="px-4 py-2.5 font-medium text-ink-900">
                    {g.full_name}
                    {g.plus_one_name && (
                      <span className="ml-2 text-xs text-ink-500">+ {g.plus_one_name}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 hidden sm:table-cell text-ink-600">
                    {t(`guests.group_${g.group_tag}`)}
                  </td>
                  <td className="px-4 py-2.5">
                    <RsvpBadge status={g.rsvp_status} />
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <button
                      type="button"
                      className="font-mono text-xs text-ink-700 underline-offset-2 hover:underline"
                      onClick={() => copyInvite(g.invite_code)}
                    >
                      {g.invite_code}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => setEditing(g)}
                      aria-label={t("guests.edit")}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm text-blush-700"
                      onClick={() => onDelete(g.id)}
                      aria-label={t("guests.delete")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <GuestDrawer
          guest={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </AppShell>
  );
}

function RsvpBadge({ status }: { status: RsvpStatus }) {
  const { t } = useT();
  const cls =
    status === "yes"
      ? "badge-blush"
      : status === "no"
        ? "badge-ink"
        : status === "maybe"
          ? "badge-paper"
          : "badge-paper";
  return <span className={cls}>{t(`guests.rsvp_${status}`)}</span>;
}

function GuestDrawer({
  guest,
  onClose,
  onSaved,
}: {
  guest: Guest | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const [form, setForm] = useState<Partial<Guest>>(
    guest ?? {
      full_name: "",
      email: null,
      phone: null,
      group_tag: "other",
      rsvp_status: "pending",
      meal_choice: null,
      dietary: null,
      plus_one_name: null,
      plus_one_meal: null,
      accommodation_needed: false,
      song_request: null,
      notes: null,
    },
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.full_name?.trim()) {
      setError(t("guests.full_name"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (guest) await guestApi.update(guest.id, form);
      else await guestApi.create(form);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error_generic"));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-end bg-black/40 sm:items-stretch">
      <form
        className="w-full max-w-md overflow-y-auto bg-paper-50 p-6 shadow-pop sm:h-full"
        onSubmit={onSubmit}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2>{guest ? t("guests.edit") : t("guests.add")}</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <Field
          label={t("guests.full_name")}
          value={form.full_name ?? ""}
          onChange={(v) => setForm({ ...form, full_name: v })}
        />
        <Field
          label={t("guests.email")}
          value={form.email ?? ""}
          onChange={(v) => setForm({ ...form, email: v || null })}
          type="email"
        />
        <Field
          label={t("guests.phone")}
          value={form.phone ?? ""}
          onChange={(v) => setForm({ ...form, phone: v || null })}
        />

        <div className="mb-3">
          <label className="field-label">{t("guests.group")}</label>
          <select
            className="input"
            value={form.group_tag ?? "other"}
            onChange={(e) => setForm({ ...form, group_tag: e.target.value as GuestGroupTag })}
          >
            {GROUPS.map((g) => (
              <option key={g} value={g}>
                {t(`guests.group_${g}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="mb-3">
          <label className="field-label">{t("guests.rsvp")}</label>
          <select
            className="input"
            value={form.rsvp_status ?? "pending"}
            onChange={(e) => setForm({ ...form, rsvp_status: e.target.value as RsvpStatus })}
          >
            {RSVPS.map((s) => (
              <option key={s} value={s}>
                {t(`guests.rsvp_${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="mb-3">
          <label className="field-label">{t("guests.dietary")}</label>
          <select
            className="input"
            value={form.meal_choice ?? ""}
            onChange={(e) =>
              setForm({ ...form, meal_choice: (e.target.value as MealChoice) || null })
            }
          >
            <option value="">—</option>
            {MEALS.map((m) => (
              <option key={m} value={m}>
                {t(`guests.meal_${m}`)}
              </option>
            ))}
          </select>
        </div>
        <Field
          label={t("guests.dietary")}
          value={form.dietary ?? ""}
          onChange={(v) => setForm({ ...form, dietary: v || null })}
        />
        <Field
          label={t("guests.plus_one")}
          value={form.plus_one_name ?? ""}
          onChange={(v) => setForm({ ...form, plus_one_name: v || null })}
        />
        <label className="mb-3 flex items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={Boolean(form.accommodation_needed)}
            onChange={(e) => setForm({ ...form, accommodation_needed: e.target.checked })}
          />
          {t("guests.accommodation")}
        </label>
        <Field
          label={t("guests.song_request")}
          value={form.song_request ?? ""}
          onChange={(v) => setForm({ ...form, song_request: v || null })}
        />
        <Field
          label={t("guests.notes")}
          value={form.notes ?? ""}
          onChange={(v) => setForm({ ...form, notes: v || null })}
          textarea
        />

        {error && <p className="field-error">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn-ghost flex-1" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={submitting}>
            {submitting ? t("guests.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  textarea,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  textarea?: boolean;
}) {
  return (
    <div className="mb-3">
      <label className="field-label">{label}</label>
      {textarea ? (
        <textarea
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
        />
      ) : (
        <input
          className="input"
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function downloadCsvTemplate() {
  const csv =
    "full_name,email,phone,group_tag,plus_one_name,dietary,notes\nAnna Kis,anna@example.com,+36301234567,his_family,Bence Nagy,vegetarian,VIP\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "weddly-guests-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}
