// Admin planner management (KEZELÉS → Szervezők). A planner is a users row with
// user_type='planner'; this lists every planner with plan tier + active-client
// count and lets an admin change plan tier, suspend/reactivate, and delete.
// The header action pre-registers a planner (email + name + business name +
// category): the account is provisioned dormant with a 2-year free comp and
// the planner activates it through an emailed link.

import type {
  AdminPlannerAccount,
  AdminPlannerPending,
  AdminPlannerView,
  AdminPlannerWaitlistDetail,
  PlannerInviteRow,
  PlannerPlan,
} from "@shared/types";
import { intlLocale } from "../lib/format";
import {
  Ban,
  BadgeCheck,
  Check,
  ChevronDown,
  Clock,
  Eye,
  Handshake,
  Loader2,
  Mail,
  MailPlus,
  MousePointerClick,
  RotateCcw,
  Send,
  Trash2,
  UserPlus,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AdminEmptyState, AdminPageHeader, Pill, StatFilter } from "../components/admin";
import type { PillTone } from "../components/admin";
import { Button, Dialog, TextField, useConfirm, useEntryPrompt, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminPlannerMgmtApi } from "../lib/endpoints";
import { type Locale, useT } from "../lib/i18n";

type Filter = "all" | "active" | "pending" | "suspended";

/** Glyph per filter bucket for the stat-filter tiles. */
const PLANNER_FILTER_ICON: Record<Filter, ReactNode> = {
  all: <Handshake size={16} />,
  active: <BadgeCheck size={16} />,
  pending: <UserPlus size={16} />,
  suspended: <Ban size={16} />,
};

/** Which filter bucket a row falls into. Pending (accepted waitlist, no
 *  account) is its own bucket; accounts split by suspension. */
function plannerBucket(p: AdminPlannerView): "pending" | "suspended" | "active" {
  if (p.state === "pending") return "pending";
  return p.status === "suspended" ? "suspended" : "active";
}

/** True when there's at least one field worth showing in the collapsible
 *  detail section (company/location/waitlist profile). */
function hasPlannerDetails(
  company: string | null,
  location: string | null,
  w: AdminPlannerWaitlistDetail | null,
): boolean {
  return Boolean(
    company ||
      location ||
      (w &&
        (w.city ||
          w.weddings_per_year != null ||
          w.wedding_styles.length > 0 ||
          w.other_style ||
          w.website ||
          w.reference_links ||
          w.early_bird ||
          w.message)),
  );
}

/** The rich profile rows shown inside the collapsible section, shared by the
 *  active-account and pending cards. Mirrors the waitlist card's detail block
 *  but reads its labels from i18n. */
function PlannerDetailRows({
  company,
  category,
  location,
  waitlist,
}: {
  company: string | null;
  category: string | null;
  location: string | null;
  waitlist: AdminPlannerWaitlistDetail | null;
}) {
  const { t } = useT();
  const loc = location || waitlist?.city || null;
  const km = waitlist?.km_radius ?? null;
  const styles = waitlist?.wedding_styles ?? [];
  const website = waitlist?.website ?? null;
  const labelC = "font-medium text-umber-900 dark:text-paper-100";
  return (
    <div className="grid gap-y-1 text-sm text-umber-700 dark:text-umber-300">
      {company && (
        <p>
          <span className={labelC}>{t("admin.planners.field_company")}:</span> {company}
          {category ? ` (${category})` : ""}
        </p>
      )}
      {loc && (
        <p>
          <span className={labelC}>{t("admin.planners.field_location")}:</span> {loc}
          {km !== null ? ` · ${km} km` : ""}
        </p>
      )}
      {waitlist?.weddings_per_year != null && (
        <p>
          <span className={labelC}>{t("admin.planners.field_weddings")}:</span>{" "}
          {waitlist.weddings_per_year}
        </p>
      )}
      {(styles.length > 0 || waitlist?.other_style) && (
        <p>
          <span className={labelC}>{t("admin.planners.field_styles")}:</span> {styles.join(", ")}
          {waitlist?.other_style ? `${styles.length ? " " : ""}(${waitlist.other_style})` : ""}
        </p>
      )}
      {website && (
        <p>
          <span className={labelC}>{t("admin.planners.field_web")}:</span>{" "}
          <a
            href={website.startsWith("http") ? website : `https://${website}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-umber-900 dark:hover:text-paper-50"
          >
            {website}
          </a>
        </p>
      )}
      {waitlist?.reference_links && (
        <p>
          <span className={labelC}>{t("admin.planners.field_references")}:</span>{" "}
          {waitlist.reference_links}
        </p>
      )}
      {waitlist?.early_bird && (
        <p className="text-xs font-medium text-sage-700 dark:text-sage-400">
          {t("admin.planners.early_tester")}
        </p>
      )}
      {waitlist?.message && (
        <p className="mt-1 whitespace-pre-wrap rounded-md bg-paper-100 p-2 text-xs dark:bg-umber-800">
          {waitlist.message}
        </p>
      )}
    </div>
  );
}

// Shared round icon button for the account row's right-hand action cluster
// (suspend/reactivate, resend, delete, and the details disclosure).
const ICON_BTN =
  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-paper-300 bg-paper-50 text-umber-700 transition hover:border-umber-400 hover:text-umber-900 disabled:opacity-50 dark:border-umber-700 dark:bg-umber-900 dark:text-umber-200 dark:hover:text-paper-50";

/** Chevron disclosure that lives in the row's right-hand cluster (or the right
 *  corner of a pending row) so a collapsed row stays a single line — the old
 *  full-width "Részletek" footer took a row of its own. Reveals the profile
 *  block rendered directly below the row. */
function DetailsToggle({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={label}
      title={label}
      className={ICON_BTN}
    >
      <ChevronDown size={16} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
    </button>
  );
}

const PLANS: PlannerPlan[] = ["starter", "pro", "premium"];

// Uber-style tier chip: each tier gets a distinct fill so the plan reads at a
// glance across a dense list. Clicking opens a picker with all three tiers.
const PLAN_STYLE: Record<PlannerPlan, string> = {
  starter: "bg-paper-200 text-neutral-700 dark:bg-umber-800 dark:text-umber-200",
  pro: "bg-neutral-900 text-paper-50 dark:bg-paper-100 dark:text-umber-900",
  premium: "bg-sage-600 text-paper-50 dark:bg-sage-500 dark:text-umber-900",
};

function initials(name: string, email: string): string {
  const src = (name || email).trim();
  const parts = src.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? src[0] ?? "?";
  const second = parts.length > 1 ? (parts[1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}

function fmtDate(unixMs: number, locale: Locale): string {
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

/** "Szervező regisztrálása" modal: email + name + business name + category.
 *  Submit provisions the dormant account (2-year comp) and fires the
 *  activation email; the list refreshes with the new "pending" row. */
function ProvisionPlannerDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh form every open; a half-typed planner from a cancelled attempt
  // must not leak into the next one.
  useEffect(() => {
    if (!open) return;
    setEmail("");
    setFullName("");
    setBusinessName("");
    setCategory("");
    setError(null);
  }, [open]);

  const canSubmit =
    email.includes("@") &&
    fullName.trim().length > 0 &&
    businessName.trim().length > 0 &&
    category.trim().length > 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await adminPlannerMgmtApi.provision({
        email: email.trim(),
        full_name: fullName.trim(),
        business_name: businessName.trim(),
        category: category.trim(),
      });
      toast.success(t("admin.planners.provision_success"));
      onCreated();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(t("admin.planners.provision_email_taken"));
      } else {
        setError(err instanceof ApiError ? err.message : t("common.error_generic"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      title={t("admin.planners.provision_title")}
      onClose={onClose}
      role="dialog"
      closeOnBackdrop
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form="provision-planner-form"
            variant="primary"
            disabled={!canSubmit}
            loading={submitting}
            loadingLabel={t("common.loading")}
            leftIcon={<MailPlus size={15} />}
          >
            {t("admin.planners.provision_submit")}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-ink-600 dark:text-umber-300">
        {t("admin.planners.provision_intro")}
      </p>
      <form id="provision-planner-form" className="space-y-4" onSubmit={onSubmit}>
        <TextField
          id="provision-email"
          type="email"
          label={t("admin.planners.provision_email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="off"
        />
        <TextField
          id="provision-name"
          label={t("admin.planners.provision_name")}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          autoComplete="off"
        />
        <TextField
          id="provision-business"
          label={t("admin.planners.provision_business")}
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          required
          autoComplete="off"
        />
        <TextField
          id="provision-category"
          label={t("admin.planners.provision_category")}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder={t("admin.planners.provision_category_placeholder")}
          required
          autoComplete="off"
        />
        {error && <p className="field-error">{error}</p>}
      </form>
    </Dialog>
  );
}

/** Status → pill tone for one row of an invite batch. */
const INVITE_STATUS_TONE: Record<PlannerInviteRow["status"], PillTone> = {
  ready: "paper",
  sent: "sage",
  existing: "muted",
  opted_out: "muted",
  failed: "blush",
};

/** "Ajánlott szervezők meghívása": paste the list somebody handed us, preview
 *  what the parser made of it, then provision a dormant account per row and
 *  mail the take-over invite. Preview first is the whole point, cold mail has
 *  no undo, so the admin sees every parsed name and address before anything
 *  leaves the building. */
function InvitePlannersDialog({
  open,
  onClose,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [text, setText] = useState("");
  const [locale, setLocale] = useState<"auto" | "hu" | "en">("auto");
  const [rows, setRows] = useState<PlannerInviteRow[] | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setText("");
    setLocale("auto");
    setRows(null);
    setSent(false);
    setError(null);
  }, [open]);

  // Any edit invalidates the preview: sending rows the admin never saw is
  // exactly the mistake the preview step exists to prevent.
  function editText(next: string) {
    setText(next);
    setRows(null);
    setSent(false);
  }

  async function run(dryRun: boolean) {
    if (busy || text.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminPlannerMgmtApi.inviteBatch({
        text,
        dry_run: dryRun,
        ...(locale === "auto" ? {} : { locale }),
      });
      setRows(res.rows);
      if (!dryRun) {
        setSent(true);
        const count = res.rows.filter((r) => r.status === "sent").length;
        toast.success(t("admin.planners.invite_batch_done", { sent: count }));
        onSent();
      } else if (res.rows.length === 0) {
        setError(t("admin.planners.invite_batch_empty"));
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  const previewed = rows !== null && rows.length > 0;
  const sendable = previewed && !sent && rows.some((r) => r.status === "ready");

  return (
    <Dialog
      open={open}
      title={t("admin.planners.invite_batch_title")}
      onClose={onClose}
      role="dialog"
      closeOnBackdrop
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {sent ? t("common.done") : t("common.cancel")}
          </Button>
          {!sent && (
            <Button
              variant={sendable ? "primary" : "outline"}
              onClick={() => void run(!previewed)}
              disabled={text.trim().length === 0}
              loading={busy}
              loadingLabel={t("common.loading")}
              leftIcon={sendable ? <Send size={15} /> : <Eye size={15} />}
            >
              {sendable
                ? t("admin.planners.invite_batch_send")
                : t("admin.planners.invite_batch_preview")}
            </Button>
          )}
        </>
      }
    >
      <p className="mb-4 text-sm text-ink-600 dark:text-umber-300">
        {t("admin.planners.invite_batch_intro")}
      </p>
      <textarea
        value={text}
        onChange={(e) => editText(e.target.value)}
        placeholder={t("admin.planners.invite_batch_placeholder")}
        rows={8}
        className="input w-full font-mono text-xs"
        aria-label={t("admin.planners.invite_batch_title")}
      />
      <label className="mt-3 block text-sm">
        <span className="mb-1 block text-ink-600 dark:text-umber-300">
          {t("admin.planners.invite_batch_locale")}
        </span>
        <select
          value={locale}
          onChange={(e) => {
            setLocale(e.target.value as "auto" | "hu" | "en");
            setRows(null);
          }}
          className="input w-full"
        >
          <option value="auto">{t("admin.planners.invite_batch_locale_auto")}</option>
          <option value="hu">Magyar</option>
          <option value="en">English</option>
        </select>
      </label>

      {error && <p className="field-error mt-3">{error}</p>}

      {previewed && (
        <div className="mt-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-ink-500 dark:text-umber-400">
            {t("admin.planners.invite_batch_parsed", { count: rows.length })}
          </p>
          <div className="overflow-x-auto rounded-xl ring-1 ring-ink-100 dark:ring-umber-700">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-500 dark:text-umber-400">
                <tr>
                  <th className="px-3 py-2">{t("admin.planners.invite_batch_col_name")}</th>
                  <th className="px-3 py-2">{t("admin.planners.invite_batch_col_email")}</th>
                  <th className="px-3 py-2">{t("admin.planners.invite_batch_col_phone")}</th>
                  <th className="px-3 py-2">{t("admin.planners.invite_batch_col_status")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.email} className="border-t border-ink-100 dark:border-umber-700">
                    <td className="px-3 py-2">
                      {r.full_name}
                      {r.business_name !== r.full_name && (
                        <span className="block text-xs text-ink-500 dark:text-umber-400">
                          {r.business_name}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.email}
                      <span className="ml-1 uppercase text-ink-400 dark:text-umber-500">
                        {r.locale}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">{r.phone ?? ""}</td>
                    <td className="px-3 py-2">
                      <Pill tone={INVITE_STATUS_TONE[r.status]}>
                        {t(`admin.planners.invite_batch_status_${r.status}`)}
                      </Pill>
                      {r.error && (
                        <span className="block text-xs text-blush-700 dark:text-blush-300">
                          {r.error}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** An accepted waitlist applicant with no planner account yet. The one action
 *  is "Approve & open account": provision a dormant planner + email an
 *  activation link into a pre-filled onboarding, or (if they already registered
 *  under this email as a non-planner) convert + seed that account and email a
 *  sign-in link. Either way the list refreshes them into an Aktív account. */
function PendingPlannerCard({
  entry,
  onChanged,
}: {
  entry: AdminPlannerPending;
  onChanged: () => void;
}) {
  const { t, locale } = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasDetails = hasPlannerDetails(
    entry.waitlist.company_name,
    entry.waitlist.city,
    entry.waitlist,
  );

  async function handleSendInvite() {
    setBusy(true);
    try {
      const r = await adminPlannerMgmtApi.sendInvite(entry.waitlist_id);
      toast.success(
        t(
          r.provisioned
            ? "admin.planners.invite_activation_sent"
            : r.converted
              ? "admin.planners.invite_granted_success"
              : "admin.planners.invite_sent_success",
        ),
      );
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-card">
      <div className="flex items-center gap-4">
        <div
          aria-hidden="true"
          className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-paper-200 text-sm font-semibold text-umber-700 sm:flex dark:bg-umber-800 dark:text-umber-200"
        >
          {initials(entry.full_name, entry.email)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold text-umber-900 dark:text-paper-50">
              {entry.full_name || entry.email}
            </p>
            <Pill tone="blush" icon={<Clock size={11} />}>
              {t("admin.planners.status_applied")}
            </Pill>
          </div>
          <p className="truncate text-sm text-umber-700 dark:text-umber-300">{entry.email}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-umber-500 dark:text-umber-400">
            {entry.phone && (
              <>
                <span>{entry.phone}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span>{fmtDate(entry.created_at, locale)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className={ICON_BTN}
            onClick={handleSendInvite}
            disabled={busy}
            title={t("admin.planners.approve_open")}
            aria-label={t("admin.planners.approve_open")}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
          {hasDetails && (
            <DetailsToggle
              open={detailsOpen}
              onToggle={() => setDetailsOpen((o) => !o)}
              label={t("admin.planners.details_toggle")}
            />
          )}
        </div>
      </div>
      {hasDetails && detailsOpen && (
        <div className="mt-3 border-t border-paper-200 pt-3 dark:border-umber-800">
          <PlannerDetailRows
            company={entry.waitlist.company_name}
            category={null}
            location={entry.waitlist.city}
            waitlist={entry.waitlist}
          />
        </div>
      )}
    </div>
  );
}

function PlannerCard({
  planner,
  onChanged,
}: {
  planner: AdminPlannerAccount;
  onChanged: () => void;
}) {
  const { t, locale } = useT();
  const confirm = useConfirm();
  const promptEntry = useEntryPrompt();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [planMenuOpen, setPlanMenuOpen] = useState(false);
  const planMenuRef = useRef<HTMLDivElement>(null);
  const suspended = planner.status === "suspended";
  const hasDetails = hasPlannerDetails(
    planner.business_name ?? planner.waitlist?.company_name ?? null,
    planner.planner_city,
    planner.waitlist,
  );

  const statusPill: { tone: PillTone; Icon: typeof Handshake; label: string } = suspended
    ? { tone: "muted", Icon: Ban, label: t("admin.planners.status_suspended") }
    : planner.pending_activation
      ? { tone: "blush", Icon: Send, label: t("admin.planners.status_pending_activation") }
      : { tone: "sage", Icon: Check, label: t("admin.planners.status_active") };

  async function run(fn: () => Promise<unknown>, successKey: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(t(successKey));
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function handleSuspend() {
    const ok = await confirm({
      title: t("admin.planners.suspend_confirm_title"),
      body: planner.email,
      confirmLabel: t("admin.planners.suspend"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    void run(() => adminPlannerMgmtApi.suspend(planner.user_id), "admin.planners.suspend_success");
  }

  // Lifting a suspension confirms too, same as suspending. See the note on the
  // vendor page: the undo sat one icon away and fired on a single click.
  async function handleReactivate() {
    const ok = await confirm({
      title: t("admin.planners.reactivate_confirm_title"),
      body: planner.email,
      confirmLabel: t("admin.planners.reactivate"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    void run(
      () => adminPlannerMgmtApi.reactivate(planner.user_id),
      "admin.planners.reactivate_success",
    );
  }

  function handleToggleVerified() {
    void run(
      () =>
        planner.verified
          ? adminPlannerMgmtApi.unverify(planner.user_id)
          : adminPlannerMgmtApi.verify(planner.user_id),
      planner.verified ? "admin.planners.unverify_success" : "admin.planners.verify_success",
    );
  }

  async function handleDelete() {
    const phrase = t("admin.planners.delete_confirm_phrase");
    const entered = await promptEntry({
      title: `${t("admin.planners.delete_confirm_title")}: ${planner.email}`,
      label: t("admin.planners.delete_confirm_label"),
      placeholder: phrase,
      helperText: t("admin.planners.delete_confirm_help"),
      confirmLabel: t("admin.planners.delete"),
      cancelLabel: t("common.cancel"),
      validate: (v) =>
        v.trim().toLowerCase() === phrase.toLowerCase()
          ? null
          : t("admin.planners.delete_confirm_mismatch"),
    });
    if (entered === null) return;
    void run(() => adminPlannerMgmtApi.remove(planner.user_id), "admin.planners.delete_success");
  }

  function handleResendActivation() {
    void run(
      () => adminPlannerMgmtApi.resendActivation(planner.user_id),
      "admin.planners.resend_success",
    );
  }

  function handleRemindProfile() {
    void run(
      () => adminPlannerMgmtApi.remindProfile(planner.user_id),
      "admin.planners.remind_success",
    );
  }

  // Directory-blocking incompleteness: no business name or no city → the card
  // can't be listed to couples. Mirrors the auto-nudge sweep's trigger.
  const profileIncomplete = !planner.business_name?.trim() || !(planner.planner_city ?? "").trim();

  function selectPlan(plan: PlannerPlan) {
    setPlanMenuOpen(false);
    if (plan === planner.planner_plan) return;
    void run(
      () => adminPlannerMgmtApi.setPlan(planner.user_id, plan),
      "admin.planners.plan_success",
    );
  }

  // Close the plan picker on any outside click or Escape.
  useEffect(() => {
    if (!planMenuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (!planMenuRef.current?.contains(e.target as Node)) setPlanMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPlanMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [planMenuOpen]);

  return (
    <div className="admin-card">
      <div className="flex items-center gap-4">
        {/* Identity */}
        <div
          aria-hidden="true"
          className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-sm font-semibold text-paper-50 sm:flex dark:bg-paper-100 dark:text-umber-900"
        >
          {initials(planner.full_name, planner.email)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold text-umber-900 dark:text-paper-50">
              {planner.full_name || planner.email}
            </p>
            <Pill tone={statusPill.tone} icon={<statusPill.Icon size={11} />}>
              {statusPill.label}
            </Pill>
            {planner.verified && (
              <Pill tone="verified" icon={<BadgeCheck size={11} />}>
                {t("admin.planners.verified")}
              </Pill>
            )}
          </div>
          <p className="truncate text-sm text-umber-700 dark:text-umber-300">{planner.email}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-umber-500 dark:text-umber-400">
            <span>
              {t("admin.planners.clients", {
                n: planner.client_count,
                max: planner.planner_max_clients,
              })}
            </span>
            <span aria-hidden="true">·</span>
            <span>{fmtDate(planner.created_at, locale)}</span>
            {planner.analytics && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className="inline-flex items-center gap-1"
                  title={t("admin.planners.reach_tooltip", {
                    views: planner.analytics.views_total,
                    clicks: planner.analytics.clicks_total,
                    connect: planner.analytics.connect_clicks_total,
                  })}
                >
                  <Eye size={12} aria-hidden />
                  <span className="tabular-nums">{planner.analytics.views_total}</span>
                  <MousePointerClick size={12} aria-hidden className="ml-1.5" />
                  <span className="tabular-nums">{planner.analytics.clicks_total}</span>
                  <span className="sr-only">{t("admin.planners.reach_label")}</span>
                </span>
              </>
            )}
            {planner.founding_until && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {t("admin.planners.free_until", {
                    date: fmtDate(planner.founding_until, locale),
                  })}
                </span>
              </>
            )}
            {!planner.planner_onboarding_done && !planner.pending_activation && (
              <>
                <span aria-hidden="true">·</span>
                <span>{t("admin.planners.onboarding_pending")}</span>
              </>
            )}
          </div>
        </div>

        {/* Plan + actions */}
        <div className="flex shrink-0 items-center gap-2">
          <div className="relative" ref={planMenuRef}>
            <button
              type="button"
              onClick={() => !busy && setPlanMenuOpen((v) => !v)}
              disabled={busy}
              aria-haspopup="menu"
              aria-expanded={planMenuOpen}
              title={t("admin.planners.plan_change_hint")}
              aria-label={`${t("admin.planners.plan")}: ${t(`admin.planners.plan_${planner.planner_plan}`)}. ${t("admin.planners.plan_change_hint")}`}
              className={`inline-flex min-w-[76px] select-none items-center justify-center rounded-full px-3.5 py-1.5 text-xs font-semibold tracking-wide transition active:scale-95 disabled:opacity-60 ${PLAN_STYLE[planner.planner_plan]}`}
            >
              {busy ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                t(`admin.planners.plan_${planner.planner_plan}`)
              )}
            </button>
            {planMenuOpen && (
              <div
                role="menu"
                aria-label={t("admin.planners.plan_change_hint")}
                className="absolute right-0 top-full z-40 mt-2 w-44 overflow-hidden rounded-2xl border border-paper-300 bg-paper-50 p-1 shadow-pop dark:border-umber-700 dark:bg-umber-800"
              >
                {PLANS.map((p) => {
                  const active = p === planner.planner_plan;
                  return (
                    <button
                      key={p}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => selectPlan(p)}
                      className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-paper-100 dark:hover:bg-umber-700"
                    >
                      <span
                        className={`inline-flex min-w-[64px] items-center justify-center rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide ${PLAN_STYLE[p]}`}
                      >
                        {t(`admin.planners.plan_${p}`)}
                      </span>
                      {active && (
                        <Check
                          size={15}
                          className="ml-auto shrink-0 text-sage-600 dark:text-sage-400"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {planner.pending_activation && (
            <button
              type="button"
              className={ICON_BTN}
              onClick={handleResendActivation}
              disabled={busy}
              title={t("admin.planners.resend_activation")}
              aria-label={t("admin.planners.resend_activation")}
            >
              <Send size={15} />
            </button>
          )}
          {profileIncomplete && !suspended && !planner.pending_activation && (
            <button
              type="button"
              className={`${ICON_BTN} border-blush-300 text-blush-600 hover:border-blush-500 hover:text-blush-700 dark:border-blush-500/40 dark:text-blush-300`}
              onClick={handleRemindProfile}
              disabled={busy}
              title={t("admin.planners.remind")}
              aria-label={t("admin.planners.remind")}
            >
              <Mail size={15} />
            </button>
          )}
          <button
            type="button"
            className={
              planner.verified
                ? `${ICON_BTN} border-verified/40 text-verified hover:border-verified hover:text-verified`
                : ICON_BTN
            }
            onClick={handleToggleVerified}
            disabled={busy}
            aria-pressed={planner.verified}
            title={planner.verified ? t("admin.planners.unverify") : t("admin.planners.verify")}
            aria-label={
              planner.verified ? t("admin.planners.unverify") : t("admin.planners.verify")
            }
          >
            <BadgeCheck
              size={15}
              className={planner.verified ? "fill-verified stroke-white" : ""}
            />
          </button>
          {suspended ? (
            <button
              type="button"
              className={ICON_BTN}
              onClick={handleReactivate}
              disabled={busy}
              aria-label={t("admin.planners.reactivate")}
            >
              <RotateCcw size={15} />
            </button>
          ) : (
            <button
              type="button"
              className={ICON_BTN}
              onClick={handleSuspend}
              disabled={busy}
              aria-label={t("admin.planners.suspend")}
            >
              <Ban size={15} />
            </button>
          )}
          <button
            type="button"
            className={ICON_BTN}
            onClick={handleDelete}
            disabled={busy}
            aria-label={t("admin.planners.delete")}
          >
            <Trash2 size={15} />
          </button>
          {hasDetails && (
            <DetailsToggle
              open={detailsOpen}
              onToggle={() => setDetailsOpen((o) => !o)}
              label={t("admin.planners.details_toggle")}
            />
          )}
        </div>
      </div>

      {hasDetails && detailsOpen && (
        <div className="mt-3 border-t border-paper-200 pt-3 dark:border-umber-800">
          <PlannerDetailRows
            company={planner.business_name ?? planner.waitlist?.company_name ?? null}
            category={planner.planner_category}
            location={planner.planner_city}
            waitlist={planner.waitlist}
          />
        </div>
      )}
    </div>
  );
}

export default function AdminPlannersPage() {
  const { t } = useT();
  const toast = useToast();
  const [planners, setPlanners] = useState<AdminPlannerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await adminPlannerMgmtApi.list();
      setPlanners(r.planners);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    const c = { all: planners.length, active: 0, pending: 0, suspended: 0 };
    for (const p of planners) c[plannerBucket(p)]++;
    return c;
  }, [planners]);

  const visible = filter === "all" ? planners : planners.filter((p) => plannerBucket(p) === filter);

  const FILTERS: Filter[] = ["all", "active", "pending", "suspended"];

  return (
    <>
      <AdminPageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Handshake size={20} /> {t("admin.nav_planners")}
          </span>
        }
        subtitle={t("admin.planners.subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<MailPlus size={15} />}
              onClick={() => setInviteOpen(true)}
            >
              {t("admin.planners.invite_batch_cta")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<UserPlus size={15} />}
              onClick={() => setProvisionOpen(true)}
            >
              {t("admin.planners.provision_cta")}
            </Button>
          </div>
        }
      />

      <ProvisionPlannerDialog
        open={provisionOpen}
        onClose={() => setProvisionOpen(false)}
        onCreated={() => void load()}
      />

      <InvitePlannersDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSent={() => void load()}
      />

      <StatFilter
        ariaLabel={t("admin.nav_planners")}
        onSelect={(k) => setFilter(k as Filter)}
        segments={FILTERS.map((f) => ({
          key: f,
          label: t(`admin.planners.filter_${f}`),
          count: counts[f],
          icon: PLANNER_FILTER_ICON[f],
          active: filter === f,
        }))}
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-umber-500">
          <Loader2 size={14} className="animate-spin" />
          {t("common.loading")}
        </div>
      ) : visible.length === 0 ? (
        <AdminEmptyState>{t("admin.planners.empty")}</AdminEmptyState>
      ) : (
        <div className="space-y-4">
          {visible.map((p) =>
            p.state === "pending" ? (
              <PendingPlannerCard key={`w-${p.waitlist_id}`} entry={p} onChanged={load} />
            ) : (
              <PlannerCard key={`u-${p.user_id}`} planner={p} onChanged={load} />
            ),
          )}
        </div>
      )}
    </>
  );
}
