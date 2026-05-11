import type { AdminCoupleView, AdminUserView } from "@shared/types";
import { Check, Mail, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import { useConfirm, useEntryPrompt, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { adminUserApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

export default function AdminUsersPage() {
  const { t } = useT();
  const { user: currentAdmin } = useAuth();
  const toast = useToast();
  const promptEntry = useEntryPrompt();
  const confirm = useConfirm();
  const [users, setUsers] = useState<AdminUserView[]>([]);
  const [couples, setCouples] = useState<AdminCoupleView[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<number | null>(null);
  // Per-user "verify sent this session" badge. We don't persist this — a page
  // reload resets it, which is the right behaviour (admin needs to see a fresh
  // signal each time they decide to nudge someone). Toast covers the
  // moment-of-click; the badge covers "did I already do this for them?".
  const [verifySentIds, setVerifySentIds] = useState<Set<number>>(new Set());

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

  // Couple lookup by id — used to render the inline "Partner" column.
  const coupleById = new Map(couples.map((c) => [c.id, c]));

  function partnerFor(u: AdminUserView): { full_name: string; email: string } | null {
    if (u.couple_id == null) return null;
    const couple = coupleById.get(u.couple_id);
    if (!couple) return null;
    const other = couple.partners.find((p) => p.id !== u.id);
    return other ?? null;
  }

  function coupleLabel(u: AdminUserView): string | null {
    if (u.couple_id == null) return null;
    const c = coupleById.get(u.couple_id);
    if (!c) return null;
    if (c.display_name && c.display_name.trim()) return c.display_name;
    const a = c.bride_name?.trim();
    const b = c.groom_name?.trim();
    if (a && b) return `${a} & ${b}`;
    return a || b || `#${c.id}`;
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
    // Extra OK-prompt to break muscle memory on the type-in.
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
      setUsers((cur) => cur.filter((x) => x.id !== u.id));
      // Drop any couple that no longer has any non-purged partners so the
      // inline column stays in sync without an extra fetch.
      setCouples((cur) =>
        cur
          .map((c) => ({ ...c, partners: c.partners.filter((p) => p.id !== u.id) }))
          .filter((c) => c.partners.length > 0 || c.id !== u.couple_id),
      );
      toast.success(t("admin.delete_user_success"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setPendingId(null);
    }
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
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-ink-900">{t("admin.users_section_users")}</h2>
            <span className="text-xs uppercase tracking-wide text-ink-500">
              {t("admin.users_count", { n: users.length })}
            </span>
          </div>
          {users.length === 0 ? (
            <div className="card text-sm text-ink-500">{t("admin.users_empty")}</div>
          ) : (
            <div className="card overflow-x-auto p-0">
              <table className="min-w-full text-sm">
                <thead className="bg-paper-100 text-left text-xs uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="px-4 py-3">{t("admin.table_name")}</th>
                    <th className="px-4 py-3">{t("admin.table_email")}</th>
                    <th className="px-4 py-3 hidden lg:table-cell">{t("admin.table_partner")}</th>
                    <th className="px-4 py-3 text-right">{t("admin.table_admin_actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const partner = partnerFor(u);
                    const workspace = coupleLabel(u);
                    const isSelf = currentAdmin?.id === u.id;
                    const isPending = pendingId === u.id;
                    return (
                      <tr key={u.id} className="border-t border-paper-200 align-top">
                        <td className="px-4 py-3">
                          <div className="font-medium text-ink-900">{u.full_name}</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {u.is_admin && <Badge tone="ink">{t("admin.badge_admin")}</Badge>}
                            {u.status === "suspended" && (
                              <Badge tone="blush">{t("admin.badge_suspended")}</Badge>
                            )}
                            {!u.verified_email && (
                              <Badge tone="muted">{t("admin.badge_unverified")}</Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 break-all text-ink-700">{u.email}</td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          {partner ? (
                            <div>
                              <div className="font-medium text-ink-900">{partner.full_name}</div>
                              <div className="text-xs text-ink-500 break-all">{partner.email}</div>
                              {workspace && (
                                <div className="mt-1 text-[10px] uppercase tracking-wide text-ink-500">
                                  {workspace}
                                </div>
                              )}
                            </div>
                          ) : workspace ? (
                            <div>
                              <div className="text-xs italic text-ink-500">
                                {t("admin.table_partner_none")}
                              </div>
                              <div className="mt-1 text-[10px] uppercase tracking-wide text-ink-500">
                                {workspace}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs italic text-ink-500">
                              {t("admin.table_partner_orphan")}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {!u.verified_email &&
                            (verifySentIds.has(u.id) ? (
                              <span
                                className="inline-flex items-center gap-1.5 rounded-md bg-blush-100 px-2.5 py-1.5 text-xs font-medium text-blush-800"
                                title={t("admin.resend_verify_sent_label")}
                              >
                                <Check size={14} aria-hidden />
                                <span className="hidden sm:inline">
                                  {t("admin.resend_verify_sent_label")}
                                </span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="btn-ghost btn-sm"
                                onClick={() => onResendVerify(u)}
                                disabled={isPending}
                                aria-label={t("admin.resend_verify")}
                              >
                                <Mail size={14} />
                                <span className="hidden sm:inline">{t("admin.resend_verify")}</span>
                              </button>
                            ))}
                          {!isSelf && (
                            <button
                              type="button"
                              className="btn-ghost btn-sm text-blush-700"
                              onClick={() => onDelete(u)}
                              disabled={isPending}
                              aria-label={t("admin.delete_user")}
                            >
                              <Trash2 size={14} />
                              <span className="hidden sm:inline">{t("admin.delete_user")}</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </AppShell>
  );
}

function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "ink" | "blush" | "muted";
}) {
  const cls =
    tone === "ink"
      ? "border-ink-700 bg-ink-700 text-paper-100"
      : tone === "blush"
        ? "border-blush-300 bg-blush-100 text-blush-700"
        : "border-paper-300 bg-paper-100 text-ink-500";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {children}
    </span>
  );
}
