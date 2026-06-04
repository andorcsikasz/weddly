// Profile: workspace ops only — payments placeholder, security, export,
// saved download archive, delete account.

import type {
  BudgetLine,
  Couple,
  CoupleActivityEntry,
  CoupleInvite,
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
  Copy,
  Download,
  Globe,
  Heart,
  Link2,
  LogOut,
  Mail,
  Pencil,
  ShieldCheck,
  Tablet,
  Trash2,
  Wallet,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { CountryCombobox } from "../components/CountryCombobox";
import { useConfirm, useEntryPrompt, useToast } from "../components/ui";
import { WorkspacesPanel } from "../components/WorkspacesPanel";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
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
  formatMoney,
  formatTimestamp,
  isPlausibleDateIso,
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

/** Discrete settings tabs the Settings hub renders. When set, only the
 *  sections in that tab render. When undefined, the page renders the
 *  full pre-restructure layout — kept as a fallback for callers that
 *  haven't migrated to the per-tab Settings routes yet. */
export type ProfileTab = "account" | "workspace" | "planning" | "data";

export default function ProfilePage({ tab }: { tab?: ProfileTab } = {}) {
  const showAccount = !tab || tab === "account";
  const showWorkspace = !tab || tab === "workspace";
  const showPlanning = !tab || tab === "planning";
  const showData = !tab || tab === "data";
  // Hero band only paints on the legacy all-tabs view — the SettingsLayout
  // wraps each sub-page with its own hero, so re-rendering it inside the
  // page body would double-stack.
  const showHero = !tab;
  const { t, locale } = useT();
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
  // Pending partner invite (token + invited email), hydrated when partner B
  // hasn't joined yet — drives the inline invite form, the shareable link, and
  // the copy/cancel controls right here on the partner card.
  const [invite, setInvite] = useState<CoupleInvite | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteEmailError, setInviteEmailError] = useState<string | null>(null);
  const [inviteSending, setInviteSending] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [cancellingInvite, setCancellingInvite] = useState(false);
  /** Two-click confirmation for cancel-invite — invalidating the partner's
   *  link is irreversible, so a single accidental tap shouldn't fire it.
   *  Mirrors the archive-document delete pattern below (4s auto-disarm). */
  const [armedCancelInvite, setArmedCancelInvite] = useState(false);
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
    const [pause, current, docs, partnerRes, lines, inviteRes] = await Promise.all([
      pauseApi.status(),
      coupleApi.current(),
      documentsApi.list(),
      coupleApi.partner(),
      budgetApi.listLines(),
      // Hydrate any in-flight invite so the partner card can show the shareable
      // link + copy/cancel across reloads. Returns { invite: null } once
      // partner B has joined or no invite is outstanding.
      coupleApi
        .currentInvite()
        .catch(() => ({ invite: null })),
    ]);
    setCoupleStatus(pause.couple_status);
    setPauseReq(pause.pause_request);
    setCouple(current.couple);
    setDocuments(docs.exports);
    setPartner(partnerRes.partner);
    setBudgetLines(lines.lines);
    setInvite(inviteRes.invite);
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

  const inviteUrl = invite ? `${window.location.origin}/invite/${invite.token}` : null;

  // Send (or just create) a partner invite straight from the partner card.
  // `withEmail=true` mails the link to the typed address (the "send a message
  // to your partner" path); `false` just mints a shareable link to copy.
  async function sendInvite(withEmail: boolean) {
    const trimmed = inviteEmail.trim();
    if (withEmail) {
      if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        setInviteEmailError(t("dashboard.invite_email_invalid"));
        return;
      }
      if (authUser && trimmed.toLowerCase() === authUser.email.toLowerCase()) {
        setInviteEmailError(t("dashboard.invite_email_own"));
        return;
      }
    }
    setInviteEmailError(null);
    setInviteSending(true);
    try {
      const r = await coupleApi.createInvite(
        withEmail && trimmed ? { invited_email: trimmed } : {},
      );
      setInvite(r.invite);
      if (withEmail) {
        toast.success(t("dashboard.invite_sent_body", { email: trimmed }));
        setInviteEmail("");
        refresh();
      } else {
        // Link-only: copy it to the clipboard right away so the one action does
        // both ("create + copy") the way the button label promises, then refresh
        // so the card flips to the pending-invite view (link + cancel).
        navigator.clipboard?.writeText(`${window.location.origin}/invite/${r.invite.token}`);
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 1500);
        refresh();
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const code = (err.detail as { code?: string } | null)?.code;
        if (code === "invite_own_email") setInviteEmailError(t("dashboard.invite_email_own"));
        else toast.error(err.message);
      } else {
        toast.error(t("common.error_generic"));
      }
    } finally {
      setInviteSending(false);
    }
  }

  function copyInviteLink() {
    if (!inviteUrl) return;
    navigator.clipboard?.writeText(inviteUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1500);
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
      // Optimistic: clear the partner card + invite so the inline form
      // re-appears for a fresh send. refresh() to also pick up any
      // server-side state changes.
      setPartner(null);
      setInvite(null);
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

  /** Persist a new wedding-country pick. Drives supplier-region filtering;
   *  flipping it doesn't otherwise touch the workspace state. The combobox
   *  fires onChange with "" while the user is typing — we ignore those
   *  intermediate writes and only save once a known ISO code is committed. */
  async function saveCountry(next: string) {
    if (!next || next === couple?.country) return;
    try {
      const r = await coupleApi.update({ country: next });
      setCouple(r.couple);
      toast.success(t("profile.country_save_done"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error_generic"));
    }
  }

  return (
    <>
      {/* Visually-hidden h1 — hero band IS the visual heading but doesn't
       *  carry an h1, so the document outline still gets one. */}
      <h1 className="sr-only">{t("profile.title")}</h1>

      {showHero && <ProfileHero couple={couple} t={t} locale={locale} onUpdated={setCouple} />}

      {!tab && <ZoneLabel>{t("profile.zone_workspace")}</ZoneLabel>}

      {showAccount && (
        <AccountSection
          user={authUser}
          t={t}
          locale={locale}
          /* `silent: true` — Profile has its own currency picker (couple.currency)
           *  and persists the locale via userApi.updateProfile, so the public
           *  first-language-switch prompt would be redundant noise here. */
          onLocaleChange={(next) => setLocale(next, { silent: true })}
          onSaved={() => {
            refreshAuth();
          }}
        />
      )}

      {showWorkspace && (
        <section className="card mt-6">
          <h2 className="flex items-center gap-2 font-grotesk text-lg">
            <Heart size={18} className="text-ink-400 dark:text-umber-400" aria-hidden />
            {t("profile.partner_title")}
          </h2>
          <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">
            {t("profile.partner_body")}
          </p>
          {partner ? (
            <>
              {/* The previous layout was a single `flex-wrap items-center`
               *  row where the status pill stole ~120px and the long
               *  partner email fell back to `break-all` — producing the
               *  ugly mid-word "saraazawiasa@gma\nil.com" wrap. New shape:
               *  monogram on the left, name+pill share the top line of
               *  the column, email gets the full column width on its own
               *  line with `truncate` so it shows an ellipsis instead of
               *  ever wrapping. */}
              <div className="mt-4 flex items-start gap-3">
                <PartnerMonogram
                  fullName={partner.full_name ?? ""}
                  email={partner.email ?? ""}
                  joined={partner.status === "joined" || partner.status === "active"}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate font-medium text-ink-900 dark:text-paper-50">
                      {partner.full_name ?? t("profile.partner_no_name")}
                    </p>
                    <PartnerStatusPill status={partner.status} t={t} />
                  </div>
                  <p className="mt-0.5 truncate text-sm text-ink-600 dark:text-umber-200">
                    {partner.email ?? t("profile.partner_no_email")}
                  </p>
                </div>
              </div>
              {partner.status === "invited" && (
                <div className="mt-4 space-y-3">
                  {/* Shareable invite link, copyable straight from the card. */}
                  {inviteUrl && (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input className="input flex-1" readOnly value={inviteUrl} />
                      <button type="button" className="btn-outline" onClick={copyInviteLink}>
                        <Copy size={16} />
                        {linkCopied ? t("dashboard.link_copied") : t("dashboard.copy_link")}
                      </button>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
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
                </div>
              )}
            </>
          ) : couple?.is_demo ? (
            <p className="mt-4 text-sm text-ink-500 dark:text-umber-300">
              {t("profile.partner_none")}
            </p>
          ) : (
            /* No partner yet: invite them right here. Type an email to send the
             *  invite, or mint a shareable link to copy and send yourself. */
            <form
              className="mt-4"
              onSubmit={(e) => {
                e.preventDefault();
                sendInvite(true);
              }}
            >
              <label htmlFor="partner-invite-email" className="field-label">
                {t("dashboard.invite_email_label")}
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="partner-invite-email"
                  type="email"
                  autoComplete="email"
                  className={`input flex-1 ${inviteEmailError ? "input-invalid" : ""}`}
                  placeholder={t("dashboard.invite_email_placeholder")}
                  value={inviteEmail}
                  disabled={inviteSending}
                  onChange={(e) => {
                    setInviteEmail(e.target.value);
                    if (inviteEmailError) setInviteEmailError(null);
                  }}
                  aria-invalid={inviteEmailError ? true : undefined}
                />
                <button type="submit" className="btn-primary" disabled={inviteSending}>
                  <Mail size={16} />
                  {inviteSending ? t("dashboard.invite_sending") : t("dashboard.invite_send")}
                </button>
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => sendInvite(false)}
                  disabled={inviteSending}
                >
                  <Link2 size={16} />
                  {linkCopied ? t("dashboard.link_copied") : t("dashboard.copy_link")}
                </button>
              </div>
              {inviteEmailError ? (
                <p className="field-error">{inviteEmailError}</p>
              ) : (
                <p className="field-help">{t("dashboard.invite_email_help")}</p>
              )}
            </form>
          )}
        </section>
      )}

      {showWorkspace && <WorkspacesPanel activeCoupleId={couple?.id ?? null} />}

      {!tab && <ZoneLabel>{t("profile.zone_planning")}</ZoneLabel>}

      {showPlanning && (
        <section className="card mt-6">
          {/* Header row: title left, currency picker right. The picker stays
           *  inline with the heading so the section opens with one compact
           *  band instead of a stacked label-on-top-of-pills layout. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2 className="flex items-center gap-2 font-grotesk text-lg">
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
      )}

      {showPlanning && couple && (
        <section className="card mt-6">
          <h2 className="flex items-center gap-2 font-grotesk text-lg">
            <Globe size={18} className="text-ink-400 dark:text-umber-400" aria-hidden />
            {t("profile.country_label")}
          </h2>
          <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">
            {t("profile.country_helper")}
          </p>
          <div className="mt-4 max-w-sm">
            <CountryCombobox
              value={couple.country}
              onChange={(code) => {
                void saveCountry(code);
              }}
              label={t("profile.country_label")}
            />
          </div>
        </section>
      )}

      {showWorkspace && (
        <WelcomeDeskCard couple={couple} t={t} onToggled={(updated) => setCouple(updated)} />
      )}

      {!tab && <ZoneLabel>{t("profile.zone_account")}</ZoneLabel>}

      {showAccount && (
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
      )}

      {showData && (
        <section className="card mt-6">
          <h2 className="flex items-center gap-2 font-grotesk text-lg">
            <Download size={18} className="text-ink-400 dark:text-umber-400" aria-hidden />
            {t("profile.export_title")}
          </h2>
          <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">
            {t("profile.export_body")}
          </p>
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
              {csvExporting
                ? t("profile.export_downloading")
                : t("profile.export_guest_csv_button")}
            </button>
          </div>
        </section>
      )}

      {showData && (
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
      )}

      {showAccount && authUser && couple && (
        <section className="card mt-6">
          <h2 className="flex items-center gap-2 font-grotesk text-lg">
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

      {showAccount && (
        <section className="card mt-6 border-2 border-blush-500 bg-blush-50/40 dark:bg-blush-400/15">
          <h2 className="flex items-center gap-2 font-grotesk text-lg text-blush-800 dark:text-blush-300">
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
            <button
              type="button"
              className="btn-accent mt-4"
              onClick={startPause}
              disabled={!couple}
            >
              {t("profile.delete_account_button")}
            </button>
          )}
          {error && <p className="field-error mt-3">{error}</p>}
        </section>
      )}
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
    <h2 className="mt-10 px-1 font-grotesk text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400 dark:text-umber-400">
      {children}
    </h2>
  );
}

/** Top-of-page identity strip. Replaces the bare "Profile" h1 with a
 *  wedding-themed band: couple monogram, names, the wedding date, and a
 *  big tabular-nums days-until counter. Renders a graceful placeholder
 *  during the initial /api/couples/current fetch so the page never paints
 *  empty space. Wedding-day = today fires a celebratory line; past dates
 *  flip to "X days married" so the counter doesn't read negative.
 *
 *  The names line is click-to-edit: pencil reveals two inline inputs
 *  (bride + groom) with Save / Cancel. No rate limit; partners can
 *  iterate freely. */
export function ProfileHero({
  couple,
  t,
  locale,
  onUpdated,
}: {
  couple: Couple | null;
  t: T;
  locale: Locale;
  /** Called with the refreshed couple after a successful rename so the
   *  parent page can update its in-memory state. Optional: legacy callers
   *  without it still see the rename on the next /current fetch. */
  onUpdated?: (next: Couple) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [brideInput, setBrideInput] = useState("");
  const [groomInput, setGroomInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);

  const editingPrev = useRef(false);
  useEffect(() => {
    if (editingPrev.current && !editing) editTriggerRef.current?.focus();
    editingPrev.current = editing;
  }, [editing]);

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

  function beginEdit() {
    setBrideInput(couple?.bride_name ?? "");
    setGroomInput(couple?.groom_name ?? "");
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  async function saveNames(e: FormEvent) {
    e.preventDefault();
    if (!couple) return;
    const nextBride = brideInput.trim();
    const nextGroom = groomInput.trim();
    if (
      nextBride.length < 1 ||
      nextBride.length > 100 ||
      nextGroom.length < 1 ||
      nextGroom.length > 100
    ) {
      setError(t("profile.hero_name_save_error"));
      return;
    }
    if (nextBride === couple.bride_name && nextGroom === couple.groom_name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await coupleApi.update({
        bride_name: nextBride,
        groom_name: nextGroom,
      });
      onUpdated?.(r.couple);
      toast.success(t("profile.hero_name_save_success"));
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-2 overflow-hidden rounded-2xl bg-paper-200 shadow-pop dark:bg-umber-800">
      {/* Single-row flex on mobile so the three columns sit side-by-side
       *  instead of wrap-stacking — the previous `flex-wrap items-center
       *  gap-y-4` plus `text-2xl` serif squeezed the names column to ~100px
       *  on a 360px viewport, which forced each word ("Andor", "és",
       *  "Sári") onto its own line. Smaller name font + `truncate` keeps
       *  the names on one line; the days counter shrinks too and uses a
       *  one-word caption below `sm:` so it doesn't steal back the width. */}
      <div className="flex items-center gap-3 px-4 py-4 sm:gap-6 sm:px-8 sm:py-6">
        <CoupleMonogram bride={bride} groom={groom} />
        <div className="min-w-0 flex-1">
          {editing ? (
            <form
              onSubmit={saveNames}
              className="flex flex-wrap items-center gap-2"
              aria-label={t("profile.hero_name_edit")}
            >
              <input
                type="text"
                value={brideInput}
                onChange={(ev) => setBrideInput(ev.target.value)}
                placeholder={t("profile.hero_name_bride_placeholder")}
                className="input h-10 min-w-[8rem] flex-1 py-0 text-sm"
                maxLength={100}
                autoFocus
                disabled={saving}
                aria-label={t("profile.hero_name_bride_placeholder")}
              />
              <input
                type="text"
                value={groomInput}
                onChange={(ev) => setGroomInput(ev.target.value)}
                placeholder={t("profile.hero_name_groom_placeholder")}
                className="input h-10 min-w-[8rem] flex-1 py-0 text-sm"
                maxLength={100}
                disabled={saving}
                aria-label={t("profile.hero_name_groom_placeholder")}
              />
              <button
                type="submit"
                className="btn-sm btn-primary !px-3 !py-1.5 !text-xs"
                disabled={saving}
              >
                {saving ? t("common.saving") : t("common.save")}
              </button>
              <button
                type="button"
                className="btn-sm btn-outline !px-3 !py-1.5 !text-xs"
                onClick={cancelEdit}
                disabled={saving}
              >
                {t("common.cancel")}
              </button>
              {error && (
                <p className="basis-full text-[11px] text-blush-700 dark:text-blush-300">{error}</p>
              )}
            </form>
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate font-grotesk text-xl leading-snug tracking-tight text-ink-900 sm:text-3xl dark:text-paper-50">
                  {namesLine || t("profile.title")}
                </p>
                <button
                  ref={editTriggerRef}
                  type="button"
                  onClick={beginEdit}
                  className="inline-flex shrink-0 items-center rounded-full p-1 text-ink-400 hover:bg-paper-100 hover:text-ink-800 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
                  aria-label={t("profile.hero_name_edit")}
                  title={t("profile.hero_name_edit")}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              <p className="mt-0.5 truncate text-xs text-ink-600 sm:mt-1 sm:text-sm dark:text-umber-200">
                {isPlausibleDateIso(couple.wedding_date)
                  ? formatDate(couple.wedding_date, locale)
                  : t("profile.hero_date_tbd")}
              </p>
            </>
          )}
        </div>
        {days !== null && !editing && (
          <div className="shrink-0 text-right">
            <p className="font-grotesk text-2xl leading-none tabular-nums text-ink-900 sm:text-4xl dark:text-paper-50">
              {Math.abs(days)}
            </p>
            {/* Long "Még 361 nap az esküvőig" / "361 days until your
             *  wedding" caption stays on tablet+ but mobile gets a single
             *  word — the big number above carries the count already and
             *  the verbose caption was the chief width-thief. */}
            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-ink-500 sm:hidden dark:text-umber-300">
              {t("profile.hero_days_caption_short")}
            </p>
            <p className="mt-1 hidden text-[11px] uppercase tracking-wide text-ink-500 sm:block dark:text-umber-300">
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
          <h2 className="font-grotesk text-lg">{t("profile.account_title")}</h2>
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
          {/* `truncate` over the prior `break-all` so long addresses end
           *  with an ellipsis instead of breaking mid-character (e.g.
           *  `andor.csikasz@gma…l.com`). `title` keeps the full address
           *  available on hover / long-press for users who need to read
           *  the whole thing. */}
          <p
            className="mt-1 truncate text-base text-ink-800 dark:text-paper-100"
            title={user.email}
          >
            {user.email}
          </p>
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

/** Wedding-day "Welcome Desk" card — the couple flips this when they set
 *  up a kiosk tablet at the entrance. The toggle is the source of truth
 *  for the status pill (green BE / muted KI) and decides whether the
 *  "open RSVP in kiosk mode" launcher button is enabled. The kiosk link
 *  itself doesn't change behavior; the persistent flag means the owner
 *  can glance at /app/settings/workspace on any device and see whether
 *  the tablet at the venue is currently live. */
function WelcomeDeskCard({
  couple,
  t,
  onToggled,
}: {
  couple: Couple | null;
  t: T;
  onToggled: (next: Couple) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = couple?.welcome_desk_active === true;

  async function flip() {
    if (!couple || saving) return;
    setSaving(true);
    setError(null);
    try {
      const r = await coupleApi.update({ welcome_desk_active: !active });
      onToggled(r.couple);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card mt-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-grotesk text-lg">
            <Tablet size={18} className="text-ink-400 dark:text-umber-400" aria-hidden />
            {t("profile.welcome_desk_title")}
          </h2>
          <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">
            {t("profile.welcome_desk_body")}
          </p>
        </div>
        {/* Status pill — colour-codes the current state so the owner can
         *  scan it from across the room. Green dot + "BE" when live;
         *  muted neutral + "KI" when the kiosk isn't running. */}
        <WelcomeDeskStatusPill active={active} t={t} />
      </div>

      {/* Toggle switch + state label. Native checkbox under the hood so
       *  keyboard (Space) + screen readers (announced as "switch, on/off")
       *  work for free; the visual is a sliding pill driven by `peer-*`. */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            role="switch"
            className="peer sr-only"
            checked={active}
            onChange={flip}
            disabled={saving || !couple}
            aria-label={t("profile.welcome_desk_toggle_aria")}
          />
          <span
            aria-hidden
            className={`relative h-7 w-12 rounded-full transition-colors ${
              active ? "bg-sage-500 dark:bg-sage-400" : "bg-paper-300 dark:bg-umber-700"
            } peer-focus-visible:ring-2 peer-focus-visible:ring-ink-700 peer-focus-visible:ring-offset-2 dark:peer-focus-visible:ring-paper-100 dark:peer-focus-visible:ring-offset-umber-900`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                active ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </span>
          <span className="text-sm font-medium text-ink-700 dark:text-paper-100">
            {saving
              ? t("common.saving")
              : active
                ? t("profile.welcome_desk_toggle_on")
                : t("profile.welcome_desk_toggle_off")}
          </span>
        </label>

        {/* Launcher — only visible when the toggle is on AND we have a
         *  slug. Without the slug the public RSVP URL doesn't resolve, so
         *  showing the button would just dead-end the user. */}
        {active && couple?.slug && (
          <a
            href={`/rsvp?couple=${encodeURIComponent(couple.slug)}&kiosk=1`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary inline-flex"
          >
            <Tablet size={14} aria-hidden />
            {t("profile.welcome_desk_button")}
            <span className="sr-only"> {t("common.opens_new_tab")}</span>
          </a>
        )}
      </div>

      {/* No-slug fallback. We still surface the toggle above — flipping it
       *  to "on" is the gesture, and the slug warning is informational. */}
      {!couple?.slug && (
        <p className="mt-3 rounded-xl border border-blush-300 bg-white px-4 py-3 text-sm text-ink-700 dark:border-blush-400/40 dark:bg-umber-800 dark:text-paper-100">
          {t("profile.welcome_desk_no_slug")}
        </p>
      )}

      {error && <p className="field-error mt-3">{error}</p>}
    </section>
  );
}

/** Colour-coded status pill for the Welcome Desk card. Sage = live,
 *  paper = inactive. Same shape as PartnerStatusPill so the two pills
 *  on adjacent cards read as a family. */
function WelcomeDeskStatusPill({ active, t }: { active: boolean; t: T }) {
  const cls = active
    ? "bg-sage-100 text-sage-800 border border-sage-200 dark:bg-sage-400/15 dark:text-sage-200 dark:border-sage-400/40"
    : "bg-paper-200 text-ink-700 border border-paper-300 dark:bg-umber-700 dark:text-paper-100 dark:border-umber-700";
  const dot = active ? "bg-sage-600 dark:bg-sage-300" : "bg-ink-400 dark:bg-umber-400";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${cls}`}
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
      {active ? t("profile.welcome_desk_status_on") : t("profile.welcome_desk_status_off")}
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
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-medium ${cls}`}
    >
      {t(`profile.partner_status_${status}`)}
    </span>
  );
}

/** Shorthand for the localized-string function — kept local to this file
 *  so DocumentsPanel / SecuritySection / CurrencyPicker / etc. can take
 *  it as a prop without each re-declaring the same signature. */
type T = (path: string, vars?: Record<string, string | number>) => string;

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
