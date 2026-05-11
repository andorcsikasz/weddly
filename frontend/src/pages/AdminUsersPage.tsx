import type { AdminCoupleView, AdminUserView } from "@shared/types";
import { type ReactNode, useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import { useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminUserApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

export default function AdminUsersPage() {
  const { t } = useT();
  const toast = useToast();
  const [users, setUsers] = useState<AdminUserView[]>([]);
  const [couples, setCouples] = useState<AdminCoupleView[]>([]);
  const [loading, setLoading] = useState(true);

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

  // Index couples by id for quick lookup in the users table.
  const coupleById = new Map(couples.map((c) => [c.id, c]));

  function coupleLabel(c: AdminCoupleView): string {
    if (c.display_name && c.display_name.trim()) return c.display_name;
    const a = c.bride_name?.trim();
    const b = c.groom_name?.trim();
    if (a && b) return `${a} & ${b}`;
    return a || b || `#${c.id}`;
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
        <div className="space-y-8">
          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-ink-900">
                {t("admin.users_section_users")}
              </h2>
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
                      <th className="px-4 py-3 hidden md:table-cell">{t("admin.table_role")}</th>
                      <th className="px-4 py-3 hidden lg:table-cell">{t("admin.table_couple")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => {
                      const couple = u.couple_id != null ? coupleById.get(u.couple_id) : null;
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
                          <td className="px-4 py-3 hidden md:table-cell text-ink-700">{u.role}</td>
                          <td className="px-4 py-3 hidden lg:table-cell text-ink-700">
                            {couple ? (
                              coupleLabel(couple)
                            ) : (
                              <span className="text-ink-500 italic">
                                {t("admin.table_couple_none")}
                              </span>
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

          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-ink-900">
                {t("admin.users_section_couples")}
              </h2>
              <span className="text-xs uppercase tracking-wide text-ink-500">
                {t("admin.couples_count", { n: couples.length })}
              </span>
            </div>
            {couples.length === 0 ? (
              <div className="card text-sm text-ink-500">{t("admin.couples_empty")}</div>
            ) : (
              <div className="card overflow-x-auto p-0">
                <table className="min-w-full text-sm">
                  <thead className="bg-paper-100 text-left text-xs uppercase tracking-wide text-ink-500">
                    <tr>
                      <th className="px-4 py-3">{t("admin.table_name")}</th>
                      <th className="px-4 py-3">{t("admin.table_couple_partners")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {couples.map((c) => (
                      <tr key={c.id} className="border-t border-paper-200 align-top">
                        <td className="px-4 py-3">
                          <div className="font-medium text-ink-900">{coupleLabel(c)}</div>
                          {c.status !== "active" && (
                            <div className="mt-0.5 text-xs uppercase tracking-wide text-ink-500">
                              {c.status}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {c.partners.length === 0 ? (
                            <span className="text-ink-500 italic">—</span>
                          ) : (
                            <ul className="space-y-1">
                              {c.partners.map((p) => (
                                <li key={p.id} className="text-ink-700">
                                  <span className="font-medium text-ink-900">{p.full_name}</span>
                                  <span className="mx-1 text-ink-300">·</span>
                                  <span className="break-all">{p.email}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
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
