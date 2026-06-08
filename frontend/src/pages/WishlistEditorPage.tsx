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

import {
  RECEIVED_GIFT_MAX_NOTE_LEN,
  RECEIVED_GIFT_MAX_TITLE_LEN,
  type ReceivedGift,
} from "@shared/received_gifts";
import type { Couple, Guest } from "@shared/types";
import { CURRENCIES, type Currency } from "@shared/types";
import type { UpsertWishlistItemInput, WishlistItem, WishlistKind } from "@shared/wishlist";
import {
  WISHLIST_KINDS,
  WISHLIST_MAX_DESC_LEN,
  WISHLIST_MAX_TITLE_LEN,
  WISHLIST_MAX_URL_LEN,
} from "@shared/wishlist";
import {
  ChevronDown,
  ExternalLink,
  Gift,
  HandHeart,
  LayoutGrid,
  PackageCheck,
  Pencil,
  Plus,
  Rows3,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { InfoHint } from "../components/InfoHint";
import { Skeleton, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { coupleApi, guestApi, receivedGiftApi, wishlistApi } from "../lib/endpoints";
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
 *  have one, otherwise a muted placeholder so every row keeps the same line
 *  height. The placeholder glyph depends on the kind: a gift box for gifts, an
 *  offered-heart for personal requests (a letter / photo / song is a gesture,
 *  not a boxed gift). */
function WishlistThumb({
  imageUrl,
  size = 40,
  Icon = Gift,
}: {
  imageUrl: string | null;
  size?: number;
  Icon?: typeof Gift;
}) {
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
      <Icon size={Math.round(size * 0.45)} />
    </span>
  );
}

interface DrawerInit {
  /** Existing item being edited, or `null` for "create new". */
  item: WishlistItem | null;
  /** For "create new": which kind the dialog opens on (gifts vs requests
   *  section add buttons). Ignored when editing an existing item. */
  presetKind?: WishlistKind;
  /** For "create new": prefilled title (request example quick-add chips). */
  presetTitle?: string;
}

/** Editor layout: a dense "sávos" row list or a "kártya" card grid. Persisted
 *  per device so the couple's preferred view sticks across visits. */
type WishlistView = "list" | "cards";
const VIEW_STORAGE_KEY = "weddly.wishlist.view";

/** The three collapsible sections on the page. */
type SectionKey = "gifts" | "requests" | "received";
const COLLAPSE_STORAGE_KEY = "weddly.wishlist.collapsed";

/** Example request prompts shown as quick-add chips on the empty requests
 *  section — they prefill the dialog title, nothing is persisted until saved
 *  (no fake seed data). */
const REQUEST_EXAMPLE_KEYS = [
  "request_example_letter",
  "request_example_photo",
  "request_example_song",
  "request_example_time",
] as const;

/** GoFundMe-style soft-pledge progress for a group gift: how much guests have
 *  said they'll chip in toward the rough amount, plus the helper count. No
 *  money moves — purely a coordination signal. `layout` places the bar beside
 *  the row content (list view) or stacked below it (card view). */
function WishlistProgress({
  pledgedMinor,
  targetMinor,
  interestCount,
  currency,
  locale,
  layout,
  t,
}: {
  pledgedMinor: number;
  targetMinor: number;
  interestCount: number;
  currency: Currency;
  locale: "hu" | "en";
  layout: "beside" | "below";
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const target = minorToWhole(targetMinor, currency);
  const pledged = minorToWhole(pledgedMinor, currency);
  const pct = target > 0 ? Math.min(100, Math.round((pledged / target) * 100)) : 0;
  return (
    <div className={layout === "beside" ? "w-40 shrink-0 sm:w-48" : "mt-2"}>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-emerald-500 transition-[width] dark:bg-emerald-400"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[11px] text-ink-500 dark:text-umber-300">
        <span className="tabular-nums">
          {formatMoney(pledged, currency, locale)} / {formatMoney(target, currency, locale)}
        </span>
        {interestCount > 0 && (
          <span>{t("wishlist_editor.pledged_count", { count: interestCount })}</span>
        )}
      </div>
    </div>
  );
}

interface ItemViewProps {
  item: WishlistItem;
  currency: Currency;
  locale: "hu" | "en";
  t: (key: string, vars?: Record<string, string | number>) => string;
  onEdit: () => void;
  onDelete: () => void;
}

/** A gift with a rough price shows the soft-pledge progress bar; requests carry
 *  no money, so never a bar. */
function itemHasBar(item: WishlistItem): boolean {
  return item.kind === "gift" && item.target_amount_minor !== null && item.target_amount_minor > 0;
}

/** Edit + delete affordances, shared by both views. */
function ItemActions({ t, onEdit, onDelete }: Pick<ItemViewProps, "t" | "onEdit" | "onDelete">) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        aria-label={t("common.edit")}
        title={t("common.edit")}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-800 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
        onClick={onEdit}
      >
        <Pencil size={14} />
      </button>
      <button
        type="button"
        aria-label={t("common.remove")}
        title={t("common.remove")}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-blush-700 transition-colors hover:bg-blush-100 dark:text-blush-300 dark:hover:bg-blush-400/15"
        onClick={onDelete}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

/** "Sávos" view: a dense row. The progress bar sits BESIDE the content (before
 *  the action buttons) on wide screens. */
function WishlistRow({ item, currency, locale, t, onEdit, onDelete }: ItemViewProps) {
  const cur = item.currency ?? currency;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-paper-100/60 dark:hover:bg-umber-700">
      <button
        type="button"
        onClick={onEdit}
        aria-label={t("common.edit")}
        className="flex min-w-0 flex-1 items-center gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 focus-visible:ring-offset-2"
      >
        <WishlistThumb
          imageUrl={item.image_url}
          Icon={item.kind === "request" ? HandHeart : Gift}
        />
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-medium text-ink-900 dark:text-paper-50">
            {item.title}
          </span>
          {item.target_amount_minor !== null && (
            <span className="shrink-0 tabular-nums text-xs text-ink-500 dark:text-umber-300">
              {formatMoney(minorToWhole(item.target_amount_minor, cur), cur, locale)}
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
      {itemHasBar(item) && (
        <div className="hidden sm:block">
          <WishlistProgress
            pledgedMinor={item.pledged_amount_minor}
            targetMinor={item.target_amount_minor ?? 0}
            interestCount={item.interest_count}
            currency={cur}
            locale={locale}
            layout="beside"
            t={t}
          />
        </div>
      )}
      <ItemActions t={t} onEdit={onEdit} onDelete={onDelete} />
    </li>
  );
}

/** "Kártya" view: a card with the image up top, then the title/meta, then the
 *  progress bar stacked BELOW. */
function WishlistCardItem({ item, currency, locale, t, onEdit, onDelete }: ItemViewProps) {
  const cur = item.currency ?? currency;
  return (
    // Fixed card height with a 3/5 image · 2/5 text split. The whole row of
    // cards stretches to a uniform height, so pinning the ratio keeps every
    // card consistent regardless of how much text each item carries.
    <li className="card flex h-[20.8rem] flex-col overflow-hidden p-0 dark:border-umber-700">
      <button
        type="button"
        onClick={onEdit}
        aria-label={t("common.edit")}
        className="block shrink-0 basis-3/5 overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink-300"
      >
        {item.image_url ? (
          <img src={item.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-paper-100 text-ink-300 dark:bg-umber-700/40 dark:text-umber-300">
            <Gift size={28} aria-hidden />
          </span>
        )}
      </button>
      <div className="flex basis-2/5 flex-col px-4 py-3">
        <button
          type="button"
          onClick={onEdit}
          aria-label={t("common.edit")}
          className="flex flex-col gap-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink-300"
        >
          {item.target_amount_minor !== null && (
            <span className="tabular-nums text-xs text-ink-500 dark:text-umber-300">
              {formatMoney(minorToWhole(item.target_amount_minor, cur), cur, locale)}
            </span>
          )}
          <span className="line-clamp-2 text-sm font-medium text-ink-900 dark:text-paper-50">
            {item.title}
          </span>
          {item.url && (
            <span className="inline-flex w-fit items-center gap-1 text-xs text-ink-500 dark:text-umber-300">
              <ExternalLink size={11} aria-hidden />
              {t("guest_portal.wishlist_external_link_label")}
            </span>
          )}
        </button>
        <div className="mt-auto pt-2">
          {itemHasBar(item) && (
            <WishlistProgress
              pledgedMinor={item.pledged_amount_minor}
              targetMinor={item.target_amount_minor ?? 0}
              interestCount={item.interest_count}
              currency={cur}
              locale={locale}
              layout="below"
              t={t}
            />
          )}
          <div className="mt-2 flex justify-end">
            <ItemActions t={t} onEdit={onEdit} onDelete={onDelete} />
          </div>
        </div>
      </div>
    </li>
  );
}

/** A section whose body collapses behind a chevron. The header (title + the
 *  optional action buttons) stays visible when collapsed so the couple can
 *  still add items / flip the view without expanding. */
function CollapsibleSection({
  title,
  open,
  onToggle,
  actions,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="-ml-1 flex items-center gap-1.5 rounded-lg p-1 text-left transition-colors hover:bg-paper-100 dark:hover:bg-umber-800"
        >
          <ChevronDown
            size={18}
            aria-hidden
            className={`shrink-0 text-ink-500 transition-transform dark:text-umber-300 ${
              open ? "" : "-rotate-90"
            }`}
          />
          <h2 className="font-grotesk text-xl text-ink-900 dark:text-paper-50">{title}</h2>
        </button>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {open && children}
    </section>
  );
}

// ── Received-gifts grid ──────────────────────────────────────────────────────

/** One editable grid row. `id` is null until the row gains content and is
 *  persisted; `savedSig` is the signature of the last-persisted state so a
 *  blur with no change skips the network. */
interface RGRow {
  key: string;
  id: number | null;
  guest_id: number | null;
  title: string;
  note: string;
  updated_at: number | null;
  savedSig: string;
}

/** Signature of a row's persistable content (trimmed): drives change
 *  detection + the non-empty check. */
function rgSig(guestId: number | null, title: string, note: string): string {
  return JSON.stringify([guestId, title.trim(), note.trim()]);
}
function rgNonEmpty(r: RGRow): boolean {
  return r.guest_id !== null || r.title.trim() !== "" || r.note.trim() !== "";
}

/** The couple's private "what we received" ledger as an auto-growing grid:
 *  always at least 5 rows and always 2 trailing empties, so there's room to
 *  keep typing. Each row persists on blur (create / update / delete) with the
 *  same optimistic-concurrency contract as the wishlist. */
function ReceivedGiftsTable({
  initialItems,
  guests,
  t,
}: {
  initialItems: ReceivedGift[];
  guests: Guest[];
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const toast = useToast();
  const keySeq = useRef(0);
  const nextKey = () => `rg-${keySeq.current++}`;

  const makeEmpty = (): RGRow => ({
    key: nextKey(),
    id: null,
    guest_id: null,
    title: "",
    note: "",
    updated_at: null,
    savedSig: rgSig(null, "", ""),
  });

  /** Normalise the trailing empties: keep every row up to the last filled one
   *  (stable keys), then ensure there are exactly enough blank rows for a
   *  max(3, filled+2) total, always at least 2 to type into. EXISTING trailing
   *  empties are preserved (not regenerated) so a row the couple just tabbed
   *  into doesn't remount and lose focus; only the surplus is trimmed / the
   *  shortfall appended. */
  function withTail(rows: RGRow[]): RGRow[] {
    let lastFilled = -1;
    rows.forEach((r, i) => {
      if (rgNonEmpty(r)) lastFilled = i;
    });
    const filled = rows.slice(0, lastFilled + 1);
    const targetEmpties = Math.max(2, 3 - filled.length);
    const empties = rows.slice(lastFilled + 1).slice(0, targetEmpties);
    while (empties.length < targetEmpties) empties.push(makeEmpty());
    return [...filled, ...empties];
  }

  const [rows, setRows] = useState<RGRow[]>(() =>
    withTail(
      initialItems.map((it) => ({
        key: `rg-init-${it.id}`,
        id: it.id,
        guest_id: it.guest_id,
        title: it.title,
        note: it.note ?? "",
        updated_at: it.updated_at,
        savedSig: rgSig(it.guest_id, it.title, it.note ?? ""),
      })),
    ),
  );

  function patchRow(key: string, patch: Partial<RGRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  /** Persist a row on blur / select change. Creates when a draft gains content,
   *  updates a changed persisted row, deletes one cleared back to empty. */
  async function commit(key: string) {
    // Read the latest row off state via the functional updater pattern below;
    // we snapshot it synchronously here for the async work.
    const r = rows.find((x) => x.key === key);
    if (!r) return;
    const sig = rgSig(r.guest_id, r.title, r.note);
    if (sig === r.savedSig) {
      setRows((prev) => withTail(prev));
      return;
    }
    const body = {
      guest_id: r.guest_id,
      title: r.title.trim(),
      note: r.note.trim() || null,
    };
    try {
      if (r.id === null) {
        if (!rgNonEmpty(r)) return; // empty draft, nothing to do
        const res = await receivedGiftApi.create(body);
        patchRow(key, { id: res.item.id, updated_at: res.item.updated_at, savedSig: sig });
        setRows((prev) => withTail(prev));
      } else if (!rgNonEmpty(r)) {
        await receivedGiftApi.remove(r.id);
        patchRow(key, { id: null, updated_at: null, savedSig: rgSig(null, "", "") });
        setRows((prev) => withTail(prev));
      } else {
        // Last-write-wins by design: this is an auto-saving grid where tabbing
        // between two fields in the same row fires two near-simultaneous
        // commits. Sending the (now-stale) updated_at as If-Match here would
        // self-inflict a 409 on the second one, so we don't. The whole row is
        // sent on every blur. The backend still supports If-Match for callers
        // that want it.
        const res = await receivedGiftApi.update(r.id, body);
        patchRow(key, { updated_at: res.item.updated_at, savedSig: sig });
        setRows((prev) => withTail(prev));
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  async function removeRow(r: RGRow) {
    if (r.id !== null) {
      try {
        await receivedGiftApi.remove(r.id);
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
        return;
      }
    }
    setRows((prev) => withTail(prev.filter((x) => x.key !== r.key)));
  }

  const cellInput =
    "w-full bg-transparent px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:bg-paper-100 dark:text-paper-50 dark:placeholder:text-umber-400 dark:focus:bg-umber-800";

  return (
    <div className="card overflow-hidden p-0 dark:border-umber-700">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-paper-200 bg-paper-100/60 text-left text-xs font-medium text-ink-500 dark:border-umber-700 dark:bg-umber-800/60 dark:text-umber-300">
              <th className="w-[28%] min-w-[10rem] px-3 py-2 font-medium">
                {t("wishlist_editor.received_col_guest")}
              </th>
              <th className="w-[30%] min-w-[10rem] px-3 py-2 font-medium">
                {t("wishlist_editor.received_col_gift")}
              </th>
              <th className="px-3 py-2 font-medium">{t("wishlist_editor.received_col_note")}</th>
              <th className="w-10 px-1 py-2" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                className="border-b border-paper-200 last:border-0 dark:border-umber-700"
              >
                <td className="border-r border-paper-200 align-middle dark:border-umber-700">
                  {/* Native arrow kept (no appearance-none) as the only
                      affordance, since the unassigned state shows a blank label
                      rather than repeating "no guest" down every row. */}
                  <select
                    className={`${cellInput} cursor-pointer font-grotesk ${
                      r.guest_id === null ? "text-ink-400 dark:text-umber-400" : ""
                    }`}
                    value={r.guest_id ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      patchRow(r.key, { guest_id: v === "" ? null : Number(v) });
                    }}
                    onBlur={() => void commit(r.key)}
                    aria-label={t("wishlist_editor.received_col_guest")}
                  >
                    <option value="" aria-label={t("wishlist_editor.received_guest_none")} />
                    {guests.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.full_name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="border-r border-paper-200 align-middle dark:border-umber-700">
                  <input
                    type="text"
                    className={`${cellInput} font-grotesk`}
                    value={r.title}
                    maxLength={RECEIVED_GIFT_MAX_TITLE_LEN}
                    onChange={(e) => patchRow(r.key, { title: e.target.value })}
                    onBlur={() => void commit(r.key)}
                  />
                </td>
                <td className="align-middle">
                  <input
                    type="text"
                    className={`${cellInput} font-grotesk`}
                    value={r.note}
                    maxLength={RECEIVED_GIFT_MAX_NOTE_LEN}
                    onChange={(e) => patchRow(r.key, { note: e.target.value })}
                    onBlur={() => void commit(r.key)}
                  />
                </td>
                <td className="px-1 text-center align-middle">
                  {r.id !== null && (
                    <button
                      type="button"
                      aria-label={t("common.remove")}
                      title={t("common.remove")}
                      onClick={() => void removeRow(r)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-blush-700 transition-colors hover:bg-blush-100 dark:text-blush-300 dark:hover:bg-blush-400/15"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
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
  const [view, setView] = useState<WishlistView>(() =>
    typeof localStorage !== "undefined" && localStorage.getItem(VIEW_STORAGE_KEY) === "cards"
      ? "cards"
      : "list",
  );

  function changeView(next: WishlistView) {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Private-mode / disabled storage — the in-memory state still switches.
    }
  }

  const currency = couple?.currency ?? "HUF";
  const [publishing, setPublishing] = useState(false);
  // Guest list (for the received-gifts allocation dropdown) + the received
  // gifts themselves. Fetched alongside the wishlist on load.
  const [guests, setGuests] = useState<Guest[]>([]);
  const [received, setReceived] = useState<ReceivedGift[]>([]);

  // Per-section collapse state, persisted per device. Default: all expanded.
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>(() => {
    const base = { gifts: false, requests: false, received: false };
    try {
      const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
      return raw ? { ...base, ...(JSON.parse(raw) as Partial<Record<SectionKey, boolean>>) } : base;
    } catch {
      return base;
    }
  });
  function toggleSection(key: SectionKey) {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Private-mode / disabled storage: the in-memory state still toggles.
      }
      return next;
    });
  }

  // Publish toggle: flips `couples.wishlist_published`. When on, confirmed
  // guests see the gift + request decks on the guest page (with the warm
  // intro); when off the server omits them entirely. Optimistic with a
  // rollback on failure, mirroring the row-delete flow above.
  async function togglePublish() {
    if (!couple || publishing) return;
    const next = !couple.wishlist_published;
    setPublishing(true);
    setCouple({ ...couple, wishlist_published: next });
    try {
      const r = await coupleApi.update({ wishlist_published: next });
      setCouple(r.couple);
      toast.success(
        next ? t("wishlist_editor.publish_toast_on") : t("wishlist_editor.publish_toast_off"),
      );
    } catch (e) {
      setCouple((prev) => (prev ? { ...prev, wishlist_published: !next } : prev));
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setPublishing(false);
    }
  }

  async function refresh() {
    try {
      const [cR, wR, gR, rR] = await Promise.all([
        coupleApi.current(),
        wishlistApi.list(),
        guestApi.list(),
        receivedGiftApi.list(),
      ]);
      setCouple(cR.couple);
      setItems(wR.items);
      setGuests(gR.guests);
      setReceived(rR.items);
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
  const gifts = sortedItems.filter((i) => i.kind === "gift");
  const requests = sortedItems.filter((i) => i.kind === "request");

  return (
    <>
      <header className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-3">
        <h1 className="font-grotesk">{t("wishlist_editor.title")}</h1>
        <InfoHint text={t("wishlist_editor.subtitle")} />
        {couple && (
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-medium text-ink-900 dark:text-paper-50">
                {t("wishlist_editor.publish_title")}
              </p>
              <p className="text-xs text-ink-500 dark:text-umber-300">
                {couple.wishlist_published
                  ? t("wishlist_editor.publish_on")
                  : t("wishlist_editor.publish_off")}
              </p>
            </div>
            {/* On = green fill + dark outline; off = muted track. A constant
                2px border keeps the thumb geometry stable across states. */}
            <button
              type="button"
              role="switch"
              aria-checked={couple.wishlist_published}
              aria-label={t("wishlist_editor.publish_title")}
              disabled={publishing}
              onClick={() => void togglePublish()}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 focus-visible:ring-offset-2 disabled:opacity-60 ${
                couple.wishlist_published
                  ? "bg-emerald-600 dark:bg-emerald-500"
                  : "bg-paper-300 dark:bg-umber-700"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                  couple.wishlist_published ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        )}
      </header>

      {loading ? (
        <WishlistListSkeleton />
      ) : (
        <div className="space-y-10">
          {/* ── Gifts ───────────────────────────────────────────────── */}
          <CollapsibleSection
            title={t("wishlist_editor.section_gifts_title")}
            open={!collapsed.gifts}
            onToggle={() => toggleSection("gifts")}
            actions={
              <>
                {gifts.length > 0 && (
                  // Single toggle: shows the icon of the *other* layout and
                  // flips to it on click.
                  <button
                    type="button"
                    aria-label={
                      view === "list"
                        ? t("wishlist_editor.view_cards")
                        : t("wishlist_editor.view_list")
                    }
                    onClick={() => changeView(view === "list" ? "cards" : "list")}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-ink-900 text-ink-900 transition-colors hover:bg-paper-100 dark:border-paper-100 dark:text-paper-50 dark:hover:bg-umber-700"
                  >
                    {view === "list" ? <LayoutGrid size={16} /> : <Rows3 size={16} />}
                  </button>
                )}
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setEditing({ item: null, presetKind: "gift" })}
                >
                  <Plus size={16} />
                  {t("wishlist_editor.add_gift")}
                </button>
              </>
            }
          >
            {gifts.length === 0 ? (
              <div className="card stationery text-center">
                <Gift size={28} className="mx-auto text-ink-400 dark:text-umber-300" aria-hidden />
                <p className="mx-auto mt-3 max-w-md text-sm text-ink-600 dark:text-umber-200">
                  {t("wishlist_editor.gifts_empty")}
                </p>
              </div>
            ) : view === "list" ? (
              <ul className="card divide-y divide-paper-200 p-0 dark:divide-umber-700">
                {gifts.map((item) => (
                  <WishlistRow
                    key={item.id}
                    item={item}
                    currency={currency}
                    locale={locale}
                    t={t}
                    onEdit={() => setEditing({ item })}
                    onDelete={() => void onDelete(item)}
                  />
                ))}
              </ul>
            ) : (
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {gifts.map((item) => (
                  <WishlistCardItem
                    key={item.id}
                    item={item}
                    currency={currency}
                    locale={locale}
                    t={t}
                    onEdit={() => setEditing({ item })}
                    onDelete={() => void onDelete(item)}
                  />
                ))}
              </ul>
            )}
          </CollapsibleSection>

          {/* ── Requests (personal, no money) ───────────────────────── */}
          <CollapsibleSection
            title={t("wishlist_editor.section_requests_title")}
            open={!collapsed.requests}
            onToggle={() => toggleSection("requests")}
            actions={
              <button
                type="button"
                className="btn-outline"
                onClick={() => setEditing({ item: null, presetKind: "request" })}
              >
                <Plus size={16} />
                {t("wishlist_editor.add_request")}
              </button>
            }
          >
            {/* No max-width cap so the line uses the full content width and
                stays on one row on desktop; it still wraps naturally on
                narrow / mobile viewports. */}
            <p className="mb-3 text-sm text-ink-500 dark:text-umber-300">
              {t("wishlist_editor.section_requests_subtitle")}
            </p>
            {requests.length === 0 ? (
              // Compact empty state: roughly half the height of a full card so
              // the request examples don't dominate the page. Smaller padding +
              // tighter type than the gifts empty card above.
              <div className="card stationery p-3">
                <p className="text-xs text-ink-600 dark:text-umber-200">
                  {t("wishlist_editor.requests_empty")}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-medium text-ink-500 dark:text-umber-300">
                    {t("wishlist_editor.request_examples_label")}
                  </span>
                  {REQUEST_EXAMPLE_KEYS.map((key) => {
                    const label = t(`wishlist_editor.${key}`);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() =>
                          setEditing({ item: null, presetKind: "request", presetTitle: label })
                        }
                        className="inline-flex items-center gap-1 rounded-full border border-paper-300 px-3 py-1 text-xs text-ink-700 transition-colors hover:bg-paper-100 dark:border-umber-700 dark:text-paper-100 dark:hover:bg-umber-800"
                      >
                        <Plus size={12} aria-hidden />
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <ul className="card divide-y divide-paper-200 p-0 dark:divide-umber-700">
                {requests.map((item) => (
                  <WishlistRow
                    key={item.id}
                    item={item}
                    currency={currency}
                    locale={locale}
                    t={t}
                    onEdit={() => setEditing({ item })}
                    onDelete={() => void onDelete(item)}
                  />
                ))}
              </ul>
            )}
          </CollapsibleSection>

          {/* ── Received gifts (private ledger, never published) ─────── */}
          <CollapsibleSection
            title={t("wishlist_editor.section_received_title")}
            open={!collapsed.received}
            onToggle={() => toggleSection("received")}
            actions={
              <span className="inline-flex items-center gap-1.5 text-xs text-ink-500 dark:text-umber-300">
                <PackageCheck size={14} aria-hidden />
                {t("wishlist_editor.received_private_badge")}
              </span>
            }
          >
            <p className="mb-3 max-w-2xl text-sm text-ink-500 dark:text-umber-300">
              {t("wishlist_editor.section_received_subtitle")}
            </p>
            <ReceivedGiftsTable initialItems={received} guests={guests} t={t} />
          </CollapsibleSection>
        </div>
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
  const [title, setTitle] = useState(existing?.title ?? init.presetTitle ?? "");
  const [kind, setKind] = useState<WishlistKind>(existing?.kind ?? init.presetKind ?? "gift");
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
    // digit string holds whole units in `itemCurrency`. Requests carry no
    // money, so their amount + currency are always cleared.
    const isGift = kind === "gift";
    let targetMinor: number | null = null;
    const trimmedAmount = amount.trim();
    if (isGift && trimmedAmount !== "") {
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
      // an unchanged item keeps tracking the couple-level setting. Requests
      // never carry a currency.
      currency: !isGift || itemCurrency === currency ? null : itemCurrency,
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

          {/* Rough amount + currency apply to gifts only — a request (a letter,
              a photo) carries no money. */}
          {kind === "gift" && (
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
          )}

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
