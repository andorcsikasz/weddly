// "Add to my list": turn a set of vendors into the couple's list in one go.
//
// Two sources feed it. The vendors selected for comparison are already on
// Weddly, so they are linked, not copied. The second is a plain list of names
// the couple types, one per line, for vendors Weddly may not carry yet. Each
// name is linked to its listing when Weddly has it, and otherwise becomes the
// couple's own card. Everything then goes through one pick request, so each
// vendor lands as the category's primary or as an extra beside it.

import { SUPPLIER_GROUPS, type SupplierCategory } from "@shared/suppliers";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ApiError } from "../lib/api";
import { coupleSupplierApi, picksApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { Button, Dialog, useToast } from "./ui";

/** A vendor the couple selected for comparison. */
export interface BulkVendor {
  id: string;
  name: string;
  category: string;
}

const ALL_CATEGORIES: readonly SupplierCategory[] = SUPPLIER_GROUPS.flatMap((g) => g.categories);
const MAX_NAMES = 40;

export function SupplierBulkAddDialog({
  open,
  onClose,
  vendors,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  /** The vendors selected for comparison, already on Weddly. */
  vendors: BulkVendor[];
  /** Called after the list has changed, so the page can re-read it. */
  onDone: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [namesText, setNamesText] = useState("");
  const [category, setCategory] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // Every selected vendor starts ticked. The category follows the selection when
  // it is one trade; with a mix the couple has to say which trade their own names are.
  useEffect(() => {
    if (!open) return;
    setChecked(new Set(vendors.map((v) => v.id)));
    setNamesText("");
    setSubmitting(false);
    const cats = new Set(vendors.map((v) => v.category));
    setCategory(cats.size === 1 ? (vendors[0]?.category ?? "") : "");
  }, [open, vendors]);

  const names = useMemo(
    () =>
      namesText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    [namesText],
  );
  const tickedIds = vendors.filter((v) => checked.has(v.id)).map((v) => v.id);
  const nothing = tickedIds.length === 0 && names.length === 0;
  const needsCategory = names.length > 0 && category === "";

  function toggle(id: string) {
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting || nothing || needsCategory) return;
    if (names.length > MAX_NAMES) {
      toast.error(t("suppliers.bulk.too_many", { max: MAX_NAMES }));
      return;
    }
    setSubmitting(true);
    try {
      const ids = [...tickedIds];
      let linked = 0;
      let created = 0;
      if (names.length > 0) {
        const own = await coupleSupplierApi.bulkOwn(category, names);
        for (const r of own.results) {
          ids.push(r.supplier_id);
          if (r.status === "linked") linked += 1;
          else created += 1;
        }
      }
      const picked = await picksApi.bulk(ids);
      const count = (status: string) => picked.results.filter((r) => r.status === status).length;
      const added = count("primary") + count("extra");
      const already = count("already");
      const skipped = count("venue_single") + count("unknown");
      toast.success(
        t("suppliers.bulk.done", {
          added,
          already,
          skipped,
          linked,
          created,
        }),
      );
      onDone();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.status === 402
          ? t("suppliers.bulk.blocked")
          : t("suppliers.bulk.error"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      role="dialog"
      size="sm"
      closeOnBackdrop={!submitting}
      title={t("suppliers.bulk.title")}
    >
      <form onSubmit={submit} className="space-y-5">
        {vendors.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-umber-300">
              {t("suppliers.bulk.on_weddly")}
            </legend>
            <ul className="space-y-1">
              {vendors.map((v) => (
                <li key={v.id}>
                  <label className="flex min-h-tap cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-paper-100 dark:hover:bg-umber-800">
                    <input
                      type="checkbox"
                      checked={checked.has(v.id)}
                      onChange={() => toggle(v.id)}
                      className="h-4 w-4 accent-ink-900"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-900 dark:text-paper-50">
                      {v.name}
                    </span>
                    <span className="shrink-0 text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
                      {t(`suppliers.cat.${v.category}`)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        <div className="space-y-2">
          <label
            htmlFor="bulk-own-names"
            className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-umber-300"
          >
            {t("suppliers.bulk.own_label")}
          </label>
          <textarea
            id="bulk-own-names"
            value={namesText}
            onChange={(e) => setNamesText(e.target.value)}
            rows={4}
            placeholder={t("suppliers.bulk.own_placeholder")}
            className="w-full resize-y rounded-lg border border-paper-300 bg-white px-3 py-2 text-base text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:border-umber-700 dark:bg-umber-900 dark:text-paper-50"
          />
          {names.length > 0 && (
            <div className="space-y-1">
              <label
                htmlFor="bulk-own-category"
                className="text-xs text-ink-500 dark:text-umber-300"
              >
                {t("suppliers.bulk.category_label")}
              </label>
              <select
                id="bulk-own-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-paper-300 bg-white px-3 py-2 text-base text-ink-900 dark:border-umber-700 dark:bg-umber-900 dark:text-paper-50"
              >
                <option value="">{t("suppliers.bulk.pick_category")}</option>
                {ALL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`suppliers.cat.${c}`)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3">
          <Button type="submit" disabled={submitting || nothing || needsCategory}>
            {submitting ? t("suppliers.bulk.submitting") : t("suppliers.bulk.submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
