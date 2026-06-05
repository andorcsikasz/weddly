// Couple-curated wishlist / gift registry. CRUD over the `wishlist_items`
// table — a list with inline add/edit/delete, mirroring the /app/schedule
// editor's UX. Confirmed-tier guests see a read-only deck on the merged
// guest page; the couple manages it here.
//
// IMPORTANT: no money ever moves in-app. `target_amount_minor` is purely the
// couple's informational "this is roughly what it costs". We store + send it
// as integer MINOR units (HUF has no minor unit → whole forint; EUR/USD are
// cents), and convert to/from the couple's-currency whole-unit value the
// couple types into the form.

import type { Couple } from "@shared/types";
import { CURRENCIES, type Currency } from "@shared/types";
import type { UpsertWishlistItemInput, WishlistItem, WishlistKind } from "@shared/wishlist";
import {
  WISHLIST_KINDS,
  WISHLIST_MAX_DESC_LEN,
  WISHLIST_MAX_TITLE_LEN,
  WISHLIST_MAX_URL_LEN,
} from "@shared/wishlist";
import { ExternalLink, Gift, Pencil, Plus, Trash2, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { InfoHint } from "../components/InfoHint";
import { Skeleton, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { coupleApi, wishlistApi } from "../lib/endpoints";
import { currencySymbol, formatMoney, formatNumber } from "../lib/format";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

/** Minor-unit multiplier for a currency. HUF is a whole-unit currency (no
 *  cents), EUR/USD use 2 decimal places. Matches the contract's
 *  `target_amount_minor` semantics. */
function minorFactor(currency: Couple["currency"]): number {
  return currency === "HUF" ? 1 : 100;
}

/** Minor units → the whole-unit number the couple typed (and we render via
 *  formatMoney, which expects whole units). */
function minorToWhole(minor: number, currency: Couple["currency"]): number {
  return minor / minorFactor(currency);
}

/** Square thumbnail for a wishlist row: the link's resolved og:image when we
 *  have one, otherwise a muted gift-icon placeholder so every row keeps the
 *  same line height. */
function WishlistThumb({ imageUrl, size = 40 }: { imageUrl: string | null; size?: number }) {
  const cls = "shrink-0 rounded-lg border border-paper-200 object-cover dark:border-umber-700";
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        loading="lazy"
        width={size}
        height={size}
        className={cls}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-lg border border-paper-200 bg-paper-100 text-ink-400 dark:border-umber-700 dark:bg-umber-700/40 dark:text-umber-300"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Gift size={Math.round(size * 0.45)} />
    </span>
  );
}

interface DrawerInit {
  /** Existing item being edited, or `null` for "create new". */
  item: WishlistItem | null;
}

export default function WishlistEditorPage() {
  const { t, locale } = useT();
  useDocumentMeta("seo.guest_page_title", "seo.guest_page_description");
  const toast = useToast();
  const confirm = useConfirm();
  const [couple, setCouple] = useState<Couple | null>(null);
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<DrawerInit | null>(null);

  const currency = couple?.currency ?? "HUF";

  async function refresh() {
    try {
      const [cR, wR] = await Promise.all([coupleApi.current(), wishlistApi.list()]);
      setCouple(cR.couple);
      setItems(wR.items);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onDelete(item: WishlistItem) {
    const ok = await confirm({
      title: t("wishlist_editor.delete_confirm_title"),
      body: t("wishlist_editor.delete_confirm_body"),
      confirmLabel: t("common.confirm_delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    const snapshot = items;
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      await wishlistApi.remove(item.id);
    } catch (e) {
      setItems(snapshot);
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  const sortedItems = [...items].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.id - b.id;
  });

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="font-grotesk">{t("wishlist_editor.title")}</h1>
          <span className="inline-flex shrink-0 items-center rounded-full border border-umber-300 bg-umber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-umber-700 dark:border-umber-600 dark:bg-umber-700/40 dark:text-umber-200">
            {t("wishlist_editor.dev_badge")}
          </span>
          <InfoHint text={t("wishlist_editor.subtitle")} />
        </div>
        <button type="button" className="btn-primary" onClick={() => setEditing({ item: null })}>
          <Plus size={16} />
          {t("wishlist_editor.add_item")}
        </button>
      </header>

      {loading ? (
        <WishlistListSkeleton />
      ) : sortedItems.length === 0 ? (
        <div className="card stationery text-center">
          <Gift size={28} className="mx-auto text-ink-400 dark:text-umber-300" aria-hidden />
          <p className="mx-auto mt-3 max-w-md text-sm text-ink-600 dark:text-umber-200">
            {t("wishlist_editor.empty_state")}
          </p>
          <button
            type="button"
            className="btn-primary mt-4 inline-flex"
            onClick={() => setEditing({ item: null })}
          >
            <Plus size={16} />
            {t("wishlist_editor.add_item")}
          </button>
        </div>
      ) : (
        <ul className="card divide-y divide-paper-200 p-0 dark:divide-umber-700">
          {sortedItems.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-paper-100/60 dark:hover:bg-umber-700"
            >
              <button
                type="button"
                onClick={() => setEditing({ item })}
                aria-label={t("common.edit")}
                className="flex min-w-0 flex-1 items-center gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 focus-visible:ring-offset-2"
              >
                <WishlistThumb imageUrl={item.image_url} />
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="truncate text-sm font-medium text-ink-900 dark:text-paper-50">
                    {item.title}
                  </span>
                  <span className="inline-flex shrink-0 items-center rounded-full bg-paper-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-600 dark:bg-umber-700 dark:text-umber-200">
                    {t(`wishlist_editor.kind_${item.kind}`)}
                  </span>
                  {item.target_amount_minor !== null && (
                    <span className="shrink-0 tabular-nums text-xs text-ink-500 dark:text-umber-300">
                      {formatMoney(
                        minorToWhole(item.target_amount_minor, item.currency ?? currency),
                        item.currency ?? currency,
                        locale,
                      )}
                    </span>
                  )}
                  {item.url && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-500 dark:text-umber-300">
                      <ExternalLink size={11} aria-hidden />
                      {t("guest_portal.wishlist_external_link_label")}
                    </span>
                  )}
                </span>
              </button>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={t("common.edit")}
                  title={t("common.edit")}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-800 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
                  onClick={() => setEditing({ item })}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  aria-label={t("common.remove")}
                  title={t("common.remove")}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-blush-700 transition-colors hover:bg-blush-100 dark:text-blush-300 dark:hover:bg-blush-400/15"
                  onClick={() => void onDelete(item)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <WishlistItemDialog
          init={editing}
          currency={currency}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            setItems((prev) => {
              const idx = prev.findIndex((i) => i.id === saved.id);
              if (idx === -1) return [...prev, saved];
              const next = prev.slice();
              next[idx] = saved;
              return next;
            });
          }}
          onConflict={async () => {
            await refresh();
          }}
        />
      )}
    </>
  );
}

function WishlistListSkeleton() {
  const widths = ["64%", "48%", "72%", "40%"];
  return (
    <ul className="card divide-y divide-paper-200 p-0 dark:divide-umber-700" aria-hidden="true">
      {widths.map((w, i) => (
        <li key={i} className="flex items-start gap-4 px-4 py-3">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton variant="block" height={14} width={w} rounded="md" />
            <Skeleton variant="block" width={88} height={11} rounded="md" />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Skeleton variant="circle" width={28} />
            <Skeleton variant="circle" width={28} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function WishlistItemDialog({
  init,
  currency,
  onClose,
  onSaved,
  onConflict,
}: {
  init: DrawerInit;
  currency: Couple["currency"];
  onClose: () => void;
  onSaved: (item: WishlistItem) => void;
  onConflict: () => Promise<void>;
}) {
  const { t, locale } = useT();
  const toast = useToast();
  const existing = init.item;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [kind, setKind] = useState<WishlistKind>(existing?.kind ?? "item");
  const [description, setDescription] = useState(existing?.description ?? "");
  // Per-item currency. Defaults to the couple's site currency; the couple can
  // override it for a single wish (e.g. an item only sold abroad). We send null
  // when it matches the couple's so the row keeps inheriting future changes.
  const [itemCurrency, setItemCurrency] = useState<Currency>(existing?.currency ?? currency);
  // Amount is entered + displayed in WHOLE currency units (rounded — rough
  // wishes don't need cents); we convert to/from minor units only at the API
  // boundary. Stored here as a raw digit string; the input renders it grouped.
  const [amount, setAmount] = useState<string>(
    existing?.target_amount_minor !== null && existing?.target_amount_minor !== undefined
      ? String(
          Math.round(minorToWhole(existing.target_amount_minor, existing.currency ?? currency)),
        )
      : "",
  );
  const [url, setUrl] = useState(existing?.url ?? "");
  // Resolved preview image (og:image). Seeded from the existing row; re-fetched
  // when the couple enters/changes the URL (on blur, to avoid a request per
  // keystroke). Sent with the save so the row/guest card show a thumbnail.
  const [imageUrl, setImageUrl] = useState<string | null>(existing?.image_url ?? null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // The URL the current `imageUrl` was resolved from, so we don't re-fetch an
  // unchanged link on every blur.
  const [previewedUrl, setPreviewedUrl] = useState(existing?.url ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  async function resolvePreview() {
    const trimmed = url.trim();
    if (trimmed === previewedUrl) return; // unchanged since last resolve
    setPreviewedUrl(trimmed);
    if (!trimmed) {
      setImageUrl(null);
      return;
    }
    setPreviewLoading(true);
    try {
      const r = await wishlistApi.linkPreview(trimmed);
      setImageUrl(r.image_url);
    } catch {
      // Soft failure — keep whatever thumbnail we had; saving still works.
    } finally {
      setPreviewLoading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleError(t("wishlist_editor.title_label"));
      return;
    }
    setTitleError(null);

    // Parse the rough amount into integer minor units, or leave null. The raw
    // digit string holds whole units in `itemCurrency`.
    let targetMinor: number | null = null;
    const trimmedAmount = amount.trim();
    if (trimmedAmount !== "") {
      const parsed = Number(trimmedAmount.replace(/\D/g, ""));
      if (Number.isFinite(parsed) && parsed >= 0) {
        targetMinor = Math.round(parsed * minorFactor(itemCurrency));
      }
    }

    const trimmedUrl = url.trim();
    const body: UpsertWishlistItemInput = {
      title: trimmedTitle.slice(0, WISHLIST_MAX_TITLE_LEN),
      kind,
      description: description.trim() ? description.trim().slice(0, WISHLIST_MAX_DESC_LEN) : null,
      target_amount_minor: targetMinor,
      // Persist an override only when it differs from the couple's currency, so
      // an unchanged item keeps tracking the couple-level setting.
      currency: itemCurrency === currency ? null : itemCurrency,
      url: trimmedUrl ? trimmedUrl.slice(0, WISHLIST_MAX_URL_LEN) : null,
      // Send the resolved preview image when we have one. When empty, omit the
      // field so the server resolves the og:image itself (fallback for links
      // pasted + saved before the on-blur fetch finished).
      ...(imageUrl ? { image_url: imageUrl } : {}),
    };

    setSubmitting(true);
    try {
      if (existing) {
        const r = await wishlistApi.update(existing.id, body, { ifMatch: existing.updated_at });
        onSaved(r.item);
      } else {
        const r = await wishlistApi.create(body);
        onSaved(r.item);
      }
      toast.success(t("wishlist_editor.saved_toast"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(t("wishlist_editor.stale_reload"));
        await onConflict();
        onClose();
        return;
      }
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        className="flex w-full max-w-lg max-h-[85vh] flex-col overflow-hidden rounded-2xl bg-paper-50 shadow-pop dark:bg-umber-800"
        onSubmit={onSubmit}
      >
        <div className="flex items-center justify-between border-b border-paper-200 px-6 py-4 dark:border-umber-700">
          <h2 className="text-base font-semibold text-ink-900 dark:text-paper-50 font-grotesk">
            {existing ? t("common.edit") : t("wishlist_editor.add_item")}
          </h2>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={onClose}
            aria-label={t("common.cancel")}
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <FormRow label={t("wishlist_editor.title_label")} error={titleError}>
            <input
              className={`input font-grotesk ${titleError ? "input-invalid" : ""}`}
              type="text"
              value={title}
              maxLength={WISHLIST_MAX_TITLE_LEN}
              placeholder={t("wishlist_editor.title_placeholder")}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleError) setTitleError(null);
              }}
              aria-invalid={titleError ? true : undefined}
              autoFocus
            />
          </FormRow>

          <FormRow label={t("wishlist_editor.kind_label")}>
            <select
              className="input font-grotesk"
              value={kind}
              onChange={(e) => setKind(e.target.value as WishlistKind)}
            >
              {WISHLIST_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`wishlist_editor.kind_${k}`)}
                </option>
              ))}
            </select>
          </FormRow>

          <FormRow label={t("wishlist_editor.description_label")}>
            <textarea
              className="input font-grotesk"
              rows={3}
              value={description}
              maxLength={WISHLIST_MAX_DESC_LEN}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("wishlist_editor.description_placeholder")}
            />
          </FormRow>

          <FormRow
            label={t("wishlist_editor.target_amount_label")}
            hint={t("wishlist_editor.target_amount_hint")}
          >
            <div className="relative">
              <input
                className="input pr-24 font-grotesk tabular-nums"
                type="text"
                inputMode="numeric"
                // Display the raw digits with locale thousands grouping (HU
                // "200 000", EN "200,000"); store only digits so the math stays
                // exact regardless of the visible separator.
                value={amount === "" ? "" : formatNumber(Number(amount), locale)}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                placeholder="0"
              />
              <select
                className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-md border border-paper-300 bg-white py-1 pl-2 pr-1 font-grotesk text-sm text-ink-700 focus:border-ink-600 focus:outline-none dark:border-umber-700 dark:bg-umber-900 dark:text-paper-100"
                value={itemCurrency}
                onChange={(e) => setItemCurrency(e.target.value as Currency)}
                aria-label={t("wishlist_editor.currency_aria")}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {currencySymbol(c, locale)}
                  </option>
                ))}
              </select>
            </div>
          </FormRow>

          <FormRow label={t("wishlist_editor.url_label")} hint={t("wishlist_editor.url_hint")}>
            <div className="flex items-center gap-3">
              {(imageUrl || previewLoading) && (
                <span className="shrink-0">
                  {previewLoading ? (
                    <Skeleton variant="block" width={44} height={44} rounded="lg" />
                  ) : (
                    <WishlistThumb imageUrl={imageUrl} size={44} />
                  )}
                </span>
              )}
              <input
                className="input flex-1 font-grotesk"
                type="url"
                value={url}
                maxLength={WISHLIST_MAX_URL_LEN}
                inputMode="url"
                autoComplete="off"
                onChange={(e) => setUrl(e.target.value)}
                onBlur={() => void resolvePreview()}
                placeholder={t("wishlist_editor.url_placeholder")}
              />
            </div>
          </FormRow>
        </div>
        <div className="flex gap-2 border-t border-paper-200 px-6 py-4 dark:border-umber-700">
          <button type="button" className="btn-ghost flex-1" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={submitting}>
            {submitting ? t("common.saving") : t("wishlist_editor.save_button")}
          </button>
        </div>
      </form>
    </div>
  );
}

function FormRow({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | null;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-3">
      <label className="field-label">{label}</label>
      {children}
      {hint && !error ? (
        <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">{hint}</p>
      ) : null}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
