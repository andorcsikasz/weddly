// Product pictures for the /suppliers pitch. Three small cards, one per block:
// the availability calendar (Manage), the couple's shortlist (Grow) and a quote
// with its payment schedule (Get booked).
//
// Built as HTML rather than SVG on purpose: every word on them is a real UI
// string that has to follow the locale, and month / weekday / money come from
// `Intl` in the reader's own format, not from a hand-written table.
//
// Same ground rules as `VendorListingMockup`:
//   - They are TEMPLATES of fields the real product has. No couple, no
//     business and no review count is named: an invented person on a public
//     page reads as a claim, and the vendor has to look past somebody else's
//     name to picture their own.
//   - The sample month is fixed and shows no year, so the picture cannot age.
//   - Decorative (`aria-hidden`): the bullets beside each one say the same
//     thing in text.

import { SUPPLIER_GROUPS } from "@shared/suppliers";
import { Check, Star } from "lucide-react";
import { intlLocale, formatMoney, localeCurrency } from "../lib/format";
import { useT } from "../lib/i18n";

/** The tinted ground every mockup sits on. Not a plate behind an icon: it is
 *  the "screenshot frame" the card floats over. */
export function PitchPlate({
  children,
  className = "",
}: { children: React.ReactNode; className?: string }) {
  return (
    <div
      aria-hidden
      className={`relative rounded-3xl bg-paper-100 p-5 sm:p-10 dark:bg-white/[0.06] ${className}`}
    >
      {children}
    </div>
  );
}

const CARD =
  "rounded-2xl border border-ink-900/10 bg-white shadow-soft dark:border-paper-50/10 dark:bg-black dark:shadow-none";

/** "A new inquiry just arrived": the dot, the date, the button the vendor would
 *  press. Shared by the calendar picture and the hero, since both say the same
 *  thing about the same object. Positioning is the caller's. */
function InquiryChip({ className = "" }: { className?: string }) {
  const { t, locale } = useT();
  const date = new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "long",
  }).format(new Date(2027, 5, 26));
  return (
    <div className={`${CARD} flex items-center justify-between gap-3 px-4 py-3 ${className}`}>
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-paper-50">
          <span className="h-2 w-2 shrink-0 rounded-full bg-blush-500" />
          {t("vendors.pitch_mock_new_inquiry")}
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-500 dark:text-umber-300">{date}</p>
      </div>
      <span className="shrink-0 rounded-full bg-blush-600 px-3 py-1 text-xs font-semibold text-white">
        {t("vendors.pitch_mock_reply")}
      </span>
    </div>
  );
}

/** The sample job, in the reader's currency. HUF for a Hungarian reader, EUR
 *  for the rest (`localeCurrency`), each set picked so the sample reads as a
 *  plausible size of job in that currency. Whole units, like money everywhere
 *  else in the app. */
const QUOTE_LINES = {
  EUR: [1800, 250, 150],
  HUF: [720000, 100000, 60000],
} as const;

function useSampleQuote() {
  const { locale } = useT();
  const currency = localeCurrency(locale);
  const amounts = QUOTE_LINES[currency === "HUF" ? "HUF" : "EUR"];
  const total = amounts.reduce((a, b) => a + b, 0);
  const money = (n: number) => formatMoney(n, currency, locale);
  return { amounts, total, money };
}

/** "The couple said yes": what the vendor sees when a quote is accepted. */
function AcceptedChip({ className = "" }: { className?: string }) {
  const { t } = useT();
  const { total, money } = useSampleQuote();
  return (
    <div className={`${CARD} px-4 py-3 ${className}`}>
      <div className="flex items-center justify-between gap-6">
        <p className="text-sm font-semibold text-ink-900 dark:text-paper-50">
          {t("vendors.pitch_mock_quote")}
        </p>
        <p className="text-sm font-semibold tabular-nums text-ink-900 dark:text-paper-50">
          {money(total)}
        </p>
      </div>
      <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-sage-700 dark:text-sage-300">
        <Check size={13} strokeWidth={2.5} aria-hidden />
        {t("vendors.pitch_mock_accepted")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero: a wedding, and the two things a vendor's day is made of.
// ---------------------------------------------------------------------------

/** The hero picture. A photograph of a ceremony with the product laid over it:
 *  the same two chips the blocks below use (an inquiry arriving, a quote being
 *  accepted). It replaced a listing-card mockup that only restated the Grow
 *  block, and carried the page's one invented number (a rating). This carries
 *  no rating, no count and no name: the photo is the wedding, the chips are the
 *  product. */
export function HeroCollage() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-md lg:max-w-none">
      <img
        src="/vendors-trades/hero.jpg"
        alt=""
        width={1000}
        height={667}
        decoding="async"
        className="aspect-[4/3] w-full rounded-3xl object-cover shadow-soft dark:shadow-none"
      />
      <InquiryChip className="absolute -bottom-5 left-3 w-64 sm:-left-6" />
      <AcceptedChip className="absolute -top-4 right-3 sm:-right-4" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manage: a month of dates, with the inquiry that just arrived.
// ---------------------------------------------------------------------------

// June 2027 starts on a Tuesday, so a Monday-first grid opens with one blank.
// 5 / 19 are Saturdays that are booked, 12 is the Saturday held for a couple.
const CAL_LEADING_BLANKS = 1;
const CAL_DAYS = 30;
const CAL_BOOKED = new Set([5, 19]);
const CAL_HELD = new Set([12]);

export function CalendarMockup() {
  const { t, locale } = useT();
  const loc = intlLocale(locale);
  const month = new Intl.DateTimeFormat(loc, { month: "long" }).format(new Date(2027, 5, 1));
  // 2027-06-07 is a Monday: seven consecutive days from it give Mon..Sun.
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(loc, { weekday: "narrow" }).format(new Date(2027, 5, 7 + i)),
  );

  return (
    <PitchPlate>
      <div className={`${CARD} mx-auto max-w-sm p-5`}>
        <div className="flex items-baseline justify-between">
          <p className="font-grotesk text-base font-semibold capitalize text-ink-900 dark:text-paper-50">
            {month}
          </p>
        </div>
        <div className="mt-4 grid grid-cols-7 gap-y-1.5 text-center text-[11px] text-ink-400 dark:text-umber-300">
          {weekdays.map((w, i) => (
            <span key={i} className="pb-1 font-medium uppercase">
              {w}
            </span>
          ))}
          {Array.from({ length: CAL_LEADING_BLANKS }, (_, i) => (
            <span key={`b${i}`} />
          ))}
          {Array.from({ length: CAL_DAYS }, (_, i) => {
            const day = i + 1;
            const booked = CAL_BOOKED.has(day);
            const held = CAL_HELD.has(day);
            return (
              <span
                key={day}
                className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs tabular-nums ${
                  booked
                    ? "bg-ink-900 font-semibold text-paper-50 dark:bg-paper-50 dark:text-black"
                    : held
                      ? "border border-dashed border-amber-500 font-semibold text-amber-700 dark:text-amber-300"
                      : "text-ink-700 dark:text-paper-200"
                }`}
              >
                {day}
              </span>
            );
          })}
        </div>
        <div className="mt-4 flex items-center gap-4 border-t border-ink-900/10 pt-3 text-[11px] text-ink-500 dark:border-paper-50/10 dark:text-umber-300">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-ink-900 dark:bg-paper-50" />
            {t("vendors.pitch_mock_booked")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border border-dashed border-amber-500" />
            {t("vendors.pitch_mock_held")}
          </span>
        </div>
      </div>

      {/* The lead that just came in. It hangs off the corner so the two read as
          two objects (a calendar, and the thing that lands on it), and stays
          inside the plate on a phone. */}
      <InquiryChip className="relative mx-auto mt-3 w-full max-w-[17rem] sm:absolute sm:-bottom-5 sm:-left-4 sm:mt-0 sm:mx-0 lg:-left-8" />
    </PitchPlate>
  );
}

// ---------------------------------------------------------------------------
// Grow: the short list a couple picks from, with the vendor on it.
// ---------------------------------------------------------------------------

const SHORTLIST_TILES = [
  { photo: "/vendors-trades/florist.jpg", own: false },
  { photo: "/vendors-trades/wedding_decor.jpg", own: true },
  { photo: "/vendors-trades/lighting.jpg", own: false },
] as const;

export function ShortlistMockup() {
  const { t } = useT();
  return (
    <PitchPlate>
      <div className={`${CARD} mx-auto max-w-md p-4 sm:p-5`}>
        <p className="font-grotesk text-base font-semibold text-ink-900 dark:text-paper-50">
          {t("suppliers.cat.wedding_decor")}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2.5 sm:gap-3">
          {SHORTLIST_TILES.map((tile) => (
            <div
              key={tile.photo}
              className={`overflow-hidden rounded-xl border bg-paper-50 dark:bg-black ${
                tile.own
                  ? "border-2 border-ink-900 dark:border-paper-50"
                  : "border-ink-900/10 dark:border-paper-50/10"
              }`}
            >
              <img
                src={tile.photo}
                alt=""
                loading="lazy"
                decoding="async"
                className="aspect-[4/5] w-full object-cover"
              />
              <div className="px-2 py-2">
                {tile.own ? (
                  <p className="truncate text-[11px] font-semibold text-ink-900 dark:text-paper-50">
                    {t("landing.mockup_vendor_name")}
                  </p>
                ) : (
                  <span className="block h-2 w-4/5 rounded-full bg-ink-900/10 dark:bg-paper-50/15" />
                )}
                <p className="mt-1 flex items-center gap-1 text-[10px] text-ink-500 dark:text-umber-300">
                  <Star size={10} className="fill-star text-star" aria-hidden />
                  {t("landing.mockup_vendor_rating")}
                  <span className="ml-auto font-semibold">{t("landing.mockup_vendor_price")}</span>
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </PitchPlate>
  );
}

// ---------------------------------------------------------------------------
// Get booked: a quote, and the money that follows it.
// ---------------------------------------------------------------------------

export function QuoteMockup() {
  const { t } = useT();
  const { amounts, total, money } = useSampleQuote();
  const labels = [
    t("vendors.pitch_mock_line_1"),
    t("vendors.pitch_mock_line_2"),
    t("vendors.pitch_mock_line_3"),
  ];

  return (
    <PitchPlate>
      <div className={`${CARD} mx-auto max-w-sm p-5`}>
        <div className="flex items-center justify-between gap-3">
          <p className="font-grotesk text-base font-semibold text-ink-900 dark:text-paper-50">
            {t("vendors.pitch_mock_quote")}
          </p>
          <span className="inline-flex items-center gap-1 rounded-full bg-sage-100 px-2.5 py-0.5 text-[11px] font-semibold text-sage-800 dark:bg-sage-400/15 dark:text-sage-300">
            <Check size={12} strokeWidth={2.5} aria-hidden />
            {t("vendors.pitch_mock_accepted")}
          </span>
        </div>
        <ul className="mt-4 space-y-2.5 text-sm">
          {labels.map((label, i) => (
            <li key={label} className="flex justify-between gap-4 text-ink-700 dark:text-paper-200">
              <span>{label}</span>
              <span className="tabular-nums">{money(amounts[i] ?? 0)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-between border-t border-ink-900/10 pt-3 font-semibold text-ink-900 dark:border-paper-50/10 dark:text-paper-50">
          <span>{t("vendors.pitch_mock_total")}</span>
          <span className="tabular-nums">{money(total)}</span>
        </div>
      </div>

      {/* The payment schedule the vendor keeps against the same client. */}
      <div className={`${CARD} mx-auto mt-3 max-w-sm space-y-2.5 px-5 py-4 text-sm`}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink-700 dark:text-paper-200">
            {t("vendors.pitch_mock_deposit")}
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-sage-700 dark:text-sage-300">
            <Check size={13} strokeWidth={2.5} aria-hidden />
            {t("vendors.pitch_mock_paid")}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink-700 dark:text-paper-200">
            {t("vendors.pitch_mock_balance")}
          </span>
          <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
            {t("vendors.pitch_mock_due")}
          </span>
        </div>
      </div>
    </PitchPlate>
  );
}

// ---------------------------------------------------------------------------
// Trades: which categories get a photo card, and which fall to a chip.
// ---------------------------------------------------------------------------

/** Trades with a photograph that is honestly of that trade. Each file is a
 *  720px copy under `public/vendors-trades/`; the rest of the taxonomy renders
 *  as chips rather than borrowing a picture that isn't theirs. */
export const TRADE_PHOTOS = [
  "venue",
  "catering",
  "cake_dessert",
  "florist",
  "wedding_decor",
  "lighting",
  "celebrant",
] as const;

/** Every category a vendor can register under that has no photo card. Off the
 *  taxonomy directly, so a new category needs no second list here; a planner
 *  category is left out because that door leads to /planners, not signup. */
export function tradesWithoutPhoto(blocked: (category: string) => boolean): string[] {
  const photographed = new Set<string>(TRADE_PHOTOS);
  return SUPPLIER_GROUPS.flatMap((g) => g.categories).filter(
    (c) => !photographed.has(c) && !blocked(c),
  );
}
