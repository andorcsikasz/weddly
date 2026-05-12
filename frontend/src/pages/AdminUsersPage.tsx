import type { AdminCoupleView, AdminUserView } from "@shared/types";
import { Check, Mail, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { useConfirm, useEntryPrompt, useToast } from "../components/ui";
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

  function workspaceLabel(c: AdminCoupleView): string {
    if (c.display_name && c.display_name.trim()) return c.display_name;
    const a = c.bride_name?.trim();
    const b = c.groom_name?.trim();
    if (a && b) return `${a} & ${b}`;
    return a || b || `#${c.id}`;
  }

  /** Zero-padded 5-digit numeric workspace code (e.g. couple.id=7 → "00007").
   *  Stable across reloads and trivially sortable; the human-meaningful
   *  `slug` is still available on the type for other consumers. */
  function workspaceId(c: AdminCoupleView): string {
    return String(c.id).padStart(5, "0");
  }

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

  function renderUserCell(u: AdminUserView) {
    const isSelf = currentAdmin?.id === u.id;
    const isPending = pendingId === u.id;
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-medium text-ink-900">{u.full_name}</span>
          <span className="text-xs text-ink-500 break-all">{u.email}</span>
          {u.is_admin && <Badge tone="violet">{t("admin.badge_admin")}</Badge>}
          {u.status === "suspended" && (
            <Badge tone="violet-soft">{t("admin.badge_suspended")}</Badge>
          )}
          {!u.verified_email && <Badge tone="muted">{t("admin.badge_unverified")}</Badge>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!u.verified_email &&
            (verifySentIds.has(u.id) ? (
              <span
                className="inline-flex items-center gap-1 rounded-md bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-800"
                title={t("admin.resend_verify_sent_label")}
              >
                <Check size={12} aria-hidden />
              </span>
            ) : (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => onResendVerify(u)}
                disabled={isPending}
                title={t("admin.resend_verify")}
                aria-label={t("admin.resend_verify")}
              >
                <Mail size={14} />
              </button>
            ))}
          {!isSelf && (
            <button
              type="button"
              className="btn-ghost btn-sm text-violet-800"
              onClick={() => onDelete(u)}
              disabled={isPending}
              title={t("admin.delete_user")}
              aria-label={t("admin.delete_user")}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <AppShell>
      <header className="mb-6">
        <h1>{t("admin.users_title")}</h1>
        <p className="mt-1 text-sm text-ink-500">{t("admin.users_sub")}</p>
      </header>

      {loading ? (
        <div className="text-sm text-ink-500">{t("common.loading")}</div>
      ) : (
        <>
          {/* ── Workspaces (couples) — one card per couple ────────────────── */}
          <section className="mb-10">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold text-ink-900">
                {t("admin.workspaces_section")}
              </h2>
              <div className="flex items-center gap-3">
                {deletingCount > 0 && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm text-violet-800"
                    onClick={onPurgeDeleting}
                    disabled={purgingDeleting}
                  >
                    {t("admin.purge_deleting_button", { n: deletingCount })}
                  </button>
                )}
                <span className="text-xs uppercase tracking-wide text-ink-500">
                  {t(
                    visibleCouples.length === 1
                      ? "admin.workspaces_count_one"
                      : "admin.workspaces_count_other",
                    { n: visibleCouples.length },
                  )}
                </span>
              </div>
            </div>
            {visibleCouples.length === 0 ? (
              <div className="card text-sm text-ink-500">{t("admin.couples_empty")}</div>
            ) : (
              <>
                {/* Card-style row header — uses the same 4-column grid as the
                 *  rows below so the labels line up exactly. Hidden on small
                 *  screens (rows stack vertically there). */}
                <div className="mb-2 hidden grid-cols-[7rem_minmax(0,1fr)_minmax(0,2fr)_8rem] gap-4 px-5 text-[11px] uppercase tracking-wide text-ink-500 md:grid">
                  <div>{t("admin.table_workspace_id")}</div>
                  <div>{t("admin.table_workspace_name")}</div>
                  <div>{t("admin.table_workspace_members")}</div>
                  <div>{t("admin.table_workspace_created")}</div>
                </div>
                <ul className="space-y-3">
                  {visibleCouples.map((c) => {
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
                        className="rounded-2xl border-2 border-paper-300 bg-white px-5 py-4 shadow-soft"
                      >
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-[7rem_minmax(0,1fr)_minmax(0,2fr)_8rem] md:items-center">
                          <div className="whitespace-nowrap">
                            <code className="rounded bg-paper-100 px-1.5 py-0.5 text-[11px] font-medium text-ink-700">
                              {workspaceId(c)}
                            </code>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="font-medium text-ink-900">{workspaceLabel(c)}</span>
                            {statusLabel && <Badge tone="muted">{statusLabel}</Badge>}
                            {members.length === 1 && (
                              <span className="text-[11px] italic text-ink-500">
                                {t("admin.workspace_solo_member")}
                              </span>
                            )}
                          </div>
                          <div>
                            {members.length === 0 ? (
                              <span className="text-xs italic text-ink-500">—</span>
                            ) : (
                              <ul className="divide-y divide-paper-200/70">
                                {members.map((u) => (
                                  <li key={u.id} className="py-1.5 first:pt-0 last:pb-0">
                                    {renderUserCell(u)}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div className="whitespace-nowrap text-xs text-ink-500">
                            {formatDate(c.created_at, locale)}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>

          {/* ── Orphan users — no workspace yet ───────────────────────────── */}
          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-ink-900">{t("admin.orphans_section")}</h2>
              <span className="text-xs uppercase tracking-wide text-ink-500">
                {t(orphans.length === 1 ? "admin.orphans_count_one" : "admin.orphans_count_other", {
                  n: orphans.length,
                })}
              </span>
            </div>
            {orphans.length === 0 ? (
              <div className="card text-sm text-ink-500">{t("admin.orphans_empty")}</div>
            ) : (
              <div className="card overflow-x-auto p-0">
                <table className="min-w-full text-sm">
                  <thead className="bg-paper-100 text-left text-[11px] uppercase tracking-wide text-ink-500">
                    <tr>
                      <th className="px-3 py-2">{t("admin.table_name")}</th>
                      <th className="px-3 py-2 text-right">{t("admin.table_admin_actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orphans.map((u) => (
                      <tr key={u.id} className="border-t border-paper-200">
                        <td className="px-3 py-2" colSpan={2}>
                          {renderUserCell(u)}
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
    </AppShell>
  );
}

function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "violet" | "violet-soft" | "muted";
}) {
  const cls =
    tone === "violet"
      ? "border-violet-700 bg-violet-700 text-paper-100"
      : tone === "violet-soft"
        ? "border-violet-300 bg-violet-100 text-violet-800"
        : "border-paper-300 bg-paper-100 text-ink-500";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {children}
    </span>
  );
}
