// Shared presentational body for the couple's public wedding site. Rendered in
// two places, pixel-identical, so the couple's preview matches what guests see:
//
//   - Live mode  (WeddingWebsitePage at /w/:slug[/:code]): tier-aware
//     progressive disclosure. Gated fields are already omitted server-side, so
//     the rendering here is presentational (null check + render).
//   - Preview mode (GuestPageEditorPage at /app/guest-page): `isPreview` turns
//     empty sections into dashed "ghost" placeholders that scroll-and-focus the
//     matching editor field via the `edit` callbacks, and the post-RSVP block is
//     shown as a labelled "unlocks after RSVP" preview regardless of tier.
//
// The component renders the section stack only (cover through footer); the
// caller owns the page chrome (Shell + language toggle on the live page, the
// app shell on the editor) and the `max-w-3xl` container width.

import {
  Calendar,
  Camera,
  ExternalLink,
  Gift,
  Heart,
  HeartHandshake,
  Info,
  Lock,
  MapPin,
  Plus,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import { Link } from "react-router-dom";
import { formatDate, formatMoney, isPlausibleDateIso, localeCurrency } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";
import { WeddingCountdown } from "./WeddingCountdown";
import { Wordmark } from "./Wordmark";
import type {
  PublicWeddingHouseholdContext,
  PublicWeddingTier,
  PublicWeddingWebsiteView,
} from "@shared/wedding_website";

/** Click-to-edit shortcuts for the editor preview. Each jumps to (scrolls +
 *  focuses) the matching field in the editor below. All optional — passing
 *  none renders the read-only live page. */
export interface WeddingSiteEditHandlers {
  onEditCover?: () => void;
  onEditDate?: () => void;
  onEditVenue?: () => void;
  onEditIntro?: () => void;
  onEditSchedule?: () => void;
  onEditUsefulInfo?: () => void;
  onEditPostRsvp?: () => void;
}

export interface WeddingSiteViewProps {
  view: PublicWeddingWebsiteView;
  household: PublicWeddingHouseholdContext | null;
  tier: PublicWeddingTier;
  locale: Locale;
  /** Live page only — the URL carried a household code (drives the personal
   *  RSVP CTA copy + the wishlist soft-interest toggle). */
  hasCode?: boolean;
  /** Live page only — href the RSVP CTA points at (pre-fills slug + code). */
  rsvpHref?: string;
  /** Live page only — soft "I'd like to help" toggle on a group-gift item. */
  onToggleWishlistInterest?: (itemId: number) => void;
  /** Live page only — ref to the confirmed-tier heading so the page can shift
   *  focus there after an in-page RSVP reveals the block. */
  confirmedHeadingRef?: Ref<HTMLHeadingElement>;
  /** Editor preview — render ghosts + click-to-edit on empty sections, and
   *  surface the post-RSVP block as a labelled locked preview. */
  isPreview?: boolean;
  /** Editor preview — the per-section jump-to-field shortcuts. */
  edit?: WeddingSiteEditHandlers;
  /** Weddly wordmark footer. Defaults to on for the live page, off in the
   *  editor preview (the app shell already brands the surface). */
  showFooter?: boolean;
}

function formatTimeOfDay(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Keyboard + click affordance bundle for a section that doubles as an
 *  edit shortcut in the preview. Empty object when no handler (live page). */
function editAffordance(handler: (() => void) | undefined, hint: string) {
  if (!handler) return {};
  return {
    role: "button" as const,
    tabIndex: 0,
    title: hint,
    onClick: handler,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handler();
      }
    },
  };
}

/** Dashed "add this" placeholder shown in the editor preview where a section is
 *  still empty. Clickable when `onAdd` is given — jumps to the editor field. */
function Ghost({
  icon: Icon,
  title,
  cta,
  onAdd,
  hint,
}: {
  icon: LucideIcon;
  title: string;
  cta: string;
  onAdd?: () => void;
  hint: string;
}) {
  const clickable = Boolean(onAdd);
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border border-dashed border-paper-300 bg-paper-50 p-5 dark:border-umber-700 dark:bg-umber-800/40${
        clickable
          ? " cursor-pointer transition hover:border-ink-300 hover:bg-paper-100 dark:hover:border-umber-600 dark:hover:bg-umber-800"
          : ""
      }`}
      {...editAffordance(onAdd, hint)}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-paper-300 bg-white/60 text-ink-300 dark:border-umber-700 dark:bg-umber-900/40 dark:text-umber-400"
        aria-hidden
      >
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-400 dark:text-umber-300">{title}</p>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-500 dark:text-umber-200">
          <Plus size={12} aria-hidden />
          {cta}
        </p>
      </div>
    </div>
  );
}

/** A `card` section that doubles as an edit shortcut in preview mode (whole
 *  card is clickable + a hover affordance). On the live page it's a plain card. */
function CardSection({
  children,
  onEdit,
  hint,
  className = "",
  ...rest
}: {
  children: ReactNode;
  onEdit?: () => void;
  hint: string;
  className?: string;
} & Record<string, unknown>) {
  const editable = Boolean(onEdit);
  return (
    <section
      className={`card mt-6${
        editable
          ? " cursor-pointer transition hover:border-ink-300 dark:hover:border-umber-600"
          : ""
      }${className ? ` ${className}` : ""}`}
      {...editAffordance(onEdit, hint)}
      {...rest}
    >
      {children}
    </section>
  );
}

export function WeddingSiteView({
  view,
  household,
  tier,
  locale,
  hasCode = false,
  rsvpHref,
  onToggleWishlistInterest,
  confirmedHeadingRef,
  isPreview = false,
  edit,
  showFooter,
}: WeddingSiteViewProps) {
  const { t } = useT();
  const e = edit ?? {};
  const editHint = t("wedding_site.edit_hint");
  const footer = showFooter ?? !isPreview;

  // Tier gates on the live page; in preview we author everything, so the
  // post-RSVP block is shown as a labelled locked preview regardless of tier.
  const showInvitedExtras = tier === "invited" || tier === "confirmed";
  const showConfirmedExtras = tier === "confirmed";

  const dateLine = isPlausibleDateIso(view.wedding_date)
    ? formatDate(view.wedding_date, locale)
    : t("wedding_site.date_tbd");

  return (
    <>
      {/* Cover — 16:9 hero image, or a dashed ghost in the editor preview. */}
      {view.cover_image_url ? (
        <div className="mb-6 overflow-hidden rounded-3xl border border-paper-200 dark:border-umber-700">
          <img
            src={view.cover_image_url}
            alt=""
            loading="lazy"
            className="aspect-[16/9] w-full object-cover"
          />
        </div>
      ) : isPreview ? (
        <div
          className={`mb-6 flex aspect-[16/6] min-h-[140px] w-full flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-paper-300 bg-paper-50 text-center dark:border-umber-700 dark:bg-umber-800/40${
            e.onEditCover
              ? " cursor-pointer transition hover:border-ink-300 hover:bg-paper-100 dark:hover:border-umber-600 dark:hover:bg-umber-800"
              : ""
          }`}
          {...editAffordance(e.onEditCover, editHint)}
        >
          <Camera size={28} className="text-ink-300 dark:text-umber-400" aria-hidden />
          <p className="text-sm font-medium text-ink-400 dark:text-umber-300">
            {t("wedding_site.ghost.cover_title")}
          </p>
          <p className="flex items-center gap-1 text-xs text-ink-500 dark:text-umber-200">
            <Plus size={12} aria-hidden />
            {t("wedding_site.ghost.cover_cta")}
          </p>
        </div>
      ) : null}

      {/* Hero — names + date (+ venue). Stationery aesthetic mirroring the
          landing page so the public site reads as part of the same brand. */}
      <section className="card stationery text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-blush-700 dark:text-blush-300">
          {t("wedding_site.eyebrow")}
        </p>
        <h1 className="mt-3 font-grotesk text-4xl leading-[1.05] text-ink-900 dark:text-paper-50 sm:text-5xl">
          {view.couple_display_name}
        </h1>

        {/* Date — real line on the live page; in preview an empty/placeholder
            date becomes a ghost button that jumps to the dashboard. */}
        {isPreview && !isPlausibleDateIso(view.wedding_date) ? (
          <button
            type="button"
            onClick={e.onEditDate}
            disabled={!e.onEditDate}
            title={editHint}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-dashed border-paper-300 bg-paper-50 px-3 py-1.5 text-sm text-ink-400 transition hover:border-ink-300 hover:bg-paper-100 disabled:cursor-default dark:border-umber-700 dark:bg-umber-800/40 dark:text-umber-300 dark:hover:border-umber-600"
          >
            <Calendar size={14} aria-hidden />
            {t("wedding_site.ghost.date_cta")}
            <Plus size={12} aria-hidden />
          </button>
        ) : (
          <p className="mt-4 inline-flex items-center justify-center gap-2 font-grotesk text-base italic text-ink-700 dark:text-paper-100 sm:text-lg">
            <Calendar size={16} aria-hidden /> {dateLine}
          </p>
        )}

        {/* Venue — name when set; an approximate marker on the live public
            page; a ghost button in the editor preview when still empty. */}
        {view.venue_name ? (
          <p className="mt-2 inline-flex items-center justify-center gap-2 text-sm text-ink-700 dark:text-paper-100">
            <MapPin size={14} aria-hidden />
            {view.venue_name}
          </p>
        ) : isPreview ? (
          <div>
            <button
              type="button"
              onClick={e.onEditVenue}
              disabled={!e.onEditVenue}
              title={editHint}
              className="mt-2 inline-flex items-center gap-2 rounded-lg border border-dashed border-paper-300 bg-paper-50 px-3 py-1.5 text-sm text-ink-400 transition hover:border-ink-300 hover:bg-paper-100 disabled:cursor-default dark:border-umber-700 dark:bg-umber-800/40 dark:text-umber-300 dark:hover:border-umber-600"
            >
              <MapPin size={14} aria-hidden />
              {t("wedding_site.ghost.venue_cta")}
              <Plus size={12} aria-hidden />
            </button>
          </div>
        ) : (
          !showConfirmedExtras &&
          view.location_radius_km !== null && (
            <p className="mt-2 inline-flex items-center justify-center gap-2 text-xs text-ink-500 dark:text-umber-300">
              <MapPin size={14} aria-hidden />
              {t("wedding_site.venue_approx")}
            </p>
          )
        )}
      </section>

      {/* Pre-RSVP welcome block — same at every tier. */}
      {view.guest_page_intro ? (
        <CardSection onEdit={isPreview ? e.onEditIntro : undefined} hint={editHint}>
          <p className="whitespace-pre-line text-base text-ink-800 dark:text-paper-100">
            {view.guest_page_intro}
          </p>
        </CardSection>
      ) : isPreview ? (
        <div className="mt-6">
          <Ghost
            icon={Heart}
            title={t("wedding_site.ghost.welcome_title")}
            cta={t("wedding_site.ghost.welcome_cta")}
            onAdd={e.onEditIntro}
            hint={editHint}
          />
        </div>
      ) : null}

      {/* Invited tier — personal hello + member list (live page only). */}
      {!isPreview && showInvitedExtras && household && (
        <section className="card mt-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blush-700 dark:text-blush-300">
            {t("wedding_site.invited_eyebrow")}
          </p>
          <h2 className="mt-1 font-grotesk text-2xl text-ink-900 dark:text-paper-50">
            {household.household_label}
          </h2>
          {household.members.length > 0 && (
            <ul className="mt-4 space-y-1 text-sm text-ink-700 dark:text-paper-100">
              {household.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3">
                  <span>{m.full_name}</span>
                  <span className="text-xs text-ink-500 dark:text-umber-300">
                    {t(`wedding_site.rsvp_status_${m.rsvp_status}`)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Schedule — exposed at every tier. Ghost in preview when empty. */}
      {view.schedule.length > 0 ? (
        <CardSection onEdit={isPreview ? e.onEditSchedule : undefined} hint={editHint}>
          <h2 className="font-grotesk text-2xl text-ink-900 dark:text-paper-50">
            {t("wedding_site.schedule_title")}
          </h2>
          <ul className="mt-4 space-y-3">
            {view.schedule.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-paper-300 pb-3 last:border-0 last:pb-0 dark:border-umber-700"
              >
                <span className="font-grotesk text-base tabular-nums text-ink-900 dark:text-paper-50">
                  {formatTimeOfDay(entry.starts_at_minutes)}
                </span>
                <span className="font-grotesk text-base text-ink-700 dark:text-paper-100">
                  {entry.label}
                </span>
                {entry.location && (
                  <span className="text-xs text-ink-500 dark:text-umber-300">
                    · {entry.location}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </CardSection>
      ) : isPreview ? (
        <div className="mt-6">
          <Ghost
            icon={Calendar}
            title={t("wedding_site.ghost.schedule_title")}
            cta={t("wedding_site.ghost.schedule_cta")}
            onAdd={e.onEditSchedule}
            hint={editHint}
          />
        </div>
      ) : null}

      {/* "Good to know" — parking, getting there, accommodation, … */}
      {view.useful_info ? (
        <CardSection onEdit={isPreview ? e.onEditUsefulInfo : undefined} hint={editHint}>
          <h2 className="font-grotesk text-2xl text-ink-900 dark:text-paper-50">
            {t("guest_portal.useful_info_title")}
          </h2>
          <p className="mt-3 whitespace-pre-line text-base text-ink-800 dark:text-paper-100">
            {view.useful_info}
          </p>
        </CardSection>
      ) : isPreview ? (
        <div className="mt-6">
          <Ghost
            icon={Info}
            title={t("wedding_site.ghost.useful_info_title")}
            cta={t("wedding_site.ghost.useful_info_cta")}
            onAdd={e.onEditUsefulInfo}
            hint={editHint}
          />
        </div>
      ) : null}

      {/* Confirmed-tier unlocked block. Live: shown only at confirmed tier.
          Preview: always shown as a labelled "unlocks after RSVP" block so the
          couple can preview + jump to edit the post-RSVP content. */}
      {(isPreview ||
        (showConfirmedExtras && (view.post_rsvp_content || view.location_lat !== null))) && (
        <section className="card mt-6" aria-live={isPreview ? undefined : "polite"}>
          {isPreview && (
            <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-blush-700 dark:text-blush-300">
              <Lock size={12} aria-hidden /> {t("wedding_site.ghost.locked_eyebrow")}
            </p>
          )}
          <h2
            ref={confirmedHeadingRef}
            tabIndex={isPreview ? undefined : -1}
            className="font-grotesk text-2xl text-ink-900 outline-none dark:text-paper-50"
          >
            {t("wedding_site.confirmed_title")}
          </h2>
          {view.post_rsvp_content ? (
            <p className="mt-3 whitespace-pre-line text-base text-ink-800 dark:text-paper-100">
              {view.post_rsvp_content}
            </p>
          ) : isPreview ? (
            <div className="mt-3">
              <Ghost
                icon={Sparkles}
                title={t("wedding_site.ghost.post_rsvp_title")}
                cta={t("wedding_site.ghost.post_rsvp_cta")}
                onAdd={e.onEditPostRsvp}
                hint={editHint}
              />
            </div>
          ) : null}
          {view.location_lat !== null && view.location_lng !== null && (
            <p className="mt-4 inline-flex items-center gap-2 text-sm text-ink-700 dark:text-paper-100">
              <MapPin size={14} aria-hidden />
              <a
                className="underline"
                href={`https://www.openstreetmap.org/?mlat=${view.location_lat}&mlon=${view.location_lng}#map=17/${view.location_lat}/${view.location_lng}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(ev) => ev.stopPropagation()}
              >
                {t("wedding_site.confirmed_open_map")}
              </a>
            </p>
          )}
        </section>
      )}

      {/* Wishlist deck — confirmed-tier live page only (server returns null
          otherwise, and the editor preview has no household context). */}
      {!isPreview && view.wishlist && view.wishlist.length > 0 && (
        <section className="card mt-6">
          <h2 className="flex items-center gap-2 font-grotesk text-2xl text-ink-900 dark:text-paper-50">
            <Gift size={20} aria-hidden /> {t("guest_portal.wishlist_section_title")}
          </h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {view.wishlist.map((entry) => (
              <li
                key={entry.id}
                className="flex gap-3 rounded-xl border border-paper-200 bg-paper-50 p-3 dark:border-umber-700 dark:bg-umber-900/40"
              >
                {entry.image_url && (
                  <img
                    src={entry.image_url}
                    alt=""
                    loading="lazy"
                    className="h-16 w-16 shrink-0 rounded-lg border border-paper-200 object-cover dark:border-umber-700"
                  />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="text-sm font-medium text-ink-900 dark:text-paper-50">
                    {entry.title}
                  </div>
                  {entry.description && (
                    <p className="text-xs text-ink-600 dark:text-umber-200">{entry.description}</p>
                  )}
                  {entry.target_amount_minor !== null && (
                    <p className="text-xs tabular-nums text-ink-500 dark:text-umber-300">
                      {t("guest_portal.wishlist_target_amount_prefix")}{" "}
                      {formatMoney(
                        entry.target_amount_minor / (localeCurrency(locale) === "HUF" ? 1 : 100),
                        localeCurrency(locale),
                        locale,
                      )}
                    </p>
                  )}
                  {entry.url && (
                    <a
                      href={entry.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex w-fit items-center gap-1 text-xs text-blush-700 underline-offset-2 hover:underline dark:text-blush-300"
                    >
                      <ExternalLink size={12} aria-hidden />
                      {t("guest_portal.wishlist_external_link_label")}
                    </a>
                  )}
                  {entry.kind === "group_gift" && (
                    <div className="mt-1 flex flex-col gap-2">
                      {entry.interest_count > 0 && (
                        <p className="text-xs text-ink-500 dark:text-umber-300">
                          {t("guest_portal.wishlist_interest_count", {
                            count: entry.interest_count,
                          })}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => onToggleWishlistInterest?.(entry.id)}
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
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* RSVP CTA — generic at the public tier, personal at invited. In preview
          it's representative (non-navigating), so the couple sees the button
          their guests get without leaving the editor. */}
      {(isPreview || !showConfirmedExtras) && (
        <section className="card stationery mt-6 text-center">
          <Heart size={28} className="mx-auto text-blush-600 dark:text-blush-300" />
          <h2 className="mt-3 font-grotesk text-2xl text-ink-900 dark:text-paper-50">
            {hasCode ? t("wedding_site.rsvp_personal_title") : t("wedding_site.rsvp_title")}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-600 dark:text-umber-200">
            {hasCode ? t("wedding_site.rsvp_personal_body") : t("wedding_site.rsvp_body")}
          </p>
          {isPreview ? (
            <span
              className="btn-primary btn-lifted mt-5 inline-flex cursor-default opacity-90"
              aria-hidden
            >
              {t("wedding_site.rsvp_cta")}
            </span>
          ) : (
            <Link to={rsvpHref ?? "/"} className="btn-primary btn-lifted mt-5 inline-flex">
              {hasCode ? t("wedding_site.rsvp_personal_cta") : t("wedding_site.rsvp_cta")}
            </Link>
          )}
        </section>
      )}

      {!isPreview && showConfirmedExtras && rsvpHref && (
        <section className="mt-6 text-center text-xs text-ink-500 dark:text-umber-300">
          <Lock size={12} aria-hidden className="mr-1 inline" />
          <Link to={rsvpHref} className="underline">
            {t("wedding_site.rsvp_manage_cta")}
          </Link>
        </section>
      )}

      {/* Live countdown to the wedding day at the bottom of the page. */}
      {(view.wedding_date || isPreview) && (
        <div className="mt-6">
          <WeddingCountdown
            date={view.wedding_date}
            isPreview={isPreview}
            onEdit={isPreview ? e.onEditDate : undefined}
          />
        </div>
      )}

      {/* Weddly branding — a centered wordmark over a hairline. Live page only. */}
      {footer && (
        <footer className="mt-12 flex flex-col items-center gap-2 border-t border-paper-300 pt-8 dark:border-umber-700">
          <Link
            to="/"
            className="text-ink-900 transition-colors hover:text-ink-700 dark:text-paper-50 dark:hover:text-blush-300"
          >
            <Wordmark size="md" />
          </Link>
          <p className="text-center text-[11px] text-ink-400 dark:text-umber-400">
            {t("wedding_site.footer_built_with")}
          </p>
        </footer>
      )}
    </>
  );
}
