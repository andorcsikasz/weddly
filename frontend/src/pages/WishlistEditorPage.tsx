// Couple-curated wishlist / gift registry. CRUD over the `wishlist_items`
// table — a card grid (or dense row list) with a dialog for add/edit and the
// received-gifts ledger on the "after the wedding" tab. Confirmed-tier guests
// see a read-only deck on the merged guest page; the couple manages it here.
//
// Layout notes (2026-07-28 redesign):
//  - The PICTURE leads. A wishlist is a shop window, so the card grid is the
//    default view and the image is the biggest thing on a card. Where the link
//    yields no og:image (Booking, most webshops behind a bot wall) the tile
//    falls to the shop's own logo and then to an icon the couple picks, so a
//    grid of six items never has holes in it — see `WishlistPicture`.
//  - One action per surface. Clicking an item edits it, so the card carries no
//    pencil; only reorder + delete live in the hover pill.
//  - Chrome is quiet: section titles are eyebrow labels with a count, and the
//    explanatory paragraphs moved into `InfoHint` tooltips (see
//    feedback_uber_like_minimal_copy) so the items own the page.
//
// Uber-like pass (2026-07-30, owner direction "change style and icons to be
// Uber like"). The rules, so a later edit doesn't drift back:
//  - ONE radius: `rounded-lg` (8px) on every surface — tile, thumbnail, menu,
//    dialog, ledger row. The 16px pill-ish corners read as soft/editorial; a
//    single tight radius is what makes a grid look engineered.
//  - The card is Uber Eats' anatomy: picture, then a BOLD title, then one grey
//    meta line. The price left the floating glass chip on the photo and became
//    the first thing in that meta line, because a price set in the type
//    hierarchy is read faster than one set in a badge, and the chip was the
//    only surface on the page needing a blur + a translucent border.
//  - Icons are ONE stroke weight (`ICON_STROKE` = 1.5) and one geometric
//    vocabulary. Anything decorative or clever went: the tabs carry no icons at
//    all (Uber's tab bars are type), `Globe` for "published" became `Eye`/
//    `EyeOff` (the state is visibility, so the icon should be the eye that is
//    open or shut), `PackageCheck` became `Lock` on the private badge, `Rows3`
//    became `List`, `Sparkles` became `Ticket`.
//  - Colour is monochrome + one accent. The pledge bar is ink, not sage: on a
//    page whose every other surface is neutral, a green bar was the loudest
//    thing on it and it was measuring a soft intention, not a payment.
//
// IMPORTANT: no money ever moves in-app. `target_amount_minor` is purely the
// couple's informational "this is roughly what it costs". We store + send it
// as integer MINOR units (HUF has no minor unit → whole forint; EUR/USD are
// cents), and convert to/from the couple's-currency whole-unit value the
// couple types into the form.

import {
  RECEIVED_GIFT_CATEGORIES,
  RECEIVED_GIFT_MAX_NOTE_LEN,
  RECEIVED_GIFT_MAX_TITLE_LEN,
  type ReceivedGift,
  type ReceivedGiftCategory,
} from "@shared/received_gifts";
import { minorUnitFactor } from "@shared/currency";
import type { Couple, Guest, Household } from "@shared/types";
import { CURRENCIES, type Currency } from "@shared/types";
import type {
  UpsertWishlistItemInput,
  WishlistIconSlug,
  WishlistImageKind,
  WishlistItem,
  WishlistKind,
} from "@shared/wishlist";
import { WISHLIST_KINDS, WISHLIST_MAX_DESC_LEN, WISHLIST_MAX_TITLE_LEN } from "@shared/wishlist";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Banknote,
  Eye,
  EyeOff,
  Gift,
  Heart,
  LayoutGrid,
  List,
  Loader2,
  Lock,
  MoreHorizontal,
  Plus,
  Tag,
  Ticket,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { InfoHint } from "../components/InfoHint";
import {
  defaultWishlistIcon,
  WISHLIST_ICON_CHOICES,
  WishlistPicture,
} from "../components/WishlistPicture";
import { SegmentedControl, Skeleton, SmartImage, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { coupleApi, guestApi, householdApi, receivedGiftApi, wishlistApi } from "../lib/endpoints";
import { currencySymbol, formatMoney, formatNumber } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

/** The `t()` function, threaded into the item components as a prop. */
type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** One stroke weight for every icon on the page. Lucide's default 2 reads
 *  chunky next to a tight grotesk, and a page that mixes weights looks like it
 *  borrowed its icons from two places. */
const ICON_STROKE = 1.5;

/** The single corner radius. Named rather than repeated so it stays single. */
const R = "rounded-lg";

/** The hairline that gives a tile its edge. `WishlistPicture` paints its ground
 *  in paper-100 — which is EXACTLY the app shell's light background — so an
 *  icon tile would have no boundary at all in light mode and the grid would
 *  read as glyphs floating on the page. A photo tile needs it too: a white
 *  product shot on cream loses its right edge the same way. Inset, so it
 *  doesn't grow the tile. */
const EDGE = "ring-1 ring-inset ring-paper-300 dark:ring-umber-700";

/** Minor units → the whole-unit number the couple typed (and we render via
 *  formatMoney, which expects whole units). */
function minorToWhole(minor: number, currency: Couple["currency"]): number {
  return minor / minorUnitFactor(currency);
}

/** The shop's own name, from its URL: "apple.com" says more than "View" does,
 *  and it tells the couple at a glance which item points where. Falls back to
 *  the raw string if the URL somehow doesn't parse (it was validated on write,
 *  so this is belt-and-braces). */
function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A page's `<title>` as a first-draft wish name. Shop titles are almost always
 *  "Product name | Shop" or "Product — Brand", and the whole 200-character
 *  string would land in a field the couple then has to clean up by hand, so we
 *  keep the meaningful segment: the first one, unless it is a bare brand
 *  ("GitHub - …"), in which case the longest wins. Trimmed at a word boundary —
 *  it is a draft, and the couple edits it in place. */
function draftTitleFromPage(raw: string): string {
  const segments = raw
    .split(/\s+[|·–—]\s+|\s+-\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const first = segments[0] ?? raw.trim();
  const longest = segments.reduce((a, b) => (b.length > a.length ? b : a), first);
  const picked = first.length >= 12 ? first : longest;
  if (picked.length <= 70) return picked;
  const cut = picked.slice(0, 70);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim();
}

/** An item's picture: the product photo, the shop's logo, or the icon the
 *  couple picked. Fills its parent, which owns the frame + aspect ratio.
 *  See `components/WishlistPicture.tsx` for why it is those three. */
function ItemPicture({
  item,
  zoom = false,
  dense = false,
}: {
  item: WishlistItem;
  /** Grow the photo slightly while the card is hovered. */
  zoom?: boolean;
  dense?: boolean;
}) {
  return <WishlistPicture item={item} zoom={zoom} dense={dense} className="h-full w-full" />;
}

interface DrawerInit {
  /** Existing item being edited, or `null` for "create new". */
  item: WishlistItem | null;
  /** For "create new": which kind the dialog opens on (gifts vs requests
   *  section add buttons). Ignored when editing an existing item. */
  presetKind?: WishlistKind;
}

/** Before / after the wedding day. "before" shows the gift wishlist + requests;
 *  "after" shows the received-gifts ledger. Persisted per device. */
type WishlistPhase = "before" | "after";
const PHASE_STORAGE_KEY = "weddly.wishlist.phase";

/** Editor layout: a "kártya" card grid (default — the pictures are the point)
 *  or a dense "sávos" row list. Persisted per device. */
type WishlistView = "list" | "cards";
const VIEW_STORAGE_KEY = "weddly.wishlist.view";

// The four quick-add example chips that used to sit on the empty requests
// section are gone (owner decision, 2026-07-30). They were four pre-written
// wishes presented as buttons, which is a menu to pick from rather than a
// prompt to think from, and the couple's own answer is the entire point of the
// section. The ideas survive as examples in the dialog's title placeholder,
// where they suggest without offering to fill the field in.
/** A gift with a rough price AND at least one guest chipping in shows the soft
 *  pledge bar. With nobody in yet there is nothing to plot — an empty track
 *  reading "0 Ft / 400 000 Ft" on every card was noise, so it stays hidden
 *  until the first pledge arrives. Requests never carry money, so never a bar. */
function itemHasBar(item: WishlistItem): boolean {
  return (
    item.kind === "gift" &&
    item.target_amount_minor !== null &&
    item.target_amount_minor > 0 &&
    (item.pledged_amount_minor > 0 || item.interest_count > 0)
  );
}

/** GoFundMe-style soft-pledge progress for a group gift: how much guests have
 *  said they'll chip in toward the rough amount, plus the helper count. No
 *  money moves — purely a coordination signal.
 *
 *  Monochrome by direction: the fill is ink on a paper track. Green here read
 *  as a payment bar clearing, which is exactly the thing this page never does. */
function PledgeBar({
  item,
  currency,
  locale,
  t,
}: {
  item: WishlistItem;
  currency: Currency;
  locale: Locale;
  t: Translate;
}) {
  const cur = item.currency ?? currency;
  const target = minorToWhole(item.target_amount_minor ?? 0, cur);
  const pledged = minorToWhole(item.pledged_amount_minor, cur);
  const pct = target > 0 ? Math.min(100, Math.round((pledged / target) * 100)) : 0;
  const fullyFunded = pct >= 100 && pledged > 0;
  return (
    <span className="block">
      <span
        className="flex h-[3px] w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          className="h-full rounded-full bg-ink-900 transition-[width] duration-500 dark:bg-paper-100"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-2 text-[11px] text-ink-500 dark:text-umber-300">
        {fullyFunded ? (
          <span className="font-semibold tabular-nums text-ink-900 dark:text-paper-50">
            {t("wishlist_editor.progress_fully_funded")}
          </span>
        ) : (
          <span className="tabular-nums">
            {formatMoney(pledged, cur, locale)}
            {pledged > 0 && <span className="text-ink-400 dark:text-umber-400"> · {pct}%</span>}
          </span>
        )}
        {item.interest_count > 0 && (
          <span>{t("wishlist_editor.pledged_count", { count: item.interest_count })}</span>
        )}
      </span>
    </span>
  );
}

interface ItemViewProps {
  item: WishlistItem;
  currency: Currency;
  locale: Locale;
  t: Translate;
  onEdit: () => void;
  onDelete: () => void;
  index: number;
  totalCount: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

/** Reorder + delete, behind ONE control. Three icon buttons pinned to every
 *  item was the loudest thing in a grid of pictures — and on touch, where
 *  there is no hover to hide them behind, they sat on every card at all times.
 *  Editing is the item's own click target, so the menu carries no "edit". */
function ItemMenu({
  t,
  onDelete,
  index,
  totalCount,
  onMoveUp,
  onMoveDown,
}: Pick<ItemViewProps, "t" | "onDelete" | "index" | "totalCount" | "onMoveUp" | "onMoveDown">) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const entry =
    "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-35";

  return (
    // The trigger hides until the item is hovered / focused (desktop) and
    // stays put on touch, where there is no hover. `open` overrides that:
    // otherwise moving the pointer away would fade an open menu out from
    // under the couple while it was still taking clicks.
    <span
      ref={ref}
      className={`relative inline-flex transition-opacity ${
        open ? "" : "sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
      }`}
    >
      <button
        type="button"
        aria-label={t("wishlist_editor.item_menu")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-paper-200 hover:text-ink-900 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-50"
      >
        <MoreHorizontal size={18} strokeWidth={ICON_STROKE} />
      </button>
      {open && (
        <span
          role="menu"
          className={`absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden border border-paper-200 bg-paper-50 py-1 shadow-pop dark:border-umber-700 dark:bg-umber-800 ${R}`}
        >
          <button
            type="button"
            role="menuitem"
            disabled={index === 0}
            onClick={() => {
              setOpen(false);
              onMoveUp();
            }}
            className={`${entry} text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700`}
          >
            <ArrowUp size={16} strokeWidth={ICON_STROKE} aria-hidden />
            {t("wishlist_editor.reorder_up")}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={index === totalCount - 1}
            onClick={() => {
              setOpen(false);
              onMoveDown();
            }}
            className={`${entry} text-ink-700 hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700`}
          >
            <ArrowDown size={16} strokeWidth={ICON_STROKE} aria-hidden />
            {t("wishlist_editor.reorder_down")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className={`${entry} text-blush-700 hover:bg-blush-50 dark:text-blush-300 dark:hover:bg-blush-400/15`}
          >
            <Trash2 size={16} strokeWidth={ICON_STROKE} aria-hidden />
            {t("common.remove")}
          </button>
        </span>
      )}
    </span>
  );
}

/** The link out to the shop, rendered as the shop's own domain. A real anchor,
 *  so it opens the page instead of the edit dialog — which is why it sits
 *  OUTSIDE the item's edit button rather than inside it. */
function ShopLink({ url, t, className = "" }: { url: string; t: Translate; className?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => e.stopPropagation()}
      title={url}
      aria-label={t("wishlist_editor.open_link", { host: hostLabel(url) })}
      className={`inline-flex max-w-full items-center gap-0.5 text-[0.8125rem] text-ink-500 underline-offset-2 transition-colors hover:text-ink-900 hover:underline dark:text-umber-300 dark:hover:text-paper-50 ${className}`}
    >
      <span className="truncate">{hostLabel(url)}</span>
      <ArrowUpRight size={13} strokeWidth={ICON_STROKE} className="shrink-0" aria-hidden />
    </a>
  );
}

/** Card view, built on Uber Eats' card anatomy: picture, bold title, one grey
 *  meta line. The price sits at the head of that meta line rather than in a
 *  glass chip on the photo — a price carried by the type hierarchy is read
 *  faster than one carried by a badge, and the chip needed a blur + a
 *  translucent border to survive whatever photo the shop's og:image gave us. */
function GiftTile({
  item,
  currency,
  locale,
  t,
  onEdit,
  onDelete,
  index,
  totalCount,
  onMoveUp,
  onMoveDown,
}: ItemViewProps) {
  const cur = item.currency ?? currency;
  const price =
    item.target_amount_minor !== null
      ? formatMoney(minorToWhole(item.target_amount_minor, cur), cur, locale)
      : null;
  return (
    <li className="group relative flex flex-col">
      <button
        type="button"
        onClick={onEdit}
        aria-label={t("common.edit")}
        className={`relative block aspect-[4/3] w-full overflow-hidden bg-paper-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 dark:bg-umber-800 dark:focus-visible:ring-paper-100 dark:focus-visible:ring-offset-umber-900 ${R} ${EDGE}`}
      >
        <ItemPicture item={item} zoom />
      </button>
      <div className="mt-2.5 flex items-start gap-1.5">
        <button
          type="button"
          onClick={onEdit}
          aria-label={t("common.edit")}
          className={`min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 dark:focus-visible:ring-paper-100 ${R}`}
        >
          <span className="line-clamp-2 block font-grotesk text-[0.95rem] font-semibold leading-snug tracking-[-0.01em] text-ink-900 dark:text-paper-50">
            {item.title}
          </span>
        </button>
        <span className="-mt-0.5 shrink-0">
          <ItemMenu
            t={t}
            onDelete={onDelete}
            index={index}
            totalCount={totalCount}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
          />
        </span>
      </div>
      {/* ONE meta line: price, then the shop the wish points at, or the
          couple's own note when it points nowhere. The full note lives in the
          dialog. The dot separator is the only punctuation the line gets. */}
      {(price || item.url || item.description) && (
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[0.8125rem] text-ink-500 dark:text-umber-300">
          {price && (
            <span className="shrink-0 font-medium tabular-nums text-ink-900 dark:text-paper-50">
              {price}
            </span>
          )}
          {price && (item.url || item.description) && (
            <span className="shrink-0 text-ink-300 dark:text-umber-600" aria-hidden>
              ·
            </span>
          )}
          {item.url ? (
            <ShopLink url={item.url} t={t} />
          ) : item.description ? (
            <span className="truncate">{item.description}</span>
          ) : null}
        </p>
      )}
      {itemHasBar(item) && (
        <div className="mt-2">
          <PledgeBar item={item} currency={currency} locale={locale} t={t} />
        </div>
      )}
    </li>
  );
}

/** List view: a dense row. Same information, a fraction of the height — for a
 *  couple who has thirty items and wants to scan, not browse. No card around
 *  it either; a hairline between rows and hover colour are enough. */
function WishlistRow({
  item,
  currency,
  locale,
  t,
  onEdit,
  onDelete,
  index,
  totalCount,
  onMoveUp,
  onMoveDown,
}: ItemViewProps) {
  const cur = item.currency ?? currency;
  return (
    <li
      className={`group flex items-center gap-3 px-2 py-3 transition-colors hover:bg-paper-100/70 dark:hover:bg-umber-800/60 ${R}`}
    >
      {/* The title button does NOT grow: the shop link has to sit right beside
          the title instead of drifting to the far edge of an empty row. */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button
          type="button"
          onClick={onEdit}
          aria-label={t("common.edit")}
          className={`flex min-w-0 items-center gap-3.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 dark:focus-visible:ring-paper-100 ${R}`}
        >
          <span
            className={`relative block h-12 w-12 shrink-0 overflow-hidden bg-paper-100 dark:bg-umber-800 ${R} ${EDGE}`}
          >
            <ItemPicture item={item} dense />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-grotesk text-sm font-semibold tracking-[-0.01em] text-ink-900 dark:text-paper-50">
              {item.title}
            </span>
            {item.target_amount_minor !== null && (
              <span className="block text-[0.8125rem] tabular-nums text-ink-500 dark:text-umber-300">
                {formatMoney(minorToWhole(item.target_amount_minor, cur), cur, locale)}
              </span>
            )}
          </span>
        </button>
        {item.url && (
          <span className="hidden shrink-0 sm:block">
            <ShopLink url={item.url} t={t} className="max-w-[9rem]" />
          </span>
        )}
      </div>
      {itemHasBar(item) && (
        <div className="hidden w-40 shrink-0 sm:block lg:w-48">
          <PledgeBar item={item} currency={currency} locale={locale} t={t} />
        </div>
      )}
      <div className="shrink-0">
        <ItemMenu
          t={t}
          onDelete={onDelete}
          index={index}
          totalCount={totalCount}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
        />
      </div>
    </li>
  );
}

/** A personal request — a letter, a childhood photo, a song. Same tile shape
 *  as a gift so the page reads as one storefront, but square rather than 4:3
 *  and carrying no money.
 *
 *  The title used to be set in the display serif, italic, to mark these as the
 *  sentimental half of the list. It went with the Uber pass: two type voices in
 *  one scroll is the thing that makes a page look assembled rather than
 *  designed, and the square crop plus the lone icon already say "not a SKU"
 *  without a second family doing it again. */
function RequestTile({
  item,
  t,
  onEdit,
  onDelete,
  index,
  totalCount,
  onMoveUp,
  onMoveDown,
}: Omit<ItemViewProps, "currency" | "locale">) {
  return (
    <li className="group relative flex flex-col">
      <button
        type="button"
        onClick={onEdit}
        aria-label={t("common.edit")}
        className={`block aspect-square w-full overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 dark:focus-visible:ring-paper-100 dark:focus-visible:ring-offset-umber-900 ${R} ${EDGE}`}
      >
        <WishlistPicture item={item} className="h-full w-full" />
      </button>
      <div className="mt-2.5 flex items-start gap-1.5">
        <button
          type="button"
          onClick={onEdit}
          aria-label={t("common.edit")}
          className={`min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 dark:focus-visible:ring-paper-100 ${R}`}
        >
          <span className="line-clamp-2 block font-grotesk text-[0.95rem] font-semibold leading-snug tracking-[-0.01em] text-ink-900 dark:text-paper-50">
            {item.title}
          </span>
        </button>
        <span className="-mt-0.5 shrink-0">
          <ItemMenu
            t={t}
            onDelete={onDelete}
            index={index}
            totalCount={totalCount}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
          />
        </span>
      </div>
      {item.description && (
        <p className="mt-1 line-clamp-1 text-[0.8125rem] text-ink-500 dark:text-umber-300">
          {item.description}
        </p>
      )}
    </li>
  );
}

/** Section head: the section's name at reading size with its count beside it,
 *  the explanation behind an "i", and the section's own controls on the right.
 *  No collapse chevron — a page with one section per phase has nothing to
 *  collapse away from. */
function SectionHead({
  title,
  count,
  hint,
  actions,
}: {
  title: string;
  count?: number;
  hint?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex items-center gap-2">
        <h2 className="m-0 font-grotesk text-xl font-bold tracking-[-0.02em] text-ink-900 dark:text-paper-50">
          {title}
        </h2>
        {count !== undefined && count > 0 && (
          <span className="text-xl font-bold tabular-nums tracking-[-0.02em] text-ink-300 dark:text-umber-600">
            {count}
          </span>
        )}
        {hint && <InfoHint text={hint} />}
      </div>
      {actions && <div className="flex items-center gap-1.5">{actions}</div>}
    </div>
  );
}

/** Rows breathe more than columns: with no card around a tile, a title needs
 *  air under it before the next row's picture starts, or the two read as one
 *  block. Requests run denser than gifts on purpose — a request is a line of
 *  text, and at gift size two of them filled a screen and claimed to be the
 *  more important half of the page. */
const GIFT_GRID =
  "grid grid-cols-2 gap-x-3 gap-y-6 sm:gap-x-4 sm:gap-y-8 lg:grid-cols-3 xl:grid-cols-4";
const REQUEST_GRID =
  "grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 sm:gap-x-4 sm:gap-y-6 lg:grid-cols-4 xl:grid-cols-6";

/** The last cell of every grid: add another one, in the shape of the thing it
 *  adds. It replaces the section header's add button, so the page carries one
 *  add affordance per list instead of two, and it lands where the eye already
 *  is after scanning the row. */
function AddTile({
  label,
  square = false,
  onClick,
}: {
  label: string;
  /** Match the request grid's 1:1 cells rather than a gift's 4:3. */
  square?: boolean;
  onClick: () => void;
}) {
  return (
    // A filled grey field with a solid black disc, not a dashed outline: a
    // dashed border is the drop-zone idiom, and this is a button. It also puts
    // the one black mark on the page exactly where the next action is.
    <li className="flex flex-col">
      <button
        type="button"
        onClick={onClick}
        className={`group/add flex w-full flex-col items-center justify-center gap-2 bg-paper-200 text-ink-700 transition-colors hover:bg-paper-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 dark:bg-umber-800 dark:text-paper-100 dark:hover:bg-umber-700 dark:focus-visible:ring-paper-100 dark:focus-visible:ring-offset-umber-900 ${R} ${
          square ? "aspect-square" : "aspect-[4/3]"
        }`}
      >
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink-900 text-paper-50 transition-transform duration-200 group-hover/add:scale-105 dark:bg-paper-100 dark:text-umber-900">
          <Plus size={18} strokeWidth={2} aria-hidden />
        </span>
        <span className="font-grotesk text-sm font-semibold tracking-[-0.01em]">{label}</span>
      </button>
    </li>
  );
}

/** Empty section: the prompt, then the same add tile the filled grid ends
 *  with, so "how do I add one" has exactly one answer on this page. */
function EmptySection({
  body,
  ctaLabel,
  square = false,
  onCta,
  children,
}: {
  body: string;
  ctaLabel: string;
  square?: boolean;
  onCta: () => void;
  children?: ReactNode;
}) {
  return (
    <div>
      <p className="mb-4 max-w-md text-[0.9375rem] text-ink-500 dark:text-umber-300">{body}</p>
      {/* Same grid as the filled section, so the tile the couple clicks is the
          size the thing they are about to add will be. */}
      <ul className={square ? REQUEST_GRID : GIFT_GRID}>
        <AddTile label={ctaLabel} square={square} onClick={onCta} />
      </ul>
      {children}
    </div>
  );
}

// ── Received-gifts grid ──────────────────────────────────────────────────────

/** One editable grid row. `id` is null until the row gains content and is
 *  persisted; `savedSig` is the signature of the last-persisted state so a
 *  blur with no change skips the network. */
interface RGRow {
  key: string;
  id: number | null;
  /** Attribution: a household OR a guest, never both (mutually exclusive, same
   *  as the server contract). */
  household_id: number | null;
  guest_id: number | null;
  title: string;
  note: string;
  category: ReceivedGiftCategory;
  amount_minor: number | null;
  updated_at: number | null;
  savedSig: string;
}

/** Signature of a row's persistable content (trimmed): drives change
 *  detection + the non-empty check. */
function rgSig(
  householdId: number | null,
  guestId: number | null,
  title: string,
  note: string,
  category: ReceivedGiftCategory,
  amountMinor: number | null,
): string {
  return JSON.stringify([householdId, guestId, title.trim(), note.trim(), category, amountMinor]);
}
function rgNonEmpty(r: RGRow): boolean {
  return (
    r.household_id !== null || r.guest_id !== null || r.title.trim() !== "" || r.note.trim() !== ""
  );
}

/** Encode/decode the attribution as the <select> value: "h:<id>" for a
 *  household, "g:<id>" for a guest, "" for unassigned. */
function rgSelectValue(r: RGRow): string {
  if (r.household_id !== null) return `h:${r.household_id}`;
  if (r.guest_id !== null) return `g:${r.guest_id}`;
  return "";
}
function rgParseSelectValue(v: string): { household_id: number | null; guest_id: number | null } {
  if (v.startsWith("h:")) return { household_id: Number(v.slice(2)), guest_id: null };
  if (v.startsWith("g:")) return { household_id: null, guest_id: Number(v.slice(2)) };
  return { household_id: null, guest_id: null };
}

/** Type-ahead combobox for the "From" column. Shows a text input that
 *  filters the household → guest tree on keystroke; the dropdown renders
 *  households as non-indented category headers and their members indented
 *  below. Selecting commits via the natural input blur; `onMouseDown` +
 *  `preventDefault()` on list buttons ensures the input never loses focus
 *  mid-selection, so blur only fires when the user truly leaves the field. */
function FromCombobox({
  value,
  allocationGroups,
  onChange,
  onBlur,
  ariaLabel,
  placeholder,
  cellInput,
}: {
  value: string;
  allocationGroups: {
    h: { id: number; label: string };
    members: { id: number; full_name: string }[];
  }[];
  onChange: (val: string) => void;
  onBlur: () => void;
  ariaLabel: string;
  placeholder: string;
  cellInput: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  function getLabel(val: string): string {
    if (!val) return "";
    if (val.startsWith("h:")) {
      const id = Number(val.slice(2));
      return allocationGroups.find(({ h }) => h.id === id)?.h.label ?? "";
    }
    if (val.startsWith("g:")) {
      const id = Number(val.slice(2));
      for (const { members } of allocationGroups) {
        const m = members.find((mem) => mem.id === id);
        if (m) return m.full_name;
      }
    }
    return "";
  }

  const q = query.toLowerCase();
  const filtered = allocationGroups
    .map(({ h, members }) => {
      if (q === "") return { h, members };
      const hMatch = h.label.toLowerCase().includes(q);
      const matched = hMatch
        ? members
        : members.filter((m) => m.full_name.toLowerCase().includes(q));
      return { h, members: matched };
    })
    .filter(({ members }) => members.length > 0);

  function select(val: string) {
    onChange(val);
    setOpen(false);
    setQuery("");
    // Commit fires on the natural input blur when focus moves away.
  }

  return (
    <div ref={wrapperRef} className="relative min-w-0 flex-1">
      <input
        type="text"
        autoComplete="off"
        className={`${cellInput} w-full cursor-pointer font-grotesk ${
          !value ? "text-ink-400 dark:text-umber-400" : ""
        }`}
        placeholder={placeholder}
        value={open ? query : getLabel(value)}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          setQuery("");
          onBlur();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
          }
          if (e.key === "Enter" && filtered.length > 0) {
            const first = filtered[0];
            const firstMember = first?.members[0];
            if (firstMember) select(`g:${firstMember.id}`);
          }
        }}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
      />
      {open && (
        <div
          role="listbox"
          className={`absolute left-0 top-full z-50 mt-0.5 max-h-56 w-max min-w-full overflow-y-auto border border-paper-200 bg-paper-50 shadow-pop dark:border-umber-700 dark:bg-umber-800 ${R}`}
        >
          {/* Unassign option */}
          <button
            type="button"
            role="option"
            aria-selected={value === ""}
            onMouseDown={(e) => {
              e.preventDefault();
              select("");
            }}
            className="block w-full px-3 py-1.5 text-left text-sm text-ink-400 hover:bg-paper-100 dark:text-umber-500 dark:hover:bg-umber-700"
          >
            —
          </button>
          {filtered.map(({ h, members }) => (
            <div key={h.id}>
              {/* Household — selectable; styled as a compact category label */}
              <button
                type="button"
                role="option"
                aria-selected={value === `h:${h.id}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(`h:${h.id}`);
                }}
                className={`block w-full px-3 py-1 text-left text-[11px] font-semibold uppercase tracking-wide hover:bg-paper-100 dark:hover:bg-umber-700 ${
                  value === `h:${h.id}`
                    ? "text-ink-800 dark:text-paper-50"
                    : "text-ink-500 dark:text-umber-400"
                }`}
              >
                {h.label}
              </button>
              {/* Members — indented under their household */}
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={value === `g:${m.id}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(`g:${m.id}`);
                  }}
                  className={`block w-full py-1.5 pl-7 pr-3 text-left text-sm hover:bg-paper-100 dark:hover:bg-umber-700 ${
                    value === `g:${m.id}`
                      ? "font-medium text-ink-900 dark:text-paper-50"
                      : "text-ink-700 dark:text-paper-100"
                  }`}
                >
                  {m.full_name}
                </button>
              ))}
            </div>
          ))}
          {q !== "" && filtered.length === 0 && (
            <div className="px-3 py-2 text-sm text-ink-400 dark:text-umber-500">
              {ariaLabel} not found
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The couple's private "what we received" ledger as an auto-growing grid:
 *  always at least 5 rows and always 2 trailing empties, so there's room to
 *  keep typing. Each row persists on blur (create / update / delete) with the
 *  same optimistic-concurrency contract as the wishlist. */
// One glyph per category, all four the same geometric family. `Sparkles` used
// to stand for an experience: three twinkles is decoration, not a category, and
// it was the only icon on the page that didn't describe an object. A ticket is
// the thing an experience actually arrives as.
const CATEGORY_ICONS: Record<ReceivedGiftCategory, typeof Gift> = {
  gift: Gift,
  money: Banknote,
  experience: Ticket,
  voucher: Tag,
};

function ReceivedGiftsTable({
  initialItems,
  guests,
  households,
  couple,
  locale,
  t,
}: {
  initialItems: ReceivedGift[];
  guests: Guest[];
  households: Household[];
  couple: Couple;
  locale: Locale;
  t: Translate;
}) {
  const toast = useToast();
  const keySeq = useRef(0);
  const nextKey = () => `rg-${keySeq.current++}`;

  // The attribution picker: each non-couple household, its non-supplier members
  // nested underneath. Couple households (the hosts) and supplier guests are
  // excluded (they don't give the couple gifts). Empty households drop out.
  const eligibleGuests = guests.filter((g) => !g.is_supplier);
  const allocationGroups = households
    .filter((h) => !h.is_couple_household)
    .map((h) => ({ h, members: eligibleGuests.filter((g) => g.household_id === h.id) }))
    .filter((grp) => grp.members.length > 0)
    .sort((a, b) => a.h.label.localeCompare(b.h.label));

  const makeEmpty = (): RGRow => ({
    key: nextKey(),
    id: null,
    household_id: null,
    guest_id: null,
    title: "",
    note: "",
    category: "gift",
    amount_minor: null,
    updated_at: null,
    savedSig: rgSig(null, null, "", "", "gift", null),
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
    const targetEmpties = Math.max(1, 2 - filled.length);
    const empties = rows.slice(lastFilled + 1).slice(0, targetEmpties);
    while (empties.length < targetEmpties) empties.push(makeEmpty());
    return [...filled, ...empties];
  }

  const [rows, setRows] = useState<RGRow[]>(() =>
    withTail(
      initialItems.map((it) => ({
        key: `rg-init-${it.id}`,
        id: it.id,
        household_id: it.household_id,
        guest_id: it.guest_id,
        title: it.title,
        note: it.note ?? "",
        category: it.category,
        amount_minor: it.amount_minor,
        updated_at: it.updated_at,
        savedSig: rgSig(
          it.household_id,
          it.guest_id,
          it.title,
          it.note ?? "",
          it.category,
          it.amount_minor,
        ),
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
    const sig = rgSig(r.household_id, r.guest_id, r.title, r.note, r.category, r.amount_minor);
    if (sig === r.savedSig) {
      setRows((prev) => withTail(prev));
      return;
    }
    // Always send both attribution fields (one null) so the server's
    // mutual-exclusivity resolver swaps cleanly between household and guest.
    const body = {
      household_id: r.household_id,
      guest_id: r.guest_id,
      title: r.title.trim(),
      note: r.note.trim() || null,
      category: r.category,
      amount_minor: r.category === "money" ? r.amount_minor : null,
    };
    try {
      if (r.id === null) {
        if (!rgNonEmpty(r)) return; // empty draft, nothing to do
        const res = await receivedGiftApi.create(body);
        patchRow(key, { id: res.item.id, updated_at: res.item.updated_at, savedSig: sig });
        setRows((prev) => withTail(prev));
      } else if (!rgNonEmpty(r)) {
        await receivedGiftApi.remove(r.id);
        patchRow(key, {
          id: null,
          updated_at: null,
          savedSig: rgSig(null, null, "", "", "gift", null),
        });
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
    "w-full bg-transparent py-2.5 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none dark:text-paper-50 dark:placeholder:text-umber-400";
  // Flat, hairlined, one radius, no shadow: an Uber form row is a bordered
  // rectangle that darkens its border on focus, not a floating bubble.
  const rowBubble = `flex items-center gap-3 border border-paper-200 bg-paper-50 px-4 transition-colors focus-within:border-ink-900 dark:border-umber-700 dark:bg-ink-800 dark:focus-within:border-paper-100 ${R}`;
  const colHead =
    "font-grotesk text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-ink-400 dark:text-umber-400";

  const cur = couple.currency;

  // Standalone bubble rows: each band is its own rounded card, gaps between
  // them, no enclosing table - kept uniform with the budget page's ledger.
  return (
    <div>
      <div className={`mb-1.5 flex items-center gap-3 px-4 ${colHead}`}>
        <span className="min-w-0 flex-1">{t("wishlist_editor.received_col_guest")}</span>
        <span className="min-w-0 flex-1">{t("wishlist_editor.received_col_gift")}</span>
        <span className="w-32 shrink-0">{t("wishlist_editor.received_col_category")}</span>
        <span className="min-w-0 flex-1">{t("wishlist_editor.received_col_note")}</span>
        <span className="w-8 shrink-0" aria-hidden />
      </div>

      <div className="space-y-2">
        {rows.map((r) => {
          const CatIcon = CATEGORY_ICONS[r.category];
          return (
            <div key={r.key} className={rowBubble}>
              <FromCombobox
                value={rgSelectValue(r)}
                allocationGroups={allocationGroups}
                onChange={(val) => patchRow(r.key, rgParseSelectValue(val))}
                onBlur={() => void commit(r.key)}
                ariaLabel={t("wishlist_editor.received_col_guest")}
                placeholder={t("wishlist_editor.received_guest_none")}
                cellInput={cellInput}
              />
              <input
                type="text"
                autoComplete="off"
                className={`${cellInput} min-w-0 flex-1 font-grotesk`}
                placeholder={t("wishlist_editor.received_gift_placeholder")}
                value={r.title}
                maxLength={RECEIVED_GIFT_MAX_TITLE_LEN}
                onChange={(e) => patchRow(r.key, { title: e.target.value })}
                onBlur={() => void commit(r.key)}
              />
              {/* Category picker with icon */}
              <div className="flex w-32 shrink-0 items-center gap-1.5">
                <CatIcon
                  size={16}
                  strokeWidth={ICON_STROKE}
                  className="shrink-0 text-ink-400 dark:text-umber-400"
                  aria-hidden
                />
                <select
                  className={`${cellInput} cursor-pointer`}
                  value={r.category}
                  onChange={(e) => {
                    const cat = e.target.value as ReceivedGiftCategory;
                    patchRow(r.key, {
                      category: cat,
                      amount_minor: cat !== "money" ? null : r.amount_minor,
                    });
                  }}
                  onBlur={() => void commit(r.key)}
                  aria-label={t("wishlist_editor.received_col_category")}
                >
                  {RECEIVED_GIFT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`wishlist_editor.received_cat_${c}`)}
                    </option>
                  ))}
                </select>
              </div>
              {r.category === "money" && (
                <div className="w-36 shrink-0">
                  <div className="flex items-center gap-1">
                    <Banknote
                      size={16}
                      strokeWidth={ICON_STROKE}
                      className="shrink-0 text-ink-400 dark:text-umber-400"
                      aria-hidden
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      className={`${cellInput} w-full tabular-nums`}
                      value={
                        r.amount_minor !== null
                          ? formatNumber(minorToWhole(r.amount_minor, cur), locale)
                          : ""
                      }
                      placeholder={currencySymbol(cur)}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, "");
                        if (digits === "") {
                          patchRow(r.key, { amount_minor: null });
                        } else {
                          const whole = Number(digits);
                          if (!Number.isNaN(whole) && whole >= 0) {
                            patchRow(r.key, {
                              amount_minor: Math.round(whole * minorUnitFactor(cur)),
                            });
                          }
                        }
                      }}
                      onBlur={() => void commit(r.key)}
                      aria-label={t("wishlist_editor.received_col_amount")}
                    />
                    <span className="shrink-0 text-xs text-ink-400 dark:text-umber-400">{cur}</span>
                  </div>
                </div>
              )}
              <input
                type="text"
                autoComplete="off"
                className={`${cellInput} min-w-0 flex-1 font-grotesk`}
                placeholder={t("wishlist_editor.received_note_placeholder")}
                value={r.note}
                maxLength={RECEIVED_GIFT_MAX_NOTE_LEN}
                onChange={(e) => patchRow(r.key, { note: e.target.value })}
                onBlur={() => void commit(r.key)}
              />
              <div className="flex w-8 shrink-0 justify-center">
                {r.id !== null && (
                  <button
                    type="button"
                    aria-label={t("common.remove")}
                    title={t("common.remove")}
                    onClick={() => void removeRow(r)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-blush-700 transition-colors hover:bg-blush-100 dark:text-blush-300 dark:hover:bg-blush-400/15"
                  >
                    <Trash2 size={16} strokeWidth={ICON_STROKE} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
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
  const [phase, setPhase] = useState<WishlistPhase>(() => {
    try {
      return localStorage.getItem(PHASE_STORAGE_KEY) === "after" ? "after" : "before";
    } catch {
      return "before";
    }
  });
  const [view, setView] = useState<WishlistView>(() =>
    typeof localStorage !== "undefined" && localStorage.getItem(VIEW_STORAGE_KEY) === "list"
      ? "list"
      : "cards",
  );

  function changePhase(next: WishlistPhase) {
    setPhase(next);
    try {
      localStorage.setItem(PHASE_STORAGE_KEY, next);
    } catch {
      // Private-mode / disabled storage — the in-memory state still switches.
    }
  }

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
  // Guest + household lists (for the received-gifts allocation dropdown) + the
  // received gifts themselves. Fetched alongside the wishlist on load.
  const [guests, setGuests] = useState<Guest[]>([]);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [received, setReceived] = useState<ReceivedGift[]>([]);

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
      const [cR, wR, gR, hR, rR] = await Promise.all([
        coupleApi.current(),
        wishlistApi.list(),
        guestApi.list(),
        householdApi.list(),
        receivedGiftApi.list(),
      ]);
      setCouple(cR.couple);
      setItems(wR.items);
      setGuests(gR.guests);
      setHouseholds(hR.households);
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

  /** Swap `sort_order` between two adjacent items. Optimistic: update local
   *  state immediately, then PATCH both rows. On any error reload the full
   *  list so we're back in sync with the server. */
  async function handleMoveItem(id: number, direction: "up" | "down") {
    const sorted = [...items].sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.id - b.id;
    });
    const idx = sorted.findIndex((i) => i.id === id);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    const item = sorted[idx];
    const swapItem = sorted[swapIdx];
    if (!item || !swapItem) return;

    // Swap sort_order values.
    const newOrder = item.sort_order;
    const swapOrder = swapItem.sort_order;

    // Optimistic update.
    setItems((prev) =>
      prev.map((i) => {
        if (i.id === item.id) return { ...i, sort_order: swapOrder };
        if (i.id === swapItem.id) return { ...i, sort_order: newOrder };
        return i;
      }),
    );

    try {
      await Promise.all([
        wishlistApi.update(item.id, { sort_order: swapOrder }, { ifMatch: item.updated_at }),
        wishlistApi.update(swapItem.id, { sort_order: newOrder }, { ifMatch: swapItem.updated_at }),
      ]);
    } catch {
      // On conflict or network error, reload the authoritative list.
      await refresh();
    }
  }

  const sortedItems = [...items].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.id - b.id;
  });
  const gifts = sortedItems.filter((i) => i.kind === "gift");
  const requests = sortedItems.filter((i) => i.kind === "request");

  // Header meta: what the list adds up to. Items priced in another currency are
  // left out of the sum rather than converted — we have no rate, and a wrong
  // total is worse than a partial one.
  const giftTotalWhole = gifts.reduce(
    (sum, i) =>
      (i.currency ?? currency) === currency && i.target_amount_minor !== null
        ? sum + minorToWhole(i.target_amount_minor, currency)
        : sum,
    0,
  );
  const receivedMoneyWhole = received.reduce(
    (sum, r) => (r.amount_minor !== null ? sum + minorToWhole(r.amount_minor, currency) : sum),
    0,
  );

  const metaBits: string[] =
    phase === "before"
      ? [
          gifts.length > 0 ? t("wishlist_editor.count_gifts", { count: gifts.length }) : "",
          requests.length > 0
            ? t("wishlist_editor.count_requests", { count: requests.length })
            : "",
          giftTotalWhole > 0 ? formatMoney(giftTotalWhole, currency, locale) : "",
        ].filter(Boolean)
      : [
          received.length > 0
            ? t("wishlist_editor.count_received", { count: received.length })
            : "",
          receivedMoneyWhole > 0 ? formatMoney(receivedMoneyWhole, currency, locale) : "",
        ].filter(Boolean);

  return (
    <>
      <header className="mb-7">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <span className="flex items-start gap-1">
              <h1 className="font-grotesk font-bold tracking-[-0.03em]">
                {t("wishlist_editor.title")}
              </h1>
              <InfoHint text={t("wishlist_editor.subtitle")} className="mt-1.5" />
            </span>
            {metaBits.length > 0 && (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[0.9375rem] tabular-nums text-ink-500 dark:text-umber-300">
                {metaBits.map((bit, i) => (
                  // Index in the key: the bits are a fixed, ordered set and
                  // two of them can legitimately render the same text.
                  <span key={`${i}-${bit}`} className="flex items-center gap-2">
                    {i > 0 && (
                      <span className="text-ink-300 dark:text-umber-600" aria-hidden>
                        ·
                      </span>
                    )}
                    {bit}
                  </span>
                ))}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* No icons in the tabs. A gift box beside "Esküvő előtt" and a
                parcel beside "Esküvő után" restate the words they sit next to,
                and two glyphs is what turns a tab bar into a toolbar. */}
            <SegmentedControl<WishlistPhase>
              ariaLabel={t("wishlist_editor.title")}
              value={phase}
              onChange={changePhase}
              size="sm"
              shape="pill"
              options={[
                { value: "before", label: t("wishlist_editor.phase_before") },
                { value: "after", label: t("wishlist_editor.phase_after") },
              ]}
            />
            {couple && phase === "before" && (
              // Published or not is one bit, so it is one control: a pill that
              // is filled when the list is on the guest page and outlined when
              // it is not. A label plus a switch inside a pill was three
              // things saying the same thing.
              //
              // The glyph is an eye, open or shut. A globe said "the internet",
              // which is not the state being toggled: the list goes to the
              // couple's confirmed guests, and what changes is whether they can
              // see it.
              <button
                type="button"
                onClick={() => void togglePublish()}
                disabled={publishing}
                aria-pressed={couple.wishlist_published}
                title={
                  couple.wishlist_published
                    ? t("wishlist_editor.publish_on")
                    : t("wishlist_editor.publish_off")
                }
                className={`inline-flex min-h-[34px] items-center gap-2 rounded-full px-4 text-sm font-semibold tracking-[-0.01em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 disabled:opacity-60 dark:focus-visible:ring-paper-100 dark:focus-visible:ring-offset-umber-900 ${
                  couple.wishlist_published
                    ? "bg-ink-900 text-paper-50 hover:bg-ink-800 dark:bg-paper-100 dark:text-umber-900 dark:hover:bg-paper-200"
                    : "border border-paper-300 bg-paper-50 text-ink-600 hover:border-ink-900 hover:text-ink-900 dark:border-umber-700 dark:bg-umber-800 dark:text-umber-200 dark:hover:border-paper-100 dark:hover:text-paper-50"
                }`}
              >
                {couple.wishlist_published ? (
                  <Eye size={16} strokeWidth={ICON_STROKE} aria-hidden />
                ) : (
                  <EyeOff size={16} strokeWidth={ICON_STROKE} aria-hidden />
                )}
                {t("wishlist_editor.publish_short")}
              </button>
            )}
          </div>
        </div>
      </header>

      {loading ? (
        <WishlistSkeleton />
      ) : (
        <div className="space-y-9">
          {phase === "before" && (
            <>
              {/* ── Gifts ───────────────────────────────────────────────── */}
              <section>
                <SectionHead
                  title={t("wishlist_editor.section_gifts_title")}
                  count={gifts.length}
                  actions={
                    gifts.length > 0 ? (
                      // Single toggle: shows the icon of the *other* layout
                      // and flips to it on click.
                      <button
                        type="button"
                        aria-label={
                          view === "list"
                            ? t("wishlist_editor.view_cards")
                            : t("wishlist_editor.view_list")
                        }
                        title={
                          view === "list"
                            ? t("wishlist_editor.view_cards")
                            : t("wishlist_editor.view_list")
                        }
                        onClick={() => changeView(view === "list" ? "cards" : "list")}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-100 hover:text-ink-900 dark:text-umber-300 dark:hover:bg-umber-800 dark:hover:text-paper-50"
                      >
                        {view === "list" ? (
                          <LayoutGrid size={18} strokeWidth={ICON_STROKE} />
                        ) : (
                          <List size={18} strokeWidth={ICON_STROKE} />
                        )}
                      </button>
                    ) : undefined
                  }
                />
                {gifts.length === 0 ? (
                  <EmptySection
                    body={t("wishlist_editor.gifts_empty")}
                    ctaLabel={t("wishlist_editor.add_gift")}
                    onCta={() => setEditing({ item: null, presetKind: "gift" })}
                  />
                ) : view === "cards" ? (
                  // Rows breathe more than columns: with no card around a
                  // tile, a title needs air under it before the next row's
                  // picture starts, or the two read as one block.
                  <ul className={GIFT_GRID}>
                    {gifts.map((item, idx) => (
                      <GiftTile
                        key={item.id}
                        item={item}
                        currency={currency}
                        locale={locale}
                        t={t}
                        onEdit={() => setEditing({ item })}
                        onDelete={() => void onDelete(item)}
                        index={idx}
                        totalCount={gifts.length}
                        onMoveUp={() => void handleMoveItem(item.id, "up")}
                        onMoveDown={() => void handleMoveItem(item.id, "down")}
                      />
                    ))}
                    <AddTile
                      label={t("wishlist_editor.add_gift")}
                      onClick={() => setEditing({ item: null, presetKind: "gift" })}
                    />
                  </ul>
                ) : (
                  <>
                    <ul className="divide-y divide-paper-200 dark:divide-umber-800">
                      {gifts.map((item, idx) => (
                        <WishlistRow
                          key={item.id}
                          item={item}
                          currency={currency}
                          locale={locale}
                          t={t}
                          onEdit={() => setEditing({ item })}
                          onDelete={() => void onDelete(item)}
                          index={idx}
                          totalCount={gifts.length}
                          onMoveUp={() => void handleMoveItem(item.id, "up")}
                          onMoveDown={() => void handleMoveItem(item.id, "down")}
                        />
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={() => setEditing({ item: null, presetKind: "gift" })}
                      className={`mt-3 inline-flex min-h-[38px] items-center gap-2 bg-ink-900 px-4 font-grotesk text-sm font-semibold tracking-[-0.01em] text-paper-50 transition-colors hover:bg-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 dark:bg-paper-100 dark:text-umber-900 dark:hover:bg-paper-200 dark:focus-visible:ring-paper-100 dark:focus-visible:ring-offset-umber-900 ${R}`}
                    >
                      <Plus size={16} strokeWidth={2} aria-hidden />
                      {t("wishlist_editor.add_gift")}
                    </button>
                  </>
                )}
              </section>

              {/* ── Requests (personal, no money) ───────────────────────── */}
              <section>
                <SectionHead
                  title={t("wishlist_editor.section_requests_title")}
                  count={requests.length}
                  hint={t("wishlist_editor.section_requests_subtitle")}
                />
                {requests.length === 0 ? (
                  <EmptySection
                    body={t("wishlist_editor.requests_empty")}
                    ctaLabel={t("wishlist_editor.add_request")}
                    square
                    onCta={() => setEditing({ item: null, presetKind: "request" })}
                  />
                ) : (
                  // Denser than the gift grid on purpose: a request is a line
                  // of text, and at gift size two of them filled a screen and
                  // claimed to be the more important half of the page.
                  <ul className={REQUEST_GRID}>
                    {requests.map((item, idx) => (
                      <RequestTile
                        key={item.id}
                        item={item}
                        t={t}
                        onEdit={() => setEditing({ item })}
                        onDelete={() => void onDelete(item)}
                        index={idx}
                        totalCount={requests.length}
                        onMoveUp={() => void handleMoveItem(item.id, "up")}
                        onMoveDown={() => void handleMoveItem(item.id, "down")}
                      />
                    ))}
                    <AddTile
                      label={t("wishlist_editor.add_request")}
                      square
                      onClick={() => setEditing({ item: null, presetKind: "request" })}
                    />
                  </ul>
                )}
              </section>
            </>
          )}

          {phase === "after" && (
            /* ── Received gifts (private ledger, never published) ───────── */
            <section>
              <SectionHead
                title={t("wishlist_editor.section_received_title")}
                count={received.length}
                hint={t("wishlist_editor.section_received_subtitle")}
                actions={
                  <span className="inline-flex items-center gap-1.5 text-[0.8125rem] text-ink-500 dark:text-umber-300">
                    <Lock size={14} strokeWidth={ICON_STROKE} aria-hidden />
                    {t("wishlist_editor.received_private_badge")}
                  </span>
                }
              />
              {couple && (
                <ReceivedGiftsTable
                  initialItems={received}
                  guests={guests}
                  households={households}
                  couple={couple}
                  locale={locale}
                  t={t}
                />
              )}
            </section>
          )}
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

/** Loading state shaped like the card grid it becomes, so the page doesn't
 *  reflow when the data lands. */
function WishlistSkeleton() {
  return (
    <ul className={GIFT_GRID} aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <li key={i}>
          <Skeleton variant="block" className="aspect-[4/3] w-full" rounded="lg" />
          <div className="mt-2.5 space-y-2">
            <Skeleton variant="block" height={14} width="72%" rounded="md" />
            <Skeleton variant="block" height={11} width="40%" rounded="md" />
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
  const [submitting, setSubmitting] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "found" | "miss">(
    existing?.image_url ? "found" : "idle",
  );
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(
    existing?.image_url ?? null,
  );
  // Photo vs the shop's logo — the preview tile frames them differently, and the
  // answer rides back to the server on save so the card matches what the couple
  // approved here.
  const [previewImageKind, setPreviewImageKind] = useState<WishlistImageKind | null>(
    existing?.image_kind ?? null,
  );
  // The couple's own mark for a wish we found no picture for. Null = the
  // kind's default, which is what the tile draws until they pick.
  const [icon, setIcon] = useState<WishlistIconSlug | null>(existing?.icon ?? null);
  const lastFetchedUrlRef = useRef<string>(existing?.image_url ? (existing.url ?? "") : "");
  const fetchGenRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether the couple has typed a title themselves. A resolved link title only
  // fills an untouched field, so we never overwrite what they wrote.
  const titleTouchedRef = useRef<boolean>(Boolean(existing?.title));

  function handleUrlChange(newUrl: string) {
    setUrl(newUrl);
    if (newUrl.trim() !== lastFetchedUrlRef.current) {
      setPreviewStatus("idle");
      setPreviewImageUrl(null);
      setPreviewImageKind(null);
    }
    // Paste-and-go: a pasted product link resolves without the couple having to
    // leave the field. Debounced so typing a URL by hand doesn't fire per key.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = newUrl.trim();
    if (/^https?:\/\/\S+\.\S+/i.test(trimmed)) {
      debounceRef.current = setTimeout(() => void fetchUrlPreview(trimmed), 600);
    }
  }

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  async function fetchUrlPreview(rawUrl: string) {
    const trimmed = rawUrl.trim();
    if (!trimmed || trimmed === lastFetchedUrlRef.current) return;
    lastFetchedUrlRef.current = trimmed;
    const gen = ++fetchGenRef.current;
    setPreviewStatus("loading");
    setPreviewImageUrl(null);
    setPreviewImageKind(null);
    try {
      const r = await wishlistApi.linkPreview(trimmed);
      if (gen !== fetchGenRef.current) return;
      // The page's own title is a better first draft than an empty field.
      if (r.title && !titleTouchedRef.current) {
        setTitle(draftTitleFromPage(r.title).slice(0, WISHLIST_MAX_TITLE_LEN));
      }
      if (r.image_url) {
        setPreviewImageUrl(r.image_url);
        setPreviewImageKind(r.image_kind);
        setPreviewStatus("found");
      } else {
        setPreviewStatus("miss");
      }
    } catch {
      if (gen === fetchGenRef.current) setPreviewStatus("miss");
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
        targetMinor = Math.round(parsed * minorUnitFactor(itemCurrency));
      }
    }

    const body: UpsertWishlistItemInput = {
      title: trimmedTitle.slice(0, WISHLIST_MAX_TITLE_LEN),
      kind,
      description: description.trim() ? description.trim().slice(0, WISHLIST_MAX_DESC_LEN) : null,
      target_amount_minor: targetMinor,
      currency: !isGift || itemCurrency === currency ? null : itemCurrency,
      url: isGift && url.trim() ? url.trim() : null,
      icon,
    };
    // Hand back the picture the couple is looking at. The preview endpoint has
    // already re-hosted it under our own /uploads key, so this saves the exact
    // image shown in the dialog and spares the server a second download. Sent
    // only when we HAVE one: omitting the field is what asks the server to
    // resolve the link itself, which is also the recovery path for a preview
    // that failed the first time.
    if (isGift && previewStatus === "found" && previewImageUrl) {
      body.image_url = previewImageUrl;
      body.image_kind = previewImageKind;
    }

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

  // Exactly what the item will look like on the guest page — the same
  // component the card uses, fed the values currently in the form. That is what
  // makes the icon strip below it a preview rather than a promise.
  const previewSubject = {
    title: title.trim(),
    kind,
    image_url: previewStatus === "found" ? previewImageUrl : null,
    image_kind: previewImageKind,
    icon,
  };
  // The strip only appears when there is no picture to override. A couple whose
  // link resolved is not choosing an icon, and offering one would ask them to
  // decide between their product photo and a glyph.
  const showIconPicker = !(previewStatus === "found" && previewImageUrl);

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        className={`flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden bg-paper-50 shadow-pop dark:bg-umber-800 ${R}`}
        onSubmit={onSubmit}
      >
        <div className="flex items-center justify-between border-b border-paper-200 px-6 py-4 dark:border-umber-700">
          <h2 className="font-grotesk text-lg font-bold tracking-[-0.02em] text-ink-900 dark:text-paper-50">
            {existing ? t("common.edit") : t("wishlist_editor.add_item")}
          </h2>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={onClose}
            aria-label={t("common.cancel")}
          >
            <X size={18} strokeWidth={ICON_STROKE} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Picture + title, side by side: the tile updates live as a link
              resolves or as an icon is picked below. */}
          <div className="mb-4 flex items-start gap-3.5">
            <span
              className={`relative block h-20 w-20 shrink-0 overflow-hidden border border-paper-300 bg-paper-100 dark:border-umber-700 dark:bg-umber-850 ${R}`}
            >
              <WishlistPicture item={previewSubject} className="h-full w-full" />
              {previewStatus === "loading" && (
                <span className="absolute inset-0 flex items-center justify-center bg-paper-50/70 dark:bg-umber-900/70">
                  <Loader2
                    size={16}
                    strokeWidth={ICON_STROKE}
                    className="animate-spin text-ink-500 dark:text-umber-200"
                  />
                </span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <label className="field-label" htmlFor="wishlist-title">
                {t("wishlist_editor.title_label")}
              </label>
              <input
                id="wishlist-title"
                className={`input font-grotesk ${titleError ? "input-invalid" : ""}`}
                type="text"
                value={title}
                maxLength={WISHLIST_MAX_TITLE_LEN}
                placeholder={t("wishlist_editor.title_placeholder")}
                onChange={(e) => {
                  titleTouchedRef.current = true;
                  setTitle(e.target.value);
                  if (titleError) setTitleError(null);
                }}
                aria-invalid={titleError ? true : undefined}
                autoFocus
              />
              {titleError ? <p className="field-error">{titleError}</p> : null}
            </div>
          </div>

          {/* Icon strip. Glyphs only, no labels and no heading beyond the
              field-label: eighteen names would be a wall of text for a choice
              the eye makes instantly, and every one is a concrete object whose
              tooltip carries the word for anyone who needs it. Tapping the
              active icon clears back to the kind's default, which is the only
              way out of a choice made by accident. */}
          {showIconPicker && (
            <div className="mb-4">
              <label className="field-label">{t("wishlist_editor.icon_label")}</label>
              <div className="flex flex-wrap gap-1.5">
                {WISHLIST_ICON_CHOICES.map(({ slug, Icon }) => {
                  const active = (icon ?? defaultWishlistIcon(kind)) === slug;
                  const name = t(`wishlist_editor.icon_choice.${slug}`);
                  return (
                    <button
                      key={slug}
                      type="button"
                      onClick={() => setIcon(active ? null : slug)}
                      aria-pressed={active}
                      aria-label={name}
                      title={name}
                      className={`flex h-9 w-9 items-center justify-center border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 dark:focus-visible:ring-paper-100 ${R} ${
                        active
                          ? "border-ink-900 bg-ink-900 text-paper-50 dark:border-paper-100 dark:bg-paper-100 dark:text-umber-900"
                          : "border-paper-300 bg-white text-ink-600 hover:border-ink-900 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-paper-100"
                      }`}
                    >
                      <Icon className="h-[18px] w-[18px]" strokeWidth={ICON_STROKE} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <FormRow label={t("wishlist_editor.kind_label")}>
            {/* Segmented control rather than a native <select> so each type
                carries its icon: a gift box against a plain heart. HandHeart
                (a hand cupping a heart) was six strokes inside 16px and went to
                mush on the filled active state, which is where it spends half
                its life. It read as a scribble, not a gesture. */}
            <div className="grid grid-cols-2 gap-2">
              {WISHLIST_KINDS.map((k) => {
                const Icon = k === "request" ? Heart : Gift;
                const active = kind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    aria-pressed={active}
                    className={`flex items-center justify-center gap-2 border px-3 py-2.5 text-sm font-semibold tracking-[-0.01em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 dark:focus-visible:ring-paper-100 ${R} ${
                      active
                        ? "border-ink-900 bg-ink-900 text-paper-50 dark:border-paper-100 dark:bg-paper-100 dark:text-umber-900"
                        : "border-paper-300 bg-white text-ink-700 hover:border-ink-900 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-paper-100"
                    }`}
                  >
                    <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden />
                    {t(`wishlist_editor.kind_${k}`)}
                  </button>
                );
              })}
            </div>
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
            <>
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
              <div className="mb-3">
                <label className="field-label" htmlFor="wishlist-url">
                  {t("wishlist_editor.url_label")}
                </label>
                <input
                  id="wishlist-url"
                  className="input font-grotesk"
                  type="url"
                  value={url}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  onBlur={() => void fetchUrlPreview(url)}
                  placeholder={t("wishlist_editor.url_placeholder")}
                  autoComplete="off"
                />
                <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">
                  {previewStatus === "miss"
                    ? t("wishlist_editor.url_preview_miss")
                    : t("wishlist_editor.url_hint")}
                </p>
              </div>
            </>
          )}
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
