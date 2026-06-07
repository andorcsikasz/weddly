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
  Lock,
  MapPin,
  Plus,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties, KeyboardEvent, ReactNode, Ref } from "react";
import { Link } from "react-router-dom";
import { buildMonogram, formatWeddingDate, type WebsiteSectionSlug } from "@shared/design";
import { formatDate, formatMoney, isPlausibleDateIso, localeCurrency } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";
import { GuestWishlistCard } from "./GuestWishlistCard";
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
  onToggleWishlistInterest?: (itemId: number, pledgedAmountMinor?: number | null) => void;
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
        <p className="font-grotesk text-base font-medium tracking-tight text-ink-400 dark:text-umber-300">
          {title}
        </p>
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
    ? formatWeddingDate(view.wedding_date, view.design.date_format, locale) ||
      formatDate(view.wedding_date, locale)
    : t("wedding_site.date_tbd");

  // The editorial hero sets the date BIG + letter-spaced as the page's
  // signature element (e.g. "2026 · 09 · 12"). Always numeric-spaced regardless
  // of the couple's text date_format, since the long month name doesn't carry
  // the same poster feel. Null when there's no plausible date yet.
  const heroDateBig = isPlausibleDateIso(view.wedding_date)
    ? formatWeddingDate(view.wedding_date, "numeric_dot", locale)
        .replace(/\.$/, "")
        .split(".")
        .join(" · ")
    : null;

  // Monogram (the couple's joined initials) + a decorative divider beneath the
  // names, both driven by the Design selection. Empty monogram (no names yet)
  // skips the block; "none" decor renders nothing.
  const monogram = view.design.monogram_enabled
    ? buildMonogram(view.bride_name, view.groom_name, view.design.monogram_separator, locale)
    : "";
  const decor = view.design.decor;

  // Website-only chrome from the Design feature's `web` sub-object.
  // Section hiding applies to the LIVE page only — the editor preview keeps
  // every section visible so the couple can still edit hidden ones.
  const hiddenSet = new Set(view.design.website_hidden_sections);
  const sectionHidden = (s: WebsiteSectionSlug) => !isPreview && hiddenSet.has(s);
  // RSVP CTA look: lifted (3D), flat (filled), or outline.
  const rsvpBtnClass =
    view.design.website_button_style === "outline"
      ? "btn-outline"
      : view.design.website_button_style === "flat"
        ? "btn-primary"
        : "btn-primary btn-lifted";

  // Visual identity from the couple's Design selection, fed in as CSS custom
  // properties on the `.wedding-theme` wrapper. index.css consumes these to
  // retarget the heading font + accent colour (unlayered, so it beats the
  // Tailwind utility classes still on the elements). No raw hex here — the
  // values are resolved data from the shared catalog.
  const themeStyle = {
    "--wt-primary": view.design.primary,
    "--wt-accent": view.design.accent,
    "--wt-accent-text": view.design.accent_text,
    "--wt-bg": view.design.background,
    "--wt-text": view.design.text,
    "--wt-heading-font": view.design.heading_font,
    "--wt-body-font": view.design.body_font,
    "--wt-card-radius": view.design.website_card_radius,
    "--wt-card-shadow": view.design.website_shadow,
  } as CSSProperties;

  return (
    <div className="wedding-theme" style={themeStyle}>
      {/* ── Editorial hero ─────────────────────────────────────────────────
          Names as a centered header, the wedding date set big + letter-spaced
          (the page's signature element) overlapping the cover photo below it,
          then the venue. All themed from the couple's Design; the editor
          preview keeps every ghost + click-to-edit affordance. */}
      <section className="stationery overflow-hidden rounded-3xl border border-paper-200 text-center dark:border-umber-700">
        <div className="px-6 pt-9 sm:px-10">
          {monogram && (
            <p
              className="wt-accent wt-heading mb-2 text-2xl tracking-[0.2em]"
              style={{ color: "var(--wt-accent-text)", fontFamily: "var(--wt-heading-font)" }}
              aria-hidden
            >
              {monogram}
            </p>
          )}
          <h1 className="font-grotesk text-2xl leading-tight tracking-tight text-ink-900 dark:text-paper-50 sm:text-3xl">
            {view.couple_display_name}
          </h1>

          {/* Decorative divider under the names, driven by the Design selection. */}
          {decor !== "none" && (
            <div className="mt-3 flex justify-center" aria-hidden>
              {decor === "line" && (
                <span className="h-px w-20" style={{ backgroundColor: "var(--wt-accent)" }} />
              )}
              {decor === "dots" && (
                <span className="text-lg tracking-[0.4em]" style={{ color: "var(--wt-accent)" }}>
                  · · ·
                </span>
              )}
              {decor === "frame" && (
                <span
                  className="h-5 w-20 rounded border"
                  style={{ borderColor: "var(--wt-accent)" }}
                />
              )}
              {decor === "botanical" && (
                <span className="text-xl" style={{ color: "var(--wt-accent)" }}>
                  {"❧︎"}
                </span>
              )}
            </div>
          )}

          {/* Signature date — big + letter-spaced. Filled date is a click-to-edit
              target in preview; a missing date is a dashed ghost button. */}
          {heroDateBig ? (
            isPreview && e.onEditDate ? (
              <button
                type="button"
                onClick={e.onEditDate}
                title={editHint}
                className="relative z-10 mx-auto mt-6 block rounded-md px-2 py-1 text-4xl tracking-[0.18em] transition hover:bg-black/5 dark:hover:bg-white/10 sm:text-6xl"
                style={{ fontFamily: "var(--wt-heading-font)", color: "var(--wt-text)" }}
              >
                {heroDateBig}
              </button>
            ) : (
              <p
                className="relative z-10 mx-auto mt-6 text-4xl tracking-[0.18em] sm:text-6xl"
                style={{ fontFamily: "var(--wt-heading-font)", color: "var(--wt-text)" }}
                aria-label={dateLine}
              >
                <span aria-hidden>{heroDateBig}</span>
              </p>
            )
          ) : isPreview ? (
            <button
              type="button"
              onClick={e.onEditDate}
              disabled={!e.onEditDate}
              title={editHint}
              className="mx-auto mt-6 inline-flex items-center gap-2 rounded-lg border border-dashed border-paper-300 bg-paper-50 px-3 py-1.5 text-sm text-ink-400 transition hover:border-ink-300 hover:bg-paper-100 disabled:cursor-default dark:border-umber-700 dark:bg-umber-800/40 dark:text-umber-300 dark:hover:border-umber-600"
            >
              <Calendar size={14} aria-hidden />
              {t("wedding_site.ghost.date_cta")}
              <Plus size={12} aria-hidden />
            </button>
          ) : null}
        </div>

        {/* Cover photo — pulled up under the date so the big numerals overlap its
            top edge. Dashed ghost in the editor preview when still empty. */}
        {view.cover_image_url ? (
          <div className={heroDateBig ? "-mt-5" : "mt-6"}>
            <img
              src={view.cover_image_url}
              alt=""
              loading="lazy"
              className="aspect-[4/3] w-full object-cover sm:aspect-[16/9]"
            />
          </div>
        ) : isPreview ? (
          <div className="px-6 pt-6 sm:px-10">
            <div
              className={`flex aspect-[16/6] min-h-[140px] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-paper-300 bg-paper-50 text-center dark:border-umber-700 dark:bg-umber-800/40${
                e.onEditCover
                  ? " cursor-pointer transition hover:border-ink-300 hover:bg-paper-100 dark:hover:border-umber-600 dark:hover:bg-umber-800"
                  : ""
              }`}
              {...editAffordance(e.onEditCover, editHint)}
            >
              <Camera size={28} className="text-ink-300 dark:text-umber-400" aria-hidden />
              <p className="font-grotesk text-base font-medium tracking-tight text-ink-400 dark:text-umber-300">
                {t("wedding_site.ghost.cover_title")}
              </p>
              <p className="flex items-center gap-1 text-xs text-ink-500 dark:text-umber-200">
                <Plus size={12} aria-hidden />
                {t("wedding_site.ghost.cover_cta")}
              </p>
            </div>
          </div>
        ) : null}

        {/* Venue line under the photo. */}
        <div className="px-6 pb-8 pt-6 sm:px-10">
          {view.venue_name ? (
            isPreview && e.onEditVenue ? (
              <button
                type="button"
                onClick={e.onEditVenue}
                title={editHint}
                className="inline-flex items-center justify-center gap-2 rounded-md px-1.5 py-0.5 font-serif text-sm font-normal italic text-ink-700 transition hover:bg-paper-100 hover:text-ink-900 dark:text-paper-100 dark:hover:bg-umber-800 sm:text-base"
              >
                <MapPin size={14} aria-hidden />
                {view.venue_name}
              </button>
            ) : (
              <p className="inline-flex items-center justify-center gap-2 font-serif text-sm font-normal italic text-ink-700 dark:text-paper-100 sm:text-base">
                <MapPin size={14} aria-hidden />
                {view.venue_name}
              </p>
            )
          ) : isPreview ? (
            <button
              type="button"
              onClick={e.onEditVenue}
              disabled={!e.onEditVenue}
              title={editHint}
              className="inline-flex items-center gap-2 rounded-lg border border-dashed border-paper-300 bg-paper-50 px-3 py-1.5 text-sm text-ink-400 transition hover:border-ink-300 hover:bg-paper-100 disabled:cursor-default dark:border-umber-700 dark:bg-umber-800/40 dark:text-umber-300 dark:hover:border-umber-600"
            >
              <MapPin size={14} aria-hidden />
              {t("wedding_site.ghost.venue_cta")}
              <Plus size={12} aria-hidden />
            </button>
          ) : (
            !showConfirmedExtras &&
            view.location_radius_km !== null && (
              <p className="inline-flex items-center justify-center gap-2 text-xs text-ink-500 dark:text-umber-300">
                <MapPin size={14} aria-hidden />
                {t("wedding_site.venue_approx")}
              </p>
            )
          )}
        </div>
      </section>

      {/* Pre-RSVP welcome block — same at every tier. */}
      {view.guest_page_intro && !sectionHidden("intro") ? (
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
          <p className="wt-accent text-[11px] font-semibold uppercase tracking-[0.2em]">
            {t("wedding_site.invited_eyebrow")}
          </p>
          <h2 className="mt-1 font-grotesk text-2xl tracking-tight text-ink-900 dark:text-paper-50">
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

      {/* Schedule — exposed at every tier. The filled state is a DARK editorial
          band (themed from the couple's text colour, so each style gets its own
          dark) with a horizontal time-line, mirroring the reference's "schedule"
          section. Empty preview falls back to a light ghost card. */}
      {view.schedule.length > 0 && !sectionHidden("schedule") ? (
        <section
          className={`mt-6 overflow-hidden rounded-3xl px-6 py-10 text-center sm:px-10 sm:py-14${
            isPreview && e.onEditSchedule ? " cursor-pointer transition hover:opacity-95" : ""
          }`}
          style={{ backgroundColor: "var(--wt-text)", color: "var(--wt-bg)" }}
          {...(isPreview ? editAffordance(e.onEditSchedule, editHint) : {})}
        >
          <h2
            className="text-3xl tracking-tight sm:text-4xl"
            style={{ fontFamily: "var(--wt-heading-font)" }}
          >
            {t("wedding_site.schedule_title")}
          </h2>
          <ul className="mt-8 flex flex-wrap justify-center gap-x-10 gap-y-6">
            {view.schedule.map((entry) => (
              <li key={entry.id} className="flex min-w-[4.5rem] flex-col items-center gap-1">
                <span
                  className="text-2xl tabular-nums sm:text-3xl"
                  style={{ fontFamily: "var(--wt-heading-font)" }}
                >
                  {formatTimeOfDay(entry.starts_at_minutes)}
                </span>
                <span className="text-[11px] uppercase tracking-[0.18em]" style={{ opacity: 0.85 }}>
                  {entry.label}
                </span>
                {entry.location && (
                  <span className="text-[10px]" style={{ opacity: 0.65 }}>
                    {entry.location}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : isPreview ? (
        <CardSection onEdit={e.onEditSchedule} hint={editHint}>
          <h2 className="font-grotesk text-2xl tracking-tight text-ink-900 dark:text-paper-50">
            {t("wedding_site.schedule_title")}
          </h2>
          <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-ink-400 dark:text-umber-300">
            <Plus size={14} aria-hidden />
            {t("wedding_site.ghost.schedule_cta")}
          </p>
        </CardSection>
      ) : null}

      {/* "Good to know" — parking, getting there, accommodation, … */}
      {view.useful_info && !sectionHidden("useful_info") ? (
        <CardSection onEdit={isPreview ? e.onEditUsefulInfo : undefined} hint={editHint}>
          <h2 className="font-grotesk text-2xl tracking-tight text-ink-900 dark:text-paper-50">
            {t("guest_portal.useful_info_title")}
          </h2>
          <p className="mt-3 whitespace-pre-line text-base text-ink-800 dark:text-paper-100">
            {view.useful_info}
          </p>
        </CardSection>
      ) : isPreview ? (
        <CardSection onEdit={e.onEditUsefulInfo} hint={editHint}>
          <h2 className="font-grotesk text-2xl tracking-tight text-ink-900 dark:text-paper-50">
            {t("guest_portal.useful_info_title")}
          </h2>
          <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-ink-400 dark:text-umber-300">
            <Plus size={14} aria-hidden />
            {t("wedding_site.ghost.useful_info_cta")}
          </p>
        </CardSection>
      ) : null}

      {/* Confirmed-tier unlocked block. Live: shown only at confirmed tier.
          Preview: always shown as a labelled "unlocks after RSVP" block so the
          couple can preview + jump to edit the post-RSVP content. */}
      {(isPreview ||
        (showConfirmedExtras && (view.post_rsvp_content || view.location_lat !== null))) && (
        <section className="card mt-6" aria-live={isPreview ? undefined : "polite"}>
          {isPreview && (
            <p className="wt-accent mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em]">
              <Lock size={12} aria-hidden /> {t("wedding_site.ghost.locked_eyebrow")}
            </p>
          )}
          <h2
            ref={confirmedHeadingRef}
            tabIndex={isPreview ? undefined : -1}
            className="font-grotesk text-2xl tracking-tight text-ink-900 outline-none dark:text-paper-50"
          >
            {t("wedding_site.confirmed_title")}
          </h2>
          {view.post_rsvp_content ? (
            <p className="mt-3 whitespace-pre-line text-base text-ink-800 dark:text-paper-100">
              {view.post_rsvp_content}
            </p>
          ) : isPreview ? (
            <button
              type="button"
              onClick={e.onEditPostRsvp}
              disabled={!e.onEditPostRsvp}
              title={editHint}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-paper-300 bg-paper-50 px-3 py-2 text-sm text-ink-400 transition hover:border-ink-300 hover:bg-paper-100 disabled:cursor-default dark:border-umber-700 dark:bg-umber-800/40 dark:text-umber-300 dark:hover:border-umber-600"
            >
              <Plus size={14} aria-hidden />
              {t("wedding_site.ghost.post_rsvp_cta")}
            </button>
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

      {/* Wishlist decks — confirmed-tier live page only (server returns null
          otherwise, and the editor preview has no household context). Gifts and
          personal requests render as two separate sections. */}
      {!isPreview &&
        !sectionHidden("wishlist") &&
        view.wishlist &&
        view.wishlist.length > 0 &&
        (() => {
          const gifts = view.wishlist.filter((e) => e.kind === "gift");
          const requests = view.wishlist.filter((e) => e.kind === "request");
          return (
            <>
              {gifts.length > 0 && (
                <section className="card mt-6">
                  <h2 className="flex items-center gap-2 font-grotesk text-2xl tracking-tight text-ink-900 dark:text-paper-50">
                    <Gift size={20} aria-hidden /> {t("guest_portal.wishlist_section_title")}
                  </h2>
                  <p className="mt-3 max-w-2xl whitespace-pre-line text-base text-ink-700 dark:text-paper-100">
                    {t("guest_portal.wishlist_intro")}
                  </p>
                  <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                    {gifts.map((entry) => (
                      <GuestWishlistCard
                        key={entry.id}
                        entry={entry}
                        currency={localeCurrency(locale)}
                        locale={locale}
                        onToggleInterest={onToggleWishlistInterest}
                        t={t}
                      />
                    ))}
                  </ul>
                </section>
              )}
              {requests.length > 0 && (
                <section className="card mt-6">
                  <h2 className="flex items-center gap-2 font-grotesk text-2xl tracking-tight text-ink-900 dark:text-paper-50">
                    <HeartHandshake size={20} aria-hidden />{" "}
                    {t("guest_portal.wishlist_requests_title")}
                  </h2>
                  <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                    {requests.map((entry) => (
                      <GuestWishlistCard
                        key={entry.id}
                        entry={entry}
                        currency={localeCurrency(locale)}
                        locale={locale}
                        onToggleInterest={onToggleWishlistInterest}
                        t={t}
                      />
                    ))}
                  </ul>
                </section>
              )}
            </>
          );
        })()}

      {/* RSVP CTA — generic at the public tier, personal at invited. In preview
          it's representative (non-navigating), so the couple sees the button
          their guests get without leaving the editor. */}
      {(isPreview || !showConfirmedExtras) && (
        <section className="card stationery mt-6 text-center">
          <Heart size={28} className="wt-accent mx-auto" />
          <h2 className="mt-3 font-grotesk text-2xl tracking-tight text-ink-900 dark:text-paper-50">
            {hasCode ? t("wedding_site.rsvp_personal_title") : t("wedding_site.rsvp_title")}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-600 dark:text-umber-200">
            {hasCode ? t("wedding_site.rsvp_personal_body") : t("wedding_site.rsvp_body")}
          </p>
          {isPreview ? (
            <span
              className={`${rsvpBtnClass} mt-5 inline-flex cursor-default opacity-90`}
              aria-hidden
            >
              {t("wedding_site.rsvp_cta")}
            </span>
          ) : (
            <Link to={rsvpHref ?? "/"} className={`${rsvpBtnClass} mt-5 inline-flex`}>
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
    </div>
  );
}
