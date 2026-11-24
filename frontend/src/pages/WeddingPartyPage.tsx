// Wedding party: the helpers and special roles (best man, bridesmaids, the
// konferanszié, the photographer). Not guests: each row tracks the ask itself
// (not asked → asked → said yes / unsure / said no). Members are grouped by
// role in the order of WEDDING_PARTY_ROLES, so the page reads like the
// ceremony does: the bridal party first, then the people who run the day.

import {
  WEDDING_PARTY_CEREMONIES,
  WEDDING_PARTY_ROLES,
  WEDDING_PARTY_STATUSES,
  type UpsertWeddingPartyInput,
  type WeddingPartyCeremony,
  type WeddingPartyMember,
  type WeddingPartyRole,
  type WeddingPartyStatus,
} from "@shared/types";
import { Mail, Pencil, Phone, Plus, Trash2, Users } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Button, Dialog, Skeleton, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { weddingPartyApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

const STATUS_TONE: Record<WeddingPartyStatus, string> = {
  not_asked: "bg-paper-200 text-ink-600 dark:bg-umber-800 dark:text-umber-200",
  asked: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  said_yes: "bg-sage-100 text-sage-800 dark:bg-sage-900/40 dark:text-sage-200",
  maybe: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
  declined: "bg-paper-200 text-ink-500 line-through dark:bg-umber-800 dark:text-umber-300",
};

export default function WeddingPartyPage() {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [members, setMembers] = useState<WeddingPartyMember[] | null>(null);
  const [editing, setEditing] = useState<WeddingPartyMember | "new" | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const { members: list } = await weddingPartyApi.list();
      setMembers(list);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("party.load_failed"));
      setMembers([]);
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(WEDDING_PARTY_STATUSES.map((s) => [s, 0])) as Record<
      WeddingPartyStatus,
      number
    >;
    for (const m of members ?? []) c[m.status] += 1;
    return c;
  }, [members]);

  const groups = useMemo(() => {
    const byRole = new Map<WeddingPartyRole, WeddingPartyMember[]>();
    for (const m of members ?? []) {
      const list = byRole.get(m.role) ?? [];
      list.push(m);
      byRole.set(m.role, list);
    }
    return WEDDING_PARTY_ROLES.filter((r) => byRole.has(r)).map((r) => ({
      role: r,
      items: byRole.get(r) ?? [],
    }));
  }, [members]);

  async function changeStatus(m: WeddingPartyMember, status: WeddingPartyStatus) {
    if (status === m.status) return;
    setBusyId(m.id);
    try {
      await weddingPartyApi.update(m.id, { status });
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("party.save_failed"));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(m: WeddingPartyMember) {
    const ok = await confirm({
      title: t("party.delete_title").replace("{name}", m.name),
      body: t("party.delete_body"),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await weddingPartyApi.remove(m.id);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("party.delete_failed"));
    }
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-grotesk text-2xl text-ink-900 dark:text-umber-50">
            {t("party.title")}
          </h1>
          <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">{t("party.sub")}</p>
        </div>
        <Button variant="primary" onClick={() => setEditing("new")}>
          <Plus size={16} strokeWidth={1.5} aria-hidden />
          {t("party.add")}
        </Button>
      </div>

      {members === null ? (
        <Skeleton className="h-40 w-full" />
      ) : members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-paper-400 p-8 text-center dark:border-umber-600">
          <Users
            size={28}
            strokeWidth={1.5}
            aria-hidden
            className="mx-auto text-ink-400 dark:text-umber-300"
          />
          <p className="mt-3 font-medium text-ink-800 dark:text-umber-100">
            {t("party.empty_title")}
          </p>
          <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">{t("party.empty_hint")}</p>
        </div>
      ) : (
        <>
          <ul aria-label={t("party.summary_label")} className="mb-6 flex flex-wrap gap-2">
            {WEDDING_PARTY_STATUSES.map((s) => (
              <li
                key={s}
                className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_TONE[s]}`}
              >
                {t(`party.status_names.${s}`)} · {counts[s]}
              </li>
            ))}
          </ul>

          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.role} aria-labelledby={`party-${group.role}`}>
                <h2
                  id={`party-${group.role}`}
                  className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300"
                >
                  {t(`party.role_names.${group.role}`)}
                </h2>
                <ul className="divide-y divide-paper-300 overflow-hidden rounded-xl border border-paper-400 bg-paper-50 dark:divide-umber-700 dark:border-umber-600 dark:bg-umber-900">
                  {group.items.map((m) => (
                    <MemberRow
                      key={m.id}
                      member={m}
                      busy={busyId === m.id}
                      onStatus={(s) => void changeStatus(m, s)}
                      onEdit={() => setEditing(m)}
                      onRemove={() => void remove(m)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}

      {editing !== null && (
        <PartyDialog
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </>
  );
}

function MemberRow({
  member,
  busy,
  onStatus,
  onEdit,
  onRemove,
}: {
  member: WeddingPartyMember;
  busy: boolean;
  onStatus: (s: WeddingPartyStatus) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useT();
  const roleText =
    member.role === "other" && member.role_label
      ? member.role_label
      : t(`party.role_names.${member.role}`);

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-ink-900 dark:text-umber-50">{member.name}</p>
        <p className="truncate text-xs text-ink-600 dark:text-umber-200">
          {roleText}
          {member.ceremony && (
            <>
              {" · "}
              {t(`party.ceremony_names.${member.ceremony}`)}
            </>
          )}
        </p>
        {(member.phone || member.email) && (
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-500 dark:text-umber-300">
            {member.phone && (
              <a
                href={`tel:${member.phone}`}
                className="inline-flex items-center gap-1 underline-offset-[0.2em] hover:underline"
              >
                <Phone size={12} strokeWidth={1.5} aria-hidden />
                {member.phone}
              </a>
            )}
            {member.email && (
              <a
                href={`mailto:${member.email}`}
                className="inline-flex items-center gap-1 underline-offset-[0.2em] hover:underline"
              >
                <Mail size={12} strokeWidth={1.5} aria-hidden />
                {member.email}
              </a>
            )}
          </p>
        )}
        {member.notes && (
          <p className="mt-1 line-clamp-2 text-xs text-ink-500 dark:text-umber-300">
            {member.notes}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <select
          aria-label={t("party.status_aria").replace("{name}", member.name)}
          value={member.status}
          disabled={busy}
          onChange={(e) => onStatus(e.target.value as WeddingPartyStatus)}
          className={`input min-h-9 w-auto rounded-full text-base sm:text-sm ${STATUS_TONE[member.status]}`}
        >
          {WEDDING_PARTY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`party.status_names.${s}`)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onEdit}
          aria-label={t("party.edit_aria").replace("{name}", member.name)}
          className="rounded-md p-2 text-ink-500 hover:bg-paper-200 hover:text-ink-900 active:scale-[0.97] dark:text-umber-300 dark:hover:bg-umber-800"
          style={{ touchAction: "manipulation" }}
        >
          <Pencil size={16} strokeWidth={1.5} aria-hidden />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("party.delete_aria").replace("{name}", member.name)}
          className="rounded-md p-2 text-ink-500 hover:bg-paper-200 hover:text-red-700 active:scale-[0.97] dark:text-umber-300 dark:hover:bg-umber-800"
          style={{ touchAction: "manipulation" }}
        >
          <Trash2 size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
    </li>
  );
}

// Ceremony is one of three answers, and "not decided" is a real answer too:
// most couples do not know yet whether the best man stands at the registry
// office, the church, or both.
type CeremonyChoice = WeddingPartyCeremony | "";

function PartyDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: WeddingPartyMember | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useT();
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState<WeddingPartyRole>(initial?.role ?? "best_man");
  const [roleLabel, setRoleLabel] = useState(initial?.role_label ?? "");
  const [ceremony, setCeremony] = useState<CeremonyChoice>(initial?.ceremony ?? "");
  const [status, setStatus] = useState<WeddingPartyStatus>(initial?.status ?? "not_asked");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error(t("party.name_required"));
      return;
    }
    const label = roleLabel.trim();
    if (role === "other" && !label) {
      toast.error(t("party.role_label_required"));
      return;
    }
    const body: UpsertWeddingPartyInput = {
      name: trimmedName,
      role,
      role_label: role === "other" ? label : null,
      ceremony: ceremony === "" ? null : ceremony,
      status,
      phone: phone.trim() || null,
      email: email.trim() || null,
      notes: notes.trim() || null,
    };
    setSubmitting(true);
    try {
      if (initial) await weddingPartyApi.update(initial.id, body);
      else await weddingPartyApi.create(body);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("party.save_failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      title={initial ? t("party.edit_title") : t("party.add_title")}
      onClose={onClose}
      closeOnBackdrop
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={onSubmit} disabled={submitting}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label={t("party.field_name")}>
          <input
            type="text"
            className="input text-base sm:text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("party.name_placeholder")}
            autoComplete="off"
            autoFocus
          />
        </Field>

        <Field label={t("party.field_role")}>
          <select
            className="input text-base sm:text-sm"
            value={role}
            onChange={(e) => setRole(e.target.value as WeddingPartyRole)}
          >
            {WEDDING_PARTY_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`party.role_names.${r}`)}
              </option>
            ))}
          </select>
        </Field>

        {role === "other" && (
          <Field label={t("party.field_role_label")}>
            <input
              type="text"
              className="input text-base sm:text-sm"
              value={roleLabel}
              onChange={(e) => setRoleLabel(e.target.value)}
              placeholder={t("party.role_label_placeholder")}
            />
          </Field>
        )}

        <div>
          <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-umber-200">
            {t("party.field_ceremony")}
          </span>
          <div
            role="radiogroup"
            aria-label={t("party.field_ceremony")}
            className="flex flex-wrap gap-2"
          >
            {(["", ...WEDDING_PARTY_CEREMONIES] as CeremonyChoice[]).map((c) => (
              <button
                key={c || "none"}
                type="button"
                role="radio"
                aria-checked={ceremony === c}
                onClick={() => setCeremony(c)}
                className={`rounded-full border px-3 py-1.5 text-sm active:scale-[0.97] ${
                  ceremony === c
                    ? "border-ink-700 bg-ink-700 text-paper-50 dark:border-umber-200 dark:bg-umber-200 dark:text-umber-900"
                    : "border-paper-400 text-ink-700 dark:border-umber-600 dark:text-umber-100"
                }`}
                style={{ touchAction: "manipulation" }}
              >
                {c === "" ? t("party.ceremony_none") : t(`party.ceremony_names.${c}`)}
              </button>
            ))}
          </div>
          <span className="mt-1 block text-[11px] text-ink-500 dark:text-umber-300">
            {t("party.ceremony_help")}
          </span>
        </div>

        <Field label={t("party.field_status")}>
          <select
            className="input text-base sm:text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as WeddingPartyStatus)}
          >
            {WEDDING_PARTY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`party.status_names.${s}`)}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("party.field_phone")}>
            <input
              type="tel"
              className="input text-base sm:text-sm"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
            />
          </Field>
          <Field label={t("party.field_email")}>
            <input
              type="email"
              className="input text-base sm:text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </Field>
        </div>

        <Field label={t("party.field_notes")}>
          <textarea
            className="input min-h-20 text-base sm:text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("party.notes_placeholder")}
            rows={3}
          />
        </Field>
      </form>
    </Dialog>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-600 dark:text-umber-200">
        {label}
      </span>
      {children}
      {help && (
        <span className="mt-1 block text-[11px] text-ink-500 dark:text-umber-300">{help}</span>
      )}
    </label>
  );
}
