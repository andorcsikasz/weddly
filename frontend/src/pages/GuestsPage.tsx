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
  Check,
  CheckCheck,
  ChevronDown,
  Cookie,
  Fish,
  Leaf,
  Milk,
  Nut,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  UserPlus,
  Wheat,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-3xl font-semibold tabular-nums text-ink-900">
                {guests.length}
              </span>
              <span className="text-sm text-ink-500">{t("guests.total_summary_unit")}</span>
              <span aria-hidden className="text-ink-300">
                ·
              </span>
              <span className="text-sm text-ink-600">
                {t("guests.total_summary_households", { n: households.length })}
              </span>
              <span aria-hidden className="text-ink-300">
                ·
              </span>
              <span className="text-sm text-ink-600">
                {t("guests.total_summary_invited", {
                  n: guests.filter((g) => g.invited_at != null).length,
                })}
              </span>
            </div>
          ) : (
            <p className="mt-1 text-sm text-ink-500">{guests.length}</p>
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
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
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
          <p className="mt-1 text-sm text-ink-600">{t("guests.empty_body")}</p>
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
            <p className="text-center text-xs text-ink-500">{t("guests.search_load_more")}</p>
          )}

          {orphanGuests.length > 0 && (
            <div className="card border-blush-200 bg-blush-50/40">
              <h3 className="text-base font-semibold text-ink-900">{t("guests.orphans_title")}</h3>
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
    return <p className="card text-sm text-ink-500">{t("common.loading")}</p>;
  }
  if (guests.length === 0) {
    return <p className="card text-sm text-ink-500">{t("guests.search_empty")}</p>;
  }
  return (
    <ul className="card divide-y divide-paper-200 p-0">
      {guests.map((g) => (
        <li key={g.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-sm text-ink-900">
              <KindIcon kind={g.kind} />
              <span className="truncate">{g.full_name}</span>
              <MealIcons meal={g.meal_choice} dietary={g.dietary} />
            </p>
            <p className="text-xs text-ink-500">
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
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-paper-200 bg-paper-100/60 px-4 py-3">
        {/* Single-line metadata: label · slug · code · invited · delivered.
            Keeps the same column positions across cards so the eye scans
            the same fields in the same place. The couple's own household
            (the hosts) skips the slug / code / invited columns — they
            don't check themselves in, so those fields are noise. */}
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-ink-600">
          <HouseholdLabelEditor
            household={household}
            count={members.length}
            onSave={(label) => onRenameHousehold(household.id, label)}
          />
          {isHosts ? (
            <span
              className="inline-flex items-center rounded-full border border-blush-200 bg-blush-50 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-blush-700"
              title={t("guests.household_hosts_help")}
            >
              {t("guests.household_hosts_badge")}
            </span>
          ) : (
            <>
              {coupleSlug && (
                <>
                  <span aria-hidden>·</span>
                  <span className="font-mono uppercase">{coupleSlug}</span>
                </>
              )}
              <span aria-hidden>·</span>
              <span className="font-mono text-base text-ink-900 tracking-[0.3em]">
                {household.code}
              </span>
              {members.length > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span
                    className={
                      invitedCount === members.length
                        ? "text-ink-700"
                        : invitedCount > 0
                          ? "text-ink-600"
                          : "text-ink-400"
                    }
                    title={t("guests.invited_progress_help")}
                  >
                    {invitedCount}/{members.length} {t("guests.invited_short")}
                  </span>
                  {deliveredCount > 0 && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="text-sage-700" title={t("guests.delivered_progress_help")}>
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
            <div className="flex min-w-0 items-center gap-3">
              <InviteChip guest={g} onCycle={() => onCycleInviteState(g)} />
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-sm text-ink-900">
                  <KindIcon kind={g.kind} />
                  <span className="truncate">{g.full_name}</span>
                  <MealIcons meal={g.meal_choice} dietary={g.dietary} />
                </p>
                <p className="text-xs text-ink-500">{t(`guests.group_${g.group_tag}`)}</p>
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
function CheckinPill({ couple }: { couple: Couple; onSaved: (next: Couple) => void }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  // The slug is read-only — it's pre-printed on invites + the public RSVP
  // page, so changing it after the fact would orphan everything in
  // circulation. The pre-existing PATCH /api/couples/slug endpoint stays
  // for back-compat / future "rename with full confirm" UI.

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
            <p className="mt-1 text-xs text-ink-600">{t("guests.couple_slug_help_locked")}</p>
            <div className="mt-3 font-mono text-2xl uppercase tracking-[0.3em] text-ink-900">
              {couple.slug ?? "—"}
            </div>
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
  // "Yes" pops in emerald — couples scan a household and want the attending
  // guests to be the loudest signal. Other states keep their existing tones.
  const cls =
    status === "yes"
      ? "inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"
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
      ? "border-sage-300 bg-sage-100 text-sage-700 hover:bg-sage-200"
      : state === "invited"
        ? "border-ink-800 bg-ink-800 text-paper-50 hover:bg-ink-900"
        : "border-paper-300 bg-paper-50 text-ink-400 hover:border-ink-300 hover:text-ink-600";
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
        <span className="text-sm font-normal text-ink-500">({count})</span>
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
      className="inline-flex max-w-full items-baseline gap-1.5 truncate rounded text-left text-base font-semibold text-ink-900 hover:text-ink-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-400"
    >
      <span className="truncate">{household.label}</span>
      <span className="text-sm font-normal text-ink-500">({count})</span>
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
  return <Icon size={14} aria-label={label} className="shrink-0 text-blush-700" />;
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
const DIETARY_DETECTORS: { kind: "lactose" | "gluten" | "nut"; re: RegExp }[] = [
  { kind: "lactose", re: /(?:laktóz|lactose)[^,;\s]*/i },
  { kind: "gluten", re: /(?:glutén|gluten)[^,;\s]*/i },
  { kind: "nut", re: /(?:mogyoró|peanut|nut[- ]?aller)[^,;\s]*/i },
];

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
    <span className="inline-flex shrink-0 items-center gap-1 text-blush-700">
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
    const body: Record<string, unknown> = { ...form };
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
        className="flex w-full max-w-2xl max-h-[85vh] flex-col overflow-hidden rounded-2xl bg-paper-50 shadow-pop"
        onSubmit={onSubmit}
      >
        <div className="flex items-center justify-between border-b border-paper-200 px-6 py-4">
          <h2 className="text-base font-semibold text-ink-900">
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
            <label className="field-label">{t("guests.kind_label")}</label>
            <p className="mb-2 text-xs text-ink-500">{t("guests.kind_help")}</p>
            <div className="grid grid-cols-3 gap-2">
              {(["adult", "child", "baby"] as GuestKind[]).map((k) => {
                const active = (form.kind ?? "adult") === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setForm({ ...form, kind: k })}
                    className={
                      active
                        ? "flex items-center justify-center gap-1.5 rounded-xl border-2 border-ink-700 bg-ink-700 px-3 py-2 text-sm font-medium text-paper-100"
                        : "flex items-center justify-center gap-1.5 rounded-xl border border-paper-300 bg-paper-50 px-3 py-2 text-sm text-ink-700 hover:border-ink-400"
                    }
                  >
                    <KindIcon kind={k} />
                    {t(`guests.kind_${k}`)}
                  </button>
                );
              })}
            </div>
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
        </div>
        <div className="flex gap-2 border-t border-paper-200 px-6 py-4">
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
