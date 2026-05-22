// Profile: workspace ops only — payments placeholder, security, export,
// saved download archive, delete account.

import type {
  BudgetLine,
  Couple,
  CoupleActivityEntry,
  CouplePartnerStatus,
  CouplePartnerView,
  CouplePauseRequest,
  CoupleStatus,
  Currency,
  DataExportSummary,
  ExportKind,
} from "@shared/types";
import { CURRENCIES } from "@shared/types";
import {
  Archive,
  ChevronDown,
  Database,
  Download,
  Heart,
  History,
  LogOut,
  ShieldCheck,
  Sliders,
  Tablet,
  Trash2,
  User as UserIcon,
  Users as UsersIcon,
  Wallet,
} from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { useConfirm, useEntryPrompt, useToast } from "../components/ui";
import { WorkspacesPanel } from "../components/WorkspacesPanel";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { type Density, useDensity } from "../lib/density";
import {
  authApi,
  budgetApi,
  coupleApi,
  documentsApi,
  exportApi,
  fetchGuestCsvBlob,
  fetchSavedExportBlob,
  pauseApi,
  userApi,
} from "../lib/endpoints";
import {
  currencySymbol,
  formatBudgetGoal,
  formatDate,
  formatHuf,
  formatHufRange,
  formatMoney,
  formatYearMonth,
} from "../lib/format";
import { type Locale, useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

function deleteVerifyPhrase(couple: Couple | null): string {
  if (!couple) return "";
  return `${couple.bride_name}${couple.groom_name}`.replace(/\s+/g, "").toUpperCase();
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(ms: number, locale: Locale): string {
  const d = new Date(ms);
  // Build the date portion from LOCAL fields, not from the UTC ISO string.
  // The old `d.toISOString().slice(0, 10)` mixed UTC date with local time —
  // a 00:30 CET event (= 23:30 UTC prev day) rendered as "yesterday 00:30"
  // because the date came from UTC and the time from local. Now both sides
  // agree.
  const yyyy = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const dateStr = formatDate(`${yyyy}-${mo}-${dd}`, locale);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${dateStr} ${hh}:${mm}`;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ProfilePage() {
  const { t, locale } = useT();
  const [density, setDensity] = useDensity();
  useDocumentMeta("seo.profile_title", "seo.profile_description");
  const promptEntry = useEntryPrompt();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const { setSession, user: authUser, logout, refresh: refreshAuth } = useAuth();
  const { setLocale } = useT();
  const [leaving, setLeaving] = useState(false);
  const [couple, setCouple] = useState<Couple | null>(null);
  const [coupleStatus, setCoupleStatus] = useState<CoupleStatus>("active");
  const [pauseReq, setPauseReq] = useState<CouplePauseRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [csvExporting, setCsvExporting] = useState(false);
  const [documents, setDocuments] = useState<DataExportSummary[]>([]);
  const [redownloading, setRedownloading] = useState<number | null>(null);
  /** Two-click delete arming state — the id whose "Delete" button is armed
   *  and waiting for the second confirming click. Times out after 4s. */
  const [armedDeleteId, setArmedDeleteId] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [partner, setPartner] = useState<CouplePartnerView | null>(null);
  const [cancellingInvite, setCancellingInvite] = useState(false);
  /** Two-click confirmation for cancel-invite — invalidating the partner's
   *  link is irreversible, so a single accidental tap shouldn't fire it.
   *  Mirrors the archive-document delete pattern below (4s auto-disarm). */
  const [armedCancelInvite, setArmedCancelInvite] = useState(false);
  const [activity, setActivity] = useState<CoupleActivityEntry[]>([]);
  /** Live budget lines — used for the "already paid" running total tile on
   *  the Profile budget card. Source of truth is /api/budget/lines so the
   *  number always matches what /app/budget shows. */
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([]);
  /** Cap-edit state. `capInput` is the in-progress text — kept as a string so
   *  the user can clear the field without us coercing to NaN. */
  const [editingCap, setEditingCap] = useState(false);
  const [capInput, setCapInput] = useState("");
  const [savingCap, setSavingCap] = useState(false);
  const [capError, setCapError] = useState<string | null>(null);
  /** Refs on the Edit + Add-payment trigger buttons so cancel/save restores
   *  focus to the originator instead of dropping to <body>. Inline forms
   *  un-mount when toggled off, so without this an SR / keyboard user
   *  silently loses their place on the page. */
  const editCapTriggerRef = useRef<HTMLButtonElement | null>(null);
  const addPaymentTriggerRef = useRef<HTMLButtonElement | null>(null);
  /** Quick-payment state — drops a new budget_line in the "other" category
   *  with `planned_huf = actual_huf = amount` so the spend shows up on the
   *  budget page under "Egyéb" with the user-supplied label. */
  const [addingPayment, setAddingPayment] = useState(false);
  const [paymentLabel, setPaymentLabel] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSubmitting, setEmailSubmitting] = useState(false);

  async function refresh() {
    const [pause, current, docs, partnerRes, activityRes, lines] = await Promise.all([
      pauseApi.status(),
      coupleApi.current(),
      documentsApi.list(),
      coupleApi.partner(),
      coupleApi.activity(),
      budgetApi.listLines(),
    ]);
    setCoupleStatus(pause.couple_status);
    setPauseReq(pause.pause_request);
    setCouple(current.couple);
    setDocuments(docs.exports);
    setPartner(partnerRes.partner);
    setActivity(activityRes.entries);
    setBudgetLines(lines.lines);
  }
  async function refreshDocuments() {
    try {
      const docs = await documentsApi.list();
      setDocuments(docs.exports);
    } catch {
      /* non-fatal — will retry on next mount */
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function startPause() {
    const phrase = deleteVerifyPhrase(couple);
    if (!phrase) return;
    const entered = await promptEntry({
      title: t("profile.delete_account_confirm_title"),
      label: t("profile.delete_account_confirm_label", { phrase }),
      helperText: t("profile.delete_account_confirm_help"),
      placeholder: phrase,
      confirmLabel: t("profile.delete_account_confirm_yes"),
      cancelLabel: t("common.cancel"),
      validate: (v) =>
        v.toUpperCase() === phrase
          ? null
          : t("profile.delete_account_confirm_mismatch", { phrase }),
    });
    if (entered === null) return;
    try {
      await pauseApi.request();
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  async function cancelPendingInvite() {
    // First click arms the button; second click within 4s fires the cancel.
    // Auto-disarm is handled by the useEffect below.
    if (!armedCancelInvite) {
      setArmedCancelInvite(true);
      return;
    }
    setArmedCancelInvite(false);
    setCancellingInvite(true);
    try {
      await coupleApi.cancelInvite();
      // Optimistic: clear the partner card so the Dashboard's invite
      // widget re-appears on next nav. refresh() to also pick up any
      // server-side state changes.
      setPartner(null);
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setCancellingInvite(false);
    }
  }

  async function cancelPause() {
    try {
      await pauseApi.cancel();
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  async function downloadExport() {
    setExporting(true);
    try {
      const data = await exportApi.download();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const stamp = new Date().toISOString().slice(0, 10);
      saveBlob(blob, `weddly-export-${stamp}.json`);
      refreshDocuments();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setExporting(false);
    }
  }

  async function downloadGuestCsv() {
    setCsvExporting(true);
    try {
      const blob = await fetchGuestCsvBlob();
      const stamp = new Date().toISOString().slice(0, 10);
      saveBlob(blob, `weddly-guests-${stamp}.csv`);
      refreshDocuments();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setCsvExporting(false);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwError(null);
    if (pwNext.length < 8) {
      setPwError(t("profile.security_pw_too_short"));
      return;
    }
    if (pwNext !== pwConfirm) {
      setPwError(t("profile.security_pw_mismatch"));
      return;
    }
    setPwSubmitting(true);
    try {
      const session = await authApi.changePassword({
        current_password: pwCurrent,
        new_password: pwNext,
      });
      setSession(session.token, session.user);
      setPwCurrent("");
      setPwNext("");
      setPwConfirm("");
      toast.success(t("profile.security_pw_success"));
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setPwSubmitting(false);
    }
  }

  async function requestEmailChange(e: FormEvent) {
    e.preventDefault();
    setEmailError(null);
    const trimmed = newEmail.trim().toLowerCase();
    if (trimmed.length < 3 || !trimmed.includes("@") || trimmed.startsWith("@")) {
      setEmailError(t("profile.security_email_invalid"));
      return;
    }
    setEmailSubmitting(true);
    try {
      await authApi.changeEmailRequest({
        new_email: trimmed,
        current_password: emailPassword,
      });
      setNewEmail("");
      setEmailPassword("");
      toast.success(t("profile.security_email_sent"));
    } catch (err) {
      setEmailError(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setEmailSubmitting(false);
    }
  }

  async function redownloadSaved(doc: DataExportSummary) {
    setRedownloading(doc.id);
    try {
      const blob = await fetchSavedExportBlob(doc.id);
      saveBlob(blob, doc.filename);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setRedownloading(null);
    }
  }

  // Auto-disarm a pending delete after 4 seconds so the button can't sit in
  // a one-click-from-delete state indefinitely.
  useEffect(() => {
    if (armedDeleteId === null) return;
    const timer = window.setTimeout(() => setArmedDeleteId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [armedDeleteId]);

  // Focus restore — when the inline cap-edit / add-payment forms close, the
  // form unmounts and focus drops to <body>, stranding keyboard + SR users.
  // The prev-ref tracks the transition so the effect only fires on close.
  const editingCapPrev = useRef(false);
  useEffect(() => {
    if (editingCapPrev.current && !editingCap) editCapTriggerRef.current?.focus();
    editingCapPrev.current = editingCap;
  }, [editingCap]);
  const addingPaymentPrev = useRef(false);
  useEffect(() => {
    if (addingPaymentPrev.current && !addingPayment) addPaymentTriggerRef.current?.focus();
    addingPaymentPrev.current = addingPayment;
  }, [addingPayment]);

  // Same auto-disarm window for the cancel-invite button.
  useEffect(() => {
    if (!armedCancelInvite) return;
    const timer = window.setTimeout(() => setArmedCancelInvite(false), 4000);
    return () => window.clearTimeout(timer);
  }, [armedCancelInvite]);

  async function clickDelete(doc: DataExportSummary) {
    if (armedDeleteId !== doc.id) {
      setArmedDeleteId(doc.id);
      return;
    }
    setArmedDeleteId(null);
    setRemoving(doc.id);
    try {
      await documentsApi.remove(doc.id);
      setDocuments((cur) => cur.filter((d) => d.id !== doc.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setRemoving(null);
    }
  }

  const scheduledYmd = pauseReq?.scheduled_delete_at
    ? new Date(pauseReq.scheduled_delete_at).toISOString().slice(0, 10)
    : null;

  async function onLeaveCouple() {
    if (!authUser || !couple) return;
    // Only partner B can actually leave — partner A (owner) gets a blocked
    // explanation card so the path is honest about why it won't work.
    if (authUser.id === couple.partner_a_id) return;
    const ok = await confirm({
      title: t("profile.leave_couple_confirm_title"),
      body: t("profile.leave_couple_confirm_body"),
      confirmLabel: t("profile.leave_couple_confirm_yes"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setLeaving(true);
    try {
      await userApi.leaveCouple();
      toast.success(t("profile.leave_couple_done"));
      // Sign out + bounce to login. logout() clears the token; AppShell's
      // user-transition effect sweeps the rest of localStorage.
      await logout();
      navigate("/login", { replace: true });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("profile.leave_couple_failed"));
      setLeaving(false);
    }
  }

  /** Pre-fill the cap input with whatever the couple currently has so the
   *  user can tweak rather than re-type. Range / TBD collapse to exact on
   *  save — matches the Dashboard cap slider's behaviour. */
  function beginCapEdit() {
    if (!couple) return;
    const goal = couple.budget_goal;
    const start =
      goal.kind === "exact" && goal.exact_huf !== null
        ? String(goal.exact_huf)
        : goal.kind === "range" && goal.min_huf !== null
          ? String(goal.min_huf)
          : "";
    setCapInput(start);
    setCapError(null);
    setEditingCap(true);
  }

  async function saveCap(e: FormEvent) {
    e.preventDefault();
    if (!couple) return;
    const trimmed = capInput.trim();
    // Empty input = "I don't have a number yet" → flip back to TBD.
    if (trimmed === "") {
      setSavingCap(true);
      try {
        const r = await coupleApi.update({
          budget_goal: { kind: "tbd", exact_huf: null, min_huf: null, max_huf: null },
        });
        setCouple(r.couple);
        setEditingCap(false);
      } catch (err) {
        setCapError(err instanceof ApiError ? err.message : t("common.error_generic"));
      } finally {
        setSavingCap(false);
      }
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000_000) {
      setCapError(t("profile.budget_cap_invalid"));
      return;
    }
    setSavingCap(true);
    setCapError(null);
    try {
      const r = await coupleApi.update({
        budget_goal: { kind: "exact", exact_huf: Math.round(n), min_huf: null, max_huf: null },
      });
      setCouple(r.couple);
      setEditingCap(false);
    } catch (err) {
      setCapError(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setSavingCap(false);
    }
  }

  /** Drop a quick payment as a new "Egyéb" budget line. We set both planned
   *  and actual to the entered amount so the line reads as a paid, fully
   *  accounted-for spend in the budget table. The user can re-categorise it
   *  on /app/budget if they want a tighter category later. */
  async function savePayment(e: FormEvent) {
    e.preventDefault();
    const label = paymentLabel.trim();
    const n = Number(paymentAmount);
    if (!label) {
      setPaymentError(t("profile.budget_payment_label_required"));
      return;
    }
    if (!Number.isFinite(n) || n <= 0 || n > 10_000_000_000) {
      setPaymentError(t("profile.budget_payment_amount_invalid"));
      return;
    }
    setSavingPayment(true);
    setPaymentError(null);
    try {
      const r = await budgetApi.createLine({
        category: "other",
        label,
        planned_huf: Math.round(n),
        actual_huf: Math.round(n),
      });
      setBudgetLines((cur) => [...cur, r.line]);
      setPaymentLabel("");
      setPaymentAmount("");
      setAddingPayment(false);
    } catch (err) {
      setPaymentError(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setSavingPayment(false);
    }
  }

  const totalPaidHuf = budgetLines.reduce((s, l) => s + l.actual_huf, 0);
  // Source of truth for the cap + paid tiles and the picker pills below.
  // Falls back to HUF so the tiles still render through the first paint
  // before /api/couples/current resolves.
  const currency: Currency = couple?.currency ?? "HUF";
  const symbol = currencySymbol(currency, locale);

  /** Persist a new display currency. Existing money fields keep their
   *  integer values — see the schema comment on couples.currency. We don't
   *  re-fetch the budget lines: the values don't change, only their
   *  formatting does. Guarded by a confirm dialog so the couple knows
   *  upfront that switching only re-skins the symbol, NOT auto-converts
   *  past entries by FX rate. */
  async function saveCurrency(next: Currency) {
    if (next === currency) return;
    const ok = await confirm({
      title: t("profile.budget_currency_confirm_title"),
      body: t("profile.budget_currency_confirm_body"),
      confirmLabel: t("profile.budget_currency_confirm_yes"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    try {
      const r = await coupleApi.update({ currency: next });
      setCouple(r.couple);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error_generic"));
    }
  }

  return (
    <>
      {/* Visually-hidden h1 — hero band IS the visual heading but doesn't
       *  carry an h1, so the document outline still gets one. */}
      <h1 className="sr-only">{t("profile.title")}</h1>

      <ProfileHero couple={couple} t={t} locale={locale} />

      <ZoneLabel>{t("profile.zone_workspace")}</ZoneLabel>

      <AccountSection
        user={authUser}
        t={t}
        locale={locale}
        onLocaleChange={setLocale}
        onSaved={() => {
          refreshAuth();
        }}
      />

      <section className="card mt-6">
        <h2 className="flex items-center gap-2 text-lg">
          <Heart size={18} className="text-ink-400 dark:text-umber-400" aria-hidden />
          {t("profile.partner_title")}
        </h2>
        <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">{t("profile.partner_body")}</p>
        {partner ? (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <PartnerMonogram
                fullName={partner.full_name ?? ""}
                email={partner.email ?? ""}
                joined={partner.status === "joined" || partner.status === "active"}
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink-900 dark:text-paper-50">
                  {partner.full_name ?? t("profile.partner_no_name")}
                </p>
                <p className="text-sm text-ink-600 break-all dark:text-umber-200">
                  {partner.email ?? t("profile.partner_no_email")}
                </p>
              </div>
              <PartnerStatusPill status={partner.status} t={t} />
            </div>
            {partner.status === "invited" && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <p className="text-xs text-ink-500 dark:text-umber-300">
                  {t("profile.partner_invited_hint")}
                </p>
                <button
                  type="button"
                  className={`btn-sm ${
                    armedCancelInvite
                      ? "rounded-xl border border-blush-700 bg-blush-700 px-4 text-paper-50 transition-colors hover:bg-blush-800"
                      : "btn-outline"
                  }`}
                  onClick={cancelPendingInvite}
                  disabled={cancellingInvite}
                >
                  {cancellingInvite
                    ? t("profile.partner_invite_cancelling")
                    : armedCancelInvite
                      ? t("profile.partner_invite_cancel_confirm")
                      : t("profile.partner_invite_cancel")}
                </button>
                {/* SR announce — paired with the armed visual state so
                 *  non-visual users know the next click fires immediately. */}
                <span role="status" aria-live="polite" className="sr-only">
                  {armedCancelInvite ? t("profile.partner_invite_cancel_armed_announce") : ""}
                </span>
              </div>
            )}
          </>
        ) : (
          <p className="mt-4 text-sm text-ink-500 dark:text-umber-300">
            {t("profile.partner_none")}
          </p>
        )}
      </section>

      <WorkspacesPanel activeCoupleId={couple?.id ?? null} />

      <ZoneLabel>{t("profile.zone_planning")}</ZoneLabel>

      <section className="card mt-6">
        {/* Header row: title left, currency picker right. The picker stays
         *  inline with the heading so the section opens with one compact
         *  band instead of a stacked label-on-top-of-pills layout. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 className="flex items-center gap-2 text-lg">
            <Wallet size={18} className="text-ink-400 dark:text-umber-400" aria-hidden />
            {t("profile.budget_title")}
          </h2>
          <CurrencyPicker currency={currency} onSelect={saveCurrency} t={t} locale={locale} />
        </div>

        {/* Two stat rows on a hairline-divided list. Each row: label +
         *  action on the top line, the amount on its own line right below.
         *  The amount sits on the left column so the two values stack
         *  vertically and the eye reads them as a list of figures rather
         *  than a label-value table. Edit + quick-add forms replace the
         *  amount line in place so the row height doesn't double. */}
        <ul className="mt-3 divide-y divide-paper-200 border-y border-paper-200 dark:divide-umber-700 dark:border-umber-700">
          <li className="py-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
                {t("profile.budget_cap_label")}
              </span>
              {!editingCap && (
                <button
                  ref={editCapTriggerRef}
                  type="button"
                  className="text-xs font-medium text-ink-500 hover:text-ink-900 dark:text-umber-300 dark:hover:text-paper-50"
                  onClick={beginCapEdit}
                  aria-label={t("common.edit")}
                >
                  {t("common.edit")}
                </button>
              )}
            </div>
            {editingCap ? (
              <form
                onSubmit={saveCap}
                className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-2"
                aria-label={t("profile.budget_cap_label")}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1000}
                    value={capInput}
                    onChange={(ev) => setCapInput(ev.target.value)}
                    placeholder={t("profile.budget_cap_placeholder")}
                    className="input h-11 w-32 py-0 text-right text-base tabular-nums sm:h-8 sm:text-sm"
                    autoFocus
                    disabled={savingCap}
                  />
                  <span className="text-xs text-ink-500 dark:text-umber-300">{symbol}</span>
                </div>
                <button
                  type="submit"
                  className="btn-sm btn-primary !px-3 !py-2 !text-sm sm:!py-1 sm:!text-xs"
                  disabled={savingCap}
                >
                  {savingCap ? t("common.saving") : t("common.save")}
                </button>
                <button
                  type="button"
                  className="btn-sm btn-outline !px-3 !py-2 !text-sm sm:!py-1 sm:!text-xs"
                  onClick={() => {
                    setEditingCap(false);
                    setCapError(null);
                  }}
                  disabled={savingCap}
                >
                  {t("common.cancel")}
                </button>
                {capError && (
                  <p className="basis-full text-[11px] text-blush-700 dark:text-blush-300">
                    {capError}
                  </p>
                )}
              </form>
            ) : (
              <p className="mt-1 text-lg font-medium tabular-nums tracking-tight text-ink-900 dark:text-paper-50">
                {couple ? formatBudgetGoal(couple.budget_goal, { t, locale }, currency) : "—"}
              </p>
            )}
          </li>

          <li className="py-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
                {t("profile.budget_paid_label")}
              </span>
              {!addingPayment && (
                <button
                  ref={addPaymentTriggerRef}
                  type="button"
                  className="text-xs font-medium text-ink-500 hover:text-ink-900 dark:text-umber-300 dark:hover:text-paper-50"
                  onClick={() => {
                    setAddingPayment(true);
                    setPaymentError(null);
                  }}
                >
                  {t("profile.budget_payment_add")}
                </button>
              )}
            </div>
            {addingPayment ? (
              <form
                onSubmit={savePayment}
                className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-2"
              >
                <input
                  type="text"
                  value={paymentLabel}
                  onChange={(ev) => setPaymentLabel(ev.target.value)}
                  placeholder={t("profile.budget_payment_label_placeholder")}
                  className="input h-11 flex-1 min-w-[8rem] py-0 text-base sm:h-8 sm:text-sm"
                  maxLength={200}
                  autoFocus
                  disabled={savingPayment}
                />
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1000}
                    value={paymentAmount}
                    onChange={(ev) => setPaymentAmount(ev.target.value)}
                    placeholder={t("profile.budget_payment_amount_placeholder")}
                    className="input h-11 w-28 py-0 text-right text-base tabular-nums sm:h-8 sm:text-sm"
                    disabled={savingPayment}
                  />
                  <span className="text-xs text-ink-500 dark:text-umber-300">{symbol}</span>
                </div>
                <button
                  type="submit"
                  className="btn-sm btn-primary !px-3 !py-2 !text-sm sm:!py-1 sm:!text-xs"
                  disabled={savingPayment}
                >
                  {savingPayment ? t("common.saving") : t("profile.budget_payment_save")}
                </button>
                <button
                  type="button"
                  className="btn-sm btn-outline !px-3 !py-2 !text-sm sm:!py-1 sm:!text-xs"
                  onClick={() => {
                    setAddingPayment(false);
                    setPaymentLabel("");
                    setPaymentAmount("");
                    setPaymentError(null);
                  }}
                  disabled={savingPayment}
                >
                  {t("common.cancel")}
                </button>
                {paymentError && (
                  <p className="basis-full text-[11px] text-blush-700 dark:text-blush-300">
                    {paymentError}
                  </p>
                )}
              </form>
            ) : (
              <p className="mt-1 text-lg font-medium tabular-nums tracking-tight text-ink-900 dark:text-paper-50">
                {formatMoney(totalPaidHuf, currency, locale)}
              </p>
            )}
          </li>
        </ul>
      </section>

      <section className="card mt-6">
        <h2 className="flex items-center gap-2 text-lg">
          <Sliders size={18} className="text-ink-400 dark:text-umber-400" aria-hidden />
          {t("profile.display_title")}
        </h2>
        <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">{t("profile.display_body")}</p>
        <DensitySlider density={density} setDensity={setDensity} t={t} />
      </section>

      <section className="card mt-6">
        <h2 className="flex items-center gap-2 text-lg">
          <Tablet size={18} className="text-ink-400 dark:text-umber-400" aria-hidden />
          {t("profile.welcome_desk_title")}
        </h2>
        <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">
          {t("profile.welcome_desk_body")}
        </p>
        {couple?.slug ? (
          <a
            href={`/rsvp?couple=${encodeURIComponent(couple.slug)}&kiosk=1`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary mt-4 inline-flex"
          >
            <Tablet size={14} aria-hidden />
            {t("profile.welcome_desk_button")}
            <span className="sr-only"> {t("common.opens_new_tab")}</span>
          </a>
        ) : (
          <p className="mt-3 rounded-xl border border-blush-300 bg-white px-4 py-3 text-sm text-ink-700 dark:border-blush-400/40 dark:bg-umber-800 dark:text-paper-100">
            {t("profile.welcome_desk_no_slug")}
          </p>
        )}
      </section>

      <ZoneLabel>{t("profile.zone_account")}</ZoneLabel>

      <SecuritySection
        t={t}
        pwCurrent={pwCurrent}
        setPwCurrent={setPwCurrent}
        pwNext={pwNext}
        setPwNext={setPwNext}
        pwConfirm={pwConfirm}
        setPwConfirm={setPwConfirm}
        pwError={pwError}
        pwSubmitting={pwSubmitting}
        onChangePassword={changePassword}
        newEmail={newEmail}
        setNewEmail={setNewEmail}
        emailPassword={emailPassword}
        setEmailPassword={setEmailPassword}
        emailError={emailError}
        emailSubmitting={emailSubmitting}
        onRequestEmailChange={requestEmailChange}
      />

      <section className="card mt-6">
        <h2 className="flex items-center gap-2 text-lg">
          <Download size={18} className="text-ink-400 dark:text-umber-400" aria-hidden />
          {t("profile.export_title")}
        </h2>
        <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">{t("profile.export_body")}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            className="btn-outline"
            onClick={downloadExport}
            disabled={exporting}
          >
            {exporting ? t("profile.export_downloading") : t("profile.export_button")}
          </button>
          <button
            type="button"
            className="btn-outline"
            onClick={downloadGuestCsv}
            disabled={csvExporting}
          >
            {csvExporting ? t("profile.export_downloading") : t("profile.export_guest_csv_button")}
          </button>
        </div>
      </section>

      <DocumentsPanel
        documents={documents}
        locale={locale}
        t={t}
        redownloading={redownloading}
        removing={removing}
        armedDeleteId={armedDeleteId}
        onRedownload={redownloadSaved}
        onDelete={clickDelete}
      />

      <ActivityPanel
        entries={activity}
        currentUserId={authUser?.id ?? null}
        locale={locale}
        t={t}
      />

      {authUser && couple && (
        <section className="card mt-6">
          <h2 className="flex items-center gap-2 text-lg">
            <LogOut size={18} className="text-ink-400 dark:text-umber-400" aria-hidden />
            {t("profile.leave_couple_title")}
          </h2>
          {authUser.id === couple.partner_a_id ? (
            <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">
              {t("profile.leave_couple_body_owner")}
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">
                {t("profile.leave_couple_body_partner_b")}
              </p>
              <button
                type="button"
                className="btn-outline mt-4"
                onClick={onLeaveCouple}
                disabled={leaving}
              >
                {leaving ? t("profile.leave_couple_leaving") : t("profile.leave_couple_button")}
              </button>
            </>
          )}
        </section>
      )}

      <section className="card mt-6 border-2 border-blush-500 bg-blush-50/40 dark:bg-blush-400/15">
        <h2 className="flex items-center gap-2 text-lg text-blush-800 dark:text-blush-300">
          <Trash2 size={18} aria-hidden />
          {t("profile.delete_account_title")}
        </h2>
        <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">
          {t("profile.delete_account_body")}
        </p>
        {coupleStatus === "paused" && pauseReq ? (
          <div className="mt-4 rounded-xl bg-blush-50 p-4 dark:bg-blush-400/15">
            <p className="text-sm font-medium text-blush-800 dark:text-blush-300">
              {t("profile.delete_account_pending")}
            </p>
            {scheduledYmd && (
              <p className="mt-1 text-xs text-blush-700 dark:text-blush-300">
                {t("profile.delete_account_pending_until", {
                  date: formatDate(scheduledYmd, locale),
                })}
              </p>
            )}
            <button type="button" className="btn-outline mt-4" onClick={cancelPause}>
              {t("profile.cancel_delete_account")}
            </button>
          </div>
        ) : (
          <button type="button" className="btn-accent mt-4" onClick={startPause} disabled={!couple}>
            {t("profile.delete_account_button")}
          </button>
        )}
        {error && <p className="field-error mt-3">{error}</p>}
      </section>
    </>
  );
}

/** Accessible currency picker — APG-conformant radiogroup. Arrow keys move
 *  selection (with wrap), Home/End jump to ends, roving tabIndex keeps the
 *  whole group as a single tab stop. Mobile sizing bumps each pill above the
 *  iOS 44pt floor; on desktop it stays a compact inline band so the section
 *  header doesn't double-stack. The visible label is the currency symbol
 *  (€, $, Ft, …) but the SR `aria-label` carries the three-letter code so
 *  screen readers say "Euro" / "United States dollar" via Intl, not "Ft". */
function CurrencyPicker({
  currency,
  onSelect,
  t,
  locale,
}: {
  currency: Currency;
  onSelect: (next: Currency) => void;
  t: T;
  locale: Locale;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIdx = Math.max(0, CURRENCIES.indexOf(currency));
  function focusAt(i: number) {
    const wrapped = (i + CURRENCIES.length) % CURRENCIES.length;
    const next = CURRENCIES[wrapped];
    if (next === undefined) return;
    refs.current[wrapped]?.focus();
    onSelect(next);
  }
  function onKeyDown(ev: ReactKeyboardEvent<HTMLButtonElement>, i: number) {
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown") {
      ev.preventDefault();
      focusAt(i + 1);
    } else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") {
      ev.preventDefault();
      focusAt(i - 1);
    } else if (ev.key === "Home") {
      ev.preventDefault();
      focusAt(0);
    } else if (ev.key === "End") {
      ev.preventDefault();
      focusAt(CURRENCIES.length - 1);
    }
  }
  return (
    <div
      role="radiogroup"
      aria-label={t("profile.budget_currency_label")}
      className="inline-flex overflow-hidden rounded-full border border-ink-200 dark:border-umber-700"
    >
      {CURRENCIES.map((c, i) => {
        const active = c === currency;
        // Intl currency long-name for SR users — fall back to the raw code
        // if the locale's ICU data doesn't carry the long form.
        let aria: string = c;
        try {
          const dn = new Intl.DisplayNames([locale === "hu" ? "hu" : "en"], { type: "currency" });
          aria = dn.of(c) ?? c;
        } catch {
          /* DisplayNames not supported — keep the 3-char code as label. */
        }
        return (
          <button
            ref={(el) => {
              refs.current[i] = el;
            }}
            key={c}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={aria}
            tabIndex={i === activeIdx ? 0 : -1}
            onClick={() => onSelect(c)}
            onKeyDown={(ev) => onKeyDown(ev, i)}
            // Mobile: 44px-tall tap target with comfortable padding. Desktop
            // (sm+): collapse to the compact pill band the inline header
            // layout was designed for.
            className={`min-w-[44px] whitespace-nowrap px-3 py-3 text-sm font-medium transition-colors sm:px-2.5 sm:py-1 sm:text-[11px] ${
              active
                ? "bg-ink-900 text-paper-50 dark:bg-paper-50 dark:text-ink-900"
                : "bg-paper-50 text-ink-600 hover:bg-paper-100 dark:bg-ink-800 dark:text-umber-200 dark:hover:bg-umber-700"
            }`}
          >
            {currencySymbol(c, locale)}
          </button>
        );
      })}
    </div>
  );
}

/** Small-caps section divider that splits the long card stack into three
 *  semantic zones (you & workspace / wedding planning / account & data).
 *  Per the Agent 2 visual critique: equal-weight cards without grouping
 *  read as a settings dump; a quiet label every few cards turns the page
 *  into a list of zones with an internal hierarchy. */
function ZoneLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-10 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400 dark:text-umber-400">
      {children}
    </h2>
  );
}

/** Top-of-page identity strip. Replaces the bare "Profile" h1 with a
 *  wedding-themed band: couple monogram, names, the wedding date, and a
 *  big tabular-nums days-until counter. Renders a graceful placeholder
 *  during the initial /api/couples/current fetch so the page never paints
 *  empty space. Wedding-day = today fires a celebratory line; past dates
 *  flip to "X days married" so the counter doesn't read negative. */
function ProfileHero({
  couple,
  t,
  locale,
}: {
  couple: Couple | null;
  t: T;
  locale: Locale;
}) {
  if (!couple) {
    return (
      <section
        aria-hidden="true"
        className="mt-2 h-24 animate-pulse rounded-2xl bg-paper-200 dark:bg-umber-800"
      />
    );
  }
  const bride = couple.bride_name?.trim() || "";
  const groom = couple.groom_name?.trim() || "";
  const sep = t("profile.activity_names_separator");
  const namesLine = bride && groom ? `${bride}${sep}${groom}` : bride || groom || "";
  const days = daysUntilWedding(couple.wedding_date);
  return (
    <section className="mt-2 overflow-hidden rounded-2xl bg-paper-200 shadow-pop dark:bg-umber-800">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4 px-6 py-5 sm:px-8 sm:py-6">
        <CoupleMonogram bride={bride} groom={groom} />
        <div className="min-w-0 flex-1">
          <p className="font-serif text-2xl leading-tight tracking-tight text-ink-900 sm:text-3xl dark:text-paper-50">
            {namesLine || t("profile.title")}
          </p>
          <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
            {couple.wedding_date
              ? formatDate(couple.wedding_date, locale)
              : t("profile.hero_date_tbd")}
          </p>
        </div>
        {days !== null && (
          <div className="ml-auto text-right">
            <p className="font-serif text-3xl leading-none tabular-nums text-ink-900 sm:text-4xl dark:text-paper-50">
              {Math.abs(days)}
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-wide text-ink-500 dark:text-umber-300">
              {heroDaysLabel(days, t)}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/** Whole-number days between today (local midnight) and the wedding date.
 *  Null when the date is TBD. Negative once the wedding is in the past. */
function daysUntilWedding(yyyyMmDd: string | null): number | null {
  if (!yyyyMmDd) return null;
  const parts = yyyyMmDd.split("-").map(Number);
  if (parts.length !== 3) return null;
  const [y, m, d] = parts as [number, number, number];
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const target = new Date(y, m - 1, d).getTime();
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((target - todayMidnight) / 86_400_000);
}

/** Pluralisation-aware caption under the big days-until number. */
function heroDaysLabel(days: number, t: T): string {
  if (days === 0) return t("profile.hero_days_today");
  if (days === 1) return t("profile.hero_days_one");
  if (days < 0) return t("profile.hero_days_past", { n: Math.abs(days) });
  return t("profile.hero_days_until", { n: days });
}

/** Two-letter couple monogram for the hero. Bride initial + groom
 *  initial; falls back to "??" when both names are missing. Ink disc
 *  keeps the visual weight calm — blush on the disc historically read
 *  as an error state per the agent debate. */
function CoupleMonogram({ bride, groom }: { bride: string; groom: string }) {
  const a = bride.trim()[0]?.toUpperCase() ?? "";
  const b = groom.trim()[0]?.toUpperCase() ?? "";
  const initials = a + b || "??";
  return (
    <span
      aria-hidden="true"
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ink-900 text-base font-semibold uppercase text-paper-50 ring-2 ring-paper-50 sm:h-16 sm:w-16 sm:text-lg dark:bg-paper-50 dark:text-ink-900 dark:ring-umber-800"
    >
      {initials}
    </span>
  );
}

/** "Your account" card — the actual *user* identity surface that was
 *  missing from the page. Email is read-only (lives in the Security card),
 *  display name is inline-editable, language is a two-button toggle that
 *  both updates `users.locale` server-side AND flips the UI locale
 *  immediately so the user sees the change before reload. */
function AccountSection({
  user,
  t,
  locale,
  onLocaleChange,
  onSaved,
}: {
  user: { id: number; email: string; full_name: string; locale: "hu" | "en" | null } | null;
  t: T;
  locale: Locale;
  onLocaleChange: (next: Locale) => void;
  onSaved: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingLocale, setSavingLocale] = useState<Locale | null>(null);
  const nameTriggerRef = useRef<HTMLButtonElement | null>(null);
  const toast = useToast();

  const editingNamePrev = useRef(false);
  useEffect(() => {
    if (editingNamePrev.current && !editingName) nameTriggerRef.current?.focus();
    editingNamePrev.current = editingName;
  }, [editingName]);

  if (!user) {
    return (
      <section
        aria-hidden="true"
        className="card mt-6 h-32 animate-pulse bg-paper-200 dark:bg-umber-800"
      />
    );
  }

  function beginNameEdit() {
    if (!user) return;
    setNameInput(user.full_name ?? "");
    setNameError(null);
    setEditingName(true);
  }

  async function saveName(e: FormEvent) {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (trimmed.length < 1 || trimmed.length > 200) {
      setNameError(t("profile.account_name_save_error"));
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      await userApi.updateProfile({ full_name: trimmed });
      toast.success(t("profile.account_name_save_success"));
      setEditingName(false);
      onSaved();
    } catch (err) {
      setNameError(err instanceof ApiError ? err.message : t("profile.account_name_save_error"));
    } finally {
      setSavingName(false);
    }
  }

  async function saveLocale(next: Locale) {
    if (next === locale) return;
    setSavingLocale(next);
    try {
      onLocaleChange(next);
      await userApi.updateProfile({ locale: next });
      toast.success(t("profile.account_locale_save_success"));
      onSaved();
    } catch (err) {
      onLocaleChange(locale);
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setSavingLocale(null);
    }
  }

  return (
    <section className="card mt-6">
      <div className="flex flex-wrap items-center gap-4">
        <UserAvatarDisc fullName={user.full_name} email={user.email} />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg">{t("profile.account_title")}</h2>
          <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
            {t("profile.account_body")}
          </p>
        </div>
      </div>

      <ul className="mt-4 divide-y divide-paper-200 border-y border-paper-200 dark:divide-umber-700 dark:border-umber-700">
        <li className="py-3">
          <span className="text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
            {t("profile.account_email_label")}
          </span>
          <p className="mt-1 break-all text-base text-ink-800 dark:text-paper-100">{user.email}</p>
        </li>

        <li className="py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
              {t("profile.account_name_label")}
            </span>
            {!editingName && (
              <button
                ref={nameTriggerRef}
                type="button"
                className="text-xs font-medium text-ink-500 hover:text-ink-900 dark:text-umber-300 dark:hover:text-paper-50"
                onClick={beginNameEdit}
                aria-label={t("common.edit")}
              >
                {t("common.edit")}
              </button>
            )}
          </div>
          {editingName ? (
            <form
              onSubmit={saveName}
              className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-2"
              aria-label={t("profile.account_name_label")}
            >
              <input
                type="text"
                value={nameInput}
                onChange={(ev) => setNameInput(ev.target.value)}
                placeholder={t("profile.account_name_placeholder")}
                className="input h-11 min-w-[10rem] flex-1 py-0 text-base sm:h-8 sm:text-sm"
                maxLength={200}
                autoFocus
                disabled={savingName}
              />
              <button
                type="submit"
                className="btn-sm btn-primary !px-3 !py-2 !text-sm sm:!py-1 sm:!text-xs"
                disabled={savingName}
              >
                {savingName ? t("common.saving") : t("common.save")}
              </button>
              <button
                type="button"
                className="btn-sm btn-outline !px-3 !py-2 !text-sm sm:!py-1 sm:!text-xs"
                onClick={() => {
                  setEditingName(false);
                  setNameError(null);
                }}
                disabled={savingName}
              >
                {t("common.cancel")}
              </button>
              {nameError && (
                <p className="basis-full text-[11px] text-blush-700 dark:text-blush-300">
                  {nameError}
                </p>
              )}
            </form>
          ) : (
            <p className="mt-1 text-base text-ink-800 dark:text-paper-100">
              {user.full_name?.trim() || t("profile.partner_no_name")}
            </p>
          )}
        </li>

        <li className="py-3">
          <span className="text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
            {t("profile.account_locale_label")}
          </span>
          <p className="mt-1 text-[11px] text-ink-500 dark:text-umber-300">
            {t("profile.account_locale_help")}
          </p>
          <div
            role="radiogroup"
            aria-label={t("profile.account_locale_label")}
            className="mt-2 inline-flex overflow-hidden rounded-full border border-ink-200 dark:border-umber-700"
          >
            {(["hu", "en"] as const).map((l) => {
              const active = l === locale;
              return (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => saveLocale(l)}
                  disabled={savingLocale !== null}
                  className={`min-w-[80px] px-4 py-3 text-sm font-medium transition-colors sm:py-1.5 sm:text-xs ${
                    active
                      ? "bg-ink-900 text-paper-50 dark:bg-paper-50 dark:text-ink-900"
                      : "bg-paper-50 text-ink-600 hover:bg-paper-100 dark:bg-ink-800 dark:text-umber-200 dark:hover:bg-umber-700"
                  }`}
                >
                  {t(`profile.account_locale_${l}`)}
                </button>
              );
            })}
          </div>
        </li>
      </ul>
    </section>
  );
}

/** Single-disc avatar for the signed-in user. */
function UserAvatarDisc({ fullName, email }: { fullName: string; email: string }) {
  const initials = getInitials(fullName, email);
  return (
    <span
      aria-hidden="true"
      title={fullName || email}
      className="flex h-12 w-12 items-center justify-center rounded-full bg-ink-900 text-sm font-semibold uppercase text-paper-100 ring-2 ring-paper-50 dark:bg-paper-50 dark:text-ink-900 dark:ring-umber-800"
    >
      {initials}
    </span>
  );
}

/** Security section — replaces the previous `<details>/<summary>` pattern
 *  with an explicit `<button aria-expanded aria-controls>` toggle so the
 *  disclosure state is announced consistently across VoiceOver, NVDA, and
 *  TalkBack (Safari's native `<details>` announcement is inconsistent).
 *  Visually identical to the prior card; lift was a pure a11y refactor. */
function SecuritySection({
  t,
  pwCurrent,
  setPwCurrent,
  pwNext,
  setPwNext,
  pwConfirm,
  setPwConfirm,
  pwError,
  pwSubmitting,
  onChangePassword,
  newEmail,
  setNewEmail,
  emailPassword,
  setEmailPassword,
  emailError,
  emailSubmitting,
  onRequestEmailChange,
}: {
  t: T;
  pwCurrent: string;
  setPwCurrent: (v: string) => void;
  pwNext: string;
  setPwNext: (v: string) => void;
  pwConfirm: string;
  setPwConfirm: (v: string) => void;
  pwError: string | null;
  pwSubmitting: boolean;
  onChangePassword: (e: FormEvent) => void;
  newEmail: string;
  setNewEmail: (v: string) => void;
  emailPassword: string;
  setEmailPassword: (v: string) => void;
  emailError: string | null;
  emailSubmitting: boolean;
  onRequestEmailChange: (e: FormEvent) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card mt-6 p-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="security-panel-body"
        className="flex w-full items-start gap-4 px-6 py-5 text-left transition-colors hover:bg-paper-50/60 dark:hover:bg-umber-800/40"
      >
        <span className="flex-1">
          <span className="flex items-center gap-2 text-lg text-ink-900 dark:text-paper-50">
            <ShieldCheck size={18} className="text-ink-400 dark:text-umber-400" aria-hidden />
            {t("profile.security_title")}
          </span>
          <span className="mt-1 block text-sm text-ink-500 dark:text-umber-300">
            {t("profile.security_summary")}
          </span>
        </span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-ink-500 transition-transform dark:text-umber-300 ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open && (
        <div
          id="security-panel-body"
          className="grid gap-6 border-t border-paper-200 px-6 py-5 md:grid-cols-2 dark:border-umber-700"
        >
          <form className="grid gap-2" onSubmit={onChangePassword} noValidate>
            <h3 className="text-sm font-medium text-ink-800 dark:text-paper-100">
              {t("profile.security_pw_heading")}
            </h3>
            <div>
              <label htmlFor="pw-current" className="field-label">
                {t("profile.security_pw_current")}
              </label>
              <input
                id="pw-current"
                type="password"
                className="input"
                autoComplete="current-password"
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="pw-new" className="field-label">
                {t("profile.security_pw_new")}
              </label>
              <input
                id="pw-new"
                type="password"
                className="input"
                autoComplete="new-password"
                value={pwNext}
                onChange={(e) => setPwNext(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="pw-confirm" className="field-label">
                {t("profile.security_pw_confirm")}
              </label>
              <input
                id="pw-confirm"
                type="password"
                className="input"
                autoComplete="new-password"
                value={pwConfirm}
                onChange={(e) => setPwConfirm(e.target.value)}
                required
              />
            </div>
            {pwError && <p className="field-error">{pwError}</p>}
            <button
              type="submit"
              className="btn-primary mt-1 justify-self-start"
              disabled={pwSubmitting}
            >
              {pwSubmitting ? t("profile.security_pw_submitting") : t("profile.security_pw_submit")}
            </button>
          </form>

          <form className="grid gap-2" onSubmit={onRequestEmailChange} noValidate>
            <h3 className="text-sm font-medium text-ink-800 dark:text-paper-100">
              {t("profile.security_email_heading")}
            </h3>
            <div>
              <label htmlFor="new-email" className="field-label">
                {t("profile.security_email_new")}
              </label>
              <input
                id="new-email"
                type="email"
                className="input"
                autoComplete="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="email-pw" className="field-label">
                {t("profile.security_email_password")}
              </label>
              <input
                id="email-pw"
                type="password"
                className="input"
                autoComplete="current-password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                required
              />
            </div>
            {emailError && <p className="field-error">{emailError}</p>}
            <button
              type="submit"
              className="btn-outline mt-1 justify-self-start"
              disabled={emailSubmitting}
            >
              {emailSubmitting
                ? t("profile.security_email_submitting")
                : t("profile.security_email_submit")}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

/** Three-step density slider on the Profile Display card. The slider
 *  drives a 0/1/2 index mapped onto compact / default / comfortable,
 *  with the three labels under the track and a one-line description of
 *  the currently-active value below. Native `<input type="range">` so
 *  keyboard nav + screen readers come for free; we paint the filled
 *  portion of the track with the same gradient trick the cost-planning
 *  sliders use (`.range-fill` class + inline custom property). */
function DensitySlider({
  density,
  setDensity,
  t,
}: {
  density: Density;
  setDensity: (d: Density) => void;
  t: T;
}) {
  const VALUES: Density[] = ["compact", "default", "comfortable"];
  const idx = Math.max(0, VALUES.indexOf(density));
  const pct = (idx / (VALUES.length - 1)) * 100;
  // Type-sample sizes for the "Aa" tick labels below the track. Going
  // text-xs → text-base → text-2xl gives the user an immediate "this is
  // how big the small labels will read in each mode" preview without
  // forcing them to commit a choice first.
  const SAMPLE_CLASSES: Record<Density, string> = {
    compact: "text-xs",
    default: "text-base",
    comfortable: "text-2xl",
  };
  return (
    <div className="mt-4">
      <label htmlFor="density-slider" className="field-label">
        {t("profile.density_label")}
      </label>
      {/* The thumb (14px) sits centred on the 6px track by default. The
       *  inline gradient paints the filled-portion colour on the input's
       *  background; the .range-fill class handles the height + the
       *  thumb's vertical-centre alignment via the WebKit / Moz
       *  pseudo-elements declared in index.css. */}
      <input
        id="density-slider"
        type="range"
        min={0}
        max={VALUES.length - 1}
        step={1}
        value={idx}
        list="density-ticks"
        onChange={(e) => {
          const next = VALUES[Number(e.target.value)];
          if (next) setDensity(next);
        }}
        aria-valuetext={t(`profile.density_${density}` as const)}
        className="range-fill mt-2 block w-full"
        style={
          {
            background: `linear-gradient(to right, var(--range-fill-amount) 0%, var(--range-fill-amount) ${pct}%, var(--range-fill-remainder) ${pct}%, var(--range-fill-remainder) 100%)`,
          } as CSSProperties
        }
      />
      <datalist id="density-ticks">
        {VALUES.map((_, i) => (
          <option key={i} value={i} />
        ))}
      </datalist>
      {/* "Aa" tick row replaces the old wordy "Tömör / Alapértelmezett /
       *  Kényelmes" labels with a type sample at each stop's actual size.
       *  Items align to the END of their column so the visual baseline
       *  stays consistent regardless of glyph height (the bigger "Aa"
       *  has more ascender / descender headroom than the smaller ones). */}
      <div className="mt-3 grid grid-cols-3 items-end">
        {VALUES.map((value) => {
          const active = value === density;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setDensity(value)}
              aria-label={t(`profile.density_${value}` as const)}
              title={t(`profile.density_${value}` as const)}
              className={`flex justify-center pt-1 leading-none transition-colors ${SAMPLE_CLASSES[value]} ${
                active
                  ? "font-semibold text-ink-900 dark:text-paper-50"
                  : "text-ink-400 hover:text-ink-700 dark:text-umber-400 dark:hover:text-paper-100"
              }`}
            >
              Aa
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-ink-500 dark:text-umber-300">
        <span className="font-medium text-ink-700 dark:text-paper-100">
          {t(`profile.density_${density}` as const)}
        </span>
        <span className="mx-1">·</span>
        {t(`profile.density_${density}_help` as const)}
      </p>
    </div>
  );
}

/** Single initial-disc above the partner card — just the invited
 *  partner's monogram in blush, no self-overlap. The signed-in user's
 *  avatar already lives in the header ProfileMenu chip; doubling up on
 *  the card just made the row read as "two strangers" rather than "the
 *  person we invited". Dimmed when status='invited' (no real initials
 *  yet — the disc still anchors the row). */
function PartnerMonogram({
  fullName,
  email,
  joined,
}: {
  fullName: string;
  email: string;
  joined: boolean;
}) {
  const initials = getInitials(fullName, email);
  return (
    <span
      aria-hidden="true"
      title={fullName || email}
      className={`flex h-12 w-12 items-center justify-center rounded-full bg-blush-700 text-sm font-semibold uppercase text-paper-100 ring-2 ring-paper-50 dark:bg-blush-500 dark:ring-umber-800 ${
        joined ? "" : "opacity-60"
      }`}
    >
      {initials}
    </span>
  );
}

/** Shared initials helper — mirrors `ProfileMenu.getInitials` so the two
 *  surfaces stay in sync. Two-word names → first+last initial; single
 *  name → first two letters; empty → "?" so we never render a blank disc. */
function getInitials(fullName: string, email: string): string {
  const source = fullName.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0]?.[0] ?? "";
    const last = parts[parts.length - 1]?.[0] ?? "";
    return (first + last).toUpperCase();
  }
  const single = parts[0] ?? "";
  return single.slice(0, 2).toUpperCase() || "?";
}

/** Colour-coded pill for the partner's lifecycle state. Colours pull from
 *  Weddly's three-token palette (no raw hex per CLAUDE.md):
 *    - invited → blush (warm orange — pending action)
 *    - joined  → paper (muted neutral — account exists but offline)
 *    - active  → ink (deep navy — signed in right now)
 */
function PartnerStatusPill({
  status,
  t,
}: {
  status: CouplePartnerStatus;
  t: (k: string, vars?: Record<string, string | number>) => string;
}) {
  const cls = {
    invited:
      "bg-blush-100 text-blush-800 border border-blush-200 dark:bg-blush-400/15 dark:text-blush-300 dark:border-blush-400/40",
    joined:
      "bg-paper-200 text-ink-700 border border-paper-300 dark:bg-umber-700 dark:text-paper-100 dark:border-umber-700",
    active:
      "bg-ink-700 text-paper-100 border border-ink-800 dark:bg-paper-50 dark:text-umber-900 dark:border-paper-100",
  }[status];
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${cls}`}>
      {t(`profile.partner_status_${status}`)}
    </span>
  );
}

/** Compact human time — relative for recent events, locale date+time for
 *  anything older than a week. Helper for the activity panel. */
function relativeTime(
  ms: number,
  locale: Locale,
  t: (k: string, v?: Record<string, string | number>) => string,
): string {
  const diffMs = Date.now() - ms;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return t("profile.activity_just_now");
  if (diffMin < 60) return t("profile.activity_mins_ago", { n: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return t("profile.activity_hours_ago", { n: diffHour });
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return t("profile.activity_yesterday");
  if (diffDay < 7) return t("profile.activity_days_ago", { n: diffDay });
  return formatTimestamp(ms, locale);
}

/** Loop C₁: the activity feed now carries `before_json` / `after_json` for
 *  per-field couple edits, picks, schedule, and DIY supplier rows. This
 *  helper picks out the meaningful fields for each known action and feeds
 *  them through `t(...)` as `{before}` / `{after}` / `{category}` / `{label}`
 *  / `{name}` interpolation. Returns the localized verb-phrase that the
 *  panel renders next to the actor name.
 *
 *  Safety: every JSON.parse is wrapped in try/catch. Unknown action types
 *  fall through to the standard `profile.activity_action_<path>` lookup,
 *  which itself falls back to `profile.activity_action_generic` if the key
 *  isn't translated. */
type T = (path: string, vars?: Record<string, string | number>) => string;

function safeParse(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Try a localized lookup; fall back to a generic phrase if the key isn't
 *  translated (i.e. the returned string is identical to the key path). */
function tWithFallback(t: T, key: string, vars: Record<string, string | number>): string {
  const out = t(key, vars);
  if (out === key) return t("profile.activity_action_generic", vars);
  return out;
}

/** Format a budget side (before or after) — honours `budget_kind` so a range
 *  renders as "min – max" and tbd renders as the i18n "TBD" string. */
function formatBudgetSide(side: Record<string, unknown>, locale: Locale, t: T): string {
  const kind = asString(side.budget_kind);
  const exact = asNumber(side.budget_ceiling_huf);
  const min = asNumber(side.budget_ceiling_min_huf);
  const max = asNumber(side.budget_ceiling_max_huf);
  if (kind === "range" && min !== null && max !== null) return formatHufRange(min, max, locale);
  if (kind === "exact" && exact !== null) return formatHuf(exact, locale);
  if (exact !== null) return formatHuf(exact, locale);
  if (min !== null && max !== null) return formatHufRange(min, max, locale);
  return t("profile.activity_value_empty");
}

/** Format a wedding-date side respecting the chosen `wedding_date_kind`. */
function formatWeddingDateSide(side: Record<string, unknown>, locale: Locale, t: T): string {
  const kind = asString(side.wedding_date_kind);
  const exact = asString(side.wedding_date);
  const year = asNumber(side.wedding_target_year);
  const month = asNumber(side.wedding_target_month);
  const season = asString(side.wedding_target_season);
  if (kind === "tbd") return t("profile.activity_date_tbd");
  if (kind === "exact" && exact) return formatDate(exact, locale);
  if (kind === "month" && year !== null && month !== null) {
    return formatYearMonth(year, month, locale);
  }
  if (kind === "season" && year !== null && season) {
    return t("goal.date_season", { season: t(`season.${season}`), year });
  }
  if (kind === "year" && year !== null) return String(year);
  if (exact) return formatDate(exact, locale);
  return t("profile.activity_date_tbd");
}

/** Bride & Groom — both sides always carry both names so a single field
 *  edit still produces a paired "Anna & Béla → Anna & Botond" diff.
 *  Separator is i18n'd so HU reads "Anna és Béla" instead of the EN "&". */
function formatNamesSide(side: Record<string, unknown>, t: T): string {
  const bride = asString(side.bride_name) ?? "";
  const groom = asString(side.groom_name) ?? "";
  if (!bride && !groom) return "—";
  const sep = t("profile.activity_names_separator");
  return `${bride}${sep}${groom}`.trim();
}

/** Localized ceremony kind label. Backend stores raw enum strings; falls
 *  back to the raw value if a new kind ever ships without an i18n pair. */
function formatCeremonyKind(value: string | null, t: T): string {
  if (!value) return t("profile.activity_value_empty");
  const label = t(`onboarding.ceremony_kind_${value}`);
  // i18n miss → just show the enum so we never block an audit render.
  if (label === `onboarding.ceremony_kind_${value}`) return value;
  return label;
}

/** Returns the localized verb-phrase for one activity entry. The actor name
 *  is rendered separately by `ActivityPanel`, so this string starts with the
 *  verb ("updated the budget cap: X → Y"). */
function renderActivityEntry(entry: CoupleActivityEntry, t: T, locale: Locale): string {
  const before = safeParse(entry.before_json);
  const after = safeParse(entry.after_json);
  const action = entry.action;
  const empty = t("profile.activity_value_empty");

  // Per-field couple updates — these always carry both before and after.
  if (action === "couple.budget_cap_update" && before && after) {
    return tWithFallback(t, "profile.activity_action_couple_budget_cap_update", {
      before: formatBudgetSide(before, locale, t),
      after: formatBudgetSide(after, locale, t),
    });
  }
  if (action === "couple.wedding_date_update" && before && after) {
    return tWithFallback(t, "profile.activity_action_couple_wedding_date_update", {
      before: formatWeddingDateSide(before, locale, t),
      after: formatWeddingDateSide(after, locale, t),
    });
  }
  if (action === "couple.names_update" && before && after) {
    return tWithFallback(t, "profile.activity_action_couple_names_update", {
      before: formatNamesSide(before, t),
      after: formatNamesSide(after, t),
    });
  }
  if (action === "couple.ceremony_kind_update" && before && after) {
    return tWithFallback(t, "profile.activity_action_couple_ceremony_kind_update", {
      before: formatCeremonyKind(asString(before.ceremony_kind), t),
      after: formatCeremonyKind(asString(after.ceremony_kind), t),
    });
  }
  if (action === "couple.planning_count_update" && before && after) {
    const b = asNumber(before.planning_count);
    const a = asNumber(after.planning_count);
    return tWithFallback(t, "profile.activity_action_couple_planning_count_update", {
      before: b === null ? t("profile.activity_value_empty") : String(b),
      after: a === null ? t("profile.activity_value_empty") : String(a),
    });
  }

  // Pick events — category is the only meaningful field. Localize via the
  // shared `suppliers.cat.*` namespace; fall through to the raw slug if
  // it's a category we don't have a label for yet.
  if (action === "pick.upsert" || action === "pick.remove") {
    const side = after ?? before;
    const cat = side ? asString(side.category) : null;
    const catLabel = cat ? t(`suppliers.cat.${cat}`) : null;
    return tWithFallback(t, `profile.activity_action_${action.replace(/\./g, "_")}`, {
      category: catLabel && catLabel !== `suppliers.cat.${cat}` ? catLabel : (cat ?? ""),
    });
  }

  // Schedule events — label is the visible item name. Pull from the
  // surviving side (delete → only `before`, create → only `after`).
  if (
    action === "schedule.create" ||
    action === "schedule.update" ||
    action === "schedule.delete" ||
    action === "schedule.event_create" ||
    action === "schedule.event_update" ||
    action === "schedule.event_delete"
  ) {
    const label = asString(after?.label) ?? asString(before?.label) ?? "";
    // Normalise both whitelist variants (`schedule.create`) and the legacy
    // emitter (`schedule.event_create`) to the same i18n key.
    const normalised = action.replace("event_", "");
    return tWithFallback(t, `profile.activity_action_${normalised.replace(/\./g, "_")}`, {
      label,
    });
  }

  // DIY ("Csinálom magam") supplier entries — name lives in after for
  // create/update, in before for delete. Backend currently only emits an
  // `after` payload for create/update and none for delete, but keep both
  // lookups so we render gracefully on either shape.
  if (
    action === "couple_supplier.create" ||
    action === "couple_supplier.update" ||
    action === "couple_supplier.delete"
  ) {
    const name = asString(after?.name) ?? asString(before?.name) ?? "";
    return tWithFallback(t, `profile.activity_action_${action.replace(/\./g, "_")}`, { name });
  }

  // Guest CRUD — name lives in `before` for delete, `after` for create/update.
  // Legacy entries without a name fall back to "—" so the phrase still parses.
  if (action === "guest.create" || action === "guest.update" || action === "guest.delete") {
    const side = action === "guest.delete" ? before : after;
    return tWithFallback(t, `profile.activity_action_${action.replace(/\./g, "_")}`, {
      name: asString(side?.full_name) ?? empty,
    });
  }

  // Household CRUD. `update` has a rename variant when the label changed —
  // otherwise it's the generic "updated: {label}".
  if (action === "household.update" && (before || after)) {
    const lb = asString(before?.label);
    const la = asString(after?.label);
    if (lb && la && lb !== la) {
      return tWithFallback(t, "profile.activity_action_household_update_rename", {
        before: lb,
        after: la,
      });
    }
    return tWithFallback(t, "profile.activity_action_household_update", {
      label: la ?? lb ?? empty,
    });
  }
  if (action === "household.create" || action === "household.delete") {
    const side = action === "household.delete" ? before : after;
    return tWithFallback(t, `profile.activity_action_${action.replace(/\./g, "_")}`, {
      label: asString(side?.label) ?? empty,
    });
  }

  // Seating-table CRUD — symmetrical to households.
  if (action === "table.update") {
    const lb = asString(before?.label);
    const la = asString(after?.label);
    if (lb && la && lb !== la) {
      return tWithFallback(t, "profile.activity_action_table_update_rename", {
        before: lb,
        after: la,
      });
    }
    return tWithFallback(t, "profile.activity_action_table_update", {
      label: la ?? lb ?? empty,
    });
  }
  if (action === "table.create" || action === "table.delete") {
    const side = action === "table.delete" ? before : after;
    return tWithFallback(t, `profile.activity_action_${action.replace(/\./g, "_")}`, {
      label: asString(side?.label) ?? empty,
    });
  }

  // Budget lines: rename → before → after of label; value change →
  // `{label} (tervezett: X → Y, tényleges: A → B)` built from the numeric
  // diffs; fallback → simple "{label}".
  if (action === "budget.line_update" && (before || after)) {
    const labelBefore = asString(before?.label);
    const labelAfter = asString(after?.label);
    if (labelBefore && labelAfter && labelBefore !== labelAfter) {
      return tWithFallback(t, "profile.activity_action_budget_line_update_rename", {
        before: labelBefore,
        after: labelAfter,
      });
    }
    const segments: string[] = [];
    const plannedBefore = asNumber(before?.planned_huf);
    const plannedAfter = asNumber(after?.planned_huf);
    const actualBefore = asNumber(before?.actual_huf);
    const actualAfter = asNumber(after?.actual_huf);
    if (plannedBefore !== null && plannedAfter !== null && plannedBefore !== plannedAfter) {
      segments.push(
        `${t("profile.activity_budget_planned")}: ${formatHuf(plannedBefore, locale)} → ${formatHuf(plannedAfter, locale)}`,
      );
    }
    if (actualBefore !== null && actualAfter !== null && actualBefore !== actualAfter) {
      segments.push(
        `${t("profile.activity_budget_actual")}: ${formatHuf(actualBefore, locale)} → ${formatHuf(actualAfter, locale)}`,
      );
    }
    const label = labelAfter ?? labelBefore ?? empty;
    if (segments.length > 0) {
      return tWithFallback(t, "profile.activity_action_budget_line_update_diff", {
        label,
        changes: segments.join(", "),
      });
    }
    return tWithFallback(t, "profile.activity_action_budget_line_update", { label });
  }
  if (action === "budget.line_create" || action === "budget.line_delete") {
    const side = action === "budget.line_delete" ? before : after;
    return tWithFallback(t, `profile.activity_action_${action.replace(/\./g, "_")}`, {
      label: asString(side?.label) ?? empty,
    });
  }

  // Seat events — backend now stores resolved guest + table names so the
  // feed can read "Anna → 3. asztal" instead of "vendéget ültetett le".
  if (action === "seat.assign") {
    return tWithFallback(t, "profile.activity_action_seat_assign", {
      guest: asString(after?.guest_name) ?? empty,
      table: asString(after?.table_label) ?? empty,
    });
  }
  if (action === "seat.unassign") {
    return tWithFallback(t, "profile.activity_action_seat_unassign", {
      guest: asString(before?.guest_name) ?? empty,
    });
  }
  if (action === "seat.swap") {
    return tWithFallback(t, "profile.activity_action_seat_swap", {
      a: asString(after?.guest_a_name) ?? empty,
      b: asString(after?.guest_b_name) ?? empty,
    });
  }

  // Default: try the static label key for the action. If that's also
  // missing, fall back to the generic phrase so the user never sees a
  // raw `profile.activity_action_*` string.
  const key = `profile.activity_action_${action.replace(/\./g, "_")}`;
  const resolved = t(key);
  if (resolved !== key) return resolved;
  return t("profile.activity_action_generic");
}

/** Saved-export archive — the list of one-click "send me my data" PDFs +
 *  CSVs the user has previously downloaded. Same collapse pattern as
 *  ActivityPanel: header toggles a chevron, state lives in the component
 *  (open/close per visit, no persistence). Default closed so the section
 *  doesn't dominate the page when the archive grows. */
function DocumentsPanel({
  documents,
  locale,
  t,
  redownloading,
  removing,
  armedDeleteId,
  onRedownload,
  onDelete,
}: {
  documents: DataExportSummary[];
  locale: Locale;
  t: T;
  redownloading: number | null;
  removing: number | null;
  armedDeleteId: number | null;
  onRedownload: (doc: DataExportSummary) => void;
  onDelete: (doc: DataExportSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggleLabel = open
    ? t("profile.activity_toggle_collapse")
    : t("profile.activity_toggle_expand");
  return (
    <section className="card mt-6 p-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="documents-panel-body"
        className="flex w-full items-start gap-4 px-6 py-5 text-left transition-colors hover:bg-paper-50/60 dark:hover:bg-umber-800/40"
      >
        <span className="flex-1">
          <span className="flex items-center gap-2 text-lg text-ink-900 dark:text-paper-50">
            <Archive size={18} className="text-ink-400 dark:text-umber-400" aria-hidden />
            {t("profile.archive_title")}
          </span>
          <span className="mt-1 block text-sm text-ink-600 dark:text-umber-200">
            {t("profile.archive_body")}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 pt-1 text-xs text-ink-500 dark:text-umber-300">
          {documents.length > 0 && <span className="tabular-nums">{documents.length}</span>}
          <span className="sr-only">{toggleLabel}</span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {open && (
        <div
          id="documents-panel-body"
          className="border-t border-paper-200 px-6 py-4 dark:border-umber-700"
        >
          {/* SR announce — fires when any row goes from "Delete" to armed
           *  "Click again to confirm". Single live region for the whole list
           *  is enough since only one row can be armed at a time. */}
          <span role="status" aria-live="polite" className="sr-only">
            {armedDeleteId !== null ? t("profile.archive_delete_armed_announce") : ""}
          </span>
          {documents.length === 0 ? (
            <p className="text-sm text-ink-500 dark:text-umber-300">{t("profile.archive_empty")}</p>
          ) : (
            <ul className="divide-y divide-paper-200 dark:divide-umber-700">
              {documents.map((doc) => (
                <li key={doc.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <span className="rounded bg-paper-100 px-2 py-0.5 text-xs uppercase text-ink-600 dark:bg-umber-700/60 dark:text-umber-200">
                    {t(`profile.archive_kind_${doc.kind}` as `profile.archive_kind_${ExportKind}`)}
                    {doc.format ? ` · ${doc.format.toUpperCase()}` : ""}
                  </span>
                  <span className="font-medium text-ink-800 dark:text-paper-100">
                    {doc.filename}
                  </span>
                  <span className="text-xs text-ink-500 dark:text-umber-300">
                    {formatTimestamp(doc.created_at, locale)} · {formatBytes(doc.byte_size)}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      className="btn-outline h-8 px-3 text-xs"
                      onClick={() => onRedownload(doc)}
                      disabled={redownloading === doc.id}
                    >
                      {redownloading === doc.id
                        ? t("profile.export_downloading")
                        : t("profile.archive_redownload")}
                    </button>
                    <button
                      type="button"
                      className={`h-8 rounded-xl border px-3 text-xs transition-colors ${
                        armedDeleteId === doc.id
                          ? "border-blush-700 bg-blush-700 text-paper-50 hover:bg-blush-800"
                          : "border-paper-300 bg-white text-ink-700 hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:bg-umber-700"
                      }`}
                      onClick={() => onDelete(doc)}
                      disabled={removing === doc.id}
                    >
                      {removing === doc.id
                        ? t("profile.archive_deleting")
                        : armedDeleteId === doc.id
                          ? t("profile.archive_delete_confirm")
                          : t("profile.archive_delete")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** Dark "what happened" panel — the Profile-page audit log. Reads as a
 *  console card (ink-900 bg, paper-100 text) so the eye treats it as a
 *  log, not a content surface. Matches the user's "fekete doboz" ask.
 *  The header doubles as a collapse toggle so the long 14-day feed can
 *  be tucked away. State is component-local — there's no need to survive
 *  a refresh; users open/close per visit. */
function ActivityPanel({
  entries,
  currentUserId,
  locale,
  t,
}: {
  entries: CoupleActivityEntry[];
  currentUserId: number | null;
  locale: Locale;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  const [open, setOpen] = useState(false);
  const toggleLabel = open
    ? t("profile.activity_toggle_collapse")
    : t("profile.activity_toggle_expand");
  return (
    <section className="mt-6 overflow-hidden rounded-2xl bg-ink-900 text-paper-100 shadow-pop">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="activity-panel-body"
        className="flex w-full items-start gap-4 border-b border-ink-800 px-6 py-4 text-left transition-colors hover:bg-ink-800/40"
      >
        <span className="flex-1">
          <span className="flex items-center gap-2 text-lg text-paper-50">
            <History size={18} className="text-ink-300" aria-hidden />
            {t("profile.activity_title")}
          </span>
          <span className="mt-1 block text-xs text-ink-200">{t("profile.activity_body")}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 pt-1 text-xs text-ink-200">
          <span className="sr-only">{toggleLabel}</span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {open ? (
        entries.length === 0 ? (
          <p id="activity-panel-body" className="px-6 py-5 text-sm text-ink-300">
            {t("profile.activity_empty")}
          </p>
        ) : (
          <ul id="activity-panel-body" className="divide-y divide-ink-800">
            {entries.map((e) => {
              const actorIsSelf = e.actor_id !== null && e.actor_id === currentUserId;
              const actorName = actorIsSelf
                ? t("profile.activity_actor_you")
                : (e.actor_full_name ?? t("profile.activity_actor_unknown"));
              const phrase = renderActivityEntry(e, t, locale);
              return (
                <li
                  key={e.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-6 py-3 text-sm"
                >
                  <span className="font-medium text-paper-50">{actorName}</span>
                  <span className="text-paper-200">{phrase}</span>
                  <span className="ml-auto font-mono text-xs text-ink-300">
                    {relativeTime(e.created_at, locale, t)}
                  </span>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </section>
  );
}
