import type { AdminCoupleView, AdminEmailLogEntry, AdminUserView } from "@shared/types";
import {
  Bird,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  DollarSign,
  Flag,
  FlagOff,
  FlaskConical,
  Gift,
  Heart,
  History,
  Mail,
  RefreshCw,
  Search,
  Trash2,
  User,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
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
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
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

  // Track which users the admin has already seen. On mount we read the
  // timestamp of the previous visit (or fall back to 48h ago on first open)
  // and immediately stamp the current visit so the next open won't re-highlight
  // anything seen today.
  const NEW_SEEN_KEY = "weddly.admin.users_last_seen";
  // pageLoadTime is captured once at mount and used to enforce the 30-minute
  // green window: a user only shows as new if they joined since the last visit
  // AND within 30 minutes of this page load.
  const [pageLoadTime] = useState<number>(() => Date.now());
  const [newThreshold] = useState<number>(() => {
    const stored = localStorage.getItem(NEW_SEEN_KEY);
    return stored ? Number(stored) : Date.now() - 48 * 60 * 60 * 1000;
  });
  useEffect(() => {
    localStorage.setItem(NEW_SEEN_KEY, String(Date.now()));
  }, []);
  const isNew = (createdAt: number) =>
    createdAt > newThreshold && createdAt > pageLoadTime - 30 * 60 * 1000;
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [verifySentIds, setVerifySentIds] = useState<Set<number>>(new Set());
  // Solo-workspace "nudge partner invite" — local pending state for the
  // button spinner. The "already sent" check reads couples.invite_partner_reminded_at
  // off the AdminCoupleView so a refresh keeps the sage Mail+Check state.
  const [remindPendingCoupleId, setRemindPendingCoupleId] = useState<number | null>(null);

  // Email log panel — shows the last N email_log rows for a user so admin
  // can verify delivery of account_flagged / welcome_verify etc.
  const [emailLogUserId, setEmailLogUserId] = useState<number | null>(null);
  const [emailLog, setEmailLog] = useState<AdminEmailLogEntry[]>([]);
  const [emailLogLoading, setEmailLogLoading] = useState(false);
  const [resendFlagPending, setResendFlagPending] = useState<number | null>(null);

  async function onOpenEmailLog(u: AdminUserView) {
    if (emailLogUserId === u.id) {
      setEmailLogUserId(null);
      return;
    }
    setEmailLogUserId(u.id);
    setEmailLogLoading(true);
    try {
      const r = await adminUserApi.listEmails(u.id);
      setEmailLog(r.emails);
    } catch {
      setEmailLog([]);
    } finally {
      setEmailLogLoading(false);
    }
  }

  async function onResendFlagEmail(u: AdminUserView) {
    setResendFlagPending(u.id);
    try {
      await adminUserApi.resendFlagEmail(u.id);
      toast.success(t("admin.resend_flag_email_success"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setResendFlagPending(null);
    }
  }

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
  // Same collapsed-by-default treatment for the beta-tester bucket — the
  // team's own test workspaces live below the real-couple list.
  const [betaOpen, setBetaOpen] = useState(false);
  const [flaggedOpen, setFlaggedOpen] = useState(true);
  // The three real-signup lists (paired couples, solo workspaces, orphan
  // users) are each collapsible. They open by default — they're the page's
  // primary content — but an admin triaging a long list can fold the ones
  // they're not working. An active search force-opens all three (see the
  // `*ListOpen` derivations below) so matches never hide behind a fold.
  const [couplesOpen, setCouplesOpen] = useState(true);
  const [soloOpen, setSoloOpen] = useState(true);
  const [orphansOpen, setOrphansOpen] = useState(true);

  type WorkspaceSortKey =
    | "id"
    | "name"
    | "members"
    | "wedding_date"
    | "created_at"
    | "last_seen_at";
  const [sortKey, setSortKey] = useState<WorkspaceSortKey>("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function toggleSort(key: WorkspaceSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "last_seen_at" || key === "wedding_date" ? "asc" : "asc");
    }
  }

  function sortCouples(list: AdminCoupleView[]): AdminCoupleView[] {
    const sign = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case "id":
          return (a.id - b.id) * sign;
        case "name":
          return workspaceLabel(a).localeCompare(workspaceLabel(b), "hu") * sign;
        case "members": {
          const aCount = a.partners.filter((p) => userById.has(p.id)).length;
          const bCount = b.partners.filter((p) => userById.has(p.id)).length;
          return (aCount - bCount) * sign;
        }
        case "wedding_date": {
          const aD = a.wedding_date ?? "9999-99-99";
          const bD = b.wedding_date ?? "9999-99-99";
          return aD.localeCompare(bD) * sign;
        }
        case "created_at":
          return (a.created_at - b.created_at) * sign;
        case "last_seen_at": {
          const aTs = a.last_seen_at ?? 0;
          const bTs = b.last_seen_at ?? 0;
          return (aTs - bTs) * sign;
        }
        default:
          return 0;
      }
    });
  }

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
  // row kept for audit retention). Hide them from the main list — the hourly
  // purge sweep finalises any residue automatically, so there's nothing for an
  // admin to act on here.
  const visibleCouples = useMemo(() => couples.filter((c) => c.status !== "deleting"), [couples]);
  // Demo workspaces ("try Shrek & Fiona") are seeded by the landing-page
  // flow; keep them out of the real-couple list so the admin overview
  // reflects actual signups, but surface them in their own section below.
  // Beta-tester workspaces ("just my testers") are pulled into their own
  // collapsible section so the real-couple count reflects actual signups, not
  // the team's own test accounts. Demo wins over beta when a row is both.
  const realCouples = useMemo(
    () => visibleCouples.filter((c) => !c.is_demo && !c.is_beta_tester),
    [visibleCouples],
  );
  const betaCouples = useMemo(
    () => visibleCouples.filter((c) => !c.is_demo && c.is_beta_tester),
    [visibleCouples],
  );
  const flaggedCouples = useMemo(
    () =>
      visibleCouples.filter(
        (c) => !c.is_demo && c.partners.some((p) => userById.get(p.id)?.active_flag != null),
      ),
    [visibleCouples, userById],
  );
  const demoCouples = useMemo(() => visibleCouples.filter((c) => c.is_demo), [visibleCouples]);
  const foundingCouples = useMemo(
    () => visibleCouples.filter((c) => !c.is_demo && c.billing.is_founding_member),
    [visibleCouples],
  );
  // Demo activity in the last 24h — drives the collapsed summary headline so
  // a glance tells the admin whether the bucket is hot.
  const demoRecent24h = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return demoCouples.filter((c) => c.last_seen_at != null && c.last_seen_at >= cutoff).length;
  }, [demoCouples]);

  // Display codes are positional, not the raw DB id: real signups get a
  // gap-free 5-digit sequence ("00001"…) while demo workspaces get a separate
  // D-prefixed 4-digit one ("D0001"…). Seeding a demo (or any non-signup row)
  // no longer punches a gap into the real-couple numbering. Ordered by id
  // ascending = signup order, so "00001" is the very first couple. Counted
  // over visibleCouples — deleting tombstones are hidden, so they don't
  // reserve a number.
  const displayCodeById = useMemo(() => {
    const map = new Map<number, string>();
    const byIdAsc = (a: AdminCoupleView, b: AdminCoupleView) => a.id - b.id;
    visibleCouples
      .filter((c) => !c.is_demo)
      .sort(byIdAsc)
      .forEach((c, i) => map.set(c.id, String(i + 1).padStart(5, "0")));
    visibleCouples
      .filter((c) => c.is_demo)
      .sort(byIdAsc)
      .forEach((c, i) => map.set(c.id, `D${String(i + 1).padStart(4, "0")}`));
    return map;
  }, [visibleCouples]);
  const workspaceId = (c: AdminCoupleView): string =>
    displayCodeById.get(c.id) ?? String(c.id).padStart(5, "0");

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
  const filteredBetaCouples = useMemo(
    () => (searchQuery === "" ? betaCouples : betaCouples.filter(coupleMatches)),
    // biome-ignore lint/correctness/useExhaustiveDependencies: matcher closure
    [betaCouples, searchQuery, userById],
  );
  const filteredFlaggedCouples = useMemo(
    () => (searchQuery === "" ? flaggedCouples : flaggedCouples.filter(coupleMatches)),
    // biome-ignore lint/correctness/useExhaustiveDependencies: matcher closure
    [flaggedCouples, searchQuery, userById],
  );
  // Split the real-signup couples into actual pairs (both partners present)
  // vs solo workspaces (one member — the partner was never invited/joined).
  // Member count uses the locally-resolved partner list, mirroring the
  // `members.length === 1` check renderCoupleCard uses for the solo label.
  const couplePairs = useMemo(
    () =>
      filteredRealCouples.filter((c) => c.partners.filter((p) => userById.has(p.id)).length >= 2),
    [filteredRealCouples, userById],
  );
  const soloWorkspaces = useMemo(
    () =>
      filteredRealCouples.filter((c) => c.partners.filter((p) => userById.has(p.id)).length < 2),
    [filteredRealCouples, userById],
  );
  const totalCouplePairs = useMemo(
    () =>
      realCouples.filter((c) => c.partners.filter((p) => userById.has(p.id)).length >= 2).length,
    [realCouples, userById],
  );
  const totalSoloWorkspaces = useMemo(
    () => realCouples.filter((c) => c.partners.filter((p) => userById.has(p.id)).length < 2).length,
    [realCouples, userById],
  );
  const filteredOrphans = useMemo(
    () => (searchQuery === "" ? orphans : orphans.filter(orphanMatches)),
    // biome-ignore lint/correctness/useExhaustiveDependencies: matcher closure
    [orphans, searchQuery],
  );
  const isSearching = searchQuery !== "";
  // Auto-expand the beta bucket while searching so matching beta workspaces
  // surface inline instead of hiding behind the collapsed summary.
  const betaListOpen = betaOpen || isSearching;
  const flaggedListOpen = flaggedOpen || isSearching;
  // The collapsible real-signup lists force open during an active search so
  // hits are never hidden behind a fold; the fold toggle is suppressed then.
  const couplesListOpen = couplesOpen || isSearching;
  const soloListOpen = soloOpen || isSearching;
  const orphansListOpen = orphansOpen || isSearching;
  const totalFilteredHits =
    filteredRealCouples.length + filteredBetaCouples.length + filteredOrphans.length;

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

  // Mark / unmark a beta tester. Non-destructive — just a label — so there's
  // no confirm dialog. Because the workspace may hop between the real-couple
  // and beta sections, we refetch couples after the toggle rather than trying
  // to recompute `is_beta_tester` on the couple locally.
  async function onSetBeta(u: AdminUserView, beta: boolean) {
    setPendingId(u.id);
    try {
      const r = await adminUserApi.setBetaTester(u.id, beta);
      if (r.user) setUsers((cur) => cur.map((x) => (x.id === u.id ? r.user! : x)));
      const c2 = await adminUserApi.listCouples();
      setCouples(c2.couples);
      toast.success(beta ? t("admin.beta_set_success") : t("admin.beta_unset_success"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setPendingId(null);
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
      const r = await adminUserApi.remindInvitePartner(c.id);
      // Persist the stamp into the local couples cache so the row's
      // sage Mail+Check state survives the rest of this session without
      // a re-fetch; a hard refresh re-reads it from the server.
      setCouples((cur) =>
        cur.map((x) => (x.id === c.id ? { ...x, invite_partner_reminded_at: r.reminded_at } : x)),
      );
      toast.success(t("admin.remind_invite_partner_success"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setRemindPendingCoupleId(null);
    }
  }

  async function onToggleFree(c: AdminCoupleView) {
    const isFree = c.billing.subscription_status === "founding";
    const ok = await confirm({
      title: isFree ? t("admin.revoke_free_confirm_title") : t("admin.grant_free_confirm_title"),
      body: isFree
        ? t("admin.revoke_free_confirm_body", { workspace: workspaceLabel(c) })
        : t("admin.grant_free_confirm_body", { workspace: workspaceLabel(c) }),
      confirmLabel: isFree ? t("admin.revoke_free") : t("admin.grant_free"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    try {
      const r = isFree ? await adminUserApi.revokeFree(c.id) : await adminUserApi.grantFree(c.id);
      setCouples((cur) => cur.map((x) => (x.id === c.id ? r.couple : x)));
      toast.success(isFree ? t("admin.revoke_free_success") : t("admin.grant_free_success"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  /** Compact billing badge so the admin can see at a glance who's free. Free
   *  workspaces (founding / admin-comped) carry no pill — the green gift frame
   *  on the left already marks them, so the "free" tag is redundant. */
  function renderBillingPill(c: AdminCoupleView) {
    const s = c.billing.subscription_status;
    if (s === "founding") return null;
    if (s === "trialing") return <Pill tone="paper">{t("admin.billing_trial")}</Pill>;
    if (s === "active" || s === "past_due")
      return <Pill tone="violet">{t("admin.billing_paying")}</Pill>;
    return <Pill tone="blush">{t("admin.billing_lapsed")}</Pill>;
  }

  /** Pay-or-not marker shown right of the gift icon: green dollar + check for a
   *  paying subscriber, red X for anyone not subscribed. Free (founding)
   *  workspaces show nothing — the green gift frame already conveys "free". */
  function renderPaymentStatus(c: AdminCoupleView) {
    const s = c.billing.subscription_status;
    if (s === "founding") return null;
    return s === "active" || s === "past_due" ? (
      <span
        className="relative inline-flex items-center text-sage-600 dark:text-sage-300"
        title={t("admin.billing_paying")}
        aria-label={t("admin.billing_paying")}
      >
        <DollarSign size={14} aria-hidden />
        <span className="pointer-events-none absolute -right-1 -bottom-1 inline-flex h-3 w-3 items-center justify-center rounded-full bg-sage-500 text-paper-50 ring-1 ring-paper-50 dark:ring-umber-900">
          <Check size={8} strokeWidth={3} aria-hidden />
        </span>
      </span>
    ) : (
      <span
        className="inline-flex items-center text-blush-600 dark:text-blush-300"
        title={t("admin.billing_not_subscribed")}
        aria-label={t("admin.billing_not_subscribed")}
      >
        <X size={14} strokeWidth={2.5} aria-hidden />
      </span>
    );
  }

  function renderUserInfo(u: AdminUserView, opts: { showLastActive?: boolean } = {}) {
    const flag = u.active_flag;
    // Days-remaining countdown for the flag badge, counted in CALENDAR days
    // between today and the deletion date (both floored to local midnight), so
    // a user flagged yesterday reads "6" today, not "7". A raw ceil of the ms
    // gap would keep showing the full 7 until a complete 24h had elapsed.
    // Math.round absorbs the ±1h DST wobble. Min 0 — never a negative count;
    // once the deadline passes the hourly sweep removes the row on the next tick.
    const flagDaysLeft = flag
      ? Math.max(
          0,
          Math.round(
            (new Date(flag.scheduled_delete_at).setHours(0, 0, 0, 0) -
              new Date().setHours(0, 0, 0, 0)) /
              (24 * 60 * 60 * 1000),
          ),
        )
      : 0;
    return (
      <div className="flex min-w-0 flex-col gap-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-medium text-neutral-900 dark:text-paper-50">{u.full_name}</span>
          <span className="text-xs text-neutral-500 dark:text-umber-300 break-all">{u.email}</span>
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
            <span
              title={flag.reason}
              aria-label={t("admin.flag_badge_days_left", { n: flagDaysLeft })}
              className="inline-flex items-center gap-0.5 text-blush-600 dark:text-blush-300"
            >
              <Flag size={12} aria-hidden />
              {u.activity.prior_flag_count > 0 && (
                <span className="text-[10px] font-semibold leading-none">
                  {u.activity.prior_flag_count + 1}
                </span>
              )}
            </span>
          )}
          {u.activity.prior_flag_count > 0 && (
            <span
              title={t("admin.activity_prior_flags_tooltip", { n: u.activity.prior_flag_count })}
            >
              <Pill tone="paper" icon={<Flag size={11} aria-hidden />}>
                {u.activity.prior_flag_count}
              </Pill>
            </span>
          )}
          {opts.showLastActive && (
            <span className="text-[11px] text-neutral-500 dark:text-umber-300">
              {t("admin.table_workspace_last_active")}: {formatRelative(u.last_seen_at, locale, t)}
            </span>
          )}
        </div>
        {u.is_beta_tester && (
          <div>
            <Pill tone="sage" icon={<FlaskConical size={11} aria-hidden />}>
              {t("admin.badge_beta")}
            </Pill>
          </div>
        )}
      </div>
    );
  }

  /** Right-side per-user action cluster. Rendered into the dedicated
   *  "MŰVELETEK" grid column on the workspace list and the orphans table
   *  so every row's icons line up in the same vertical column. */
  function renderUserActions(u: AdminUserView, opts: { remindCouple?: AdminCoupleView } = {}) {
    const isSelf = currentAdmin?.id === u.id;
    const isPending = pendingId === u.id;
    const flag = u.active_flag;
    return (
      <div className="flex shrink-0 items-center justify-end gap-1.5">
        {opts.remindCouple &&
          (opts.remindCouple.invite_partner_reminded_at != null ? (
            <button
              type="button"
              disabled
              className="btn-ghost btn-sm relative inline-flex items-center text-sage-700 dark:text-sage-300"
              title={t("admin.remind_invite_partner_sent_label")}
              aria-label={t("admin.remind_invite_partner_sent_label")}
            >
              <Mail size={14} aria-hidden />
              <span className="pointer-events-none absolute -right-0.5 -bottom-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full bg-sage-500 text-paper-50 ring-1 ring-paper-50 dark:ring-umber-900">
                <Check size={8} strokeWidth={3} aria-hidden />
              </span>
            </button>
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
            <button
              type="button"
              disabled
              className="btn-ghost btn-sm relative inline-flex items-center text-sage-700 dark:text-sage-300"
              title={t("admin.resend_verify_sent_label")}
              aria-label={t("admin.resend_verify_sent_label")}
            >
              <Mail size={14} aria-hidden />
              <span className="pointer-events-none absolute -right-0.5 -bottom-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full bg-sage-500 text-paper-50 ring-1 ring-paper-50 dark:ring-umber-900">
                <Check size={8} strokeWidth={3} aria-hidden />
              </span>
            </button>
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
        {!isSelf && (
          <button
            type="button"
            className={`btn-ghost btn-sm inline-flex items-center${
              u.is_beta_tester ? " text-sage-700 dark:text-sage-300" : ""
            }`}
            onClick={() => onSetBeta(u, !u.is_beta_tester)}
            disabled={isPending}
            title={u.is_beta_tester ? t("admin.beta_unset_button") : t("admin.beta_set_button")}
            aria-label={
              u.is_beta_tester ? t("admin.beta_unset_button") : t("admin.beta_set_button")
            }
          >
            <FlaskConical size={14} aria-hidden />
          </button>
        )}
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
          <>
            <button
              type="button"
              className="btn-ghost btn-sm inline-flex items-center"
              onClick={() => onResendFlagEmail(u)}
              disabled={resendFlagPending === u.id}
              title={t("admin.resend_flag_email_button")}
              aria-label={t("admin.resend_flag_email_button")}
            >
              <RefreshCw
                size={14}
                aria-hidden
                className={resendFlagPending === u.id ? "animate-spin" : ""}
              />
            </button>
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
          </>
        )}
        <button
          type="button"
          className={`btn-ghost btn-sm inline-flex items-center${emailLogUserId === u.id ? " text-blush-700 dark:text-blush-300" : ""}`}
          onClick={() => onOpenEmailLog(u)}
          title={t("admin.email_log_button")}
          aria-label={t("admin.email_log_button")}
        >
          <History size={14} aria-hidden />
        </button>
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

  /** One workspace card — id, name, members (info + actions), created/active
   *  dates. Shared by the real-couple list and the beta-tester bucket so both
   *  render identically. */
  function renderCoupleCard(c: AdminCoupleView) {
    // Server returns partners scrubbed of users we already know are missing
    // (rare race); fall back to userById for the freshest local state.
    const members = c.partners
      .map((p) => userById.get(p.id))
      .filter((u): u is AdminUserView => u != null);
    const statusLabel = c.status === "paused" ? t("admin.workspace_status_paused") : null;
    return (
      <li
        key={c.id}
        className={`admin-card !py-2.5 transition-colors duration-150 hover:bg-paper-100/60 dark:hover:bg-umber-800/60${isNew(c.created_at) ? " bg-sage-50 dark:bg-sage-900/20" : ""}`}
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-[7rem_minmax(0,1fr)_minmax(0,2fr)_6rem_10rem_11rem] md:items-center">
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <code className="rounded bg-paper-100 dark:bg-umber-700/60 px-1.5 py-0.5 text-[11px] font-medium text-neutral-700 dark:text-paper-100">
              {workspaceId(c)}
            </code>
            {/* Early-bird mark: one of the first 200 founding couples. */}
            {!c.is_demo && c.billing.is_founding_member && (
              <span
                title={t("admin.first200_early_bird")}
                aria-label={t("admin.first200_early_bird")}
                className="text-umber-600 dark:text-umber-300"
              >
                <Bird size={14} aria-hidden />
              </span>
            )}
            {/* Grant/revoke free access — gift icon next to the ID. When the
                workspace is free (founding) the gift gets a green frame + white
                icon so it reads as "comped" at a glance; muted otherwise. */}
            {!c.is_demo && (
              <button
                type="button"
                onClick={() => onToggleFree(c)}
                className={`inline-flex items-center rounded-md p-0.5 ${
                  c.billing.subscription_status === "founding"
                    ? "border border-sage-600 bg-sage-500 text-paper-50 hover:bg-sage-600 dark:border-sage-400 dark:bg-sage-600 dark:hover:bg-sage-500"
                    : "text-neutral-400 hover:text-neutral-700 dark:text-umber-400 dark:hover:text-paper-100"
                }`}
                title={
                  c.billing.subscription_status === "founding"
                    ? t("admin.revoke_free")
                    : t("admin.grant_free")
                }
                aria-label={
                  c.billing.subscription_status === "founding"
                    ? t("admin.revoke_free")
                    : t("admin.grant_free")
                }
              >
                <Gift size={14} aria-hidden />
              </button>
            )}
            {!c.is_demo && renderPaymentStatus(c)}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-medium text-neutral-900 dark:text-paper-50">
              {workspaceLabel(c)}
            </span>
            {statusLabel && <Pill tone="muted">{statusLabel}</Pill>}
            {!c.is_demo && renderBillingPill(c)}
          </div>
          <div>
            {members.length === 0 ? (
              <span className="text-xs text-neutral-500 dark:text-umber-300">—</span>
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
          <div className="whitespace-nowrap text-xs text-neutral-500 dark:text-umber-300">
            {c.wedding_date ? (
              <span className="font-medium text-ink-700 dark:text-paper-200">{c.wedding_date}</span>
            ) : (
              <span className="text-neutral-400 dark:text-umber-500">—</span>
            )}
          </div>
          <div className="whitespace-nowrap text-xs text-neutral-500 dark:text-umber-300">
            <div>{formatDate(c.created_at, locale)}</div>
            <div className="mt-0.5 text-neutral-500/70 dark:text-umber-300/80">
              {formatRelative(c.last_seen_at, locale, t)}
            </div>
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
        <div className="px-0.5">{members.map((u) => renderEmailLogPanel(u.id))}</div>
      </li>
    );
  }

  /** Inline email delivery log for a single user. Shown when the admin
   *  clicks the History icon on a user row. Lets them verify whether
   *  account_flagged / welcome_verify / etc. actually reached the inbox. */
  function renderEmailLogPanel(userId: number) {
    if (emailLogUserId !== userId) return null;
    const statusDot = (s: AdminEmailLogEntry["status"]) => {
      if (s === "sent") return "bg-sage-500";
      if (s === "failed") return "bg-blush-500";
      return "bg-neutral-400";
    };
    return (
      <div className="mt-2 rounded-md border border-paper-200 bg-paper-50 dark:border-umber-700 dark:bg-umber-900/50 text-xs">
        <div className="flex items-center justify-between border-b border-paper-200 dark:border-umber-700 px-3 py-1.5 eyebrow text-neutral-500 dark:text-umber-300">
          <span>{t("admin.email_log_panel_title")}</span>
          {emailLogLoading && (
            <RefreshCw size={11} aria-hidden className="animate-spin text-neutral-400" />
          )}
        </div>
        {!emailLogLoading && emailLog.length === 0 && (
          <p className="px-3 py-2 text-neutral-500 dark:text-umber-400">
            {t("admin.email_log_empty")}
          </p>
        )}
        {!emailLogLoading && emailLog.length > 0 && (
          <ul className="divide-y divide-paper-200 dark:divide-umber-700/60">
            {emailLog.map((e) => (
              <li key={e.id} className="flex items-start gap-2 px-3 py-1.5">
                <span
                  className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(e.status)}`}
                  title={e.status}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0">
                    <span className="font-mono text-neutral-700 dark:text-paper-200">{e.kind}</span>
                    <span className="text-neutral-400 dark:text-umber-400">{e.to_email}</span>
                  </div>
                  {e.error && (
                    <p className="mt-0.5 font-mono text-blush-600 dark:text-blush-400 break-all">
                      {e.error}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-neutral-400 dark:text-umber-500 whitespace-nowrap">
                  {formatDate(e.created_at, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  /** Collapse / expand chevron for a section header's `actions` slot.
   *  Used by the paired-couples, solo and orphan lists so all three fold the
   *  same way; the beta/demo buckets keep their own summary-card toggles. */
  function SectionToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
    return (
      <button
        type="button"
        className="btn-ghost btn-sm inline-flex items-center gap-1"
        onClick={onToggle}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        <span>{open ? t("admin.section_hide") : t("admin.section_show")}</span>
      </button>
    );
  }

  // Shared md+ column-label row for the card lists (paired couples + solo).
  // Matches the 5-column grid the cards use so the headers line up exactly.
  function SortIcon({ col }: { col: WorkspaceSortKey }) {
    if (sortKey !== col)
      return <ChevronsUpDown size={11} className="ml-0.5 opacity-40" aria-hidden />;
    return sortDir === "asc" ? (
      <ChevronUp size={11} className="ml-0.5" aria-hidden />
    ) : (
      <ChevronDown size={11} className="ml-0.5" aria-hidden />
    );
  }
  function SortBtn({
    col,
    children,
    className,
  }: {
    col: WorkspaceSortKey;
    children: ReactNode;
    className?: string;
  }) {
    return (
      <button
        type="button"
        onClick={() => toggleSort(col)}
        className={`inline-flex cursor-pointer select-none items-center gap-0 transition-opacity hover:opacity-70 ${className ?? ""}`}
      >
        {children}
        <SortIcon col={col} />
      </button>
    );
  }
  const workspaceColumnHeader = (
    <div className="mb-2 hidden grid-cols-[7rem_minmax(0,1fr)_minmax(0,2fr)_6rem_10rem_11rem] gap-4 px-4 eyebrow md:grid">
      <SortBtn col="id">{t("admin.table_workspace_id")}</SortBtn>
      <SortBtn col="name">{t("admin.table_workspace_name")}</SortBtn>
      <SortBtn col="members">{t("admin.table_workspace_members")}</SortBtn>
      <SortBtn col="wedding_date">{t("admin.table_workspace_wedding_date")}</SortBtn>
      <div>
        <SortBtn col="created_at">{t("admin.table_workspace_created")}</SortBtn>
        <div className="mt-0.5">
          <SortBtn col="last_seen_at" className="text-neutral-500/70 dark:text-umber-300/80">
            {t("admin.table_workspace_last_active")}
          </SortBtn>
        </div>
      </div>
      <div className="text-right">{t("admin.table_admin_actions")}</div>
    </div>
  );

  return (
    <>
      <AdminPageHeader
        title={t("admin.users_title")}
        subtitle={t("admin.users_sub")}
        actions={
          !loading ? (
            <div className="flex divide-x divide-paper-300 dark:divide-umber-700">
              {(
                [
                  { key: "admin-section-couples", value: totalCouplePairs, icon: Heart },
                  { key: "admin-section-solo", value: totalSoloWorkspaces, icon: User },
                  { key: "admin-section-beta", value: betaCouples.length, icon: FlaskConical },
                  { key: "admin-section-founding", value: foundingCouples.length, icon: Gift },
                ] as const
              ).map(({ key, value, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    document
                      .getElementById(key)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                  className="flex flex-col items-center gap-0.5 px-4 text-ink-700 transition-opacity hover:opacity-70 dark:text-paper-100"
                >
                  <span className="text-2xl font-bold tabular-nums leading-none tracking-tight">
                    {value}
                  </span>
                  <Icon size={13} className="text-ink-600 dark:text-umber-300" aria-hidden />
                </button>
              ))}
            </div>
          ) : undefined
        }
      />

      {loading ? (
        <>
          <section className="mb-6">
            <AdminSectionHeader title={t("admin.workspaces_section")} />
            <div className="mb-2 hidden grid-cols-[7rem_minmax(0,1fr)_minmax(0,2fr)_6rem_10rem_11rem] gap-4 px-4 eyebrow md:grid">
              <div>{t("admin.table_workspace_id")}</div>
              <div>{t("admin.table_workspace_name")}</div>
              <div>{t("admin.table_workspace_members")}</div>
              <div>{t("admin.table_workspace_wedding_date")}</div>
              <div>
                <div>{t("admin.table_workspace_created")}</div>
                <div className="mt-0.5 text-neutral-500/70 dark:text-umber-300/80">
                  {t("admin.table_workspace_last_active")}
                </div>
              </div>
              <div className="text-right">{t("admin.table_admin_actions")}</div>
            </div>
            <ul className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <li key={i} className="admin-card">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-[7rem_minmax(0,1fr)_minmax(0,2fr)_6rem_10rem_11rem] md:items-center">
                    <Skeleton width={56} height={18} rounded="sm" />
                    <Skeleton width={160} height={16} />
                    <div className="flex flex-col gap-1.5">
                      <Skeleton width="80%" height={14} />
                      <Skeleton width="60%" height={12} />
                    </div>
                    <Skeleton width={64} height={12} />
                    <div className="flex flex-col gap-1">
                      <Skeleton width={96} height={12} />
                      <Skeleton width={72} height={11} />
                    </div>
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
           *  BELOW the app header (top-20, matching the section nav) so it never
           *  overlaps the wordmark. Opaque page-coloured band (no lighter tint,
           *  no backdrop-blur) so rows scrolling underneath are masked without a
           *  visible lighter strip. */}
          <div className="sticky top-20 z-20 -mx-4 mb-4 bg-paper-100 px-4 py-2 dark:bg-umber-900 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 xl:-mx-10 xl:px-10">
            <div className="relative">
              <Search
                size={14}
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-umber-400"
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-neutral-500 hover:bg-paper-100 dark:text-umber-300 dark:hover:bg-umber-800"
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
              {/* ── Paired couples — both partners present, one card each ── */}
              <section id="admin-section-couples" className="mb-6 scroll-mt-20">
                <AdminSectionHeader
                  title={t("admin.workspaces_section")}
                  count={t(
                    couplePairs.length === 1
                      ? "admin.couples_count_one"
                      : "admin.couples_count_other",
                    { n: couplePairs.length },
                  )}
                  collapse={
                    !isSearching
                      ? {
                          open: couplesOpen,
                          onToggle: () => setCouplesOpen((v) => !v),
                          label: t(couplesOpen ? "admin.section_hide" : "admin.section_show"),
                        }
                      : undefined
                  }
                />
                {couplesListOpen &&
                  (couplePairs.length === 0 ? (
                    <AdminEmptyState>{t("admin.couples_empty")}</AdminEmptyState>
                  ) : (
                    <>
                      {workspaceColumnHeader}
                      <ul className="space-y-1.5">
                        {sortCouples(couplePairs).map(renderCoupleCard)}
                      </ul>
                    </>
                  ))}
              </section>

              {/* ── Solo workspaces — one member, partner never joined ───── */}
              <section id="admin-section-solo" className="mb-6 scroll-mt-20">
                <AdminSectionHeader
                  title={t("admin.solo_section")}
                  count={t(
                    soloWorkspaces.length === 1 ? "admin.solo_count_one" : "admin.solo_count_other",
                    { n: soloWorkspaces.length },
                  )}
                  collapse={
                    !isSearching
                      ? {
                          open: soloOpen,
                          onToggle: () => setSoloOpen((v) => !v),
                          label: t(soloOpen ? "admin.section_hide" : "admin.section_show"),
                        }
                      : undefined
                  }
                />
                {soloListOpen &&
                  (soloWorkspaces.length === 0 ? (
                    <AdminEmptyState>{t("admin.solo_empty")}</AdminEmptyState>
                  ) : (
                    <>
                      {workspaceColumnHeader}
                      <ul className="space-y-1.5">
                        {sortCouples(soloWorkspaces).map(renderCoupleCard)}
                      </ul>
                    </>
                  ))}
              </section>

              {/* ── Beta testers — admin-marked test accounts, bucketed out of
               *  the real-couple list so signup metrics stay honest. Collapsed
               *  by default like the demo bucket, but unlike demos it stays
               *  searchable: an active search auto-expands the list to reveal
               *  matching beta workspaces. ──────────────────────────────────── */}
              {flaggedCouples.length > 0 && (filteredFlaggedCouples.length > 0 || !isSearching) && (
                <section className="mb-6">
                  <AdminSectionHeader
                    title={t("admin.flagged_section")}
                    count={t(
                      flaggedCouples.length === 1
                        ? "admin.flagged_count_one"
                        : "admin.flagged_count_other",
                      { n: flaggedCouples.length },
                    )}
                    collapse={
                      !isSearching
                        ? {
                            open: flaggedOpen,
                            onToggle: () => setFlaggedOpen((v) => !v),
                            label: t(flaggedOpen ? "admin.section_hide" : "admin.section_show"),
                          }
                        : undefined
                    }
                  />
                  {flaggedListOpen &&
                    (filteredFlaggedCouples.length === 0 ? (
                      <AdminEmptyState>{t("admin.couples_empty")}</AdminEmptyState>
                    ) : (
                      <ul className="space-y-1.5">
                        {filteredFlaggedCouples.map(renderCoupleCard)}
                      </ul>
                    ))}
                </section>
              )}

              {betaCouples.length > 0 && (filteredBetaCouples.length > 0 || !isSearching) && (
                <section id="admin-section-beta" className="mb-6 scroll-mt-20">
                  <AdminSectionHeader
                    title={t("admin.beta_workspaces_section")}
                    count={t(
                      betaCouples.length === 1
                        ? "admin.beta_workspaces_summary_one"
                        : "admin.beta_workspaces_summary_other",
                      { n: betaCouples.length },
                    )}
                    collapse={
                      !isSearching
                        ? {
                            open: betaOpen,
                            onToggle: () => setBetaOpen((v) => !v),
                            label: t(betaOpen ? "admin.section_hide" : "admin.section_show"),
                          }
                        : undefined
                    }
                  />
                  {betaListOpen &&
                    (filteredBetaCouples.length === 0 ? (
                      <AdminEmptyState>{t("admin.couples_empty")}</AdminEmptyState>
                    ) : (
                      <ul className="space-y-1.5">{filteredBetaCouples.map(renderCoupleCard)}</ul>
                    ))}
                </section>
              )}

              {/* ── Demo workspaces — landing-page "try Shrek & Fiona" seedlings.
               *  Collapsed by default to a one-line summary so the real-couple
               *  list owns the above-the-fold space. The demo-purge worker on the
               *  backend reaps these on its own schedule, so no destructive
               *  action surface here. Suppressed entirely while the admin is
               *  actively searching — the search results live in the workspaces
               *  + orphans lists above. ────────────────────────────────────── */}
              {!isSearching && demoCouples.length > 0 && (
                <section id="admin-section-demo" className="mb-6 scroll-mt-20">
                  <AdminSectionHeader
                    title={t("admin.demo_workspaces_section")}
                    count={
                      <span>
                        {t(
                          demoCouples.length === 1
                            ? "admin.demo_workspaces_summary_one"
                            : "admin.demo_workspaces_summary_other",
                          { n: demoCouples.length },
                        )}{" "}
                        <span className="text-neutral-400 dark:text-umber-400">
                          · {t("admin.demo_workspaces_recent_24h", { n: demoRecent24h })}
                        </span>
                      </span>
                    }
                    collapse={{
                      open: demoOpen,
                      onToggle: () => setDemoOpen((v) => !v),
                      label: t(demoOpen ? "admin.section_hide" : "admin.section_show"),
                    }}
                  />
                  {demoOpen && (
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
                            <div className="grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1.4fr)_10rem] md:items-center">
                              <div className="whitespace-nowrap">
                                <code className="rounded bg-paper-100 dark:bg-umber-700/60 px-1.5 py-0.5 text-[11px] font-medium text-neutral-700 dark:text-paper-100">
                                  {workspaceId(c)}
                                </code>
                              </div>
                              <div className="flex items-center gap-2 text-sm text-neutral-700 dark:text-paper-100">
                                <Pill tone="muted">{t("admin.demo_badge")}</Pill>
                                <span className="truncate">{workspaceLabel(c)}</span>
                              </div>
                              <div className="truncate text-xs text-neutral-500 dark:text-umber-300">
                                {firstMemberEmail}
                              </div>
                              <div className="whitespace-nowrap text-xs text-neutral-500 dark:text-umber-300">
                                <div>{formatDate(c.created_at, locale)}</div>
                                <div className="mt-0.5 text-neutral-500/70 dark:text-umber-300/80">
                                  {formatRelative(c.last_seen_at, locale, t)}
                                </div>
                              </div>
                            </div>
                            {c.demo_feature_counts !== null && (
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                                <span className="text-neutral-500 dark:text-umber-300">
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
                                    <span className="ml-1 text-neutral-500 dark:text-umber-300">
                                      {n}
                                    </span>
                                  </Pill>
                                ))}
                                {hidden > 0 && (
                                  <span className="text-neutral-500 dark:text-umber-300">
                                    {t("admin.demo_feature_more", { n: hidden })}
                                  </span>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
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
                  actions={
                    !isSearching ? (
                      <SectionToggle
                        open={orphansOpen}
                        onToggle={() => setOrphansOpen((v) => !v)}
                      />
                    ) : undefined
                  }
                />
                {orphansListOpen &&
                  (filteredOrphans.length === 0 ? (
                    <AdminEmptyState>{t("admin.orphans_empty")}</AdminEmptyState>
                  ) : (
                    <div className="admin-card overflow-x-auto !p-0">
                      <table className="min-w-full text-sm">
                        <thead className="bg-paper-100 text-left eyebrow dark:bg-umber-700/60">
                          <tr>
                            <th className="px-3 py-2">{t("admin.table_name")}</th>
                            <th className="px-3 py-2 text-right">
                              {t("admin.table_admin_actions")}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredOrphans.map((u) => (
                            <>
                              <tr
                                key={u.id}
                                className={`border-t border-paper-200 transition-colors duration-150 hover:bg-paper-100/60 dark:border-umber-700 dark:hover:bg-umber-700/40${isNew(u.created_at) ? " bg-sage-50 dark:bg-sage-900/20" : ""}`}
                              >
                                <td className="px-3 py-2">
                                  {renderUserInfo(u, { showLastActive: true })}
                                </td>
                                <td className="px-3 py-2 text-right align-middle">
                                  {renderUserActions(u)}
                                </td>
                              </tr>
                              {emailLogUserId === u.id && (
                                <tr
                                  key={`${u.id}-emails`}
                                  className="border-t border-paper-200 dark:border-umber-700"
                                >
                                  <td colSpan={2} className="px-3 pb-2">
                                    {renderEmailLogPanel(u.id)}
                                  </td>
                                </tr>
                              )}
                            </>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
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
