// Guest list manager, grouped by household. Each household carries the
// 8-character RSVP check-in code and a copy-link button for the airport-style
// "couple slug + code" credential. The guest drawer assigns or creates
// households so couples can pre-link plus-ones, families, etc.

import type {
  Couple,
  Guest,
  GuestGroupTag,
  GuestKind,
  Household,
  MealChoice,
  MealMenu,
  RsvpStatus,
} from "@shared/types";
import {
  MEAL_LABEL_MAX,
  MEAL_ORDER,
  isCustomMealMenu,
  normalizeMealMenuInput,
} from "@shared/meals";
import {
  Atom,
  Baby,
  Ban,
  Bed,
  Beef,
  Briefcase,
  Check,
  CheckCheck,
  ChevronDown,
  ClipboardCopy,
  Cookie,
  Crown,
  Download,
  Egg,
  Eye,
  Filter,
  Fish,
  Gem,
  GripVertical,
  Heart,
  Home,
  Leaf,
  Link2,
  Lock,
  Milk,
  MoreHorizontal,
  Music,
  Nut,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Send,
  Shell,
  Sprout,
  Target,
  Trash2,
  Upload,
  User,
  UserPlus,
  Users,
  Utensils,
  Wheat,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Dialog, Skeleton, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { guestCountBaseline } from "../lib/budget";
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

// Guest-list sort axes. "default" preserves the server/household order (the
// historic behavior); the rest are explicit user picks from the sort control.
type SortKey = "default" | "name" | "added" | "rsvp" | "group";
// RSVP sort surfaces the actionable states first (pending, maybe) ahead of the
// settled ones (yes, no) so "who do I still need to chase" floats to the top.
const RSVP_SORT_ORDER: Record<RsvpStatus, number> = { pending: 0, maybe: 1, yes: 2, no: 3 };
function sortGuests(list: Guest[], sort: SortKey): Guest[] {
  if (sort === "default") return list;
  const arr = [...list];
  if (sort === "name") arr.sort((a, b) => a.full_name.localeCompare(b.full_name));
  else if (sort === "added") arr.sort((a, b) => b.id - a.id);
  else if (sort === "rsvp")
    arr.sort(
      (a, b) =>
        RSVP_SORT_ORDER[a.rsvp_status] - RSVP_SORT_ORDER[b.rsvp_status] ||
        a.full_name.localeCompare(b.full_name),
    );
  else
    arr.sort(
      (a, b) =>
        GROUPS.indexOf(a.group_tag) - GROUPS.indexOf(b.group_tag) ||
        a.full_name.localeCompare(b.full_name),
    );
  return arr;
}
function sortHouseholds(list: Household[], sort: SortKey): Household[] {
  if (sort === "name") return [...list].sort((a, b) => a.label.localeCompare(b.label));
  if (sort === "added") return [...list].sort((a, b) => b.id - a.id);
  if (sort === "group")
    return [...list].sort((a, b) => GROUPS.indexOf(a.group_tag) - GROUPS.indexOf(b.group_tag));
  // "default" and "rsvp" keep the natural household order. rsvp is a
  // guest-level axis that doesn't map cleanly onto a whole household.
  return list;
}

// Collapsed icon-tool group (Sablon / CSV / Étkezés / Meghívók). Each segment
// shows only its icon until hovered, when its label slides open (max-width +
// opacity) and the native `title` tooltip appears. Literal class strings so
// Tailwind's JIT picks them up.
const GUEST_TOOL_BTN =
  "group flex items-center px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-700/5 disabled:cursor-not-allowed disabled:opacity-40 dark:text-paper-100 dark:hover:bg-paper-100/10";
const GUEST_TOOL_LABEL =
  "max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:max-w-[14rem] group-hover:opacity-100";
// Meal segment keeps a distinct warm caramel/espresso fill (coffee palette),
// with its own hover shade so it doesn't collide with the default segment's
// hover overlay.
const GUEST_TOOL_BTN_MEAL =
  "group flex items-center px-3 py-2 text-sm font-medium text-umber-900 transition-colors bg-umber-300 hover:bg-umber-400 disabled:cursor-not-allowed disabled:opacity-40 dark:text-paper-50 dark:bg-umber-600 dark:hover:bg-umber-500";

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
  // ── Stackable guest filters (all URL-backed) ─────────────────────────
  // Every filter axis lives in the query string so a filtered view is
  // bookmarkable and shareable. `rsvp` and `group` are comma-separated
  // multi-selects; `invited`/`accom` are flags; `q` mirrors the search box;
  // `household=closed` is the grouped-household browse lens; `sort` orders the
  // list. Nothing is mutually exclusive any more; every axis stacks (AND).
  // Dashboard links still arrive as a single `?rsvp=yes` and parse cleanly as
  // a one-element set.
  const [params, setParams] = useSearchParams();
  const rsvpSet = useMemo(() => {
    const valid: readonly string[] = ["pending", "yes", "no", "maybe"];
    const raw = params.get("rsvp");
    return new Set((raw ? raw.split(",") : []).filter((v): v is RsvpStatus => valid.includes(v)));
  }, [params]);
  const groupSet = useMemo(() => {
    const valid: readonly string[] = GROUPS;
    const raw = params.get("group");
    return new Set(
      (raw ? raw.split(",") : []).filter((v): v is GuestGroupTag => valid.includes(v)),
    );
  }, [params]);
  const invitedFilter = params.get("invited") === "1";
  const accommodationFilter = params.get("accom") === "1";
  const householdFilter = params.get("household") === "closed";
  const sortKey: SortKey = ((): SortKey => {
    const v = params.get("sort");
    return v === "name" || v === "added" || v === "rsvp" || v === "group" ? v : "default";
  })();
  const navigate = useNavigate();
  // Anchor for the "households" header stat — clicking it clears any filter and
  // smooth-scrolls down to the household list.
  const listRef = useRef<HTMLDivElement>(null);
  const [couple, setCouple] = useState<Couple | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [households, setHouseholds] = useState<Household[]>([]);
  // Drag-to-reorder state for the default household list. `armedId` gates
  // native draggability to a press on the grip handle (so the inline rename
  // input and action buttons stay interactive); `dragId`/`dragOverId` drive
  // the lifted-card + drop-target affordances.
  const [armedId, setArmedId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<DrawerInit | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [mealsOpen, setMealsOpen] = useState(false);
  const [orphanFixing, setOrphanFixing] = useState(false);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  // ── Search state ────────────────────────────────────────────────────
  // `query` is the raw text in the input; `debouncedQuery` is what we
  // actually search on (200ms after the user stops typing).
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [debouncedQuery, setDebouncedQuery] = useState(() => (params.get("q") ?? "").trim());
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

  // Mirror the debounced query into the URL (`?q=`) so a search is
  // bookmarkable and shareable. Intentionally keyed on `debouncedQuery` only:
  // we read the latest params inside, and depending on `params` would loop.
  useEffect(() => {
    const cur = params.get("q") ?? "";
    if (cur === debouncedQuery) return;
    const next = new URLSearchParams(params);
    if (debouncedQuery) next.set("q", debouncedQuery);
    else next.delete("q");
    setParams(next, { replace: true });
  }, [debouncedQuery]);

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
    try {
      const [c, g, h] = await Promise.all([
        coupleApi.current(),
        guestApi.list(),
        householdApi.list(),
      ]);
      setCouple(c.couple);
      setGuests(g.guests);
      setHouseholds(h.households);
    } finally {
      setLoading(false);
    }
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

  // Drag-to-reorder: move `fromId` to sit where `toId` currently is, within
  // the visible (host-excluded) default list. Optimistically reshuffle local
  // state — host households stay pinned on top since the server orders them
  // first — then persist and reconcile against the canonical response.
  async function onReorderHouseholds(fromId: number, toId: number) {
    if (fromId === toId) return;
    const vis = sortedListableHouseholds;
    const from = vis.findIndex((h) => h.id === fromId);
    const to = vis.findIndex((h) => h.id === toId);
    if (from < 0 || to < 0) return;
    const next = [...vis];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    const coupleHH = households.filter((h) => h.is_couple_household);
    setHouseholds([...coupleHH, ...next]);
    try {
      const r = await householdApi.reorder(next.map((h) => h.id));
      setHouseholds(r.households);
    } catch {
      toast.error(t("guests.reorder_failed"));
      refresh();
    }
  }

  // Mass invite send breakdown, computed from the loaded data so the confirm
  // dialog shows exactly who gets a letter before anything goes out. The
  // backend re-derives and re-checks `invited_at`, so this is a preview, not
  // the source of truth. Three buckets:
  //   • eligible        — has a contact email AND not yet invited → will send
  //   • alreadyInvited  — invited_at set → skipped (no double send)
  //   • noEmail         — no member has an email → can't send, surfaced so the
  //                       couple can add an address (no silent 0x)
  // Suppliers and the hosts' own household are never invitees.
  const inviteBreakdown = useMemo(() => {
    const membersByHh = new Map<number, Guest[]>();
    for (const g of guests) {
      if (g.household_id == null) continue;
      const arr = membersByHh.get(g.household_id);
      if (arr) arr.push(g);
      else membersByHh.set(g.household_id, [g]);
    }
    const eligible: Household[] = [];
    const eligibleContacts: Guest[] = [];
    const alreadyInvited: Household[] = [];
    const noEmail: Household[] = [];
    for (const hh of households) {
      if (hh.is_supplier_household || hh.is_couple_household) continue;
      const contact = (membersByHh.get(hh.id) ?? [])
        .filter((m) => !m.is_supplier && m.email && m.email.trim().length > 0)
        .sort((a, b) => a.id - b.id)[0];
      if (!contact) noEmail.push(hh);
      else if (hh.invited_at != null) alreadyInvited.push(hh);
      else {
        eligible.push(hh);
        eligibleContacts.push(contact);
      }
    }
    return { eligible, eligibleContacts, alreadyInvited, noEmail };
  }, [households, guests]);

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

  async function onChangeHouseholdGroup(id: number, groupTag: GuestGroupTag) {
    try {
      await householdApi.update(id, { group_tag: groupTag });
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  async function onToggleHouseholdAccommodation(id: number, next: boolean) {
    try {
      await householdApi.update(id, { rsvp_offers_accommodation: next });
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  /** Bulk meal-collection switcher used by the meals dialog. Fans out one
   *  PATCH per household so per-field audit-log entries stay clean. The
   *  accommodation flag intentionally has no bulk variant — couples opt in
   *  per-household via the Bed icon on each card (or at +guest creation
   *  time on the AddGuestDrawer), so the meals dialog stays focused on the
   *  meal-collection question. */
  async function onBulkRsvpToggle(field: "rsvp_collects_meal", next: boolean) {
    try {
      await Promise.all(households.map((h) => householdApi.update(h.id, { [field]: next })));
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
    const targetInvitedAt = next === "not_invited" ? null : targetTs;
    const targetDeliveredAt = next === "delivered" ? targetTs : null;
    // When g is a host (not itself a +1), its materialized +1s inherit the same
    // invite state — mirrors the backend cascade so the row updates instantly.
    const isHost = !g.is_plus_one;
    const affects = (row: Guest) => row.id === g.id || (isHost && row.plus_one_of === g.id);
    // Snapshot the affected rows' original state for rollback — each +1 may have
    // differed from the host before this cycle.
    const originals = new Map<number, Pick<Guest, "invited_at" | "invitation_delivered_at">>();
    for (const row of guests) {
      if (affects(row)) {
        originals.set(row.id, {
          invited_at: row.invited_at,
          invitation_delivered_at: row.invitation_delivered_at,
        });
      }
    }
    const optimistic = (list: Guest[]) =>
      list.map((row) =>
        affects(row)
          ? { ...row, invited_at: targetInvitedAt, invitation_delivered_at: targetDeliveredAt }
          : row,
      );
    setGuests((prev) => optimistic(prev));
    setSearchResults((prev) => (prev ? optimistic(prev) : prev));
    try {
      // PATCH revalidates the row, so ship the full guest plus the two flags.
      // The backend cascades the same flags onto this guest's +1s.
      await guestApi.update(g.id, {
        ...g,
        invited: next !== "not_invited",
        delivered: next === "delivered",
      });
    } catch (e) {
      // Roll back host + +1s on failure so the UI doesn't lie.
      const rollback = (list: Guest[]) =>
        list.map((row) => {
          const orig = originals.get(row.id);
          return orig ? { ...row, ...orig } : row;
        });
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

  // Guests and households excluding the couple themselves — the bride/groom
  // are tracked in the DB for headcount and seating, but don't belong in the
  // guest management list (they're hosts, not invitees).
  const listableGuests = useMemo(() => guests.filter((g) => !g.partner_role), [guests]);
  const listableHouseholds = useMemo(
    () => households.filter((hh) => !hh.is_couple_household),
    [households],
  );

  const orphanGuests = useMemo(
    () => listableGuests.filter((g) => g.household_id == null),
    [listableGuests],
  );

  // Flat filtered list: every active guest-level predicate ANDed together,
  // over either the server search results (while searching) or the full guest
  // list, then sorted. Powers the flat view whenever any filter or the search
  // box is active.
  const filteredFlatGuests = useMemo(() => {
    const base = debouncedQuery ? (searchResults ?? []) : listableGuests;
    const out = base.filter((g) => {
      if (g.partner_role) return false;
      if (rsvpSet.size > 0 && !rsvpSet.has(g.rsvp_status)) return false;
      if (groupSet.size > 0 && !groupSet.has(g.group_tag)) return false;
      if (invitedFilter && g.invited_at == null) return false;
      if (accommodationFilter && !g.accommodation_needed) return false;
      return true;
    });
    return sortGuests(out, sortKey);
  }, [
    debouncedQuery,
    searchResults,
    listableGuests,
    rsvpSet,
    groupSet,
    invitedFilter,
    accommodationFilter,
    sortKey,
  ]);
  // Closed households = multi-member households (explicitly grouped units).
  const closedHouseholds = useMemo(
    () => listableHouseholds.filter((hh) => hh.member_ids.length > 1),
    [listableHouseholds],
  );
  const activeGroupTags = useMemo(() => {
    const present = new Set(closedHouseholds.map((hh) => hh.group_tag));
    return GROUPS.filter((g) => present.has(g));
  }, [closedHouseholds]);
  // Households shown in the grouped browse lens, narrowed by the (multi)
  // side/group selection.
  const filteredClosedHouseholds = useMemo(
    () =>
      groupSet.size > 0
        ? closedHouseholds.filter((hh) => groupSet.has(hh.group_tag))
        : closedHouseholds,
    [closedHouseholds, groupSet],
  );
  // Default (unfiltered) household list, honoring the sort control.
  const sortedListableHouseholds = useMemo(
    () => sortHouseholds(listableHouseholds, sortKey),
    [listableHouseholds, sortKey],
  );

  // ── Filter writers ───────────────────────────────────────────────────
  // All mutate the URL (replace, no history spam). Toggles add/remove a value
  // from its axis; filters stack rather than replacing one another.
  function patchParams(mut: (p: URLSearchParams) => void) {
    const next = new URLSearchParams(params);
    mut(next);
    setParams(next, { replace: true });
  }
  function toggleSetParam(key: "rsvp" | "group", value: string) {
    patchParams((p) => {
      const cur = new Set((p.get(key) ?? "").split(",").filter(Boolean));
      if (cur.has(value)) cur.delete(value);
      else cur.add(value);
      if (cur.size > 0) p.set(key, [...cur].join(","));
      else p.delete(key);
    });
  }
  const toggleRsvp = (s: RsvpStatus) => toggleSetParam("rsvp", s);
  const toggleGroup = (g: GuestGroupTag) => toggleSetParam("group", g);
  function toggleInvited() {
    patchParams((p) => {
      if (invitedFilter) p.delete("invited");
      else p.set("invited", "1");
    });
  }
  function toggleAccommodation() {
    patchParams((p) => {
      if (accommodationFilter) p.delete("accom");
      else p.set("accom", "1");
    });
  }
  function setSort(key: SortKey) {
    patchParams((p) => {
      if (key === "default") p.delete("sort");
      else p.set("sort", key);
    });
  }
  // Clear every filter axis (and the search box) in one shot.
  function clearAllFilters() {
    patchParams((p) => {
      for (const k of ["rsvp", "group", "invited", "accom", "household", "q"]) p.delete(k);
    });
    setQuery("");
    setDebouncedQuery("");
  }
  // Header-stat clicks. "All guests" is a full reset; "invited" toggles its
  // axis; "households" toggles the grouped browse lens (and scrolls to it).
  function showAllGuests() {
    clearAllFilters();
  }
  function showInvitedOnly() {
    toggleInvited();
  }
  function toggleHouseholdView() {
    const turningOn = !householdFilter;
    patchParams((p) => {
      if (householdFilter) p.delete("household");
      else p.set("household", "closed");
    });
    setQuery("");
    setDebouncedQuery("");
    if (turningOn) {
      requestAnimationFrame(() =>
        listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  }

  // Planned headcount shown alongside the live counts so couples see actual vs
  // target at a glance. Mirrors the single number the couple set on the budget
  // page (planning_count), falling back to the onboarding goal's baseline (the
  // exact value, or the midpoint of a range) rather than printing a "40–150"
  // range. Null (stat hidden) while the goal is still TBD.
  const goal = couple?.guest_count_goal;
  const plannedGuests: string | null =
    couple && goal && goal.kind !== "tbd"
      ? String(couple.planning_count ?? guestCountBaseline(couple, guests.length))
      : null;

  // ── View mode ────────────────────────────────────────────────────────
  // A guest-level predicate (rsvp / invited / accommodation) or a search flips
  // the page to the flat filtered list. A side/group selection does the same
  // UNLESS the grouped-household browse lens is on, where it just narrows the
  // sections. So every axis still composes; the only question is grouped-cards
  // vs flat-list presentation.
  const predicateActive = rsvpSet.size > 0 || invitedFilter || accommodationFilter;
  const flatView = !!debouncedQuery || predicateActive || (groupSet.size > 0 && !householdFilter);
  const activeFilterCount =
    rsvpSet.size + groupSet.size + (invitedFilter ? 1 : 0) + (accommodationFilter ? 1 : 0);

  // Per-stat highlight/dim. The stat that owns the current view reads bright;
  // the rest fade so the live filter is obvious at a glance.
  const totalActive = activeFilterCount === 0 && !debouncedQuery && !householdFilter;
  const invitedActive = invitedFilter;
  const householdActive = householdFilter && !flatView;
  const anyStatActive = totalActive || invitedActive || householdActive;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <h1 className="font-grotesk">{t("guests.title")}</h1>
          {guests.length > 0 ? (
            <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              {plannedGuests !== null && (
                <GuestStat
                  value={plannedGuests}
                  label={t("guests.total_summary_planned_unit")}
                  icon={<Target size={18} aria-hidden />}
                  onClick={() => navigate("/app/budget")}
                  actionTitle={t("guests.stat_planned_action")}
                  dimmed={anyStatActive}
                />
              )}
              <GuestStat
                value={guests.length}
                label={t("guests.total_summary_unit")}
                icon={<Users size={18} aria-hidden />}
                tone="primary"
                onClick={showAllGuests}
                actionTitle={t("guests.stat_total_action")}
                active={totalActive}
                dimmed={anyStatActive && !totalActive}
              />
              <GuestStat
                value={closedHouseholds.length}
                label={t("guests.total_summary_households_unit")}
                icon={<Home size={18} aria-hidden />}
                onClick={toggleHouseholdView}
                actionTitle={t("guests.stat_households_action")}
                active={householdActive}
                dimmed={anyStatActive && !householdActive}
              />
              <GuestStat
                value={guests.filter((g) => g.invited_at != null).length}
                label={t("guests.total_summary_invited_unit")}
                icon={<Send size={18} aria-hidden />}
                onClick={showInvitedOnly}
                actionTitle={t("guests.stat_invited_action")}
                active={invitedActive}
                dimmed={anyStatActive && !invitedActive}
              />
            </dl>
          ) : (
            <p className="text-sm text-ink-500 dark:text-umber-300">{guests.length}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          {/* Icon-only segmented group: collapsed to icons, each expands its
              label on hover (max-width + opacity transition) and surfaces a
              native tooltip via title. Keeps the toolbar compact while the
              primary "Add" CTA stays full beside it. */}
          <div
            data-tour-target="guests-tools"
            className="inline-flex items-stretch divide-x divide-ink-300 overflow-hidden rounded-lg border border-ink-700 dark:divide-umber-600 dark:border-paper-100"
          >
            <button
              type="button"
              className={GUEST_TOOL_BTN}
              onClick={downloadCsvTemplate}
              title={t("guests.download_template_hint")}
              aria-label={t("guests.download_template")}
            >
              <Download size={16} aria-hidden />
              <span className={GUEST_TOOL_LABEL}>{t("guests.download_template")}</span>
            </button>
            <label
              className={`${GUEST_TOOL_BTN} cursor-pointer`}
              title={t("guests.import_csv_hint")}
              aria-label={t("guests.import_csv")}
            >
              <Upload size={16} aria-hidden />
              <span className={GUEST_TOOL_LABEL}>{t("guests.import_csv")}</span>
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
              className={GUEST_TOOL_BTN_MEAL}
              onClick={() => setMealsOpen(true)}
              title={t("guests.meals_hint")}
              aria-label={t("guests.meals_button")}
            >
              <Utensils size={16} aria-hidden />
              <span className={GUEST_TOOL_LABEL}>{t("guests.meals_button")}</span>
            </button>
            <button
              type="button"
              className={GUEST_TOOL_BTN}
              onClick={() => navigate("/app/invites")}
              title={t("guests.invite_send_hint")}
              aria-label={t("guests.invite_send")}
            >
              <Send size={16} aria-hidden />
              <span className={GUEST_TOOL_LABEL}>
                {inviteBreakdown.eligible.length > 0
                  ? t("guests.invite_send_count", { count: inviteBreakdown.eligible.length })
                  : t("guests.invite_send")}
              </span>
            </button>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setEditing({ guest: null, defaultHouseholdId: null })}
            title={t("guests.add_hint")}
          >
            <Plus size={16} /> {t("guests.add")}
          </button>
        </div>
      </div>

      {couple && <CheckinPill couple={couple} onSaved={(c) => setCouple(c)} />}

      {/* ── Search + stackable filters + sort ───────────────────────────
          One toolbar drives search, the expandable filter panel (RSVP, side
          /group, invited, accommodation), the sort control, and the active
          filter chips with a single "Clear all". Every axis stacks (AND) and
          is mirrored to the URL. */}
      {(guests.length > 0 || query || activeFilterCount > 0) && (
        <GuestFilterBar
          query={query}
          onQueryChange={setQuery}
          rsvpSet={rsvpSet}
          groupSet={groupSet}
          invited={invitedFilter}
          accommodation={accommodationFilter}
          householdView={householdFilter}
          sortKey={sortKey}
          activeFilterCount={activeFilterCount}
          onToggleRsvp={toggleRsvp}
          onToggleGroup={toggleGroup}
          onToggleInvited={toggleInvited}
          onToggleAccommodation={toggleAccommodation}
          onToggleHousehold={toggleHouseholdView}
          onSetSort={setSort}
          onClearAll={clearAllFilters}
        />
      )}

      {loading ? (
        <HouseholdListSkeleton />
      ) : households.length === 0 && guests.length === 0 ? (
        // Empty-state action card. Three inline CTAs covering the three
        // realistic next moves (manual add, CSV bulk import, template
        // download) so first-run users never face a passive "no guests yet"
        // dead end. Header buttons above still work; this is the in-content
        // mirror that owns the visual focus when the list is genuinely empty.
        <div className="card stationery">
          <div className="text-center">
            <h3 className="text-lg font-semibold">{t("guests.empty_title")}</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-600 dark:text-umber-200">
              {t("guests.empty_body")}
            </p>
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={() => setEditing({ guest: null, defaultHouseholdId: null })}
            >
              <UserPlus size={16} aria-hidden /> {t("guests.empty_cta_add")}
            </button>
            <label className="btn-outline cursor-pointer">
              <Upload size={16} aria-hidden /> {t("guests.import_csv")}
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
            <button type="button" className="btn-outline" onClick={downloadCsvTemplate}>
              <Download size={16} aria-hidden /> {t("guests.download_template")}
            </button>
          </div>
        </div>
      ) : flatView ? (
        // Flat filtered list: search and/or any stacked guest-level filter.
        // A count line communicates the mode switch so leaving the grouped
        // household view isn't silent (audit follow-up).
        <div className="space-y-3">
          {!(debouncedQuery && searching) && (
            <p className="text-sm text-ink-500 dark:text-umber-300">
              {filteredFlatGuests.length === 0
                ? t("guests.filtered_results_empty")
                : t(
                    filteredFlatGuests.length === 1
                      ? "guests.filtered_results_one"
                      : "guests.filtered_results_other",
                    { count: filteredFlatGuests.length },
                  )}
            </p>
          )}
          <SearchResults
            loading={!!debouncedQuery && searching}
            guests={filteredFlatGuests}
            onEditGuest={(g) => setEditing({ guest: g, defaultHouseholdId: g.household_id })}
            onPrintPlaceCard={onPrintPlaceCard}
          />
        </div>
      ) : householdFilter ? (
        <div ref={listRef} className="space-y-6">
          {(groupSet.size > 0 ? GROUPS.filter((g) => groupSet.has(g)) : activeGroupTags).map(
            (tag) => {
              const tagHouseholds = sortHouseholds(
                filteredClosedHouseholds.filter((hh) => hh.group_tag === tag),
                sortKey,
              );
              if (tagHouseholds.length === 0) return null;
              return (
                <div key={tag}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-400 dark:text-umber-500">
                    {t(`guests.group_${tag}`)}
                  </h3>
                  <div className="space-y-3">
                    {tagHouseholds.map((hh) => (
                      <HouseholdCard
                        key={hh.id}
                        household={hh}
                        members={guestsByHousehold.get(hh.id) ?? []}
                        coupleSlug={couple?.slug ?? null}
                        onCopyShare={() => {
                          void copyShare(couple?.slug ?? null, hh.code);
                        }}
                        onAddMember={() => setEditing({ guest: null, defaultHouseholdId: hh.id })}
                        onEditGuest={(g) =>
                          setEditing({ guest: g, defaultHouseholdId: g.household_id })
                        }
                        onDeleteGuest={onDeleteGuest}
                        onDeleteHousehold={() => onDeleteHousehold(hh)}
                        onRenameHousehold={onRenameHousehold}
                        onChangeGroup={onChangeHouseholdGroup}
                        onToggleAccommodation={onToggleHouseholdAccommodation}
                        onCycleInviteState={onCycleInviteState}
                        onPrintPlaceCard={onPrintPlaceCard}
                      />
                    ))}
                  </div>
                </div>
              );
            },
          )}
          {filteredClosedHouseholds.length === 0 && (
            <p className="text-sm text-neutral-500 dark:text-umber-400">
              {t("guests.household_filter_empty")}
            </p>
          )}
        </div>
      ) : (
        <div ref={listRef} className="space-y-4">
          {(virtualReveal ? sortedListableHouseholds : sortedListableHouseholds.slice(0, 100)).map(
            (hh) => (
              // `content-visibility: auto` lets the browser skip layout +
              // paint for offscreen household cards. `contain-intrinsic-size`
              // gives it a placeholder height so the scrollbar still tracks
              // total list length and the scroll-restore-on-back works.
              // Native fallback when unsupported (older Safari) — the card
              // just renders normally. Saves render churn on N>60 lists
              // flagged by the a11y/perf-critic agent.
              // Drag-to-reorder is only meaningful in the default sort (the
              // other axes are computed orders, not a stored sequence), so the
              // grip + native draggability are gated on `sortKey === "default"`.
              <div
                key={hh.id}
                draggable={sortKey === "default" && armedId === hh.id}
                onDragStart={(e) => {
                  setDragId(hh.id);
                  e.dataTransfer.effectAllowed = "move";
                  // Firefox refuses to start a drag without data on the transfer.
                  try {
                    e.dataTransfer.setData("text/plain", String(hh.id));
                  } catch {}
                }}
                onDragOver={(e) => {
                  if (dragId == null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragOverId !== hh.id) setDragOverId(hh.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId != null) void onReorderHouseholds(dragId, hh.id);
                  setDragId(null);
                  setDragOverId(null);
                  setArmedId(null);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setDragOverId(null);
                  setArmedId(null);
                }}
                style={{ contentVisibility: "auto", containIntrinsicSize: "0 220px" }}
                className={`rounded-2xl transition-all ${dragId === hh.id ? "opacity-50" : ""} ${
                  dragOverId === hh.id && dragId !== hh.id
                    ? "ring-2 ring-sage-400 ring-offset-2 ring-offset-paper-50 dark:ring-offset-umber-900"
                    : ""
                }`}
              >
                <HouseholdCard
                  household={hh}
                  members={guestsByHousehold.get(hh.id) ?? []}
                  coupleSlug={couple?.slug ?? null}
                  reorderable={sortKey === "default"}
                  onGripPointerDown={() => setArmedId(hh.id)}
                  onCopyShare={() => {
                    void copyShare(couple?.slug ?? null, hh.code);
                  }}
                  onAddMember={() => setEditing({ guest: null, defaultHouseholdId: hh.id })}
                  onEditGuest={(g) => setEditing({ guest: g, defaultHouseholdId: g.household_id })}
                  onDeleteGuest={onDeleteGuest}
                  onDeleteHousehold={() => onDeleteHousehold(hh)}
                  onRenameHousehold={onRenameHousehold}
                  onChangeGroup={onChangeHouseholdGroup}
                  onToggleAccommodation={onToggleHouseholdAccommodation}
                  onCycleInviteState={onCycleInviteState}
                  onPrintPlaceCard={onPrintPlaceCard}
                />
              </div>
            ),
          )}
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

      {mealsOpen && (
        <MealsDialog
          guests={guests}
          households={households}
          couple={couple}
          onCoupleUpdate={setCouple}
          onBulkRsvpToggle={onBulkRsvpToggle}
          onClose={() => setMealsOpen(false)}
        />
      )}

      {editing && (
        <GuestDrawer
          init={editing}
          households={households}
          guests={guests}
          couple={couple}
          onClose={() => setEditing(null)}
          onSaved={() => {
            // Auto-open the meals dialog the very first time the couple adds
            // a guest — that's where the bulk "ask for meals / accommodation
            // in the RSVP" toggles live now, and most couples otherwise
            // never realise the feature is there. Only triggers on ADD
            // (editing.guest === null) and only when there were no guests
            // before this save, so subsequent edits don't keep nagging.
            const isFirstAdd = editing?.guest === null && guests.length === 0;
            setEditing(null);
            refresh();
            if (isFirstAdd) setMealsOpen(true);
          }}
        />
      )}
    </>
  );
}

function HouseholdListSkeleton() {
  const rowCounts = [3, 2, 4, 2];
  return (
    <div className="space-y-4" aria-hidden="true">
      {rowCounts.map((n, i) => (
        <div key={i} className="card overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-paper-200 bg-paper-100/60 px-4 py-3 dark:border-umber-700 dark:bg-umber-700/60">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Skeleton variant="block" width={160} height={16} rounded="md" />
              <Skeleton variant="block" width={72} height={20} rounded="full" />
            </div>
            <div className="flex items-center gap-3">
              <Skeleton variant="block" width={88} height={16} rounded="md" />
              <Skeleton variant="block" width={56} height={14} rounded="md" />
            </div>
          </div>
          <ul className="divide-y divide-paper-200 dark:divide-umber-700">
            {Array.from({ length: n }).map((_, j) => (
              <li key={j} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Skeleton variant="circle" width={16} />
                  <Skeleton variant="block" height={14} width="45%" rounded="md" />
                </div>
                <div className="flex items-center gap-2">
                  <Skeleton variant="block" width={56} height={20} rounded="full" />
                  <Skeleton variant="circle" width={24} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
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
    return (
      <ul className="card divide-y divide-paper-200 p-0 dark:divide-umber-700" aria-hidden="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton variant="block" height={14} width="55%" rounded="md" />
              <Skeleton variant="block" height={10} width="35%" rounded="md" />
            </div>
            <Skeleton variant="block" width={64} height={20} rounded="full" />
          </li>
        ))}
      </ul>
    );
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
              <SupplierIcon show={g.is_supplier} />
              <PlusOneBadge show={g.is_plus_one} />
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

/** Order a household's members so each materialised +1 sits directly under its
 *  host. Primaries keep their natural order; a host's +1 children slot in right
 *  after them. A +1 whose host isn't in this household (rare cross-household
 *  edit) falls back to the tail so it never vanishes. Each row is tagged with
 *  whether it should render as an indented, connected +1. */
function orderHouseholdMembers(members: Guest[]): { guest: Guest; isPlusOne: boolean }[] {
  const present = new Set(members.map((m) => m.id));
  const childrenByParent = new Map<number, Guest[]>();
  for (const g of members) {
    if (g.plus_one_of != null && present.has(g.plus_one_of)) {
      const arr = childrenByParent.get(g.plus_one_of) ?? [];
      arr.push(g);
      childrenByParent.set(g.plus_one_of, arr);
    }
  }
  const out: { guest: Guest; isPlusOne: boolean }[] = [];
  const emitted = new Set<number>();
  for (const g of members) {
    // Children are emitted under their parent below, never on their own pass.
    if (g.plus_one_of != null && present.has(g.plus_one_of)) continue;
    out.push({ guest: g, isPlusOne: false });
    emitted.add(g.id);
    for (const child of childrenByParent.get(g.id) ?? []) {
      out.push({ guest: child, isPlusOne: true });
      emitted.add(child.id);
    }
  }
  // Safety net: a +1 whose host left the household still shows, at the tail.
  for (const g of members) {
    if (!emitted.has(g.id)) out.push({ guest: g, isPlusOne: g.plus_one_of != null });
  }
  return out;
}

function HouseholdCard({
  household,
  members,
  coupleSlug,
  reorderable = false,
  onGripPointerDown,
  onCopyShare,
  onAddMember,
  onEditGuest,
  onDeleteGuest,
  onDeleteHousehold,
  onRenameHousehold,
  onChangeGroup,
  onToggleAccommodation,
  onCycleInviteState,
  onPrintPlaceCard,
}: {
  household: Household;
  members: Guest[];
  coupleSlug: string | null;
  /** When true the card shows a drag handle and the parent wrapper handles the
   *  native drag-to-reorder lifecycle (default household sort only). */
  reorderable?: boolean;
  /** Arms the parent wrapper's `draggable` on grip press so the rest of the
   *  card (rename input, action buttons) stays interactive. */
  onGripPointerDown?: () => void;
  onCopyShare: () => void;
  onAddMember: () => void;
  onEditGuest: (g: Guest) => void;
  onDeleteGuest: (id: number) => void;
  onDeleteHousehold: () => void;
  onRenameHousehold: (id: number, label: string) => Promise<void>;
  onChangeGroup: (id: number, groupTag: GuestGroupTag) => Promise<void>;
  onToggleAccommodation: (id: number, next: boolean) => Promise<void>;
  onCycleInviteState: (g: Guest) => void;
  onPrintPlaceCard: (g: Guest) => void | Promise<void>;
}) {
  const { t } = useT();
  const isHosts = household.is_couple_household;
  const orderedMembers = useMemo(() => orderHouseholdMembers(members), [members]);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      const raw = window.localStorage.getItem("weddly.guests.collapsed_households");
      if (!raw) return false;
      const ids = JSON.parse(raw) as unknown;
      return Array.isArray(ids) && ids.includes(household.id);
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("weddly.guests.collapsed_households");
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      const ids = new Set<number>(Array.isArray(parsed) ? (parsed as number[]) : []);
      if (collapsed) ids.add(household.id);
      else ids.delete(household.id);
      window.localStorage.setItem("weddly.guests.collapsed_households", JSON.stringify([...ids]));
    } catch {}
  }, [collapsed, household.id]);
  return (
    /* The couple's own household card swaps the neutral card chrome for
       a thin blush outline + the shared `.stationery-blush` diagonal
       hairline texture on the header (same pattern as the dashboard's
       "date changed" stationery). Reads as the same design language as
       the Crown icon next to each partner's name — elegant, not loud. */
    <div
      className={`card overflow-hidden p-0 ${isHosts ? "!border-ink-900 dark:!border-paper-100/40" : ""}`}
    >
      <header
        /* `items-start md:items-center` keeps the action-icon cluster
         *  pinned to the top-right of the card on mobile (where the
         *  metadata column wraps to multiple rows below it) while the
         *  desktop layout — metadata on a single grid row alongside
         *  the icons — stays vertically centered. `flex-nowrap` is the
         *  load-bearing change: the prior `flex-wrap` + `basis-full`
         *  on the metadata block pushed the icons onto their own row
         *  below the metadata, which is exactly what the user flagged. */
        className={`flex flex-nowrap items-start justify-between gap-2 md:items-center md:gap-3 ${isHosts ? "!bg-umber-800 text-paper-50 dark:!bg-umber-950" : "bg-paper-100/60 dark:bg-umber-700/60"} px-3 py-1.5 md:px-4 md:py-3 ${collapsed ? "" : "border-b border-paper-200 dark:border-umber-700"}`}
      >
        {/* Drag handle — pressing it arms the parent wrapper's native
            draggability so the couple can reorder the list (default sort
            only). `touch-none` keeps a touch-drag from scrolling the page
            instead of grabbing the card. */}
        {reorderable && (
          <button
            type="button"
            onPointerDown={onGripPointerDown}
            className="-ml-1 flex shrink-0 cursor-grab touch-none items-center self-stretch rounded text-ink-300 transition-colors hover:text-ink-600 active:cursor-grabbing dark:text-umber-400 dark:hover:text-paper-100"
            title={t("guests.reorder_drag")}
            aria-label={t("guests.reorder_drag")}
          >
            <GripVertical size={16} aria-hidden />
          </button>
        )}
        {/* Metadata columns: label · group chip · slug · code · invited
            (+ delivered). Fixed-width tracks with `md:col-start-*` force
            every field to the same x across cards so the eye scans down
            the column. On mobile the grid switches to flex-wrap so the
            five fields flow into ~2 rows instead of stacking into 5 —
            the single-column stack used to take half the card vertically
            for just metadata. The couple's own household (bride + groom)
            renders just the label — chip / slug / code / invited cells
            are skipped because the hosts don't check themselves in. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-ink-600 md:grid md:gap-x-6 dark:text-umber-200 md:grid-cols-[minmax(0,1fr)_minmax(0,13rem)_8rem_5.5rem_auto]">
          {/* Label grows to fill row 1 so the RSVP code rides the same line,
              pinned right — never wrapping to a row of its own on mobile.
              On desktop the parent is a grid; every cell carries an explicit
              md:col-start-* AND md:row-start-1. The row-start pin is load-
              bearing: DOM order (label, code@col4, chip@col2, slug@col3,
              invited@col5) doesn't match column order, so grid auto-placement
              would otherwise walk the cursor backwards at col2 and bump the
              chip/slug/invited onto a second row. */}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 md:col-start-1 md:row-start-1 md:basis-auto md:flex-none">
            <HouseholdLabelEditor
              household={household}
              count={members.length}
              onSave={(label) => onRenameHousehold(household.id, label)}
              onDark={isHosts}
            />
            {isHosts && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-paper-200/90">
                <Crown size={10} aria-hidden />
                {t("guests.hosts_badge")}
              </span>
            )}
          </div>
          {!isHosts && (
            <span className="shrink-0 font-mono text-sm text-ink-900 tracking-[0.2em] dark:text-paper-50 md:col-start-4 md:row-start-1 md:text-base md:tracking-[0.3em]">
              {household.code}
            </span>
          )}
          {!isHosts && (
            <div className="min-w-0 max-w-full md:col-start-2 md:row-start-1">
              <HouseholdGroupChip
                value={household.group_tag}
                onChange={(g) => onChangeGroup(household.id, g)}
              />
            </div>
          )}
          {!isHosts && coupleSlug && (
            /* The slug is identical for every household in the workspace
             * — at phone widths it just steals a row from the code/
             * invited cells. The full RSVP URL is one tap away via the
             * share button, so the inline slug is desktop-only. */
            <span className="hidden font-mono uppercase md:col-start-3 md:row-start-1 md:inline">
              {coupleSlug}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 md:gap-1">
          {!isHosts && (
            <>
              <AccommodationToggle
                on={household.rsvp_offers_accommodation}
                onChange={(next) => onToggleAccommodation(household.id, next)}
              />
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={onCopyShare}
                disabled={!coupleSlug}
                title={t("guests.household_share_link")}
                aria-label={t("guests.household_share_link")}
              >
                {/* Mobile: icon-only — the full "Share check-in link" string
                    forced the action cluster onto a second row and pushed
                    the chevron under the household label. The icon keeps
                    the affordance at thumb-width without wasting the row. */}
                <Link2 size={14} className="md:hidden" aria-hidden />
                <span className="hidden md:inline">{t("guests.household_share_link")}</span>
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
          <button
            type="button"
            className={`btn-ghost btn-sm ${isHosts ? "!text-paper-100 hover:!bg-umber-700 hover:!text-paper-50" : ""}`}
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? t("guests.household_expand") : t("guests.household_collapse")}
            title={collapsed ? t("guests.household_expand") : t("guests.household_collapse")}
          >
            <ChevronDown
              size={14}
              aria-hidden
              className={collapsed ? "transition-transform" : "rotate-180 transition-transform"}
            />
          </button>
        </div>
      </header>

      {!collapsed && (
        <ul className="divide-y divide-paper-200 dark:divide-umber-700">
          {orderedMembers.map(({ guest: g, isPlusOne }) => (
            <li
              key={g.id}
              /* Single non-wrapping row at every viewport — the prior two-
               *  row mobile layout (name on row 1, meal-icons + actions on
               *  row 2 with `pl-[3.75rem]` indent) used twice the height
               *  per guest and visually dis-aligned the action cluster
               *  depending on whether the guest had a meal/dietary icon.
               *  Now: invite-pip → name (with role + kind + meal icons all
               *  inline) → flexible spacer → RSVP badge + edit/print/
               *  delete pinned right. Same layout for every guest.
               *  A materialised +1 is nudged right and gets an L-shaped
               *  hairline connector tying it back up to its host above. */
              className={`flex items-center gap-2 py-2 md:gap-3 md:py-2.5 ${
                isPlusOne ? "relative pl-9 pr-3 md:pl-12 md:pr-4" : "px-3 md:px-4"
              }`}
            >
              {isPlusOne && (
                <span
                  aria-hidden
                  /* L-connector: drops from the row's top edge to its middle,
                   *  then turns right (rounded bottom-left corner) toward the
                   *  +1's name — a quiet visual tether to the host above. */
                  className="pointer-events-none absolute left-4 top-0 h-1/2 w-3 rounded-bl-md border-b border-l border-paper-300 dark:border-umber-600 md:left-6"
                />
              )}
              <InviteChip guest={g} onCycle={() => onCycleInviteState(g)} />
              <p className="flex min-w-0 flex-1 items-center gap-1 truncate text-sm text-ink-900 dark:text-paper-50">
                <PartnerRoleIcon role={g.partner_role} />
                <KindIcon kind={g.kind} />
                <SupplierIcon show={g.is_supplier} />
                <PlusOneBadge show={g.is_plus_one} />
                <span className="truncate">{g.full_name}</span>
                <span className="inline-flex shrink-0">
                  <MealIcons meal={g.meal_choice} dietary={g.dietary} />
                </span>
              </p>
              {/* Action cluster — tight gap, pinned right, identical
               *  position for every guest. `shrink-0` + small icon-buttons
               *  keep them on the same line as the name on phones; names
               *  that overrun get the ellipsis. */}
              <div className="flex shrink-0 items-center gap-0.5">
                <RsvpBadge status={g.rsvp_status} />
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-500 hover:bg-paper-200 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-50"
                  onClick={() => onEditGuest(g)}
                  aria-label={t("guests.edit")}
                  title={t("guests.edit")}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-500 hover:bg-paper-200 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-50"
                  onClick={() => void onPrintPlaceCard(g)}
                  aria-label={t("guests.print_place_card")}
                  title={t("guests.print_place_card")}
                >
                  <Printer size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-blush-700 hover:bg-blush-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blush-300 focus-visible:ring-offset-2 dark:text-blush-300 dark:hover:bg-blush-400/15"
                  onClick={() => onDeleteGuest(g.id)}
                  aria-label={t("guests.delete")}
                  title={t("guests.delete")}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
          {!isHosts && (
            <li className="px-4 py-2.5">
              <button
                type="button"
                className="btn-ghost btn-sm w-full justify-start"
                onClick={onAddMember}
              >
                <UserPlus size={14} /> {t("guests.household_add_member")}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Compact "Check-in: ANDORSARI · + 8-character code" pill at the top of
 * /app/guests. Collapsed by default — first-time visitors get the airport
 * concept at a glance without the page being top-heavy. Click expands the
 * panel for slug edit + URL hint + the household-grouping reminder.
 */
function CheckinPill({ couple }: { couple: Couple; onSaved: (next: Couple) => void }) {
  const { t } = useT();
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  // General check-in link: the couple identifier pre-filled, no household code.
  // The couple can open it to preview, or share it so guests land straight on
  // /rsvp with the couple field done and only their own code left to type.
  const generalUrl =
    typeof window !== "undefined" && couple.slug
      ? `${window.location.origin}/rsvp?couple=${encodeURIComponent(couple.slug)}`
      : null;

  async function copyGeneralLink() {
    if (!generalUrl) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no_clipboard");
      await navigator.clipboard.writeText(generalUrl);
      toast.success(t("guests.checkin_link_copied"));
    } catch {
      toast.error(t("common.error_generic"));
    }
  }
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
          {couple.slug ?? "-"}
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
        <div className="border-t border-paper-300 px-4 py-4 dark:border-umber-700">
          {generalUrl ? (
            // One focused card: the shareable link is the whole point here.
            // The identifier rides along as a locked chip (its rationale on
            // hover) instead of a second, redundant block.
            <div className="rounded-xl border border-paper-200 bg-paper-50 p-4 dark:border-umber-700 dark:bg-umber-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-ink-500 dark:text-umber-300">
                  {t("guests.checkin_open_title")}
                </p>
                <span
                  title={t("guests.couple_slug_help_locked")}
                  className="inline-flex items-center gap-1 rounded-full bg-paper-100 px-2 py-0.5 font-mono text-xs uppercase tracking-[0.2em] text-ink-700 dark:bg-umber-700 dark:text-paper-100"
                >
                  <Lock size={11} aria-hidden /> {couple.slug ?? "-"}
                </span>
              </div>

              {/* The link reads as a real input field: a bordered well with an
                  inline copy affordance on the right, the way every "share
                  link" surface does it. On desktop the whole control collapses
                  to a single row so it stays compact; it stacks only on mobile. */}
              <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-stretch">
                <div className="flex min-w-0 flex-1 items-center rounded-lg border border-paper-300 bg-paper-100/60 px-3 py-2 dark:border-umber-600 dark:bg-umber-700/50">
                  <span className="truncate font-mono text-sm text-ink-900 dark:text-paper-50">
                    {generalUrl.replace(/^https?:\/\//, "")}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={copyGeneralLink}
                  aria-label={t("guests.checkin_copy_link")}
                  title={t("guests.checkin_copy_link")}
                  className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-paper-300 px-3 text-sm text-ink-600 transition-colors hover:bg-paper-100 dark:border-umber-600 dark:text-umber-200 dark:hover:bg-umber-700 sm:h-auto sm:w-9 sm:px-0"
                >
                  <ClipboardCopy size={15} aria-hidden="true" />
                  <span className="sm:hidden">{t("guests.checkin_copy_link")}</span>
                </button>
                <a
                  href={generalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-outline btn-sm shrink-0 justify-center sm:w-auto"
                >
                  <Link2 size={14} aria-hidden="true" /> {t("guests.checkin_open_rsvp")}
                </a>
              </div>

              <p className="mt-2.5 text-xs text-ink-500 dark:text-umber-300">
                {t("guests.checkin_open_help")}
              </p>
            </div>
          ) : (
            <p className="text-xs text-ink-500 dark:text-umber-300">
              {t("guests.couple_slug_help")}
            </p>
          )}

          <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-500 dark:text-umber-300">
            <Users size={13} aria-hidden className="mt-0.5 shrink-0" />
            <span>{t("guests.household_section_help")}</span>
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
  // Sub-6-char label for the mobile chip body. Icons-only is fine at sm+
  // where the tooltip is reachable; on touch widths we surface the state in
  // text so a glance answers "did we send this one yet?".
  const shortLabel =
    state === "delivered"
      ? t("guests.delivered_short")
      : state === "invited"
        ? t("guests.invited_short")
        : t("guests.invite_state_not_invited_short");
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
  const openedAt = guest.invitation_opened_at;
  const openedLabel = openedAt
    ? t("guests.invite_email_opened_at").replace(
        "{date}",
        new Date(openedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      )
    : null;

  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        onClick={onCycle}
        title={`${label}: ${nextHint}`}
        aria-label={`${label}. ${nextHint}`}
        aria-pressed={state !== "not_invited"}
        /* Single small dot at every viewport — the prior `h-8 min-w-[3.5rem]`
         *  chip with the "Meghívva" / "Átadva" / "-" text was a full-width
         *  pill on mobile that ate the row before the name even rendered.
         *  The header already carries the "0/2 meghívva" tally so the per-
         *  member text was redundant; cycling tap target stays at the
         *  WCAG-min 24px chip + the surrounding row hit area. */
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-ink-500 focus:ring-offset-1 ${cls}`}
      >
        <span className="sr-only">{shortLabel}</span>
        {state === "delivered" ? (
          <CheckCheck size={14} strokeWidth={2.5} aria-hidden="true" />
        ) : state === "invited" ? (
          <Check size={14} strokeWidth={2.5} aria-hidden="true" />
        ) : (
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />
        )}
      </button>
      {openedLabel && (
        <span title={openedLabel}>
          <Eye
            size={11}
            strokeWidth={2}
            aria-label={openedLabel}
            className="text-ink-400 dark:text-umber-400"
          />
        </span>
      )}
    </span>
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
  onDark = false,
}: {
  household: Household;
  count: number;
  onSave: (label: string) => Promise<void>;
  /** True on the hosts' dark chocolate header — flips the label + count
   *  text to a light tone so it reads on the dark bar. */
  onDark?: boolean;
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
          className="input flex-1 text-base font-medium sm:text-sm"
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
      className={`inline-flex max-w-full items-baseline gap-1.5 truncate rounded text-left text-base font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink-400 dark:focus-visible:outline-umber-600 ${
        onDark
          ? "text-paper-50 hover:text-paper-200"
          : "text-ink-900 hover:text-ink-700 dark:text-paper-50 dark:hover:text-paper-100"
      }`}
    >
      <span className="truncate">{household.label}</span>
      <span
        className={`text-sm font-normal ${onDark ? "text-paper-200/80" : "text-ink-500 dark:text-umber-300"}`}
      >
        ({count})
      </span>
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

/** Briefcase glyph next to a guest who's tagged as a supplier (DJ,
 *  photographer, ...). Renders nothing for regular guests. */
function SupplierIcon({ show }: { show: boolean | undefined }) {
  const { t } = useT();
  if (!show) return null;
  return (
    <Briefcase
      size={13}
      aria-label={t("guests.supplier_badge")}
      className="shrink-0 text-umber-600 dark:text-umber-300"
    />
  );
}

/** "+1" chip next to a guest auto-created from someone's plus-one, so the
 *  couple can tell materialised plus-ones apart from primary guests. */
function PlusOneBadge({ show }: { show: boolean | undefined }) {
  const { t } = useT();
  if (!show) return null;
  return (
    <span
      title={t("guests.plus_one_badge")}
      aria-label={t("guests.plus_one_badge")}
      className="shrink-0 rounded-full border border-paper-300 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-ink-600 dark:border-umber-700 dark:text-paper-100"
    >
      +1
    </span>
  );
}

/** Inline royalty glyph next to the bride / groom rows so the couple can
 *  spot themselves at a glance. Bride gets the Gem (kept in sync with the
 *  `her_family` group icon — diamond for the bride side); groom keeps the
 *  Crown. Title doubles as tooltip + a11y label. Renders nothing for
 *  regular guests. */
function PartnerRoleIcon({ role }: { role: "bride" | "groom" | null }) {
  const { t } = useT();
  if (!role) return null;
  const label = t(`guests.partner_role_${role}`);
  const Icon = role === "bride" ? Gem : Crown;
  return (
    <span title={label} className="inline-flex shrink-0">
      <Icon size={14} aria-label={label} className="text-umber-600 dark:text-umber-300" />
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
type DietaryTag = "lactose" | "milk_protein" | "gluten" | "nut" | "egg" | "fish_shellfish";
const DIETARY_TAG_KEYS: DietaryTag[] = [
  "milk_protein",
  "lactose",
  "gluten",
  "nut",
  "egg",
  "fish_shellfish",
];

// Run order matters: milk_protein BEFORE lactose so the "tejfehérje-allergia"
// token isn't shortened to "tej" + bare lactose hit. (See HouseholdRsvpForm
// for the matching producer side — the two files must stay in lock-step.)
const DIETARY_DETECTORS: { kind: DietaryTag; re: RegExp }[] = [
  { kind: "milk_protein", re: /(?:tejfehérje|tejfeherje|milk[- ]?protein|casein|kazein)[^,;\s]*/i },
  { kind: "lactose", re: /(?:laktóz|lactose)[^,;\s]*/i },
  { kind: "gluten", re: /(?:glutén|gluten)[^,;\s]*/i },
  { kind: "nut", re: /(?:mogyoró|peanut|nut[- ]?aller)[^,;\s]*/i },
  { kind: "egg", re: /(?:tojás|tojas|egg[- ]?aller|egg)[^,;\s]*/i },
  {
    kind: "fish_shellfish",
    re: /(?:hal-tengeri|hal[- ]?aller|tengeri[- ]?herkenty|shellfish|seafood|crustacean)[^,;\s]*/i,
  },
];

// Stored tokens — must match what HouseholdRsvpForm writes so chips round-trip
// no matter which side last edited the row.
const DIETARY_TOKEN: Record<DietaryTag, string> = {
  lactose: "laktóz-érzékeny",
  milk_protein: "tejfehérje-allergia",
  gluten: "gluténmentes",
  nut: "mogyoró-allergia",
  egg: "tojás-allergia",
  fish_shellfish: "hal-tengeri-allergia",
};

// Semantic colour family per allergen — kept in lock-step with the public
// RSVP form's DIETARY_TONE tables. Lactose + milk-protein share the dairy
// (sky) palette and are differentiated by icon: plain Milk for lactose,
// Milk + Atom composite for milk-protein.
type DietaryTone = "dairy" | "wheat" | "nut" | "egg" | "seafood";

const DIETARY_TAG_TONE: Record<DietaryTag, DietaryTone> = {
  milk_protein: "dairy",
  lactose: "dairy",
  gluten: "wheat",
  nut: "nut",
  egg: "egg",
  fish_shellfish: "seafood",
};

const DIETARY_TONE_ACTIVE: Record<DietaryTone, string> = {
  dairy:
    "border-2 border-sky-600 bg-sky-600 text-white dark:border-sky-400 dark:bg-sky-500 dark:text-umber-900",
  wheat:
    "border-2 border-amber-600 bg-amber-600 text-white dark:border-amber-400 dark:bg-amber-500 dark:text-umber-900",
  nut: "border-2 border-orange-700 bg-orange-700 text-white dark:border-orange-400 dark:bg-orange-500 dark:text-umber-900",
  egg: "border-2 border-yellow-500 bg-yellow-500 text-umber-900 dark:border-yellow-400 dark:bg-yellow-400 dark:text-umber-900",
  seafood:
    "border-2 border-cyan-700 bg-cyan-700 text-white dark:border-cyan-400 dark:bg-cyan-500 dark:text-umber-900",
};

const DIETARY_TONE_IDLE: Record<DietaryTone, string> = {
  dairy:
    "border border-sky-300 bg-sky-50 text-sky-800 hover:border-sky-500 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300 dark:hover:border-sky-400/70",
  wheat:
    "border border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-500 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300 dark:hover:border-amber-400/70",
  nut: "border border-orange-300 bg-orange-50 text-orange-800 hover:border-orange-500 dark:border-orange-400/40 dark:bg-orange-400/10 dark:text-orange-300 dark:hover:border-orange-400/70",
  egg: "border border-yellow-300 bg-yellow-50 text-yellow-800 hover:border-yellow-500 dark:border-yellow-400/40 dark:bg-yellow-400/10 dark:text-yellow-300 dark:hover:border-yellow-400/70",
  seafood:
    "border border-cyan-300 bg-cyan-50 text-cyan-800 hover:border-cyan-500 dark:border-cyan-400/40 dark:bg-cyan-400/10 dark:text-cyan-300 dark:hover:border-cyan-400/70",
};

function DietaryTagIcon({ tag }: { tag: DietaryTag }) {
  switch (tag) {
    case "milk_protein":
      return (
        <span className="inline-flex shrink-0 items-center">
          <Milk size={14} aria-hidden />
          <Atom size={10} aria-hidden className="-ml-1 self-start" />
        </span>
      );
    case "lactose":
      return <Milk size={14} aria-hidden />;
    case "gluten":
      return <Wheat size={14} aria-hidden />;
    case "nut":
      return <Nut size={14} aria-hidden />;
    case "egg":
      return <Egg size={14} aria-hidden />;
    case "fish_shellfish":
      return <Shell size={14} aria-hidden />;
  }
}

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
  tags: Set<DietaryTag>;
  remainder: string;
} {
  const tags = new Set<DietaryTag>();
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
      {tags.has("milk_protein") && (
        <span title={t("rsvp.tag_milk_protein")} className="inline-flex items-center">
          <Milk size={14} aria-label={t("rsvp.tag_milk_protein")} />
          <Atom size={10} aria-hidden className="-ml-1 self-start" />
        </span>
      )}
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
      {tags.has("egg") && (
        <span title={t("rsvp.tag_egg")} className="inline-flex">
          <Egg size={14} aria-label={t("rsvp.tag_egg")} />
        </span>
      )}
      {tags.has("fish_shellfish") && (
        <span title={t("rsvp.tag_fish_shellfish")} className="inline-flex">
          <Shell size={14} aria-label={t("rsvp.tag_fish_shellfish")} />
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
  guests,
  couple,
  onClose,
  onSaved,
}: {
  init: DrawerInit;
  households: Household[];
  /** Full guest roster, used by the "new household" input to suggest existing
   *  households (by label) and existing guests (by name) — clicking a hit
   *  switches the mode to "existing" and attaches the new guest there. */
  guests: Guest[];
  /** The current couple workspace. The "needs accommodation?" checkbox is
   *  now gated by the selected household's `rsvp_offers_accommodation`
   *  flag (the toggle moved off `couples` in May 2026), but we keep the
   *  prop so future drawer surfaces can still read couple-scoped fields
   *  without a refactor. Null briefly during initial load. */
  couple: Couple | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, locale } = useT();
  const guest = init.guest;

  // Default-collapse the "filled by the guest via RSVP" block for new guests
  // so the couple doesn't feel obligated to fill in answers that belong to the
  // guest's own RSVP submission. Expand it automatically when editing an
  // existing guest who already has any of these fields populated, so the
  // couple sees what's already there without an extra click.
  const guestSectionHasData =
    guest != null &&
    (guest.rsvp_status !== "pending" ||
      guest.meal_choice !== null ||
      (guest.dietary !== null && guest.dietary.trim() !== "") ||
      guest.accommodation_needed ||
      (guest.song_request !== null && guest.song_request.trim() !== "") ||
      (guest.notes !== null && guest.notes.trim() !== ""));
  const [rsvpSectionExpanded, setRsvpSectionExpanded] = useState(guestSectionHasData);

  // Adding straight into the couple's "Suppliers" (Szolgáltatók) household —
  // via that card's "Add a member" button — pre-selects RSVP "yes": booked
  // vendors count as sure participants, not invitees waiting to reply. The
  // backend enforces the matching is_supplier flag for this group regardless.
  const intoSupplierHousehold =
    guest == null &&
    init.defaultHouseholdId != null &&
    households.some((h) => h.id === init.defaultHouseholdId && h.is_supplier_household);

  const [form, setForm] = useState<Partial<Guest>>(
    guest ?? {
      full_name: "",
      email: null,
      phone: null,
      group_tag: "other",
      kind: "adult",
      rsvp_status: intoSupplierHousehold ? "yes" : "pending",
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
  // Per-household opt-in for the public RSVP "needs accommodation?" question,
  // surfaced only in `new` mode — for existing households the Bed icon on
  // the household card is the canonical edit surface. Plumbed through the
  // backend as `new_household_offers_accommodation` so the household gets
  // created with the flag set in a single round-trip.
  const [newHouseholdOffersAccommodation, setNewHouseholdOffersAccommodation] = useState(false);
  // Create-only — when the couple has typed an email on a new guest, surface
  // a "send invite now" toggle that fires the `guest_invite` email on save.
  // Defaults off so the existing "create silently, send invites later in bulk"
  // workflow keeps working unchanged. We never show this on edit because the
  // dedicated resend endpoint hasn't shipped yet.
  const [sendInvite, setSendInvite] = useState(false);

  /** Autocomplete hits for the "Új háztartás" input. Match existing
   *  households by label, then existing guests by full_name (their
   *  household becomes the suggestion). Households a guest match would
   *  redundantly point to are deduped so the user doesn't see the same
   *  household twice. Cap at 6 — longer than that the user should refine
   *  the query rather than scroll. */
  const householdSuggestions = useMemo(() => {
    const q = newHouseholdLabel.trim().toLowerCase();
    if (!q)
      return [] as Array<
        | { kind: "household"; household: Household }
        | { kind: "guest"; guest: Guest; household: Household | null }
      >;
    const seenHh = new Set<number>();
    const out: Array<
      | { kind: "household"; household: Household }
      | { kind: "guest"; guest: Guest; household: Household | null }
    > = [];
    for (const h of households) {
      if (h.label.toLowerCase().includes(q)) {
        out.push({ kind: "household", household: h });
        seenHh.add(h.id);
      }
    }
    for (const g of guests) {
      if (guest && g.id === guest.id) continue; // skip self when editing
      if (!g.household_id || seenHh.has(g.household_id)) continue;
      if (g.full_name.toLowerCase().includes(q)) {
        const hh = households.find((h) => h.id === g.household_id) ?? null;
        out.push({ kind: "guest", guest: g, household: hh });
        if (hh) seenHh.add(hh.id);
      }
      if (out.length >= 6) break;
    }
    return out.slice(0, 6);
  }, [newHouseholdLabel, households, guests, guest]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  function buildBody(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      ...form,
      dietary: buildDietary(dietaryTags, dietaryFree),
      song_request: serializeSongRequests(songs),
    };
    // A "+1" carries its host id and inherits the host's household — the manual
    // household picker is hidden, so don't send household fields. Anything else
    // explicitly detaches (plus_one_of: null) so re-saving a former +1 as a
    // normal guest clears the link server-side.
    if (form.is_plus_one) {
      body.plus_one_of = form.plus_one_of ?? null;
    } else {
      body.plus_one_of = null;
      if (householdMode === "existing" && householdId) {
        body.household_id = householdId;
      } else if (householdMode === "new") {
        body.household_id = null;
        const label = newHouseholdLabel.trim();
        if (label) body.new_household_label = label;
        if (newHouseholdOffersAccommodation) {
          body.new_household_offers_accommodation = true;
        }
      }
    }
    if (!guest && sendInvite && (form.email ?? "").trim()) {
      body.send_invite = true;
    }
    return body;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.full_name?.trim()) {
      setError(t("guests.full_name"));
      return;
    }
    if (form.is_plus_one && !form.plus_one_of) {
      setError(t("guests.plus_one_assign_required"));
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
    <Dialog
      open
      role="dialog"
      title={guest ? t("guests.edit") : t("guests.add")}
      size="lg"
      onClose={() => void autoSaveAndClose()}
      closeOnBackdrop={!submitting}
      footer={
        <>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void autoSaveAndClose()}
            disabled={submitting}
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            form="guest-edit-form"
            className="btn-primary"
            disabled={submitting}
          >
            {submitting ? t("guests.saving") : t("common.save")}
          </button>
        </>
      }
    >
      <form id="guest-edit-form" onSubmit={onSubmit} className="flex flex-col">
        <div>
          {/* Name reads as the drawer's headline — a borderless serif input
              that looks like display text but stays editable, with a faint
              underline on focus so the affordance is still legible. */}
          <input
            type="text"
            value={form.full_name ?? ""}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            placeholder={t("guests.full_name")}
            aria-label={t("guests.full_name")}
            className="mb-5 w-full border-0 border-b border-transparent bg-transparent px-0 pb-1 pt-0 font-grotesk text-3xl font-medium text-ink-900 placeholder:text-ink-300 focus:border-ink-300 focus:outline-none focus:ring-0 dark:text-paper-50 dark:placeholder:text-umber-500 dark:focus:border-umber-500"
          />

          <Field
            label={t("guests.email")}
            value={form.email ?? ""}
            onChange={(v) => setForm({ ...form, email: v || null })}
            type="email"
          />
          {!guest &&
            (() => {
              const hasEmail = (form.email ?? "").trim().length > 0;
              return (
                <div className="-mt-2 mb-3">
                  <label
                    className={`flex items-start gap-2 text-sm ${
                      hasEmail
                        ? "text-ink-700 dark:text-paper-100"
                        : "cursor-not-allowed text-ink-400 dark:text-umber-400"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-paper-400 accent-blush-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blush-600 disabled:cursor-not-allowed disabled:opacity-50"
                      checked={sendInvite && hasEmail}
                      disabled={!hasEmail}
                      onChange={(e) => setSendInvite(e.target.checked)}
                    />
                    <span>
                      <span className="block">{t("guests.send_invite_label")}</span>
                      <span className="block text-xs text-ink-500 dark:text-umber-300">
                        {hasEmail
                          ? t("guests.send_invite_help")
                          : t("guests.send_invite_disabled_help")}
                      </span>
                    </span>
                  </label>
                </div>
              );
            })()}
          <Field
            label={t("guests.phone")}
            value={form.phone ?? ""}
            onChange={(v) => setForm({ ...form, phone: v || null })}
          />

          {/* Group picker only when creating a new household — the household
              owns the group_tag and every member inherits it. For an existing
              household the chip in the header is the single edit surface. */}
          {householdMode === "new" && (
            <div className="mb-3">
              <label className="field-label">{t("guests.group")}</label>
              <div className="grid grid-cols-7 gap-2">
                {GROUPS.map((g) => (
                  <SegmentButton
                    key={g}
                    active={(form.group_tag ?? "other") === g}
                    onClick={() => setForm({ ...form, group_tag: g })}
                    icon={<GroupIcon group={g} />}
                    label={t(`guests.group_${g}`)}
                    iconOnly
                  />
                ))}
              </div>
            </div>
          )}

          <div className="mb-3">
            <label className="field-label">{t("guests.kind_label")}</label>
            <p className="mb-2 text-xs text-ink-500 dark:text-umber-300">
              {form.is_plus_one
                ? t("guests.plus_one_type_help")
                : form.is_supplier
                  ? t("guests.supplier_help")
                  : t("guests.kind_help")}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {(["adult", "child", "baby"] as GuestKind[]).map((k) => (
                <SegmentButton
                  key={k}
                  active={!form.is_supplier && !form.is_plus_one && (form.kind ?? "adult") === k}
                  onClick={() =>
                    setForm({
                      ...form,
                      is_supplier: false,
                      is_plus_one: false,
                      plus_one_of: null,
                      kind: k,
                    })
                  }
                  icon={<KindIcon kind={k} />}
                  label={t(`guests.kind_${k}`)}
                />
              ))}
              <SegmentButton
                active={form.is_plus_one ?? false}
                onClick={() => setForm({ ...form, is_plus_one: true, is_supplier: false })}
                icon={<UserPlus size={14} aria-hidden className="shrink-0" />}
                label={t("guests.kind_plus_one")}
              />
              <SegmentButton
                active={(form.is_supplier ?? false) && !form.is_plus_one}
                onClick={() =>
                  setForm({ ...form, is_supplier: true, is_plus_one: false, plus_one_of: null })
                }
                icon={<Briefcase size={14} aria-hidden className="shrink-0" />}
                label={t("guests.kind_supplier")}
              />
            </div>
          </div>

          {/* "+1" host picker — a +1 is assigned to an existing guest and joins
              that guest's household. Eligible hosts exclude suppliers, other
              +1s (no chains), and the guest being edited. */}
          {form.is_plus_one &&
            (() => {
              const hosts = guests.filter(
                (g) => g.id !== guest?.id && !g.is_supplier && !g.is_plus_one,
              );
              return (
                <div className="mb-3">
                  <label className="field-label" htmlFor="guest-plus-one-of">
                    {t("guests.plus_one_assign_label")}
                  </label>
                  <p className="mb-2 text-xs text-ink-500 dark:text-umber-300">
                    {t("guests.plus_one_assign_help")}
                  </p>
                  {hosts.length === 0 ? (
                    <p className="rounded-xl bg-paper-100 px-3 py-2 text-sm text-ink-500 dark:bg-umber-700/60 dark:text-umber-300">
                      {t("guests.plus_one_assign_empty")}
                    </p>
                  ) : (
                    <select
                      id="guest-plus-one-of"
                      className="input"
                      value={form.plus_one_of ?? ""}
                      onChange={(e) =>
                        setForm({ ...form, plus_one_of: Number(e.target.value) || null })
                      }
                    >
                      <option value="">{t("guests.plus_one_assign_placeholder")}</option>
                      {hosts.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.full_name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })()}

          {/* Suppliers are auto-routed to the supplier household server-side,
              and a "+1" inherits its host's household — so the manual picker is
              hidden for both. */}
          {!form.is_supplier && !form.is_plus_one && (
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
                <div className="mt-2">
                  <input
                    className="input"
                    placeholder={t("guests.household_new_label")}
                    value={newHouseholdLabel}
                    onChange={(e) => setNewHouseholdLabel(e.target.value)}
                  />
                  {/* Autocomplete results — clicking a row switches the form
                    to "existing household" mode and attaches the new guest
                    to that household. The new-label input is cleared so
                    submit doesn't ALSO create a fresh household with the
                    same name. */}
                  <label className="mt-2 flex items-start gap-2 text-sm text-ink-700 dark:text-paper-100">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={newHouseholdOffersAccommodation}
                      onChange={(e) => setNewHouseholdOffersAccommodation(e.target.checked)}
                    />
                    <span className="inline-flex items-center gap-1.5">
                      <Bed
                        size={14}
                        aria-hidden
                        className="shrink-0 text-ink-500 dark:text-umber-300"
                      />
                      {t("guests.rsvp_offers_accommodation_short")}
                    </span>
                  </label>
                  {householdSuggestions.length > 0 && (
                    <ul className="mt-2 divide-y divide-paper-200 overflow-hidden rounded-xl border border-paper-300 bg-paper-50 dark:divide-umber-700 dark:border-umber-700 dark:bg-umber-800">
                      {householdSuggestions.map((s) => {
                        const targetHouseholdId =
                          s.kind === "household" ? s.household.id : (s.household?.id ?? null);
                        const targetHouseholdLabel =
                          s.kind === "household" ? s.household.label : (s.household?.label ?? null);
                        return (
                          <li
                            key={s.kind === "household" ? `h-${s.household.id}` : `g-${s.guest.id}`}
                          >
                            <button
                              type="button"
                              disabled={targetHouseholdId === null}
                              onClick={() => {
                                if (targetHouseholdId === null) return;
                                setHouseholdMode("existing");
                                setHouseholdId(targetHouseholdId);
                                setNewHouseholdLabel("");
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-900 hover:bg-paper-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-paper-100 dark:hover:bg-umber-700"
                            >
                              {s.kind === "household" ? (
                                <Home
                                  size={14}
                                  aria-hidden
                                  className="shrink-0 text-ink-500 dark:text-umber-300"
                                />
                              ) : (
                                <User
                                  size={14}
                                  aria-hidden
                                  className="shrink-0 text-ink-500 dark:text-umber-300"
                                />
                              )}
                              <span className="truncate">
                                {s.kind === "household"
                                  ? `${s.household.label} (${s.household.member_ids.length})`
                                  : s.guest.full_name}
                              </span>
                              {s.kind === "guest" && targetHouseholdLabel && (
                                <span className="ml-auto truncate text-xs text-ink-500 dark:text-umber-300">
                                  {targetHouseholdLabel}
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Guest-fills divider ─────────────────────────────────────
              Visual break so the couple sees at a glance which fields are
              "what we know about this guest" (above: name, contact,
              household) vs "the guest's own answers" (below: RSVP, meal,
              dietary, etc.) — the couple can pre-fill these too, but the
              public RSVP form is the canonical author. */}
          <button
            type="button"
            onClick={() => setRsvpSectionExpanded((v) => !v)}
            aria-expanded={rsvpSectionExpanded}
            aria-controls="guest-section-by-rsvp"
            className="my-4 flex w-full items-center gap-3 text-xs uppercase tracking-wider text-ink-500 transition-colors hover:text-ink-700 dark:text-umber-300 dark:hover:text-paper-100"
          >
            <span className="h-px flex-1 bg-paper-300 dark:bg-umber-700" aria-hidden />
            <span className="inline-flex items-center gap-1.5">
              {t("guests.guest_section_divider")}
              <ChevronDown
                size={14}
                aria-hidden
                className={
                  rsvpSectionExpanded ? "transition-transform" : "-rotate-90 transition-transform"
                }
              />
            </span>
            <span className="h-px flex-1 bg-paper-300 dark:bg-umber-700" aria-hidden />
          </button>

          {rsvpSectionExpanded && (
            <div id="guest-section-by-rsvp">
              <div className="mb-3">
                <label className="field-label">{t("guests.rsvp")}</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["yes", "no", "maybe"] as RsvpStatus[]).map((s) => {
                    const chosen = form.rsvp_status === s;
                    const hasAnswer =
                      form.rsvp_status === "yes" ||
                      form.rsvp_status === "no" ||
                      form.rsvp_status === "maybe";
                    return (
                      <SegmentButton
                        key={s}
                        active={chosen}
                        // No standalone Pending: an unanswered RSVP reads all-grey,
                        // and re-clicking the chosen answer clears back to pending.
                        onClick={() => setForm({ ...form, rsvp_status: chosen ? "pending" : s })}
                        icon={<RsvpGlyph status={s} />}
                        label={t(`guests.rsvp_${s}`)}
                        compact
                        small={hasAnswer && !chosen}
                        tone={chosen ? s : "default"}
                      />
                    );
                  })}
                </div>
                {guest?.rsvp_responded_at != null && (
                  <p className="mt-1.5 text-xs text-ink-500 dark:text-umber-300">
                    {t("guests.rsvp_filled_at", {
                      date: new Date(guest.rsvp_responded_at).toLocaleDateString(
                        locale === "hu" ? "hu-HU" : "en-GB",
                        { year: "numeric", month: "short", day: "numeric" },
                      ),
                    })}
                  </p>
                )}
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
                  {(
                    ["milk_protein", "lactose", "gluten", "nut", "egg", "fish_shellfish"] as const
                  ).map((tag) => (
                    <DietaryChip
                      key={tag}
                      on={dietaryTags.has(tag)}
                      onClick={() => toggleSetMember(setDietaryTags, tag)}
                      icon={<DietaryTagIcon tag={tag} />}
                      label={t(`rsvp.tag_${tag}`)}
                      tone={DIETARY_TAG_TONE[tag]}
                    />
                  ))}
                </div>
                <input
                  className="input text-sm font-sans"
                  type="text"
                  value={dietaryFree}
                  onChange={(e) => setDietaryFree(e.target.value)}
                  placeholder={t("guests.allergies_placeholder")}
                />
              </div>

              {/* Plus-one — the couple fills the guest's +1 on their behalf;
                  on save the backend materialises it as a real guest in the
                  same household, then clears this field. Hidden when the guest
                  is itself a +1 (a +1 can't carry its own +1). */}
              {!form.is_plus_one && (
                <div className="mb-3">
                  <label className="field-label" htmlFor="guest-plus-one">
                    {t("guests.plus_one_label")}
                  </label>
                  <p className="mb-2 text-xs text-ink-500 dark:text-umber-300">
                    {t("guests.plus_one_help")}
                  </p>
                  <input
                    id="guest-plus-one"
                    className="input font-sans text-sm"
                    type="text"
                    value={form.plus_one_name ?? ""}
                    onChange={(e) => setForm({ ...form, plus_one_name: e.target.value || null })}
                    placeholder={t("guests.plus_one_placeholder")}
                  />
                </div>
              )}

              {/* Per-household opt-in for the accommodation field. The
                  toggle moved off `couples` in May 2026; we now resolve it
                  from the guest's selected household (existing-mode), or
                  default to off for a brand-new household that hasn't been
                  saved yet (the user can flip the toggle on the household
                  card after creation if they want this column populated). */}
              {(householdMode === "existing" &&
                households.find((h) => h.id === householdId)?.rsvp_offers_accommodation) ===
                true && (
                <label className="mb-3 flex items-center gap-2 text-sm text-ink-700 dark:text-paper-100">
                  <input
                    type="checkbox"
                    checked={Boolean(form.accommodation_needed)}
                    onChange={(e) => setForm({ ...form, accommodation_needed: e.target.checked })}
                  />
                  {t("guests.accommodation")}
                </label>
              )}

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
            </div>
          )}

          {error && <p className="field-error">{error}</p>}
        </div>
      </form>
    </Dialog>
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
/** Optional semantic tint for option buttons. RSVP states get one each so
 *  the four buttons are distinguishable at a glance even when none is the
 *  selected one — the glyphs already disambiguate for colour-deficient
 *  users, so the tint is additive information, not the sole signal. */
type SegmentTone = "default" | "yes" | "no" | "maybe" | "pending";

const SEGMENT_TONE_ACTIVE: Record<SegmentTone, string> = {
  default:
    "border-2 border-ink-700 bg-ink-700 font-medium text-paper-100 dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900",
  yes: "border-2 border-emerald-600 bg-emerald-600 font-medium text-white dark:border-emerald-400 dark:bg-emerald-500 dark:text-umber-900",
  no: "border-2 border-rose-700 bg-rose-700 font-medium text-white dark:border-rose-400 dark:bg-rose-500 dark:text-umber-900",
  maybe:
    "border-2 border-slate-600 bg-slate-600 font-medium text-white dark:border-slate-400 dark:bg-slate-400 dark:text-umber-900",
  pending:
    "border-2 border-amber-600 bg-amber-500 font-medium text-umber-900 dark:border-amber-400 dark:bg-amber-400 dark:text-umber-900",
};

const SEGMENT_TONE_IDLE: Record<SegmentTone, string> = {
  default:
    "border border-paper-300 bg-paper-50 text-ink-700 hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600",
  yes: "border border-emerald-300 bg-emerald-50 text-emerald-800 hover:border-emerald-500 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-300 dark:hover:border-emerald-400/70",
  no: "border border-rose-300 bg-rose-50 text-rose-800 hover:border-rose-500 dark:border-rose-400/40 dark:bg-rose-400/10 dark:text-rose-300 dark:hover:border-rose-400/70",
  maybe:
    "border border-slate-300 bg-slate-50 text-slate-700 hover:border-slate-500 dark:border-slate-400/40 dark:bg-slate-400/10 dark:text-slate-300 dark:hover:border-slate-400/70",
  pending:
    "border border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-500 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300 dark:hover:border-amber-400/70",
};

function SegmentButton({
  active,
  onClick,
  icon,
  label,
  disabled,
  compact,
  small,
  iconOnly,
  tone = "default",
}: {
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  label: string;
  disabled?: boolean;
  compact?: boolean;
  /** Shrink an unchosen option so a selected sibling reads as the headline —
   *  used by the RSVP row once an answer is picked. */
  small?: boolean;
  /** Render the icon only — keep the label as `title` + `aria-label`. Used
   *  by the group-tag picker where 7 options would never fit horizontally
   *  with text on mobile. */
  iconOnly?: boolean;
  tone?: SegmentTone;
}) {
  const pad = iconOnly
    ? "px-2 py-2"
    : small
      ? "px-1.5 py-1 text-[11px]"
      : compact
        ? "px-2 py-1.5 text-xs"
        : "px-3 py-2 text-sm";
  const base = `flex items-center justify-center gap-1.5 rounded-xl ${pad} transition-colors`;
  const toneCls = active ? SEGMENT_TONE_ACTIVE[tone] : SEGMENT_TONE_IDLE[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={iconOnly ? label : undefined}
      className={`${base} ${toneCls} disabled:cursor-not-allowed disabled:opacity-50${iconOnly ? " group relative" : ""}`}
    >
      {iconOnly && (
        <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-[11px] text-white opacity-0 group-hover:opacity-100">
          {label}
        </span>
      )}
      {icon}
      {!iconOnly && <span className="truncate">{label}</span>}
    </button>
  );
}

/** Icon glyph for each guest group tag. Crown for the groom side, Gem for
 *  the bride side — mirrors `PartnerRoleIcon` so a household card chip and
 *  the bride/groom row glyph read as the same visual language. The earlier
 *  User / User2 silhouettes were near-identical at chip size and made the
 *  two "családja" chips indistinguishable in the household list. */
function GroupIcon({ group }: { group: GuestGroupTag }) {
  const size = 16;
  switch (group) {
    case "his_family":
      return <Crown size={size} aria-hidden />;
    case "her_family":
      return <Gem size={size} aria-hidden />;
    case "his_friends":
      return (
        <>
          <Crown size={size} aria-hidden />
          <Users size={size} aria-hidden />
        </>
      );
    case "her_friends":
      return (
        <>
          <Gem size={size} aria-hidden />
          <Users size={size} aria-hidden />
        </>
      );
    case "shared_friends":
      return <Heart size={size} aria-hidden />;
    case "work":
      return <Briefcase size={size} aria-hidden />;
    case "other":
      return <MoreHorizontal size={size} aria-hidden />;
  }
}

/** Compact group picker rendered inline in a household header. Shows the
 *  icon + label as a button; the actual dropdown is a transparent native
 *  <select> overlaying the chip — that side-steps positioning + z-index
 *  inside the card's overflow-clipped container, and gets keyboard support
 *  for free. */
function HouseholdGroupChip({
  value,
  onChange,
}: {
  value: GuestGroupTag;
  onChange: (g: GuestGroupTag) => void;
}) {
  const { t } = useT();
  return (
    <span className="relative inline-flex items-center gap-1.5 rounded-xl border border-paper-300 bg-paper-50 px-2 py-1 text-xs font-medium text-ink-700 transition-colors hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600">
      <GroupIcon group={value} />
      <span className="truncate">{t(`guests.group_${value}`)}</span>
      <ChevronDown size={12} aria-hidden className="text-ink-500 dark:text-umber-300" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as GuestGroupTag)}
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label={t("guests.group")}
      >
        {GROUPS.map((g) => (
          <option key={g} value={g}>
            {t(`guests.group_${g}`)}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Per-household toggle for "ask this household if they need accommodation
 *  in the RSVP form". When ON, the public RSVP form for this household
 *  shows the "needs accommodation?" checkbox (gated on
 *  `view.rsvp_offers_accommodation`); when OFF, the question is hidden.
 *  Renders as a Bed icon button — a clearly-green, ringed pill when on, and a
 *  barely-there faded icon (revealing on hover) when off — so the household
 *  card header doubles as a quick at-a-glance map of which families have been
 *  offered lodging. */
function AccommodationToggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  const { t } = useT();
  const label = on
    ? t("guests.household_accommodation_on")
    : t("guests.household_accommodation_off");
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={
        on
          ? "btn-ghost btn-sm text-sage-700 ring-1 ring-inset ring-sage-300 dark:text-sage-200 dark:ring-sage-400/40"
          : "btn-ghost btn-sm text-ink-300 opacity-40 transition-opacity hover:opacity-100 dark:text-umber-400"
      }
    >
      <Bed size={14} aria-hidden />
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
  tone,
}: {
  on: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  /** Optional semantic colour family — see DIETARY_TAG_TONE. */
  tone?: DietaryTone;
}) {
  const base = "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors";
  const neutral = on
    ? "border-2 border-ink-700 bg-ink-700 font-medium text-paper-100 dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900"
    : "border border-paper-300 bg-paper-50 text-ink-700 hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600";
  const toned = tone ? (on ? DIETARY_TONE_ACTIVE[tone] : DIETARY_TONE_IDLE[tone]) : neutral;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={onClick}
      className={`${base} ${tone && on ? "font-medium" : ""} ${toned}`}
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

/** Collapse a doubled protocol prefix in a pasted URL. The link input is
 *  pre-seeded with "https://" when the user clicks the chain icon, so pasting
 *  a full URL ("https://www.youtube.com/...") used to produce
 *  "https://https://www.youtube.com/...". Match two or more consecutive
 *  http(s):// prefixes and keep only the LAST one — that way pasting an
 *  `http://...` URL into a `https://`-seeded field correctly downgrades to
 *  the user's intended protocol. Partial typing like "https://h" is left
 *  alone (regex requires two FULL prefixes). */
function normalizeSongUrl(raw: string): string {
  return raw.replace(/^(?:https?:\/\/){2,}/i, (m) => {
    const matches = m.match(/https?:\/\//gi);
    return matches ? (matches[matches.length - 1] as string) : m;
  });
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
                  className="input flex-1 border-0 bg-transparent px-1 py-1 font-mono text-base focus:ring-0 sm:text-xs"
                  type="url"
                  value={row.url}
                  onChange={(e) => update(i, { url: normalizeSongUrl(e.target.value) })}
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

/** Pre-event roll-up surfaced via the toolbar "Étkezés" button. Counts meal
 *  selections + allergen tags across every guest who answered yes, so the
 *  couple can hand the caterer one clean tally instead of scrolling the
 *  list. "Copy as text" exports a plain summary suitable for email/Slack.
 *  Babies (`kind === "baby"`) are excluded from the meal pending count —
 *  they don't get a wedding-menu plate. `MEAL_ORDER` is imported from
 *  shared/meals so the dialog, the RSVP form and the backend agree on the
 *  slot set + order. */

function MealsDialog({
  guests,
  households,
  couple,
  onCoupleUpdate,
  onBulkRsvpToggle,
  onClose,
}: {
  guests: Guest[];
  households: Household[];
  /** The active couple — carries the editable `meal_menu` (custom labels +
   *  offered flags). Null only during the initial load. */
  couple: Couple | null;
  /** Bubble the saved couple back up so the page state (and the RSVP form's
   *  view) pick up the new menu without a refetch. */
  onCoupleUpdate: (next: Couple) => void;
  /** Flips the meal-collection flag on every household in one fan-out.
   *  `mealOn` reflects "ALL households have this on?" — mixed state renders
   *  as off, since toggling once will pull every household into a consistent
   *  state anyway. Accommodation is intentionally NOT here; that flag is set
   *  per-household via the Bed icon on each household card. */
  onBulkRsvpToggle: (field: "rsvp_collects_meal", next: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const mealOn = households.length > 0 && households.every((h) => h.rsvp_collects_meal);

  // Editable menu state. We seed a local draft from the couple and only PATCH
  // on Save, so typing a custom label never spams the API. `menu` is always the
  // canonical six slots in MEAL_ORDER (the couple mapper guarantees it).
  const savedMenu = couple?.meal_menu;
  const [editing, setEditing] = useState(false);
  const [draftMenu, setDraftMenu] = useState<MealMenu>(() =>
    savedMenu ? savedMenu.map((m) => ({ ...m })) : [],
  );
  const [savingMenu, setSavingMenu] = useState(false);
  // Re-seed the draft whenever the saved menu changes (e.g. a cross-tab edit)
  // and we're not mid-edit, so the view always reflects server truth.
  useEffect(() => {
    if (!editing && savedMenu) setDraftMenu(savedMenu.map((m) => ({ ...m })));
  }, [savedMenu, editing]);
  // The menu the read-only stats + labels resolve against: the live draft while
  // editing, otherwise the saved menu.
  const activeMenu: MealMenu = editing ? draftMenu : (savedMenu ?? draftMenu);
  const mealLabel = useCallback(
    (m: MealChoice): string =>
      activeMenu.find((x) => x.choice === m)?.label?.trim() || t(`guests.meal_${m}`),
    [activeMenu, t],
  );

  function patchSlot(
    choice: MealChoice,
    patch: Partial<{ label: string | null; enabled: boolean }>,
  ) {
    setDraftMenu((prev) => prev.map((m) => (m.choice === choice ? { ...m, ...patch } : m)));
  }

  async function saveMenu() {
    setSavingMenu(true);
    try {
      const normalized = normalizeMealMenuInput(draftMenu);
      const res = await coupleApi.update({ meal_menu: normalized });
      onCoupleUpdate(res.couple);
      setDraftMenu(res.couple.meal_menu.map((m) => ({ ...m })));
      setEditing(false);
      toast.success(t("guests.meals_menu_saved"));
    } catch {
      toast.error(t("common.error_generic"));
    } finally {
      setSavingMenu(false);
    }
  }

  function cancelEdit() {
    if (savedMenu) setDraftMenu(savedMenu.map((m) => ({ ...m })));
    setEditing(false);
  }

  const stats = useMemo(() => {
    const mealCounts: Record<MealChoice, number> = {
      meat: 0,
      fish: 0,
      vegetarian: 0,
      vegan: 0,
      child: 0,
      none: 0,
    };
    const dietaryCounts: Record<DietaryTag, number> = {
      lactose: 0,
      milk_protein: 0,
      gluten: 0,
      nut: 0,
      egg: 0,
      fish_shellfish: 0,
    };
    let pending = 0;
    let totalYes = 0;
    for (const g of guests) {
      if (g.rsvp_status !== "yes") continue;
      totalYes += 1;
      if (g.meal_choice) {
        mealCounts[g.meal_choice] += 1;
      } else if (g.kind !== "baby") {
        pending += 1;
      }
      const { tags } = parseDietaryTags(g.dietary);
      for (const tag of tags) dietaryCounts[tag] += 1;
    }
    return { mealCounts, dietaryCounts, pending, totalYes };
  }, [guests]);

  // Babies don't eat from the wedding menu, so the meals chart only counts
  // adults + children. Surface the count separately so the caterer still
  // knows how many infants to expect (high-chair / changing-room signal).
  const babyYes = useMemo(
    () => guests.filter((g) => g.rsvp_status === "yes" && g.kind === "baby").length,
    [guests],
  );
  // Denominator for the stacked bar and per-meal percentages: meals picked +
  // pending. Babies are excluded so percentages describe "what's on the
  // catering order", not "headcount at the venue".
  const mealsDenominator =
    MEAL_ORDER.reduce((acc, m) => acc + stats.mealCounts[m], 0) + stats.pending;
  // Allergens count against the full "yes" cohort (including babies — they
  // can be lactose-intolerant just like adults).
  const dietaryMax = Math.max(0, ...DIETARY_TAG_KEYS.map((tag) => stats.dietaryCounts[tag]));

  async function copySummary() {
    const lines: string[] = [];
    lines.push(t("guests.meals_summary_header"));
    lines.push("");
    lines.push(t("guests.meals_total_yes", { count: stats.totalYes }));
    lines.push("");
    lines.push(`${t("guests.meals_section_meals")}:`);
    for (const m of MEAL_ORDER) {
      lines.push(`  ${mealLabel(m)}: ${stats.mealCounts[m]}`);
    }
    if (stats.pending > 0) {
      lines.push(`  ${t("guests.meals_pending_label")}: ${stats.pending}`);
    }
    lines.push("");
    lines.push(`${t("guests.meals_section_dietary")}:`);
    for (const tag of DIETARY_TAG_KEYS) {
      lines.push(`  ${t(`rsvp.tag_${tag}`)}: ${stats.dietaryCounts[tag]}`);
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success(t("guests.meals_copy_success"));
    } catch {
      toast.error(t("common.error_generic"));
    }
  }

  // Spreadsheet export for the caterer: one row per meal + per allergen, with
  // a Category column so the two groups stay distinct when sorted. Quote every
  // cell + escape embedded quotes so translated labels with commas stay intact.
  function downloadCsv() {
    const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const rows: string[] = [];
    rows.push(
      [
        t("guests.meals_csv_col_category"),
        t("guests.meals_csv_col_item"),
        t("guests.meals_csv_col_count"),
      ]
        .map(cell)
        .join(","),
    );
    const mealCat = t("guests.meals_csv_cat_meal");
    for (const m of MEAL_ORDER) {
      rows.push([mealCat, mealLabel(m), stats.mealCounts[m]].map(cell).join(","));
    }
    if (stats.pending > 0) {
      rows.push([mealCat, t("guests.meals_pending_label"), stats.pending].map(cell).join(","));
    }
    const allergenCat = t("guests.meals_csv_cat_allergen");
    for (const tag of DIETARY_TAG_KEYS) {
      rows.push([allergenCat, t(`rsvp.tag_${tag}`), stats.dietaryCounts[tag]].map(cell).join(","));
    }
    // Prepend a UTF-8 BOM so Excel renders accented labels (Vegetáriánus,
    // Tojás) correctly instead of mojibake.
    const blob = new Blob([`﻿${rows.join("\r\n")}\r\n`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "weddly-meals-summary.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("guests.meals_download_success"));
  }

  return (
    <Dialog
      open
      title={t("guests.meals_title")}
      role="dialog"
      onClose={onClose}
      size="xl"
      closeOnBackdrop
      footer={
        editing ? (
          // Edit mode: reset on the left, cancel / save on the right.
          <div className="flex w-full items-center justify-between gap-2">
            <button
              type="button"
              className="btn-ghost btn-sm text-ink-500 dark:text-umber-300"
              onClick={() =>
                setDraftMenu(MEAL_ORDER.map((c) => ({ choice: c, label: null, enabled: true })))
              }
              disabled={savingMenu}
            >
              <RotateCcw size={14} aria-hidden /> {t("guests.meals_menu_reset")}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-outline"
                onClick={cancelEdit}
                disabled={savingMenu}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={saveMenu}
                disabled={savingMenu}
              >
                <Check size={16} aria-hidden />{" "}
                {savingMenu ? t("common.saving") : t("guests.meals_menu_save")}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className="btn-outline"
              onClick={copySummary}
              disabled={stats.totalYes === 0}
            >
              <ClipboardCopy size={16} aria-hidden /> {t("guests.meals_copy_text")}
            </button>
            <button
              type="button"
              className="btn-outline"
              onClick={downloadCsv}
              disabled={stats.totalYes === 0}
            >
              <Download size={16} aria-hidden /> {t("guests.meals_download_text")}
            </button>
            <button type="button" className="btn-primary" onClick={onClose}>
              {t("guests.meals_close")}
            </button>
          </div>
        )
      }
    >
      {/* font-grotesk (General Sans) across the whole dialog so the meals
          summary speaks in the same voice as the landing page. Tightened to a
          single no-scroll view: a compact control bar, the meal panel (which
          flips between live stats and an inline editor), and a dense allergen
          grid. */}
      <div className="space-y-4 font-grotesk">
        {/* Compact control bar: the bulk "ask for meals on the RSVP" toggle on
            one line, plus the live summary chips on the right. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-paper-200 bg-paper-50/70 px-3.5 py-2 dark:border-umber-700 dark:bg-umber-800/40">
          <div
            className={`flex min-w-0 items-center gap-2.5 ${
              households.length === 0 ? "opacity-60" : ""
            }`}
          >
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paper-200/70 text-ink-600 dark:bg-umber-700 dark:text-paper-100"
            >
              <Utensils size={16} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium leading-tight text-ink-800 dark:text-paper-100">
                {t("guests.rsvp_collects_meal_label")}
              </p>
              <p className="truncate text-[11px] text-ink-500 dark:text-umber-300">
                {t("guests.rsvp_collects_meal_help")}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={mealOn}
              aria-label={t("guests.rsvp_collects_meal_label")}
              disabled={households.length === 0}
              onClick={() => void onBulkRsvpToggle("rsvp_collects_meal", !mealOn)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed ${
                mealOn ? "bg-sage-500 dark:bg-sage-400" : "bg-paper-300 dark:bg-umber-700"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  mealOn ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
          {!editing && stats.totalYes > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-200">
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-white dark:bg-emerald-400 dark:text-umber-900">
                  <Check size={9} strokeWidth={3} aria-hidden />
                </span>
                {t("guests.meals_total_yes", { count: stats.totalYes })}
              </span>
              {stats.pending > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
                  {t("guests.meals_pending_chip", { count: stats.pending })}
                </span>
              )}
              {babyYes > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-2.5 py-1 text-xs font-medium text-ink-600 dark:border-umber-700 dark:bg-umber-800 dark:text-umber-200">
                  <Baby size={13} aria-hidden />
                  {t("guests.meals_baby_count", { count: babyYes })}
                </span>
              )}
            </div>
          )}
        </div>

        {/* MEALS — the panel flips between live stats and the inline editor.
            View: a single stacked share-bar + a dense legend (custom labels,
            counts, share). Edit: each slot becomes a label field + an
            offered/hidden switch so couples publish their real menu. */}
        <section className="space-y-3">
          <header className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-grotesk text-base font-semibold tracking-tight text-ink-800 dark:text-paper-100">
                  {t("guests.meals_section_meals")}
                </h3>
                {!editing && isCustomMealMenu(activeMenu) && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blush-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blush-600 dark:bg-blush-400/15 dark:text-blush-300">
                    {t("guests.meals_menu_custom_badge")}
                  </span>
                )}
              </div>
              <span className="text-xs text-ink-500 dark:text-umber-300">
                {editing ? t("guests.meals_menu_edit_help") : t("guests.meals_section_meals_help")}
              </span>
            </div>
            {!editing && couple && (
              <button
                type="button"
                className="btn-outline btn-sm shrink-0"
                onClick={() => setEditing(true)}
              >
                <Pencil size={14} aria-hidden /> {t("guests.meals_edit_menu")}
              </button>
            )}
          </header>

          {editing ? (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {MEAL_ORDER.map((m) => {
                const item = draftMenu.find((x) => x.choice === m);
                return (
                  <MealEditRow
                    key={m}
                    meal={m}
                    value={item?.label ?? ""}
                    enabled={item?.enabled ?? true}
                    placeholder={t(`guests.meal_${m}`)}
                    offeredLabel={t("guests.meals_menu_offered")}
                    onLabel={(label) => patchSlot(m, { label })}
                    onToggle={() => patchSlot(m, { enabled: !(item?.enabled ?? true) })}
                  />
                );
              })}
            </ul>
          ) : stats.totalYes > 0 ? (
            <>
              <MealsStackedBar
                mealCounts={stats.mealCounts}
                pending={stats.pending}
                total={mealsDenominator}
              />
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {MEAL_ORDER.map((m) => (
                  <MealLegendRow
                    key={m}
                    meal={m}
                    label={mealLabel(m)}
                    count={stats.mealCounts[m]}
                    total={mealsDenominator}
                  />
                ))}
              </ul>
            </>
          ) : (
            // No responses yet — show the menu as read-only chips so couples
            // still see what they'll offer, with a nudge to personalise it.
            <div className="rounded-xl border border-dashed border-paper-300 bg-paper-50/60 px-3 py-3 dark:border-umber-700 dark:bg-umber-800/30">
              <ul className="flex flex-wrap gap-1.5">
                {MEAL_ORDER.filter(
                  (m) => activeMenu.find((x) => x.choice === m)?.enabled ?? true,
                ).map((m) => (
                  <li
                    key={m}
                    className={`inline-flex items-center gap-1.5 rounded-full border border-paper-200 bg-paper-50 px-2.5 py-1 text-xs font-medium text-ink-700 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 ${MEAL_TONE_TEXT[m]}`}
                  >
                    <MealIcon meal={m} />
                    <span className="text-ink-700 dark:text-paper-100">{mealLabel(m)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-500 dark:text-umber-300">
                {t("guests.meals_no_yes_yet")}
              </p>
            </div>
          )}
        </section>

        {/* ALLERGENS — dense two-column grid of tinted bars, hidden while
            editing the menu so the editor owns the whole view. */}
        {!editing && stats.totalYes > 0 && (
          <section className="space-y-2 rounded-2xl border border-paper-200 bg-paper-100/40 p-3.5 dark:border-umber-700 dark:bg-umber-700/30">
            <header className="flex items-baseline justify-between gap-2">
              <h3 className="font-grotesk text-base font-semibold tracking-tight text-ink-800 dark:text-paper-100">
                {t("guests.meals_section_dietary")}
              </h3>
              <span className="text-xs text-ink-500 dark:text-umber-300">
                {t("guests.meals_section_dietary_help")}
              </span>
            </header>
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {DIETARY_TAG_KEYS.map((tag) => (
                <AllergenRow
                  key={tag}
                  tag={tag}
                  label={t(`rsvp.tag_${tag}`)}
                  count={stats.dietaryCounts[tag]}
                  max={dietaryMax}
                  totalYes={stats.totalYes}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </Dialog>
  );
}

/** Meal segment colours. Each meal gets a distinct palette swatch so the
 *  stacked bar's segments are decodable without reading the legend, AND
 *  the legend row's icon dot reuses the same swatch so the eye can match
 *  segment ↔ legend row instantly. Pending uses paper-400 (very muted) so
 *  the "unanswered" share reads as missing data rather than a sixth meal. */
const MEAL_SEGMENT_BG: Record<MealChoice, string> = {
  meat: "bg-blush-500 dark:bg-blush-400",
  fish: "bg-sky-500 dark:bg-sky-400",
  vegetarian: "bg-sage-500 dark:bg-sage-400",
  vegan: "bg-sage-700 dark:bg-sage-300",
  child: "bg-amber-400 dark:bg-amber-300",
  none: "bg-ink-400 dark:bg-umber-400",
};
const MEAL_SEGMENT_DOT: Record<MealChoice, string> = {
  meat: "bg-blush-500 dark:bg-blush-400",
  fish: "bg-sky-500 dark:bg-sky-400",
  vegetarian: "bg-sage-500 dark:bg-sage-400",
  vegan: "bg-sage-700 dark:bg-sage-300",
  child: "bg-amber-400 dark:bg-amber-300",
  none: "bg-ink-400 dark:bg-umber-400",
};
/** Soft tints for the legend card's icon badge — same hue as the bar segment
 *  but at low opacity so the icon (in MEAL_TONE_TEXT) reads on top. */
const MEAL_TONE_SOFT: Record<MealChoice, string> = {
  meat: "bg-blush-500/10 dark:bg-blush-400/15",
  fish: "bg-sky-500/10 dark:bg-sky-400/15",
  vegetarian: "bg-sage-500/10 dark:bg-sage-400/15",
  vegan: "bg-sage-700/10 dark:bg-sage-300/15",
  child: "bg-amber-400/15 dark:bg-amber-300/15",
  none: "bg-ink-400/10 dark:bg-umber-400/15",
};
const MEAL_TONE_TEXT: Record<MealChoice, string> = {
  meat: "text-blush-600 dark:text-blush-300",
  fish: "text-sky-600 dark:text-sky-300",
  vegetarian: "text-sage-700 dark:text-sage-300",
  vegan: "text-sage-800 dark:text-sage-200",
  child: "text-amber-600 dark:text-amber-300",
  none: "text-ink-500 dark:text-umber-300",
};

function MealsStackedBar({
  mealCounts,
  pending,
  total,
}: {
  mealCounts: Record<MealChoice, number>;
  pending: number;
  total: number;
}) {
  const { t } = useT();
  if (total === 0) {
    return (
      <div className="h-4 w-full rounded-full bg-paper-200 dark:bg-umber-900/60" aria-hidden />
    );
  }
  // gap-0.5 lets the paper track show through between segments, so the bar
  // reads as distinct slices rather than one smeared gradient.
  return (
    <div
      className="flex h-4 w-full gap-0.5 overflow-hidden rounded-full bg-paper-200 dark:bg-umber-900/60"
      role="presentation"
    >
      {MEAL_ORDER.map((m) => {
        const c = mealCounts[m];
        if (c === 0) return null;
        const pct = (c / total) * 100;
        return (
          <div
            key={m}
            className={`${MEAL_SEGMENT_BG[m]} h-full`}
            style={{ width: `${pct}%` }}
            title={`${t(`guests.meal_${m}`)}: ${c}`}
            aria-hidden
          />
        );
      })}
      {pending > 0 && (
        <div
          className="h-full bg-paper-400 dark:bg-umber-500"
          style={{ width: `${(pending / total) * 100}%` }}
          title={`${t("guests.meals_pending_label")}: ${pending}`}
          aria-hidden
        />
      )}
    </div>
  );
}

function MealLegendRow({
  meal,
  label,
  count,
  total,
}: {
  meal: MealChoice;
  label: string;
  count: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const dim = count === 0;
  return (
    <li
      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
        dim
          ? "border-paper-200 bg-paper-50/50 dark:border-umber-700/60 dark:bg-umber-800/30"
          : "border-paper-200 bg-paper-50 dark:border-umber-700 dark:bg-umber-800"
      }`}
    >
      <span
        aria-hidden
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          dim
            ? "bg-paper-200 text-ink-400 dark:bg-umber-700 dark:text-umber-400"
            : `${MEAL_TONE_SOFT[meal]} ${MEAL_TONE_TEXT[meal]}`
        }`}
      >
        <MealIcon meal={meal} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={`truncate text-sm font-medium ${
              dim ? "text-ink-400 dark:text-umber-400" : "text-ink-800 dark:text-paper-100"
            }`}
          >
            {label}
          </span>
          <span
            className={`text-base font-semibold tabular-nums ${
              dim ? "text-ink-400 dark:text-umber-400" : "text-ink-900 dark:text-paper-50"
            }`}
          >
            {count}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-200 dark:bg-umber-900/60">
            {!dim && (
              <div
                aria-hidden
                className={`h-full rounded-full ${MEAL_SEGMENT_BG[meal]}`}
                style={{ width: `${Math.max(pct, 4)}%` }}
              />
            )}
          </div>
          <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-ink-500 dark:text-umber-300">
            {dim ? "-" : `${pct}%`}
          </span>
        </div>
      </div>
    </li>
  );
}

/** Inline editor row for one meal slot: the slot's icon, a label field
 *  (placeholder = the localised default, so an empty field still "works"),
 *  and an offered/hidden switch. The choice key never changes — only the
 *  couple-facing label + whether it appears on the RSVP form. */
function MealEditRow({
  meal,
  value,
  enabled,
  placeholder,
  offeredLabel,
  onLabel,
  onToggle,
}: {
  meal: MealChoice;
  value: string;
  enabled: boolean;
  placeholder: string;
  offeredLabel: string;
  onLabel: (label: string) => void;
  onToggle: () => void;
}) {
  return (
    <li
      className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 transition-opacity ${
        enabled
          ? "border-paper-200 bg-paper-50 dark:border-umber-700 dark:bg-umber-800"
          : "border-paper-200 bg-paper-50/50 opacity-70 dark:border-umber-700/60 dark:bg-umber-800/30"
      }`}
    >
      <span
        aria-hidden
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${MEAL_TONE_SOFT[meal]} ${MEAL_TONE_TEXT[meal]}`}
      >
        <MealIcon meal={meal} />
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        maxLength={MEAL_LABEL_MAX}
        disabled={!enabled}
        aria-label={placeholder}
        onChange={(e) => onLabel(e.target.value)}
        className="min-w-0 flex-1 rounded-lg border border-paper-200 bg-paper-50 px-2.5 py-1.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-ink-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-umber-700 dark:bg-umber-900 dark:text-paper-50 dark:placeholder:text-umber-400"
      />
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={offeredLabel}
        title={offeredLabel}
        onClick={onToggle}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          enabled ? "bg-sage-500 dark:bg-sage-400" : "bg-paper-300 dark:bg-umber-700"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </li>
  );
}

/** Allergens get their own visual language: a tinted left rail + filled
 *  bar in the same colour family, on top of a paper-100 surface. The
 *  section as a whole sits inside its own container so it never reads as
 *  the same kind of grid as the meals section above. */
function AllergenRow({
  tag,
  label,
  count,
  max,
  totalYes,
}: {
  tag: DietaryTag;
  label: string;
  count: number;
  max: number;
  totalYes: number;
}) {
  const tone = DIETARY_TAG_TONE[tag];
  // Solid filled-bar colour per tone (matches the active chip palette).
  const fillCls: Record<DietaryTone, string> = {
    dairy: "bg-sky-500 dark:bg-sky-400",
    wheat: "bg-amber-500 dark:bg-amber-400",
    nut: "bg-orange-500 dark:bg-orange-400",
    egg: "bg-yellow-400 dark:bg-yellow-300",
    seafood: "bg-cyan-600 dark:bg-cyan-400",
  };
  const rail: Record<DietaryTone, string> = {
    dairy: "bg-sky-400 dark:bg-sky-400",
    wheat: "bg-amber-400 dark:bg-amber-400",
    nut: "bg-orange-400 dark:bg-orange-400",
    egg: "bg-yellow-300 dark:bg-yellow-300",
    seafood: "bg-cyan-500 dark:bg-cyan-400",
  };
  const dim = count === 0;
  // Widths normalised to the section max so a "1" next to a "20" still
  // shows a visible nub. 4% floor for any non-zero.
  const fillPct = max > 0 ? Math.max((count / max) * 100, count > 0 ? 4 : 0) : 0;
  const sharePct = totalYes > 0 ? Math.round((count / totalYes) * 100) : 0;
  return (
    <li
      className={`flex items-center gap-3 overflow-hidden rounded-lg border bg-paper-50 transition-opacity dark:bg-umber-800 ${
        dim
          ? "border-paper-200 opacity-60 dark:border-umber-700/60"
          : "border-paper-300 dark:border-umber-700"
      }`}
    >
      <span
        aria-hidden
        className={`h-9 w-1 shrink-0 ${dim ? "bg-paper-300 dark:bg-umber-700" : rail[tone]}`}
      />
      <span
        aria-hidden
        className={
          dim
            ? "shrink-0 text-ink-400 dark:text-umber-400"
            : "shrink-0 text-ink-700 dark:text-paper-100"
        }
      >
        <DietaryTagIcon tag={tag} />
      </span>
      <span
        className={`min-w-[5rem] flex-shrink-0 truncate text-sm ${
          dim ? "text-ink-400 dark:text-umber-400" : "text-ink-700 dark:text-paper-100"
        }`}
      >
        {label}
      </span>
      <div
        className="relative flex h-2 flex-1 items-center overflow-hidden rounded-full bg-paper-200 dark:bg-umber-900/60"
        role="presentation"
      >
        <div
          aria-hidden
          className={`h-full rounded-full transition-[width] ${dim ? "bg-paper-300 dark:bg-umber-700" : fillCls[tone]}`}
          style={{ width: `${fillPct}%` }}
        />
      </div>
      <span
        className={`w-10 shrink-0 text-right text-sm font-semibold tabular-nums ${
          dim ? "text-ink-400 dark:text-umber-400" : "text-ink-900 dark:text-paper-50"
        }`}
      >
        {count}
      </span>
      <span className="mr-3 hidden w-12 shrink-0 text-right text-[11px] tabular-nums text-ink-500 sm:inline dark:text-umber-300">
        {dim ? "-" : `${sharePct}%`}
      </span>
    </li>
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
          className="input font-mono text-base sm:text-sm"
          onFocus={(e) => e.currentTarget.select()}
        />
      </div>
    </Dialog>
  );
}

// Page-header stat block: a big tabular-nums number stacked over a small
// uppercase caption. `primary` gives the headline metric a touch more weight
// (heavier number colour) so guests-count still reads as the lead figure.
// The guest-list filter toolbar: search box, sort control, an expandable
// panel of stackable filter chips (RSVP / side & group / invited / needs-room
// / grouped-households lens), and an active-filter summary row with per-chip ×
// and a single "Clear all". All state is owned by the page (URL-backed); this
// component is purely presentational.
function GuestFilterBar({
  query,
  onQueryChange,
  rsvpSet,
  groupSet,
  invited,
  accommodation,
  householdView,
  sortKey,
  activeFilterCount,
  onToggleRsvp,
  onToggleGroup,
  onToggleInvited,
  onToggleAccommodation,
  onToggleHousehold,
  onSetSort,
  onClearAll,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  rsvpSet: Set<RsvpStatus>;
  groupSet: Set<GuestGroupTag>;
  invited: boolean;
  accommodation: boolean;
  householdView: boolean;
  sortKey: SortKey;
  activeFilterCount: number;
  onToggleRsvp: (s: RsvpStatus) => void;
  onToggleGroup: (g: GuestGroupTag) => void;
  onToggleInvited: () => void;
  onToggleAccommodation: () => void;
  onToggleHousehold: () => void;
  onSetSort: (k: SortKey) => void;
  onClearAll: () => void;
}) {
  const { t } = useT();
  // Auto-open the panel when a filter is already applied (e.g. arriving via a
  // shared URL) so the active selection is visible, not hidden behind a chip.
  const [open, setOpen] = useState(activeFilterCount > 0);
  const rsvpOptions: RsvpStatus[] = ["pending", "yes", "maybe", "no"];
  const sortOptions: SortKey[] = ["default", "name", "added", "rsvp", "group"];
  const chip = (on: boolean) =>
    [
      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors",
      on
        ? "bg-umber-900 text-paper-50 dark:bg-paper-100 dark:text-umber-900"
        : "bg-paper-100 text-ink-700 ring-1 ring-paper-200 hover:bg-paper-200 dark:bg-umber-800 dark:text-paper-100 dark:ring-umber-700 dark:hover:bg-umber-700",
    ].join(" ");
  const hasActive = activeFilterCount > 0 || householdView;

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div
          data-tour-target="guests-search"
          className="relative w-full min-w-0 flex-1 sm:w-auto sm:min-w-[200px]"
        >
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
            onChange={(e) => onQueryChange(e.target.value)}
          />
        </div>
        <div className="relative">
          <select
            className="h-9 w-auto appearance-none rounded-full border border-paper-300 bg-paper-50 pl-4 pr-9 text-sm font-medium text-ink-700 transition-colors hover:border-paper-400 focus:border-umber-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-sage-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-600"
            value={sortKey}
            onChange={(e) => onSetSort(e.target.value as SortKey)}
            aria-label={t("guests.sort_label")}
          >
            {sortOptions.map((k) => (
              <option key={k} value={k}>
                {t(`guests.sort_${k}`)}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            aria-hidden
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-umber-300"
          />
        </div>
        <button
          type="button"
          className="btn-outline"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <Filter size={14} aria-hidden /> {t("guests.filters_button")}
          {activeFilterCount > 0 && (
            <span className="ml-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-umber-900 px-1.5 text-xs text-paper-50 dark:bg-paper-100 dark:text-umber-900">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {open && (
        <div className="space-y-3 rounded-xl border border-paper-200 bg-paper-50/60 p-3 dark:border-umber-700 dark:bg-umber-900/40">
          <FilterGroup label={t("guests.filter_group_rsvp")}>
            {rsvpOptions.map((s) => (
              <button
                key={s}
                type="button"
                className={chip(rsvpSet.has(s))}
                aria-pressed={rsvpSet.has(s)}
                onClick={() => onToggleRsvp(s)}
              >
                {t(`guests.rsvp_${s}`)}
              </button>
            ))}
          </FilterGroup>
          <FilterGroup label={t("guests.filter_group_side")}>
            {GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                className={chip(groupSet.has(g))}
                aria-pressed={groupSet.has(g)}
                onClick={() => onToggleGroup(g)}
              >
                {t(`guests.group_${g}`)}
              </button>
            ))}
          </FilterGroup>
          <FilterGroup label={t("guests.filter_group_more")}>
            <button
              type="button"
              className={chip(invited)}
              aria-pressed={invited}
              onClick={onToggleInvited}
            >
              <Send size={13} aria-hidden /> {t("guests.filter_invited_chip")}
            </button>
            <button
              type="button"
              className={chip(accommodation)}
              aria-pressed={accommodation}
              onClick={onToggleAccommodation}
            >
              <Bed size={13} aria-hidden /> {t("guests.filter_accommodation_chip")}
            </button>
            <button
              type="button"
              className={chip(householdView)}
              aria-pressed={householdView}
              onClick={onToggleHousehold}
            >
              <Home size={13} aria-hidden /> {t("guests.household_filter_label")}
            </button>
          </FilterGroup>
        </div>
      )}

      {hasActive && (
        <div className="flex flex-wrap items-center gap-2">
          {[...rsvpSet].map((s) => (
            <ActiveChip
              key={`r-${s}`}
              label={t(`guests.rsvp_${s}`)}
              onRemove={() => onToggleRsvp(s)}
            />
          ))}
          {[...groupSet].map((g) => (
            <ActiveChip
              key={`g-${g}`}
              label={t(`guests.group_${g}`)}
              onRemove={() => onToggleGroup(g)}
            />
          ))}
          {invited && (
            <ActiveChip
              icon={<Send size={13} aria-hidden />}
              label={t("guests.filter_invited_chip")}
              onRemove={onToggleInvited}
            />
          )}
          {accommodation && (
            <ActiveChip
              icon={<Bed size={13} aria-hidden />}
              label={t("guests.filter_accommodation_chip")}
              onRemove={onToggleAccommodation}
            />
          )}
          {householdView && (
            <ActiveChip
              icon={<Home size={13} aria-hidden />}
              label={t("guests.household_filter_label")}
              onRemove={onToggleHousehold}
            />
          )}
          <button
            type="button"
            className="text-sm text-ink-500 underline underline-offset-2 hover:text-ink-900 dark:text-umber-300 dark:hover:text-paper-50"
            onClick={onClearAll}
          >
            {t("guests.filters_clear_all")}
          </button>
        </div>
      )}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-xs font-semibold uppercase tracking-widest text-ink-400 dark:text-umber-500">
        {label}
      </span>
      {children}
    </div>
  );
}

function ActiveChip({
  icon,
  label,
  onRemove,
}: {
  icon?: ReactNode;
  label: string;
  onRemove: () => void;
}) {
  const { t } = useT();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-paper-100 px-3 py-1 text-sm text-ink-700 ring-1 ring-paper-200 dark:bg-umber-800 dark:text-paper-100 dark:ring-umber-700">
      {icon && <span className="text-ink-500 dark:text-umber-300">{icon}</span>}
      <span className="font-medium">{label}</span>
      <button
        type="button"
        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-500 hover:bg-paper-200 hover:text-ink-900 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-50"
        onClick={onRemove}
        aria-label={t("guests.search_clear")}
      >
        <X size={12} />
      </button>
    </span>
  );
}

function GuestStat({
  value,
  label,
  icon,
  tone = "secondary",
  onClick,
  actionTitle,
  active = false,
  dimmed = false,
}: {
  value: number | string;
  label: string;
  /** Icon shown inline after the number, inheriting its color (lucide, aria-hidden). */
  icon: ReactNode;
  tone?: "primary" | "secondary";
  /** When set, the stat becomes a button that filters / jumps the guest list. */
  onClick?: () => void;
  /** Tooltip + accessible name describing the click action (used with onClick). */
  actionTitle?: string;
  /** This stat owns the current view: gets a highlight ring and stays bright. */
  active?: boolean;
  /** Faded out because a sibling stat is the active view — number + icon both
   *  drop opacity so the active filter reads at a glance. */
  dimmed?: boolean;
}) {
  // One cool navy family per stat — the icon inherits the number's token so it
  // can't drift to a mismatched (warm-looking) lighter shade. Hierarchy is
  // carried by the primary/secondary number token alone.
  const cls =
    tone === "primary"
      ? "text-2xl font-semibold tabular-nums text-ink-900 dark:text-paper-50"
      : "text-2xl font-semibold tabular-nums text-ink-600 dark:text-umber-300";
  // The number + icon read as a glyph pair; the icon alone is ambiguous
  // (target / people / house / paper-plane), so an INSTANT styled tooltip
  // names it on hover/focus. We render our own (group-hover) tooltip rather
  // than the native `title` attribute, which only appears after a ~1s OS
  // delay and can't be styled.
  const tip = actionTitle ?? label;
  const inner = (
    <>
      <dd>{value}</dd>
      <dt aria-hidden>{icon}</dt>
    </>
  );
  // Decorative — the accessible name is carried by aria-label on the trigger,
  // so we hide the duplicate text from screen readers to avoid double reads.
  const tooltip = (
    <span
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-umber-900 px-2.5 py-1.5 text-xs font-normal normal-case leading-none tracking-normal text-paper-50 opacity-0 shadow-pop transition-opacity duration-100 peer-hover:opacity-100 peer-focus-visible:opacity-100 dark:bg-umber-950"
    >
      {tip}
    </span>
  );
  if (onClick) {
    return (
      <div className="group relative inline-flex">
        <button
          type="button"
          onClick={onClick}
          aria-label={tip}
          aria-pressed={active}
          className={`peer -mx-1 inline-flex items-center gap-1 rounded-md px-1 leading-none transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blush-400 ${cls} ${
            active
              ? "text-blush-600 dark:text-blush-300"
              : "hover:text-blush-600 dark:hover:text-blush-300"
          } ${dimmed ? "opacity-35 hover:opacity-100" : ""}`}
        >
          {inner}
        </button>
        {tooltip}
      </div>
    );
  }
  return (
    <div
      className={`group relative inline-flex items-center gap-1 leading-none ${cls}`}
      aria-label={tip}
    >
      {inner}
      {tooltip}
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
