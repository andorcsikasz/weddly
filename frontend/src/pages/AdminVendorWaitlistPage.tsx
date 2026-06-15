// Admin triage for vendor waitlist submissions from /vendors.
//
// UX: a filter pill row at the top (Beérkezett / Átnézés alatt / Elfogadva /
// Elutasítva) drives which cards are visible below. Each card renders on the
// same .admin-card chrome — status colour lives only on the <Pill> in the
// header, not on the card border, so a list of mixed-status rows reads as
// one rhythm instead of a Trello board. Decided cards expose two actions:
// "Megválaszolom" (the safe primary path, edits the existing reply) keeps
// its outline weight, and the destructive "Újranyitás" drops to ghost +
// gates behind a useConfirm() dialog that spells out which prior decision
// is about to be cleared.

import type {
  VendorWaitlistAdminView,
  VendorWaitlistOutcome,
  VendorWaitlistStatus,
} from "@shared/vendor_waitlist";
import { buildEmailDraft } from "@shared/vendor_waitlist";
import {
  Check,
  Clock,
  Facebook,
  FileText,
  Globe,
  Instagram,
  Link2,
  Loader2,
  Mail,
  MessageSquare,
  RotateCcw,
  Sparkles,
  X,
  Youtube,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdminEmptyState, AdminFilterChip, AdminPageHeader, Pill } from "../components/admin";
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
    const decidedLabel = entry.outcome_at ? fmtDate(entry.outcome_at) : "—";
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

  const visibleEntries = useMemo(
    () => entries.filter((e) => e.status === filter),
    [entries, filter],
  );

  return (
    <>
      <AdminPageHeader title={t("admin.waitlist_title")} subtitle={t("admin.waitlist_sub")} />

      <div className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count = entries.filter((e) => e.status === f).length;
          return (
            <AdminFilterChip
              key={f}
              label={`${t(FILTER_KEY[f])}${count > 0 ? ` · ${count}` : ""}`}
              active={filter === f}
              onClick={() => setFilter(f)}
            />
          );
        })}
      </div>

      {loading ? (
        <ul className="grid gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i}>
              <article className="admin-card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1 flex flex-col gap-1">
                    <Skeleton width={200} height={18} />
                    <Skeleton width={260} height={12} />
                  </div>
                  <Skeleton width={70} height={18} rounded="full" />
                  <Skeleton width={120} height={28} rounded="md" />
                </div>
              </article>
            </li>
          ))}
        </ul>
      ) : visibleEntries.length === 0 ? (
        <AdminEmptyState>{t(EMPTY_KEY[filter])}</AdminEmptyState>
      ) : (
        <ul className="grid gap-2">
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
  // The four big-social channels move to a fixed icon row on the resting
  // card (always-visible glanceable signal); their freeform siblings —
  // Pinterest, Behance, Drive folders, etc. — stay collapsed inside
  // <details> as `channels.others`. Detection runs once per render via
  // useMemo so the host-parse cost doesn't repeat as filter chips toggle.
  const channels = useMemo(() => detectChannels(entry), [entry]);
  const hasChannelRow =
    !!channels.website || !!channels.instagram || !!channels.youtube || !!channels.facebook;
  const hasDetail =
    channels.others.length > 0 ||
    !!entry.price_list_url ||
    !!entry.message ||
    !!entry.tax_number ||
    !!entry.registration_number ||
    !!entry.sent_subject ||
    !!entry.notes;
  const statusMeta = STATUS_PILL[entry.status];
  const StatusIcon = statusMeta.Icon;
  return (
    <article className="admin-card">
      {/* Header row: name + meta on the left, status + action button on
       *  the right. Everything stays on one line at desktop widths and
       *  flows to two on narrow viewports. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 className="m-0 text-sm font-semibold text-neutral-900 dark:text-paper-50">
              {entry.business_name}
            </h2>
            <a
              href={`mailto:${entry.email}`}
              className="inline-flex items-center gap-1 text-xs text-neutral-700 hover:text-neutral-900 dark:text-paper-100 dark:hover:text-paper-50"
            >
              <Mail size={11} aria-hidden /> {entry.email}
            </a>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-neutral-600 dark:text-umber-200">
            <span>{fmtDate(entry.created_at)}</span>
            <span className="rounded-full bg-paper-100 dark:bg-umber-800 px-1.5 py-0.5">
              {t(`suppliers.cat.${entry.category}`)}
            </span>
            {entry.location && <span className="truncate">{entry.location}</span>}
            {entry.outcome_at && (
              <span>
                {t("admin.waitlist_card_decided")}: {fmtDate(entry.outcome_at)}
              </span>
            )}
          </div>
          {hasChannelRow && <ChannelRow channels={channels} t={t} />}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Pill
            tone={statusMeta.tone}
            icon={<StatusIcon size={11} />}
            srLabel={`${t("admin.waitlist_status_sr_label")}: `}
          >
            {t(STATUS_KEY[entry.status])}
          </Pill>
          {entry.status === "new" ? (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onRespond}
              disabled={pending}
            >
              <MessageSquare size={14} aria-hidden /> {t("admin.waitlist_action_respond")}
            </Button>
          ) : (
            // Decided rows: "Megválaszolom" is the safe primary path
            // (edits the existing reply), so it keeps outline weight.
            // "Újranyitás" wipes the decision — drop to ghost and gate
            // behind a confirm() in the parent. Same visual weight ≠
            // same blast radius; the chrome should reflect that.
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRespond}
                disabled={pending}
              >
                <MessageSquare size={14} aria-hidden /> {t("admin.waitlist_action_respond")}
              </Button>
              <Button type="button" variant="accent" size="sm" onClick={onReopen} loading={pending}>
                <RotateCcw size={14} aria-hidden /> {t("admin.waitlist_action_reopen")}
              </Button>
            </>
          )}
        </div>
      </div>

      {hasDetail && (
        <details className="mt-2 text-xs text-neutral-700 dark:text-paper-100">
          <summary className="cursor-pointer eyebrow">
            {t("admin.waitlist_card_more_label")}
          </summary>
          <div className="mt-2 flex flex-col gap-2">
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
                <p className="eyebrow">Business verification</p>
                {entry.tax_number && (
                  <p className="mt-0.5 font-mono text-xs text-neutral-800 dark:text-paper-100">
                    Tax: {entry.tax_number}
                  </p>
                )}
                {entry.registration_number && (
                  <p className="mt-0.5 font-mono text-xs text-neutral-800 dark:text-paper-100">
                    Reg: {entry.registration_number}
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
        </details>
      )}
    </article>
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
      title={`${t("admin.waitlist_modal_title")} — ${entry.business_name}`}
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
