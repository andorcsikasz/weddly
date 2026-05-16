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
  ChevronLeft,
  ChevronRight,
  Disc3,
  Flower2,
  Gem,
  Globe,
  Hand,
  Lightbulb,
  Mail,
  Maximize2,
  PartyPopper,
  Phone,
  Shirt,
  Speaker,
  StickyNote,
  Tent,
  Wine,
  X,
} from "lucide-react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AppShell } from "../components/AppShell";
import { Skeleton, useToast } from "../components/ui";
import DayView from "./timeline/DayView";
import GanttView from "./timeline/GanttView";
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
}

function fromDirectory(s: DirectorySupplierBase): ResolvedSupplier {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    phone: s.contact_phone,
    email: s.contact_email,
    website: s.website || null,
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

type ChartMode = "day" | "week" | "month" | "quarter" | "half";

const CHART_MODE_STORAGE_KEY = "weddly.timeline.mode";

function readStoredMode(): ChartMode | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(CHART_MODE_STORAGE_KEY);
  return raw === "day" || raw === "week" || raw === "month" || raw === "quarter" || raw === "half"
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
    <AppShell>
      <div className="space-y-6">
        <header>
          <h1 className="text-3xl font-serif text-ink-900 dark:text-paper-50">
            {t("timeline.title")}
          </h1>
          <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">{t("timeline.sub")}</p>
        </header>

        <PocCard items={pocList} loading={loading} locale={locale} />

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

        <UndatedCard
          loading={loading}
          tasks={undatedTasks}
          supplierById={supplierById}
          hasAnyTasks={tasks.length > 0}
          onOpenTask={(item) => setEditing(item)}
        />
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
    </AppShell>
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
    <section className="card p-0">
      <header className="border-b border-paper-200 px-5 py-4 dark:border-umber-700">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-700 dark:text-paper-100">
          {t("timeline.poc_title")}
        </h2>
      </header>
      {loading ? (
        <ul className="divide-y divide-paper-200 p-0 dark:divide-umber-700" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 px-5 py-3">
              <Skeleton variant="circle" width={28} />
              <div className="flex-1 space-y-1.5">
                <Skeleton variant="block" width="40%" height={14} rounded="md" />
                <Skeleton variant="block" width="60%" height={11} rounded="md" />
              </div>
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-600 dark:text-umber-200">
          {t("timeline.poc_empty")}
        </p>
      ) : (
        // Below 768px collapse into a horizontal-scroll strip so each contact
        // card stays usable on phones without forcing a long vertical list.
        <ul className="flex gap-3 overflow-x-auto px-5 py-4 sm:flex-col sm:gap-0 sm:divide-y sm:divide-paper-200 sm:overflow-visible sm:px-0 sm:py-0 dark:sm:divide-umber-700">
          {items.map(({ pick, supplier }) => (
            <PocRow key={pick.supplier_id} pick={pick} supplier={supplier} locale={locale} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PocRow({
  pick,
  supplier,
  locale,
}: {
  pick: CouplePick;
  supplier: ResolvedSupplier | null;
  locale: "hu" | "en";
}) {
  const { t } = useT();
  const Icon = supplier ? CATEGORY_ICON[supplier.category] : Building2;
  const category = supplier?.category ?? (pick.supplier_id as SupplierCategory);
  const displayName =
    supplier?.name ?? (locale === "hu" ? "Ismeretlen kapcsolattartó" : "Unknown supplier");

  return (
    <li
      id={`poc-${pick.supplier_id}`}
      className="flex w-64 shrink-0 items-start gap-3 rounded-2xl border border-paper-300 px-3 py-3 transition-colors sm:w-auto sm:rounded-none sm:border-0 sm:px-5 dark:border-umber-700"
    >
      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paper-100 text-ink-700 dark:bg-umber-700 dark:text-paper-100">
        <Icon size={16} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink-900 dark:text-paper-50">
          {displayName}
        </p>
        <p className="mt-0.5 text-[11px] uppercase tracking-wider text-ink-500 dark:text-umber-300">
          {t(`suppliers.cat.${category}`)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-700 dark:text-paper-100">
          {supplier?.phone ? (
            <a
              href={`tel:${supplier.phone.replace(/\s+/g, "")}`}
              className="inline-flex items-center gap-1 rounded-full bg-paper-100 px-2 py-0.5 hover:bg-paper-200 dark:bg-umber-700 dark:hover:bg-umber-700/80"
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
              <span>—</span>
            </span>
          )}
          {supplier?.email ? (
            <a
              href={`mailto:${supplier.email}`}
              className="inline-flex items-center gap-1 rounded-full bg-paper-100 px-2 py-0.5 hover:bg-paper-200 dark:bg-umber-700 dark:hover:bg-umber-700/80"
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
              <span>—</span>
            </span>
          )}
          {supplier?.website && (
            <a
              href={supplier.website}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 rounded-full bg-paper-100 px-2 py-0.5 hover:bg-paper-200 dark:bg-umber-700 dark:hover:bg-umber-700/80"
            >
              <Globe size={11} aria-hidden="true" />
              <span>{t("suppliers.visit_website")}</span>
            </a>
          )}
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

  // Step the focal date by one unit of the current mode.
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
    else if (mode === "half")
      onCurrentDateChange(
        new Date(currentDate.getFullYear(), currentDate.getMonth() + direction * 6, 1),
      );
  }
  function navToday() {
    onCurrentDateChange(today);
  }

  const title = useMemo(() => {
    const intl = locale === "hu" ? "hu-HU" : "en-US";
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
    // quarter / half — show the inclusive range "ápr.–jún. 2026" / etc.
    const monthCount = mode === "quarter" ? 3 : 6;
    const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const end = new Date(currentDate.getFullYear(), currentDate.getMonth() + monthCount - 1, 1);
    const startFmt = new Intl.DateTimeFormat(intl, { month: "short" }).format(start);
    const endFmt = new Intl.DateTimeFormat(intl, { month: "short", year: "numeric" }).format(end);
    return `${startFmt} – ${endFmt}`;
  }, [mode, currentDate, locale]);

  function renderToolbar(opts: { showExpand: boolean }) {
    return (
      <div className="flex items-center gap-1">
        <ChartModeSwitch mode={mode} onModeChange={onModeChange} />
        {opts.showExpand && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-paper-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-50 dark:focus-visible:ring-paper-100"
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
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={navToday}
        className="rounded-full border border-paper-300 px-3 py-1 text-xs font-medium text-ink-700 transition-colors hover:bg-paper-100 dark:border-umber-700 dark:text-paper-100 dark:hover:bg-umber-700"
      >
        {t("timeline.today_button")}
      </button>
      <button
        type="button"
        onClick={() => navStep(-1)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-100 hover:text-ink-900 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-50"
        aria-label={t("timeline.prev_label")}
        title={t("timeline.prev_label")}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => navStep(1)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-100 hover:text-ink-900 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-50"
        aria-label={t("timeline.next_label")}
        title={t("timeline.next_label")}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>
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
    // quarter / half
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

  return (
    <>
      <section className={`card flex flex-col p-0 ${inlineHeightClass}`}>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-paper-200 px-5 py-4 dark:border-umber-700">
          <div className="flex flex-wrap items-center gap-3">
            {navCluster}
            <h2 className="text-base font-semibold text-ink-900 dark:text-paper-50">{title}</h2>
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
              {navCluster}
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
 *  Labels use the standard chart-app shorthand (1W / 1M / 3M / 6M) so the
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
    { value: "half", short: "6M", full: t("timeline.view_half") },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={t("timeline.view_aria")}
      className="flex items-center gap-0.5 text-sm tabular-nums"
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
            className={`min-h-tap rounded-md px-2 py-1 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:focus-visible:ring-paper-100 ${
              active
                ? "text-ink-900 dark:text-paper-50"
                : "text-ink-400 hover:text-ink-700 dark:text-umber-400 dark:hover:text-paper-200"
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
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-700 dark:text-paper-100">
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

  return (
    <section className="card p-0">
      <header className="border-b border-paper-200 px-5 py-4 dark:border-umber-700">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-700 dark:text-paper-100">
          {t("timeline.no_dates_title")}
        </h2>
      </header>
      {loading ? (
        <div className="space-y-2 p-5" aria-hidden="true">
          {[0, 1].map((i) => (
            <Skeleton key={i} variant="block" height={36} width="80%" rounded="md" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-600 dark:text-umber-200">
          {hasAnyTasks ? t("timeline.no_dates_empty") : t("timeline.no_dates_empty_all")}
        </p>
      ) : (
        <ul className="divide-y divide-paper-200 dark:divide-umber-700">
          {tasks.map((item) => {
            const supplier = item.supplier_id ? (supplierById.get(item.supplier_id) ?? null) : null;
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
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
                <button
                  type="button"
                  onClick={() => onOpenTask(item)}
                  className="btn-ghost btn-sm shrink-0"
                >
                  {t("timeline.set_dates")}
                </button>
              </li>
            );
          })}
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
          <h2 className="text-base font-semibold text-ink-900 dark:text-paper-50">
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
                  ? `${supplier.name} — ${t(`suppliers.cat.${supplier.category}`)}`
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
