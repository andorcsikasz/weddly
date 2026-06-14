// One read-only-ish wishlist card on the guest side, shared by the live wedding
// site (<WeddingSiteView>) and the guest portal deck (<GuestPortalView>). Shows
// the title, optional description, optional rough target amount, optional
// external link, and — for group gifts — a GoFundMe-style soft-pledge progress
// bar plus an "I'd like to help" toggle and an optional pledge-amount input.
//
// No money moves in-app: the pledged amount is a non-binding coordination
// figure the couple sees to gauge how the group gift is filling up.

import type { Currency } from "@shared/types";
import type { WishlistEntry } from "@shared/wishlist";
import { Camera, ExternalLink, HandHeart, HeartHandshake, Music2, PenLine, Users } from "lucide-react";
import { useState } from "react";
import { currencySymbol, formatMoney, formatNumber } from "../lib/format";

function requestIconFor(title: string): typeof HandHeart {
  const s = title.toLowerCase();
  if (/photo|fot[oó]|k[eé]p|childhood|gyerek/.test(s)) return Camera;
  if (/letter|lev[eé]l|handwritten|k[eé]zzel|pen|ír/.test(s)) return PenLine;
  if (/song|dal|ének|music|zen[eé]|playlist/.test(s)) return Music2;
  if (/time|id[oő]|together|egy[uü]tt|spend|quality/.test(s)) return Users;
  return HandHeart;
}

type Locale = "hu" | "en";

/** HUF is whole-unit; EUR/USD are cents. Matches `target_amount_minor`. */
function minorFactor(currency: Currency): number {
  return currency === "HUF" ? 1 : 100;
}

export function GuestWishlistCard({
  entry,
  currency,
  locale,
  onToggleInterest,
  t,
}: {
  entry: WishlistEntry;
  /** Fallback currency when the item has no per-item override. */
  currency: Currency;
  locale: Locale;
  /** Pure toggle when called with just the id; sets the soft pledge when given
   *  an amount (minor units) or null. Absent → non-interactive (preview). */
  onToggleInterest?: (itemId: number, pledgedAmountMinor?: number | null) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const cur = entry.currency ?? currency;
  const factor = minorFactor(cur);
  const isGift = entry.kind === "gift";
  const interactive = !!onToggleInterest;
  const hasBar = isGift && entry.target_amount_minor !== null && entry.target_amount_minor > 0;

  // Soft pledge input (whole units, digit string), seeded from the viewer's own
  // pledge so they can see + edit it.
  const [amount, setAmount] = useState<string>(
    entry.viewer_pledged_amount_minor != null
      ? String(Math.round(entry.viewer_pledged_amount_minor / factor))
      : "",
  );

  function submitPledge() {
    if (!onToggleInterest) return;
    const digits = amount.replace(/\D/g, "");
    onToggleInterest(entry.id, digits === "" ? null : Math.round(Number(digits) * factor));
  }

  return (
    <li className="flex gap-3 rounded-xl border border-paper-200 bg-paper-50 p-3 dark:border-umber-700 dark:bg-umber-900/40">
      {entry.image_url ? (
        <img
          src={entry.image_url}
          alt=""
          loading="lazy"
          className="h-16 w-16 shrink-0 rounded-lg border border-paper-200 object-cover dark:border-umber-700"
        />
      ) : entry.kind === "request" ? (
        (() => {
          const Icon = requestIconFor(entry.title);
          return (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center text-ink-700 dark:text-paper-200" aria-hidden>
              <Icon size={22} />
            </span>
          );
        })()
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="text-sm font-medium text-ink-900 dark:text-paper-50">{entry.title}</div>
        {entry.description && (
          <p className="text-xs text-ink-600 dark:text-umber-200">{entry.description}</p>
        )}
        {entry.target_amount_minor !== null && (
          <p className="text-xs tabular-nums text-ink-500 dark:text-umber-300">
            {t("guest_portal.wishlist_target_amount_prefix")}{" "}
            {formatMoney(entry.target_amount_minor / factor, cur, locale)}
          </p>
        )}
        {entry.url && (
          <a
            href={entry.url}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex w-fit items-center gap-1 text-xs text-blush-700 underline-offset-2 hover:underline dark:text-blush-300"
          >
            <ExternalLink size={12} aria-hidden />
            {t("guest_portal.wishlist_external_link_label")}
          </a>
        )}
        {isGift && (
          <div className="mt-1 flex flex-col gap-2">
            {hasBar &&
              (() => {
                const target = (entry.target_amount_minor ?? 0) / factor;
                const pledged = entry.pledged_amount_minor / factor;
                const pct = target > 0 ? Math.min(100, Math.round((pledged / target) * 100)) : 0;
                return (
                  <div>
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
                    <p className="mt-1 text-[11px] tabular-nums text-ink-500 dark:text-umber-300">
                      {t("guest_portal.wishlist_pledged_progress", {
                        pledged: formatMoney(pledged, cur, locale),
                        target: formatMoney(target, cur, locale),
                      })}
                    </p>
                  </div>
                );
              })()}
            {entry.interest_count > 0 && (
              <p className="text-xs text-ink-500 dark:text-umber-300">
                {t("guest_portal.wishlist_interest_count", { count: entry.interest_count })}
              </p>
            )}
            {interactive ? (
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={amount === "" ? "" : formatNumber(Number(amount), locale)}
                    onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                    onBlur={() => {
                      if (entry.viewer_has_interest) submitPledge();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        submitPledge();
                      }
                    }}
                    aria-label={t("guest_portal.wishlist_pledge_aria")}
                    placeholder={t("guest_portal.wishlist_pledge_placeholder")}
                    className="w-24 rounded-lg border border-paper-300 bg-white py-1 pl-2.5 pr-8 text-xs tabular-nums text-ink-900 focus:border-ink-600 focus:outline-none dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50"
                  />
                  <span
                    className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 select-none text-[11px] text-ink-400 dark:text-umber-300"
                    aria-hidden
                  >
                    {currencySymbol(cur, locale)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    entry.viewer_has_interest ? onToggleInterest?.(entry.id) : submitPledge()
                  }
                  aria-pressed={entry.viewer_has_interest}
                  className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    entry.viewer_has_interest
                      ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                      : "border border-paper-300 text-ink-700 hover:bg-paper-100 dark:border-umber-700 dark:text-paper-100 dark:hover:bg-umber-800"
                  }`}
                >
                  <HeartHandshake size={13} aria-hidden />
                  {entry.viewer_has_interest
                    ? t("guest_portal.wishlist_group_gift_help_active")
                    : t("guest_portal.wishlist_group_gift_help_cta")}
                </button>
              </div>
            ) : (
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-paper-300 px-3 py-1 text-xs font-medium text-ink-700 opacity-90 dark:border-umber-700 dark:text-paper-100">
                <HeartHandshake size={13} aria-hidden />
                {t("guest_portal.wishlist_group_gift_help_cta")}
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
