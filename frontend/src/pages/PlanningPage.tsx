// Free-form planning surface. Two tabs over the same backend table:
// Feladatok (tasks — checklist with optional due date, optional assignee) +
// Ötletek (notes — free text, auto-stamped with the partner who logged it).
// The wedding-day run-of-show lives on its own page at /app/schedule (richer
// model with duration, location, sort, PDF export). One quick-add row per tab;
// rows are inline-editable on click.

import {
  TIMELINE_PHASES,
  type TimelineTemplateItem,
  WEDDING_TIMELINE,
  parseIsoDate,
  timelineDatesFor,
  timelineStatus,
  toIsoDate,
} from "@shared/planning_timeline";
import { type ConditionTag, INTAKE_DIMENSIONS } from "@shared/planning_prompts";
import type { CoupleSupplier } from "@shared/couple_suppliers";
import type { Currency, IdeaStatus, IdeaTag, PlanningItem, PlanningKind } from "@shared/types";
import {
  ArrowRight,
  Calendar,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Columns3,
  Dices,
  Flag,
  GanttChartSquare,
  Lightbulb,
  LayoutList,
  ListChecks,
  Pencil,
  Plus,
  Sparkles,
  Tag,
  Trash2,
  User,
  Wand2,
} from "lucide-react";
import {
  type FocusEvent as ReactFocusEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { Dialog, Skeleton, useConfirm, useToast } from "../components/ui";
import { DecisionsPanel } from "./DecisionsPanel";
import { alreadyListedName, ApiError } from "../lib/api";
import {
  type PlanningPromptTags,
  coupleApi,
  coupleSupplierApi,
  planningApi,
  supplierApi,
} from "../lib/endpoints";
import { DirectoryTwinNotice } from "../components/DirectoryTwinNotice";
import { setSelection } from "../lib/supplier_selection";
import { formatMoney, maxIsoDate, todayIso } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";
import {
  DICE_CREATIVE_IDEAS,
  IDEA_TEMPLATE,
  type Idea,
  type LocaleText,
  TASK_TEMPLATE,
  TASK_TEMPLATE_GROUPS,
  type TaskTemplateGroupId,
  localizeText,
  recommendedIdeas,
  rollDice,
} from "../lib/planning_templates";
import { useDocumentMeta } from "../lib/seo";

type PlanningTabKind = Exclude<PlanningKind, "schedule">;
/** The decision-prompt deck is a fourth surface over the same table, but its
 *  rows aren't a distinct PlanningKind (they're kind='task' with a seed_key) —
 *  so the tab key is its own union member, not a PlanningKind. */
type PlanningTab = PlanningTabKind | "decision";

const TABS: { kind: PlanningTab; labelKey: string; tipKey: string }[] = [
  {
    kind: "task",
    labelKey: "planning.tab_tasks",
    tipKey: "planning.tab_tasks_tip",
  },
  {
    kind: "idea",
    labelKey: "planning.tab_ideas",
    tipKey: "planning.tab_ideas_tip",
  },
  {
    kind: "decision",
    labelKey: "planning.tab_decisions",
    tipKey: "planning.tab_decisions_tip",
  },
];

const TAB_ICON: Record<PlanningTab, typeof CheckCircle2> = {
  task: CheckCircle2,
  idea: Lightbulb,
  decision: ListChecks,
};

// Collapsed icon-tool group for the Tasks-tab actions (Timeline / Generate /
// Template). Mirrors the guest toolbar: each segment shows only its icon until
// hovered, when its label slides open (max-width + opacity) and the native
// `title` tooltip appears. Literal class strings so Tailwind's JIT picks them up.
const PLAN_TOOL_BTN =
  "group flex items-center px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-700/5 disabled:cursor-not-allowed disabled:opacity-40 dark:text-paper-100 dark:hover:bg-paper-100/10";
const PLAN_TOOL_LABEL =
  "max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:ml-1.5 group-hover:max-w-[14rem] group-hover:opacity-100";

/** Single source of truth for the Ideas-tab category tags. Maps each
 *  `IdeaTag` to its i18n label key plus a token-based chip + dot colour
 *  class (tailwind tokens only). Drives the tag chips, the tag picker, and
 *  the recommended-section category badges so the visual language stays
 *  consistent everywhere an idea tag appears. */
const IDEA_TAG_META: Record<IdeaTag, { labelKey: string; chip: string; dot: string }> = {
  program: {
    labelKey: "planning.idea_tag_program",
    chip: "bg-blush-100 text-blush-700 dark:bg-blush-400/15 dark:text-blush-300",
    dot: "bg-blush-500",
  },
  decor: {
    labelKey: "planning.idea_tag_decor",
    chip: "bg-sage-100 text-sage-700 dark:bg-sage-400/15 dark:text-sage-300",
    dot: "bg-sage-500",
  },
  surprise: {
    labelKey: "planning.idea_tag_surprise",
    chip: "bg-umber-100 text-umber-700 dark:bg-umber-700/60 dark:text-umber-100",
    dot: "bg-umber-400",
  },
  keepsake: {
    labelKey: "planning.idea_tag_keepsake",
    chip: "bg-paper-200 text-ink-600 dark:bg-umber-700 dark:text-umber-200",
    dot: "bg-paper-500",
  },
  experience: {
    labelKey: "planning.idea_tag_experience",
    chip: "bg-eucalyptus-100 text-eucalyptus-700 dark:bg-eucalyptus-400/15 dark:text-eucalyptus-300",
    dot: "bg-eucalyptus-500",
  },
};
const IDEA_TAG_ORDER: IdeaTag[] = ["program", "decor", "surprise", "keepsake", "experience"];

/** Single source of truth for the Ideas-tab triage status. Three light
 *  states with token-based dot + active-pill colours: sage = doing,
 *  warm umber = not-sure, muted paper = skip. */
const IDEA_STATUS_META: Record<
  IdeaStatus,
  { labelKey: string; dot: string; activePill: string; cardTint: string }
> = {
  doing: {
    labelKey: "planning.idea_status_doing",
    dot: "bg-sage-500",
    activePill:
      "bg-sage-100 text-sage-700 ring-1 ring-sage-300 dark:bg-sage-400/15 dark:text-sage-300 dark:ring-sage-400/30",
    cardTint: "border-l-2 border-l-sage-500 dark:border-l-sage-400",
  },
  maybe: {
    labelKey: "planning.idea_status_maybe",
    dot: "bg-umber-400",
    activePill:
      "bg-umber-100 text-umber-700 ring-1 ring-umber-300 dark:bg-umber-700/60 dark:text-umber-100 dark:ring-umber-600",
    cardTint: "border-l-2 border-l-umber-400 dark:border-l-umber-300",
  },
  skip: {
    labelKey: "planning.idea_status_skip",
    dot: "bg-paper-500",
    activePill:
      "bg-paper-200 text-ink-500 ring-1 ring-paper-400 dark:bg-umber-700 dark:text-umber-300 dark:ring-umber-600",
    cardTint: "border-l-2 border-l-paper-400 dark:border-l-umber-600",
  },
};
const IDEA_STATUS_ORDER: IdeaStatus[] = ["doing", "maybe", "skip"];

/** localStorage key for the Decisions-tab personalization strip collapse state
 *  ("1" = collapsed, "0" = open). Absent means "no explicit preference yet", so
 *  the strip auto-collapses once the couple has already answered something. */
const INTAKE_COLLAPSE_KEY = "weddly.planning.intakeCollapsed";
function readIntakeCollapsePref(): boolean | null {
  try {
    const v = localStorage.getItem(INTAKE_COLLAPSE_KEY);
    if (v === "1") return false;
    if (v === "0") return true;
  } catch {
    // localStorage unavailable (private mode / SSR) - fall back to default.
  }
  return null;
}

/** Lookup table mapping every TASK_TEMPLATE title (HU + EN) to the group it
 *  came from. Lets us render a divider between Esküvő and Nászút tasks in
 *  the main list without storing a group column on `planning_items`. Hand-
 *  edited or user-typed titles fall through to "other" and don't trigger a
 *  divider, which is the right default — only the well-known template
 *  titles get the divider treatment. */
const TASK_TITLE_TO_GROUP = (() => {
  const map = new Map<string, TaskTemplateGroupId>();
  for (const group of TASK_TEMPLATE_GROUPS) {
    for (const item of group.items) {
      map.set(item.title.hu, group.id);
      map.set(item.title.en, group.id);
    }
  }
  return map;
})();

type TaskGroupOrOther = TaskTemplateGroupId | "other";

/** Resolve which list a task belongs to. Explicit `topic` on the row wins
 *  (newer rows tagged by the wand / editor); title-lookup against the wand
 *  templates is the fallback for rows that pre-date the topic column. Free-
 *  form titles with no template match fall through to "other". */

const URL_SPLIT_RE = /(https?:\/\/[^\s]+)/g;
const URL_TEST_RE = /^https?:\/\//;

/** Render a body string with bare URLs turned into "Open link" chips. */
function BodyWithLinks({ text }: { text: string }) {
  const parts = text.split(URL_SPLIT_RE);
  return (
    <>
      {parts.map((part, i) =>
        URL_TEST_RE.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded bg-paper-100 px-1.5 py-0.5 text-xs font-medium text-blush-700 hover:bg-paper-200 dark:bg-umber-700 dark:text-blush-300 dark:hover:bg-umber-600"
          >
            Open link
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

function taskGroupOf(item: PlanningItem): TaskGroupOrOther {
  if (item.topic === "wedding" || item.topic === "honeymoon") return item.topic;
  return TASK_TITLE_TO_GROUP.get(item.title) ?? "other";
}

/** i18n key for the section header above each task group. The bare "Egyéb"
 *  / "Other" header only appears when there are user-typed tasks that don't
 *  match a wand template title; it sits below the wedding + honeymoon
 *  sections. */
const TASK_GROUP_LABEL_KEY: Record<TaskGroupOrOther, string> = {
  wedding: "planning.task_group_wedding",
  honeymoon: "planning.task_group_honeymoon",
  other: "planning.task_group_other",
};

export default function PlanningPage() {
  const { t, locale } = useT();
  useDocumentMeta("seo.planning_title", "seo.planning_description");
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<PlanningItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeKind, setActiveKind] = useState<PlanningTab>("task");
  // Per-kind wand modal flags. Task + idea each open their own previewer
  // (different field shapes). The wedding-day program template lives on
  // /app/schedule, so there's no schedule wand here.
  const [taskWandOpen, setTaskWandOpen] = useState(false);
  const [timelineGenOpen, setTimelineGenOpen] = useState(false);
  const [weddingDate, setWeddingDate] = useState<string | null>(null);
  const [ideaWandOpen, setIdeaWandOpen] = useState(false);
  const [diceOpen, setDiceOpen] = useState(false);
  const [bulkApplying, setBulkApplying] = useState(false);
  // Board (kanban) view state — only active on the Tasks tab.
  const [viewMode, setViewMode] = useState<"list" | "board">("list");
  const [boardFilter, setBoardFilter] = useState<"all" | "tasks" | "vendors">("all");
  const [vendors, setVendors] = useState<CoupleSupplier[]>([]);
  const [vendorsFetched, setVendorsFetched] = useState(false);
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<CoupleSupplier | null>(null);
  // The directory, for the vendor modal's "already on Weddly?" check. Fetched
  // the first time that modal opens rather than on page load: /app/planning is
  // a task board and most visits never open it, so the whole listing payload
  // would be paid for nothing. A failure degrades to no check.
  const [directory, setDirectory] = useState<DirectorySupplier[]>([]);
  const directoryRequested = useRef(false);
  const loadDirectory = useCallback(() => {
    if (directoryRequested.current) return;
    directoryRequested.current = true;
    supplierApi
      .list(undefined, "all")
      .then((r) => setDirectory(r.suppliers))
      .catch(() => undefined);
  }, []);

  // Priority filter for the tasks tab: 0 = show everything, 1 = important
  // only (priority === 1), 2 = SOS only (priority === 2). The two levels are
  // mutually exclusive — a task is either important or SOS, never both. Reset
  // on tab switch via the effect below so it doesn't quietly hide ideas.
  const [priorityFilter, setPriorityFilter] = useState<0 | 1 | 2>(0);
  useEffect(() => {
    if (activeKind !== "task") {
      setPriorityFilter(0);
      setViewMode("list");
    }
  }, [activeKind]);

  // Fetch vendors when the board view is first activated on the Tasks tab.
  useEffect(() => {
    if (viewMode !== "board" || vendorsFetched) return;
    setVendorsFetched(true);
    coupleSupplierApi
      .list()
      .then((r) => setVendors(r.suppliers))
      .catch(() => undefined);
  }, [viewMode, vendorsFetched]);

  // Decisions-tab intake answers + collapse state live here (not in
  // DecisionsPanel) so the collapsed intake bar can ride up in the tab row next
  // to the pills while the answer grid renders below. Answers tune which
  // conditional decision prompts surface.
  const [intakeTags, setIntakeTags] = useState<PlanningPromptTags>({});
  const [intakeOpen, setIntakeOpen] = useState<boolean>(() => readIntakeCollapsePref() ?? true);
  const intakeAutoSet = useRef(false);
  useEffect(() => {
    let alive = true;
    void planningApi
      .getPromptProfile()
      .then((res) => {
        if (!alive) return;
        const tags = res.tags ?? {};
        setIntakeTags(tags);
        // No saved preference yet: collapse the setup strip the first time we
        // see the couple has already answered something; keep it open otherwise.
        if (readIntakeCollapsePref() === null && !intakeAutoSet.current) {
          intakeAutoSet.current = true;
          const answered = INTAKE_DIMENSIONS.filter((d) => tags[d.tag] != null).length;
          setIntakeOpen(answered === 0);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const intakeAnswered = useMemo(
    () => INTAKE_DIMENSIONS.filter((d) => intakeTags[d.tag] != null).length,
    [intakeTags],
  );
  function toggleIntake() {
    setIntakeOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem(INTAKE_COLLAPSE_KEY, next ? "0" : "1");
      } catch {
        // best-effort persistence only
      }
      return next;
    });
  }
  async function handleSetTag(tag: ConditionTag, value: "yes" | "no") {
    const next: PlanningPromptTags = { ...intakeTags };
    if (next[tag] === value) delete next[tag];
    else next[tag] = value;
    setIntakeTags(next);
    try {
      await planningApi.savePromptProfile(next);
    } catch {
      toast.error(t("planning.decisions.save_error"));
    }
  }

  // The two partners, surfaced as ready-made options in the task "assignee"
  // datalist (the common case — a task is owned by one of them). Their actual
  // names when set, else the generic bride / groom role labels. Best-effort:
  // a failed fetch just leaves the datalist with the typed-history suggestions.
  const [partnerNames, setPartnerNames] = useState<string[]>([]);
  // Needed to record a directory pick when the couple adopts a listing instead
  // of adding their own row. Null until the fetch lands, which just means the
  // adopt action isn't offered yet.
  const [coupleId, setCoupleId] = useState<number | null>(null);
  // The board renders offer amounts, so it needs the workspace's own currency.
  // HUF until the fetch lands, which is what every other page falls back to.
  const [currency, setCurrency] = useState<Currency>("HUF");
  useEffect(() => {
    coupleApi
      .current()
      .then((r) => {
        if (!r.couple) return;
        setCoupleId(r.couple.id);
        setCurrency(r.couple.currency ?? "HUF");
        setWeddingDate(r.couple.wedding_date ?? null);
        const bride = r.couple.bride_name?.trim() || t("planning.assignee_bride");
        const groom = r.couple.groom_name?.trim() || t("planning.assignee_groom");
        setPartnerNames([...new Set([bride, groom].filter(Boolean))]);
      })
      .catch(() => undefined);
  }, [t]);

  async function refresh() {
    try {
      const r = await planningApi.list();
      setItems(r.items);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  // Display order: (position ASC, created_at ASC) — matches the backend's
  // canonical sort so the list looks identical on first paint and after
  // local reorder PATCHes. Priority filter is applied AFTER the sort so the
  // remaining rows keep their relative order.
  const scoped = useMemo(
    () =>
      items
        .filter((i) => i.kind === activeKind)
        // Decision-prompts are kind='task' rows; keep them out of the dated
        // Tasks list until they're promoted into real tasks.
        .filter((i) => !(i.kind === "task" && i.seed_key && i.decision_status !== "promoted"))
        .filter(
          (i) => i.kind !== "task" || priorityFilter === 0 || (i.priority ?? 0) === priorityFilter,
        )
        .sort((a, b) => {
          if (a.position !== b.position) return a.position - b.position;
          return a.created_at - b.created_at;
        }),
    [items, activeKind, priorityFilter],
  );

  /** Tasks split into strictly-ordered sections: Esküvő → Nászút → Egyéb.
   *  Each section is its own to-do list — reorder buttons stop at the
   *  section boundary so a Nászút row can't slide past an Esküvő row by
   *  accident. Empty sections drop out at render time. Ideas tab returns
   *  one anonymous section containing everything (no group separation). */
  const taskSections = useMemo(() => {
    if (activeKind !== "task") {
      return [{ group: "other" as TaskGroupOrOther, items: scoped }];
    }
    const byGroup: Record<TaskGroupOrOther, PlanningItem[]> = {
      wedding: [],
      honeymoon: [],
      other: [],
    };
    for (const i of scoped) byGroup[taskGroupOf(i)].push(i);
    const order: TaskGroupOrOther[] = ["wedding", "honeymoon", "other"];
    return order.map((g) => ({ group: g, items: byGroup[g] })).filter((s) => s.items.length > 0);
  }, [activeKind, scoped]);

  /** Counts per priority level for the filter-pill badges. Computed once
   *  per items/tab change so the pill labels stay in sync as the user
   *  cycles priority levels on individual rows. */
  const taskPriorityCounts = useMemo(() => {
    let p1 = 0;
    let p2 = 0;
    for (const i of items) {
      if (i.kind !== "task") continue;
      if (i.seed_key && i.decision_status !== "promoted") continue;
      const p = i.priority ?? 0;
      if (p === 1) p1++;
      if (p === 2) p2++;
    }
    return { p1, p2 };
  }, [items]);

  async function onCreate(input: {
    title: string;
    body?: string | null;
    start_date?: string | null;
    due_date?: string | null;
    assignee?: string | null;
  }) {
    // The decision tab has no quick-add form; this guard also narrows
    // activeKind to a real PlanningKind for the create call.
    if (activeKind === "decision") return;
    try {
      const r = await planningApi.create({ kind: activeKind, ...input });
      setItems((prev) => [...prev, r.item]);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  // Intake tags answered "yes" — drives the "Nektek ajánljuk" recommender.
  const yesTags = useMemo(
    () =>
      Object.entries(intakeTags)
        .filter(([, v]) => v === "yes")
        .map(([k]) => k),
    [intakeTags],
  );

  /** Add a single curated/recommended idea (with its category tag) as an
   *  idea row. Optimistic push + success toast. Returns whether it landed. */
  async function onAddRecommendedIdea(idea: Idea): Promise<boolean> {
    try {
      const r = await planningApi.create({
        kind: "idea",
        title: localizeText(idea.title, locale),
        body: localizeText(idea.body, locale),
        idea_tag: idea.tag ?? null,
      });
      setItems((prev) => [...prev, r.item]);
      toast.success(t("planning.recommended_added"));
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      return false;
    }
  }

  /** Bridge: when an idea is committed to ("doing"), let the couple drop it
   *  into the Tasks list as a real task carrying the same title + notes. */
  async function onConvertIdeaToTask(item: PlanningItem) {
    try {
      const r = await planningApi.create({
        kind: "task",
        title: item.title,
        body: item.body ?? null,
      });
      setItems((prev) => [...prev, r.item]);
      toast.success(t("planning.idea_to_task_done"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  // Datalist for the task "assignee" field: the two partners first (the common
  // owners), then every other assignee already used across existing tasks. The
  // partners lead so they're a one-click pick; the rest stay alphabetical.
  const assigneeSuggestions = useMemo(() => {
    const seen = new Set<string>(partnerNames);
    const rest: string[] = [];
    for (const i of items) {
      if (i.kind === "task" && i.assignee && !seen.has(i.assignee)) {
        seen.add(i.assignee);
        rest.push(i.assignee);
      }
    }
    rest.sort((a, b) => a.localeCompare(b, "hu"));
    return [...partnerNames, ...rest];
  }, [items, partnerNames]);

  async function onToggleDone(item: PlanningItem) {
    const nextDone = !item.done;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: nextDone } : i)));
    try {
      await planningApi.update(item.id, { done: nextDone });
    } catch (e) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: item.done } : i)));
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  async function onPatch(item: PlanningItem, patch: Partial<PlanningItem>) {
    const prev = item;
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, ...patch } : i)));
    try {
      await planningApi.update(item.id, patch);
    } catch (e) {
      setItems((list) => list.map((i) => (i.id === item.id ? prev : i)));
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  /** Cycle the priority flag on a task row: 0 → 1 → 2 → 0. Optimistic, with
   *  a rollback toast on failure. Tasks-only; ideas don't carry priority. */
  async function onCyclePriority(item: PlanningItem) {
    if (item.kind !== "task") return;
    const current = (item.priority ?? 0) as 0 | 1 | 2;
    const next: 0 | 1 | 2 = current === 0 ? 1 : current === 1 ? 2 : 0;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, priority: next } : i)));
    try {
      await planningApi.update(item.id, { priority: next });
    } catch (e) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, priority: current } : i)));
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  /** Swap an item with its visible neighbour. Re-stripes the affected list
   *  to 0..N-1 so all-zero defaults (every freshly-created row stores
   *  position=0) settle into a stable order before the swap lands. Each row
   *  whose position changed gets its own PATCH.
   *
   *  Boundary rule: for tasks the swap scope is the item's *group* (wedding
   *  / honeymoon / other), not the entire kind. The two template groups are
   *  rendered as separate to-do lists, so a wedding row can never move past
   *  the first honeymoon row and vice versa. Ideas use kind-wide scope. */
  async function onMove(item: PlanningItem, direction: "up" | "down") {
    const itemGroup = item.kind === "task" ? taskGroupOf(item) : null;
    const list = items
      .filter((i) => {
        if (i.kind !== item.kind) return false;
        if (item.kind === "task") return taskGroupOf(i) === itemGroup;
        return true;
      })
      .sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position;
        return a.created_at - b.created_at;
      });
    const idx = list.findIndex((i) => i.id === item.id);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= list.length) return;

    const reordered = [...list];
    const a = reordered[idx];
    const b = reordered[swapIdx];
    if (!a || !b) return;
    reordered[idx] = b;
    reordered[swapIdx] = a;
    const newPositions = new Map<number, number>(reordered.map((it, i) => [it.id, i]));

    const snapshot = items;
    setItems((prev) =>
      prev.map((p) => {
        const np = newPositions.get(p.id);
        return np === undefined ? p : { ...p, position: np };
      }),
    );
    try {
      for (const it of list) {
        const np = newPositions.get(it.id);
        if (np !== undefined && it.position !== np) {
          await planningApi.update(it.id, { position: np });
        }
      }
    } catch (e) {
      setItems(snapshot);
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  async function onDelete(item: PlanningItem) {
    const ok = await confirm({
      title: t("planning.delete_confirm_title"),
      body: t("planning.delete_confirm_body"),
      confirmLabel: t("common.confirm_delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await planningApi.remove(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  const hasTaskItems = useMemo(
    () => items.some((i) => i.kind === "task" && !(i.seed_key && i.decision_status !== "promoted")),
    [items],
  );
  const hasIdeaItems = useMemo(() => items.some((i) => i.kind === "idea"), [items]);

  /** Lower-cased titles of existing tasks — lets the timeline generator mark
   *  items the couple already has so it never creates a duplicate "Book the
   *  venue". Matches on the localized title the generator would write. */
  const existingTaskTitles = useMemo(() => {
    const set = new Set<string>();
    for (const i of items)
      if (i.kind === "task" && !i.seed_key) set.add(i.title.trim().toLowerCase());
    return set;
  }, [items]);

  /** Lower-cased titles of existing ideas — lets the "Nektek ajánljuk"
   *  recommender hide a card the couple has already added. */
  const existingIdeaTitles = useMemo(() => {
    const set = new Set<string>();
    for (const i of items) if (i.kind === "idea") set.add(i.title.trim().toLowerCase());
    return set;
  }, [items]);

  /** Generic bulk-creator: takes an array of CreateInputs, POSTs sequentially,
   *  pushes successes into state, surfaces the count via toast. Used by all
   *  three wand variants + the dice "add this one" CTA. */
  async function bulkCreate(
    entries: {
      title: string;
      body?: string | null;
      assignee?: string | null;
      topic?: "wedding" | "honeymoon" | null;
      start_date?: string | null;
      due_date?: string | null;
    }[],
    kind: PlanningKind,
    successKey: string,
  ): Promise<number> {
    setBulkApplying(true);
    let added = 0;
    try {
      const created: PlanningItem[] = [];
      for (const entry of entries) {
        const r = await planningApi.create({ kind, ...entry });
        created.push(r.item);
        added += 1;
      }
      setItems((prev) => [...prev, ...created]);
      if (added > 0) toast.success(t(successKey, { count: added }));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setBulkApplying(false);
    }
    return added;
  }

  async function onCreateVendor(input: {
    name: string;
    category: string;
    next_step: string | null;
    probability: number | null;
    price_huf: number | null;
    confirm_not_listed?: boolean;
  }) {
    try {
      const r = await coupleSupplierApi.create({
        name: input.name,
        category: input.category as CoupleSupplier["category"],
        next_step: input.next_step,
        probability: input.probability,
        price_huf: input.price_huf,
        confirm_not_listed: input.confirm_not_listed,
      });
      setVendors((prev) => [...prev, r.supplier]);
    } catch (e) {
      // The modal's own notice only knows the directory it managed to load; the
      // server knows all of it. Steer to the listing rather than showing a raw
      // "Already on Weddly: X" from the API.
      const listed = alreadyListedName(e);
      if (listed !== null) {
        toast.info(t("suppliers.submit.err_already_listed", { name: listed }));
        throw e;
      }
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      throw e;
    }
  }

  // The couple was about to add a pipeline row for a business Weddly already
  // lists. Record it as their pick for its category instead: that is the same
  // "this is our vendor" state the directory page writes, and it carries the
  // listing's photos, address and reviews, which a private row never would.
  // No pipeline row is created, so there is nothing to keep in sync with it.
  function onAdoptVendor(supplier: DirectorySupplier) {
    if (coupleId === null) return;
    setSelection(coupleId, supplier.category, supplier.id);
    toast.success(t("suppliers.twin.adopted_toast", { name: supplier.name }));
    setVendorModalOpen(false);
  }

  async function onUpdateVendor(
    id: string,
    input: {
      name: string;
      category: string;
      next_step: string | null;
      probability: number | null;
      price_huf: number | null;
    },
  ) {
    try {
      const r = await coupleSupplierApi.update(id, {
        name: input.name,
        category: input.category as CoupleSupplier["category"],
        next_step: input.next_step,
        probability: input.probability,
        price_huf: input.price_huf,
      });
      setVendors((prev) => prev.map((v) => (v.id === id ? r.supplier : v)));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      throw e;
    }
  }

  async function onDeleteVendor(id: string): Promise<boolean> {
    const ok = await confirm({
      title: t("planning.board_vendor_delete_confirm"),
      body: "",
      confirmLabel: t("common.confirm_delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return false;
    try {
      await coupleSupplierApi.remove(id);
      setVendors((prev) => prev.filter((v) => v.id !== id));
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      return false;
    }
  }

  async function onApplyTaskTemplate(selected: Set<number>, defaultAssignee: string) {
    const trimmed = defaultAssignee.trim();
    // Resolve each selected flat-index back to the group it belongs to so
    // honeymoon-group items get persisted with topic: "honeymoon" — the
    // honeymoon page filters tasks by that topic. Wedding-group items get
    // an explicit "wedding" stamp so the surface filter on /app/tervezés
    // can pivot symmetrically later if needed.
    const groupBounds: { id: "wedding" | "honeymoon"; start: number; end: number }[] = [];
    {
      let offset = 0;
      for (const g of TASK_TEMPLATE_GROUPS) {
        groupBounds.push({ id: g.id, start: offset, end: offset + g.items.length });
        offset += g.items.length;
      }
    }
    function topicForIndex(idx: number): "wedding" | "honeymoon" {
      const b = groupBounds.find((g) => idx >= g.start && idx < g.end);
      return b?.id ?? "wedding";
    }
    const entries = TASK_TEMPLATE.flatMap((tmpl, idx) =>
      selected.has(idx)
        ? [
            {
              title: localizeText(tmpl.title, locale),
              assignee: trimmed || null,
              topic: topicForIndex(idx),
              due_date: weddingDate
                ? (() => {
                    const d = new Date(weddingDate);
                    d.setDate(d.getDate() + tmpl.deadline_days);
                    return d.toISOString().split("T")[0];
                  })()
                : null,
            },
          ]
        : [],
    );
    if (entries.length === 0) return;
    const added = await bulkCreate(entries, "task", "planning.template_tasks_done");
    if (added > 0) setTaskWandOpen(false);
  }

  /** Apply the safe-timeline generator: each picked template item becomes a
   *  dated task. The due date may have been edited in the dialog; the start
   *  date trails it by the item's action window so the Gantt bar gets a span.
   *  Items the couple left undated (no wedding date set) persist as plain
   *  checklist tasks they can date later. */
  async function onApplyTimeline(picked: { item: TimelineTemplateItem; dueDate: string | null }[]) {
    if (picked.length === 0) return;
    const entries = picked.map(({ item, dueDate }) => {
      const due = dueDate || null;
      let start: string | null = null;
      if (due) {
        const d = parseIsoDate(due);
        if (d) {
          d.setDate(d.getDate() - item.windowDays);
          start = toIsoDate(d);
        }
      }
      return {
        title: localizeText(item.title, locale),
        topic: item.topic,
        due_date: due,
        start_date: start,
      };
    });
    const added = await bulkCreate(entries, "task", "planning.timeline_gen_done");
    if (added > 0) setTimelineGenOpen(false);
  }

  async function onApplyIdeaTemplate(selected: Set<number>) {
    const entries = IDEA_TEMPLATE.flatMap((tmpl, idx) =>
      selected.has(idx)
        ? [
            {
              title: localizeText(tmpl.title, locale),
              body: tmpl.body ? localizeText(tmpl.body, locale) : null,
            },
          ]
        : [],
    );
    if (entries.length === 0) return;
    const added = await bulkCreate(entries, "idea", "planning.template_ideas_done");
    if (added > 0) setIdeaWandOpen(false);
  }

  return (
    <>
      <div>
        <header className="mb-4">
          <h1 className="text-3xl font-grotesk text-ink-900 sm:text-4xl dark:text-paper-50">
            {t("planning.title")}
          </h1>
          <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">{t("planning.sub")}</p>
        </header>

        {/* Tabs and the per-tab actions share one row to keep the header
         *  compact. Tabs anchor left; actions push right via ml-auto, and the
         *  whole row stacks on narrow screens. */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <nav
            role="tablist"
            data-tour-target="planning-tabs"
            aria-label={t("planning.tabs_aria")}
            className="inline-flex gap-1 rounded-2xl border border-ink-900 bg-paper-100/50 p-1 dark:border-umber-700 dark:bg-umber-700/60"
          >
            {TABS.map((tab) => {
              const active = tab.kind === activeKind;
              const Icon = TAB_ICON[tab.kind];
              return (
                <button
                  key={tab.kind}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveKind(tab.kind)}
                  className={`group relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-4 py-1.5 transition-colors sm:flex-none ${
                    active
                      ? "bg-ink-800 text-paper-100 shadow-soft dark:bg-umber-900 dark:text-paper-50"
                      : "text-ink-600 hover:bg-paper-200 dark:text-umber-200 dark:hover:bg-umber-700"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm leading-none">
                    <Icon size={16} aria-hidden="true" />
                    <span>{t(tab.labelKey)}</span>
                  </span>
                  {/* Instant styled tooltip (same visual language as the guest
                   *  header stat tooltips). aria-hidden since the tab already
                   *  carries a visible accessible name. Suppressed on the active
                   *  tab so the just-clicked tab doesn't keep showing it. */}
                  {!active && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-max max-w-[15rem] -translate-x-1/2 whitespace-normal rounded-lg bg-umber-900 px-2.5 py-1.5 text-center text-xs font-normal leading-snug text-paper-50 opacity-0 shadow-pop transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100 dark:bg-umber-950"
                    >
                      {t(tab.tipKey)}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {activeKind === "decision" && (
            <button
              type="button"
              onClick={toggleIntake}
              aria-expanded={intakeOpen}
              className="flex w-full items-center gap-3 rounded-2xl border border-ink-900 bg-paper-100/40 px-4 py-2 text-left transition-colors hover:bg-paper-200/40 dark:border-umber-700 dark:bg-umber-800/40 dark:hover:bg-umber-700/40 sm:ml-auto sm:flex-1"
            >
              <span className="flex-1 truncate font-grotesk text-xs font-semibold uppercase tracking-[0.08em] text-ink-500 dark:text-umber-300">
                {t("planning.decisions.setup_label")}
              </span>
              <span className="shrink-0 rounded-full bg-paper-200 px-2.5 py-1 text-[11px] font-medium text-ink-600 dark:bg-umber-700 dark:text-umber-100">
                {t("planning.decisions.setup_answered", {
                  n: String(intakeAnswered),
                  total: String(INTAKE_DIMENSIONS.length),
                })}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-sage-600 dark:text-sage-300">
                {t(
                  intakeOpen
                    ? "planning.decisions.setup_done"
                    : "planning.decisions.setup_continue",
                )}
                <ChevronDown
                  size={16}
                  aria-hidden="true"
                  className={`transition-transform ${intakeOpen ? "rotate-180" : ""}`}
                />
              </span>
            </button>
          )}

          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {activeKind === "task" && (
              <>
                {/* List / Board view toggle — anchored left of the action pill. */}
                <div
                  role="group"
                  aria-label={`${t("planning.view_list")} / ${t("planning.view_board")}`}
                  className="inline-flex items-stretch overflow-hidden rounded-lg border border-ink-700 dark:border-paper-100"
                >
                  <button
                    type="button"
                    onClick={() => setViewMode("list")}
                    aria-pressed={viewMode === "list"}
                    title={t("planning.view_list")}
                    aria-label={t("planning.view_list")}
                    className={`flex items-center px-2.5 py-2 transition-colors ${
                      viewMode === "list"
                        ? "bg-ink-800 text-paper-50 dark:bg-paper-100 dark:text-umber-900"
                        : "text-ink-500 hover:bg-ink-700/5 dark:text-umber-300 dark:hover:bg-paper-100/10"
                    }`}
                  >
                    <LayoutList size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("board")}
                    aria-pressed={viewMode === "board"}
                    title={t("planning.view_board")}
                    aria-label={t("planning.view_board")}
                    className={`flex items-center border-l border-ink-300 px-2.5 py-2 transition-colors dark:border-umber-600 ${
                      viewMode === "board"
                        ? "bg-ink-800 text-paper-50 dark:bg-paper-100 dark:text-umber-900"
                        : "text-ink-500 hover:bg-ink-700/5 dark:text-umber-300 dark:hover:bg-paper-100/10"
                    }`}
                  >
                    <Columns3 size={16} aria-hidden="true" />
                  </button>
                </div>

                {/* Collapsed icon-tool group: Timeline / Generate schedule /
                 *  Template. Each segment is icon-only until hovered, when its
                 *  label slides open (mirrors the guest toolbar). */}
                <div className="inline-flex items-stretch divide-x divide-ink-300 overflow-hidden rounded-lg border border-ink-700 dark:divide-umber-600 dark:border-paper-100">
                  <Link
                    to="/app/timeline"
                    className={PLAN_TOOL_BTN}
                    title={t("planning.timeline_link_hint")}
                    aria-label={t("planning.timeline_link")}
                  >
                    <GanttChartSquare size={16} aria-hidden="true" />
                    <span className={PLAN_TOOL_LABEL}>{t("planning.timeline_link")}</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => setTimelineGenOpen(true)}
                    className={PLAN_TOOL_BTN}
                    title={t("planning.timeline_gen_button_hint")}
                    aria-label={t("planning.timeline_gen_button")}
                  >
                    <CalendarClock size={16} aria-hidden="true" />
                    <span className={PLAN_TOOL_LABEL}>{t("planning.timeline_gen_button")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTaskWandOpen(true)}
                    className={PLAN_TOOL_BTN}
                    title={t("planning.task_template_button_hint")}
                    aria-label={t("planning.task_template_button")}
                  >
                    <Wand2 size={16} aria-hidden="true" />
                    <span className={PLAN_TOOL_LABEL}>{t("planning.task_template_button")}</span>
                  </button>
                </div>
              </>
            )}
            {activeKind === "idea" && (
              <>
                <button
                  type="button"
                  onClick={() => setIdeaWandOpen(true)}
                  className="btn-ghost btn-sm inline-flex items-center gap-1.5"
                  title={t("planning.idea_template_button_hint")}
                >
                  <Wand2 size={14} aria-hidden="true" />
                  <span>{t("planning.idea_template_button")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDiceOpen(true)}
                  className="btn-ghost btn-sm inline-flex items-center gap-1.5"
                  title={t("planning.dice_button_hint")}
                >
                  <Dices size={14} aria-hidden="true" />
                  <span>{t("planning.dice_button")}</span>
                </button>
              </>
            )}
          </div>
        </div>

        {activeKind === "decision" ? (
          <DecisionsPanel
            items={items}
            loading={loading}
            locale={locale}
            onItemsChange={setItems}
            tags={intakeTags}
            onSetTag={handleSetTag}
            intakeOpen={intakeOpen}
          />
        ) : (
          <>
            <QuickAddForm
              kind={activeKind}
              assigneeSuggestions={assigneeSuggestions}
              onCreate={onCreate}
            />

            {activeKind === "idea" && (
              <RecommendedIdeas
                yesTags={yesTags}
                locale={locale}
                existingTitles={existingIdeaTitles}
                onAdd={onAddRecommendedIdea}
                onOpenDecisions={() => setActiveKind("decision")}
              />
            )}

            {activeKind === "task" && viewMode === "board" && (
              <div
                role="radiogroup"
                aria-label={t("planning.board_filter_all")}
                className="mt-4 flex flex-wrap items-center gap-2 text-xs"
              >
                <PriorityFilterPill
                  active={boardFilter === "all"}
                  onClick={() => setBoardFilter("all")}
                  label={t("planning.board_filter_all")}
                />
                <PriorityFilterPill
                  active={boardFilter === "tasks"}
                  onClick={() => setBoardFilter("tasks")}
                  label={t("planning.board_filter_tasks")}
                />
                <PriorityFilterPill
                  active={boardFilter === "vendors"}
                  onClick={() => setBoardFilter("vendors")}
                  label={t("planning.board_filter_vendors")}
                />
              </div>
            )}

            {activeKind === "task" &&
              viewMode === "list" &&
              (taskPriorityCounts.p1 > 0 || taskPriorityCounts.p2 > 0 || priorityFilter !== 0) && (
                <div
                  role="radiogroup"
                  aria-label={t("planning.priority_filter_aria")}
                  className="mt-4 flex flex-wrap items-center gap-2 text-xs"
                >
                  <PriorityFilterPill
                    active={priorityFilter === 0}
                    onClick={() => setPriorityFilter(0)}
                    label={t("planning.priority_filter_all")}
                  />
                  <PriorityFilterPill
                    active={priorityFilter === 1}
                    onClick={() => setPriorityFilter(1)}
                    label={
                      <>
                        <span className="font-bold text-blush-700 dark:text-blush-300">!</span>
                        <span>{t("planning.priority_filter_important")}</span>
                        {taskPriorityCounts.p1 > 0 && (
                          <span className="text-ink-400 dark:text-umber-300">
                            ({taskPriorityCounts.p1})
                          </span>
                        )}
                      </>
                    }
                  />
                  <PriorityFilterPill
                    active={priorityFilter === 2}
                    onClick={() => setPriorityFilter(2)}
                    label={
                      <>
                        <span className="font-bold text-blush-700 dark:text-blush-300">!!</span>
                        <span>{t("planning.priority_filter_sos")}</span>
                        {taskPriorityCounts.p2 > 0 && (
                          <span className="text-ink-400 dark:text-umber-300">
                            ({taskPriorityCounts.p2})
                          </span>
                        )}
                      </>
                    }
                  />
                </div>
              )}

            {activeKind === "task" && viewMode === "board" ? (
              <KanbanBoard
                tasks={items.filter(
                  (i) => i.kind === "task" && !(i.seed_key && i.decision_status !== "promoted"),
                )}
                vendors={vendors}
                currency={currency}
                filter={boardFilter}
                onToggleTaskDone={onToggleDone}
                onPatchTask={onPatch}
                onAddVendor={() => {
                  loadDirectory();
                  setEditingVendor(null);
                  setVendorModalOpen(true);
                }}
                onEditVendor={(v) => {
                  setEditingVendor(v);
                  setVendorModalOpen(true);
                }}
              />
            ) : loading ? (
              <PlanningListSkeleton kind={activeKind} />
            ) : scoped.length === 0 ? (
              <EmptyState
                kind={activeKind}
                onRollDice={activeKind === "idea" ? () => setDiceOpen(true) : undefined}
              />
            ) : (
              <div className="mt-4 space-y-6">
                {taskSections.map((section) => {
                  // Section header only on the tasks tab AND only when there are
                  // at least two distinct groups visible — a single-group list
                  // doesn't need a label, that's just noise.
                  const showHeader = activeKind === "task" && taskSections.length > 1;
                  const groupDone = section.items.filter((i) => i.done).length;
                  return (
                    <section key={section.group}>
                      {showHeader && (
                        <h2 className="mb-2 flex items-center gap-2 font-grotesk text-xs font-semibold uppercase tracking-[0.08em] text-ink-500 dark:text-umber-300">
                          <span>{t(TASK_GROUP_LABEL_KEY[section.group])}</span>
                          <span className="rounded-full bg-paper-200 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-ink-500 dark:bg-umber-700 dark:text-umber-200">
                            {t("planning.group_done_count", {
                              done: groupDone,
                              total: section.items.length,
                            })}
                          </span>
                        </h2>
                      )}
                      <ul className="space-y-2">
                        {section.items.map((item, idx) => (
                          <PlanningRow
                            key={item.id}
                            item={item}
                            assigneeSuggestions={assigneeSuggestions}
                            canMoveUp={idx > 0}
                            canMoveDown={idx < section.items.length - 1}
                            onToggleDone={() => onToggleDone(item)}
                            onPatch={(patch) => onPatch(item, patch)}
                            onCyclePriority={() => onCyclePriority(item)}
                            onMove={(direction) => onMove(item, direction)}
                            onDelete={() => onDelete(item)}
                            onConvertToTask={() => onConvertIdeaToTask(item)}
                          />
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {timelineGenOpen && (
        <TimelineGeneratorDialog
          applying={bulkApplying}
          weddingDate={weddingDate}
          existingTitles={existingTaskTitles}
          locale={locale}
          onClose={() => setTimelineGenOpen(false)}
          onApply={onApplyTimeline}
        />
      )}

      {taskWandOpen && (
        <TaskTemplateDialog
          existing={hasTaskItems}
          applying={bulkApplying}
          assigneeSuggestions={assigneeSuggestions}
          locale={locale}
          weddingDate={weddingDate}
          onClose={() => setTaskWandOpen(false)}
          onApply={onApplyTaskTemplate}
        />
      )}

      {ideaWandOpen && (
        <IdeaTemplateDialog
          existing={hasIdeaItems}
          applying={bulkApplying}
          locale={locale}
          onClose={() => setIdeaWandOpen(false)}
          onApply={onApplyIdeaTemplate}
        />
      )}

      {diceOpen && (
        <DiceDialog
          applying={bulkApplying}
          locale={locale}
          onClose={() => setDiceOpen(false)}
          onAccept={async (idea) => {
            const added = await bulkCreate(
              [
                {
                  title: localizeText(idea.title, locale),
                  body: localizeText(idea.body, locale),
                },
              ],
              "idea",
              "planning.dice_added_one",
            );
            return added > 0;
          }}
        />
      )}

      {vendorModalOpen && (
        <VendorModal
          vendor={editingVendor}
          directory={directory}
          onUseExisting={coupleId === null ? undefined : onAdoptVendor}
          onClose={() => setVendorModalOpen(false)}
          onCreate={onCreateVendor}
          onUpdate={onUpdateVendor}
          onDelete={onDeleteVendor}
        />
      )}
    </>
  );
}

/** Compact status chip on a task row. Renders ONLY for the two states that
 *  need action — overdue (filled blush, urgent) and due-soon (light blush,
 *  a heads-up). On-track / done / undated tasks show nothing so the list
 *  stays quiet until something actually needs attention. */
function TaskStatusPill({ item }: { item: PlanningItem }) {
  const { t } = useT();
  const status = timelineStatus(item.due_date, item.done, todayIso());
  if (status === "overdue") {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-blush-500 px-2 py-0.5 text-[11px] font-medium text-paper-50">
        {t("planning.status_overdue")}
      </span>
    );
  }
  if (status === "due_soon") {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-blush-50 px-2 py-0.5 text-[11px] font-medium text-blush-700 ring-1 ring-blush-200 dark:bg-blush-400/15 dark:text-blush-300 dark:ring-blush-400/30">
        {t("planning.status_due_soon")}
      </span>
    );
  }
  return null;
}

/** "Build my timeline" generator. Turns the canonical WEDDING_TIMELINE into a
 *  preview the couple confirms BEFORE anything is written: each row carries a
 *  deadline pre-computed from the wedding date (editable inline), items the
 *  couple already has are shown greyed + excluded, and apply creates the picked
 *  rows as dated tasks. With no exact wedding date the deadlines start blank —
 *  the couple can still add the tasks and date them later. */
function TimelineGeneratorDialog({
  applying,
  weddingDate,
  existingTitles,
  locale,
  onClose,
  onApply,
}: {
  applying: boolean;
  weddingDate: string | null;
  existingTitles: Set<string>;
  locale: Locale;
  onClose: () => void;
  onApply: (picked: { item: TimelineTemplateItem; dueDate: string | null }[]) => Promise<void>;
}) {
  const { t } = useT();

  // Which template items the couple already has — matched on the localized
  // title we would write, so a generated "Book the venue" is recognised.
  const alreadyHave = useMemo(() => {
    const set = new Set<string>();
    for (const item of WEDDING_TIMELINE) {
      if (existingTitles.has(localizeText(item.title, locale).trim().toLowerCase()))
        set.add(item.key);
    }
    return set;
  }, [existingTitles, locale]);

  // Default selection: everything the couple doesn't already have.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(WEDDING_TIMELINE.filter((i) => !alreadyHave.has(i.key)).map((i) => i.key)),
  );
  // Editable due dates, pre-filled from the wedding date (blank when there's
  // no exact date to anchor on).
  const [dueDates, setDueDates] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const item of WEDDING_TIMELINE) {
      map[item.key] = timelineDatesFor(weddingDate, item)?.due_date ?? "";
    }
    return map;
  });

  const selectable = WEDDING_TIMELINE.filter((i) => !alreadyHave.has(i.key));
  const allSelected = selectable.length > 0 && selected.size === selectable.length;

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function apply() {
    const picked = WEDDING_TIMELINE.filter((i) => selected.has(i.key)).map((item) => ({
      item,
      dueDate: dueDates[item.key]?.trim() || null,
    }));
    void onApply(picked);
  }

  return (
    <Dialog
      open
      title={t("planning.timeline_gen_dialog_title")}
      role="dialog"
      closeOnBackdrop
      onClose={() => {
        if (!applying) onClose();
      }}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={applying}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={apply}
            disabled={applying || selected.size === 0}
          >
            {applying
              ? t("common.loading")
              : t("planning.timeline_gen_confirm_count", { count: selected.size })}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-700 dark:text-paper-100">{t("planning.timeline_gen_dialog_body")}</p>
        {!weddingDate && (
          <p className="rounded-lg border border-paper-300 bg-paper-100/60 px-3 py-2 text-xs text-ink-600 dark:border-umber-700 dark:bg-umber-700/60 dark:text-umber-200">
            {t("planning.timeline_gen_no_date")}
          </p>
        )}
        <div className="rounded-lg border border-paper-200 bg-paper-50 p-3 dark:border-umber-700 dark:bg-umber-800">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-ink-500 dark:text-umber-300">
              {t("planning.template_select_label", {
                count: selected.size,
                total: selectable.length,
              })}
            </p>
            <button
              type="button"
              onClick={() =>
                setSelected(allSelected ? new Set() : new Set(selectable.map((i) => i.key)))
              }
              disabled={selectable.length === 0}
              className="text-xs text-ink-600 underline decoration-dotted underline-offset-2 hover:text-ink-900 disabled:opacity-40 dark:text-umber-200 dark:hover:text-paper-50"
            >
              {allSelected ? t("planning.template_select_none") : t("planning.template_select_all")}
            </button>
          </div>
          <div className="space-y-3">
            {TIMELINE_PHASES.map((phase) => {
              const phaseItems = WEDDING_TIMELINE.filter((i) => i.phase === phase.id);
              if (phaseItems.length === 0) return null;
              return (
                <div key={phase.id}>
                  <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
                    {localizeText(phase.label, locale)}
                  </p>
                  <ul className="space-y-0.5">
                    {phaseItems.map((item) => {
                      const have = alreadyHave.has(item.key);
                      const on = selected.has(item.key);
                      const title = localizeText(item.title, locale);
                      const hint = item.hint ? localizeText(item.hint, locale) : null;
                      return (
                        <li
                          key={item.key}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                        >
                          <button
                            type="button"
                            onClick={() => !have && toggle(item.key)}
                            aria-pressed={on}
                            disabled={have}
                            className={`flex min-w-0 flex-1 items-start gap-2 text-left transition-colors ${
                              have
                                ? "cursor-default text-ink-300 dark:text-umber-400"
                                : on
                                  ? "text-ink-900 dark:text-paper-50"
                                  : "text-ink-400 hover:text-ink-600 dark:text-umber-300 dark:hover:text-paper-100"
                            }`}
                          >
                            {have ? (
                              <CheckCircle2
                                size={14}
                                className="mt-0.5 shrink-0 text-sage-500 dark:text-sage-400"
                                aria-hidden="true"
                              />
                            ) : on ? (
                              <CheckCircle2
                                size={14}
                                className="mt-0.5 shrink-0 text-sage-700 dark:text-sage-300"
                                aria-hidden="true"
                              />
                            ) : (
                              <Circle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                            )}
                            <span className="min-w-0">
                              <span className="block truncate">{title}</span>
                              {have ? (
                                <span className="block text-[11px] italic text-ink-400 dark:text-umber-400">
                                  {t("planning.timeline_gen_already")}
                                </span>
                              ) : (
                                hint && (
                                  <span className="block text-[11px] text-ink-400 dark:text-umber-400">
                                    {hint}
                                  </span>
                                )
                              )}
                            </span>
                          </button>
                          {!have && (
                            <input
                              type="date"
                              value={dueDates[item.key] ?? ""}
                              onChange={(e) =>
                                setDueDates((prev) => ({ ...prev, [item.key]: e.target.value }))
                              }
                              aria-label={t("planning.due_date_label")}
                              className="shrink-0 rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-xs text-ink-700 outline-none focus:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function TaskTemplateDialog({
  existing,
  applying,
  assigneeSuggestions,
  locale,
  weddingDate,
  onClose,
  onApply,
}: {
  existing: boolean;
  applying: boolean;
  assigneeSuggestions: string[];
  locale: Locale;
  weddingDate: string | null;
  onClose: () => void;
  onApply: (selected: Set<number>, defaultAssignee: string) => Promise<void>;
}) {
  const { t } = useT();
  const [defaultAssignee, setDefaultAssignee] = useState("");
  // Default: nothing selected. Couples pick the items they actually want
  // (most templates ship with more entries than any single couple needs;
  // unchecking 15 of 22 was the wrong default). "Select all" stays one
  // click away via the toggle in the section header.
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const datalistId = "task-wand-assignee-list";
  const total = TASK_TEMPLATE.length;
  const allSelected = selected.size === total;

  function toggle(idx: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  return (
    <Dialog
      open
      title={t("planning.task_template_dialog_title")}
      role="dialog"
      closeOnBackdrop
      onClose={() => {
        if (!applying) onClose();
      }}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={applying}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onApply(selected, defaultAssignee)}
            disabled={applying || selected.size === 0}
          >
            {applying
              ? t("common.loading")
              : t("planning.template_confirm_count", { count: selected.size })}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-700 dark:text-paper-100">
          {t("planning.task_template_dialog_body")}
        </p>
        <label className="flex items-center gap-3 text-sm text-ink-700 dark:text-paper-100">
          <span className="font-medium">{t("planning.task_template_default_assignee_label")}</span>
          <input
            type="text"
            value={defaultAssignee}
            onChange={(e) => setDefaultAssignee(e.target.value)}
            list={assigneeSuggestions.length > 0 ? datalistId : undefined}
            placeholder={t("planning.task_template_default_assignee_placeholder")}
            maxLength={80}
            className="flex-1 rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 outline-none focus:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50"
          />
          {assigneeSuggestions.length > 0 && (
            <datalist id={datalistId}>
              {assigneeSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          )}
        </label>
        {existing && (
          <p className="rounded-lg border border-paper-300 bg-paper-100/60 px-3 py-2 text-xs text-ink-600 dark:border-umber-700 dark:bg-umber-700/60 dark:text-umber-200">
            {t("planning.template_warning_existing")}
          </p>
        )}
        <div className="rounded-lg border border-paper-200 bg-paper-50 p-3 dark:border-umber-700 dark:bg-umber-800">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-ink-500 dark:text-umber-300">
              {t("planning.template_select_label", { count: selected.size, total })}
            </p>
            <button
              type="button"
              onClick={() =>
                setSelected(allSelected ? new Set() : new Set(TASK_TEMPLATE.map((_, idx) => idx)))
              }
              className="text-xs text-ink-600 underline decoration-dotted underline-offset-2 hover:text-ink-900 dark:text-umber-200 dark:hover:text-paper-50"
            >
              {allSelected ? t("planning.template_select_none") : t("planning.template_select_all")}
            </button>
          </div>
          {/* Render groups one after the other with a small heading +
              divider between them. Each item's index in the flat
              TASK_TEMPLATE array is what `selected` tracks, so we keep a
              running offset as we walk the groups. */}
          {(() => {
            let offset = 0;
            return TASK_TEMPLATE_GROUPS.map((group, gIdx) => {
              const startIdx = offset;
              offset += group.items.length;
              return (
                <div
                  key={group.id}
                  className={
                    gIdx > 0 ? "mt-3 border-t border-paper-300 pt-3 dark:border-umber-700" : ""
                  }
                >
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
                    {localizeText(group.label, locale)}
                  </p>
                  <ul className="space-y-0.5">
                    {group.items.map((tmpl, localIdx) => {
                      const idx = startIdx + localIdx;
                      const on = selected.has(idx);
                      return (
                        <li key={tmpl.title.en}>
                          <button
                            type="button"
                            onClick={() => toggle(idx)}
                            aria-pressed={on}
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                              on
                                ? "bg-paper-100 text-ink-900 hover:bg-paper-200 dark:bg-umber-700/60 dark:text-paper-50 dark:hover:bg-umber-700"
                                : "text-ink-400 hover:bg-paper-100 hover:text-ink-600 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
                            }`}
                          >
                            {on ? (
                              <CheckCircle2
                                size={14}
                                className="shrink-0 text-sage-700 dark:text-sage-300"
                                aria-hidden="true"
                              />
                            ) : (
                              <Circle size={14} className="shrink-0" aria-hidden="true" />
                            )}
                            <span className="flex-1">{localizeText(tmpl.title, locale)}</span>
                            <span
                              className={`ml-1 shrink-0 rounded px-1 py-0.5 font-mono text-[10px] tabular-nums ${
                                on
                                  ? "bg-paper-200 text-ink-500 dark:bg-umber-600 dark:text-paper-200"
                                  : "bg-paper-200/60 text-ink-400 dark:bg-umber-700/40 dark:text-umber-400"
                              }`}
                            >
                              {`T${tmpl.deadline_days}`}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            });
          })()}
        </div>
      </div>
    </Dialog>
  );
}

function IdeaTemplateDialog({
  existing,
  applying,
  locale,
  onClose,
  onApply,
}: {
  existing: boolean;
  applying: boolean;
  locale: Locale;
  onClose: () => void;
  onApply: (selected: Set<number>) => Promise<void>;
}) {
  const { t } = useT();
  // Default: nothing selected. Couples pick the items they want — mirrors
  // the task-template behaviour and avoids dropping every starter idea on
  // people who only liked two of them.
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const total = IDEA_TEMPLATE.length;
  const allSelected = selected.size === total;

  function toggle(idx: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  return (
    <Dialog
      open
      title={t("planning.idea_template_dialog_title")}
      role="dialog"
      closeOnBackdrop
      onClose={() => {
        if (!applying) onClose();
      }}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={applying}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onApply(selected)}
            disabled={applying || selected.size === 0}
          >
            {applying
              ? t("common.loading")
              : t("planning.template_confirm_count", { count: selected.size })}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-700 dark:text-paper-100">
          {t("planning.idea_template_dialog_body")}
        </p>
        {existing && (
          <p className="rounded-lg border border-paper-300 bg-paper-100/60 px-3 py-2 text-xs text-ink-600 dark:border-umber-700 dark:bg-umber-700/60 dark:text-umber-200">
            {t("planning.template_warning_existing")}
          </p>
        )}
        <div className="rounded-lg border border-paper-200 bg-paper-50 p-3 dark:border-umber-700 dark:bg-umber-800">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-ink-500 dark:text-umber-300">
              {t("planning.template_select_label", { count: selected.size, total })}
            </p>
            <button
              type="button"
              onClick={() =>
                setSelected(allSelected ? new Set() : new Set(IDEA_TEMPLATE.map((_, idx) => idx)))
              }
              className="text-xs text-ink-600 underline decoration-dotted underline-offset-2 hover:text-ink-900 dark:text-umber-200 dark:hover:text-paper-50"
            >
              {allSelected ? t("planning.template_select_none") : t("planning.template_select_all")}
            </button>
          </div>
          <ul className="space-y-0.5">
            {IDEA_TEMPLATE.map((tmpl, idx) => {
              const on = selected.has(idx);
              return (
                <li key={tmpl.title.en}>
                  <button
                    type="button"
                    onClick={() => toggle(idx)}
                    aria-pressed={on}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                      on
                        ? "bg-paper-100 text-ink-900 hover:bg-paper-200 dark:bg-umber-700/60 dark:text-paper-50 dark:hover:bg-umber-700"
                        : "text-ink-400 hover:bg-paper-100 hover:text-ink-600 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
                    }`}
                  >
                    {on ? (
                      <CheckCircle2
                        size={14}
                        className="shrink-0 text-sage-700 dark:text-sage-300"
                        aria-hidden="true"
                      />
                    ) : (
                      <Lightbulb size={14} className="shrink-0" aria-hidden="true" />
                    )}
                    <span>{localizeText(tmpl.title, locale)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}

function DiceDialog({
  applying,
  locale,
  onClose,
  onAccept,
}: {
  applying: boolean;
  locale: Locale;
  onClose: () => void;
  onAccept: (idea: { title: LocaleText; body: LocaleText }) => Promise<boolean>;
}) {
  const { t } = useT();
  const [picks, setPicks] = useState(() => rollDice(DICE_CREATIVE_IDEAS, 3));
  const [acceptedKeys, setAcceptedKeys] = useState<Set<string>>(new Set());

  return (
    <Dialog
      open
      title={t("planning.dice_dialog_title")}
      role="dialog"
      closeOnBackdrop
      size="lg"
      onClose={() => {
        if (!applying) onClose();
      }}
      footer={
        <>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setPicks(rollDice(DICE_CREATIVE_IDEAS, 3));
              setAcceptedKeys(new Set());
            }}
            disabled={applying}
          >
            <Dices size={14} className="mr-1.5 inline" aria-hidden="true" />
            {t("planning.dice_reroll")}
          </button>
          <button type="button" className="btn-primary" onClick={onClose} disabled={applying}>
            {t("planning.dice_close")}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-ink-700 dark:text-paper-100">{t("planning.dice_dialog_body")}</p>
        <ul className="space-y-3">
          {picks.map((idea) => {
            const key = idea.title.en;
            const accepted = acceptedKeys.has(key);
            return (
              <li
                key={key}
                className="rounded-xl border border-paper-300 bg-paper-50 p-3 transition-colors dark:border-umber-700 dark:bg-umber-800"
              >
                <div className="flex items-start gap-3">
                  <Lightbulb
                    size={16}
                    className="mt-0.5 shrink-0 text-ink-400 dark:text-umber-300"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink-900 dark:text-paper-50">
                      {localizeText(idea.title, locale)}
                    </p>
                    <p className="mt-1 text-xs text-ink-600 dark:text-umber-200">
                      {localizeText(idea.body, locale)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={
                      accepted
                        ? "btn-ghost btn-sm shrink-0 text-sage-700 dark:text-sage-300"
                        : "btn-primary btn-sm shrink-0"
                    }
                    disabled={accepted || applying}
                    onClick={async () => {
                      const ok = await onAccept(idea);
                      if (ok) setAcceptedKeys((prev) => new Set(prev).add(key));
                    }}
                  >
                    {accepted ? (
                      <>
                        <CheckCircle2 size={14} className="mr-1.5 inline" aria-hidden="true" />
                        {t("planning.dice_added")}
                      </>
                    ) : (
                      t("planning.dice_add")
                    )}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Dialog>
  );
}

function QuickAddForm({
  kind,
  assigneeSuggestions,
  onCreate,
}: {
  kind: PlanningTabKind;
  assigneeSuggestions: string[];
  onCreate: (input: {
    title: string;
    body?: string | null;
    start_date?: string | null;
    due_date?: string | null;
    assignee?: string | null;
  }) => Promise<void>;
}) {
  const { t } = useT();
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignee, setAssignee] = useState("");
  const [titleFocused, setTitleFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const assigneeListId = "planning-assignee-list";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    await onCreate({
      title: trimmed,
      start_date: kind === "task" && startDate ? startDate : null,
      due_date: kind === "task" && dueDate ? dueDate : null,
      assignee: kind === "task" && assignee.trim() ? assignee.trim() : null,
    });
    setTitle("");
    setStartDate("");
    setDueDate("");
    setAssignee("");
    // Keep the form expanded after a successful submit — the realistic
    // flow is "add five tasks in a row", and re-collapsing back to a
    // single line every time forces the user to refocus / re-tap the
    // details slot. Stays expanded as long as the user keeps interacting.
    inputRef.current?.focus();
  }

  // Expand the form (reveal the assignee + date inputs below the title
  // row) when the user is actively engaging with it OR has typed
  // something — typing is the implicit signal that they're not just
  // browsing past. Collapse once focus leaves AND the title is empty
  // AND no value is sitting in assignee/date. Without the "active in
  // form" check, tapping the native iOS date picker steals focus from
  // the title input and collapses the form mid-pick.
  const placeholder =
    kind === "task" ? t("planning.task_placeholder") : t("planning.idea_placeholder");
  const hasValue =
    title.trim().length > 0 ||
    (kind === "task" && (assignee.length > 0 || startDate.length > 0 || dueDate.length > 0));
  const showDetails = kind === "task" && (titleFocused || hasValue);

  function onFormBlur(e: ReactFocusEvent<HTMLFormElement>) {
    // relatedTarget === the element gaining focus. If it's still inside
    // the form, this is not a "real" blur (user just tabbed from title
    // to assignee). Only collapse when focus genuinely leaves.
    if (formRef.current && e.relatedTarget && formRef.current.contains(e.relatedTarget)) return;
    setTitleFocused(false);
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      onFocus={() => setTitleFocused(true)}
      onBlur={onFormBlur}
      className="card !border-ink-900 p-3 dark:!border-paper-100/40"
    >
      <div className="flex items-center gap-2">
        <Plus size={16} className="text-ink-400 dark:text-umber-300" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-400 dark:text-paper-50 dark:placeholder:text-umber-300"
          maxLength={200}
        />
        <button
          type="submit"
          disabled={!title.trim()}
          className="btn-primary btn-sm shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("planning.add")}
        </button>
      </div>
      {showDetails && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            list={assigneeSuggestions.length > 0 ? assigneeListId : undefined}
            placeholder={t("planning.assignee_quick_placeholder")}
            aria-label={t("planning.assignee_label")}
            className="w-36 rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-sm text-ink-700 outline-none focus:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
            maxLength={80}
          />
          {assigneeSuggestions.length > 0 && (
            <datalist id={assigneeListId}>
              {assigneeSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          )}
          <input
            type="date"
            value={startDate}
            onChange={(e) => {
              const next = e.target.value;
              setStartDate(next);
              // Keep the range coherent: bump the due date forward if the
              // new start lands after it.
              if (dueDate && next && dueDate < next) setDueDate(next);
            }}
            min={todayIso()}
            aria-label={t("planning.start_date_label")}
            title={t("planning.start_date_label")}
            className="rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-sm text-ink-700 outline-none focus:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
          />
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            min={maxIsoDate(startDate || todayIso(), todayIso())}
            aria-label={t("planning.due_date_label")}
            title={t("planning.due_date_label")}
            className="rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-sm text-ink-700 outline-none focus:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
          />
        </div>
      )}
    </form>
  );
}

function PlanningRow({
  item,
  assigneeSuggestions,
  canMoveUp,
  canMoveDown,
  onToggleDone,
  onPatch,
  onCyclePriority,
  onMove,
  onDelete,
  onConvertToTask,
}: {
  item: PlanningItem;
  assigneeSuggestions: string[];
  /** False on the first row of the visible list — disables the ↑ button. */
  canMoveUp: boolean;
  /** False on the last row of the visible list — disables the ↓ button. */
  canMoveDown: boolean;
  onToggleDone: () => void;
  onPatch: (patch: Partial<PlanningItem>) => void;
  /** Cycle priority 0 → 1 → 2 → 0. Wired only on the tasks tab — the parent
   *  call is a no-op for ideas, so we still render the button uniformly. */
  onCyclePriority: () => void;
  onMove: (direction: "up" | "down") => void;
  onDelete: () => void;
  /** Ideas only — drop this idea into the Tasks list as a real task. */
  onConvertToTask: () => void;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  // Bridge prompt is a one-time, dismissible nudge on a "doing" idea. Local
  // state so it disappears after a convert or an explicit "not now".
  const [bridgeDismissed, setBridgeDismissed] = useState(false);
  const [editingAssignee, setEditingAssignee] = useState(false);
  const [draftTitle, setDraftTitle] = useState(item.title);
  const [draftBody, setDraftBody] = useState(item.body ?? "");
  const [draftStartDate, setDraftStartDate] = useState(item.start_date ?? "");
  const [draftDueDate, setDraftDueDate] = useState(item.due_date ?? "");
  const [draftAssignee, setDraftAssignee] = useState(item.assignee ?? "");
  // Unique id so each row's datalist doesn't collide with siblings.
  const assigneeListId = useId();

  function commit() {
    const trimmed = draftTitle.trim();
    if (!trimmed) {
      setDraftTitle(item.title);
      setEditing(false);
      return;
    }
    const patch: Partial<PlanningItem> = {};
    if (trimmed !== item.title) patch.title = trimmed;
    const nextBody = draftBody.trim() || null;
    if (nextBody !== item.body) patch.body = nextBody;
    // Dates are tasks-only; ideas never surface the inputs below.
    if (item.kind === "task") {
      const nextStart = draftStartDate || null;
      const nextDue = draftDueDate || null;
      if (nextStart !== (item.start_date ?? null)) patch.start_date = nextStart;
      if (nextDue !== (item.due_date ?? null)) patch.due_date = nextDue;
    }
    if (Object.keys(patch).length > 0) onPatch(patch);
    setEditing(false);
  }

  function commitAssignee() {
    const next = draftAssignee.trim() || null;
    if (next !== (item.assignee ?? null)) {
      onPatch({ assignee: next });
    }
    setEditingAssignee(false);
  }

  const ideaStatus = item.kind === "idea" ? item.idea_status : null;
  const ideaCardTint = ideaStatus ? IDEA_STATUS_META[ideaStatus].cardTint : "";
  return (
    <li
      className={`card flex items-center gap-3 p-3 transition-colors ${ideaCardTint} ${
        item.done ? "bg-paper-100/50 dark:bg-umber-700/60" : ""
      }`}
    >
      {item.kind === "task" && (
        <>
          <button
            type="button"
            onClick={onToggleDone}
            aria-label={item.done ? t("planning.mark_undone") : t("planning.mark_done")}
            className="shrink-0 text-ink-500 transition-colors hover:text-ink-800 dark:text-umber-300 dark:hover:text-paper-100"
          >
            {item.done ? (
              <CheckCircle2 size={18} className="text-sage-700 dark:text-sage-300" />
            ) : (
              <Circle size={18} />
            )}
          </button>
          <PriorityFlagButton
            priority={(item.priority ?? 0) as 0 | 1 | 2}
            onCycle={onCyclePriority}
          />
        </>
      )}
      {item.kind === "idea" && (
        <Lightbulb
          size={18}
          className="shrink-0 text-ink-400 dark:text-umber-300"
          aria-hidden="true"
        />
      )}

      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-2">
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commit();
                } else if (e.key === "Escape") {
                  setDraftTitle(item.title);
                  setDraftBody(item.body ?? "");
                  setDraftStartDate(item.start_date ?? "");
                  setDraftDueDate(item.due_date ?? "");
                  setEditing(false);
                }
              }}
              className="w-full rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-sm outline-none focus:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50"
              maxLength={200}
            />
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              placeholder={t("planning.body_placeholder")}
              rows={2}
              className="w-full rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-xs text-ink-700 outline-none focus:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
              maxLength={5000}
            />
            {item.kind === "task" && (
              <div className="flex flex-wrap gap-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
                    {t("planning.start_date_label")}
                  </span>
                  <input
                    type="date"
                    value={draftStartDate}
                    onChange={(e) => {
                      const next = e.target.value;
                      setDraftStartDate(next);
                      if (draftDueDate && next && draftDueDate < next) setDraftDueDate(next);
                    }}
                    className="rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-sm text-ink-700 outline-none focus:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
                    {t("planning.due_date_label")}
                  </span>
                  <input
                    type="date"
                    value={draftDueDate}
                    min={draftStartDate || undefined}
                    onChange={(e) => setDraftDueDate(e.target.value)}
                    className="rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-sm text-ink-700 outline-none focus:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
                  />
                </label>
              </div>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={commit} className="btn-primary btn-sm">
                {t("common.save")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftTitle(item.title);
                  setDraftBody(item.body ?? "");
                  setDraftStartDate(item.start_date ?? "");
                  setDraftDueDate(item.due_date ?? "");
                  setEditing(false);
                }}
                className="btn-ghost btn-sm"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="min-w-0 flex-1 text-left"
              >
                <p
                  className={`truncate text-sm ${item.done ? "text-ink-400 line-through dark:text-umber-300" : "text-ink-900 dark:text-paper-50"}`}
                >
                  {item.title}
                </p>
              </button>
              <div className="flex shrink-0 items-center gap-2 text-[11px] text-ink-500 dark:text-umber-300">
                {item.kind === "task" && (item.start_date || item.due_date) && (
                  <span className="inline-flex items-center gap-1">
                    <Calendar size={12} aria-hidden="true" />
                    {item.start_date && item.due_date
                      ? `${item.start_date} → ${item.due_date}`
                      : (item.start_date ?? item.due_date)}
                  </span>
                )}
                {item.kind === "task" && <TaskStatusPill item={item} />}
                {item.kind === "task" &&
                  (editingAssignee ? (
                    <>
                      <input
                        type="text"
                        value={draftAssignee}
                        onChange={(e) => setDraftAssignee(e.target.value)}
                        onBlur={commitAssignee}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitAssignee();
                          } else if (e.key === "Escape") {
                            setDraftAssignee(item.assignee ?? "");
                            setEditingAssignee(false);
                          }
                        }}
                        list={assigneeSuggestions.length > 0 ? assigneeListId : undefined}
                        placeholder={t("planning.assignee_placeholder")}
                        aria-label={t("planning.assignee_label")}
                        autoFocus
                        maxLength={80}
                        className="h-6 w-28 rounded-full border border-ink-300 bg-paper-50 px-2 text-[11px] text-ink-700 outline-none focus:border-ink-500 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
                      />
                      {assigneeSuggestions.length > 0 && (
                        <datalist id={assigneeListId}>
                          {assigneeSuggestions.map((name) => (
                            <option key={name} value={name} />
                          ))}
                        </datalist>
                      )}
                    </>
                  ) : item.assignee ? (
                    <button
                      type="button"
                      onClick={() => {
                        setDraftAssignee(item.assignee ?? "");
                        setEditingAssignee(true);
                      }}
                      title={t("planning.assignee_edit_hint")}
                      className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-ink-700 transition-colors hover:bg-ink-200 dark:bg-umber-700/60 dark:text-paper-100 dark:hover:bg-umber-700"
                    >
                      <User size={11} aria-hidden="true" />
                      {item.assignee}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setDraftAssignee("");
                        setEditingAssignee(true);
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-dashed border-paper-400 px-2 py-0.5 text-ink-500 transition-colors hover:border-ink-300 hover:text-ink-700 dark:border-umber-600 dark:text-umber-300 dark:hover:border-umber-700 dark:hover:text-paper-100"
                    >
                      <User size={11} aria-hidden="true" />
                      {t("planning.assignee_add")}
                    </button>
                  ))}
                {item.kind === "idea" && item.suggested_by_name && (
                  <span className="italic text-ink-500 dark:text-umber-300">
                    {t("planning.idea_suggested_by", { name: item.suggested_by_name })}
                  </span>
                )}
              </div>
            </div>
            {item.body && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="mt-1 block w-full text-left"
              >
                <p className="whitespace-pre-wrap text-xs text-ink-600 dark:text-umber-200">
                  <BodyWithLinks text={item.body} />
                </p>
              </button>
            )}
            {item.kind === "idea" && (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <IdeaStatusControl
                    status={item.idea_status}
                    onSelect={(next) =>
                      onPatch({ idea_status: item.idea_status === next ? null : next })
                    }
                  />
                  <IdeaTagPicker
                    tag={item.idea_tag}
                    onSelect={(next) => onPatch({ idea_tag: item.idea_tag === next ? null : next })}
                  />
                </div>
                {item.idea_status === "doing" && !bridgeDismissed && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-sage-50 px-2.5 py-1.5 dark:bg-sage-400/10">
                    <span className="text-[11px] text-ink-600 dark:text-umber-200">
                      {t("planning.idea_to_task_prompt")}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onConvertToTask();
                        setBridgeDismissed(true);
                      }}
                      className="rounded-full bg-sage-600 px-2.5 py-0.5 text-[11px] font-medium text-paper-50 transition-colors hover:bg-sage-700"
                    >
                      {t("planning.idea_to_task_confirm")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setBridgeDismissed(true)}
                      className="text-[11px] text-ink-500 underline decoration-dotted underline-offset-2 hover:text-ink-700 dark:text-umber-300 dark:hover:text-paper-100"
                    >
                      {t("planning.idea_to_task_dismiss")}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 self-center">
        {/* Reorder controls — vertical stack so the row stays compact. Disabled
         *  at the boundaries; we still render them (just dimmed) so the row
         *  width doesn't shift as items reach the top/bottom. */}
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => onMove("up")}
            disabled={!canMoveUp}
            aria-label={t("planning.move_up")}
            title={t("planning.move_up")}
            className="inline-flex h-4 w-6 items-center justify-center rounded text-ink-400 hover:bg-paper-100 hover:text-ink-700 disabled:cursor-not-allowed disabled:opacity-30 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
          >
            <ChevronUp size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onMove("down")}
            disabled={!canMoveDown}
            aria-label={t("planning.move_down")}
            title={t("planning.move_down")}
            className="inline-flex h-4 w-6 items-center justify-center rounded text-ink-400 hover:bg-paper-100 hover:text-ink-700 disabled:cursor-not-allowed disabled:opacity-30 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
          >
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          onClick={onDelete}
          aria-label={t("common.delete")}
          className="btn-ghost btn-sm text-blush-700 dark:text-blush-300"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );
}

function PlanningListSkeleton({ kind }: { kind: PlanningTabKind }) {
  const widths = ["72%", "58%", "84%", "46%", "68%", "52%"];
  return (
    <ul className="mt-4 space-y-2" aria-hidden="true">
      {widths.map((w, i) => (
        <li key={i} className="card flex items-center gap-3 p-3">
          <Skeleton variant="circle" width={18} className="shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton variant="block" height={14} width={w} rounded="md" />
            {kind === "task" && (
              <div className="flex items-center gap-2">
                <Skeleton variant="block" width={80} height={16} rounded="full" />
                <Skeleton variant="block" width={64} height={12} rounded="md" />
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Skeleton variant="block" width={24} height={24} rounded="md" />
            <Skeleton variant="circle" width={20} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({
  kind,
  onRollDice,
}: {
  kind: PlanningTabKind;
  /** Ideas tab only: surfaces the dice roller right where the couple has run
   *  dry, so the "out of ideas?" prompt is discoverable from the empty list. */
  onRollDice?: () => void;
}) {
  const { t } = useT();
  const Icon = kind === "task" ? CheckCircle2 : Lightbulb;
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-paper-300 bg-paper-50 px-4 py-10 text-center dark:border-umber-700 dark:bg-umber-800">
      <Icon size={28} className="mx-auto text-ink-400 dark:text-umber-300" aria-hidden="true" />
      <p className="mt-3 text-sm text-ink-700 dark:text-paper-100">{t(`planning.empty_${kind}`)}</p>
      {onRollDice && (
        <button
          type="button"
          onClick={onRollDice}
          className="btn-primary btn-sm mx-auto mt-4 inline-flex items-center gap-1.5"
        >
          <Dices size={14} aria-hidden="true" />
          {t("planning.dice_empty_cta")}
        </button>
      )}
    </div>
  );
}

/** "Nektek ajánljuk" — a persistent (non-random) curated idea shelf computed
 *  from the personalization intake "yes" answers via `recommendedIdeas`. Each
 *  card carries its category chip and a one-tap add. With no yes-answers yet
 *  it falls back to a calm nudge toward the Döntések tab rather than nagging. */
function RecommendedIdeas({
  yesTags,
  locale,
  existingTitles,
  onAdd,
  onOpenDecisions,
}: {
  yesTags: string[];
  locale: Locale;
  existingTitles: Set<string>;
  onAdd: (idea: Idea) => Promise<boolean>;
  onOpenDecisions: () => void;
}) {
  const { t } = useT();
  const ideas = useMemo(() => recommendedIdeas(yesTags), [yesTags]);
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());

  if (yesTags.length === 0 || ideas.length === 0) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-paper-300 bg-paper-50 px-3 py-2.5 dark:border-umber-700 dark:bg-umber-800">
        <Sparkles
          size={14}
          className="shrink-0 text-ink-400 dark:text-umber-300"
          aria-hidden="true"
        />
        <span className="text-xs text-ink-600 dark:text-umber-200">
          {t("planning.recommended_empty_nudge")}
        </span>
        <button
          type="button"
          onClick={onOpenDecisions}
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-ink-700 underline decoration-dotted underline-offset-2 hover:text-ink-900 dark:text-paper-100"
        >
          {t("planning.recommended_empty_cta")}
          <ArrowRight size={12} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <section className="mt-4">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="flex items-center gap-1.5 font-grotesk text-xs font-semibold uppercase tracking-[0.08em] text-ink-500 dark:text-umber-300">
          <Sparkles size={13} aria-hidden="true" />
          {t("planning.recommended_title")}
        </h2>
        <span className="text-[11px] text-ink-400 dark:text-umber-400">
          {t("planning.recommended_sub")}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {ideas.map((idea) => {
          const key = idea.title.en;
          const added =
            addedKeys.has(key) ||
            existingTitles.has(localizeText(idea.title, locale).trim().toLowerCase());
          const tagMeta = idea.tag ? IDEA_TAG_META[idea.tag] : null;
          return (
            <div
              key={key}
              className="flex flex-col gap-2 rounded-xl border border-paper-200 bg-paper-50 p-3 dark:border-umber-700 dark:bg-umber-800"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-ink-900 dark:text-paper-50">
                  {localizeText(idea.title, locale)}
                </p>
                {tagMeta && (
                  <span
                    className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${tagMeta.chip}`}
                  >
                    {t(tagMeta.labelKey)}
                  </span>
                )}
              </div>
              <p className="text-xs text-ink-600 dark:text-umber-200">
                {localizeText(idea.body, locale)}
              </p>
              <button
                type="button"
                disabled={added}
                onClick={async () => {
                  const ok = await onAdd(idea);
                  if (ok) setAddedKeys((prev) => new Set(prev).add(key));
                }}
                className={
                  added
                    ? "btn-ghost btn-sm self-start text-sage-700 dark:text-sage-300"
                    : "btn-primary btn-sm self-start"
                }
              >
                {added ? (
                  <>
                    <CheckCircle2 size={14} className="mr-1.5 inline" aria-hidden="true" />
                    {t("planning.recommended_added")}
                  </>
                ) : (
                  <>
                    <Plus size={14} className="mr-1.5 inline" aria-hidden="true" />
                    {t("planning.add")}
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Light 3-state triage control for an idea (doing / not-sure / skip). Active
 *  state shows a token-coloured pill + filled dot; the others stay quiet. */
function IdeaStatusControl({
  status,
  onSelect,
}: {
  status: IdeaStatus | null;
  onSelect: (status: IdeaStatus) => void;
}) {
  const { t } = useT();
  return (
    <div
      role="radiogroup"
      aria-label={t("planning.idea_status_aria")}
      className="inline-flex flex-wrap items-center gap-1"
    >
      {IDEA_STATUS_ORDER.map((s) => {
        const active = status === s;
        const meta = IDEA_STATUS_META[s];
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(s)}
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
              active
                ? meta.activePill
                : "text-ink-500 hover:bg-paper-100 dark:text-umber-300 dark:hover:bg-umber-700"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${active ? meta.dot : "bg-ink-300 dark:bg-umber-500"}`}
              aria-hidden="true"
            />
            {t(meta.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

/** Tag chip + picker for an idea's category. Closed state shows the current
 *  tag chip (or a dashed "+ category" affordance when untagged); opening
 *  reveals the five `IdeaTag` options. Selecting the active tag clears it. */
function IdeaTagPicker({
  tag,
  onSelect,
}: {
  tag: IdeaTag | null;
  onSelect: (tag: IdeaTag) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const meta = tag ? IDEA_TAG_META[tag] : null;
  return (
    <div
      ref={ref}
      className="relative"
      onBlur={(e) => {
        if (ref.current && e.relatedTarget instanceof Node && ref.current.contains(e.relatedTarget))
          return;
        setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t("planning.idea_tag_set")}
        className={
          meta
            ? `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.chip}`
            : "inline-flex items-center gap-1 rounded-full border border-dashed border-paper-400 px-2 py-0.5 text-[11px] text-ink-500 transition-colors hover:border-ink-300 hover:text-ink-700 dark:border-umber-600 dark:text-umber-300 dark:hover:border-umber-500 dark:hover:text-paper-100"
        }
      >
        <Tag size={11} aria-hidden="true" />
        {meta ? t(meta.labelKey) : t("planning.idea_tag_none")}
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-20 mt-1 w-44 rounded-xl border border-paper-200 bg-paper-50 p-1 shadow-pop dark:border-umber-700 dark:bg-umber-800"
        >
          {IDEA_TAG_ORDER.map((tg) => {
            const m = IDEA_TAG_META[tg];
            const active = tag === tg;
            return (
              <button
                key={tg}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onSelect(tg);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                  active
                    ? "bg-paper-100 text-ink-900 dark:bg-umber-700/60 dark:text-paper-50"
                    : "text-ink-600 hover:bg-paper-100 dark:text-umber-200 dark:hover:bg-umber-700"
                }`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${m.dot}`} aria-hidden="true" />
                {t(m.labelKey)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Single button that cycles a task's priority flag 0 → 1 → 2 → 0. Empty
 *  state is a faint outline icon; lit state is a red pill carrying "!" or
 *  "!!". Wider on the SOS state so the pair of glyphs doesn't crowd. */
function PriorityFlagButton({
  priority,
  onCycle,
}: {
  priority: 0 | 1 | 2;
  onCycle: () => void;
}) {
  const { t } = useT();
  const label =
    priority === 0
      ? t("planning.priority_set_important")
      : priority === 1
        ? t("planning.priority_set_sos")
        : t("planning.priority_clear");
  if (priority === 0) {
    return (
      <button
        type="button"
        onClick={onCycle}
        aria-label={label}
        title={label}
        className="shrink-0 text-ink-300 transition-colors hover:text-blush-600 dark:text-umber-300 dark:hover:text-blush-300"
      >
        <Flag size={16} aria-hidden="true" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onCycle}
      aria-label={label}
      title={label}
      className="inline-flex h-6 shrink-0 items-center justify-center rounded-full bg-blush-100 px-2 text-xs font-bold text-blush-700 transition-colors hover:bg-blush-200 dark:bg-blush-400/15 dark:text-blush-300 dark:hover:bg-blush-400/25"
    >
      {priority === 1 ? "!" : "!!"}
    </button>
  );
}

function PriorityFilterPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors ${
        active
          ? "bg-ink-900 text-paper-50 dark:bg-paper-50 dark:text-ink-900"
          : "bg-paper-100 text-ink-700 hover:bg-paper-200 dark:bg-umber-700 dark:text-paper-100 dark:hover:bg-umber-600"
      }`}
    >
      {label}
    </button>
  );
}

// ─── Kanban board ────────────────────────────────────────────────────────────

type KanbanCol = "todo" | "in_progress" | "done";

function taskKanbanCol(item: PlanningItem): KanbanCol {
  if (item.done) return "done";
  if (item.start_date && item.start_date <= todayIso()) return "in_progress";
  return "todo";
}

function vendorKanbanCol(vendor: CoupleSupplier): KanbanCol {
  if (vendor.paid) return "done";
  if (vendor.price_huf != null) return "in_progress";
  return "todo";
}

const COL_STYLES: Record<KanbanCol, { topBorder: string; headerText: string; badge: string }> = {
  todo: {
    topBorder: "border-t-2 border-t-ink-300 dark:border-t-umber-500",
    headerText: "text-ink-700 dark:text-umber-100",
    badge: "bg-ink-100 text-ink-700 dark:bg-umber-600 dark:text-umber-100",
  },
  in_progress: {
    topBorder: "border-t-2 border-t-umber-400 dark:border-t-umber-300",
    headerText: "text-umber-700 dark:text-umber-200",
    badge: "bg-umber-100 text-umber-700 dark:bg-umber-600/60 dark:text-umber-100",
  },
  done: {
    topBorder: "border-t-2 border-t-sage-500 dark:border-t-sage-400",
    headerText: "text-sage-700 dark:text-sage-300",
    badge: "bg-sage-100 text-sage-700 dark:bg-sage-400/20 dark:text-sage-300",
  },
};

function KanbanBoard({
  tasks,
  vendors,
  currency,
  filter,
  onToggleTaskDone,
  onPatchTask,
  onAddVendor,
  onEditVendor,
}: {
  tasks: PlanningItem[];
  vendors: CoupleSupplier[];
  currency: Currency;
  filter: "all" | "tasks" | "vendors";
  onToggleTaskDone: (item: PlanningItem) => void;
  onPatchTask: (item: PlanningItem, patch: Partial<PlanningItem>) => void;
  onAddVendor: () => void;
  onEditVendor: (vendor: CoupleSupplier) => void;
}) {
  const { t } = useT();
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverCol, setDragOverCol] = useState<KanbanCol | null>(null);

  const cols: KanbanCol[] = ["todo", "in_progress", "done"];
  const colLabelKey: Record<KanbanCol, string> = {
    todo: "planning.board_col_todo",
    in_progress: "planning.board_col_inprogress",
    done: "planning.board_col_done",
  };

  const tasksByCol = useMemo(() => {
    const map: Record<KanbanCol, PlanningItem[]> = { todo: [], in_progress: [], done: [] };
    if (filter !== "vendors") {
      for (const task of tasks) map[taskKanbanCol(task)].push(task);
    }
    return map;
  }, [tasks, filter]);

  const vendorsByCol = useMemo(() => {
    const map: Record<KanbanCol, CoupleSupplier[]> = { todo: [], in_progress: [], done: [] };
    if (filter !== "tasks") {
      for (const v of vendors) map[vendorKanbanCol(v)].push(v);
    }
    return map;
  }, [vendors, filter]);

  function handleDrop(targetCol: KanbanCol) {
    if (draggingId === null) return;
    const task = tasks.find((t) => t.id === draggingId);
    if (!task) return;
    const from = taskKanbanCol(task);
    if (from === targetCol) return;
    if (targetCol === "done") {
      onToggleTaskDone(task);
    } else if (targetCol === "in_progress") {
      onPatchTask(task, { done: false, start_date: todayIso() });
    } else {
      onPatchTask(task, { done: false, start_date: null });
    }
  }

  return (
    <div className="mt-4 overflow-x-auto pb-2">
      <div className="flex gap-4" style={{ minWidth: "860px" }}>
        {cols.map((col) => (
          <KanbanColumn
            key={col}
            col={col}
            label={t(colLabelKey[col])}
            tasks={tasksByCol[col]}
            vendors={vendorsByCol[col]}
            currency={currency}
            filter={filter}
            isDragTarget={dragOverCol === col}
            draggingId={draggingId}
            onToggleTaskDone={onToggleTaskDone}
            onDragStart={(id) => setDraggingId(id)}
            onDragEnd={() => {
              setDraggingId(null);
              setDragOverCol(null);
            }}
            onDragOver={() => setDragOverCol(col)}
            onDragLeave={() => setDragOverCol((prev) => (prev === col ? null : prev))}
            onDrop={() => {
              handleDrop(col);
              setDragOverCol(null);
            }}
            onAddVendor={onAddVendor}
            onEditVendor={onEditVendor}
          />
        ))}
      </div>
    </div>
  );
}

function KanbanColumn({
  col,
  label,
  tasks,
  vendors,
  currency,
  filter,
  isDragTarget,
  draggingId,
  onToggleTaskDone,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onAddVendor,
  onEditVendor,
}: {
  col: KanbanCol;
  label: string;
  tasks: PlanningItem[];
  vendors: CoupleSupplier[];
  currency: Currency;
  filter: "all" | "tasks" | "vendors";
  isDragTarget: boolean;
  draggingId: number | null;
  onToggleTaskDone: (item: PlanningItem) => void;
  onDragStart: (id: number) => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onAddVendor: () => void;
  onEditVendor: (vendor: CoupleSupplier) => void;
}) {
  const { t } = useT();
  const total = tasks.length + vendors.length;
  const styles = COL_STYLES[col];

  return (
    <div
      className={`flex min-w-[280px] flex-1 flex-col rounded-2xl border border-paper-200 bg-paper-50 transition-colors dark:border-umber-700 dark:bg-umber-800 ${styles.topBorder} ${
        isDragTarget ? "ring-2 ring-ink-300 dark:ring-umber-400" : ""
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      <div className="flex items-center gap-2 border-b border-paper-200 px-4 py-3 dark:border-umber-700">
        <span
          className={`font-grotesk text-xs font-semibold uppercase tracking-[0.08em] ${styles.headerText}`}
        >
          {label}
        </span>
        {total > 0 && (
          <span
            className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${styles.badge}`}
          >
            {total}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 p-3">
        {tasks.map((item) => (
          <TaskKanbanCard
            key={item.id}
            item={item}
            isDragging={draggingId === item.id}
            onToggleDone={onToggleTaskDone}
            onDragStart={() => onDragStart(item.id)}
            onDragEnd={onDragEnd}
          />
        ))}
        {vendors.map((vendor) => (
          <VendorKanbanCard
            key={vendor.id}
            vendor={vendor}
            currency={currency}
            onEdit={onEditVendor}
          />
        ))}
        {total === 0 && (
          <p className="py-4 text-center text-xs text-ink-300 dark:text-umber-500">-</p>
        )}
        {col === "todo" && filter !== "tasks" && (
          <button
            type="button"
            onClick={onAddVendor}
            className="mt-1 w-full rounded-xl border border-dashed border-paper-300 px-3 py-2 text-xs text-ink-500 hover:border-ink-300 hover:text-ink-700 transition-colors dark:border-umber-600 dark:text-umber-400 dark:hover:border-umber-500"
          >
            + {t("planning.board_vendor_add")}
          </button>
        )}
      </div>
    </div>
  );
}

function TaskKanbanCard({
  item,
  isDragging,
  onToggleDone,
  onDragStart,
  onDragEnd,
}: {
  item: PlanningItem;
  isDragging: boolean;
  onToggleDone: (item: PlanningItem) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { t } = useT();
  const priority = (item.priority ?? 0) as 0 | 1 | 2;
  const status = timelineStatus(item.due_date, item.done, todayIso());

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={() => onToggleDone(item)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onToggleDone(item);
      }}
      className={`w-full cursor-grab rounded-xl border p-3 text-left transition-colors active:cursor-grabbing hover:bg-paper-100 dark:hover:bg-umber-700 ${
        isDragging ? "opacity-40" : ""
      } ${
        item.done
          ? "border-paper-200 bg-paper-50/50 dark:border-umber-700 dark:bg-umber-800/50"
          : "border-paper-200 bg-white dark:border-umber-700 dark:bg-umber-800"
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-ink-400 dark:text-umber-400">
          {item.done ? (
            <CheckCircle2
              size={14}
              className="text-sage-600 dark:text-sage-400"
              aria-hidden="true"
            />
          ) : (
            <Circle size={14} aria-hidden="true" />
          )}
        </span>
        <span
          className={`min-w-0 flex-1 text-sm leading-snug ${
            item.done
              ? "text-ink-400 line-through dark:text-umber-400"
              : "text-ink-900 dark:text-paper-50"
          }`}
        >
          {item.title}
        </span>
        {priority > 0 && (
          <span className="shrink-0 rounded-full bg-blush-100 px-1.5 py-0.5 text-[10px] font-bold text-blush-700 dark:bg-blush-400/15 dark:text-blush-300">
            {priority === 1 ? "!" : "!!"}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-5">
        {item.due_date && (
          <span className="inline-flex items-center gap-1 text-[11px] text-ink-500 dark:text-umber-300">
            <Calendar size={10} aria-hidden="true" />
            {item.due_date}
          </span>
        )}
        {item.assignee && (
          <span className="inline-flex items-center gap-1 rounded-full bg-paper-200 px-1.5 py-0.5 text-[10px] text-ink-600 dark:bg-umber-700 dark:text-umber-200">
            <User size={9} aria-hidden="true" />
            {item.assignee}
          </span>
        )}
        {status === "overdue" && (
          <span className="rounded-full bg-blush-500 px-1.5 py-0.5 text-[10px] font-medium text-paper-50">
            {t("planning.status_overdue")}
          </span>
        )}
        {status === "due_soon" && (
          <span className="rounded-full bg-blush-50 px-1.5 py-0.5 text-[10px] font-medium text-blush-700 ring-1 ring-blush-200 dark:bg-blush-400/15 dark:text-blush-300 dark:ring-blush-400/30">
            {t("planning.status_due_soon")}
          </span>
        )}
        {item.done && (
          <span className="rounded-full bg-sage-100 px-1.5 py-0.5 text-[10px] font-medium text-sage-700 dark:bg-sage-400/15 dark:text-sage-300">
            {t("planning.board_col_done")}
          </span>
        )}
      </div>
    </div>
  );
}

function VendorKanbanCard({
  vendor,
  currency,
  onEdit,
}: {
  vendor: CoupleSupplier;
  currency: Currency;
  onEdit: (vendor: CoupleSupplier) => void;
}) {
  const { t, locale } = useT();
  return (
    <div className="rounded-xl border border-paper-200 bg-white p-3 dark:border-umber-700 dark:bg-umber-800">
      <div className="flex items-start gap-1">
        <p className="min-w-0 flex-1 text-sm font-medium text-ink-900 dark:text-paper-50">
          {vendor.name}
        </p>
        <button
          type="button"
          onClick={() => onEdit(vendor)}
          aria-label={t("planning.board_vendor_edit_title")}
          className="shrink-0 text-ink-300 transition-colors hover:text-ink-600 dark:text-umber-500 dark:hover:text-umber-200"
        >
          <Pencil size={12} aria-hidden="true" />
        </button>
      </div>
      <p className="mt-0.5 text-[11px] text-ink-500 dark:text-umber-300">
        {t(`suppliers.cat.${vendor.category}`)}
      </p>
      {vendor.next_step && (
        <p className="mt-0.5 text-[11px] italic text-ink-500 dark:text-umber-300">
          {vendor.next_step}
        </p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {vendor.price_huf != null && (
          <span className="text-[11px] text-ink-600 dark:text-umber-200">
            {formatMoney(vendor.price_huf, currency, locale)}
          </span>
        )}
        {vendor.probability != null && (
          <span className="rounded-full bg-paper-200 px-1.5 py-0.5 text-[10px] font-medium text-ink-600 dark:bg-umber-700 dark:text-umber-200">
            {vendor.probability}%
          </span>
        )}
        {vendor.paid ? (
          <span className="rounded-full bg-sage-100 px-1.5 py-0.5 text-[10px] font-medium text-sage-700 dark:bg-sage-400/15 dark:text-sage-300">
            {t("planning.board_vendor_paid_badge")}
          </span>
        ) : vendor.price_huf != null ? (
          <span className="rounded-full bg-umber-100 px-1.5 py-0.5 text-[10px] font-medium text-umber-700 dark:bg-umber-700/50 dark:text-umber-200">
            {t("planning.board_vendor_inprogress_badge")}
          </span>
        ) : (
          <span className="rounded-full bg-paper-200 px-1.5 py-0.5 text-[10px] font-medium text-ink-500 dark:bg-umber-700 dark:text-umber-300">
            {t("planning.board_vendor_considering_badge")}
          </span>
        )}
      </div>
    </div>
  );
}

import { type DirectorySupplier, SUPPLIER_GROUPS, findSupplierTwins } from "@shared/suppliers";

// Derived from the single taxonomy source so the DIY picker can't drift.
const VALID_CATEGORIES = SUPPLIER_GROUPS.flatMap((g) => g.categories);

function VendorModal({
  vendor,
  directory,
  onUseExisting,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: {
  vendor: CoupleSupplier | null;
  /** Directory entries the typed name is checked against. Empty (or still
   *  loading) disables the check, so the form keeps its old behaviour. */
  directory: readonly DirectorySupplier[];
  /** Record the listing as the couple's pick instead of creating a row. Absent
   *  until the couple id resolves, which leaves the notice informational. */
  onUseExisting?: (supplier: DirectorySupplier) => void;
  onClose: () => void;
  onCreate: (input: {
    name: string;
    category: string;
    next_step: string | null;
    probability: number | null;
    price_huf: number | null;
    confirm_not_listed?: boolean;
  }) => Promise<void>;
  onUpdate: (
    id: string,
    input: {
      name: string;
      category: string;
      next_step: string | null;
      probability: number | null;
      price_huf: number | null;
    },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const { t } = useT();
  const isEdit = vendor !== null;

  const [name, setName] = useState(vendor?.name ?? "");
  const [category, setCategory] = useState<string>(
    vendor?.category ?? VALID_CATEGORIES[0] ?? "venue",
  );
  const [nextStep, setNextStep] = useState(vendor?.next_step ?? "");
  const [probability, setProbability] = useState(
    vendor?.probability != null ? String(vendor.probability) : "",
  );
  const [priceHuf, setPriceHuf] = useState(
    vendor?.price_huf != null ? String(vendor.price_huf) : "",
  );
  const [nextStepError, setNextStepError] = useState(false);
  const [saving, setSaving] = useState(false);
  // "I know, it's a different vendor" — cleared whenever the name or category
  // changes, so a fresh answer gets a fresh check.
  const [twinOverride, setTwinOverride] = useState(false);

  // Edit mode skips the check: the row exists already, and re-offering the
  // listing every time the couple opens it to move a next step would nag.
  const twins =
    isEdit || directory.length === 0
      ? []
      : findSupplierTwins(name, category as DirectorySupplier["category"], directory, 3);
  // An exact match holds the save; a loose one is only an offer. With nothing
  // to adopt with, nothing blocks.
  const twinBlocks = !twinOverride && twins.some((tw) => tw.exact) && Boolean(onUseExisting);

  async function handleSave() {
    const trimmedNextStep = nextStep.trim();
    if (!trimmedNextStep) {
      setNextStepError(true);
      return;
    }
    // The notice is on screen with both ways out; refuse quietly.
    if (twinBlocks) return;
    setNextStepError(false);
    setSaving(true);
    const input = {
      name: name.trim() || (isEdit ? vendor.name : ""),
      category,
      next_step: trimmedNextStep,
      probability: probability !== "" ? Number(probability) : null,
      price_huf: priceHuf !== "" ? Number(priceHuf) : null,
    };
    try {
      if (isEdit) {
        await onUpdate(vendor.id, input);
      } else {
        // The server checks the whole directory; `twinOverride` is the couple's
        // answer to the notice above and the only thing that gets past it.
        await onCreate({ ...input, confirm_not_listed: twinOverride });
      }
      onClose();
    } catch {
      // error already toasted by parent handlers
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!isEdit) return;
    const deleted = await onDelete(vendor.id);
    if (deleted) onClose();
  }

  return (
    <Dialog
      open
      title={t(isEdit ? "planning.board_vendor_edit_title" : "planning.board_vendor_create_title")}
      role="dialog"
      closeOnBackdrop
      onClose={() => {
        if (!saving) onClose();
      }}
      footer={
        <div className="flex w-full items-center gap-2">
          {isEdit && (
            <button
              type="button"
              className="btn-ghost text-blush-700 dark:text-blush-300"
              onClick={handleDelete}
              disabled={saving}
            >
              <Trash2 size={14} className="mr-1.5 inline" aria-hidden="true" />
              {t("common.delete")}
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleSave}
              disabled={saving || !name.trim() || twinBlocks}
            >
              {saving ? t("common.loading") : t("planning.board_vendor_save")}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Name */}
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
            {t("planning.board_vendor_name_label")}
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setTwinOverride(false);
            }}
            autoFocus
            maxLength={200}
            className="w-full rounded-lg border border-paper-300 bg-paper-50 px-3 py-2 text-sm text-ink-900 outline-none focus:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50"
          />
        </label>

        {twins.length > 0 && onUseExisting && (
          <DirectoryTwinNotice
            twins={twins}
            blocking={twinBlocks}
            busy={saving}
            onUse={onUseExisting}
            onDismiss={() => setTwinOverride(true)}
          />
        )}

        {/* Category */}
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
            {t("planning.board_vendor_category_label")}
          </span>
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              // Twins are category-scoped, so switching category re-asks.
              setTwinOverride(false);
            }}
            className="w-full rounded-lg border border-paper-300 bg-paper-50 px-3 py-2 text-sm text-ink-900 outline-none focus:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50"
          >
            {VALID_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {t(`suppliers.cat.${cat}`)}
              </option>
            ))}
          </select>
        </label>

        {/* Next step */}
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
            {t("planning.board_vendor_next_step_label")}
          </span>
          <textarea
            value={nextStep}
            onChange={(e) => {
              setNextStep(e.target.value);
              if (e.target.value.trim()) setNextStepError(false);
            }}
            placeholder={t("planning.board_vendor_next_step_placeholder")}
            rows={2}
            maxLength={200}
            className={`w-full rounded-lg border px-3 py-2 text-sm text-ink-900 outline-none focus:border-ink-400 dark:text-paper-50 ${
              nextStepError
                ? "border-blush-500 bg-blush-50 dark:border-blush-400 dark:bg-umber-800"
                : "border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-800"
            }`}
          />
          {nextStepError && (
            <p className="mt-1 text-xs text-blush-600 dark:text-blush-400">
              {t("planning.board_vendor_next_step_required")}
            </p>
          )}
        </label>

        <div className="flex gap-4">
          {/* Probability */}
          <label className="block flex-1">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
              {t("planning.board_vendor_probability_label")}
            </span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={probability}
                onChange={(e) => setProbability(e.target.value)}
                min={0}
                max={100}
                placeholder="-"
                className="w-full rounded-lg border border-paper-300 bg-paper-50 px-3 py-2 text-sm text-ink-900 outline-none focus:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50"
              />
              <span className="text-sm text-ink-500 dark:text-umber-300">%</span>
            </div>
          </label>

          {/* Price */}
          <label className="block flex-1">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
              {t("planning.board_vendor_amount_label")}
            </span>
            <input
              type="number"
              value={priceHuf}
              onChange={(e) => setPriceHuf(e.target.value)}
              min={0}
              placeholder="-"
              className="w-full rounded-lg border border-paper-300 bg-paper-50 px-3 py-2 text-sm text-ink-900 outline-none focus:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50"
            />
          </label>
        </div>
      </div>
    </Dialog>
  );
}
