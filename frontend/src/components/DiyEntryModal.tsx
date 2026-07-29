// "Csinálom magam" / DIY entry modal. Used to record private supplier
// entries — the couple is handling a category in-house (mum cooking, friend
// DJ-ing) or via an informal arrangement that doesn't belong in the public
// directory. Setting `price_huf` causes the backend to mirror the value into
// a locked budget line; clearing it removes the line.
//
// Before it creates anything it checks the directory (`findSupplierTwins`):
// a couple typing a business that Weddly already lists should USE that entry,
// not mint a private copy of it that carries none of the photos, address or
// reviews. An exact name match holds the save until they either adopt the
// listing or say it's a different vendor. The guest-page editor's venue picker
// and the vendor pipeline on /app/planning ask the same question their own way.
// See DirectoryTwinNotice.

import type { CoupleSupplier, SupplierInstallment } from "@shared/couple_suppliers";
import type { DirectorySupplier, SupplierCategory } from "@shared/suppliers";
import { findSupplierTwins, SUPPLIER_GROUPS } from "@shared/suppliers";
import type { Currency } from "@shared/types";
import { Plus, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../lib/api";
import { coupleSupplierApi } from "../lib/endpoints";
import { formatMoney } from "../lib/format";
import { useT } from "../lib/i18n";
import { DirectoryTwinNotice } from "./DirectoryTwinNotice";
import { Button, Dialog, FieldError, HelperText, TextField, useConfirm, useToast } from "./ui";

type Props = {
  open: boolean;
  onClose: () => void;
  /** When set, the modal opens in edit mode for this entry. */
  editing?: CoupleSupplier | null;
  /** Couple's display currency, for the payment-schedule amounts. */
  currency?: Currency;
  /** Pre-fills the category when opening fresh. Ignored in edit mode. */
  defaultCategory?: SupplierCategory | null;
  /** The directory (curated + community + claimed) the typed name is checked
   *  against. Empty disables the check entirely, so a page that hasn't loaded
   *  the directory keeps the old behaviour instead of blocking on nothing. */
  directory?: readonly DirectorySupplier[];
  /** Adopt a directory entry instead of creating a private row. When absent
   *  the twin notice stays informational (nothing to adopt with). */
  onUseExisting?: (supplier: DirectorySupplier) => void;
  onSaved: (supplier: CoupleSupplier) => void;
  onDeleted?: (id: string) => void;
};

interface FormState {
  name: string;
  category: SupplierCategory | "";
  notes: string;
  /** Stored as the raw string the user typed; coerced to integer Forint on
   *  submit. Empty string means "no price set". */
  price: string;
  /** "Already paid" toggle. When true and price > 0, the backend mirrors
   *  the price into both planned_huf and actual_huf of the locked budget
   *  line — otherwise actual_huf stays 0 so DIY plans don't masquerade
   *  as realized spend. */
  paid: boolean;
}

function emptyForm(defaultCategory: SupplierCategory | null | undefined): FormState {
  return {
    name: "",
    category: defaultCategory ?? "",
    notes: "",
    price: "",
    paid: false,
  };
}

function fromSupplier(s: CoupleSupplier): FormState {
  return {
    name: s.name,
    category: s.category,
    notes: s.notes ?? "",
    price: s.price_huf !== null ? String(s.price_huf) : "",
    paid: s.paid,
  };
}

type ErrorKey = "name" | "category" | "price";

export function DiyEntryModal({
  open,
  onClose,
  editing,
  currency = "HUF",
  defaultCategory,
  directory,
  onUseExisting,
  onSaved,
  onDeleted,
}: Props) {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<FormState>(() => emptyForm(defaultCategory));
  const [errors, setErrors] = useState<Partial<Record<ErrorKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // "I know, it's a different vendor" — set by the notice's escape hatch, and
  // reset whenever the name changes so a fresh name gets a fresh check.
  const [twinOverride, setTwinOverride] = useState(false);
  // The live supplier in edit mode — kept in sync as the payment schedule is
  // mutated so its installments + derived `paid` flag stay current without
  // closing the modal. Null in create mode (the schedule needs a saved row).
  const [live, setLive] = useState<CoupleSupplier | null>(editing ?? null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Reset form whenever the modal opens with a different prefill.
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(editing ? fromSupplier(editing) : emptyForm(defaultCategory));
    setLive(editing ?? null);
    setTwinOverride(false);
  }, [open, editing, defaultCategory]);

  const installments = live?.installments ?? [];
  const hasSchedule = installments.length > 0;

  // Directory matches for what's typed. Edit mode skips the check: the row
  // already exists, and re-offering the listing every time the couple opens a
  // saved entry to add an instalment would be nagging, not helping.
  const twins = useMemo(() => {
    if (editing || !directory || directory.length === 0) return [];
    return findSupplierTwins(form.name, form.category || null, directory, 3);
  }, [editing, directory, form.name, form.category]);
  const hasExactTwin = twins.some((tw) => tw.exact);
  // An exact match holds the save; a loose one is only an offer. Without an
  // adopt handler there is nothing to steer to, so nothing blocks.
  const twinBlocks = hasExactTwin && !twinOverride && Boolean(onUseExisting);

  function applyLive(supplier: CoupleSupplier) {
    setLive(supplier);
    onSaved(supplier);
  }

  // Focus the first field shortly after mount so keyboard users land on it.
  useEffect(() => {
    if (!open) return;
    const tid = window.setTimeout(() => firstFieldRef.current?.focus(), 50);
    return () => window.clearTimeout(tid);
  }, [open]);

  // Flatten the supplier groups into a flat category list. Sub-category
  // labels come from the i18n tree.
  const categoryOptions = useMemo(() => SUPPLIER_GROUPS.flatMap((g) => g.categories), []);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((cur) => ({ ...cur, [key]: value }));
  }

  function validate(): boolean {
    const next: Partial<Record<ErrorKey, string>> = {};
    if (!form.name.trim()) next.name = t("suppliers.submit.err_required");
    if (!form.category) next.category = t("suppliers.submit.err_required");
    if (form.price.trim()) {
      const n = Number(form.price);
      if (!Number.isFinite(n) || n < 0) next.price = t("common.error_generic");
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!validate()) return;
    // The notice is already on screen with the listing and its two ways out,
    // so refuse quietly rather than duplicating the explanation in a toast.
    if (twinBlocks) return;
    setSaving(true);
    try {
      const priceParsed = form.price.trim() ? Math.round(Number(form.price)) : null;
      // Guard: a "paid" flag without a positive price is meaningless — the
      // toggle is disabled in the UI when price is empty/zero, but be
      // defensive in case state flips between validate and submit.
      const paidEffective = priceParsed !== null && priceParsed > 0 ? form.paid : false;
      const body = {
        name: form.name.trim(),
        category: form.category as SupplierCategory,
        notes: form.notes.trim() || null,
        price_huf: priceParsed,
        paid: paidEffective,
      };
      const res = editing
        ? await coupleSupplierApi.update(editing.id, body)
        : await coupleSupplierApi.create(body);
      onSaved(res.supplier);
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("common.error_generic");
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    const ok = await confirm({
      title: t("suppliers.diy_modal_delete_confirm_title"),
      body: t("suppliers.diy_modal_delete_confirm_body"),
      confirmLabel: t("suppliers.diy_modal_delete"),
      cancelLabel: t("suppliers.diy_modal_cancel"),
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await coupleSupplierApi.remove(editing.id);
      onDeleted?.(editing.id);
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("common.error_generic");
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      role="dialog"
      title={t("suppliers.diy_modal_title")}
      closeOnBackdrop
      footer={
        <>
          {editing && (
            <Button
              type="button"
              variant="ghost"
              onClick={handleDelete}
              disabled={saving || deleting}
            >
              {t("suppliers.diy_modal_delete")}
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose} disabled={saving || deleting}>
            {t("suppliers.diy_modal_cancel")}
          </Button>
          <Button
            type="submit"
            form="diy-entry-form"
            variant="primary"
            disabled={saving || deleting || twinBlocks}
          >
            {saving ? t("suppliers.diy_modal_submitting") : t("suppliers.diy_modal_submit")}
          </Button>
        </>
      }
    >
      <form id="diy-entry-form" onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-ink-500 dark:text-umber-300">{t("suppliers.diy_modal_intro")}</p>

        <TextField
          id="diy-name"
          ref={firstFieldRef}
          label={t("suppliers.diy_modal_name_label")}
          placeholder={t("suppliers.diy_modal_name_placeholder")}
          value={form.name}
          onChange={(e) => {
            setField("name", e.target.value);
            // A new name is a new question — drop any earlier "it's a
            // different vendor" verdict so the check runs again.
            setTwinOverride(false);
          }}
          errorText={errors.name}
          required
        />

        {twins.length > 0 && onUseExisting && (
          <DirectoryTwinNotice
            twins={twins}
            blocking={twinBlocks}
            busy={saving || deleting}
            onUse={(s) => {
              onUseExisting(s);
              onClose();
            }}
            onDismiss={() => setTwinOverride(true)}
          />
        )}

        <div className="block">
          <label htmlFor="diy-category" className="field-label">
            {t("suppliers.diy_modal_category_label")}
            <span aria-hidden className="ml-0.5 text-blush-700">
              *
            </span>
          </label>
          <select
            id="diy-category"
            className="input"
            value={form.category}
            onChange={(e) => {
              setField("category", e.target.value as SupplierCategory);
              // Twins are category-scoped, so switching category re-asks too.
              setTwinOverride(false);
            }}
            aria-invalid={errors.category ? true : undefined}
          >
            <option value="" disabled>
              —
            </option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>
                {t(`suppliers.cat.${c}`)}
              </option>
            ))}
          </select>
          {errors.category && <FieldError id="diy-category-error">{errors.category}</FieldError>}
        </div>

        <div className="block">
          <label htmlFor="diy-notes" className="field-label">
            {t("suppliers.diy_modal_notes_label")}
          </label>
          <textarea
            id="diy-notes"
            className="input min-h-[5rem]"
            placeholder={t("suppliers.diy_modal_notes_placeholder")}
            value={form.notes}
            onChange={(e) => setField("notes", e.target.value)}
            maxLength={500}
          />
        </div>

        <div className="block">
          <label htmlFor="diy-price" className="field-label">
            {t("suppliers.diy_modal_price_label")}
          </label>
          <input
            id="diy-price"
            type="number"
            inputMode="numeric"
            min={0}
            step={1000}
            className="input"
            value={form.price}
            onChange={(e) => setField("price", e.target.value)}
            aria-invalid={errors.price ? true : undefined}
          />
          {errors.price ? (
            <FieldError id="diy-price-error">{errors.price}</FieldError>
          ) : (
            <HelperText id="diy-price-help">{t("suppliers.diy_modal_price_help")}</HelperText>
          )}
        </div>

        {/* The manual "Already paid" toggle is hidden once a payment schedule
            exists — there the installments drive paid/unpaid, so a single
            boolean would be ambiguous. */}
        {!hasSchedule &&
          (() => {
            // The "Already paid" toggle is meaningful only when there's a
            // positive price — otherwise paid=true has nothing to write into
            // the mirrored budget line's actual_huf. Disable the input and
            // swap the helper to a nudge in that case.
            const parsed = Number(form.price);
            const hasPrice = form.price.trim() !== "" && Number.isFinite(parsed) && parsed > 0;
            return (
              <div className="block">
                <label
                  htmlFor="diy-paid"
                  className="flex items-center gap-2 text-sm text-ink-800 dark:text-paper-100"
                >
                  <input
                    id="diy-paid"
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer rounded border-paper-300 dark:border-umber-700 text-blush-600 focus:ring-blush-400 disabled:cursor-not-allowed disabled:opacity-50"
                    checked={hasPrice && form.paid}
                    disabled={!hasPrice}
                    onChange={(e) => setField("paid", e.target.checked)}
                    aria-describedby="diy-paid-help"
                  />
                  <span className={hasPrice ? "" : "text-ink-400 dark:text-umber-300"}>
                    {t("diy.paid_label")}
                  </span>
                </label>
                <HelperText id="diy-paid-help">
                  {hasPrice ? t("diy.paid_help") : t("diy.paid_disabled_hint")}
                </HelperText>
              </div>
            );
          })()}

        {/* Payment schedule — only on a saved entry (installments need a
            supplier row to hang off). In create mode we nudge the couple to
            save first. */}
        {live ? (
          <PaymentScheduleEditor supplier={live} currency={currency} onChange={applyLive} />
        ) : (
          form.price.trim() !== "" && (
            <p className="text-xs text-ink-400 dark:text-umber-300">
              {t("diy.schedule_save_first")}
            </p>
          )
        )}

        <p className="rounded-xl bg-paper-100 dark:bg-umber-700/60 px-3 py-2 text-xs text-ink-500 dark:text-umber-300">
          {t("suppliers.diy_modal_privacy")}
        </p>
      </form>
    </Dialog>
  );
}

/** Inline payment-schedule editor for a saved DIY supplier. Each mutation
 *  hits the API and returns the full updated supplier (recomputed `paid` +
 *  installments), which we bubble up via onChange so the parent list and the
 *  budget mirror stay in sync. */
function PaymentScheduleEditor({
  supplier,
  currency,
  onChange,
}: {
  supplier: CoupleSupplier;
  currency: Currency;
  onChange: (s: CoupleSupplier) => void;
}) {
  const { t, locale } = useT();
  const toast = useToast();
  const loc = locale === "hu" ? "hu" : "en";
  const [busy, setBusy] = useState(false);

  const items = supplier.installments;
  const total = items.reduce((a, i) => a + i.amount_huf, 0);
  const paidSum = items.filter((i) => i.paid).reduce((a, i) => a + i.amount_huf, 0);
  const outstanding = Math.max(0, total - paidSum);
  const price = supplier.price_huf ?? 0;

  async function run(p: Promise<{ supplier: CoupleSupplier }>) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await p;
      onChange(r.supplier);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  function addInstallment() {
    // Seed the new row with whatever is still unscheduled against the price so
    // the common "one more payment for the rest" case is one click.
    const scheduled = total;
    const seed = price > scheduled ? price - scheduled : price > 0 ? price : 0;
    if (seed <= 0) {
      toast.error(t("diy.schedule_needs_price"));
      return;
    }
    run(coupleSupplierApi.addInstallment(supplier.id, { amount_huf: seed, paid: false }));
  }

  return (
    <div className="block rounded-xl border border-paper-300 dark:border-umber-700 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-ink-800 dark:text-paper-100">
          {t("diy.schedule_title")}
        </span>
        <button
          type="button"
          onClick={addInstallment}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-full border border-paper-400 dark:border-umber-600 px-2.5 py-1 text-xs font-medium text-ink-700 dark:text-paper-100 hover:bg-paper-100 dark:hover:bg-umber-700 disabled:opacity-50"
        >
          <Plus size={13} />
          {t("diy.schedule_add")}
        </button>
      </div>

      {items.length === 0 ? (
        <p className="mt-2 text-xs text-ink-400 dark:text-umber-300">{t("diy.schedule_empty")}</p>
      ) : (
        <>
          <ul className="mt-2 space-y-2">
            {items.map((inst) => (
              <InstallmentRow
                key={inst.id}
                supplierId={supplier.id}
                inst={inst}
                busy={busy}
                onRun={run}
              />
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t border-paper-200 dark:border-umber-700 pt-2 text-xs">
            <span className="text-ink-500 dark:text-umber-300">
              {t("diy.schedule_paid")}{" "}
              <span className="font-semibold text-ink-800 dark:text-paper-100">
                {formatMoney(paidSum, currency, loc)}
              </span>
            </span>
            <span className="text-ink-500 dark:text-umber-300">
              {t("diy.schedule_outstanding")}{" "}
              <span className="font-semibold text-ink-800 dark:text-paper-100">
                {formatMoney(outstanding, currency, loc)}
              </span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/** One editable installment row. Text/number fields persist on blur; the paid
 *  checkbox and the delete button persist immediately. */
function InstallmentRow({
  supplierId,
  inst,
  busy,
  onRun,
}: {
  supplierId: string;
  inst: SupplierInstallment;
  busy: boolean;
  onRun: (p: Promise<{ supplier: CoupleSupplier }>) => void;
}) {
  const { t } = useT();

  return (
    <li className="flex flex-wrap items-center gap-2">
      <input
        type="checkbox"
        checked={inst.paid}
        disabled={busy}
        aria-label={t("diy.schedule_mark_paid")}
        onChange={(e) =>
          onRun(
            coupleSupplierApi.updateInstallment(supplierId, inst.id, { paid: e.target.checked }),
          )
        }
        className="h-4 w-4 shrink-0 cursor-pointer rounded border-paper-300 dark:border-umber-700 text-blush-600 focus:ring-blush-400 disabled:opacity-50"
      />
      <input
        type="text"
        defaultValue={inst.label ?? ""}
        disabled={busy}
        placeholder={t("diy.schedule_label_placeholder")}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v !== (inst.label ?? ""))
            onRun(coupleSupplierApi.updateInstallment(supplierId, inst.id, { label: v || null }));
        }}
        className="input min-w-[6rem] flex-1 !py-1 text-sm"
      />
      <input
        type="number"
        min={1}
        step={1000}
        defaultValue={inst.amount_huf}
        disabled={busy}
        aria-label={t("diy.schedule_amount")}
        onBlur={(e) => {
          const n = Math.round(Number(e.target.value));
          if (Number.isFinite(n) && n > 0 && n !== inst.amount_huf)
            onRun(coupleSupplierApi.updateInstallment(supplierId, inst.id, { amount_huf: n }));
        }}
        className="input w-24 !py-1 text-sm"
      />
      <input
        type="date"
        defaultValue={inst.due_date ?? ""}
        disabled={busy}
        aria-label={t("diy.schedule_due")}
        onChange={(e) =>
          onRun(
            coupleSupplierApi.updateInstallment(supplierId, inst.id, {
              due_date: e.target.value || null,
            }),
          )
        }
        className="input w-[8.5rem] !py-1 text-sm"
      />
      <button
        type="button"
        onClick={() => onRun(coupleSupplierApi.removeInstallment(supplierId, inst.id))}
        disabled={busy}
        aria-label={t("diy.schedule_delete")}
        className="shrink-0 rounded-md p-1 text-ink-400 hover:text-blush-600 hover:bg-paper-100 dark:hover:bg-umber-700 disabled:opacity-50"
      >
        <Trash2 size={15} />
      </button>
    </li>
  );
}
