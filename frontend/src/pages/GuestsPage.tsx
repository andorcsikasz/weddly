// Guest list manager, grouped by household. Each household carries the
// 4-digit RSVP check-in code and a copy-link button for the airport-style
// "couple slug + code" credential. The guest drawer assigns or creates
// households so couples can pre-link plus-ones, families, etc.

import type {
  Couple,
  Guest,
  GuestGroupTag,
  Household,
  MealChoice,
  RsvpStatus,
} from "@shared/types";
import { ChevronDown, Pencil, Plus, RefreshCw, Trash2, Upload, UserPlus, X } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { Dialog, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { coupleApi, guestApi, householdApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

interface ImportResult {
  created_count: number;
  errors: { row: number; reason: string }[];
}

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

interface DrawerInit {
  guest: Guest | null;
  /** When opening "add another to existing household", we pre-select it. */
  defaultHouseholdId: number | null;
}

export default function GuestsPage() {
  const { t } = useT();
  const confirm = useConfirm();
  const toast = useToast();
  const [couple, setCouple] = useState<Couple | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [editing, setEditing] = useState<DrawerInit | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [orphanFixing, setOrphanFixing] = useState(false);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);

  async function refresh() {
    const [c, g, h] = await Promise.all([
      coupleApi.current(),
      guestApi.list(),
      householdApi.list(),
    ]);
    setCouple(c.couple);
    setGuests(g.guests);
    setHouseholds(h.households);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onDeleteGuest(id: number) {
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

  async function onDeleteHousehold(hh: Household) {
    if (hh.member_ids.length > 0) {
      toast.error(t("guests.household_remove_confirm_body"));
      return;
    }
    const ok = await confirm({
      title: t("guests.household_remove_confirm_title"),
      body: t("guests.household_remove_confirm_body"),
      confirmLabel: t("common.confirm_delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    await householdApi.remove(hh.id);
    refresh();
  }

  async function onRegenCode(hh: Household) {
    const ok = await confirm({
      title: t("guests.household_regenerate_confirm_title"),
      body: t("guests.household_regenerate_confirm_body"),
      confirmLabel: t("guests.household_regenerate_code"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    await householdApi.regenerateCode(hh.id);
    refresh();
  }

  async function copyShare(slug: string | null, code: string) {
    if (!slug) return;
    const url = `${window.location.origin}/rsvp?couple=${slug}&code=${code}`;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no_clipboard");
      await navigator.clipboard.writeText(url);
      toast.success(t("guests.household_share_copied"));
    } catch {
      // Some browsers (especially in iframes / insecure contexts) refuse
      // clipboard writes — surface the URL so the user can copy by hand.
      setCopyFallback(url);
    }
  }

  async function onImport(file: File) {
    setImporting(true);
    try {
      const text = await file.text();
      const r = await guestApi.importCsv(text);
      const errors = Array.isArray(r.errors) ? r.errors : [];
      if (errors.length > 0) {
        // Surface per-row errors in a modal so users can fix and re-import.
        setImportResult({ created_count: r.created_count, errors });
      } else {
        toast.success(t("guests.import_done", { count: r.created_count }));
      }
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setImporting(false);
    }
  }

  async function onAssignOrphans(orphans: Guest[]) {
    if (orphans.length === 0) return;
    setOrphanFixing(true);
    try {
      // Create one household per orphan (label = guest name) and parent the
      // guest into it. Done sequentially so a single mid-loop failure leaves
      // the rest intact and surfaces a clean error.
      for (const g of orphans) {
        const r = await householdApi.create({ label: g.full_name });
        await guestApi.update(g.id, { household_id: r.household.id });
      }
      // Re-uses the import_done copy ("Imported N guests" / "Importálva: N
      // vendég") because the action surfaces the same outcome — N guests
      // are now placed and ready for check-in. Worth a dedicated key once
      // the orphan flow gets its own UX.
      toast.success(t("guests.import_done", { count: orphans.length }));
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setOrphanFixing(false);
    }
  }

  const guestsByHousehold = useMemo(() => {
    const m = new Map<number, Guest[]>();
    for (const g of guests) {
      if (g.household_id == null) continue;
      const arr = m.get(g.household_id) ?? [];
      arr.push(g);
      m.set(g.household_id, arr);
    }
    return m;
  }, [guests]);

  const orphanGuests = useMemo(() => guests.filter((g) => g.household_id == null), [guests]);

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
          <button
            type="button"
            className="btn-primary"
            onClick={() => setEditing({ guest: null, defaultHouseholdId: null })}
          >
            <Plus size={16} /> {t("guests.add")}
          </button>
        </div>
      </div>

      {couple && <CheckinPill couple={couple} onSaved={(c) => setCouple(c)} />}

      {households.length === 0 && guests.length === 0 ? (
        <div className="card stationery text-center">
          <h3 className="text-base font-semibold">{t("guests.empty_title")}</h3>
          <p className="mt-1 text-sm text-ink-600">{t("guests.empty_body")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {households.map((hh) => (
            <HouseholdCard
              key={hh.id}
              household={hh}
              members={guestsByHousehold.get(hh.id) ?? []}
              coupleSlug={couple?.slug ?? null}
              onCopyShare={() => {
                void copyShare(couple?.slug ?? null, hh.code);
              }}
              onAddMember={() => setEditing({ guest: null, defaultHouseholdId: hh.id })}
              onEditGuest={(g) => setEditing({ guest: g, defaultHouseholdId: g.household_id })}
              onDeleteGuest={onDeleteGuest}
              onRegenCode={() => onRegenCode(hh)}
              onDeleteHousehold={() => onDeleteHousehold(hh)}
            />
          ))}

          {orphanGuests.length > 0 && (
            <div className="card border-blush-200 bg-blush-50/40">
              <h3 className="font-serif text-lg text-ink-900">{t("guests.orphans_title")}</h3>
              <p className="mt-1 text-sm text-ink-700">{t("guests.orphans_body")}</p>
              <ul className="mt-3 text-sm text-ink-700">
                {orphanGuests.map((g) => (
                  <li key={g.id} className="flex items-center justify-between py-1">
                    <span>{g.full_name}</span>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => setEditing({ guest: g, defaultHouseholdId: null })}
                    >
                      {t("guests.edit")}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => onAssignOrphans(orphanGuests)}
                  disabled={orphanFixing}
                >
                  {orphanFixing ? t("guests.orphans_assigning") : t("guests.orphans_assign_button")}
                </button>
                <a
                  className="text-sm text-ink-600 underline underline-offset-2 hover:text-ink-900"
                  href={t("guests.orphans_support_url")}
                >
                  {t("guests.orphans_support_link")}
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      {importResult && (
        <ImportResultDialog result={importResult} onClose={() => setImportResult(null)} />
      )}

      {copyFallback && (
        <CopyFallbackDialog url={copyFallback} onClose={() => setCopyFallback(null)} />
      )}

      {editing && (
        <GuestDrawer
          init={editing}
          households={households}
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

function HouseholdCard({
  household,
  members,
  coupleSlug,
  onCopyShare,
  onAddMember,
  onEditGuest,
  onDeleteGuest,
  onRegenCode,
  onDeleteHousehold,
}: {
  household: Household;
  members: Guest[];
  coupleSlug: string | null;
  onCopyShare: () => void;
  onAddMember: () => void;
  onEditGuest: (g: Guest) => void;
  onDeleteGuest: (id: number) => void;
  onRegenCode: () => void;
  onDeleteHousehold: () => void;
}) {
  const { t } = useT();
  return (
    <div className="card overflow-hidden p-0">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-paper-200 bg-paper-100/60 px-4 py-3">
        <div className="min-w-0">
          <h3 className="font-serif text-lg text-ink-900 truncate">{household.label}</h3>
          <div className="mt-1 flex items-center gap-3 text-xs text-ink-600">
            {coupleSlug && <span className="font-mono uppercase">{coupleSlug}</span>}
            <span aria-hidden>·</span>
            <span className="font-mono text-base text-ink-900 tracking-[0.3em]">
              {household.code}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={onCopyShare}
            disabled={!coupleSlug}
            title={t("guests.household_share_link")}
          >
            {t("guests.household_share_link")}
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={onRegenCode}
            title={t("guests.household_regenerate_code")}
          >
            <RefreshCw size={14} />
          </button>
          {members.length === 0 && (
            <button
              type="button"
              className="btn-ghost btn-sm text-blush-700"
              onClick={onDeleteHousehold}
              title={t("guests.household_remove")}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </header>

      <ul className="divide-y divide-paper-200">
        {members.map((g) => (
          <li key={g.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="font-medium text-ink-900 truncate">{g.full_name}</p>
              <p className="text-xs text-ink-500">{t(`guests.group_${g.group_tag}`)}</p>
            </div>
            <div className="flex items-center gap-2">
              <RsvpBadge status={g.rsvp_status} />
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => onEditGuest(g)}
                aria-label={t("guests.edit")}
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm text-blush-700"
                onClick={() => onDeleteGuest(g.id)}
                aria-label={t("guests.delete")}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </li>
        ))}
        <li className="px-4 py-2.5">
          <button
            type="button"
            className="btn-ghost btn-sm w-full justify-start"
            onClick={onAddMember}
          >
            <UserPlus size={14} /> {t("guests.household_add_member")}
          </button>
        </li>
      </ul>
    </div>
  );
}

/**
 * Compact "Check-in: ANDORSARI · + 4-digit code" pill at the top of
 * /app/guests. Collapsed by default — first-time visitors get the airport
 * concept at a glance without the page being top-heavy. Click expands the
 * panel for slug edit + URL hint + the household-grouping reminder.
 */
function CheckinPill({ couple, onSaved }: { couple: Couple; onSaved: (next: Couple) => void }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(couple.slug ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    const cleaned = draft
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 24);
    if (cleaned.length < 3) {
      setError(t("guests.couple_slug_invalid"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await coupleApi.updateSlug(cleaned);
      onSaved(r.couple);
      setEditing(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setError(t("guests.couple_slug_taken"));
      else setError(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-paper-300 bg-paper-100/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? t("guests.checkin_pill_hide") : t("guests.checkin_pill_show")}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-paper-100"
      >
        <span className="text-xs font-medium uppercase tracking-wider text-ink-500">
          {t("guests.checkin_pill_lead")}
        </span>
        <span className="font-mono text-base uppercase tracking-[0.3em] text-ink-900">
          {couple.slug ?? "—"}
        </span>
        <span className="text-sm text-ink-600 hidden sm:inline">
          {t("guests.checkin_pill_suffix")}
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className={
            expanded
              ? "ml-auto rotate-180 text-ink-700 transition-transform"
              : "ml-auto text-ink-500 transition-transform"
          }
        />
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-paper-300 px-4 py-4">
          <div>
            <p className="text-sm text-ink-700">{t("guests.checkin_pill_url_hint")}</p>
            <p className="mt-2 text-xs text-ink-500 sm:hidden">{t("guests.checkin_pill_suffix")}</p>
          </div>

          <div className="rounded-xl border border-paper-200 bg-paper-50 px-3 py-3">
            <p className="text-xs font-medium uppercase tracking-wider text-ink-500">
              {t("guests.couple_slug_title")}
            </p>
            <p className="mt-1 text-xs text-ink-600">{t("guests.couple_slug_help")}</p>
            {editing ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  // biome-ignore lint/a11y/noAutofocus: focus is intentional when entering edit mode
                  autoFocus
                  className="input font-mono uppercase tracking-[0.3em]"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.toUpperCase())}
                  maxLength={24}
                />
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  onClick={onSave}
                  disabled={submitting}
                >
                  {t("guests.couple_slug_save")}
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setEditing(false);
                    setDraft(couple.slug ?? "");
                    setError(null);
                  }}
                >
                  {t("common.cancel")}
                </button>
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-3">
                <span className="font-mono text-2xl uppercase tracking-[0.3em] text-ink-900">
                  {couple.slug ?? "—"}
                </span>
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => setEditing(true)}
                  aria-label={t("guests.edit")}
                >
                  <Pencil size={14} />
                </button>
              </div>
            )}
            {error && <p className="field-error mt-2">{error}</p>}
          </div>

          <p className="text-xs text-ink-500">{t("guests.household_section_help")}</p>
        </div>
      )}
    </div>
  );
}

function RsvpBadge({ status }: { status: RsvpStatus }) {
  const { t } = useT();
  // Glyph + colour together — colour-only badges fail accessibility checks
  // and read as identical to anyone with red/green deficiency. The dashed
  // border distinguishes "pending" (no answer yet) from "maybe" (declared
  // tentative).
  const glyph = status === "yes" ? "✓" : status === "no" ? "✗" : status === "maybe" ? "?" : "⌛";
  const cls =
    status === "yes"
      ? "badge-blush"
      : status === "no"
        ? "badge-ink"
        : status === "maybe"
          ? "badge-paper"
          : "badge-paper border border-dashed border-paper-300";
  const label =
    status === "yes"
      ? t("guests.rsvp_badge_yes")
      : status === "no"
        ? t("guests.rsvp_badge_no")
        : status === "maybe"
          ? t("guests.rsvp_badge_maybe")
          : t("guests.rsvp_badge_pending");
  return (
    <span className={cls} aria-label={label} title={label}>
      <span aria-hidden="true" className="mr-1">
        {glyph}
      </span>
      {t(`guests.rsvp_${status}`)}
    </span>
  );
}

function GuestDrawer({
  init,
  households,
  onClose,
  onSaved,
}: {
  init: DrawerInit;
  households: Household[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useT();
  const guest = init.guest;

  const [form, setForm] = useState<Partial<Guest>>(
    guest ?? {
      full_name: "",
      email: null,
      phone: null,
      group_tag: "other",
      rsvp_status: "pending",
      meal_choice: null,
      dietary: null,
      accommodation_needed: false,
      song_request: null,
      notes: null,
    },
  );
  const [householdMode, setHouseholdMode] = useState<"existing" | "new">(
    init.defaultHouseholdId !== null || guest?.household_id ? "existing" : "new",
  );
  const [householdId, setHouseholdId] = useState<number | null>(
    guest?.household_id ?? init.defaultHouseholdId ?? households[0]?.id ?? null,
  );
  const [newHouseholdLabel, setNewHouseholdLabel] = useState("");
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
      const body: Record<string, unknown> = { ...form };
      if (householdMode === "existing" && householdId) {
        body.household_id = householdId;
      } else if (householdMode === "new") {
        body.household_id = null;
        const label = newHouseholdLabel.trim();
        if (label) body.new_household_label = label;
      }
      if (guest) await guestApi.update(guest.id, body);
      else await guestApi.create(body);
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

        <div className="mb-3 rounded-2xl border border-paper-200 bg-paper-100/40 p-3">
          <label className="field-label">{t("guests.household_label")}</label>
          <p className="mb-2 text-xs text-ink-500">{t("guests.household_assign_help")}</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setHouseholdMode("existing")}
              disabled={households.length === 0}
              className={
                householdMode === "existing"
                  ? "rounded-xl border-2 border-ink-700 bg-ink-700 px-3 py-2 text-sm font-medium text-paper-100"
                  : "rounded-xl border border-paper-300 bg-paper-50 px-3 py-2 text-sm text-ink-700 hover:border-ink-400"
              }
            >
              {t("guests.household_existing")}
            </button>
            <button
              type="button"
              onClick={() => setHouseholdMode("new")}
              className={
                householdMode === "new"
                  ? "rounded-xl border-2 border-ink-700 bg-ink-700 px-3 py-2 text-sm font-medium text-paper-100"
                  : "rounded-xl border border-paper-300 bg-paper-50 px-3 py-2 text-sm text-ink-700 hover:border-ink-400"
              }
            >
              {t("guests.household_new")}
            </button>
          </div>
          {householdMode === "existing" ? (
            <select
              className="input mt-2"
              value={householdId ?? ""}
              onChange={(e) => setHouseholdId(Number(e.target.value) || null)}
            >
              {households.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label} · {h.code}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="input mt-2"
              placeholder={t("guests.household_new_label")}
              value={newHouseholdLabel}
              onChange={(e) => setNewHouseholdLabel(e.target.value)}
            />
          )}
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
          <label className="field-label">{t("guests.meal")}</label>
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
          label={t("guests.allergies")}
          value={form.dietary ?? ""}
          onChange={(v) => setForm({ ...form, dietary: v || null })}
          placeholder={t("guests.allergies_placeholder")}
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
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  textarea?: boolean;
  placeholder?: string;
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
          placeholder={placeholder}
        />
      ) : (
        <input
          className="input"
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}

function ImportResultDialog({
  result,
  onClose,
}: {
  result: ImportResult;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <Dialog
      open
      title={t("guests.import_errors_title")}
      role="dialog"
      onClose={onClose}
      footer={
        <button type="button" className="btn-primary" onClick={onClose}>
          {t("guests.import_errors_close")}
        </button>
      }
    >
      <div className="space-y-3">
        <p className="text-ink-700">
          <strong>{t("guests.import_imported_label")}:</strong> {result.created_count}
          {" · "}
          <strong>{t("guests.import_errors_label")}:</strong> {result.errors.length}
        </p>
        {result.errors.length > 0 && (
          <>
            <p className="text-ink-700">{t("guests.import_errors_body")}</p>
            <ul className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-paper-200 bg-paper-100/40 p-3 text-sm">
              {result.errors.map((err) => (
                <li key={`${err.row}-${err.reason}`} className="text-ink-700">
                  <span className="font-mono text-ink-500">
                    {t("guests.import_row_label")} {err.row}:
                  </span>{" "}
                  {err.reason}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Dialog>
  );
}

function CopyFallbackDialog({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useT();
  return (
    <Dialog
      open
      title={t("guests.copy_failed_title")}
      role="dialog"
      onClose={onClose}
      footer={
        <button type="button" className="btn-primary" onClick={onClose}>
          {t("guests.copy_failed_close")}
        </button>
      }
    >
      <div className="space-y-3">
        <p className="text-ink-700">{t("guests.copy_failed_body")}</p>
        <input
          readOnly
          value={url}
          className="input font-mono text-sm"
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>
    </Dialog>
  );
}

function downloadCsvTemplate() {
  const csv =
    "full_name,email,phone,group_tag,household,plus_one_name,dietary,notes\nAnna Kis,anna@example.com,+36301234567,his_family,Kis család,Bence Nagy,vegetarian,VIP\nBence Nagy,bence@example.com,+36309998888,his_family,Kis család,,,Bence is the +1 of Anna\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "weddly-guests-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}
