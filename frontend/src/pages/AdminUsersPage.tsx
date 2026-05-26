import type { AdminCoupleView, AdminUserView } from "@shared/types";
import {
  Check,
  Flag,
  FlagOff,
  Lightbulb,
  Mail,
  MessageCircle,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AdminEmptyState, AdminPageHeader, AdminSectionHeader, Pill } from "../components/admin";
import { FlagUserDialog } from "../components/FlagUserDialog";
import { Skeleton, useConfirm, useEntryPrompt, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { adminUserApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

/** `created_at` is Unix milliseconds (see backend/src/db.ts `now()`). Mirrors
 *  the formatter on AdminSuppliersPage so the admin pages render dates
 *  identically (e.g. "2026. máj. 12."). */
function formatDate(unixMs: number, locale: string): string {
  const d = new Date(unixMs);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

/** Coarse-grained "X minutes/hours/days ago" for the Last-active column. We
 *  show absolute dates beyond a week so the column doesn't drift into "47
 *  days ago" territory where the date itself is more informative. */
function formatRelative(
  unixMs: number | null,
  locale: string,
  t: (k: string, vars?: Record<string, string | number>) => string,
): string {
  if (unixMs == null) return t("admin.last_active_never");
  const diff = Date.now() - unixMs;
  if (diff < 60 * 1000) return t("admin.last_active_now");
  const mins = Math.floor(diff / (60 * 1000));
  if (mins < 60) return t("admin.last_active_minutes", { n: mins });
  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours < 24) return t("admin.last_active_hours", { n: hours });
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days < 7) return t("admin.last_active_days", { n: days });
  return formatDate(unixMs, locale);
}

/** Zero-padded 5-digit numeric workspace code (e.g. couple.id=7 → "00007").
 *  Stable across reloads and trivially sortable; the human-meaningful
 *  `slug` is still available on the type for other consumers. */
function workspaceId(c: AdminCoupleView): string {
  return String(c.id).padStart(5, "0");
}

function workspaceLabel(c: AdminCoupleView): string {
  if (c.display_name && c.display_name.trim()) return c.display_name;
  const a = c.bride_name?.trim();
  const b = c.groom_name?.trim();
  if (a && b) return `${a} & ${b}`;
  return a || b || `#${c.id}`;
}

export default function AdminUsersPage() {
  const { t, locale } = useT();
  const { user: currentAdmin } = useAuth();
  const toast = useToast();
  const promptEntry = useEntryPrompt();
  const confirm = useConfirm();
  const [users, setUsers] = useState<AdminUserView[]>([]);
  const [couples, setCouples] = useState<AdminCoupleView[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [verifySentIds, setVerifySentIds] = useState<Set<number>>(new Set());
  const [purgingDeleting, setPurgingDeleting] = useState(false);
  // Solo-workspace "nudge partner invite" — track which couple is currently
  // mid-request (button spinner) and which we've already nudged this session
  // (swap the icon for a checkmark so the admin sees their click landed).
  const [remindPendingCoupleId, setRemindPendingCoupleId] = useState<number | null>(null);
  const [remindSentCoupleIds, setRemindSentCoupleIds] = useState<Set<number>>(new Set());

  // Sticky client-side search across name / email / workspace id / slug.
  // We keep the raw input separate from the debounced query so typing stays
  // responsive (no re-filter on every keystroke when the list is large) but
  // the search input itself is fully controlled. 150ms feels snappy without
  // burning re-renders on each character — same pacing as the supplier
  // directory filter.
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  useEffect(() => {
    const handle = window.setTimeout(() => setSearchQuery(searchInput.trim().toLowerCase()), 150);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  // Collapsed-by-default demo summary. Real couples win the above-the-fold
  // real estate; the demo list opens on demand. Stays collapsed across
  // re-fetches because the state is component-local — that's intentional,
  // an admin who opened it expects it to stay open while triaging.
  const [demoOpen, setDemoOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([adminUserApi.listUsers(), adminUserApi.listCouples()])
      .then(([u, c]) => {
        if (cancelled) return;
        setUsers(u.users);
        setCouples(c.couples);
      })
      .catch((e) => {
        if (cancelled) return;
        toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [toast, t]);

  // Split rows into "in a workspace" vs "orphan" so each couple collapses
  // into a single line (members listed inside) instead of one row per user.
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const orphans = useMemo(() => users.filter((u) => u.couple_id == null), [users]);
  // Couples flagged "deleting" are already-purged tombstones (PII scrubbed,
  // row kept for audit retention). Hide them from the main list and surface a
  // one-shot purge action so admins can sweep the residue.
  const visibleCouples = useMemo(() => couples.filter((c) => c.status !== "deleting"), [couples]);
  const deletingCount = useMemo(
    () => couples.filter((c) => c.status === "deleting").length,
    [couples],
  );
  // Demo workspaces ("try Shrek & Fiona") are seeded by the landing-page
  // flow; keep them out of the real-couple list so the admin overview
  // reflects actual signups, but surface them in their own section below.
  const realCouples = useMemo(() => visibleCouples.filter((c) => !c.is_demo), [visibleCouples]);
  const demoCouples = useMemo(() => visibleCouples.filter((c) => c.is_demo), [visibleCouples]);
  // Demo activity in the last 24h — drives the collapsed summary headline so
  // a glance tells the admin whether the bucket is hot.
  const demoRecent24h = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return demoCouples.filter((c) => c.last_seen_at != null && c.last_seen_at >= cutoff).length;
  }, [demoCouples]);

  // ── Search predicates ───────────────────────────────────────────────────
  // Match the workspace by id (padded code), slug, display name, bride/groom
  // names, and every member's name + email. Match orphans by their own name +
  // email. The query is already lower-cased + trimmed in the debounced state.
  function matchesQuery(haystacks: (string | null | undefined)[], q: string): boolean {
    if (q === "") return true;
    for (const raw of haystacks) {
      if (!raw) continue;
      if (raw.toLowerCase().includes(q)) return true;
    }
    return false;
  }
  function coupleMatches(c: AdminCoupleView): boolean {
    if (searchQuery === "") return true;
    const members = c.partners
      .map((p) => userById.get(p.id))
      .filter((u): u is AdminUserView => u != null);
    const memberFields: string[] = [];
    for (const m of members) {
      memberFields.push(m.full_name, m.email);
    }
    for (const p of c.partners) {
      memberFields.push(p.full_name, p.email);
    }
    return matchesQuery(
      [c.display_name, c.slug, c.bride_name, c.groom_name, workspaceId(c), ...memberFields],
      searchQuery,
    );
  }
  function orphanMatches(u: AdminUserView): boolean {
    if (searchQuery === "") return true;
    return matchesQuery([u.full_name, u.email], searchQuery);
  }

  const filteredRealCouples = useMemo(
    () => (searchQuery === "" ? realCouples : realCouples.filter(coupleMatches)),
    // coupleMatches closes over searchQuery + userById; both are deps already
    // captured by the realCouples + searchQuery deps.
    // biome-ignore lint/correctness/useExhaustiveDependencies: matcher closure
    [realCouples, searchQuery, userById],
  );
  const filteredOrphans = useMemo(
    () => (searchQuery === "" ? orphans : orphans.filter(orphanMatches)),
    // biome-ignore lint/correctness/useExhaustiveDependencies: matcher closure
    [orphans, searchQuery],
  );
  const isSearching = searchQuery !== "";
  const totalFilteredHits = filteredRealCouples.length + filteredOrphans.length;

  async function onResendVerify(u: AdminUserView) {
    setPendingId(u.id);
    try {
      const r = await adminUserApi.resendVerify(u.id);
      if (r.already_verified) {
        toast.success(t("admin.resend_verify_already"));
        setUsers((cur) => cur.map((x) => (x.id === u.id ? { ...x, verified_email: true } : x)));
      } else {
        toast.success(t("admin.resend_verify_sent"));
        setVerifySentIds((prev) => {
          const next = new Set(prev);
          next.add(u.id);
          return next;
        });
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setPendingId(null);
    }
  }

  async function onDelete(u: AdminUserView) {
    if (currentAdmin && u.id === currentAdmin.id) {
      toast.error(t("admin.delete_user_cannot_self"));
      return;
    }
    const phrase = t("admin.delete_user_confirm_phrase");
    const result = await promptEntry({
      title: `${t("admin.delete_user_confirm_title")} — ${u.email}`,
      label: t("admin.delete_user_confirm_label"),
      placeholder: t("admin.delete_user_confirm_placeholder"),
      helperText: t("admin.delete_user_confirm_help"),
      confirmLabel: t("admin.delete_user"),
      cancelLabel: t("common.cancel"),
      validate: (v) =>
        v.trim().toLowerCase() === phrase.toLowerCase()
          ? null
          : t("admin.delete_user_confirm_mismatch"),
    });
    if (result === null) return;
    const ok = await confirm({
      title: t("admin.delete_user_confirm_title"),
      body: u.email,
      confirmLabel: t("admin.delete_user"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setPendingId(u.id);
    try {
      await adminUserApi.remove(u.id);
      // Server `purgeOneUser` either scrubs the user PII (orphan) or purges
      // the whole couple workspace. Re-fetch to surface the new state — too
      // many invariants to patch in-place reliably.
      const [u2, c2] = await Promise.all([adminUserApi.listUsers(), adminUserApi.listCouples()]);
      setUsers(u2.users);
      setCouples(c2.couples);
      toast.success(t("admin.delete_user_success"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setPendingId(null);
    }
  }

  // The flag flow uses a dedicated dialog (template chips + textarea)
  // instead of the generic single-input prompt, so we manage the open
  // state + target here. `flagTarget` is the AdminUserView we're acting
  // on; `flagPending` flips while the request is in flight.
  const [flagTarget, setFlagTarget] = useState<AdminUserView | null>(null);
  const [flagPending, setFlagPending] = useState(false);

  function onFlag(u: AdminUserView) {
    if (currentAdmin && u.id === currentAdmin.id) {
      toast.error(t("admin.flag_cannot_self"));
      return;
    }
    setFlagTarget(u);
  }

  async function onFlagConfirm(reason: string) {
    if (!flagTarget) return;
    const target = flagTarget;
    setFlagPending(true);
    setPendingId(target.id);
    try {
      const r = await adminUserApi.flag(target.id, reason);
      if (r.user) setUsers((cur) => cur.map((x) => (x.id === target.id ? r.user! : x)));
      toast.success(t("admin.flag_user_success"));
      setFlagTarget(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setFlagPending(false);
      setPendingId(null);
    }
  }

  async function onUnflag(u: AdminUserView) {
    const note = await promptEntry({
      title: t("admin.unflag_user_title"),
      label: t("admin.unflag_user_label"),
      placeholder: t("admin.unflag_user_placeholder"),
      helperText: t("admin.unflag_user_help"),
      confirmLabel: t("admin.unflag_user_clear"),
      cancelLabel: t("common.cancel"),
      // Note is optional — accept empty.
      validate: () => null,
    });
    if (note === null) return;
    setPendingId(u.id);
    try {
      const r = await adminUserApi.unflag(u.id, note.trim());
      if (r.user) setUsers((cur) => cur.map((x) => (x.id === u.id ? r.user! : x)));
      toast.success(t("admin.unflag_user_success"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setPendingId(null);
    }
  }

  async function onPurgeDeleting() {
    if (deletingCount === 0) return;
    const ok = await confirm({
      title: t("admin.purge_deleting_confirm_title"),
      body: t("admin.purge_deleting_confirm_body", { n: deletingCount }),
      confirmLabel: t("admin.purge_deleting_confirm"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setPurgingDeleting(true);
    try {
      const r = await adminUserApi.purgeDeleting();
      const [u2, c2] = await Promise.all([adminUserApi.listUsers(), adminUserApi.listCouples()]);
      setUsers(u2.users);
      setCouples(c2.couples);
      toast.success(t("admin.purge_deleting_success", { n: r.purged }));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setPurgingDeleting(false);
    }
  }

  async function onRemindInvitePartner(c: AdminCoupleView) {
    const ok = await confirm({
      title: t("admin.remind_invite_partner_confirm_title"),
      body: t("admin.remind_invite_partner_confirm_body", { workspace: workspaceLabel(c) }),
      confirmLabel: t("admin.remind_invite_partner_confirm"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    setRemindPendingCoupleId(c.id);
    try {
      await adminUserApi.remindInvitePartner(c.id);
      setRemindSentCoupleIds((prev) => {
        const next = new Set(prev);
        next.add(c.id);
        return next;
      });
      toast.success(t("admin.remind_invite_partner_success"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setRemindPendingCoupleId(null);
    }
  }

  function renderUserInfo(u: AdminUserView, opts: { showLastActive?: boolean } = {}) {
    const flag = u.active_flag;
    // Days-remaining countdown for the flag badge. Min 0 — we never display
    // a negative count; once the deadline passes the hourly sweep removes
    // the row entirely on the next tick.
    const flagDaysLeft = flag
      ? Math.max(0, Math.ceil((flag.scheduled_delete_at - Date.now()) / (24 * 60 * 60 * 1000)))
      : 0;
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-medium text-ink-900 dark:text-paper-50">{u.full_name}</span>
        <span className="text-xs text-ink-500 dark:text-umber-300 break-all">{u.email}</span>
        {u.is_admin && (
          <Pill tone="violet" srLabel={t("admin.badge_admin")}>
            {t("admin.badge_admin")}
          </Pill>
        )}
        {u.status === "suspended" && (
          <Pill tone="muted" srLabel={t("admin.badge_suspended")}>
            {t("admin.badge_suspended")}
          </Pill>
        )}
        {!u.verified_email && <Pill tone="muted">{t("admin.badge_unverified")}</Pill>}
        {flag && (
          <span title={flag.reason}>
            <Pill tone="blush" icon={<Flag size={11} aria-hidden />}>
              {t("admin.flag_badge_days_left", { n: flagDaysLeft })}
            </Pill>
          </span>
        )}
        {u.activity.prior_flag_count > 0 && (
          <span title={t("admin.activity_prior_flags_tooltip", { n: u.activity.prior_flag_count })}>
            <Pill tone="paper" icon={<Flag size={11} aria-hidden />}>
              {u.activity.prior_flag_count}
            </Pill>
          </span>
        )}
        {u.activity.supplier_tip_count > 0 && (
          <span
            title={t("admin.activity_supplier_tips_tooltip", {
              n: u.activity.supplier_tip_count,
              when: formatRelative(u.activity.supplier_tip_last_at, locale, t),
            })}
          >
            <Pill tone="violet" icon={<Lightbulb size={11} aria-hidden />}>
              {t("admin.activity_supplier_tips", { n: u.activity.supplier_tip_count })}
            </Pill>
          </span>
        )}
        {u.activity.feedback_count > 0 && (
          <span
            title={t("admin.activity_feedback_tooltip", {
              n: u.activity.feedback_count,
              when: formatRelative(u.activity.feedback_last_at, locale, t),
            })}
          >
            <Pill tone="violet" icon={<MessageCircle size={11} aria-hidden />}>
              {t("admin.activity_feedback", { n: u.activity.feedback_count })}
            </Pill>
          </span>
        )}
        {opts.showLastActive && (
          <span className="text-[11px] text-ink-500 dark:text-umber-300">
            {t("admin.table_workspace_last_active")}: {formatRelative(u.last_seen_at, locale, t)}
          </span>
        )}
      </div>
    );
  }

  /** Right-side per-user action cluster. Rendered into the dedicated
   *  "MŰVELETEK" grid column on the workspace list and the orphans table
   *  so every row's icons line up in the same vertical column. */
  function renderUserActions(
    u: AdminUserView,
    opts: { remindCouple?: AdminCoupleView } = {},
  ) {
    const isSelf = currentAdmin?.id === u.id;
    const isPending = pendingId === u.id;
    const flag = u.active_flag;
    return (
      <div className="flex shrink-0 items-center justify-end gap-1.5">
        {opts.remindCouple &&
          (remindSentCoupleIds.has(opts.remindCouple.id) ? (
            <Pill tone="sage" icon={<Check size={11} aria-hidden />}>
              {t("admin.remind_invite_partner_sent_label")}
            </Pill>
          ) : (
            <button
              type="button"
              className="btn-ghost btn-sm inline-flex items-center"
              onClick={() => opts.remindCouple && onRemindInvitePartner(opts.remindCouple)}
              disabled={remindPendingCoupleId === opts.remindCouple.id}
              title={t("admin.remind_invite_partner_tooltip")}
              aria-label={t("admin.remind_invite_partner_aria")}
            >
              <Mail size={14} aria-hidden />
            </button>
          ))}
        {!u.verified_email &&
          (verifySentIds.has(u.id) ? (
            <Pill tone="sage" icon={<Check size={11} aria-hidden />}>
              {t("admin.resend_verify_sent_label")}
            </Pill>
          ) : (
            <button
              type="button"
              className="btn-ghost btn-sm inline-flex items-center"
              onClick={() => onResendVerify(u)}
              disabled={isPending}
              title={t("admin.resend_verify")}
              aria-label={t("admin.resend_verify")}
            >
              <Mail size={14} aria-hidden />
            </button>
          ))}
        {!isSelf && !flag && (
          <button
            type="button"
            className="btn-ghost btn-sm inline-flex items-center"
            onClick={() => onFlag(u)}
            disabled={isPending}
            title={t("admin.flag_user_button")}
            aria-label={t("admin.flag_user_button")}
          >
            <Flag size={14} aria-hidden />
          </button>
        )}
        {!isSelf && flag && (
          <button
            type="button"
            className="btn-ghost btn-sm inline-flex items-center text-blush-800 dark:text-blush-300"
            onClick={() => onUnflag(u)}
            disabled={isPending}
            title={t("admin.unflag_user_button")}
            aria-label={t("admin.unflag_user_button")}
          >
            <FlagOff size={14} aria-hidden />
          </button>
        )}
        {!isSelf && (
          <button
            type="button"
            className="btn-alert btn-sm inline-flex items-center"
            onClick={() => onDelete(u)}
            disabled={isPending}
            title={t("admin.delete_user")}
            aria-label={t("admin.delete_user")}
          >
            <Trash2 size={14} aria-hidden />
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <AdminPageHeader title={t("admin.users_title")} subtitle={t("admin.users_sub")} />

      {loading ? (
        <>
          <section className="mb-6">
            <AdminSectionHeader title={t("admin.workspaces_section")} />
            <div className="mb-2 hidden grid-cols-[7rem_minmax(0,1fr)_minmax(0,2fr)_9rem_9rem_auto] gap-4 px-5 eyebrow md:grid">
              <div>{t("admin.table_workspace_id")}</div>
              <div>{t("admin.table_workspace_name")}</div>
              <div>{t("admin.table_workspace_members")}</div>
              <div>{t("admin.table_workspace_created")}</div>
              <div>{t("admin.table_workspace_last_active")}</div>
              <div className="text-right">{t("admin.table_admin_actions")}</div>
            </div>
            <ul className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <li key={i} className="admin-card">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-[7rem_minmax(0,1fr)_minmax(0,2fr)_9rem_9rem_auto] md:items-start">
                    <Skeleton width={56} height={18} rounded="sm" />
                    <Skeleton width={160} height={16} />
                    <div className="flex flex-col gap-1.5">
                      <Skeleton width="80%" height={14} />
                      <Skeleton width="60%" height={12} />
                    </div>
                    <Skeleton width={96} height={12} />
                    <Skeleton width={80} height={12} />
                    <div className="flex justify-end gap-1.5">
                      <Skeleton width={28} height={28} rounded="md" />
                      <Skeleton width={28} height={28} rounded="md" />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <AdminSectionHeader title={t("admin.orphans_section")} />
            <div className="card overflow-x-auto p-0">
              <table className="min-w-full text-sm">
                <thead className="bg-paper-100 text-left eyebrow dark:bg-umber-700/60">
                  <tr>
                    <th className="px-3 py-2">{t("admin.table_name")}</th>
                    <th className="px-3 py-2 text-right">{t("admin.table_admin_actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-t border-paper-200 dark:border-umber-700">
                      <td className="px-3 py-2" colSpan={2}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                            <Skeleton width={120} height={14} />
                            <Skeleton width={180} height={12} />
                            <Skeleton width={56} height={16} rounded="full" />
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Skeleton width={28} height={28} rounded="md" />
                            <Skeleton width={28} height={28} rounded="md" />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <>
          {/* ── Sticky search bar ──────────────────────────────────────────
           *  Filters every list below (workspaces, demos, orphans). Sticky
           *  so the search field stays in view while the admin scrolls a
           *  long workspace list. Pad the top so it doesn't overlap the
           *  page header on first paint, and add a subtle backdrop so the
           *  fade behind it reads correctly in dark mode too. */}
          <div className="sticky top-0 z-20 -mx-4 mb-4 bg-paper-50/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-paper-50/80 dark:bg-umber-900/95 dark:supports-[backdrop-filter]:bg-umber-900/80 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 xl:-mx-10 xl:px-10">
            <div className="relative">
              <Search
                size={14}
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-umber-400"
              />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t("admin.users_search_placeholder")}
                aria-label={t("admin.users_search_placeholder")}
                className="input pl-9 pr-9"
              />
              {searchInput !== "" && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-500 hover:bg-paper-100 dark:text-umber-300 dark:hover:bg-umber-800"
                  onClick={() => {
                    setSearchInput("");
                    setSearchQuery("");
                  }}
                  aria-label={t("admin.users_search_clear")}
                >
                  <X size={14} aria-hidden />
                </button>
              )}
            </div>
          </div>

          {/* When the search returns no hits in EITHER workspace or orphan
           *  lists, hand off to the empty state. Demo workspaces are hidden
           *  during active search regardless. */}
          {isSearching && totalFilteredHits === 0 ? (
            <AdminEmptyState
              icon={<Search size={28} aria-hidden />}
              title={t("admin.users_search_empty")}
              description={t("admin.users_search_empty_help")}
              action={
                <button
                  type="button"
                  className="btn-outline btn-sm"
                  onClick={() => {
                    setSearchInput("");
                    setSearchQuery("");
                  }}
                >
                  {t("admin.users_search_clear")}
                </button>
              }
            />
          ) : (
            <>
              {/* ── Workspaces (couples) — one card per couple ──────────── */}
              <section className="mb-6">
                <AdminSectionHeader
                  title={t("admin.workspaces_section")}
                  count={t(
                    filteredRealCouples.length === 1
                      ? "admin.workspaces_count_one"
                      : "admin.workspaces_count_other",
                    { n: filteredRealCouples.length },
                  )}
                  actions={
                    deletingCount > 0 ? (
                      <button
                        type="button"
                        className="btn-ghost btn-sm text-blush-700 hover:bg-blush-50 dark:text-blush-300 dark:hover:bg-blush-400/15"
                        onClick={onPurgeDeleting}
                        disabled={purgingDeleting}
                      >
                        {t("admin.purge_deleting_button", { n: deletingCount })}
                      </button>
                    ) : undefined
                  }
                />
                {filteredRealCouples.length === 0 ? (
                  <AdminEmptyState>{t("admin.couples_empty")}</AdminEmptyState>
                ) : (
                  <>
                    {/* Card-style row header — uses the same 4-column grid as the
                     *  rows below so the labels line up exactly. Hidden on small
                     *  screens (rows stack vertically there). */}
                    <div className="mb-2 hidden grid-cols-[7rem_minmax(0,1fr)_minmax(0,2fr)_9rem_9rem_auto] gap-4 px-5 eyebrow md:grid">
                      <div>{t("admin.table_workspace_id")}</div>
                      <div>{t("admin.table_workspace_name")}</div>
                      <div>{t("admin.table_workspace_members")}</div>
                      <div>{t("admin.table_workspace_created")}</div>
                      <div>{t("admin.table_workspace_last_active")}</div>
                      <div className="text-right">{t("admin.table_admin_actions")}</div>
                    </div>
                    <ul className="space-y-2">
                      {filteredRealCouples.map((c) => {
                        // Server returns partners scrubbed of users we already
                        // know are missing (rare race); fall back to userById
                        // for the freshest local state.
                        const members = c.partners
                          .map((p) => userById.get(p.id))
                          .filter((u): u is AdminUserView => u != null);
                        const statusLabel =
                          c.status === "paused" ? t("admin.workspace_status_paused") : null;
                        return (
                          <li
                            key={c.id}
                            className="admin-card transition-colors duration-150 hover:bg-paper-100/60 dark:hover:bg-umber-800/60"
                          >
                            <div className="grid grid-cols-1 gap-x-4 gap-y-2 md:grid-cols-[7rem_minmax(0,1fr)_minmax(0,2fr)_9rem_9rem_auto] md:items-start">
                              <div className="whitespace-nowrap">
                                <code className="rounded bg-paper-100 dark:bg-umber-700/60 px-1.5 py-0.5 text-[11px] font-medium text-ink-700 dark:text-paper-100">
                                  {workspaceId(c)}
                                </code>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <span className="font-medium text-ink-900 dark:text-paper-50">
                                  {workspaceLabel(c)}
                                </span>
                                {statusLabel && <Pill tone="muted">{statusLabel}</Pill>}
                                {members.length === 1 && (
                                  <span className="text-[11px] text-ink-500 dark:text-umber-300">
                                    {t("admin.workspace_solo_member")}
                                  </span>
                                )}
                              </div>
                              <div>
                                {members.length === 0 ? (
                                  <span className="text-xs text-ink-500 dark:text-umber-300">
                                    —
                                  </span>
                                ) : (
                                  <ul className="divide-y divide-paper-200/70 dark:divide-umber-700">
                                    {members.map((u) => (
                                      <li key={u.id} className="py-1 first:pt-0 last:pb-0">
                                        {renderUserInfo(u)}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              <div className="whitespace-nowrap text-xs text-ink-500 dark:text-umber-300">
                                {formatDate(c.created_at, locale)}
                              </div>
                              <div className="whitespace-nowrap text-xs text-ink-500 dark:text-umber-300">
                                {formatRelative(c.last_seen_at, locale, t)}
                              </div>
                              <div>
                                {members.length === 0 ? null : (
                                  <ul className="divide-y divide-paper-200/70 dark:divide-umber-700">
                                    {members.map((u) => (
                                      <li key={u.id} className="py-1 first:pt-0 last:pb-0">
                                        {renderUserActions(u, {
                                          remindCouple: members.length === 1 ? c : undefined,
                                        })}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </section>

              {/* ── Demo workspaces — landing-page "try Shrek & Fiona" seedlings.
               *  Collapsed by default to a one-line summary so the real-couple
               *  list owns the above-the-fold space. The demo-purge worker on the
               *  backend reaps these on its own schedule, so no destructive
               *  action surface here. Suppressed entirely while the admin is
               *  actively searching — the search results live in the workspaces
               *  + orphans lists above. ────────────────────────────────────── */}
              {!isSearching && demoCouples.length > 0 && (
                <section className="mb-6">
                  <div className="admin-card flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-ink-700 dark:text-paper-100">
                      <Pill tone="muted">{t("admin.demo_badge")}</Pill>
                      <span>
                        {t(
                          demoCouples.length === 1
                            ? "admin.demo_workspaces_summary_one"
                            : "admin.demo_workspaces_summary_other",
                          { n: demoCouples.length },
                        )}
                      </span>
                      <span className="text-ink-500 dark:text-umber-300">
                        · {t("admin.demo_workspaces_recent_24h", { n: demoRecent24h })}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => setDemoOpen((v) => !v)}
                      aria-expanded={demoOpen}
                    >
                      {demoOpen ? t("admin.demo_workspaces_hide") : t("admin.demo_workspaces_show")}
                    </button>
                  </div>
                  {demoOpen && (
                    <>
                      <div className="mt-3">
                        <AdminSectionHeader
                          title={t("admin.demo_workspaces_section")}
                          description={t("admin.demo_workspaces_help")}
                        />
                      </div>
                      <ul className="space-y-1.5">
                        {demoCouples.map((c) => {
                          const members = c.partners
                            .map((p) => userById.get(p.id))
                            .filter((u): u is AdminUserView => u != null);
                          const firstMemberEmail = members[0]?.email ?? "—";
                          // Feature-usage chips: sort by event count desc, show the
                          // top 6 inline + a "+N more" pill when the demo went deep.
                          const counts = c.demo_feature_counts ?? {};
                          const total = c.demo_total_events ?? 0;
                          // The demo.start row is bookkeeping noise — strip it so the
                          // chips only reflect what the visitor actually touched.
                          const usable = Object.entries(counts).filter(
                            ([feature]) => feature !== "demo",
                          );
                          const usableTotal = usable.reduce((s, [, n]) => s + n, 0);
                          const sortedFeatures = usable.sort(
                            (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
                          );
                          const visible = sortedFeatures.slice(0, 6);
                          const hidden = sortedFeatures.length - visible.length;
                          return (
                            <li
                              key={c.id}
                              className="admin-card transition-colors duration-150 hover:bg-paper-100/60 dark:hover:bg-umber-800/60"
                            >
                              <div className="grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1.4fr)_9rem_9rem] md:items-center">
                                <div className="whitespace-nowrap">
                                  <code className="rounded bg-paper-100 dark:bg-umber-700/60 px-1.5 py-0.5 text-[11px] font-medium text-ink-700 dark:text-paper-100">
                                    {workspaceId(c)}
                                  </code>
                                </div>
                                <div className="flex items-center gap-2 text-sm text-ink-700 dark:text-paper-100">
                                  <Pill tone="muted">{t("admin.demo_badge")}</Pill>
                                  <span className="truncate">{workspaceLabel(c)}</span>
                                </div>
                                <div className="truncate text-xs text-ink-500 dark:text-umber-300">
                                  {firstMemberEmail}
                                </div>
                                <div className="whitespace-nowrap text-xs text-ink-500 dark:text-umber-300">
                                  {formatDate(c.created_at, locale)}
                                </div>
                                <div className="whitespace-nowrap text-xs text-ink-500 dark:text-umber-300">
                                  {formatRelative(c.last_seen_at, locale, t)}
                                </div>
                              </div>
                              {c.demo_feature_counts !== null && (
                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                                  <span className="text-ink-500 dark:text-umber-300">
                                    {usableTotal === 0
                                      ? t("admin.demo_events_none")
                                      : t(
                                          total === 1
                                            ? "admin.demo_events_label_one"
                                            : "admin.demo_events_label_other",
                                          { n: total },
                                        )}
                                  </span>
                                  {visible.map(([feature, n]) => (
                                    <Pill key={feature} tone="paper">
                                      <span className="font-medium">{feature}</span>
                                      <span className="ml-1 text-ink-500 dark:text-umber-300">
                                        {n}
                                      </span>
                                    </Pill>
                                  ))}
                                  {hidden > 0 && (
                                    <span className="text-ink-500 dark:text-umber-300">
                                      {t("admin.demo_feature_more", { n: hidden })}
                                    </span>
                                  )}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </section>
              )}

              {/* ── Orphan users — no workspace yet ───────────────────────── */}
              <section>
                <AdminSectionHeader
                  title={t("admin.orphans_section")}
                  count={t(
                    filteredOrphans.length === 1
                      ? "admin.orphans_count_one"
                      : "admin.orphans_count_other",
                    { n: filteredOrphans.length },
                  )}
                />
                {filteredOrphans.length === 0 ? (
                  <AdminEmptyState>{t("admin.orphans_empty")}</AdminEmptyState>
                ) : (
                  <div className="admin-card overflow-x-auto !p-0">
                    <table className="min-w-full text-sm">
                      <thead className="bg-paper-100 text-left eyebrow dark:bg-umber-700/60">
                        <tr>
                          <th className="px-3 py-2">{t("admin.table_name")}</th>
                          <th className="px-3 py-2 text-right">{t("admin.table_admin_actions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOrphans.map((u) => (
                          <tr
                            key={u.id}
                            className="border-t border-paper-200 transition-colors duration-150 hover:bg-paper-100/60 dark:border-umber-700 dark:hover:bg-umber-700/40"
                          >
                            <td className="px-3 py-2">
                              {renderUserInfo(u, { showLastActive: true })}
                            </td>
                            <td className="px-3 py-2 text-right align-middle">
                              {renderUserActions(u)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
      <FlagUserDialog
        open={flagTarget !== null}
        targetEmail={flagTarget?.email ?? ""}
        pending={flagPending}
        onClose={() => {
          if (!flagPending) setFlagTarget(null);
        }}
        onConfirm={onFlagConfirm}
      />
    </>
  );
}
