// "Már foglaltam" card on /app/suppliers. Renders at the start of the cards
// grid when both the supplier group AND its sub-category are active, so the
// context (which category the couple is booking for) is unambiguous.
//
// Two paths the couple can land on:
//   - Type a name that matches an existing directory entry → dropdown
//     suggests the match; clicking adopts it as the couple's pick (via
//     supplier_selection.setSelection) and the card collapses. No new
//     community submission is created.
//   - Type a name that doesn't match → the rest of the inline form lets
//     them fill in address + phone (always visible) plus email + website
//     (progressively disclosed when they start typing an address). On
//     "Hozzáadás" the entry is POSTed straight to the community-suppliers
//     queue (same `submitCommunity` endpoint the bigger "Tipp leadása"
//     modal uses), so it lands in the admin moderation queue with no
//     extra plumbing. The card never surfaces the word "tipp" to the
//     couple; from their perspective they're just adding a vendor
//     they've already booked. Defaults: price_band=3 (mid), blurb=""
//     so admin can fill those in during review.
//
// The card carries no header of its own: SuppliersPage reveals it from the
// "már foglaltam" chip that sits with "csinálom magam" and "nem kell" in the
// sub-category row, and only mounts it once activeGroup && activeCat are both
// set, so the directory grid stays uncluttered until the couple narrows in.

import type { SubmitCommunitySupplierInput } from "@shared/community_suppliers";
import type { DirectorySupplier, SupplierCategory } from "@shared/suppliers";
import { useMemo, useRef, useState } from "react";
import { ApiError } from "../lib/api";
import { supplierApi } from "../lib/endpoints";
import { setSelection } from "../lib/supplier_selection";
import { useT } from "../lib/i18n";
import { useToast } from "./ui";

/** Diacritic-folded lower-case match. Copied from SuppliersPage's local
 *  helper since the page-level version isn't exported. Tiny enough that the
 *  duplication is cheaper than refactoring it into shared/. */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function BookedSupplierCard({
  coupleId,
  category,
  categoryLabel,
  items,
  pickedId,
  onPickExisting,
  onClose,
  onSubmitted,
}: {
  /** Couple workspace this card writes picks against. Null when the couple
   *  hasn't loaded yet; the card renders disabled in that case. */
  coupleId: number | null;
  /** The active sub-category. Picks land in this slot, and submissions are
   *  pre-pinned to it. */
  category: SupplierCategory;
  /** Human-readable category label for the subtitle copy. */
  categoryLabel: string;
  /** Full directory (curated + community), used for the autocomplete match
   *  list. We filter to the active category client-side. */
  items: DirectorySupplier[];
  /** The currently-picked supplier id for this category, if any. Used to
   *  show "this is already your pick" feedback when the dropdown match
   *  equals the existing selection. */
  pickedId: string | null;
  /** Notify the parent that the user adopted an existing directory entry
   *  so it can update its local `selection` state for instant feedback. */
  onPickExisting: (supplier: DirectorySupplier) => void;
  /** Collapse the panel from the parent's chip — called once the couple has
   *  adopted an existing directory entry, since the job is done at that point. */
  onClose?: () => void;
  /** Notify the parent that a brand-new community submission landed.
   *  Today the parent ignores it (admin gate keeps it out of the public
   *  list anyway); kept as a hook for future optimistic UI. */
  onSubmitted?: (input: SubmitCommunitySupplierInput) => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Disclosure lives on the parent's "már foglaltam" chip (a peer of "csinálom
  // magam" / "nem kell"), so this component renders body-only and is simply not
  // mounted while collapsed.
  const nameRef = useRef<HTMLInputElement | null>(null);

  // Filter the directory by the active category + the typed text. Empty
  // input → no dropdown. Cap at 5 visible so the card doesn't push the
  // sibling supplier cards down a long way.
  const queryNorm = useMemo(() => fold(name.trim()), [name]);
  const matches = useMemo<DirectorySupplier[]>(() => {
    if (!queryNorm) return [];
    return items
      .filter((s) => s.category === category)
      .filter((s) => fold(`${s.name} ${s.city}`).includes(queryNorm))
      .slice(0, 5);
  }, [queryNorm, items, category]);

  const clearForm = () => {
    setName("");
    setAddress("");
    setPhone("");
    setEmail("");
    setWebsite("");
    setPickerOpen(false);
  };

  const adoptExisting = (s: DirectorySupplier) => {
    if (coupleId === null) return;
    setSelection(coupleId, category, s.id);
    onPickExisting(s);
    toast.success(t("suppliers.bookedCard.toast_added", { name: s.name }));
    clearForm();
    onClose?.();
  };

  const submitNew = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || submitting) return;
    setSubmitting(true);
    // city is required at the API type level but accepts an empty string.
    // price_band is strictly required (1..5) so we default to 3 (mid) and
    // let the admin tune during moderation. blurb empty is OK on the
    // backend. submitter_type="user" matches the "couple recommendation"
    // path (vs vendor self-submit).
    const payload: SubmitCommunitySupplierInput = {
      category,
      submitter_type: "user",
      name: trimmedName,
      city: "",
      address: address.trim() ? address.trim() : null,
      website: website.trim(),
      contact_email: email.trim() ? email.trim() : null,
      contact_phone: phone.trim() ? phone.trim() : null,
      blurb: "",
      price_band: 3,
    };
    try {
      await supplierApi.submitCommunity(payload);
      toast.success(t("suppliers.bookedCard.toast_submitted", { name: trimmedName }));
      onSubmitted?.(payload);
      clearForm();
      nameRef.current?.focus();
    } catch (err) {
      const message =
        err instanceof ApiError && err.status >= 400 && err.status < 500
          ? err.message
          : t("suppliers.bookedCard.err_generic");
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = coupleId === null;
  // Progressive disclosure: email + website only appear once the user has
  // started filling in the address. The user asked for the form to grow
  // as they engage, not load front-loaded with five inputs.
  const expanded = address.trim().length > 0;

  return (
    <article
      // Matches the directory supplier cards (the `card` utility) so the
      // "already booked" form reads as one of them — same solid border,
      // surface, radius, and padding.
      className="card !px-4 !py-3 relative flex flex-col"
      aria-label={t("suppliers.bookedCard.title")}
    >
      <p className="text-xs text-ink-500 dark:text-umber-300">
        {t("suppliers.bookedCard.subtitle", { category: categoryLabel })}
      </p>

      <div id="booked-supplier-panel" className="mt-2 space-y-2">
        <div className="relative">
          <label className="sr-only" htmlFor="booked-supplier-name">
            {t("suppliers.bookedCard.input_label")}
          </label>
          <input
            ref={nameRef}
            id="booked-supplier-name"
            type="text"
            autoComplete="off"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setPickerOpen(true);
            }}
            onFocus={() => setPickerOpen(true)}
            // Delay the close so a mousedown on a suggestion lands before
            // the dropdown unmounts.
            onBlur={() => window.setTimeout(() => setPickerOpen(false), 120)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches.length > 0) {
                e.preventDefault();
                adoptExisting(matches[0]!);
              } else if (e.key === "Escape") {
                setPickerOpen(false);
              }
            }}
            disabled={disabled}
            placeholder={t("suppliers.bookedCard.placeholder")}
            className="input w-full disabled:cursor-not-allowed disabled:opacity-60"
          />
          {pickerOpen && queryNorm && !disabled && matches.length > 0 && (
            <div
              role="listbox"
              className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-xl border border-paper-300 bg-white py-1 shadow-lg dark:border-umber-700 dark:bg-umber-800"
            >
              {matches.map((s) => {
                const alreadyPicked = pickedId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="option"
                    aria-selected={alreadyPicked}
                    // mousedown fires before the input's blur → click would
                    // race the dropdown's unmount. mousedown wins cleanly.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      adoptExisting(s);
                    }}
                    className="flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm transition hover:bg-paper-100 dark:hover:bg-umber-700"
                  >
                    <span className="truncate font-medium text-ink-800 dark:text-paper-100">
                      {s.name}
                    </span>
                    <span className="shrink-0 text-xs text-ink-500 dark:text-umber-300">
                      {alreadyPicked ? t("suppliers.bookedCard.match_already_picked") : s.city}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <label className="sr-only" htmlFor="booked-supplier-address">
          {t("suppliers.bookedCard.address_label")}
        </label>
        <input
          id="booked-supplier-address"
          type="text"
          autoComplete="off"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          disabled={disabled}
          placeholder={t("suppliers.bookedCard.address_placeholder")}
          className="input w-full disabled:cursor-not-allowed disabled:opacity-60"
        />

        <label className="sr-only" htmlFor="booked-supplier-phone">
          {t("suppliers.bookedCard.phone_label")}
        </label>
        <input
          id="booked-supplier-phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={disabled}
          placeholder={t("suppliers.bookedCard.phone_placeholder")}
          className="input w-full disabled:cursor-not-allowed disabled:opacity-60"
        />

        {expanded && (
          <>
            <label className="sr-only" htmlFor="booked-supplier-email">
              {t("suppliers.bookedCard.email_label")}
            </label>
            <input
              id="booked-supplier-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={disabled}
              placeholder={t("suppliers.bookedCard.email_placeholder")}
              className="input w-full disabled:cursor-not-allowed disabled:opacity-60"
            />
            <label className="sr-only" htmlFor="booked-supplier-website">
              {t("suppliers.bookedCard.website_label")}
            </label>
            <input
              id="booked-supplier-website"
              type="url"
              inputMode="url"
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              disabled={disabled}
              placeholder={t("suppliers.bookedCard.website_placeholder")}
              className="input w-full disabled:cursor-not-allowed disabled:opacity-60"
            />
          </>
        )}
      </div>

      {/* mt-auto pins the primary action to the bottom regardless of how
          many fields are expanded, so the card's outer footprint stays
          steady inside the equal-height grid. */}
      <div className="mt-auto pt-3">
        <button
          type="button"
          onClick={submitNew}
          disabled={disabled || !name.trim() || submitting}
          className="inline-flex items-center gap-1.5 rounded-full border border-paper-400 bg-paper-100 px-4 py-1.5 text-xs font-semibold text-ink-800 transition hover:border-ink-500 hover:bg-paper-200 disabled:cursor-not-allowed disabled:opacity-50 dark:border-umber-600 dark:bg-umber-700 dark:text-paper-50 dark:hover:border-umber-500 dark:hover:bg-umber-600"
        >
          {submitting ? t("suppliers.bookedCard.submitting") : t("suppliers.bookedCard.add")}
        </button>
      </div>
    </article>
  );
}
