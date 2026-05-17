// Admin triage for vendor waitlist submissions from /vendors.
//
// UX: a filter pill row at the top (Beérkezett / Átnézés alatt / Elfogadva /
// Elutasítva) drives which color-tinted cards are visible below. Each card
// has a "Megválaszolom" button that opens a modal pre-filled with a HU
// subject + body draft (from `buildEmailDraft`) the admin can tweak before
// sending. On Send the row transitions out of the inbox and the email goes
// out via the existing mailer.

import type {
  VendorWaitlistAdminView,
  VendorWaitlistOutcome,
  VendorWaitlistStatus,
} from "@shared/vendor_waitlist";
import { buildEmailDraft } from "@shared/vendor_waitlist";
import { AtSign, ExternalLink, Link2, Mail, MessageSquare, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../components/AppShell";
import { Button, Dialog, Skeleton, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminVendorWaitlistApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

/** Tailwind-token classnames per status. Every card on the page wears these
 *  so the inbox/under-review/accepted/rejected buckets are visually distinct
 *  at a glance. No raw hex colors per CLAUDE.md. */
const STATUS_CARD_CLASSES: Record<VendorWaitlistStatus, string> = {
  new: "bg-blush-50 border-blush-300 dark:bg-blush-400/15 dark:border-blush-400/40",
  under_review: "bg-violet-50 border-violet-300 dark:bg-violet-500/15 dark:border-violet-400/40",
  accepted: "bg-sage-50 border-sage-300 dark:bg-sage-400/15 dark:border-sage-400/40",
  rejected: "bg-paper-100 border-paper-300 dark:bg-umber-800 dark:border-umber-700",
};

const STATUS_PILL_CLASSES: Record<VendorWaitlistStatus, string> = {
  new: "border-blush-300 bg-blush-100 text-blush-800 dark:border-blush-400/40 dark:bg-blush-400/20 dark:text-blush-300",
  under_review:
    "border-violet-300 bg-violet-100 text-violet-950 dark:border-violet-400/40 dark:bg-violet-500/20 dark:text-violet-200",
  accepted:
    "border-sage-300 bg-sage-100 text-sage-800 dark:border-sage-400/40 dark:bg-sage-400/20 dark:text-sage-300",
  rejected:
    "border-paper-300 bg-paper-200 text-ink-700 dark:border-umber-700 dark:bg-umber-700 dark:text-paper-100",
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

const FILTERS: VendorWaitlistStatus[] = ["new", "under_review", "accepted", "rejected"];

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

  async function onReopen(entry: VendorWaitlistAdminView) {
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

  const fmtDate = (ts: number) =>
    new Date(ts).toLocaleDateString(locale === "hu" ? "hu-HU" : "en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  return (
    <AppShell>
      <header className="mb-4">
        <h1>{t("admin.waitlist_title")}</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">{t("admin.waitlist_sub")}</p>
      </header>

      <div className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const count = entries.filter((e) => e.status === f).length;
          return (
            <FilterPill
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
              <article className="rounded-xl border border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-800 p-3">
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
        <div className="card text-center text-sm text-ink-500 dark:text-umber-300">
          {t(EMPTY_KEY[filter])}
        </div>
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
    </AppShell>
  );
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "rounded-full border border-violet-900 bg-violet-900 dark:border-violet-500/50 dark:bg-violet-500/30 px-3 py-1 text-xs font-medium text-paper-100 dark:text-violet-100"
          : "rounded-full border border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-800 px-3 py-1 text-xs text-violet-950 dark:text-violet-200 hover:border-violet-300 dark:hover:border-violet-400/40"
      }
    >
      {label}
    </button>
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
  t: (k: string) => string;
  fmtDate: (ts: number) => string;
  onRespond: () => void;
  onReopen: () => void;
  pending: boolean;
}) {
  const cardCls = `rounded-xl border p-3 ${STATUS_CARD_CLASSES[entry.status]}`;
  // Collapse "extra" detail (portfolio, message, sent-email body, admin
  // notes) behind a single `<details>` so the resting card is a tight
  // header + meta row + action button. The admin opens detail only when
  // triaging — most rows in "Elfogadva" / "Elutasítva" don't need it
  // expanded by default.
  const hasDetail =
    entry.portfolio_links.length > 0 ||
    !!entry.message ||
    !!entry.sent_subject ||
    !!entry.notes ||
    !!entry.instagram_handle ||
    !!entry.website;
  return (
    <article className={cardCls}>
      {/* Header row: name + meta on the left, status + action button on
       *  the right. Everything stays on one line at desktop widths and
       *  flows to two on narrow viewports. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 className="m-0 text-base font-medium text-ink-900 dark:text-paper-50">
              {entry.business_name}
            </h2>
            <a
              href={`mailto:${entry.email}`}
              className="inline-flex items-center gap-1 text-xs text-ink-700 hover:text-ink-900 dark:text-paper-100 dark:hover:text-paper-50"
            >
              <Mail size={11} aria-hidden /> {entry.email}
            </a>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-600 dark:text-umber-200">
            <span>{fmtDate(entry.created_at)}</span>
            <span className="rounded-full bg-white/60 dark:bg-umber-900/40 px-1.5 py-0.5">
              {t(`suppliers.cat.${entry.category}`)}
            </span>
            {entry.location && <span className="truncate">{entry.location}</span>}
            {entry.outcome_at && (
              <span>
                {t("admin.waitlist_card_decided")}: {fmtDate(entry.outcome_at)}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill status={entry.status} label={t(STATUS_KEY[entry.status])} />
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
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onReopen}
                disabled={pending}
              >
                <RotateCcw size={14} aria-hidden /> {t("admin.waitlist_action_reopen")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRespond}
                disabled={pending}
              >
                <MessageSquare size={14} aria-hidden /> {t("admin.waitlist_action_respond")}
              </Button>
            </>
          )}
        </div>
      </div>

      {hasDetail && (
        <details className="mt-2 text-xs text-ink-700 dark:text-paper-100">
          <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-ink-500 dark:text-umber-300">
            {t("admin.waitlist_card_more_label")}
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {entry.website && (
              <a
                href={entry.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1 truncate text-xs text-ink-700 hover:text-ink-900 dark:text-paper-100 dark:hover:text-paper-50"
              >
                <ExternalLink size={12} aria-hidden /> {entry.website}
              </a>
            )}
            {entry.instagram_handle && (
              <a
                href={`https://instagram.com/${entry.instagram_handle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-ink-700 hover:text-ink-900 dark:text-paper-100 dark:hover:text-paper-50"
              >
                <AtSign size={12} aria-hidden /> {entry.instagram_handle}
              </a>
            )}
            {entry.portfolio_links.length > 0 && (
              <div className="rounded-md bg-white/60 dark:bg-umber-900/40 p-2">
                <p className="text-[11px] font-medium text-ink-800 dark:text-paper-50">
                  {t("admin.waitlist_card_portfolio_label")}
                </p>
                <ul className="mt-1 grid gap-0.5">
                  {entry.portfolio_links.map((url) => (
                    <li key={url}>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex max-w-full items-center gap-1 truncate text-xs text-ink-700 hover:text-ink-900 dark:text-paper-100 dark:hover:text-paper-50"
                      >
                        <Link2 size={12} aria-hidden className="shrink-0" />
                        <span className="truncate">{url}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {entry.message && (
              <p className="rounded-md bg-white/60 dark:bg-umber-900/40 p-2 text-sm italic text-ink-700 dark:text-paper-100">
                <span className="not-italic font-medium text-ink-800 dark:text-paper-50">
                  {t("admin.waitlist_card_message_label")}:{" "}
                </span>
                {entry.message}
              </p>
            )}
            {entry.sent_subject && (
              <details className="text-xs text-ink-700 dark:text-paper-100">
                <summary className="cursor-pointer font-medium text-ink-800 dark:text-paper-50">
                  {t("admin.waitlist_card_sent_label")}: {entry.sent_subject}
                </summary>
                <pre className="mt-1 whitespace-pre-wrap rounded-md bg-white/60 dark:bg-umber-900/40 p-2 font-sans text-xs leading-relaxed">
                  {entry.sent_body ?? ""}
                </pre>
              </details>
            )}
            {entry.notes && (
              <p className="rounded-md border border-dashed border-ink-300 bg-white/40 dark:border-umber-700 dark:bg-umber-900/30 p-2 text-xs text-ink-700 dark:text-paper-100">
                <span className="font-medium text-ink-800 dark:text-paper-50">
                  {t("admin.waitlist_card_notes_label")}:{" "}
                </span>
                {entry.notes}
              </p>
            )}
          </div>
        </details>
      )}
    </article>
  );
}

function StatusPill({ status, label }: { status: VendorWaitlistStatus; label: string }) {
  const cls = STATUS_PILL_CLASSES[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {label}
    </span>
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
    if (next === outcome) return;
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
          <Button type="button" variant="primary" onClick={submit} disabled={submitting}>
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
              tint="bg-sage-50 border-sage-300 text-sage-800 dark:bg-sage-400/15 dark:border-sage-400/40 dark:text-sage-300"
              activeTint="bg-sage-500 border-sage-600 text-white dark:bg-sage-400 dark:border-sage-400 dark:text-umber-900"
            />
            <OutcomeButton
              outcome="under_review"
              current={outcome}
              label={t("admin.waitlist_modal_outcome_under_review")}
              onPick={pickOutcome}
              tint="bg-violet-50 border-violet-300 text-violet-950 dark:bg-violet-500/15 dark:border-violet-400/40 dark:text-violet-200"
              activeTint="bg-violet-900 border-violet-900 text-white dark:bg-violet-500/40 dark:border-violet-400/60 dark:text-violet-100"
            />
            <OutcomeButton
              outcome="rejected"
              current={outcome}
              label={t("admin.waitlist_modal_outcome_rejected")}
              onPick={pickOutcome}
              tint="bg-paper-100 border-paper-300 text-ink-700 dark:bg-umber-700/60 dark:border-umber-700 dark:text-paper-100"
              activeTint="bg-ink-800 border-ink-800 text-paper-100 dark:bg-paper-50 dark:border-paper-50 dark:text-umber-900"
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

function OutcomeButton({
  outcome,
  current,
  label,
  onPick,
  tint,
  activeTint,
}: {
  outcome: VendorWaitlistOutcome;
  current: VendorWaitlistOutcome;
  label: string;
  onPick: (o: VendorWaitlistOutcome) => void;
  tint: string;
  activeTint: string;
}) {
  const active = outcome === current;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={() => onPick(outcome)}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        active ? activeTint : tint
      }`}
    >
      {label}
    </button>
  );
}
