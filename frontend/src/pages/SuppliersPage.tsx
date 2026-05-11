// Static suppliers directory. v1 = read-only outbound contact only.
//
// Layout: a step-by-step "chain" of supplier groups along the top — selecting
// a step reveals its sub-categories. The chain mirrors the real-world booking
// order (venue first, details last). Above the chain: free-text search + city
// filter (persisted in URL params so back-button works) plus a "saved" star on
// each card backed by localStorage.

import type { DirectorySupplier, SupplierCategory, SupplierGroup } from "@shared/suppliers";
import { SUPPLIER_GROUPS, SUPPLIER_TO_BUDGET } from "@shared/suppliers";
import type { BudgetLine } from "@shared/types";
import {
  BedDouble,
  Brush,
  Building2,
  Bus,
  Cake,
  Camera,
  ChefHat,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  List,
  Map as MapIcon,
  Disc3,
  Flower2,
  Lightbulb,
  Mail,
  MapPin,
  PartyPopper,
  Phone,
  Scissors,
  Search,
  Shirt,
  Sparkles,
  Star,
  StickyNote,
  Users,
  UtensilsCrossed,
  Wine,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { SubmitSupplierModal } from "../components/SubmitSupplierModal";
import { SupplierCostRow } from "../components/SupplierCostRow";
import { Button } from "../components/ui";
import { budgetApi, supplierApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

// Leaflet + react-leaflet add ~150 KB minified that no other page uses —
// lazy-loading keeps the initial /app bundle small for couples who never
// open the map tab.
const SupplierMap = lazy(() => import("../components/SupplierMap"));

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

const GROUP_ICON: Record<SupplierGroup, IconCmp> = {
  venue_stay: MapPin,
  food_drink: UtensilsCrossed,
  atmosphere: Sparkles,
  experience: PartyPopper,
  style: Scissors,
  details: Mail,
};

const CATEGORY_ICON: Record<SupplierCategory, IconCmp> = {
  venue: Building2,
  accommodation: BedDouble,
  catering: ChefHat,
  cake_dessert: Cake,
  bar_drinks: Wine,
  decor_floral: Flower2,
  lighting: Lightbulb,
  music_dj: Disc3,
  photo_video: Camera,
  entertainment: PartyPopper,
  attire: Shirt,
  hair_makeup: Brush,
  stationery: StickyNote,
  transport: Bus,
};

/** Diacritic-folded lower-case for case- and accent-insensitive matching. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

const SAVED_LS_KEY = "weddly.suppliers.saved";

function readSaved(): Set<string> {
  try {
    const raw = localStorage.getItem(SAVED_LS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed))
      return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    // ignore
  }
  return new Set();
}

function writeSaved(set: Set<string>) {
  try {
    localStorage.setItem(SAVED_LS_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // ignore quota / private mode
  }
}

export default function SuppliersPage() {
  const { t, locale } = useT();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<DirectorySupplier[]>([]);
  const [activeGroup, setActiveGroup] = useState<SupplierGroup | null>(null);
  const [activeCat, setActiveCat] = useState<SupplierCategory | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(() => readSaved());
  // Budget lines drive the per-card Tervezett/Tényleges row. We aggregate
  // per category on render rather than storing duplicated state.
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([]);

  // Filter state lives in URL params so back-button restores it.
  const query = params.get("q") ?? "";
  const cityFilter = params.get("city") ?? "";
  const showSavedOnly = params.get("saved") === "1";
  const sortMode: "top" | "alpha" = params.get("sort") === "alpha" ? "alpha" : "top";
  const viewMode: "list" | "map" = params.get("view") === "map" ? "map" : "list";

  function setQuery(next: string) {
    const p = new URLSearchParams(params);
    if (next.trim()) p.set("q", next);
    else p.delete("q");
    setParams(p, { replace: true });
  }
  function setCityFilter(next: string) {
    const p = new URLSearchParams(params);
    if (next) p.set("city", next);
    else p.delete("city");
    setParams(p, { replace: true });
  }
  function toggleSavedFilter() {
    const p = new URLSearchParams(params);
    if (showSavedOnly) p.delete("saved");
    else p.set("saved", "1");
    setParams(p, { replace: true });
  }
  function setSortMode(next: "top" | "alpha") {
    const p = new URLSearchParams(params);
    if (next === "alpha") p.set("sort", "alpha");
    else p.delete("sort");
    setParams(p, { replace: true });
  }
  function setViewMode(next: "list" | "map") {
    const p = new URLSearchParams(params);
    if (next === "map") p.set("view", "map");
    else p.delete("view");
    setParams(p, { replace: true });
  }

  // Optimistic vote: flip the card immediately, roll back if the server says no.
  const onVote = useCallback(async (supplierId: string, nextVote: -1 | 0 | 1) => {
    setItems((prev) =>
      prev.map((s) => {
        if (s.id !== supplierId) return s;
        const delta = nextVote - s.user_vote;
        return { ...s, user_vote: nextVote, votes_score: s.votes_score + delta };
      }),
    );
    try {
      const r = await supplierApi.vote(supplierId, nextVote);
      setItems((prev) =>
        prev.map((s) =>
          s.id === supplierId ? { ...s, votes_score: r.votes_score, user_vote: r.user_vote } : s,
        ),
      );
    } catch {
      // Reload from server on failure so we don't carry stale optimistic state.
      supplierApi
        .list()
        .then((r) => setItems(r.suppliers))
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    supplierApi.list().then((r) => setItems(r.suppliers));
    // Budget lines load in parallel — failures are non-fatal (cards show
    // 0/0 without crashing).
    budgetApi
      .listLines()
      .then((r) => setBudgetLines(r.lines))
      .catch(() => undefined);
  }, []);

  /** Per-category aggregates with a pointer to the first line so we know
   *  where writes go. `firstLineId` is null when the category has no line —
   *  the actual input is disabled in that case (the card hints "add a line
   *  in budget first"). */
  const budgetByCategory = useMemo(() => {
    const map = new Map<
      string,
      { plannedSum: number; actualSum: number; firstLineId: number | null }
    >();
    for (const line of budgetLines) {
      const existing = map.get(line.category);
      if (existing) {
        existing.plannedSum += line.planned_huf;
        existing.actualSum += line.actual_huf;
      } else {
        map.set(line.category, {
          plannedSum: line.planned_huf,
          actualSum: line.actual_huf,
          firstLineId: line.id,
        });
      }
    }
    return map;
  }, [budgetLines]);

  /** Write the new actual back to the first matching budget line. Re-fetches
   *  the whole budget afterward so siblings in the same category re-render
   *  with the new total. */
  const setActualForCategory = useCallback(async (lineId: number, nextActual: number) => {
    await budgetApi.updateLine(lineId, { actual_huf: nextActual });
    const r = await budgetApi.listLines();
    setBudgetLines(r.lines);
  }, []);

  // Scroll the freshly-submitted card into view + drop the highlight after a
  // beat. Without this, a submitter sees the modal close and may not notice
  // their entry landed at the top of the list.
  useEffect(() => {
    if (!highlightId) return;
    const el = document.querySelector<HTMLElement>(`[data-supplier-id="${highlightId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const tid = window.setTimeout(() => setHighlightId(null), 2500);
    return () => window.clearTimeout(tid);
  }, [highlightId]);

  const toggleSaved = useCallback((id: string) => {
    setSaved((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeSaved(next);
      return next;
    });
  }, []);

  // Cities derived from the loaded list. Sorted alphabetically by locale rules.
  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const s of items) if (s.city) set.add(s.city);
    return Array.from(set).sort((a, b) => a.localeCompare(b, locale === "hu" ? "hu" : "en"));
  }, [items, locale]);

  const filtered = useMemo(() => {
    let out = items;
    if (activeCat) out = out.filter((s) => s.category === activeCat);
    else if (activeGroup) {
      const group = SUPPLIER_GROUPS.find((g) => g.id === activeGroup);
      const cats = new Set(group?.categories ?? []);
      out = out.filter((s) => cats.has(s.category));
    }
    if (cityFilter) out = out.filter((s) => s.city === cityFilter);
    if (showSavedOnly) out = out.filter((s) => saved.has(s.id));
    const q = normalize(query.trim());
    if (q) {
      out = out.filter((s) => {
        const hay = normalize(`${s.name} ${s.city} ${s.blurb_hu} ${s.blurb_en}`);
        return hay.includes(q);
      });
    }
    // Stable sort: top-voted by net score desc, then curated-first tie-break
    // so an unvoted directory looks the same as today. Alpha mode ignores
    // score entirely and goes by locale-aware name.
    const sorted = [...out];
    if (sortMode === "alpha") {
      sorted.sort((a, b) => a.name.localeCompare(b.name, locale === "hu" ? "hu" : "en"));
    } else {
      sorted.sort((a, b) => {
        if (b.votes_score !== a.votes_score) return b.votes_score - a.votes_score;
        if (a.source !== b.source) return a.source === "curated" ? -1 : 1;
        return a.name.localeCompare(b.name, locale === "hu" ? "hu" : "en");
      });
    }
    return sorted;
  }, [items, activeGroup, activeCat, cityFilter, showSavedOnly, saved, query, sortMode, locale]);

  const subCategories = activeGroup
    ? (SUPPLIER_GROUPS.find((g) => g.id === activeGroup)?.categories ?? [])
    : [];

  function pickGroup(id: SupplierGroup | null) {
    setActiveGroup(id);
    setActiveCat(null);
  }

  return (
    <AppShell>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1>{t("suppliers.title")}</h1>
          <p className="mt-1 text-sm text-ink-500">{t("suppliers.sub")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div
            role="group"
            aria-label={t("suppliers.view_label")}
            className="inline-flex items-center rounded-full border border-paper-300 bg-paper-50 p-0.5 text-xs"
          >
            <button
              type="button"
              onClick={() => setViewMode("list")}
              aria-pressed={viewMode === "list"}
              className={
                viewMode === "list"
                  ? "inline-flex items-center gap-1 rounded-full bg-ink-700 px-2.5 py-1 text-paper-100"
                  : "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-ink-600 hover:text-ink-900"
              }
            >
              <List size={12} aria-hidden /> {t("suppliers.view_list")}
            </button>
            <button
              type="button"
              onClick={() => setViewMode("map")}
              aria-pressed={viewMode === "map"}
              className={
                viewMode === "map"
                  ? "inline-flex items-center gap-1 rounded-full bg-ink-700 px-2.5 py-1 text-paper-100"
                  : "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-ink-600 hover:text-ink-900"
              }
            >
              <MapIcon size={12} aria-hidden /> {t("suppliers.view_map")}
            </button>
          </div>
          <Button variant="primary" size="sm" onClick={() => setSubmitOpen(true)}>
            {t("suppliers.drop_your_own")}
          </Button>
        </div>
      </header>

      {/* Search + city filter + saved chip */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[14rem]">
          <span className="sr-only">{t("suppliers.search_label")}</span>
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
            aria-hidden
          />
          <input
            type="search"
            className="input h-10 pl-9"
            placeholder={t("suppliers.search_placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("suppliers.search_label")}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="sr-only">{t("suppliers.city_label")}</span>
          <select
            className="input h-10 min-w-[10rem]"
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            aria-label={t("suppliers.city_label")}
          >
            <option value="">{t("suppliers.city_all")}</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={toggleSavedFilter}
          aria-pressed={showSavedOnly}
          className={
            showSavedOnly
              ? "inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-700 px-3 py-1.5 text-xs font-medium text-paper-100"
              : "inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-3 py-1.5 text-xs text-ink-700 hover:border-ink-300"
          }
        >
          <Star size={13} className={showSavedOnly ? "fill-paper-100" : ""} aria-hidden />
          {t("suppliers.saved_filter", { n: saved.size })}
        </button>
        <label className="flex items-center gap-2">
          <span className="sr-only">{t("suppliers.sort_label")}</span>
          <select
            className="input h-10 min-w-[10rem]"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as "top" | "alpha")}
            aria-label={t("suppliers.sort_label")}
          >
            <option value="top">{t("suppliers.sort_top")}</option>
            <option value="alpha">{t("suppliers.sort_alpha")}</option>
          </select>
        </label>
      </div>

      {/* Step chain */}
      <div className="relative mb-3">
        <div className="overflow-x-auto pb-1">
          <div className="flex min-w-max items-stretch gap-2">
            <ChainStep
              active={activeGroup === null}
              onClick={() => pickGroup(null)}
              label={t("suppliers.filter_all")}
              index={0}
              isAll
            />
            {SUPPLIER_GROUPS.map((g, i) => {
              const Icon = GROUP_ICON[g.id];
              return (
                <div key={g.id} className="flex items-stretch gap-2">
                  <ChevronRight size={16} className="self-center text-paper-400" aria-hidden />
                  <ChainStep
                    active={activeGroup === g.id}
                    onClick={() => pickGroup(g.id)}
                    label={t(`suppliers.group.${g.id}`)}
                    icon={<Icon size={16} />}
                    index={i + 1}
                  />
                </div>
              );
            })}
          </div>
        </div>
        {/* Right-edge fade hints there's more to scroll. */}
        <div
          className="pointer-events-none absolute right-0 top-0 h-full w-8 bg-gradient-to-l from-paper-50 to-transparent"
          aria-hidden
        />
      </div>
      <p className="mb-5 text-xs text-ink-500">{t("suppliers.chain_help")}</p>

      {/* Sub-category pills (only when a group is selected) */}
      {activeGroup && subCategories.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveCat(null)}
            className={
              activeCat === null
                ? "rounded-full border border-ink-700 bg-ink-700 px-3 py-1 text-xs font-medium text-paper-100"
                : "rounded-full border border-paper-300 bg-paper-50 px-3 py-1 text-xs text-ink-700"
            }
          >
            {t("suppliers.filter_all")}
          </button>
          {subCategories.map((c) => {
            const Icon = CATEGORY_ICON[c];
            const selected = activeCat === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setActiveCat(c)}
                className={
                  selected
                    ? "inline-flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-700 px-3 py-1 text-xs font-medium text-paper-100"
                    : "inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-3 py-1 text-xs text-ink-700"
                }
              >
                <Icon size={13} />
                {t(`suppliers.cat.${c}`)}
              </button>
            );
          })}
        </div>
      )}

      {viewMode === "map" ? (
        <Suspense
          fallback={
            <div className="rounded-2xl border border-paper-300 bg-paper-50 p-8 text-center text-sm text-ink-500">
              {t("common.loading")}
            </div>
          }
        >
          <SupplierMap suppliers={filtered} />
        </Suspense>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((s) => {
            const Icon = CATEGORY_ICON[s.category];
            const isHighlighted = s.id === highlightId;
            const isSaved = saved.has(s.id);
            return (
              <article
                key={s.id}
                data-supplier-id={s.id}
                className={`card-hover relative transition-shadow ${
                  isHighlighted ? "ring-2 ring-blush-400 ring-offset-2" : ""
                }`}
              >
                <div className="absolute right-4 top-4 flex items-center gap-2">
                  {s.price_band !== null && (
                    <span
                      className="text-xs tracking-wider text-ink-500"
                      title={t("suppliers.price_legend")}
                      aria-label={t("suppliers.price_legend")}
                    >
                      <PriceBandDots band={s.price_band} />
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleSaved(s.id)}
                    aria-label={isSaved ? t("suppliers.unsave_aria") : t("suppliers.save_aria")}
                    aria-pressed={isSaved}
                    className="text-ink-400 transition hover:text-blush-700"
                  >
                    <Star
                      size={16}
                      className={isSaved ? "fill-blush-500 text-blush-500" : ""}
                      aria-hidden
                    />
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <Avatar name={s.name} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate pr-16 text-base font-semibold">{s.name}</h3>
                    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs uppercase tracking-wide text-ink-500">
                      <Icon size={12} />
                      <span>
                        {t(`suppliers.cat.${s.category}`)} · {s.city}
                      </span>
                      {s.source === "community" && (
                        <span className="inline-flex items-center rounded-full border border-paper-300 bg-paper-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-600">
                          {t("suppliers.community_pill")}
                        </span>
                      )}
                      {(s.capacity_max ?? 0) > 0 && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-paper-300 bg-paper-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-600"
                          aria-label={t("suppliers.capacity_label")}
                        >
                          <Users size={10} />
                          {s.capacity_min && s.capacity_max
                            ? t("suppliers.capacity_range", {
                                min: s.capacity_min,
                                max: s.capacity_max,
                              })
                            : t("suppliers.capacity_max_only", { max: s.capacity_max ?? 0 })}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                {s.address && <p className="mt-2 text-xs text-ink-500">{s.address}</p>}
                <VoteRow supplier={s} onVote={onVote} t={t} />
                <p className="mt-3 text-sm text-ink-700">
                  {locale === "hu" ? s.blurb_hu : s.blurb_en}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    href={s.website}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="btn-outline btn-sm"
                  >
                    {t("suppliers.visit_website")}
                  </a>
                  {s.contact_email && (
                    <a href={`mailto:${s.contact_email}`} className="btn-ghost btn-sm">
                      <Mail size={14} /> {t("suppliers.contact_email")}
                    </a>
                  )}
                  {s.contact_phone && (
                    <a href={`tel:${s.contact_phone}`} className="btn-ghost btn-sm">
                      <Phone size={14} /> {s.contact_phone}
                    </a>
                  )}
                </div>
                {(() => {
                  const bucket = budgetByCategory.get(SUPPLIER_TO_BUDGET[s.category]);
                  return (
                    <SupplierCostRow
                      supplierId={s.id}
                      plannedHuf={bucket?.plannedSum ?? 0}
                      actualHuf={bucket?.actualSum ?? 0}
                      hasLine={!!bucket?.firstLineId}
                      onSetActual={async (huf) => {
                        if (!bucket?.firstLineId) return;
                        await setActualForCategory(bucket.firstLineId, huf);
                      }}
                    />
                  );
                })()}
              </article>
            );
          })}
          {filtered.length === 0 && items.length > 0 && (
            <p className="col-span-full py-8 text-center text-sm text-ink-500">
              {t("suppliers.empty_filtered")}
            </p>
          )}
        </div>
      )}

      <SubmitSupplierModal
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        onSubmitted={(s) => {
          setItems((prev) => [s, ...prev]);
          setHighlightId(s.id);
        }}
      />
    </AppShell>
  );
}

function ChainStep({
  active,
  onClick,
  label,
  icon,
  index,
  isAll,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
  index: number;
  isAll?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
        active
          ? "border-ink-700 bg-ink-700 text-paper-100"
          : "border-paper-300 bg-paper-50 text-ink-700 hover:border-ink-300"
      }`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${
          active ? "bg-paper-100/20 text-paper-100" : "bg-paper-200 text-ink-700"
        }`}
        aria-hidden
      >
        {isAll ? "·" : index}
      </span>
      {icon}
      <span className="font-medium">{label}</span>
    </button>
  );
}

function Avatar({ name }: { name: string }) {
  const initial = name.charAt(0).toUpperCase();
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-paper-300 bg-paper-100 font-serif text-lg text-ink-700">
      {initial}
    </div>
  );
}

/** Five-dot price-band scale: ●○○○○ … ●●●●●. Cleaner than $$$ for HU. */
function PriceBandDots({ band }: { band: number }) {
  const total = 5;
  const filled = Math.max(0, Math.min(total, band));
  return (
    <span className="font-mono">
      {"●".repeat(filled)}
      {"○".repeat(Math.max(0, total - filled))}
    </span>
  );
}

function VoteRow({
  supplier,
  onVote,
  t,
}: {
  supplier: DirectorySupplier;
  onVote: (id: string, value: -1 | 0 | 1) => void;
  t: (key: string) => string;
}) {
  const my = supplier.user_vote;
  // Tap-again-to-clear: if the user already cast this vote, the next tap
  // sends 0 (removes the vote); otherwise the new direction wins.
  const handle = (dir: 1 | -1) => {
    const next: -1 | 0 | 1 = my === dir ? 0 : dir;
    onVote(supplier.id, next);
  };
  return (
    <div className="mt-3 flex items-center gap-1">
      <button
        type="button"
        onClick={() => handle(1)}
        aria-pressed={my === 1}
        aria-label={t("suppliers.vote_up_aria")}
        className={
          my === 1
            ? "inline-flex h-7 w-7 items-center justify-center rounded-full bg-blush-100 text-blush-700"
            : "inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-500 hover:bg-paper-200 hover:text-ink-800"
        }
      >
        <ChevronUp size={16} aria-hidden />
      </button>
      <span
        className={`min-w-[1.5rem] text-center text-sm tabular-nums ${
          supplier.votes_score > 0
            ? "text-blush-700"
            : supplier.votes_score < 0
              ? "text-ink-400"
              : "text-ink-500"
        }`}
      >
        {supplier.votes_score > 0 ? `+${supplier.votes_score}` : supplier.votes_score}
      </span>
      <button
        type="button"
        onClick={() => handle(-1)}
        aria-pressed={my === -1}
        aria-label={t("suppliers.vote_down_aria")}
        className={
          my === -1
            ? "inline-flex h-7 w-7 items-center justify-center rounded-full bg-paper-300 text-ink-700"
            : "inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-500 hover:bg-paper-200 hover:text-ink-800"
        }
      >
        <ChevronDown size={16} aria-hidden />
      </button>
    </div>
  );
}
