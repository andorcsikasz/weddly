// Gantt-style timeline for planning_items.kind === "task" with start_date +
// due_date set, side-by-side with a "Kapcsolattartók" panel that lists the
// couple's picked suppliers (curated, community, and DIY) so an urgent task
// has the phone number one click away. Click a bar → date drawer; click a
// supplier chip on a bar → scroll to that supplier in the contact panel.

import type { CoupleSupplier } from "@shared/couple_suppliers";
import type { CouplePick } from "@shared/picks";
import type { DirectorySupplier, DirectorySupplierBase, SupplierCategory } from "@shared/suppliers";
import type { PlanningItem } from "@shared/types";
import {
  BedDouble,
  Brush,
  Building2,
  Bus,
  Cake,
  Camera,
  ChefHat,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CheckCircle2,
  Circle,
  ClipboardList,
  Disc3,
  Flower2,
  Gem,
  Globe,
  Hand,
  Heart,
  Lightbulb,
  Mail,
  Maximize2,
  PartyPopper,
  Phone,
  Pizza,
  Shirt,
  Sparkles,
  Speaker,
  StickyNote,
  Tent,
  Wine,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Skeleton, useToast } from "../components/ui";
import CalendarBoard from "./timeline/CalendarBoard";
import DayView from "./timeline/DayView";
import GanttView, { computeAllRange } from "./timeline/GanttView";
import MonthView from "./timeline/MonthView";
import WeekView from "./timeline/WeekView";
import { ApiError } from "../lib/api";
import { coupleApi, coupleSupplierApi, picksApi, planningApi, supplierApi } from "../lib/endpoints";
import { maxIsoDate, todayIso } from "../lib/format";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

const CATEGORY_ICON: Record<SupplierCategory, IconCmp> = {
  venue: Building2,
  accommodation: BedDouble,
  tent_pavilion: Tent,
  catering: ChefHat,
  cake_dessert: Cake,
  bar_drinks: Wine,
  pizza: Pizza,
  decor_floral: Flower2,
  lighting: Lightbulb,
  music_dj: Disc3,
  sound_tech: Speaker,
  photo_video: Camera,
  entertainment: PartyPopper,
  attire: Shirt,
  hair_makeup: Brush,
  nails: Hand,
  rings: Gem,
  stationery: StickyNote,
  wedding_website: Globe,
  transport: Bus,
};

/** Lightweight directory-shape for the contact panel. Covers curated +
 *  community (`DirectorySupplier`) plus DIY (`CoupleSupplier`) entries
 *  without forcing the consumer to discriminate on `source` everywhere. */
interface ResolvedSupplier {
  id: string;
  name: string;
  category: SupplierCategory;
  phone: string | null;
  email: string | null;
  website: string | null;
  // Directory entries (curated + community) have a `/app/suppliers/:id` detail
  // page; DIY entries don't surface there, so their name stays non-clickable.
  linkable: boolean;
}

function fromDirectory(s: DirectorySupplierBase): ResolvedSupplier {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    phone: s.contact_phone,
    email: s.contact_email,
    website: s.website || null,
    linkable: true,
  };
}

function fromDiy(s: CoupleSupplier): ResolvedSupplier {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    phone: null,
    email: null,
    website: null,
    linkable: false,
  };
}

/** Parse a YYYY-MM-DD literal into a Date at local midnight. Returns null on
 *  any malformed input so callers can filter rows. Avoids `new Date(str)`
 *  which has Safari-specific ISO quirks. */
function parseISODate(s: string | null): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  const dt = new Date(y, mo - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

function diffDays(a: Date, b: Date): number {
  const ms = startOfDay(b).getTime() - startOfDay(a).getTime();
  return Math.round(ms / 86_400_000);
}

type ChartMode = "day" | "week" | "month" | "quarter" | "all";

const CHART_MODE_STORAGE_KEY = "weddly.timeline.mode";

function readStoredMode(): ChartMode | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(CHART_MODE_STORAGE_KEY);
  return raw === "day" || raw === "week" || raw === "month" || raw === "quarter" || raw === "all"
    ? raw
    : null;
}

export default function TimelinePage() {
  const { t, locale } = useT();
  useDocumentMeta("timeline.seo_title", "timeline.seo_description");
  const toast = useToast();

  const [items, setItems] = useState<PlanningItem[]>([]);
  const [directory, setDirectory] = useState<DirectorySupplier[]>([]);
  const [diy, setDiy] = useState<CoupleSupplier[]>([]);
  const [picks, setPicks] = useState<CouplePick[]>([]);
  const [weddingDate, setWeddingDate] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PlanningItem | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>(() => readStoredMode() ?? "month");
  const [currentDate, setCurrentDate] = useState<Date>(() => startOfDay(new Date()));
  const today = useMemo(() => startOfDay(new Date()), []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CHART_MODE_STORAGE_KEY, chartMode);
    }
  }, [chartMode]);

  useEffect(() => {
    Promise.all([
      planningApi.list(),
      supplierApi.list(),
      coupleSupplierApi.list(),
      picksApi.list(),
      coupleApi.current(),
    ])
      .then(([planning, dir, mine, pp, couple]) => {
        setItems(planning.items);
        setDirectory(dir.suppliers);
        setDiy(mine.suppliers);
        setPicks(pp.picks);
        setWeddingDate(parseISODate(couple.couple?.wedding_date ?? null));
      })
      .catch((e) => {
        toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      })
      .finally(() => setLoading(false));
  }, [t, toast]);

  // id → ResolvedSupplier lookup across curated + community + DIY. Picks
  // reference these by public string id; DIY entries don't surface via
  // /api/suppliers so we merge their private list in here.
  const supplierById = useMemo(() => {
    const map = new Map<string, ResolvedSupplier>();
    for (const s of directory) map.set(s.id, fromDirectory(s));
    for (const s of diy) map.set(s.id, fromDiy(s));
    return map;
  }, [directory, diy]);

  // Picks resolved to ResolvedSupplier + the picks themselves (some ids may
  // point at suppliers we couldn't resolve — e.g. a curated entry retired
  // after the pick was made — surface a name-less placeholder instead of
  // dropping the row so the couple still sees the orphan and can fix it).
  const pocList = useMemo(() => {
    return picks.map((p) => {
      const resolved = supplierById.get(p.supplier_id);
      return { pick: p, supplier: resolved ?? null };
    });
  }, [picks, supplierById]);

  // Task rows considered for the Gantt — kind===task is the only kind with
  // date fields in the contract.
  const tasks = useMemo(() => items.filter((i) => i.kind === "task"), [items]);

  const datedTasks = useMemo(
    () => tasks.filter((t) => t.start_date !== null && t.due_date !== null),
    [tasks],
  );
  const undatedTasks = useMemo(
    () => tasks.filter((t) => t.start_date === null || t.due_date === null),
    [tasks],
  );

  const assigneeSuggestions = useMemo(() => {
    const seen = new Set<string>();
    for (const i of tasks) if (i.assignee && !seen.has(i.assignee)) seen.add(i.assignee);
    return [...seen].sort((a, b) => a.localeCompare(b, locale === "hu" ? "hu" : "en"));
  }, [tasks, locale]);

  async function onSave(
    id: number,
    patch: {
      start_date: string | null;
      due_date: string | null;
      assignee: string | null;
      supplier_id: string | null;
      done: boolean;
    },
  ): Promise<boolean> {
    const prev = items.find((i) => i.id === id);
    if (!prev) return false;
    setItems((list) =>
      list.map((i) => (i.id === id ? { ...i, ...patch, updated_at: Date.now() } : i)),
    );
    try {
      const r = await planningApi.update(id, patch);
      setItems((list) => list.map((i) => (i.id === id ? r.item : i)));
      return true;
    } catch (e) {
      setItems((list) => list.map((i) => (i.id === id ? prev : i)));
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      return false;
    }
  }

  function scrollToPoc(supplierId: string) {
    const el = document.getElementById(`poc-${supplierId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Brief outline pulse so the user notices where the scroll landed.
    el.classList.add("ring-2", "ring-blush-400");
    window.setTimeout(() => el.classList.remove("ring-2", "ring-blush-400"), 1600);
  }

  return (
    <>
      <div className="space-y-6">
        <header>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-grotesk text-ink-900 sm:text-4xl dark:text-paper-50">
                {t("timeline.title")}
              </h1>
              <Link
                to="/app/planning"
                aria-label={t("planning.title")}
                title={t("planning.title")}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-paper-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:text-umber-300 dark:hover:bg-umber-800 dark:hover:text-paper-50 dark:focus-visible:ring-paper-100"
              >
                <ClipboardList size={18} aria-hidden="true" />
              </Link>
            </div>
            <CountdownChip weddingDate={weddingDate} />
          </div>
        </header>

        <ChartCard
          loading={loading}
          tasks={datedTasks}
          supplierById={supplierById}
          weddingDate={weddingDate}
          mode={chartMode}
          onModeChange={setChartMode}
          currentDate={currentDate}
          onCurrentDateChange={setCurrentDate}
          onOpenTask={(item) => setEditing(item)}
          onSupplierChipClick={scrollToPoc}
        />

        {!loading && (
          <CalendarBoard today={today} tasks={datedTasks} onOpenTask={(item) => setEditing(item)} />
        )}

        <UndatedCard
          loading={loading}
          tasks={undatedTasks}
          supplierById={supplierById}
          hasAnyTasks={tasks.length > 0}
          onOpenTask={(item) => setEditing(item)}
        />

        <PocCard items={pocList} loading={loading} locale={locale} />
      </div>

      {editing && (
        <TimelineEditDialog
          item={editing}
          pocList={pocList}
          assigneeSuggestions={assigneeSuggestions}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            const ok = await onSave(editing.id, patch);
            if (ok) setEditing(null);
          }}
        />
      )}
    </>
  );
}

/** Days-until-wedding pill in the page header. Hidden until the couple has
 *  locked an exact date (weddingDate is null otherwise). Reads as a calm
 *  blush chip; on the day itself and after, the copy swaps so it never shows
 *  a negative or zero day count. */
function CountdownChip({ weddingDate }: { weddingDate: Date | null }) {
  const { t } = useT();
  if (!weddingDate) return null;
  const days = diffDays(startOfDay(new Date()), weddingDate);
  const label =
    days > 0
      ? t("timeline.countdown_days", { count: days })
      : days === 0
        ? t("timeline.countdown_today")
        : t("timeline.countdown_past", { count: Math.abs(days) });
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-blush-700 dark:text-blush-300">
      <Heart size={14} aria-hidden="true" />
      <span className="tabular-nums">{label}</span>
    </span>
  );
}

function PocCard({
  items,
  loading,
  locale,
}: {
  items: { pick: CouplePick; supplier: ResolvedSupplier | null }[];
  loading: boolean;
  locale: "hu" | "en";
}) {
  const { t } = useT();

  return (
    <section className="card p-0 rounded-3xl ring-1 ring-paper-300/60 dark:ring-umber-700/60">
      <header className="border-b border-paper-200 px-5 py-4 dark:border-umber-700">
        <h2 className="flex items-center gap-2.5 font-grotesk text-lg text-ink-900 dark:text-paper-50">
          <span className="inline-block h-5 w-0.5 rounded-full bg-blush-500" aria-hidden="true" />
          {t("timeline.poc_title")}
        </h2>
      </header>
      {loading ? (
        <ul className="divide-y divide-paper-200 p-0 dark:divide-umber-700" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 px-5 py-3">
              <Skeleton variant="circle" width={40} />
              <div className="flex-1 space-y-1.5">
                <Skeleton variant="block" width="40%" height={14} rounded="md" />
                <Skeleton variant="block" width="60%" height={11} rounded="md" />
              </div>
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-start gap-3 px-5 py-6">
          <p className="text-sm text-ink-600 dark:text-umber-200">{t("timeline.poc_empty")}</p>
          <Link
            to="/app/vendors"
            className="inline-flex items-center gap-1.5 rounded-full bg-blush-500 px-3.5 py-1.5 text-xs font-medium text-paper-50 transition-colors hover:bg-blush-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:focus-visible:ring-paper-100"
          >
            <Heart size={14} aria-hidden="true" />
            <span>{t("nav.suppliers")}</span>
            <ChevronRight size={14} aria-hidden="true" />
          </Link>
        </div>
      ) : (
        // Below 640px collapse into a horizontal-scroll strip so each contact
        // card stays usable on phones without forcing a long vertical list.
        // snap-x mandatory + snap-start on each card centres a flicked card
        // instead of leaving it half-scrolled. The right-edge gradient hints
        // "more to swipe" — only rendered below sm, where the row scrolls.
        <div className="relative">
          <ul className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 py-4 sm:flex-col sm:gap-0 sm:divide-y sm:divide-paper-200 sm:overflow-visible sm:px-0 sm:py-0 dark:sm:divide-umber-700">
            {items.map(({ pick, supplier }, index) => (
              <PocRow
                key={pick.supplier_id}
                pick={pick}
                supplier={supplier}
                locale={locale}
                isFirst={index === 0}
              />
            ))}
          </ul>
          {items.length > 1 && (
            <div
              className="pointer-events-none absolute right-0 top-0 h-full w-8 bg-gradient-to-l from-white to-transparent sm:hidden dark:from-umber-800"
              aria-hidden
            />
          )}
        </div>
      )}
    </section>
  );
}

function PocRow({
  pick,
  supplier,
  locale,
  isFirst,
}: {
  pick: CouplePick;
  supplier: ResolvedSupplier | null;
  locale: "hu" | "en";
  isFirst: boolean;
}) {
  const { t } = useT();
  const Icon = supplier ? CATEGORY_ICON[supplier.category] : Building2;
  const category = supplier?.category ?? (pick.supplier_id as SupplierCategory);
  const displayName =
    supplier?.name ?? (locale === "hu" ? "Ismeretlen kapcsolattartó" : "Unknown supplier");

  // The horizontal-scroll mobile variant uses standalone bordered cards, so
  // the list-rail accent (`border-l-2`) only applies at sm+. First row skips
  // the rail so the top edge doesn't read as heavy.
  const railClass = isFirst
    ? "sm:border-l-2 sm:border-transparent"
    : "sm:border-l-2 sm:border-paper-200 dark:sm:border-umber-700";

  const phonePill = supplier?.phone ? (
    <a
      href={`tel:${supplier.phone.replace(/\s+/g, "")}`}
      className="inline-flex items-center gap-1 rounded-full bg-paper-100 px-2 py-0.5 transition-shadow hover:bg-paper-200 hover:ring-1 hover:ring-blush-300 dark:bg-umber-700 dark:hover:bg-umber-700/80 dark:hover:ring-blush-400/40"
    >
      <Phone size={11} aria-hidden="true" />
      <span>{supplier.phone}</span>
    </a>
  ) : (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-paper-100/60 px-2 py-0.5 text-ink-400 dark:bg-umber-700/40 dark:text-umber-300"
      aria-label={t("suppliers.no_phone")}
      title={t("suppliers.no_phone")}
    >
      <Phone size={11} aria-hidden="true" />
      <span>-</span>
    </span>
  );
  const emailPill = supplier?.email ? (
    <a
      href={`mailto:${supplier.email}`}
      className="inline-flex items-center gap-1 rounded-full bg-paper-100 px-2 py-0.5 transition-shadow hover:bg-paper-200 hover:ring-1 hover:ring-blush-300 dark:bg-umber-700 dark:hover:bg-umber-700/80 dark:hover:ring-blush-400/40"
    >
      <Mail size={11} aria-hidden="true" />
      <span className="truncate max-w-[140px]">{supplier.email}</span>
    </a>
  ) : (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-paper-100/60 px-2 py-0.5 text-ink-400 dark:bg-umber-700/40 dark:text-umber-300"
      aria-label={t("suppliers.no_email")}
      title={t("suppliers.no_email")}
    >
      <Mail size={11} aria-hidden="true" />
      <span>-</span>
    </span>
  );
  const websitePill = supplier?.website ? (
    <a
      href={supplier.website}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 rounded-full bg-paper-100 px-2 py-0.5 transition-shadow hover:bg-paper-200 hover:ring-1 hover:ring-blush-300 dark:bg-umber-700 dark:hover:bg-umber-700/80 dark:hover:ring-blush-400/40"
    >
      <Globe size={11} aria-hidden="true" />
      <span>{t("suppliers.visit_website")}</span>
    </a>
  ) : null;

  return (
    <li
      id={`poc-${pick.supplier_id}`}
      className={`flex w-64 shrink-0 snap-start items-start gap-3 rounded-2xl border border-paper-300 px-3 py-3 transition-colors sm:w-auto sm:items-center sm:rounded-none sm:border-0 sm:px-5 sm:hover:bg-paper-100/40 dark:border-umber-700 dark:sm:hover:bg-umber-900/40 ${railClass}`}
    >
      <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper-100 text-ink-800 ring-1 ring-paper-300 sm:mt-0 dark:bg-umber-700 dark:text-paper-100 dark:ring-umber-700">
        <Icon size={18} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-4">
        <div className="min-w-0 sm:flex sm:min-w-0 sm:flex-1 sm:items-baseline sm:gap-3">
          {supplier?.linkable ? (
            <Link
              to={`/app/suppliers/${encodeURIComponent(supplier.id)}`}
              className="truncate text-sm font-semibold text-ink-900 transition-colors hover:text-blush-700 hover:underline focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-paper-50 dark:hover:text-blush-300 dark:focus-visible:ring-paper-100"
            >
              {displayName}
            </Link>
          ) : (
            <p className="truncate text-sm font-semibold text-ink-900 dark:text-paper-50">
              {displayName}
            </p>
          )}
          <p className="mt-0.5 shrink-0 text-[11px] uppercase tracking-wider text-ink-500 sm:mt-0 dark:text-umber-300">
            {t(`suppliers.cat.${category}`)}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-700 sm:mt-0 sm:flex-nowrap sm:justify-end dark:text-paper-100">
          {emailPill}
          {websitePill}
          {phonePill}
        </div>
      </div>
    </li>
  );
}

function ChartCard({
  loading,
  tasks,
  supplierById,
  weddingDate,
  mode,
  onModeChange,
  currentDate,
  onCurrentDateChange,
  onOpenTask,
  onSupplierChipClick,
}: {
  loading: boolean;
  tasks: PlanningItem[];
  supplierById: Map<string, ResolvedSupplier>;
  weddingDate: Date | null;
  mode: ChartMode;
  onModeChange: (mode: ChartMode) => void;
  currentDate: Date;
  onCurrentDateChange: (next: Date) => void;
  onOpenTask: (item: PlanningItem) => void;
  onSupplierChipClick: (supplierId: string) => void;
}) {
  const { t, locale } = useT();
  const [expanded, setExpanded] = useState(false);

  const today = useMemo(() => startOfDay(new Date()), []);

  // Step the focal date by one unit of the current mode. ALL shows the whole
  // plan at once, so it has no focal window to step (its nav is hidden).
  function navStep(direction: -1 | 1) {
    if (mode === "day") onCurrentDateChange(addDays(currentDate, direction));
    else if (mode === "week") onCurrentDateChange(addDays(currentDate, direction * 7));
    else if (mode === "month")
      onCurrentDateChange(
        new Date(currentDate.getFullYear(), currentDate.getMonth() + direction, 1),
      );
    else if (mode === "quarter")
      onCurrentDateChange(
        new Date(currentDate.getFullYear(), currentDate.getMonth() + direction * 3, 1),
      );
  }
  function navToday() {
    onCurrentDateChange(today);
  }

  const title = useMemo(() => {
    const intl = locale === "hu" ? "hu-HU" : "en-GB";
    if (mode === "day") {
      return new Intl.DateTimeFormat(intl, {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
      }).format(currentDate);
    }
    if (mode === "week" || mode === "month") {
      return new Intl.DateTimeFormat(intl, { year: "numeric", month: "long" }).format(currentDate);
    }
    if (mode === "all") {
      // Whole-plan span "máj. 2026 – okt. 2027" — both ends carry the year
      // since the window can cross calendar years.
      const { windowStart, monthCount } = computeAllRange(tasks, today, weddingDate);
      const end = new Date(windowStart.getFullYear(), windowStart.getMonth() + monthCount - 1, 1);
      const fmt = new Intl.DateTimeFormat(intl, { month: "short", year: "numeric" });
      return `${fmt.format(windowStart)} – ${fmt.format(end)}`;
    }
    // quarter — inclusive 3-month range "ápr. – jún. 2026".
    const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 2, 1);
    const startFmt = new Intl.DateTimeFormat(intl, { month: "short" }).format(start);
    const endFmt = new Intl.DateTimeFormat(intl, { month: "short", year: "numeric" }).format(end);
    return `${startFmt} – ${endFmt}`;
  }, [mode, currentDate, locale, tasks, today, weddingDate]);

  function renderToolbar(opts: { showExpand: boolean }) {
    return (
      <div className="flex items-center gap-1">
        <ChartModeSwitch mode={mode} onModeChange={onModeChange} />
        {opts.showExpand && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-umber-300 dark:hover:bg-umber-800 dark:hover:text-paper-50 dark:focus-visible:ring-paper-100"
            aria-label={t("timeline.expand_label")}
            title={t("timeline.expand_label")}
          >
            <Maximize2 size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }

  const navCluster = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={navToday}
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-ink-700 transition-colors hover:text-blush-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blush-400 dark:text-paper-100 dark:hover:text-blush-300"
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-blush-500" aria-hidden="true" />
        <span>{t("timeline.today_button")}</span>
      </button>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => navStep(-1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-umber-300 dark:hover:bg-umber-800 dark:hover:text-paper-50 dark:focus-visible:ring-paper-100"
          aria-label={t("timeline.prev_label")}
          title={t("timeline.prev_label")}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => navStep(1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-umber-300 dark:hover:bg-umber-800 dark:hover:text-paper-50 dark:focus-visible:ring-paper-100"
          aria-label={t("timeline.next_label")}
          title={t("timeline.next_label")}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );

  // Loading state — shared across all modes so we don't double-render skeletons.
  const loadingBody = loading ? (
    <div className="h-full space-y-2 p-5" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} variant="block" height={28} width="80%" rounded="md" />
      ))}
    </div>
  ) : null;

  function renderBody() {
    if (loadingBody) return loadingBody;
    if (mode === "day") {
      return (
        <DayView
          currentDate={currentDate}
          today={today}
          tasks={tasks}
          supplierById={supplierById as unknown as Map<string, ViewSupplier>}
          onOpenTask={onOpenTask}
        />
      );
    }
    if (mode === "week") {
      return (
        <WeekView
          currentDate={currentDate}
          today={today}
          tasks={tasks}
          supplierById={supplierById as unknown as Map<string, ViewSupplier>}
          onOpenTask={onOpenTask}
        />
      );
    }
    if (mode === "month") {
      return (
        <MonthView
          currentDate={currentDate}
          today={today}
          tasks={tasks}
          supplierById={supplierById as unknown as Map<string, ViewSupplier>}
          onOpenTask={onOpenTask}
        />
      );
    }
    // quarter / all — horizontal Gantt with month bands + weekly dividers.
    // 3M is a fixed window with week-number ticks; ALL spans the whole plan.
    // The chart fills the card; tasks lay as bars spanning the time they cover.
    return (
      <GanttView
        currentDate={currentDate}
        today={today}
        weddingDate={weddingDate}
        tasks={tasks}
        supplierById={supplierById as unknown as Map<string, ViewSupplier>}
        mode={mode}
        onOpenTask={onOpenTask}
        onSupplierChipClick={onSupplierChipClick}
      />
    );
  }

  // Every mode now fills a fixed card height so the body never collapses to
  // a thin strip when the couple has few tasks (the old auto-fit Gantt left
  // blank space below the bars; the new one fills the card with structure).
  const inlineHeightClass = "h-[70vh] min-h-[520px]";

  // Calendar modes (day/week/month) get a soft serif title that reads as the
  // date headline; the Gantt-style 3M/ALL views keep the compact uppercase
  // chrome they had so the long range string doesn't dwarf the canvas.
  // Every mode now renders as a calendar-grid (Day/Week/Month) or month-/
  // week-grid (Quarter/Half-year) — the title chrome can stay uniformly serif.
  const isCalendarMode = true;
  const titleClass = isCalendarMode
    ? "font-grotesk text-xl text-ink-900 dark:text-paper-50"
    : "text-sm font-semibold uppercase tracking-wider text-ink-700 dark:text-paper-100";

  return (
    <>
      <section
        className={`card flex flex-col p-0 rounded-3xl shadow-pop ring-1 ring-paper-300/60 dark:ring-umber-700/60 ${inlineHeightClass}`}
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-paper-200 px-5 py-4 dark:border-umber-700">
          <div className="flex flex-wrap items-center gap-3">
            {mode !== "all" && navCluster}
            <h2 className={titleClass}>{title}</h2>
          </div>
          {renderToolbar({ showExpand: true })}
        </header>
        <div className="min-h-0 flex-1">{renderBody()}</div>
      </section>
      {expanded && (
        <ExpandedChart
          title={title}
          closeLabel={t("a11y.close")}
          onClose={() => setExpanded(false)}
          toolbar={
            <div className="flex items-center gap-3">
              {mode !== "all" && navCluster}
              {renderToolbar({ showExpand: false })}
            </div>
          }
        >
          {renderBody()}
        </ExpandedChart>
      )}
    </>
  );
}

/** Structural shape the view components consume — they declare a local
 *  ResolvedSupplier with `category: string`, so we widen via assertion at the
 *  call site to avoid forcing the views to import a shared union. */
interface ViewSupplier {
  id: string;
  name: string;
  category: string;
  phone: string | null;
  email: string | null;
  website: string | null;
}

/** Inline mode selector — minimal text buttons, no pill background, so the
 *  chart header reads as part of the card chrome instead of a control bar.
 *  Labels use the standard chart-app shorthand (1W / 1M / 3M / ALL) so the
 *  control stays compact in both locales; the full label is on the title. */
function ChartModeSwitch({
  mode,
  onModeChange,
}: {
  mode: ChartMode;
  onModeChange: (mode: ChartMode) => void;
}) {
  const { t } = useT();
  const options: ReadonlyArray<{ value: ChartMode; short: string; full: string }> = [
    { value: "day", short: "1D", full: t("timeline.view_day") },
    { value: "week", short: "1W", full: t("timeline.view_week") },
    { value: "month", short: "1M", full: t("timeline.view_month") },
    { value: "quarter", short: "3M", full: t("timeline.view_quarter") },
    { value: "all", short: "ALL", full: t("timeline.view_all") },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={t("timeline.view_aria")}
      className="flex items-center gap-0.5 font-grotesk text-sm tracking-wide tabular-nums"
    >
      {options.map((opt) => {
        const active = opt.value === mode;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.full}
            title={opt.full}
            onClick={() => onModeChange(opt.value)}
            className={`min-h-tap rounded-md px-2 pb-0.5 pt-1 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:focus-visible:ring-paper-100 ${
              active
                ? "border-b-2 border-blush-500 text-umber-900 dark:text-paper-50"
                : "border-b-2 border-transparent text-umber-500 hover:text-umber-800 dark:text-umber-400 dark:hover:text-paper-200"
            }`}
          >
            {opt.short}
          </button>
        );
      })}
    </div>
  );
}

/** Full-viewport (90vw × 90vh) overlay that re-mounts the same chart body
 *  with more horizontal real estate so a year-long plan fits without the
 *  usual sidebar+header chrome eating into the canvas. Escape + backdrop
 *  click + the close button all dismiss. */
function ExpandedChart({
  title,
  closeLabel,
  onClose,
  toolbar,
  children,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  toolbar: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink-900/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="card relative flex h-[90vh] w-[90vw] max-w-[1800px] flex-col overflow-hidden p-0 shadow-pop dark:bg-umber-800 dark:border-umber-700"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-paper-200 px-5 py-4 dark:border-umber-700">
          <h2 className="font-grotesk text-base font-medium tracking-tight text-ink-700 dark:text-paper-100">
            {title}
          </h2>
          <div className="flex items-center gap-1">
            {toolbar}
            <button
              type="button"
              onClick={onClose}
              className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-paper-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-50 dark:focus-visible:ring-paper-100"
              aria-label={closeLabel}
              title={closeLabel}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="flex-1 min-h-0">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function UndatedCard({
  loading,
  tasks,
  supplierById,
  hasAnyTasks,
  onOpenTask,
}: {
  loading: boolean;
  tasks: PlanningItem[];
  supplierById: Map<string, ResolvedSupplier>;
  hasAnyTasks: boolean;
  onOpenTask: (item: PlanningItem) => void;
}) {
  const { t } = useT();

  // Long backlogs (100+ undated decisions are common) would push the chart off
  // screen, so we show the first PREVIEW_LIMIT and let couples expand the rest.
  const PREVIEW_LIMIT = 15;
  const [expanded, setExpanded] = useState(false);
  const canCollapse = tasks.length > PREVIEW_LIMIT;
  const visibleTasks = expanded ? tasks : tasks.slice(0, PREVIEW_LIMIT);

  // When there are zero tasks of any kind the page reads as a fresh-install
  // empty state; otherwise the "every task is dated" line stays italic + quiet
  // so it doesn't shout at couples who finished the job.
  const showFreshEmpty = !hasAnyTasks;

  return (
    <section className="card p-0 rounded-3xl ring-1 ring-paper-300/60 dark:ring-umber-700/60">
      <header className="border-b border-paper-200 px-5 py-4 dark:border-umber-700">
        <h2 className="flex items-center gap-2.5 font-grotesk text-lg text-ink-900 dark:text-paper-50">
          <span className="inline-block h-5 w-0.5 rounded-full bg-blush-500" aria-hidden="true" />
          <span>{t("timeline.no_dates_title")}</span>
          {tasks.length > 0 && (
            <span className="inline-flex items-center justify-center rounded-full bg-blush-50 px-2 py-0.5 font-sans text-[11px] font-semibold text-blush-700 dark:bg-blush-400/15 dark:text-blush-300">
              {tasks.length}
            </span>
          )}
        </h2>
      </header>
      {loading ? (
        <div className="space-y-2 p-5" aria-hidden="true">
          {[0, 1].map((i) => (
            <Skeleton key={i} variant="block" height={36} width="80%" rounded="md" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        showFreshEmpty ? (
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
            <Sparkles size={28} className="text-blush-400 dark:text-blush-300" aria-hidden="true" />
            <p className="text-base text-ink-700 dark:text-paper-100">
              {t("timeline.no_dates_empty_all")}
            </p>
          </div>
        ) : (
          <p className="px-5 py-6 text-sm italic text-ink-500 dark:text-umber-300">
            {t("timeline.no_dates_empty")}
          </p>
        )
      ) : (
        <ul className="divide-y divide-paper-200 dark:divide-umber-700">
          {visibleTasks.map((item) => {
            const supplier = item.supplier_id ? (supplierById.get(item.supplier_id) ?? null) : null;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onOpenTask(item)}
                  className="group flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-paper-100/50 focus:outline-none focus-visible:bg-paper-100 dark:hover:bg-umber-900/40 dark:focus-visible:bg-umber-900/60"
                >
                  {item.done ? (
                    <CheckCircle2
                      size={18}
                      className="shrink-0 text-sage-400 dark:text-sage-300"
                      aria-hidden="true"
                    />
                  ) : (
                    <Circle
                      size={18}
                      className="shrink-0 text-ink-300 dark:text-umber-400"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${item.done ? "text-ink-400 line-through dark:text-umber-300" : "text-ink-900 dark:text-paper-50"}`}
                  >
                    {item.title}
                  </span>
                  {item.assignee && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-[11px] text-ink-700 dark:bg-umber-700 dark:text-paper-100">
                      {item.assignee}
                    </span>
                  )}
                  {supplier && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-paper-200 px-2 py-0.5 text-[11px] text-ink-700 dark:bg-umber-700 dark:text-paper-100">
                      {supplier.name}
                    </span>
                  )}
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-blush-700 transition-colors group-hover:text-blush-800 dark:text-blush-300 dark:group-hover:text-blush-200">
                    <span>{t("timeline.set_dates")}</span>
                    <ChevronRight size={14} aria-hidden="true" />
                  </span>
                </button>
              </li>
            );
          })}
          {canCollapse && (
            <li>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex w-full items-center justify-center gap-1.5 px-5 py-3 text-xs font-semibold text-ink-600 transition-colors hover:bg-paper-100/50 focus:outline-none focus-visible:bg-paper-100 dark:text-paper-200 dark:hover:bg-umber-900/40 dark:focus-visible:bg-umber-900/60"
              >
                {expanded ? (
                  <>
                    <span>{t("timeline.no_dates_show_less")}</span>
                    <ChevronUp size={14} aria-hidden="true" />
                  </>
                ) : (
                  <>
                    <span>{t("timeline.no_dates_show_all", { count: tasks.length })}</span>
                    <ChevronDown size={14} aria-hidden="true" />
                  </>
                )}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function TimelineEditDialog({
  item,
  pocList,
  assigneeSuggestions,
  onClose,
  onSave,
}: {
  item: PlanningItem;
  pocList: { pick: CouplePick; supplier: ResolvedSupplier | null }[];
  assigneeSuggestions: string[];
  onClose: () => void;
  onSave: (patch: {
    start_date: string | null;
    due_date: string | null;
    assignee: string | null;
    supplier_id: string | null;
    done: boolean;
  }) => Promise<void>;
}) {
  const { t } = useT();
  const [startDate, setStartDate] = useState(item.start_date ?? "");
  const [dueDate, setDueDate] = useState(item.due_date ?? "");
  const [assignee, setAssignee] = useState(item.assignee ?? "");
  const [supplierId, setSupplierId] = useState(item.supplier_id ?? "");
  const [done, setDone] = useState(item.done);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const initialFocusRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    initialFocusRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!submitting) onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, submitting]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const s = startDate.trim() || null;
    const d = dueDate.trim() || null;
    if (s && d && s > d) {
      setError(t("timeline.error_dates"));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSave({
        start_date: s,
        due_date: d,
        assignee: assignee.trim() || null,
        supplier_id: supplierId || null,
        done,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const assigneeListId = "timeline-assignee-list";

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-ink-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        className="flex w-full max-w-lg max-h-[90vh] flex-col overflow-hidden rounded-t-2xl bg-paper-50 shadow-pop sm:rounded-2xl dark:bg-umber-800"
      >
        <div className="flex items-center justify-between border-b border-paper-200 px-6 py-4 dark:border-umber-700">
          <h2 className="text-base font-semibold text-ink-900 dark:text-paper-50 font-grotesk">
            {t("timeline.edit_title")}
          </h2>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={onClose}
            disabled={submitting}
            aria-label={t("common.cancel")}
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-ink-900 dark:text-paper-50">{item.title}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
                {t("timeline.field_start_date")}
              </span>
              <input
                ref={initialFocusRef}
                type="date"
                value={startDate}
                min={todayIso()}
                onChange={(e) => {
                  const newStart = e.target.value;
                  setStartDate(newStart);
                  if (dueDate && dueDate < newStart) setDueDate(newStart);
                  if (error) setError(null);
                }}
                className="input w-full"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
                {t("timeline.field_due_date")}
              </span>
              <input
                type="date"
                value={dueDate}
                min={maxIsoDate(startDate || todayIso(), todayIso())}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  if (error) setError(null);
                }}
                className="input w-full"
              />
            </label>
          </div>
          {error && <p className="text-xs text-blush-700 dark:text-blush-300">{error}</p>}

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
              {t("planning.assignee_label")}
            </span>
            <input
              type="text"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              list={assigneeSuggestions.length > 0 ? assigneeListId : undefined}
              placeholder={t("planning.assignee_placeholder")}
              maxLength={80}
              className="input w-full"
            />
            {assigneeSuggestions.length > 0 && (
              <datalist id={assigneeListId}>
                {assigneeSuggestions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            )}
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
              {t("timeline.field_supplier")}
            </span>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="input w-full"
            >
              <option value="">{t("timeline.supplier_none")}</option>
              {pocList.map(({ pick, supplier }) => {
                const label = supplier
                  ? `${supplier.name} · ${t(`suppliers.cat.${supplier.category}`)}`
                  : pick.supplier_id;
                return (
                  <option key={pick.supplier_id} value={pick.supplier_id}>
                    {label}
                  </option>
                );
              })}
            </select>
          </label>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-700 dark:text-paper-100">
            <input
              type="checkbox"
              checked={done}
              onChange={(e) => setDone(e.target.checked)}
              className="h-4 w-4 cursor-pointer rounded border-paper-300 text-ink-900 dark:border-umber-600"
            />
            <span>{t("planning.mark_done")}</span>
          </label>
        </div>
        <div className="flex gap-2 border-t border-paper-200 px-6 py-4 dark:border-umber-700">
          <button
            type="button"
            className="btn-ghost flex-1"
            onClick={onClose}
            disabled={submitting}
          >
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={submitting}>
            {submitting ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
