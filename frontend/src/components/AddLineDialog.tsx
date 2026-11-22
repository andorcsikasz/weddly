// The "+" on /app/vendors: start a line in the couple's plan. Category first,
// then the directory vendors already in that category, and only when none of
// them fits a private line the couple writes themselves. Checking the directory
// before creating is what keeps this from minting a second card for a business
// Weddly already lists.

import { ArrowLeft, Check, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type DirectorySupplier, SUPPLIER_GROUPS, type SupplierCategory } from "@shared/suppliers";
import { categoryIcon } from "../lib/category_icons";
import { useT } from "../lib/i18n";
import { Dialog } from "./ui/Dialog";

const SUGGESTION_LIMIT = 40;

type Props = {
  open: boolean;
  onClose: () => void;
  directory: DirectorySupplier[];
  /** Directory ids already chosen for a category on this couple's plan. */
  chosenIds: ReadonlySet<string>;
  onUseExisting: (supplier: DirectorySupplier) => void;
  onCreateNew: (category: SupplierCategory) => void;
  onRecommend: () => void;
};

export function AddLineDialog({
  open,
  onClose,
  directory,
  chosenIds,
  onUseExisting,
  onCreateNew,
  onRecommend,
}: Props) {
  const { t } = useT();
  const [category, setCategory] = useState<SupplierCategory | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setCategory(null);
      setQuery("");
    }
  }, [open]);

  const matches = useMemo(() => {
    if (!category) return [];
    const q = query.trim().toLowerCase();
    return directory
      .filter(
        (s) =>
          s.category === category &&
          (q === "" || s.name.toLowerCase().includes(q) || s.city.toLowerCase().includes(q)),
      )
      .sort(
        (a, b) =>
          Number(chosenIds.has(b.id)) - Number(chosenIds.has(a.id)) ||
          b.votes_score - a.votes_score ||
          a.name.localeCompare(b.name),
      )
      .slice(0, SUGGESTION_LIMIT);
  }, [category, query, directory, chosenIds]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("suppliers.add_line.title")}
      role="dialog"
      closeOnBackdrop
      size="lg"
    >
      {category === null ? (
        <div className="space-y-5">
          <p className="text-sm text-ink-600 dark:text-paper-300">
            {t("suppliers.add_line.step_category")}
          </p>
          {SUPPLIER_GROUPS.map((g) => (
            <div key={g.id}>
              <h3 className="mb-2 text-[11px] uppercase tracking-wide text-ink-500 dark:text-umber-300">
                {t(`suppliers.group.${g.id}`)}
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {g.categories.map((c) => {
                  const Glyph = categoryIcon(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(c)}
                      className="flex items-center gap-2 rounded-xl border border-paper-300 bg-white px-3 py-2.5 text-left text-sm text-ink-900 transition hover:border-ink-900 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50 dark:hover:border-paper-200"
                    >
                      <Glyph className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                      <span className="truncate">{t(`suppliers.cat.${c}`)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setCategory(null)}
              className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 dark:text-paper-300 dark:hover:text-paper-50"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t("suppliers.add_line.back")}
            </button>
            <span className="truncate text-sm font-medium text-ink-900 dark:text-paper-50">
              {t(`suppliers.cat.${category}`)}
            </span>
          </div>

          <label className="relative block">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400 dark:text-umber-300"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("suppliers.add_line.search_placeholder")}
              aria-label={t("suppliers.add_line.search_placeholder")}
              className="input w-full pl-9 text-base"
            />
          </label>

          {matches.length === 0 ? (
            <p className="py-4 text-center text-sm text-ink-500 dark:text-umber-300">
              {query.trim()
                ? t("suppliers.add_line.no_match")
                : t("suppliers.add_line.none_in_category")}
            </p>
          ) : (
            <ul className="max-h-[50vh] divide-y divide-paper-200 overflow-y-auto overscroll-contain dark:divide-umber-700">
              {matches.map((s) => {
                const onLine = chosenIds.has(s.id);
                return (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-900 dark:text-paper-50">
                        {s.name}
                      </p>
                      <p className="truncate text-xs text-ink-500 dark:text-umber-300">
                        {s.city}
                        {onLine ? ` · ${t("suppliers.add_line.on_line")}` : ""}
                      </p>
                    </div>
                    {onLine ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-sage-700 dark:text-sage-300">
                        <Check className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
                        {t("suppliers.add_line.on_line")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onUseExisting(s)}
                        className="shrink-0 rounded-full bg-ink-900 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-ink-800 dark:bg-paper-50 dark:text-ink-900 dark:hover:bg-paper-200"
                      >
                        {t("suppliers.add_line.use")}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="space-y-2 border-t border-paper-200 pt-4 dark:border-umber-700">
            <p className="text-sm text-ink-600 dark:text-paper-300">
              {t("suppliers.add_line.not_here")}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onCreateNew(category)}
                className="inline-flex h-10 items-center rounded-full border border-ink-900 px-4 text-sm font-medium text-ink-900 transition hover:bg-ink-900 hover:text-white dark:border-paper-50 dark:text-paper-50 dark:hover:bg-paper-50 dark:hover:text-ink-900"
              >
                {t("suppliers.add_line.create_new", { category: t(`suppliers.cat.${category}`) })}
              </button>
              <button
                type="button"
                onClick={onRecommend}
                className="inline-flex h-10 items-center rounded-full px-4 text-sm text-ink-600 underline-offset-4 hover:text-ink-900 hover:underline dark:text-paper-300 dark:hover:text-paper-50"
              >
                {t("suppliers.add_line.recommend")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
