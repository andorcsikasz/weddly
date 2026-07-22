// Admin moderation queue for FLAGGED reviews. When reviews opened to any
// verified email (couples without engagement proof, no-couple users, and
// email-verified visitors), a low (1-2 star) rating is auto-published but
// flagged. This page lists those flagged rows so an admin can keep them
// (unflag) or remove them (delete). Non-flagged reviews are moderated in place
// on each supplier's detail page.

import type { AdminFlaggedReview } from "@shared/suppliers";
import { Star, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Skeleton, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminReviewApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

type Loadable<T> = { status: "loading" } | { status: "ok"; data: T } | { status: "error" };

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value}/5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={13}
          className={
            n <= value ? "fill-star stroke-star" : "stroke-paper-300 dark:stroke-umber-500"
          }
        />
      ))}
    </span>
  );
}

export default function AdminFlaggedReviewsPage() {
  const { t } = useT();
  useDocumentMeta(t("admin.reviews.title"), t("admin.reviews.description"));
  const toast = useToast();
  const confirm = useConfirm();
  const [state, setState] = useState<Loadable<AdminFlaggedReview[]>>({ status: "loading" });

  const load = () => {
    setState({ status: "loading" });
    adminReviewApi
      .listFlagged({ limit: 50 })
      .then((r) => setState({ status: "ok", data: r.items }))
      .catch(() => setState({ status: "error" }));
  };
  useEffect(load, []);

  const unflag = async (id: number) => {
    try {
      await adminReviewApi.unflag(id);
      setState((s) =>
        s.status === "ok" ? { status: "ok", data: s.data.filter((r) => r.id !== id) } : s,
      );
      toast.success(t("admin.reviews.unflagged"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  };

  const remove = async (id: number) => {
    const ok = await confirm({
      title: t("admin.reviews.deleteConfirmTitle"),
      body: t("admin.reviews.deleteConfirmBody"),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    try {
      await adminReviewApi.remove(id);
      setState((s) =>
        s.status === "ok" ? { status: "ok", data: s.data.filter((r) => r.id !== id) } : s,
      );
      toast.success(t("admin.reviews.deleted"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 xl:px-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900 dark:text-paper-50">
          {t("admin.reviews.title")}
        </h1>
        <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
          {t("admin.reviews.description")}
        </p>
      </header>

      {state.status === "loading" && <Skeleton className="h-40 w-full rounded-xl" />}
      {state.status === "error" && (
        <div className="rounded-xl border border-rose-300/60 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-800/50 dark:bg-rose-900/20 dark:text-rose-200">
          {t("admin.reviews.loadError")}{" "}
          <button type="button" onClick={load} className="underline">
            {t("common.back")}
          </button>
        </div>
      )}
      {state.status === "ok" && state.data.length === 0 && (
        <p className="rounded-xl border border-ink-200/60 bg-white p-6 text-sm italic text-ink-500 dark:border-umber-700/60 dark:bg-umber-900 dark:text-umber-300">
          {t("admin.reviews.empty")}
        </p>
      )}
      {state.status === "ok" && state.data.length > 0 && (
        <ul className="space-y-3">
          {state.data.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-ink-200/60 bg-white p-5 dark:border-umber-700/60 dark:bg-umber-900"
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Stars value={r.rating} />
                  <span className="text-sm font-medium text-ink-900 dark:text-paper-50">
                    {r.author_display_name}
                  </span>
                  <span className="rounded-full bg-cream-100 px-2 py-0.5 text-xs text-ink-600 dark:bg-umber-700/40 dark:text-umber-200">
                    {r.author_kind}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => unflag(r.id)}
                    className="rounded-full bg-ink-900 px-3 py-1.5 text-xs font-medium text-paper-50 transition hover:bg-ink-800 dark:bg-paper-100 dark:text-ink-900"
                  >
                    {t("admin.reviews.unflag")}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(r.id)}
                    aria-label={t("common.delete")}
                    title={t("common.delete")}
                    className="text-ink-400 hover:text-rose-600 dark:text-umber-400"
                  >
                    <Trash2 size={15} aria-hidden />
                  </button>
                </div>
              </div>
              <p className="text-xs text-ink-500 dark:text-umber-300">
                {r.supplier_name ?? r.supplier_id}
              </p>
              {r.body && (
                <p className="mt-2 whitespace-pre-line text-sm text-ink-800 dark:text-umber-100">
                  {r.body}
                </p>
              )}
              {r.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {r.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-cream-100 px-2 py-0.5 text-xs text-ink-700 dark:bg-umber-700/40 dark:text-umber-100"
                    >
                      {t(`suppliers.reviewTags.${tag}`)}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
