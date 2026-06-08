// Shared presentational body for the couple's public wedding site. Rendered in
// two places, pixel-identical, so the couple's preview matches what guests see:
//
//   - Live mode  (WeddingWebsitePage at /w/:slug[/:code]): tier-aware
//     progressive disclosure. Gated fields are already omitted server-side, so
//     the rendering here is presentational (null check + render).
//   - Preview mode (GuestPageEditorPage at /app/guest-page + DesignPage): the
//     `isPreview` flag turns empty sections into dashed "ghost" placeholders
//     that scroll-and-focus the matching editor field via the `edit` callbacks,
//     and the post-RSVP block is shown as a labelled "unlocks after RSVP"
//     preview regardless of tier.
//
// Editorial layout: a full-bleed magazine page of alternating light / dark
// bands (NOT app cards). Every colour comes from the couple's Design via the
// `--wt-*` custom properties on the `.wedding-theme` root, so the page is
// LIGHT-LOCKED — it ignores the app's global `.dark` class (no `dark:` variants
// here). Light bands paint `--wt-bg` / `--wt-text`; dark bands invert to
// `--wt-text` / `--wt-bg`, giving every palette its own near-black band. The
// caller renders this full-width (no max-w wrapper); each section owns its
// inner max-width.

import {
  Calendar,
  Camera,
  Gift,
  Heart,
  HeartHandshake,
  Lock,
  MapPin,
  Plus,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties, KeyboardEvent, ReactNode, Ref } from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { formatWeddingDate, type WebsiteSectionSlug } from "@shared/design";
import { pickKeyMoments } from "@shared/schedule";
import { formatDate, isPlausibleDateIso, localeCurrency } from "../lib/format";
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

/** Editor preview — direct inline editing of the prose fields. When provided
 *  (preview only), the matching text in the preview becomes click-to-edit in
 *  place: clicking turns it into an input that commits back through these
 *  setters, and the editor's debounced autosave persists it. Fields without a
 *  setter (and empty sections) fall back to the scroll-to-field `edit`
 *  handlers. Venue commits name + city together so the split never loses the
 *  city when only one half is edited. */
export interface WeddingSiteInlineEdit {
  intro?: (value: string) => void;
  venue?: (name: string, city: string) => void;
  postRsvp?: (value: string) => void;
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
  /** Editor preview — inline (in-place) editing of the prose fields. */
  inlineEdit?: WeddingSiteInlineEdit;
  /** Weddly wordmark footer. Defaults to on for the live page, off in the
   *  editor preview (the app shell already brands the surface). */
  showFooter?: boolean;
}

function formatTimeOfDay(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Split the stored venue into a display name + city. Prefers the explicit
 *  `venue_city`; otherwise falls back to the part of `venue_name` after the
 *  first comma (legacy "Name, City" values composed by the place picker). When
 *  both are set, a city already baked into the name is stripped so it doesn't
 *  echo twice. */
function splitVenue(
  venueName: string | null,
  venueCity: string | null,
): { name: string | null; city: string | null } {
  const vn = venueName?.trim() || null;
  let city = venueCity?.trim() || null;
  let name = vn;
  if (vn && !city) {
    const i = vn.indexOf(",");
    if (i > 0) {
      name = vn.slice(0, i).trim() || vn;
      city = vn.slice(i + 1).trim() || null;
    }
  } else if (vn && city) {
    const suffix = `, ${city}`.toLowerCase();
    if (vn.toLowerCase().endsWith(suffix)) {
      name = vn.slice(0, vn.length - suffix.length).trim() || vn;
    }
  }
  return { name, city };
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

/** A full-bleed band. `tone="dark"` inverts to the palette's near-black; light
 *  bands inherit the page `--wt-bg`/`--wt-text`. The inner content is capped to
 *  a readable column. */
function Band({
  children,
  tone = "light",
  onEdit,
  hint,
  className = "",
  ariaLive,
}: {
  children: ReactNode;
  tone?: "light" | "dark";
  onEdit?: () => void;
  hint?: string;
  className?: string;
  ariaLive?: "polite";
}) {
  const dark = tone === "dark";
  const style: CSSProperties = dark
    ? { backgroundColor: "var(--wt-text)", color: "var(--wt-bg)" }
    : {};
  return (
    <section
      aria-live={ariaLive}
      className={`w-full px-6 sm:px-8 ${dark ? "py-14 sm:py-20" : "py-12 sm:py-16"}${
        onEdit ? " cursor-pointer transition hover:opacity-95" : ""
      }${className ? ` ${className}` : ""}`}
      style={style}
      {...editAffordance(onEdit, hint ?? "")}
    >
      <div className="mx-auto max-w-3xl">{children}</div>
    </section>
  );
}

/** Small uppercase eyebrow above a section heading. */
function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <p
      className="text-[11px] font-semibold uppercase tracking-[0.24em]"
      style={dark ? { opacity: 0.7 } : { color: "var(--wt-accent-text)" }}
    >
      {children}
    </p>
  );
}

/** Section heading in the couple's heading font, inheriting the band colour.
 *  `color: inherit` is set inline so it beats the global base `h2 { color:
 *  ink.900 }` unconditionally — without it the heading on a dark band (e.g.
 *  the "A nap menete" schedule) rendered dark-on-dark and vanished. */
function Heading({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={`text-3xl tracking-tight sm:text-4xl ${className}`}
      style={{ fontFamily: "var(--wt-heading-font)", color: "inherit" }}
    >
      {children}
    </h2>
  );
}

/** Dashed "add this" placeholder for an empty section in the editor preview.
 *  Light-locked (no dark: variants) so it reads as part of the guest theme. */
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
      className={`mx-auto flex max-w-xl flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center${
        clickable ? " cursor-pointer transition hover:opacity-80" : ""
      }`}
      style={{ borderColor: "var(--wt-accent)" }}
      {...editAffordance(onAdd, hint)}
    >
      <Icon size={22} aria-hidden style={{ opacity: 0.5 }} />
      <p
        className="text-lg tracking-tight"
        style={{ fontFamily: "var(--wt-heading-font)", opacity: 0.7 }}
      >
        {title}
      </p>
      <p className="inline-flex items-center gap-1 text-xs" style={{ opacity: 0.6 }}>
        <Plus size={12} aria-hidden />
        {cta}
      </p>
    </div>
  );
}

/** Click-to-edit prose, styled to match the rendered text exactly. In display
 *  mode it's a span carrying the caller's text classes (so it looks identical to
 *  the static text, with a faint editable affordance on hover); clicking swaps
 *  in an auto-styled input/textarea that inherits the same typography. Commits
 *  on blur and on Enter (single-line) / Cmd+Enter (multiline); Escape cancels.
 *  Empty value shows a muted placeholder so an unfilled field is still clickable. */
function InlineText({
  value,
  onCommit,
  multiline = false,
  className = "",
  style,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onCommit: (next: string) => void;
  multiline?: boolean;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const fieldRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  // Focus + place the caret at the end the moment the field appears (the user
  // clicked to edit, so they expect to type straight away). A ref-driven focus
  // keeps us off `autoFocus` (which steals focus on mount in other contexts).
  useEffect(() => {
    if (!editing) return;
    const el = fieldRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const begin = () => {
    setDraft(value);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };
  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

  if (editing) {
    const fieldCls = `${className} block w-full resize-none appearance-none rounded-md border-0 bg-[var(--wt-bg)] p-1 outline-none ring-2 ring-[var(--wt-accent)]`;
    const fieldStyle: CSSProperties = { ...style, color: "inherit", fontFamily: "inherit" };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        cancel();
      } else if (ev.key === "Enter" && (!multiline || ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        commit();
      }
    };
    return multiline ? (
      <textarea
        ref={fieldRef}
        rows={3}
        value={draft}
        onChange={(ev) => setDraft(ev.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className={fieldCls}
        style={fieldStyle}
        aria-label={ariaLabel}
      />
    ) : (
      <input
        ref={fieldRef}
        type="text"
        value={draft}
        onChange={(ev) => setDraft(ev.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className={fieldCls}
        style={fieldStyle}
        aria-label={ariaLabel}
      />
    );
  }

  const empty = value.trim() === "";
  return (
    <span
      role="button"
      tabIndex={0}
      title={t("wedding_site.inline_edit_hint")}
      onClick={begin}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          begin();
        }
      }}
      className={`${className} inline-edit-text block cursor-text rounded-md transition`}
      style={style}
    >
      {empty ? <span style={{ opacity: 0.5 }}>{placeholder}</span> : value}
    </span>
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
  inlineEdit,
  showFooter,
}: WeddingSiteViewProps) {
  const { t } = useT();
  const e = edit ?? {};
  const editHint = t("wedding_site.edit_hint");
  const footer = showFooter ?? !isPreview;

  // Inline editing is available (preview only) when the parent wired a setter
  // for the field. When it is, the section's text becomes click-to-edit in
  // place and the band-level scroll-to-field affordance is dropped (so the
  // nested edit control isn't swallowed by an outer role="button").
  const introInline = isPreview && Boolean(inlineEdit?.intro);
  const venueInline = isPreview && Boolean(inlineEdit?.venue);
  const postRsvpInline = isPreview && Boolean(inlineEdit?.postRsvp);

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

  // Black-and-white editorial treatment for cover/venue imagery.
  const imgFilter =
    view.design.website_image_treatment === "grayscale" ? "grayscale(1)" : undefined;

  // Visual identity from the couple's Design selection, fed in as CSS custom
  // properties on the `.wedding-theme` wrapper (consumed by index.css, unlayered
  // so it beats the Tailwind utilities). The root also paints the page bg/text
  // from the palette so every light band inherits it. No raw hex here.
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
    backgroundColor: "var(--wt-bg)",
    color: "var(--wt-text)",
  } as CSSProperties;

  const hairline = (
    <span
      aria-hidden
      className="mx-auto block h-px w-16"
      style={{ backgroundColor: "var(--wt-accent)" }}
    />
  );

  return (
    <div className="wedding-theme w-full" style={themeStyle}>
      {/* ── Hero ────────────────────────────────────────────────────────────
          Couple names, the date set BIG + letter-spaced as the signature
          element, then a full-width cover photo the date overlaps. */}
      <section className="w-full">
        <div className="mx-auto max-w-4xl px-6 pt-12 text-center sm:px-8 sm:pt-16">
          <h1
            className="text-4xl leading-[1.05] tracking-tight sm:text-6xl"
            style={{ fontFamily: "var(--wt-heading-font)" }}
          >
            {view.couple_display_name}
          </h1>

          {/* Signature date — big + letter-spaced. Click-to-edit in preview;
              a missing date is a dashed ghost button. */}
          {heroDateBig ? (
            isPreview && e.onEditDate ? (
              <button
                type="button"
                onClick={e.onEditDate}
                title={editHint}
                className="relative z-10 mx-auto mt-7 block rounded-md px-2 py-1 text-5xl tracking-[0.18em] transition hover:opacity-80 sm:text-7xl"
                style={{ fontFamily: "var(--wt-heading-font)", color: "var(--wt-text)" }}
              >
                {heroDateBig}
              </button>
            ) : (
              <p
                className="relative z-10 mx-auto mt-7 text-5xl tracking-[0.18em] sm:text-7xl"
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
              className="mx-auto mt-7 inline-flex items-center gap-2 rounded-lg border border-dashed px-3 py-1.5 text-sm transition hover:opacity-80 disabled:cursor-default"
              style={{ borderColor: "var(--wt-accent)", opacity: 0.7 }}
            >
              <Calendar size={14} aria-hidden />
              {t("wedding_site.ghost.date_cta")}
              <Plus size={12} aria-hidden />
            </button>
          ) : null}
        </div>

        {/* Cover photo — full-width, pulled up under the date so the big
            numerals overlap its top edge. Dashed ghost when still empty. */}
        {view.cover_image_url ? (
          <div className={heroDateBig ? "-mt-4 w-full sm:-mt-6" : "mt-8 w-full"}>
            <img
              src={view.cover_image_url}
              alt=""
              loading="lazy"
              className="aspect-[4/3] w-full object-cover sm:aspect-[21/9]"
              style={imgFilter ? { filter: imgFilter } : undefined}
            />
          </div>
        ) : isPreview ? (
          <div className="mx-auto mt-8 max-w-4xl px-6 sm:px-8">
            <div
              className={`flex aspect-[16/6] min-h-[140px] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center${
                e.onEditCover ? " cursor-pointer transition hover:opacity-80" : ""
              }`}
              style={{ borderColor: "var(--wt-accent)" }}
              {...editAffordance(e.onEditCover, editHint)}
            >
              <Camera size={28} aria-hidden style={{ opacity: 0.5 }} />
              <p
                className="text-lg tracking-tight"
                style={{ fontFamily: "var(--wt-heading-font)", opacity: 0.7 }}
              >
                {t("wedding_site.ghost.cover_title")}
              </p>
              <p className="inline-flex items-center gap-1 text-xs" style={{ opacity: 0.6 }}>
                <Plus size={12} aria-hidden />
                {t("wedding_site.ghost.cover_cta")}
              </p>
            </div>
          </div>
        ) : null}
      </section>

      {/* ── Welcome / intro — same at every tier. ───────────────────────── */}
      {view.guest_page_intro && !sectionHidden("intro") ? (
        <Band onEdit={isPreview && !introInline ? e.onEditIntro : undefined} hint={editHint}>
          {introInline && inlineEdit?.intro ? (
            <InlineText
              value={view.guest_page_intro}
              onCommit={inlineEdit.intro}
              multiline
              className="whitespace-pre-line text-center text-lg leading-relaxed"
              style={{ opacity: 0.92 }}
              ariaLabel={t("guest_page_editor.intro_label")}
            />
          ) : (
            <p
              className="whitespace-pre-line text-center text-lg leading-relaxed"
              style={{ opacity: 0.92 }}
            >
              {view.guest_page_intro}
            </p>
          )}
        </Band>
      ) : isPreview ? (
        <Band>
          <Ghost
            icon={Heart}
            title={t("wedding_site.ghost.welcome_title")}
            cta={t("wedding_site.ghost.welcome_cta")}
            onAdd={e.onEditIntro}
            hint={editHint}
          />
        </Band>
      ) : null}

      {/* ── Invited tier — personal hello + member list (live page only). ── */}
      {!isPreview && showInvitedExtras && household && (
        <Band className="text-center">
          <Eyebrow>{t("wedding_site.invited_eyebrow")}</Eyebrow>
          <Heading className="mt-2">{household.household_label}</Heading>
          {household.members.length > 0 && (
            <ul className="mx-auto mt-6 max-w-md space-y-1 text-sm" style={{ opacity: 0.85 }}>
              {household.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3">
                  <span>{m.full_name}</span>
                  <span style={{ opacity: 0.7 }}>
                    {t(`wedding_site.rsvp_status_${m.rsvp_status}`)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Band>
      )}

      {/* ── Schedule — DARK band with a horizontal time-line. ───────────── */}
      {view.schedule.length > 0 && !sectionHidden("schedule") ? (
        <Band tone="dark" onEdit={isPreview ? e.onEditSchedule : undefined} hint={editHint}>
          <div className="text-center">
            <Eyebrow dark>{t("wedding_site.schedule_eyebrow")}</Eyebrow>
            <Heading className="mt-2">{t("wedding_site.schedule_title")}</Heading>
            {/* Only the day's headline beats (arrival / ceremony / dinner /
             *  first dance by default, or whatever the couple flagged), kept on
             *  a single row. `overflow-x-auto` lets the row scroll on a narrow
             *  phone rather than wrapping back into a ragged grid. */}
            <ul className="mt-8 flex flex-nowrap justify-center gap-x-8 overflow-x-auto sm:gap-x-12">
              {pickKeyMoments(view.schedule).map((entry) => (
                <li
                  key={entry.id}
                  className="flex min-w-[4.5rem] shrink-0 flex-col items-center gap-1"
                >
                  <span
                    className="text-2xl tabular-nums sm:text-3xl"
                    style={{ fontFamily: "var(--wt-heading-font)" }}
                  >
                    {formatTimeOfDay(entry.starts_at_minutes)}
                  </span>
                  <span
                    className="text-[11px] uppercase tracking-[0.18em]"
                    style={{ opacity: 0.85 }}
                  >
                    {entry.label}
                  </span>
                  {entry.location && (
                    <span className="text-[10px]" style={{ opacity: 0.6 }}>
                      {entry.location}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </Band>
      ) : isPreview ? (
        <Band tone="dark" onEdit={e.onEditSchedule} hint={editHint}>
          <div className="text-center">
            <Eyebrow dark>{t("wedding_site.schedule_eyebrow")}</Eyebrow>
            <Heading className="mt-2">{t("wedding_site.schedule_title")}</Heading>
            <p className="mt-4 inline-flex items-center gap-1.5 text-sm" style={{ opacity: 0.7 }}>
              <Plus size={14} aria-hidden />
              {t("wedding_site.ghost.schedule_cta")}
            </p>
          </div>
        </Band>
      ) : null}

      {/* ── Location — venue name + (confirmed-tier) exact map link. ─────── */}
      {view.venue_name ? (
        <Band
          onEdit={isPreview && !venueInline ? e.onEditVenue : undefined}
          hint={editHint}
          className="text-center"
        >
          <Eyebrow>{t("wedding_site.location_eyebrow")}</Eyebrow>
          {(() => {
            const venue = splitVenue(view.venue_name, view.venue_city);
            // Commit name + city as a pair so editing one half never drops the
            // other (the displayed split may have derived the city from a
            // "Name, City" venue_name with no separate venue_city set).
            const commitVenue = inlineEdit?.venue;
            if (venueInline && commitVenue) {
              return (
                <>
                  <Heading className="mt-2">
                    <InlineText
                      value={venue.name ?? ""}
                      onCommit={(name) => commitVenue(name, venue.city ?? "")}
                      className="text-3xl tracking-tight sm:text-4xl"
                      placeholder={t("wedding_site_editor.venue_label")}
                      ariaLabel={t("wedding_site_editor.venue_label")}
                    />
                  </Heading>
                  <p className="mt-1.5 text-base tracking-wide" style={{ opacity: 0.7 }}>
                    <InlineText
                      value={venue.city ?? ""}
                      onCommit={(city) => commitVenue(venue.name ?? "", city)}
                      className="text-base tracking-wide"
                      placeholder={t("wedding_site_editor.venue_city_label")}
                      ariaLabel={t("wedding_site_editor.venue_city_label")}
                    />
                  </p>
                </>
              );
            }
            return (
              <>
                <Heading className="mt-2">{venue.name}</Heading>
                {venue.city ? (
                  <p className="mt-1.5 text-base tracking-wide" style={{ opacity: 0.7 }}>
                    {venue.city}
                  </p>
                ) : null}
              </>
            );
          })()}
          <div className="mt-4 flex justify-center">{hairline}</div>
          {view.location_lat !== null && view.location_lng !== null ? (
            <p className="mt-5">
              <a
                className="btn-outline inline-flex items-center gap-2"
                href={`https://www.openstreetmap.org/?mlat=${view.location_lat}&mlon=${view.location_lng}#map=17/${view.location_lat}/${view.location_lng}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(ev) => ev.stopPropagation()}
              >
                <MapPin size={15} aria-hidden />
                {t("wedding_site.confirmed_open_map")}
              </a>
            </p>
          ) : null}
        </Band>
      ) : isPreview ? (
        <Band className="text-center">
          <Eyebrow>{t("wedding_site.location_eyebrow")}</Eyebrow>
          <div className="mt-3">
            <Ghost
              icon={MapPin}
              title={t("wedding_site.ghost.venue_cta")}
              cta={t("wedding_site.ghost.venue_cta")}
              onAdd={e.onEditVenue}
              hint={editHint}
            />
          </div>
        </Band>
      ) : (
        !showConfirmedExtras &&
        view.location_radius_km !== null && (
          <Band className="text-center">
            <p
              className="inline-flex items-center justify-center gap-2 text-sm"
              style={{ opacity: 0.7 }}
            >
              <MapPin size={14} aria-hidden />
              {t("wedding_site.venue_approx")}
            </p>
          </Band>
        )
      )}

      {/* ── Countdown — DARK band, big numerals. ────────────────────────── */}
      {(view.wedding_date || isPreview) && (
        <WeddingCountdown
          date={view.wedding_date}
          isPreview={isPreview}
          onEdit={isPreview ? e.onEditDate : undefined}
          variant="band"
        />
      )}

      {/* ── Good to know — parking, getting there, accommodation, … ─────── */}
      {view.useful_info && !sectionHidden("useful_info") ? (
        <Band onEdit={isPreview ? e.onEditUsefulInfo : undefined} hint={editHint}>
          <Heading>{t("guest_portal.useful_info_title")}</Heading>
          <p
            className="mt-4 whitespace-pre-line text-base leading-relaxed"
            style={{ opacity: 0.92 }}
          >
            {view.useful_info}
          </p>
        </Band>
      ) : isPreview ? (
        <Band onEdit={e.onEditUsefulInfo} hint={editHint}>
          <Heading>{t("guest_portal.useful_info_title")}</Heading>
          <p className="mt-4 inline-flex items-center gap-1.5 text-sm" style={{ opacity: 0.7 }}>
            <Plus size={14} aria-hidden />
            {t("wedding_site.ghost.useful_info_cta")}
          </p>
        </Band>
      ) : null}

      {/* ── Confirmed-tier unlocked block. Live: confirmed only. Preview:
          always shown, labelled "unlocks after RSVP". ──────────────────── */}
      {(isPreview || (showConfirmedExtras && view.post_rsvp_content)) && (
        <Band ariaLive={isPreview ? undefined : "polite"}>
          {isPreview && (
            <p
              className="mb-3 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em]"
              style={{ color: "var(--wt-accent-text)" }}
            >
              <Lock size={12} aria-hidden /> {t("wedding_site.ghost.locked_eyebrow")}
            </p>
          )}
          <Heading>
            <span
              ref={confirmedHeadingRef}
              tabIndex={isPreview ? undefined : -1}
              className="outline-none"
            >
              {t("wedding_site.confirmed_title")}
            </span>
          </Heading>
          {view.post_rsvp_content && postRsvpInline && inlineEdit?.postRsvp ? (
            <p className="mt-4">
              <InlineText
                value={view.post_rsvp_content}
                onCommit={inlineEdit.postRsvp}
                multiline
                className="whitespace-pre-line text-base leading-relaxed"
                style={{ opacity: 0.92 }}
                ariaLabel={t("guest_page_editor.post_rsvp_label")}
              />
            </p>
          ) : view.post_rsvp_content ? (
            <p
              className="mt-4 whitespace-pre-line text-base leading-relaxed"
              style={{ opacity: 0.92 }}
            >
              {view.post_rsvp_content}
            </p>
          ) : isPreview ? (
            <button
              type="button"
              onClick={e.onEditPostRsvp}
              disabled={!e.onEditPostRsvp}
              title={editHint}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-sm transition hover:opacity-80 disabled:cursor-default"
              style={{ borderColor: "var(--wt-accent)", opacity: 0.7 }}
            >
              <Plus size={14} aria-hidden />
              {t("wedding_site.ghost.post_rsvp_cta")}
            </button>
          ) : null}
        </Band>
      )}

      {/* ── Wishlist decks — confirmed-tier live page only. ─────────────── */}
      {!isPreview &&
        !sectionHidden("wishlist") &&
        view.wishlist &&
        view.wishlist.length > 0 &&
        (() => {
          const gifts = view.wishlist.filter((x) => x.kind === "gift");
          const requests = view.wishlist.filter((x) => x.kind === "request");
          return (
            <Band>
              {gifts.length > 0 && (
                <div>
                  <Heading className="flex items-center gap-2">
                    <Gift size={22} aria-hidden /> {t("guest_portal.wishlist_section_title")}
                  </Heading>
                  <p
                    className="mt-3 max-w-2xl whitespace-pre-line text-base"
                    style={{ opacity: 0.9 }}
                  >
                    {t("guest_portal.wishlist_intro")}
                  </p>
                  <ul className="mt-5 grid gap-3 sm:grid-cols-2">
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
                </div>
              )}
              {requests.length > 0 && (
                <div className={gifts.length > 0 ? "mt-10" : ""}>
                  <Heading className="flex items-center gap-2">
                    <HeartHandshake size={22} aria-hidden />{" "}
                    {t("guest_portal.wishlist_requests_title")}
                  </Heading>
                  <ul className="mt-5 grid gap-3 sm:grid-cols-2">
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
                </div>
              )}
            </Band>
          );
        })()}

      {/* ── RSVP CTA — generic at the public tier, personal at invited. ─── */}
      {(isPreview || !showConfirmedExtras) && (
        <section
          className="w-full border-t px-6 py-14 text-center sm:px-8 sm:py-20"
          style={{ borderColor: "var(--wt-accent)" }}
        >
          <div className="mx-auto max-w-2xl">
            <Heart
              size={28}
              className="mx-auto"
              style={{ color: "var(--wt-accent-text)" }}
              aria-hidden
            />
            <Heading className="mt-4">
              {hasCode ? t("wedding_site.rsvp_personal_title") : t("wedding_site.rsvp_title")}
            </Heading>
            <p className="mx-auto mt-3 max-w-md text-sm" style={{ opacity: 0.8 }}>
              {hasCode ? t("wedding_site.rsvp_personal_body") : t("wedding_site.rsvp_body")}
            </p>
            {isPreview ? (
              <span
                className={`${rsvpBtnClass} mt-6 inline-flex cursor-default opacity-90`}
                aria-hidden
              >
                {t("wedding_site.rsvp_cta")}
              </span>
            ) : (
              <Link to={rsvpHref ?? "/"} className={`${rsvpBtnClass} mt-6 inline-flex`}>
                {hasCode ? t("wedding_site.rsvp_personal_cta") : t("wedding_site.rsvp_cta")}
              </Link>
            )}
          </div>
        </section>
      )}

      {!isPreview && showConfirmedExtras && rsvpHref && (
        <section className="w-full px-6 py-8 text-center text-xs sm:px-8" style={{ opacity: 0.7 }}>
          <Lock size={12} aria-hidden className="mr-1 inline" />
          <Link to={rsvpHref} className="underline">
            {t("wedding_site.rsvp_manage_cta")}
          </Link>
        </section>
      )}

      {/* ── Weddly branding — centered wordmark over a hairline. Live only. ── */}
      {footer && (
        <footer
          className="flex w-full flex-col items-center gap-2 border-t px-6 py-10 sm:px-8"
          style={{ borderColor: "var(--wt-accent)" }}
        >
          <Link to="/" style={{ color: "var(--wt-text)" }}>
            <Wordmark size="md" />
          </Link>
          <p className="text-center text-[11px]" style={{ opacity: 0.55 }}>
            {t("wedding_site.footer_built_with")}
          </p>
        </footer>
      )}
    </div>
  );
}
