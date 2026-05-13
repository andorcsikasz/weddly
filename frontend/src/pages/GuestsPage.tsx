// Guest list manager, grouped by household. Each household carries the
// 4-digit RSVP check-in code and a copy-link button for the airport-style
// "couple slug + code" credential. The guest drawer assigns or creates
// households so couples can pre-link plus-ones, families, etc.

import type {
  Couple,
  Guest,
  GuestGroupTag,
  GuestKind,
  Household,
  MealChoice,
  RsvpStatus,
} from "@shared/types";
import {
  Baby,
  Ban,
  Beef,
  Check,
  CheckCheck,
  ChevronDown,
  Cookie,
  Crown,
  Fish,
  Leaf,
  Link2,
  Milk,
  Music,
  Nut,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Sprout,
  Trash2,
  Upload,
  UserPlus,
  Wheat,
  X,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../components/AppShell";
import { Dialog, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { coupleApi, fetchPdfBlob, guestApi, householdApi, placeCardsUrl } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

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
  useDocumentMeta("seo.guests_title", "seo.guests_description");
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
  // ── Search state ────────────────────────────────────────────────────
  // `query` is the raw text in the input; `debouncedQuery` is what we
  // actually search on (200ms after the user stops typing).
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Guest[] | null>(null);
  const [searching, setSearching] = useState(false);
  // ── Virtualization knob ─────────────────────────────────────────────
  // Long lists (>100 guests) render the first chunk synchronously and
  // reveal the rest after the first idle frame so the initial paint isn't
  // dominated by household-card layout. No external library — just a
  // setTimeout + flag.
  const [virtualReveal, setVirtualReveal] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce the query → debouncedQuery transition.
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebouncedQuery(query.trim()), 200);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query]);

  // Fire the server-side search whenever the debounced query changes.
  // Empty query → clear results and fall back to the grouped household view.
  useEffect(() => {
    if (!debouncedQuery) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    guestApi
      .search({ q: debouncedQuery, limit: 200 })
      .then((r) => {
        if (cancelled) return;
        setSearchResults(r.guests);
      })
      .catch(() => {
        if (cancelled) return;
        setSearchResults([]);
      })
      .finally(() => {
        if (cancelled) return;
        setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  // Once the page has painted with the initial 100 guests, reveal the rest
  // on the next macrotask. We re-arm whenever the household count crosses
  // the threshold so an import that doubles the list re-stages the reveal.
  useEffect(() => {
    if (households.length > 100) {
      setVirtualReveal(false);
      const handle = setTimeout(() => setVirtualReveal(true), 0);
      return () => clearTimeout(handle);
    }
    setVirtualReveal(true);
    return undefined;
  }, [households.length]);

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

  async function onRenameHousehold(id: number, label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    try {
      await householdApi.update(id, { label: trimmed });
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  async function onCycleInviteState(g: Guest) {
    // 3-state cycle: not-invited → invited → delivered → not-invited.
    // Encode the *target* as a (invited, delivered) pair on the wire so the
    // server can reason about both timestamps in one round-trip.
    const currentState = inviteStateOf(g);
    const next = nextInviteState(currentState);
    const targetTs = Date.now();
    const optimistic = (list: Guest[]) =>
      list.map((row) =>
        row.id === g.id
          ? {
              ...row,
              invited_at: next === "not_invited" ? null : targetTs,
              invitation_delivered_at: next === "delivered" ? targetTs : null,
            }
          : row,
      );
    setGuests((prev) => optimistic(prev));
    setSearchResults((prev) => (prev ? optimistic(prev) : prev));
    try {
      // PATCH revalidates the row, so ship the full guest plus the two flags.
      await guestApi.update(g.id, {
        ...g,
        invited: next !== "not_invited",
        delivered: next === "delivered",
      });
    } catch (e) {
      // Roll back on failure so the UI doesn't lie.
      const rollback = (list: Guest[]) =>
        list.map((row) =>
          row.id === g.id
            ? {
                ...row,
                invited_at: g.invited_at,
                invitation_delivered_at: g.invitation_delivered_at,
              }
            : row,
        );
      setGuests((prev) => rollback(prev));
      setSearchResults((prev) => (prev ? rollback(prev) : prev));
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  /**
   * Per-row "Print place card" action — pulls a one-guest place-cards PDF
   * via `fetchPdfBlob` (which threads our Bearer auth) and triggers a
   * disk save through a transient anchor. Doing it as a blob keeps us off
   * the new-tab path, which strips Authorization headers on the GET.
   */
  async function onPrintPlaceCard(guest: Guest) {
    // Surface the click immediately — the network round-trip can be ~1s.
    toast.success(t("guests.print_place_card_started"));
    try {
      const raw = await fetchPdfBlob(placeCardsUrl({ guestIds: [guest.id] }));
      const typed =
        raw.type === "application/pdf" ? raw : raw.slice(0, raw.size, "application/pdf");
      const url = URL.createObjectURL(typed);
      const a = document.createElement("a");
      a.href = url;
      a.download = `weddly-place-card-${guest.id}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
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
          {guests.length > 0 ? (
            <dl className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3">
              <GuestStat
                value={guests.length}
                label={t("guests.total_summary_unit")}
                tone="primary"
              />
              <GuestStat
                value={households.length}
                label={t("guests.total_summary_households_unit")}
              />
              <GuestStat
                value={guests.filter((g) => g.invited_at != null).length}
                label={t("guests.total_summary_invited_unit")}
              />
            </dl>
          ) : (
            <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">{guests.length}</p>
          )}
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

      {/* ── Search ─────────────────────────────────────────────────────
          Server-side full-text search. While active, we render a flat
          list of matches instead of the grouped household view. */}
      {(guests.length > 0 || query) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search
              size={14}
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-umber-300"
            />
            <input
              type="search"
              className="input pl-9"
              placeholder={t("guests.search_placeholder")}
              aria-label={t("guests.search_label")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {query && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setQuery("")}
              aria-label={t("guests.search_clear")}
            >
              {t("guests.search_clear")}
            </button>
          )}
        </div>
      )}

      {households.length === 0 && guests.length === 0 ? (
        <div className="card stationery text-center">
          <h3 className="text-base font-semibold">{t("guests.empty_title")}</h3>
          <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">{t("guests.empty_body")}</p>
        </div>
      ) : debouncedQuery ? (
        <SearchResults
          loading={searching}
          guests={searchResults ?? []}
          onEditGuest={(g) => setEditing({ guest: g, defaultHouseholdId: g.household_id })}
          onPrintPlaceCard={onPrintPlaceCard}
        />
      ) : (
        <div className="space-y-4">
          {(virtualReveal ? households : households.slice(0, 100)).map((hh) => (
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
              onRenameHousehold={onRenameHousehold}
              onCycleInviteState={onCycleInviteState}
              onPrintPlaceCard={onPrintPlaceCard}
            />
          ))}
          {!virtualReveal && households.length > 100 && (
            <p className="text-center text-xs text-ink-500 dark:text-umber-300">
              {t("guests.search_load_more")}
            </p>
          )}

          {orphanGuests.length > 0 && (
            <div className="card border-blush-200 bg-blush-50/40 dark:border-blush-400/40 dark:bg-blush-400/15">
              <h3 className="text-base font-semibold text-ink-900 dark:text-paper-50">
                {t("guests.orphans_title")}
              </h3>
              <p className="mt-1 text-sm text-ink-700 dark:text-paper-100">
                {t("guests.orphans_body")}
              </p>
              <ul className="mt-3 text-sm text-ink-700 dark:text-paper-100">
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
                  className="text-sm text-ink-600 underline underline-offset-2 hover:text-ink-900 dark:text-umber-200 dark:hover:text-paper-50"
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

/**
 * Flat search-results list, shown instead of the grouped household view
 * whenever the search input has content. We render up to 200 hits — past
 * that, the user should refine the query rather than scroll. Each row
 * jumps straight into the edit drawer.
 */
function SearchResults({
  loading,
  guests,
  onEditGuest,
  onPrintPlaceCard,
}: {
  loading: boolean;
  guests: Guest[];
  onEditGuest: (g: Guest) => void;
  onPrintPlaceCard: (g: Guest) => void | Promise<void>;
}) {
  const { t } = useT();
  if (loading && guests.length === 0) {
    return <p className="card text-sm text-ink-500 dark:text-umber-300">{t("common.loading")}</p>;
  }
  if (guests.length === 0) {
    return (
      <p className="card text-sm text-ink-500 dark:text-umber-300">{t("guests.search_empty")}</p>
    );
  }
  return (
    <ul className="card divide-y divide-paper-200 p-0 dark:divide-umber-700">
      {guests.map((g) => (
        <li key={g.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-sm text-ink-900 dark:text-paper-50">
              <PartnerRoleIcon role={g.partner_role} />
              <KindIcon kind={g.kind} />
              <span className="truncate">{g.full_name}</span>
              <MealIcons meal={g.meal_choice} dietary={g.dietary} />
            </p>
            <p className="text-xs text-ink-500 dark:text-umber-300">
              {t(`guests.group_${g.group_tag}`)}
              {g.email ? ` · ${g.email}` : ""}
            </p>
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
              className="btn-ghost btn-sm"
              onClick={() => void onPrintPlaceCard(g)}
              aria-label={t("guests.print_place_card")}
              title={t("guests.print_place_card")}
            >
              <Printer size={14} />
            </button>
          </div>
        </li>
      ))}
    </ul>
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
  onRenameHousehold,
  onCycleInviteState,
  onPrintPlaceCard,
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
  onRenameHousehold: (id: number, label: string) => Promise<void>;
  onCycleInviteState: (g: Guest) => void;
  onPrintPlaceCard: (g: Guest) => void | Promise<void>;
}) {
  const { t } = useT();
  const invitedCount = members.filter((g) => g.invited_at != null).length;
  const deliveredCount = members.filter((g) => g.invitation_delivered_at != null).length;
  const isHosts = household.is_couple_household;
  return (
    <div className="card overflow-hidden p-0">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-paper-200 bg-paper-100/60 px-4 py-3 dark:border-umber-700 dark:bg-umber-700/60">
        {/* Single-line metadata: label · slug · code · invited · delivered.
            Keeps the same column positions across cards so the eye scans
            the same fields in the same place. The couple's own household
            (bride + groom) renders just the label — slug / code / invited
            columns are hidden because the hosts don't check themselves in. */}
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-ink-600 dark:text-umber-200">
          <HouseholdLabelEditor
            household={household}
            count={members.length}
            onSave={(label) => onRenameHousehold(household.id, label)}
          />
          {!isHosts && (
            <>
              {coupleSlug && (
                <>
                  <span aria-hidden>·</span>
                  <span className="font-mono uppercase">{coupleSlug}</span>
                </>
              )}
              <span aria-hidden>·</span>
              <span className="font-mono text-base text-ink-900 tracking-[0.3em] dark:text-paper-50">
                {household.code}
              </span>
              {members.length > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span
                    className={
                      invitedCount === members.length
                        ? "text-ink-700 dark:text-paper-100"
                        : invitedCount > 0
                          ? "text-ink-600 dark:text-umber-200"
                          : "text-ink-400 dark:text-umber-300"
                    }
                    title={t("guests.invited_progress_help")}
                  >
                    {invitedCount}/{members.length} {t("guests.invited_short")}
                  </span>
                  {deliveredCount > 0 && (
                    <>
                      <span aria-hidden>·</span>
                      <span
                        className="text-sage-700 dark:text-sage-300"
                        title={t("guests.delivered_progress_help")}
                      >
                        {deliveredCount}/{members.length} {t("guests.delivered_short")}
                      </span>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {!isHosts && (
            <>
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
            </>
          )}
          {members.length === 0 && !isHosts && (
            <button
              type="button"
              className="btn-ghost btn-sm text-blush-700 dark:text-blush-300"
              onClick={onDeleteHousehold}
              title={t("guests.household_remove")}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </header>

      <ul className="divide-y divide-paper-200 dark:divide-umber-700">
        {members.map((g) => (
          <li key={g.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <InviteChip guest={g} onCycle={() => onCycleInviteState(g)} />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-sm text-ink-900 dark:text-paper-50">
                  <PartnerRoleIcon role={g.partner_role} />
                  <KindIcon kind={g.kind} />
                  <span className="truncate">{g.full_name}</span>
                  <MealIcons meal={g.meal_choice} dietary={g.dietary} />
                </p>
                <p className="text-xs text-ink-500 dark:text-umber-300">
                  {t(`guests.group_${g.group_tag}`)}
                </p>
              </div>
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
                className="btn-ghost btn-sm"
                onClick={() => void onPrintPlaceCard(g)}
                aria-label={t("guests.print_place_card")}
                title={t("guests.print_place_card")}
              >
                <Printer size={14} />
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm text-blush-700 dark:text-blush-300"
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
function CheckinPill({ couple }: { couple: Couple; onSaved: (next: Couple) => void }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  // The slug is read-only — it's pre-printed on invites + the public RSVP
  // page, so changing it after the fact would orphan everything in
  // circulation. The pre-existing PATCH /api/couples/slug endpoint stays
  // for back-compat / future "rename with full confirm" UI.

  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-paper-300 bg-paper-100/40 dark:border-umber-700 dark:bg-umber-700/60">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? t("guests.checkin_pill_hide") : t("guests.checkin_pill_show")}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-paper-100 dark:hover:bg-umber-700"
      >
        <span className="text-xs font-medium uppercase tracking-wider text-ink-500 dark:text-umber-300">
          {t("guests.checkin_pill_lead")}
        </span>
        <span className="font-mono text-base uppercase tracking-[0.3em] text-ink-900 dark:text-paper-50">
          {couple.slug ?? "—"}
        </span>
        <span className="text-sm text-ink-600 hidden sm:inline dark:text-umber-200">
          {t("guests.checkin_pill_suffix")}
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className={
            expanded
              ? "ml-auto rotate-180 text-ink-700 transition-transform dark:text-paper-100"
              : "ml-auto text-ink-500 transition-transform dark:text-umber-300"
          }
        />
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-paper-300 px-4 py-4 dark:border-umber-700">
          <div>
            <p className="text-sm text-ink-700 dark:text-paper-100">
              {t("guests.checkin_pill_url_hint")}
            </p>
            <p className="mt-2 text-xs text-ink-500 sm:hidden dark:text-umber-300">
              {t("guests.checkin_pill_suffix")}
            </p>
          </div>

          <div className="rounded-xl border border-paper-200 bg-paper-50 px-3 py-3 dark:border-umber-700 dark:bg-umber-800">
            <p className="text-xs font-medium uppercase tracking-wider text-ink-500 dark:text-umber-300">
              {t("guests.couple_slug_title")}
            </p>
            <p className="mt-1 text-xs text-ink-600 dark:text-umber-200">
              {t("guests.couple_slug_help_locked")}
            </p>
            <div className="mt-3 font-mono text-2xl uppercase tracking-[0.3em] text-ink-900 dark:text-paper-50">
              {couple.slug ?? "—"}
            </div>
          </div>

          <p className="text-xs text-ink-500 dark:text-umber-300">
            {t("guests.household_section_help")}
          </p>
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
  // "Yes" pops in emerald — couples scan a household and want the attending
  // guests to be the loudest signal. Other states keep their existing tones.
  const cls =
    status === "yes"
      ? "inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-400/15 dark:text-emerald-300"
      : status === "no"
        ? "badge-ink"
        : status === "maybe"
          ? "badge-paper"
          : "badge-paper border border-dashed border-paper-300 dark:border-umber-700";
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

type InviteState = "not_invited" | "invited" | "delivered";

function inviteStateOf(g: Guest): InviteState {
  if (g.invitation_delivered_at != null) return "delivered";
  if (g.invited_at != null) return "invited";
  return "not_invited";
}

function nextInviteState(s: InviteState): InviteState {
  return s === "not_invited" ? "invited" : s === "invited" ? "delivered" : "not_invited";
}

/**
 * Three-state cyclic chip: not-invited → invited → delivered → repeat. Each
 * state has its own glyph + tone so the row scans at a glance:
 *   – empty outline (paper) for "not invited yet"
 *   – ink-filled single check for "invited / link sent"
 *   – sage-filled double check for "invitation physically handed over"
 */
function InviteChip({ guest, onCycle }: { guest: Guest; onCycle: () => void }) {
  const { t } = useT();
  const state = inviteStateOf(guest);
  const next = nextInviteState(state);
  const label =
    state === "delivered"
      ? t("guests.invite_state_delivered")
      : state === "invited"
        ? t("guests.invite_state_invited")
        : t("guests.invite_state_not_invited");
  const nextHint =
    next === "delivered"
      ? t("guests.invite_state_cycle_to_delivered")
      : next === "invited"
        ? t("guests.invite_state_cycle_to_invited")
        : t("guests.invite_state_cycle_to_clear");
  const cls =
    state === "delivered"
      ? "border-sage-300 bg-sage-100 text-sage-700 hover:bg-sage-200 dark:border-sage-400/40 dark:bg-sage-400/15 dark:text-sage-300"
      : state === "invited"
        ? "border-ink-800 bg-ink-800 text-paper-50 hover:bg-ink-900 dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900 dark:hover:bg-paper-100"
        : "border-paper-300 bg-paper-50 text-ink-400 hover:border-ink-300 hover:text-ink-600 dark:border-umber-700 dark:bg-umber-800 dark:text-umber-300 dark:hover:border-umber-600 dark:hover:text-umber-200";
  return (
    <button
      type="button"
      onClick={onCycle}
      title={`${label} — ${nextHint}`}
      aria-label={`${label}. ${nextHint}`}
      aria-pressed={state !== "not_invited"}
      className={`inline-flex h-6 w-9 shrink-0 items-center justify-center rounded-full border text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-ink-500 focus:ring-offset-1 ${cls}`}
    >
      {state === "delivered" ? (
        <CheckCheck size={14} strokeWidth={2.5} aria-hidden="true" />
      ) : state === "invited" ? (
        <Check size={14} strokeWidth={2.5} aria-hidden="true" />
      ) : (
        <span aria-hidden="true" className="block h-1.5 w-1.5 rounded-full bg-current opacity-50" />
      )}
    </button>
  );
}

/**
 * Inline-editable household label. Click to enter edit mode; blur or Enter
 * commits via the parent-supplied save callback. Escape reverts. The (N)
 * member count stays visible across modes so the row reads consistently.
 */
function HouseholdLabelEditor({
  household,
  count,
  onSave,
}: {
  household: Household;
  count: number;
  onSave: (label: string) => Promise<void>;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(household.label);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (!trimmed || trimmed === household.label) {
      setDraft(household.label);
      return;
    }
    void onSave(trimmed);
  }

  if (editing) {
    return (
      <div className="flex items-baseline gap-2">
        <input
          autoFocus
          className="input flex-1 text-sm font-medium"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              setDraft(household.label);
              setEditing(false);
            }
          }}
          maxLength={200}
        />
        <span className="text-sm font-normal text-ink-500 dark:text-umber-300">({count})</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(household.label);
        setEditing(true);
      }}
      aria-label={t("guests.household_label")}
      className="inline-flex max-w-full items-baseline gap-1.5 truncate rounded text-left text-base font-semibold text-ink-900 hover:text-ink-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-400 dark:text-paper-50 dark:hover:text-paper-100 dark:focus-visible:outline-umber-600"
    >
      <span className="truncate">{household.label}</span>
      <span className="text-sm font-normal text-ink-500 dark:text-umber-300">({count})</span>
    </button>
  );
}

/**
 * Tiny inline icon next to a member's name in the household card. Adults get
 * nothing (default), babies get the swaddled-baby icon, children get a
 * cookie — recognizable kid affordance and the only lucide icon that reads
 * unambiguously as "child" without crossing into condescending territory.
 */
function KindIcon({ kind }: { kind: GuestKind }) {
  const { t } = useT();
  if (kind === "adult") return null;
  const Icon = kind === "baby" ? Baby : Cookie;
  const label = t(`guests.kind_${kind}`);
  return (
    <Icon size={14} aria-label={label} className="shrink-0 text-blush-700 dark:text-blush-300" />
  );
}

/** Inline Crown next to the bride / groom rows so the couple can spot
 *  themselves at a glance. Title doubles as tooltip + a11y label. Renders
 *  nothing for regular guests. */
function PartnerRoleIcon({ role }: { role: "bride" | "groom" | null }) {
  const { t } = useT();
  if (!role) return null;
  const label = t(`guests.partner_role_${role}`);
  return (
    <span title={label} className="inline-flex shrink-0">
      <Crown size={14} aria-label={label} className="text-blush-600 dark:text-blush-300" />
    </span>
  );
}

/**
 * Inline icons summarising dietary attributes next to the guest's name:
 * Leaf for vegetarian / vegan, Fish for the fish meal, Wheat when the
 * guest left free-text dietary notes (allergies). The tooltip shows the
 * full free-text so couples can scan a row at a glance.
 */
/**
 * Decode the round-tripped dietary tags the RSVP form encodes into the
 * free-text `dietary` column (e.g. "laktóz-érzékeny, gluténmentes") so the
 * admin list can show the right icon per allergen — Milk for lactose,
 * Wheat for gluten, Nut for nut allergies. Any remaining free text is
 * surfaced via a fallback Wheat icon with the full string as a tooltip.
 */
// `[^,;\s]*` after the keyword so we devour the whole compound word — JS
// `\w` and `\b` don't include accented chars, so the old `[\w-]*\b/i` only
// matched the ASCII prefix and left `"-érzékeny"` (or `"mentes"`) behind
// as residue, which then triggered the fallback Wheat icon as "unknown
// free-text dietary". Stop only at separators so we never bleed into the
// next tag.
type DietaryTag = "lactose" | "gluten" | "nut";
const DIETARY_TAG_KEYS: DietaryTag[] = ["lactose", "gluten", "nut"];

const DIETARY_DETECTORS: { kind: DietaryTag; re: RegExp }[] = [
  { kind: "lactose", re: /(?:laktóz|lactose)[^,;\s]*/i },
  { kind: "gluten", re: /(?:glutén|gluten)[^,;\s]*/i },
  { kind: "nut", re: /(?:mogyoró|peanut|nut[- ]?aller)[^,;\s]*/i },
];

// Stored tokens — must match what HouseholdRsvpForm writes so chips round-trip
// no matter which side last edited the row.
const DIETARY_TOKEN: Record<DietaryTag, string> = {
  lactose: "laktóz-érzékeny",
  gluten: "gluténmentes",
  nut: "mogyoró-allergia",
};

function buildDietary(tags: Set<DietaryTag>, free: string): string | null {
  const parts: string[] = [];
  for (const tag of DIETARY_TAG_KEYS) {
    if (tags.has(tag)) parts.push(DIETARY_TOKEN[tag]);
  }
  const f = free.trim();
  if (f) parts.push(f);
  const joined = parts.join(", ");
  return joined || null;
}

// Song request multi-row encoding. Each non-empty line is one song; if a line
// contains a URL we treat it as an attached link and the rest as the title.
// Backwards-compatible with the prior single-line free-text format.
const SONG_URL_RE = /\bhttps?:\/\/\S+/i;

interface SongEntry {
  title: string;
  url: string;
}

function parseSongRequests(s: string | null): SongEntry[] {
  if (!s) return [];
  return s
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(SONG_URL_RE);
      if (!m) return { title: line, url: "" };
      const url = m[0];
      const title = line.replace(SONG_URL_RE, "").trim();
      return { title: title || url, url };
    });
}

function serializeSongRequests(entries: SongEntry[]): string | null {
  const lines: string[] = [];
  for (const e of entries) {
    const title = e.title.trim();
    const url = e.url.trim();
    if (!title && !url) continue;
    if (title && url) lines.push(`${title} ${url}`);
    else lines.push(title || url);
  }
  return lines.length ? lines.join("\n") : null;
}

function parseDietaryTags(dietary: string | null): {
  tags: Set<"lactose" | "gluten" | "nut">;
  remainder: string;
} {
  const tags = new Set<"lactose" | "gluten" | "nut">();
  let rest = (dietary ?? "").trim();
  if (!rest) return { tags, remainder: "" };
  for (const det of DIETARY_DETECTORS) {
    if (det.re.test(rest)) {
      tags.add(det.kind);
      rest = rest.replace(det.re, "");
    }
  }
  rest = rest
    .replace(/\s*[,;]\s*[,;]+/g, ", ")
    .replace(/^[\s,;]+|[\s,;]+$/g, "")
    .trim();
  return { tags, remainder: rest };
}

function MealIcons({ meal, dietary }: { meal: MealChoice | null; dietary: string | null }) {
  const { t } = useT();
  const veg = meal === "vegetarian" || meal === "vegan";
  const fish = meal === "fish";
  const { tags, remainder } = parseDietaryTags(dietary);
  if (!veg && !fish && tags.size === 0 && !remainder) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-blush-700 dark:text-blush-300">
      {veg && (
        <Leaf
          size={14}
          aria-label={t(meal === "vegan" ? "guests.meal_vegan" : "guests.meal_vegetarian")}
        />
      )}
      {fish && <Fish size={14} aria-label={t("guests.meal_fish")} />}
      {tags.has("lactose") && (
        <span title={t("rsvp.tag_lactose")} className="inline-flex">
          <Milk size={14} aria-label={t("rsvp.tag_lactose")} />
        </span>
      )}
      {tags.has("gluten") && (
        <span title={t("rsvp.tag_gluten")} className="inline-flex">
          <Wheat size={14} aria-label={t("rsvp.tag_gluten")} />
        </span>
      )}
      {tags.has("nut") && (
        <span title={t("rsvp.tag_nut")} className="inline-flex">
          <Nut size={14} aria-label={t("rsvp.tag_nut")} />
        </span>
      )}
      {remainder && (
        <span title={remainder} className="inline-flex">
          <Wheat size={14} aria-label={t("guests.allergies")} />
        </span>
      )}
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
      kind: "adult",
      rsvp_status: "pending",
      meal_choice: null,
      dietary: null,
      accommodation_needed: false,
      song_request: null,
      notes: null,
    },
  );
  // Dietary is stored as a single free-text column server-side; locally we
  // split it into chip toggles + a free-text remainder so the UI can offer
  // icon chips without losing notes the user typed by hand.
  const initialDietary = useMemo(() => parseDietaryTags(guest?.dietary ?? null), [guest?.dietary]);
  const [dietaryTags, setDietaryTags] = useState<Set<DietaryTag>>(initialDietary.tags);
  const [dietaryFree, setDietaryFree] = useState<string>(initialDietary.remainder);
  // Song requests are also a single text column; we render a repeating row UI
  // and re-serialise on submit so the field still round-trips through the
  // 500-char string limit the backend enforces.
  const [songs, setSongs] = useState<SongEntry[]>(() =>
    parseSongRequests(guest?.song_request ?? null),
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
  const toast = useToast();

  function buildBody(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      ...form,
      dietary: buildDietary(dietaryTags, dietaryFree),
      song_request: serializeSongRequests(songs),
    };
    if (householdMode === "existing" && householdId) {
      body.household_id = householdId;
    } else if (householdMode === "new") {
      body.household_id = null;
      const label = newHouseholdLabel.trim();
      if (label) body.new_household_label = label;
    }
    return body;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.full_name?.trim()) {
      setError(t("guests.full_name"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body = buildBody();
      if (guest) await guestApi.update(guest.id, body);
      else await guestApi.create(body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error_generic"));
      setSubmitting(false);
    }
  }

  /**
   * Auto-save on close — clicking the X or the backdrop persists whatever the
   * user typed instead of dropping it on the floor. For new guests we still
   * need a non-empty name (server requires it); if it's missing we just
   * close. Errors are surfaced via toast since the modal will already be gone.
   */
  async function autoSaveAndClose() {
    if (submitting) return;
    const name = (form.full_name ?? "").trim();
    // Existing guest with name cleared → don't save (would fail validation),
    // but still close. New guest with no name → just close.
    if (!name) {
      onClose();
      return;
    }
    try {
      const body = buildBody();
      if (guest) await guestApi.update(guest.id, body);
      else await guestApi.create(body);
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        // Backdrop click only — let clicks inside the form bubble normally.
        if (e.target === e.currentTarget) void autoSaveAndClose();
      }}
    >
      <form
        className="flex w-full max-w-2xl max-h-[85vh] flex-col overflow-hidden rounded-2xl bg-paper-50 shadow-pop dark:bg-umber-800"
        onSubmit={onSubmit}
      >
        <div className="flex items-center justify-between border-b border-paper-200 px-6 py-4 dark:border-umber-700">
          <h2 className="text-base font-semibold text-ink-900 dark:text-paper-50">
            {guest ? t("guests.edit") : t("guests.add")}
          </h2>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => void autoSaveAndClose()}
            aria-label={t("common.cancel")}
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Name reads as the page's headline — a borderless serif input that
              looks like display text but stays editable, with a faint
              underline on focus so the affordance is still legible. */}
          <input
            type="text"
            value={form.full_name ?? ""}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            placeholder={t("guests.full_name")}
            aria-label={t("guests.full_name")}
            className="mb-5 w-full border-0 border-b border-transparent bg-transparent px-0 pb-1 pt-0 font-serif text-3xl font-medium text-ink-900 placeholder:text-ink-300 focus:border-ink-300 focus:outline-none focus:ring-0 dark:text-paper-50 dark:placeholder:text-umber-500 dark:focus:border-umber-500"
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
            <label className="field-label">{t("guests.kind_label")}</label>
            <p className="mb-2 text-xs text-ink-500 dark:text-umber-300">{t("guests.kind_help")}</p>
            <div className="grid grid-cols-3 gap-2">
              {(["adult", "child", "baby"] as GuestKind[]).map((k) => (
                <SegmentButton
                  key={k}
                  active={(form.kind ?? "adult") === k}
                  onClick={() => setForm({ ...form, kind: k })}
                  icon={<KindIcon kind={k} />}
                  label={t(`guests.kind_${k}`)}
                />
              ))}
            </div>
          </div>

          <div className="mb-3 rounded-2xl border border-paper-200 bg-paper-100/40 p-3 dark:border-umber-700 dark:bg-umber-700/60">
            <label className="field-label">{t("guests.household_label")}</label>
            <p className="mb-2 text-xs text-ink-500 dark:text-umber-300">
              {t("guests.household_assign_help")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <SegmentButton
                active={householdMode === "existing"}
                onClick={() => setHouseholdMode("existing")}
                disabled={households.length === 0}
                label={t("guests.household_existing")}
              />
              <SegmentButton
                active={householdMode === "new"}
                onClick={() => setHouseholdMode("new")}
                label={t("guests.household_new")}
              />
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
            <div className="grid grid-cols-4 gap-2">
              {RSVPS.map((s) => (
                <SegmentButton
                  key={s}
                  active={(form.rsvp_status ?? "pending") === s}
                  onClick={() => setForm({ ...form, rsvp_status: s })}
                  icon={<RsvpGlyph status={s} />}
                  label={t(`guests.rsvp_${s}`)}
                  compact
                />
              ))}
            </div>
          </div>

          <div className="mb-3">
            <label className="field-label">{t("guests.meal")}</label>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {MEALS.map((m) => (
                <SegmentButton
                  key={m}
                  active={form.meal_choice === m}
                  // Re-clicking the active option clears it so the user can
                  // return to "no preference" without a dedicated null button.
                  onClick={() =>
                    setForm({ ...form, meal_choice: form.meal_choice === m ? null : m })
                  }
                  icon={<MealIcon meal={m} />}
                  label={t(`guests.meal_${m}`)}
                  compact
                />
              ))}
            </div>
          </div>

          <div className="mb-3">
            <label className="field-label">{t("guests.allergies")}</label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              <DietaryChip
                on={dietaryTags.has("lactose")}
                onClick={() => toggleSetMember(setDietaryTags, "lactose")}
                icon={<Milk size={14} aria-hidden />}
                label={t("rsvp.tag_lactose")}
              />
              <DietaryChip
                on={dietaryTags.has("gluten")}
                onClick={() => toggleSetMember(setDietaryTags, "gluten")}
                icon={<Wheat size={14} aria-hidden />}
                label={t("rsvp.tag_gluten")}
              />
              <DietaryChip
                on={dietaryTags.has("nut")}
                onClick={() => toggleSetMember(setDietaryTags, "nut")}
                icon={<Nut size={14} aria-hidden />}
                label={t("rsvp.tag_nut")}
              />
            </div>
            <input
              className="input"
              type="text"
              value={dietaryFree}
              onChange={(e) => setDietaryFree(e.target.value)}
              placeholder={t("guests.allergies_placeholder")}
            />
          </div>

          <label className="mb-3 flex items-center gap-2 text-sm text-ink-700 dark:text-paper-100">
            <input
              type="checkbox"
              checked={Boolean(form.accommodation_needed)}
              onChange={(e) => setForm({ ...form, accommodation_needed: e.target.checked })}
            />
            {t("guests.accommodation")}
          </label>

          <div className="mb-3">
            <label className="field-label">{t("guests.song_request")}</label>
            <SongRequestList entries={songs} onChange={setSongs} />
          </div>

          <Field
            label={t("guests.notes")}
            value={form.notes ?? ""}
            onChange={(v) => setForm({ ...form, notes: v || null })}
            textarea
          />

          {error && <p className="field-error">{error}</p>}
        </div>
        <div className="flex gap-2 border-t border-paper-200 px-6 py-4 dark:border-umber-700">
          <button
            type="button"
            className="btn-ghost flex-1"
            onClick={() => void autoSaveAndClose()}
          >
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

// Single button in a segmented control. Shared shape for kind / household /
// rsvp / meal so the drawer reads consistently — only the icon + label
// change. `compact` switches the padding & font for narrow chips like the
// 4-up RSVP row.
function SegmentButton({
  active,
  onClick,
  icon,
  label,
  disabled,
  compact,
}: {
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  label: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const pad = compact ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm";
  const base = `flex items-center justify-center gap-1.5 rounded-xl ${pad} transition-colors`;
  const tone = active
    ? "border-2 border-ink-700 bg-ink-700 font-medium text-paper-100 dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900"
    : "border border-paper-300 bg-paper-50 text-ink-700 hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`${base} ${tone} disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function RsvpGlyph({ status }: { status: RsvpStatus }) {
  // Same glyph language as RsvpBadge, sized to sit next to the label text.
  const ch = status === "yes" ? "✓" : status === "no" ? "✗" : status === "maybe" ? "?" : "⌛";
  return (
    <span aria-hidden className="text-sm font-semibold leading-none">
      {ch}
    </span>
  );
}

function MealIcon({ meal }: { meal: MealChoice }) {
  const size = 16;
  switch (meal) {
    case "meat":
      return <Beef size={size} aria-hidden />;
    case "fish":
      return <Fish size={size} aria-hidden />;
    case "vegetarian":
      return <Leaf size={size} aria-hidden />;
    case "vegan":
      return <Sprout size={size} aria-hidden />;
    case "child":
      return <Cookie size={size} aria-hidden />;
    case "none":
      return <Ban size={size} aria-hidden />;
  }
}

// Pill-shaped allergen chip. Mirrors the chip in HouseholdRsvpForm so admin-
// side and guest-side selectors look identical.
function DietaryChip({
  on,
  onClick,
  icon,
  label,
}: {
  on: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={onClick}
      className={
        on
          ? "inline-flex items-center gap-1.5 rounded-full border-2 border-ink-700 bg-ink-700 px-3 py-1 text-xs font-medium text-paper-100 transition-colors dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900"
          : "inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-3 py-1 text-xs text-ink-700 transition-colors hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600"
      }
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// Idiomatic helper: toggle membership in a Set held in a React useState.
function toggleSetMember<T>(setter: (updater: (prev: Set<T>) => Set<T>) => void, value: T) {
  setter((prev) => {
    const next = new Set(prev);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  });
}

// Song-request editor: one row per song with an optional attached URL. The
// link input is hidden behind a chip so the default state stays tidy; clicking
// the chip reveals the URL field for that row only.
interface SongRow extends SongEntry {
  /** Stable React key. Local-only; stripped before bubbling up. */
  ui_key: string;
}

function makeSongKey(): string {
  return `s_${Math.random().toString(36).slice(2, 9)}`;
}

function SongRequestList({
  entries,
  onChange,
}: {
  entries: SongEntry[];
  onChange: (next: SongEntry[]) => void;
}) {
  const { t } = useT();
  // Owns the row array with stable ids. We seed once from `entries` on mount;
  // bubbling up via onChange is what keeps the parent state in sync. We
  // intentionally don't re-seed from `entries` after mount — the drawer never
  // resets these rows from outside, and re-seeding would clobber typing.
  const [rows, setRows] = useState<SongRow[]>(() =>
    entries.length === 0
      ? [{ ui_key: makeSongKey(), title: "", url: "" }]
      : entries.map((e) => ({ ui_key: makeSongKey(), ...e })),
  );

  function bubble(next: SongRow[]) {
    setRows(next);
    onChange(next.map(({ ui_key: _, ...rest }) => rest));
  }
  function update(idx: number, patch: Partial<SongEntry>) {
    bubble(rows.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }
  function remove(idx: number) {
    const next = rows.filter((_, i) => i !== idx);
    bubble(next.length === 0 ? [{ ui_key: makeSongKey(), title: "", url: "" }] : next);
  }
  function add() {
    bubble([...rows, { ui_key: makeSongKey(), title: "", url: "" }]);
  }

  return (
    <div className="space-y-2">
      {rows.map((row, i) => {
        const hasLink = row.url.length > 0;
        return (
          <div
            key={row.ui_key}
            className="rounded-xl border border-paper-200 bg-paper-50 p-2 dark:border-umber-700 dark:bg-umber-800"
          >
            <div className="flex items-center gap-2">
              <Music size={14} aria-hidden className="shrink-0 text-ink-400 dark:text-umber-300" />
              <input
                className="input flex-1 border-0 bg-transparent px-1 py-1 focus:ring-0"
                type="text"
                value={row.title}
                onChange={(e) => update(i, { title: e.target.value })}
                placeholder={t("guests.song_title_placeholder")}
              />
              {!hasLink && (
                <button
                  type="button"
                  onClick={() => update(i, { url: "https://" })}
                  className="inline-flex items-center gap-1 rounded-full border border-paper-300 px-2 py-1 text-xs text-ink-600 hover:border-ink-400 dark:border-umber-700 dark:text-paper-100 dark:hover:border-umber-600"
                  aria-label={t("guests.song_add_link")}
                  title={t("guests.song_add_link")}
                >
                  <Link2 size={12} aria-hidden />
                </button>
              )}
              {rows.length > 1 || row.title || row.url ? (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="inline-flex shrink-0 items-center justify-center rounded-full p-1 text-ink-400 hover:bg-paper-200 hover:text-ink-700 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
                  aria-label={t("guests.song_remove")}
                  title={t("guests.song_remove")}
                >
                  <X size={14} aria-hidden />
                </button>
              ) : null}
            </div>
            {hasLink && (
              <div className="mt-1.5 flex items-center gap-2 pl-6">
                <Link2
                  size={12}
                  aria-hidden
                  className="shrink-0 text-ink-400 dark:text-umber-300"
                />
                <input
                  className="input flex-1 border-0 bg-transparent px-1 py-1 font-mono text-xs focus:ring-0"
                  type="url"
                  value={row.url}
                  onChange={(e) => update(i, { url: e.target.value })}
                  placeholder="https://"
                />
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-paper-300 px-3 py-1 text-xs text-ink-500 hover:border-ink-400 hover:text-ink-700 dark:border-umber-700 dark:text-umber-300 dark:hover:border-umber-600 dark:hover:text-paper-100"
      >
        <Plus size={12} aria-hidden /> {t("guests.song_add")}
      </button>
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
        <p className="text-ink-700 dark:text-paper-100">
          <strong>{t("guests.import_imported_label")}:</strong> {result.created_count}
          {" · "}
          <strong>{t("guests.import_errors_label")}:</strong> {result.errors.length}
        </p>
        {result.errors.length > 0 && (
          <>
            <p className="text-ink-700 dark:text-paper-100">{t("guests.import_errors_body")}</p>
            <ul className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-paper-200 bg-paper-100/40 p-3 text-sm dark:border-umber-700 dark:bg-umber-700/60">
              {result.errors.map((err) => (
                <li key={`${err.row}-${err.reason}`} className="text-ink-700 dark:text-paper-100">
                  <span className="font-mono text-ink-500 dark:text-umber-300">
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
        <p className="text-ink-700 dark:text-paper-100">{t("guests.copy_failed_body")}</p>
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

// Page-header stat block: a big tabular-nums number stacked over a small
// uppercase caption. `primary` gives the headline metric a touch more weight
// (heavier number colour) so guests-count still reads as the lead figure.
function GuestStat({
  value,
  label,
  tone = "secondary",
}: {
  value: number;
  label: string;
  tone?: "primary" | "secondary";
}) {
  const numClass =
    tone === "primary"
      ? "text-3xl font-semibold tabular-nums text-ink-900 dark:text-paper-50"
      : "text-3xl font-semibold tabular-nums text-ink-700 dark:text-paper-100";
  return (
    <div className="flex flex-col items-start leading-none">
      <dd className={numClass}>{value}</dd>
      <dt className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-400 dark:text-umber-300">
        {label}
      </dt>
    </div>
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
