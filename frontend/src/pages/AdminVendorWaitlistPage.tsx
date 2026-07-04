// Admin triage for vendor waitlist submissions from /vendors.
//
// UX (Uber-style): a bold segmented stat bar at the top (Beérkezett / Átnézés
// alatt / Elfogadva / Elutasítva) shows each status count as a big tabular
// figure and doubles as the filter — the active segment flips to a koromfekete
// fill. Below it, each row is a clean .admin-card: name + status <Pill> +
// glanceable social-channel icons, with one bold primary that opens the
// respond sheet. The sheet (a bottom-sheet on mobile, sticky action footer)
// is the single detail surface: it recaps everything the vendor submitted
// (<SubmittedDetails>) above the outcome picker + email + notes, so vetting
// and replying happen in one place. Decided rows also expose the destructive
// "Újranyitás" as a low-weight ghost, gated behind a useConfirm() dialog that
// spells out which prior decision is about to be cleared.

import type {
  VendorWaitlistAdminView,
  VendorWaitlistOutcome,
  VendorWaitlistStatus,
} from "@shared/vendor_waitlist";
import { buildEmailDraft } from "@shared/vendor_waitlist";
import {
  Check,
  ChevronRight,
  Clock,
  Facebook,
  FileText,
  Globe,
  Instagram,
  Link2,
  Loader2,
  Mail,
  RotateCcw,
  Sparkles,
  X,
  Youtube,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdminEmptyState, AdminPageHeader, Pill } from "../components/admin";
import type { PillTone } from "../components/admin";
import { Button, Dialog, Skeleton, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminVendorWaitlistApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

/** Status → <Pill> mapping. The icon is part of the signal — colour alone
 *  doesn't carry meaning for colourblind admins, so every status renders
 *  its own glyph at 11px (matches the pill's 11px type). Order of the
 *  tones echoes the lifecycle: blush (just arrived) → violet (under
 *  consideration) → sage (accepted) → muted (rejected, decision over). */
const STATUS_PILL: Record<VendorWaitlistStatus, { tone: PillTone; Icon: typeof Sparkles }> = {
  new: { tone: "blush", Icon: Sparkles },
  under_review: { tone: "violet", Icon: Clock },
  accepted: { tone: "sage", Icon: Check },
  rejected: { tone: "muted", Icon: X },
};

const STATUS_KEY: Record<VendorWaitlistStatus, string> = {
  new: "admin.waitlist_status_new",
  under_review: "admin.waitlist_status_under_review",
  accepted: "admin.waitlist_status_accepted",
  rejected: "admin.waitlist_status_rejected",
};

const FILTER_KEY: Record<VendorWaitlistStatus, string> = {
  new: "admin.waitlist_filter_new",
  under_review: "admin.waitlist_filter_under_review",
  accepted: "admin.waitlist_filter_accepted",
  rejected: "admin.waitlist_filter_rejected",
};

const EMPTY_KEY: Record<VendorWaitlistStatus, string> = {
  new: "admin.waitlist_empty_new",
  under_review: "admin.waitlist_empty_under_review",
  accepted: "admin.waitlist_empty_accepted",
  rejected: "admin.waitlist_empty_rejected",
};

/** The outcome states a decided card can sit in. Used by the reopen
 *  confirm body when we need a human-readable label for the prior
 *  decision being cleared. Maps to the same key set the modal uses for
 *  its outcome radios so the wording stays identical across surfaces. */
const OUTCOME_LABEL_KEY: Record<VendorWaitlistOutcome, string> = {
  accepted: "admin.waitlist_modal_outcome_accepted",
  under_review: "admin.waitlist_modal_outcome_under_review",
  rejected: "admin.waitlist_modal_outcome_rejected",
};

const FILTERS: VendorWaitlistStatus[] = ["new", "under_review", "accepted", "rejected"];

/** Two-letter avatar initials from the business name (falls back to email).
 *  Mirrors the planner/vendor admin cards so all three KEZELÉS lists share the
 *  same identity chip. */
function initials(name: string, email: string): string {
  const src = (name || email).trim();
  const parts = src.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? src[0] ?? "?";
  const second = parts.length > 1 ? (parts[1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}

type ChannelKey = "website" | "instagram" | "youtube" | "facebook";

interface ChannelDetection {
  website: string | null;
  instagram: string | null;
  youtube: string | null;
  facebook: string | null;
  /** Portfolio links the host-matcher didn't claim — Pinterest, Behance,
   *  Drive folders, etc. Rendered (still gated behind <details>) so the
   *  admin can audit them too. */
  others: string[];
}

/** Strip `www.` and lowercase the hostname for prefix/suffix matching.
 *  Returns null for unparseable URLs (the row is still preserved in
 *  `others` so we don't silently drop content). */
function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

const YT_HOSTS = ["youtube.com", "m.youtube.com", "youtu.be"];
const FB_HOSTS = ["facebook.com", "m.facebook.com", "fb.com", "fb.me"];
const IG_HOSTS = ["instagram.com"];

function hostMatches(host: string, list: readonly string[]): boolean {
  return list.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Split a waitlist entry's links into known social channels + an "others"
 *  bucket so the admin card can render a fixed-position icon row for the
 *  big four. `instagram_handle` (a bare handle field) wins over a portfolio
 *  IG URL — both can be present but the dedicated field is canonical. */
function detectChannels(entry: VendorWaitlistAdminView): ChannelDetection {
  let youtube: string | null = null;
  let facebook: string | null = null;
  let igFromLinks: string | null = null;
  const others: string[] = [];

  for (const url of entry.portfolio_links) {
    const host = safeHost(url);
    if (!host) {
      others.push(url);
      continue;
    }
    if (!youtube && hostMatches(host, YT_HOSTS)) {
      youtube = url;
    } else if (!facebook && hostMatches(host, FB_HOSTS)) {
      facebook = url;
    } else if (!igFromLinks && hostMatches(host, IG_HOSTS)) {
      igFromLinks = url;
    } else {
      others.push(url);
    }
  }

  const instagram = entry.instagram_handle
    ? `https://instagram.com/${entry.instagram_handle}`
    : igFromLinks;

  return { website: entry.website, instagram, youtube, facebook, others };
}

/** Per-channel icon + brand-tinted active class. Dim state shares one token
 *  pair (`text-neutral-300` / `dark:text-umber-500`) so every blank slot reads
 *  identically — colour only appears when the vendor actually submitted a
 *  link. YouTube uses Tailwind core red (the one channel where colour
 *  recognition is universal); Facebook stays neutral-toned because the palette
 *  has no true brand blue and the icon shape is enough. */
const CHANNEL_META: Record<
  ChannelKey,
  {
    Icon: typeof Globe;
    activeClass: string;
    hoverClass: string;
    labelKey: string;
  }
> = {
  website: {
    Icon: Globe,
    activeClass: "text-neutral-700 dark:text-paper-100",
    hoverClass: "hover:text-neutral-900 dark:hover:text-paper-50",
    labelKey: "admin.waitlist_card_channel_website",
  },
  instagram: {
    Icon: Instagram,
    activeClass: "text-blush-500 dark:text-blush-400",
    hoverClass: "hover:text-blush-700 dark:hover:text-blush-300",
    labelKey: "admin.waitlist_card_channel_instagram",
  },
  youtube: {
    Icon: Youtube,
    activeClass: "text-red-600 dark:text-red-500",
    hoverClass: "hover:text-red-700 dark:hover:text-red-400",
    labelKey: "admin.waitlist_card_channel_youtube",
  },
  facebook: {
    Icon: Facebook,
    activeClass: "text-neutral-700 dark:text-neutral-300",
    hoverClass: "hover:text-neutral-900 dark:hover:text-paper-50",
    labelKey: "admin.waitlist_card_channel_facebook",
  },
};

const CHANNEL_DIM_CLASS = "text-neutral-300 dark:text-umber-500";
const CHANNEL_ORDER: ChannelKey[] = ["website", "instagram", "youtube", "facebook"];

export default function AdminVendorWaitlistPage() {
  const { t, locale } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [entries, setEntries] = useState<VendorWaitlistAdminView[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<VendorWaitlistStatus>("new");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [editing, setEditing] = useState<VendorWaitlistAdminView | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminVendorWaitlistApi
      .list()
      .then((r) => {
        if (!cancelled) {
          setEntries(r.entries);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t, toast]);

  function replace(entry: VendorWaitlistAdminView) {
    setEntries((cur) => cur.map((e) => (e.id === entry.id ? entry : e)));
  }

  const fmtDate = (ts: number) =>
    new Date(ts).toLocaleDateString(locale === "hu" ? "hu-HU" : "en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  async function onReopen(entry: VendorWaitlistAdminView) {
    // Reopen wipes the prior decision; gate the destructive action
    // behind a confirm() that names the outcome + date being cleared so
    // the admin knows exactly what they're undoing. The status of a
    // decided row already encodes the outcome (accepted/under_review/
    // rejected), so we cast it to the narrower union here.
    const priorOutcome = entry.status as VendorWaitlistOutcome;
    const outcomeLabel = t(OUTCOME_LABEL_KEY[priorOutcome]);
    const decidedLabel = entry.outcome_at ? fmtDate(entry.outcome_at) : "-";
    const ok = await confirm({
      title: t("admin.waitlist_reopen_confirm_title"),
      body: t("admin.waitlist_reopen_confirm_body", {
        outcome: outcomeLabel,
        decided: decidedLabel,
      }),
      confirmLabel: t("admin.waitlist_reopen_confirm_ok"),
      cancelLabel: t("admin.waitlist_modal_cancel"),
      destructive: true,
    });
    if (!ok) return;
    setPendingId(entry.id);
    try {
      const r = await adminVendorWaitlistApi.reopen(entry.id);
      replace(r.entry);
      toast.success(t("admin.waitlist_toast_reopened"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setPendingId(null);
    }
  }

  // Distinct categories present across all submissions (regardless of the
  // active status tab), sorted by their localized label so the dropdown
  // reads alphabetically. Drives the category filter options.
  const categoryOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const e of entries) seen.add(e.category);
    return [...seen].sort((a, b) =>
      t(`suppliers.cat.${a}`).localeCompare(t(`suppliers.cat.${b}`), locale === "hu" ? "hu" : "en"),
    );
  }, [entries, t, locale]);

  // The category filter narrows the whole board first, so the status tile
  // counts reflect "how many <category> are in each status" — the useful
  // triage view when a lot of submissions share one category (e.g. Fotós).
  const entriesInCategory = useMemo(
    () =>
      categoryFilter === "all" ? entries : entries.filter((e) => e.category === categoryFilter),
    [entries, categoryFilter],
  );

  const visibleEntries = useMemo(
    () => entriesInCategory.filter((e) => e.status === filter),
    [entriesInCategory, filter],
  );

  return (
    <>
      <AdminPageHeader title={t("admin.waitlist_title")} subtitle={t("admin.waitlist_sub")} />

      {/* Uber-style segmented stat bar: the count is the headline (bold
       *  tabular figure in the grotesk face), the status label sits under it,
       *  and the whole tile is the filter control. Active tile flips to a
       *  koromfekete fill so the current segment reads at a glance on either
       *  theme. Doubles as the page's KPI strip — no separate chip row. */}
      <div
        role="tablist"
        aria-label={t("admin.waitlist_title")}
        className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {FILTERS.map((f) => {
          const count = entriesInCategory.filter((e) => e.status === f).length;
          const active = filter === f;
          return (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(f)}
              className={`flex min-h-tap flex-col items-start justify-center gap-0.5 rounded-2xl px-4 py-3 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500/40 ${
                active
                  ? "bg-neutral-900 text-paper-50 dark:bg-paper-100 dark:text-umber-900"
                  : "bg-paper-50 text-umber-900 ring-1 ring-ink-100 hover:bg-paper-100 dark:bg-umber-900 dark:text-paper-100 dark:ring-umber-700 dark:hover:bg-umber-800"
              }`}
            >
              <span className="font-grotesk text-2xl font-semibold leading-none tabular-nums">
                {count}
              </span>
              <span
                className={`text-[11px] font-medium uppercase tracking-[0.08em] ${
                  active
                    ? "text-paper-200 dark:text-umber-700"
                    : "text-umber-500 dark:text-umber-300"
                }`}
              >
                {t(FILTER_KEY[f])}
              </span>
            </button>
          );
        })}
      </div>

      {/* Category filter. Only surfaces once submissions span more than one
       *  category; with a single category it would be noise. Narrows the
       *  whole board (stat tiles + list) so a Fotós-heavy inbox can be
       *  triaged one category at a time. */}
      {categoryOptions.length > 1 && (
        <div className="mb-4 flex items-center gap-2">
          <label
            htmlFor="waitlist-category-filter"
            className="text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500 dark:text-umber-300"
          >
            {t("admin.waitlist_filter_category_label")}
          </label>
          <select
            id="waitlist-category-filter"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="min-h-tap rounded-xl bg-paper-50 px-3 py-2 text-sm text-neutral-900 ring-1 ring-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500/40 dark:bg-umber-900 dark:text-paper-100 dark:ring-umber-700"
          >
            <option value="all">{t("admin.waitlist_filter_category_all")}</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {t(`suppliers.cat.${c}`)}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <ul className="grid gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i}>
              <article className="admin-card">
                <div className="flex items-center gap-4">
                  <Skeleton
                    variant="circle"
                    width={44}
                    height={44}
                    className="hidden shrink-0 sm:block"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Skeleton width={200} height={18} />
                    <Skeleton width={260} height={12} />
                  </div>
                  <Skeleton width={110} height={32} rounded="md" />
                </div>
              </article>
            </li>
          ))}
        </ul>
      ) : visibleEntries.length === 0 ? (
        <AdminEmptyState>{t(EMPTY_KEY[filter])}</AdminEmptyState>
      ) : (
        <ul className="grid gap-4">
          {visibleEntries.map((e) => (
            <li key={e.id}>
              <EntryCard
                entry={e}
                t={t}
                fmtDate={fmtDate}
                onRespond={() => setEditing(e)}
                onReopen={() => onReopen(e)}
                pending={pendingId === e.id}
              />
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <RespondDialog
          entry={editing}
          onClose={() => setEditing(null)}
          onDecided={(next) => {
            replace(next);
            setEditing(null);
            toast.success(t("admin.waitlist_toast_decided"));
          }}
          onError={(message) => toast.error(message)}
          confirmOverwrite={async () =>
            confirm({
              title: t("admin.waitlist_modal_overwrite_confirm_title"),
              body: t("admin.waitlist_modal_overwrite_confirm_body"),
              confirmLabel: t("admin.waitlist_modal_overwrite_confirm_ok"),
              cancelLabel: t("admin.waitlist_modal_cancel"),
            })
          }
          t={t}
        />
      )}
    </>
  );
}

function EntryCard({
  entry,
  t,
  fmtDate,
  onRespond,
  onReopen,
  pending,
}: {
  entry: VendorWaitlistAdminView;
  t: (k: string, vars?: Record<string, string>) => string;
  fmtDate: (ts: number) => string;
  onRespond: () => void;
  onReopen: () => void;
  pending: boolean;
}) {
  // The four big-social channels render as a fixed glanceable icon row on the
  // resting card. Everything else the vendor submitted (portfolio links,
  // price list, message, tax/reg, prior reply, notes) now lives in the
  // respond sheet (<SubmittedDetails>) so the list itself stays clean.
  // Detection runs once per render via useMemo so the host-parse cost doesn't
  // repeat as the stat-bar segments toggle.
  const channels = useMemo(() => detectChannels(entry), [entry]);
  const hasChannelRow =
    !!channels.website || !!channels.instagram || !!channels.youtube || !!channels.facebook;
  const statusMeta = STATUS_PILL[entry.status];
  const StatusIcon = statusMeta.Icon;
  const primaryLabel =
    entry.status === "new" ? t("admin.waitlist_action_respond") : t("admin.waitlist_action_review");
  return (
    <article className="admin-card">
      <div className="flex items-center gap-4">
        {/* Identity — muted initials avatar, matching the pending planner/vendor
         *  cards so the three KEZELÉS lists read as one rhythm. */}
        <div
          aria-hidden="true"
          className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-paper-200 text-sm font-semibold text-umber-700 sm:flex dark:bg-umber-800 dark:text-umber-200"
        >
          {initials(entry.business_name, entry.email)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 truncate font-semibold text-umber-900 dark:text-paper-50">
              {entry.business_name}
            </h2>
            <Pill
              tone={statusMeta.tone}
              icon={<StatusIcon size={11} />}
              srLabel={`${t("admin.waitlist_status_sr_label")}: `}
            >
              {t(STATUS_KEY[entry.status])}
            </Pill>
          </div>
          <a
            href={`mailto:${entry.email}`}
            className="block truncate text-sm text-umber-700 hover:text-umber-900 dark:text-umber-300 dark:hover:text-paper-50"
          >
            {entry.email}
          </a>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-umber-500 dark:text-umber-400">
            <span>{fmtDate(entry.created_at)}</span>
            <span aria-hidden="true">·</span>
            <span>{t(`suppliers.cat.${entry.category}`)}</span>
            {entry.location && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{entry.location}</span>
              </>
            )}
            {entry.outcome_at && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t("admin.waitlist_card_decided")}: {fmtDate(entry.outcome_at)}
                </span>
              </>
            )}
          </div>
          {hasChannelRow && <ChannelRow channels={channels} t={t} />}
        </div>

        {/* Action column: one bold primary that opens the respond sheet
         *  (where details + the approve action live together). Decided rows
         *  also expose the destructive reopen as a low-weight ghost. */}
        <div className="flex shrink-0 items-center gap-2">
          {entry.status !== "new" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReopen}
              loading={pending}
              aria-label={t("admin.waitlist_action_reopen")}
            >
              <RotateCcw size={14} aria-hidden /> {t("admin.waitlist_action_reopen")}
            </Button>
          )}
          <Button
            type="button"
            variant={entry.status === "new" ? "primary" : "outline"}
            size="sm"
            onClick={onRespond}
            disabled={pending}
            rightIcon={<ChevronRight size={15} aria-hidden />}
          >
            {primaryLabel}
          </Button>
        </div>
      </div>
    </article>
  );
}

/** Read-only recap of everything the vendor submitted, rendered at the top of
 *  the respond sheet so the admin can vet the application and reply in one
 *  surface. Pulled out of the card to keep the list clean (Uber-style: the
 *  row is a glance, the sheet is the detail). */
function SubmittedDetails({
  entry,
  channels,
  t,
}: {
  entry: VendorWaitlistAdminView;
  channels: ChannelDetection;
  t: (k: string, vars?: Record<string, string>) => string;
}) {
  const hasDetail =
    channels.others.length > 0 ||
    !!entry.price_list_url ||
    !!entry.message ||
    !!entry.tax_number ||
    !!entry.registration_number ||
    !!entry.sent_subject ||
    !!entry.notes;
  if (!hasDetail) return null;
  return (
    <div className="flex flex-col gap-2">
      {channels.others.length > 0 && (
        <div className="admin-tile">
          <p className="eyebrow">{t("admin.waitlist_card_portfolio_other_label")}</p>
          <ul className="mt-1 grid gap-0.5">
            {channels.others.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1 truncate text-xs text-neutral-700 hover:text-neutral-900 dark:text-paper-100 dark:hover:text-paper-50"
                >
                  <Link2 size={12} aria-hidden className="shrink-0" />
                  <span className="truncate">{url}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {entry.price_list_url && (
        <div className="admin-tile">
          <p className="eyebrow">{t("admin.waitlist_card_price_list_label")}</p>
          <a
            href={entry.price_list_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1.5 text-xs text-neutral-700 hover:text-neutral-900 dark:text-paper-100 dark:hover:text-paper-50"
          >
            <FileText size={13} aria-hidden className="shrink-0" />
            <span>{entry.price_list_url.split("/").pop()}</span>
          </a>
        </div>
      )}
      {(entry.tax_number || entry.registration_number) && (
        <div className="admin-tile">
          <p className="eyebrow">{t("admin.waitlist_card_verification_label")}</p>
          {entry.tax_number && (
            <p className="mt-0.5 font-mono text-xs text-neutral-800 dark:text-paper-100">
              {t("admin.waitlist_card_tax_label")}: {entry.tax_number}
            </p>
          )}
          {entry.registration_number && (
            <p className="mt-0.5 font-mono text-xs text-neutral-800 dark:text-paper-100">
              {t("admin.waitlist_card_reg_label")}: {entry.registration_number}
            </p>
          )}
        </div>
      )}
      {entry.message && (
        <div className="admin-tile">
          <p className="eyebrow">{t("admin.waitlist_card_message_label")}</p>
          <p className="mt-1 text-sm text-neutral-700 dark:text-paper-100">{entry.message}</p>
        </div>
      )}
      {entry.sent_subject && (
        <details className="admin-tile">
          <summary className="cursor-pointer text-xs font-medium text-neutral-800 dark:text-paper-50">
            <span className="eyebrow">{t("admin.waitlist_card_sent_label")}</span> ·{" "}
            {entry.sent_subject}
          </summary>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-neutral-700 dark:text-paper-100">
            {entry.sent_body ?? ""}
          </pre>
        </details>
      )}
      {entry.notes && (
        <div className="admin-tile">
          <p className="eyebrow">{t("admin.waitlist_card_notes_label")}</p>
          <p className="mt-1 text-xs text-neutral-700 dark:text-paper-100">{entry.notes}</p>
        </div>
      )}
    </div>
  );
}

/** Fixed-position four-slot channel row on the resting card. Always renders
 *  all four slots in the same order — the absence of colour is information
 *  too, and a steady position lets the admin scan a list of cards quickly.
 *  Active slots are real <a> links opening in a new tab; dim slots render
 *  as `<span>` with an sr-only "no X link provided" affordance so colour
 *  isn't the only signal. */
function ChannelRow({
  channels,
  t,
}: {
  channels: ChannelDetection;
  t: (k: string, vars?: Record<string, string>) => string;
}) {
  return (
    <div
      role="list"
      aria-label={t("admin.waitlist_card_channel_row_label")}
      className="mt-1 flex items-center gap-3 text-[11px]"
    >
      {CHANNEL_ORDER.map((key) => {
        const meta = CHANNEL_META[key];
        const Icon = meta.Icon;
        const url = channels[key];
        const channelName = t(meta.labelKey);
        if (url) {
          return (
            <a
              key={key}
              role="listitem"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title={channelName}
              aria-label={t("admin.waitlist_card_channel_visit", { channel: channelName })}
              className={`inline-flex items-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500/40 ${meta.activeClass} ${meta.hoverClass}`}
            >
              <Icon size={14} aria-hidden />
            </a>
          );
        }
        return (
          <span
            key={key}
            role="listitem"
            title={t("admin.waitlist_card_channel_none", { channel: channelName })}
            className={`inline-flex items-center ${CHANNEL_DIM_CLASS}`}
          >
            <Icon size={14} aria-hidden />
            <span className="sr-only">
              {t("admin.waitlist_card_channel_none", { channel: channelName })}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** Triage modal — outcome radios + editable subject/body (pre-filled from
 *  `buildEmailDraft`) + admin-only notes. When the admin switches outcomes
 *  we re-derive the draft, but if they've already edited subject/body we
 *  ask before overwriting. */
function RespondDialog({
  entry,
  onClose,
  onDecided,
  onError,
  confirmOverwrite,
  t,
}: {
  entry: VendorWaitlistAdminView;
  onClose: () => void;
  onDecided: (next: VendorWaitlistAdminView) => void;
  onError: (msg: string) => void;
  confirmOverwrite: () => Promise<boolean>;
  t: (k: string) => string;
}) {
  const initialOutcome: VendorWaitlistOutcome =
    entry.status === "accepted" || entry.status === "under_review" || entry.status === "rejected"
      ? entry.status
      : "accepted";
  const initialDraft = useMemo(
    () =>
      buildEmailDraft(initialOutcome, {
        business_name: entry.business_name,
        category_label: t(`suppliers.cat.${entry.category}`),
      }),
    [initialOutcome, entry.business_name, entry.category, t],
  );

  const channels = useMemo(() => detectChannels(entry), [entry]);

  const [outcome, setOutcome] = useState<VendorWaitlistOutcome>(initialOutcome);
  // Seed subject/body from a prior send if there is one — lets the admin
  // re-decide with the same wording. Otherwise use the pristine draft.
  const [subject, setSubject] = useState(entry.sent_subject ?? initialDraft.subject);
  const [body, setBody] = useState(entry.sent_body ?? initialDraft.body);
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const editedRef = useRef<boolean>(
    Boolean(entry.sent_subject || entry.sent_body) ||
      subject !== initialDraft.subject ||
      body !== initialDraft.body,
  );

  async function pickOutcome(next: VendorWaitlistOutcome) {
    if (next === outcome || submitting) return;
    const draft = buildEmailDraft(next, {
      business_name: entry.business_name,
      category_label: t(`suppliers.cat.${entry.category}`),
    });
    if (editedRef.current) {
      const ok = await confirmOverwrite();
      if (!ok) {
        // Switch outcome but keep their edits untouched.
        setOutcome(next);
        return;
      }
    }
    setOutcome(next);
    setSubject(draft.subject);
    setBody(draft.body);
    editedRef.current = false;
  }

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const r = await adminVendorWaitlistApi.decide(entry.id, {
        outcome,
        subject,
        body,
        notes,
      });
      onDecided(r.entry);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      title={`${t("admin.waitlist_modal_title")}: ${entry.business_name}`}
      role="dialog"
      onClose={onClose}
      size="lg"
      closeOnBackdrop
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            {t("admin.waitlist_modal_cancel")}
          </Button>
          <Button type="button" variant="primary" onClick={submit} loading={submitting}>
            {submitting ? t("admin.waitlist_modal_sending") : t("admin.waitlist_modal_send")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {/* Application recap — the submitted details live here in the sheet
         *  so the admin vets and replies without leaving the surface. */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600 dark:text-umber-200">
            <a
              href={`mailto:${entry.email}`}
              className="inline-flex items-center gap-1 text-neutral-800 hover:text-neutral-950 dark:text-paper-100 dark:hover:text-paper-50"
            >
              <Mail size={12} aria-hidden /> {entry.email}
            </a>
            <span className="rounded-full bg-paper-100 px-1.5 py-0.5 dark:bg-umber-800">
              {t(`suppliers.cat.${entry.category}`)}
            </span>
            {entry.location && <span>{entry.location}</span>}
          </div>
          <SubmittedDetails entry={entry} channels={channels} t={t} />
        </div>

        <div>
          <p className="field-label">{t("admin.waitlist_modal_outcome_label")}</p>
          <div role="radiogroup" className="mt-1 flex flex-wrap gap-2">
            <OutcomeButton
              outcome="accepted"
              current={outcome}
              label={t("admin.waitlist_modal_outcome_accepted")}
              onPick={pickOutcome}
              submitting={submitting}
              tint="bg-sage-50 border-sage-300 text-sage-800 dark:bg-sage-400/15 dark:border-sage-400/40 dark:text-sage-300"
              activeTint="bg-sage-500 border-sage-600 text-white dark:bg-sage-400 dark:border-sage-400 dark:text-umber-900"
            />
            <OutcomeButton
              outcome="under_review"
              current={outcome}
              label={t("admin.waitlist_modal_outcome_under_review")}
              onPick={pickOutcome}
              submitting={submitting}
              tint="bg-neutral-50 border-neutral-300 text-neutral-950 dark:bg-neutral-500/15 dark:border-neutral-400/40 dark:text-neutral-200"
              activeTint="bg-neutral-900 border-neutral-900 text-white dark:bg-neutral-500/40 dark:border-neutral-400/60 dark:text-neutral-100"
            />
            <OutcomeButton
              outcome="rejected"
              current={outcome}
              label={t("admin.waitlist_modal_outcome_rejected")}
              onPick={pickOutcome}
              submitting={submitting}
              tint="bg-paper-100 border-paper-300 text-neutral-700 dark:bg-umber-700/60 dark:border-umber-700 dark:text-paper-100"
              activeTint="bg-neutral-800 border-neutral-800 text-paper-100 dark:bg-paper-50 dark:border-paper-50 dark:text-umber-900"
            />
          </div>
          {outcome === "accepted" && (
            <p className="mt-2 flex items-start gap-1.5 rounded-md border border-sage-200 bg-sage-50 px-3 py-2 text-xs text-sage-800 dark:border-sage-400/30 dark:bg-sage-400/10 dark:text-sage-200">
              <Sparkles size={13} aria-hidden className="mt-0.5 shrink-0" />
              <span>{t("admin.waitlist_modal_accept_invite_note")}</span>
            </p>
          )}
        </div>

        <div>
          <label htmlFor="waitlist-subject" className="field-label">
            {t("admin.waitlist_modal_subject_label")}
          </label>
          <input
            id="waitlist-subject"
            type="text"
            className="input"
            value={subject}
            maxLength={200}
            onChange={(e) => {
              setSubject(e.target.value);
              editedRef.current = true;
            }}
          />
        </div>

        <div>
          <label htmlFor="waitlist-body" className="field-label">
            {t("admin.waitlist_modal_body_label")}
          </label>
          <textarea
            id="waitlist-body"
            className="input"
            rows={12}
            value={body}
            maxLength={5000}
            onChange={(e) => {
              setBody(e.target.value);
              editedRef.current = true;
            }}
          />
        </div>

        <div>
          <label htmlFor="waitlist-notes" className="field-label">
            {t("admin.waitlist_modal_notes_label")}
          </label>
          <textarea
            id="waitlist-notes"
            className="input"
            rows={3}
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
          />
          <p className="field-help">{t("admin.waitlist_modal_notes_helper")}</p>
        </div>
      </div>
    </Dialog>
  );
}

/** Outcome radio in the triage modal. While the send-decide API call is
 *  in flight we disable picking + show a Loader2 next to the active
 *  outcome's label so a double-click can't fire a second submit and the
 *  admin sees that the chip choice is locked, not just the Send button. */
function OutcomeButton({
  outcome,
  current,
  label,
  onPick,
  submitting,
  tint,
  activeTint,
}: {
  outcome: VendorWaitlistOutcome;
  current: VendorWaitlistOutcome;
  label: string;
  onPick: (o: VendorWaitlistOutcome) => void;
  submitting: boolean;
  tint: string;
  activeTint: string;
}) {
  const active = outcome === current;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-busy={submitting && active ? true : undefined}
      disabled={submitting}
      onClick={() => onPick(outcome)}
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500/40 disabled:cursor-not-allowed disabled:opacity-60 ${
        active ? activeTint : tint
      }`}
    >
      {submitting && active && (
        <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden />
      )}
      {label}
    </button>
  );
}
