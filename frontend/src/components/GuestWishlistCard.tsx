// One read-only-ish wishlist card on the guest side, shared by the live wedding
// site (<WeddingSiteView>) and the guest portal deck (<GuestPortalView>). Shows
// the title, optional description, optional rough target amount, optional
// external link, and — for group gifts — a GoFundMe-style soft-pledge progress
// bar plus a two-step pledge flow.
//
// For gift items WITH a target_amount_minor: two-step pledge (warn then form).
// For gift items WITHOUT a target_amount_minor: simple single-tap toggle.
// For request items: no interaction.
//
// No money moves in-app: the pledged amount is a non-binding coordination
// figure the couple sees to gauge how the group gift is filling up.

import type { Currency } from "@shared/types";
import type { WishlistContributorsResult, WishlistEntry } from "@shared/wishlist";
import {
  Camera,
  ExternalLink,
  HandHeart,
  HeartHandshake,
  Loader2,
  Music2,
  PenLine,
  Users,
} from "lucide-react";
import { useState } from "react";
import { weddingWebsiteApi } from "../lib/endpoints";
import { currencySymbol, formatMoney, formatNumber } from "../lib/format";
import { useToast } from "./ui";

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

function formatAmount(minor: number, currency: Currency, locale: Locale): string {
  const factor = minorFactor(currency);
  return formatMoney(minor / factor, currency, locale);
}

// ---------------------------------------------------------------------------
// Progress bar + caption (used for gift items with a target)
// ---------------------------------------------------------------------------

function ProgressBlock({
  entry,
  currency,
  locale,
  t,
}: {
  entry: WishlistEntry;
  currency: Currency;
  locale: Locale;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const cur = entry.currency ?? currency;
  const factor = minorFactor(cur);
  const target = (entry.target_amount_minor ?? 0) / factor;
  const pledged = entry.pledged_amount_minor / factor;
  const pct = target > 0 ? Math.min(100, Math.round((pledged / target) * 100)) : 0;
  const captionBase = t("guest_portal.wishlist_pledged_progress", {
    pledged: formatMoney(pledged, cur, locale),
    target: formatMoney(target, cur, locale),
  });
  const caption = target > 0 && pledged > 0 ? `${captionBase} (${pct}%)` : captionBase;

  return (
    <div>
      <p className="text-[11px] tabular-nums text-ink-500 dark:text-umber-300">{caption}</p>
      <div
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700"
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contributor breakdown shown after a successful pledge
// ---------------------------------------------------------------------------

function ContributorBreakdown({
  result,
  currency,
  locale,
  t,
}: {
  result: WishlistContributorsResult | null;
  currency: Currency;
  locale: Locale;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  if (result === null) {
    return (
      <p className="text-xs text-ink-500 dark:text-umber-300">
        {t("guest_portal.wishlist_pledge_contributors_others")}
      </p>
    );
  }

  const cur = currency;

  if (result.remaining_minor !== null && result.remaining_minor <= 0) {
    return (
      <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
        {t("guest_portal.wishlist_pledge_contributors_funded")}
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-paper-200 bg-paper-50 p-2.5 dark:border-umber-700 dark:bg-umber-800/60">
      <ul className="space-y-1">
        {result.contributors.map((c, i) => (
          <li
            key={i}
            className="flex items-center justify-between gap-2 text-xs text-ink-700 dark:text-paper-100"
          >
            <span className="font-medium">{c.label}</span>
            <span className="tabular-nums text-ink-500 dark:text-umber-300">
              {c.pledged_amount_minor !== null
                ? formatAmount(c.pledged_amount_minor, cur, locale)
                : "-"}
              {c.pledged_pct !== null ? ` (${c.pledged_pct}%)` : ""}
            </span>
          </li>
        ))}
        {result.remaining_minor !== null && result.remaining_minor > 0 && (
          <li className="flex items-center justify-between gap-2 border-t border-paper-200 pt-1 text-xs text-ink-400 dark:border-umber-700 dark:text-umber-400">
            <span>{t("guest_portal.wishlist_pledge_contributors_remaining")}</span>
            <span className="tabular-nums">
              {formatAmount(result.remaining_minor, cur, locale)}
              {result.remaining_pct !== null ? ` (${result.remaining_pct}%)` : ""}
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main card component
// ---------------------------------------------------------------------------

export function GuestWishlistCard({
  entry,
  currency,
  locale,
  coupleSlug,
  householdCode,
  onToggleInterest,
  t,
}: {
  entry: WishlistEntry;
  /** Fallback currency when the item has no per-item override. */
  currency: Currency;
  locale: Locale;
  /** Required for fetching contributor breakdown after pledge. Empty string on preview. */
  coupleSlug: string;
  /** Required for fetching contributor breakdown after pledge. Empty string on preview. */
  householdCode: string;
  /** Pure toggle when called with just the id; sets the soft pledge when given
   *  an amount (minor units) or null. Absent → non-interactive (preview). */
  onToggleInterest?: (
    itemId: number,
    pledgedAmountMinor?: number | null,
    notificationEmail?: string,
  ) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const cur = entry.currency ?? currency;
  const factor = minorFactor(cur);
  const isGift = entry.kind === "gift";
  const interactive = !!onToggleInterest;
  const hasTarget = isGift && entry.target_amount_minor !== null && entry.target_amount_minor > 0;
  const hasBar = hasTarget;

  const toast = useToast();

  // --- State machine for the two-step pledge flow (gift + target only) ---
  // 'idle'       = not pledged, accordion closed
  // 'warned'     = step 1 warning shown
  // 'pledging'   = step 2 form shown
  // 'pledged'    = successfully pledged
  // 'unpledging' = pledged state, withdrawal accordion open
  type PledgeState = "idle" | "warned" | "pledging" | "pledged" | "unpledging";

  const initialState: PledgeState = entry.viewer_has_interest ? "pledged" : "idle";
  const [pledgeState, setPledgeState] = useState<PledgeState>(initialState);
  const [submitting, setSubmitting] = useState(false);
  const [contributors, setContributors] = useState<WishlistContributorsResult | null | "loading">(
    "loading",
  );

  // Amount input state (whole units as digit string)
  const remaining =
    hasTarget && entry.target_amount_minor !== null
      ? Math.max(0, entry.target_amount_minor - entry.pledged_amount_minor)
      : null;
  const remainingWhole = remaining !== null ? Math.round(remaining / factor) : null;

  const [amount, setAmount] = useState<string>(
    entry.viewer_pledged_amount_minor != null
      ? String(Math.round(entry.viewer_pledged_amount_minor / factor))
      : remainingWhole != null && remainingWhole > 0
        ? String(remainingWhole)
        : "",
  );
  const [email, setEmail] = useState<string>("");

  // For simple toggle (gift without target): local optimistic state
  const [simpleActive, setSimpleActive] = useState(entry.viewer_has_interest);
  const [simpleLoading, setSimpleLoading] = useState(false);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  function handlePledgeSubmit() {
    if (!onToggleInterest) return;
    setSubmitting(true);
    const digits = amount.replace(/\D/g, "");
    const amountMinor = digits === "" ? null : Math.round(Number(digits) * factor);
    const notifEmail = email.trim() === "" ? undefined : email.trim();
    // onToggleInterest is fire-and-forget (parent owns the server call + rollback).
    // We transition optimistically; if the parent rolls back its optimistic state
    // the entry will re-render from the top with viewer_has_interest: false.
    try {
      onToggleInterest(entry.id, amountMinor, notifEmail);
    } catch {
      toast.error(t("guest_portal.wishlist_pledge_error_generic"));
      setSubmitting(false);
      return;
    }
    setPledgeState("pledged");
    setSubmitting(false);
    // Fetch contributors after a short delay to allow the server write to settle.
    if (coupleSlug && householdCode) {
      setTimeout(() => {
        weddingWebsiteApi
          .getContributors(coupleSlug, householdCode, entry.id)
          .then((res) => setContributors(res))
          .catch(() => setContributors(null));
      }, 600);
    } else {
      setContributors(null);
    }
  }

  function handleWithdraw() {
    if (!onToggleInterest) return;
    onToggleInterest(entry.id);
    setPledgeState("idle");
    setAmount(remainingWhole != null && remainingWhole > 0 ? String(remainingWhole) : "");
    setEmail("");
    setContributors("loading");
  }

  function handleSimpleToggle() {
    if (!onToggleInterest) return;
    setSimpleLoading(true);
    const wasActive = simpleActive;
    setSimpleActive(!wasActive);
    try {
      onToggleInterest(entry.id);
    } catch {
      setSimpleActive(wasActive);
    }
    setSimpleLoading(false);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

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
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center text-ink-700 dark:text-paper-200"
              aria-hidden
            >
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

        {/* Progress bar — gift items with a target only */}
        {hasBar && <ProgressBlock entry={entry} currency={currency} locale={locale} t={t} />}

        {/* Interest count — aggregate only, no names */}
        {entry.interest_count > 0 && isGift && (
          <p className="text-xs text-ink-500 dark:text-umber-300">
            {t("guest_portal.wishlist_interest_count", { count: entry.interest_count })}
          </p>
        )}

        {/* === Gift with target: two-step pledge flow === */}
        {isGift && hasTarget && interactive && (
          <div className="mt-1 flex flex-col gap-2">
            {/* --- IDLE: initial "I'd like to contribute" button --- */}
            {pledgeState === "idle" && (
              <button
                type="button"
                onClick={() => setPledgeState("warned")}
                className="inline-flex w-fit items-center gap-1.5 rounded-full border border-paper-300 px-3 py-2.5 text-xs font-medium text-ink-700 transition hover:bg-paper-100 dark:border-umber-700 dark:text-paper-100 dark:hover:bg-umber-800"
                style={{ minHeight: 44 }}
              >
                <HeartHandshake size={13} aria-hidden />
                {t("guest_portal.wishlist_group_gift_help_cta")}
              </button>
            )}

            {/* --- WARNED: step 1 — show warning + confirm/cancel --- */}
            {pledgeState === "warned" && (
              <div className="flex flex-col gap-2">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300">
                  {t("guest_portal.wishlist_pledge_step1_warn")}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPledgeState("pledging")}
                    className="btn-primary btn-sm"
                    style={{ minHeight: 44 }}
                  >
                    {t("guest_portal.wishlist_pledge_step1_confirm")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPledgeState("idle")}
                    className="text-xs text-ink-500 underline-offset-2 hover:underline dark:text-umber-300"
                  >
                    {t("guest_portal.wishlist_pledge_step2_cancel")}
                  </button>
                </div>
              </div>
            )}

            {/* --- PLEDGING: step 2 — amount + email form --- */}
            {pledgeState === "pledging" && (
              <div className="flex flex-col gap-3 rounded-lg border border-paper-200 bg-white p-3 dark:border-umber-700 dark:bg-umber-800/60">
                {/* Amount input */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-ink-700 dark:text-paper-100">
                    {t("guest_portal.wishlist_pledge_step2_amount_label")}
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={amount === "" ? "" : formatNumber(Number(amount), locale)}
                        onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                        placeholder={remainingWhole != null ? String(remainingWhole) : ""}
                        className="w-24 rounded-lg border border-paper-300 bg-white py-1 pl-2.5 pr-8 text-xs tabular-nums text-ink-900 focus:border-ink-600 focus:outline-none dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50"
                      />
                      <span
                        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 select-none text-[11px] text-ink-400 dark:text-umber-300"
                        aria-hidden
                      >
                        {currencySymbol(cur, locale)}
                      </span>
                    </div>
                    {remainingWhole != null && remainingWhole > 0 && (
                      <button
                        type="button"
                        onClick={() => setAmount(String(remainingWhole))}
                        className="cursor-pointer text-xs text-ink-500 underline underline-offset-2 dark:text-umber-300"
                      >
                        {t("guest_portal.wishlist_pledge_step2_fill_remaining")} (
                        {formatMoney(remainingWhole, cur, locale)})
                      </button>
                    )}
                  </div>
                </div>

                {/* Email input */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-ink-700 dark:text-paper-100">
                    {t("guest_portal.wishlist_pledge_step2_email_label")}
                  </label>
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t("guest_portal.wishlist_pledge_step2_email_placeholder")}
                    className="w-full rounded-lg border border-paper-300 bg-white px-2.5 py-1.5 text-xs text-ink-900 focus:border-ink-600 focus:outline-none dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50"
                  />
                  <p className="text-[11px] text-ink-400 dark:text-umber-400">
                    {t("guest_portal.wishlist_pledge_step2_email_note")}
                  </p>
                </div>

                {/* Submit + cancel */}
                <button
                  type="button"
                  onClick={() => void handlePledgeSubmit()}
                  disabled={submitting}
                  className="btn-primary w-full"
                  style={{ minHeight: 44 }}
                >
                  {submitting ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 size={14} className="animate-spin" aria-hidden />
                      {t("guest_portal.wishlist_pledge_step2_submit")}
                    </span>
                  ) : (
                    t("guest_portal.wishlist_pledge_step2_submit")
                  )}
                </button>
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setPledgeState("idle")}
                    disabled={submitting}
                    className="text-xs text-ink-500 underline-offset-2 hover:underline dark:text-umber-300"
                  >
                    {t("guest_portal.wishlist_pledge_step2_cancel")}
                  </button>
                </div>
              </div>
            )}

            {/* --- PLEDGED: success state --- */}
            {pledgeState === "pledged" && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                    <HeartHandshake size={13} aria-hidden />
                    {t("guest_portal.wishlist_pledge_success")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPledgeState("unpledging")}
                    className="text-xs text-ink-500 underline-offset-2 hover:underline dark:text-umber-300"
                  >
                    {t("guest_portal.wishlist_pledge_withdraw")}
                  </button>
                </div>
                {contributors !== "loading" && (
                  <ContributorBreakdown
                    result={contributors}
                    currency={cur}
                    locale={locale}
                    t={t}
                  />
                )}
              </div>
            )}

            {/* --- UNPLEDGING: withdrawal confirmation --- */}
            {pledgeState === "unpledging" && (
              <div className="flex flex-col gap-2 rounded-lg border border-paper-200 bg-white p-3 dark:border-umber-700 dark:bg-umber-800/60">
                <p className="text-xs text-ink-600 dark:text-umber-200">
                  {t("guest_portal.wishlist_pledge_step1_warn")}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleWithdraw}
                    className="text-xs text-ink-500 underline-offset-2 hover:underline dark:text-umber-300"
                    style={{ minHeight: 44 }}
                  >
                    {t("guest_portal.wishlist_pledge_withdraw")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPledgeState("pledged")}
                    className="btn-primary btn-sm"
                    style={{ minHeight: 44 }}
                  >
                    {t("guest_portal.wishlist_pledge_step2_cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* === Gift WITHOUT target: simple toggle === */}
        {isGift && !hasTarget && interactive && (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => void handleSimpleToggle()}
              disabled={simpleLoading}
              aria-pressed={simpleActive}
              className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                simpleActive
                  ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                  : "border border-paper-300 text-ink-700 hover:bg-paper-100 dark:border-umber-700 dark:text-paper-100 dark:hover:bg-umber-800"
              }`}
              style={{ minHeight: 44 }}
            >
              {simpleLoading ? (
                <Loader2 size={13} className="animate-spin" aria-hidden />
              ) : (
                <HeartHandshake size={13} aria-hidden />
              )}
              {simpleActive
                ? t("guest_portal.wishlist_pledge_simple_active")
                : t("guest_portal.wishlist_pledge_simple_cta")}
            </button>
          </div>
        )}

        {/* === Preview (no interaction): show static CTA for gifts === */}
        {isGift && !interactive && (
          <div className="mt-1">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-paper-300 px-3 py-1 text-xs font-medium text-ink-700 opacity-90 dark:border-umber-700 dark:text-paper-100">
              <HeartHandshake size={13} aria-hidden />
              {t("guest_portal.wishlist_group_gift_help_cta")}
            </span>
          </div>
        )}
      </div>
    </li>
  );
}
