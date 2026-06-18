// Read-only "for guests" surface — the same JSX used by the public page at
// /g/:slug/:code AND the couple-side preview at /app/guest-portal. Renders
// wedding date, ceremony info, location pin, day-of schedule, and the
// household's own RSVP status. No interactive controls — every editable
// surface lives elsewhere (couple's /app/schedule, /app/profile, etc.).

import type { GuestPortalView, GuestScheduleEntry } from "@shared/guest_portal";
import type { Currency } from "@shared/types";
import type { WishlistEntry } from "@shared/wishlist";
import {
  CalendarDays,
  Camera,
  Clock,
  ExternalLink,
  Gift,
  HeartHandshake,
  Info,
  MapPin,
  Pencil,
  Plus,
  Sparkles,
  Users,
} from "lucide-react";
import type { KeyboardEvent } from "react";
import { SCHEDULE_DAY_TWO_MINUTES } from "@shared/schedule";
import { formatDate, formatMoney } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";
import { GuestWishlistCard } from "./GuestWishlistCard";
import { WeddingCountdown } from "./WeddingCountdown";

function formatHHMM(minutes: number): string {
  const safe = Math.max(0, Math.floor(minutes));
  const wall = safe % 1440;
  const h = Math.floor(wall / 60);
  const m = wall % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function googleMapsUrl(lat: number, lng: number): string {
  // Plain pin link — works in the user's default map app on mobile, opens
  // Google Maps in the browser elsewhere. We don't pass a label so the user
  // sees the raw coords (mirrors what /app/profile stores) and can reverse-
  // geocode in the map UI if they want a name.
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export function GuestPortalView({
  data,
  locale,
  isPreview = false,
  onEditCover,
  onEditDate,
  onEditSchedule,
  onEditVenue,
  onEditIntro,
  wishlist,
  currency = "HUF",
  onToggleWishlistInterest,
  coupleSlug = "",
  householdCode = "",
}: {
  data: GuestPortalView;
  locale: Locale;
  /** Couple's editor preview only — when true, empty cover/date/schedule/venue
   *  slots render gray dashed "add this" ghosts. Omitted/false on the public view. */
  isPreview?: boolean;
  /** Editor preview only — scrolls to + opens the cover dropzone/picker. */
  onEditCover?: () => void;
  /** When set (couple's editor preview only), the hero wedding date becomes a
   *  shortcut to the dashboard where the date is set. Omitted on the public view. */
  onEditDate?: () => void;
  /** When set (couple's editor preview only), the run-of-show card becomes a
   *  shortcut into the schedule editor. Omitted on the read-only public view. */
  onEditSchedule?: () => void;
  /** Same, for the venue/location card. */
  onEditVenue?: () => void;
  /** Editor preview only — the hero welcome-message ghost jumps to the intro
   *  field. */
  onEditIntro?: () => void;
  /** Confirmed-tier wishlist (from the public-wedding response). Optional — the
   *  deck renders ONLY when this is a non-empty array. The base GuestPortalView
   *  shape has no wishlist, so callers pass it alongside `data`. Null/empty/
   *  undefined → nothing renders. */
  wishlist?: WishlistEntry[] | null;
  /** Couple's display currency, used to format the optional rough target
   *  amount on each card. Defaults to HUF. */
  currency?: Currency;
  /** Live guest page only — toggles the household's soft "I'd like to help"
   *  interest on a group-gift item. Omitted on the couple-side editor preview,
   *  where the toggle is read-only (not wired). */
  onToggleWishlistInterest?: (itemId: number, pledgedAmountMinor?: number | null, notificationEmail?: string) => void;
  /** The couple's slug — passed down to GuestWishlistCard for contributor fetching. */
  coupleSlug?: string;
  /** The household's invite code — passed down to GuestWishlistCard. */
  householdCode?: string;
}) {
  const { t } = useT();
  const hasLocation = data.location_lat !== null && data.location_lng !== null;
  const ceremonyLabel = data.ceremony_kind
    ? t(`guest_portal.ceremony.${data.ceremony_kind}`)
    : null;

  // Turn a card into a click/keyboard "edit shortcut" when a handler is given.
  const editProps = (handler?: () => void) =>
    handler
      ? {
          role: "button" as const,
          tabIndex: 0,
          title: t("guest_portal.edit_section_hint"),
          onClick: handler,
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handler();
            }
          },
        }
      : {};
  const editClass = (handler?: () => void) =>
    handler
      ? " cursor-pointer transition hover:border-ink-300 hover:bg-paper-50 dark:hover:border-umber-600 dark:hover:bg-umber-800"
      : "";

  return (
    <div className="space-y-6">
      {/* Full-width cover photo at the very top, when the couple uploaded one.
       *  Mirrors the public wedding page's 16:9 hero image. */}
      {data.cover_image_url ? (
        <div className="overflow-hidden rounded-2xl border border-paper-200 dark:border-umber-700">
          <img
            src={data.cover_image_url}
            alt=""
            loading="lazy"
            className="aspect-[16/9] w-full object-cover"
          />
        </div>
      ) : isPreview ? (
        <div
          className={`flex aspect-[80/9] min-h-[120px] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-paper-300 bg-paper-50 text-center dark:border-umber-700 dark:bg-umber-800/40${
            onEditCover
              ? " cursor-pointer transition hover:border-ink-300 hover:bg-paper-100 dark:hover:border-umber-600 dark:hover:bg-umber-800"
              : ""
          }`}
          {...(onEditCover
            ? {
                role: "button" as const,
                tabIndex: 0,
                onClick: onEditCover,
                onKeyDown: (e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onEditCover();
                  }
                },
              }
            : {})}
        >
          <Camera size={28} className="text-ink-300 dark:text-umber-400" aria-hidden />
          <p className="text-sm font-medium text-ink-400 dark:text-umber-300">
            {t("guest_portal.ghost.cover_title")}
          </p>
          <p className="flex items-center gap-1 text-xs text-ink-500 dark:text-umber-200">
            <Plus size={12} aria-hidden />
            {t("guest_portal.ghost.cover_cta")}
          </p>
        </div>
      ) : null}

      {/* Hero — the two facts every guest wants first: who's getting married
       *  and on what day. Centered serif date echoes the marketing landing. */}
      <header className="rounded-2xl border border-paper-200 bg-paper-50 p-6 text-center dark:border-umber-700 dark:bg-umber-800/60">
        <h1 className="font-grotesk text-3xl text-ink-900 sm:text-4xl dark:text-paper-50">
          {data.couple_display_name}
        </h1>
        {onEditDate && data.wedding_date ? (
          <button
            type="button"
            onClick={onEditDate}
            title={t("guest_portal.edit_section_hint")}
            className="mt-2 inline-flex items-center gap-2 rounded-md px-1.5 py-0.5 text-sm text-ink-600 transition hover:bg-paper-100 hover:text-ink-800 dark:text-umber-200 dark:hover:bg-umber-700 dark:hover:text-paper-50"
          >
            <CalendarDays size={14} aria-hidden />
            {formatDate(data.wedding_date, locale)}
            <Pencil size={12} aria-hidden className="opacity-60" />
          </button>
        ) : onEditDate ? (
          <button
            type="button"
            onClick={onEditDate}
            title={t("guest_portal.edit_section_hint")}
            className="mt-2 inline-flex items-center gap-2 rounded-lg border border-dashed border-paper-300 bg-paper-50 px-3 py-1.5 text-sm text-ink-400 transition hover:border-ink-300 hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-800/40 dark:text-umber-300 dark:hover:border-umber-600"
          >
            <CalendarDays size={14} aria-hidden />
            {t("guest_portal.ghost.date_cta")}
            <Plus size={12} aria-hidden />
          </button>
        ) : data.wedding_date ? (
          <p className="mt-2 inline-flex items-center gap-2 text-sm text-ink-600 dark:text-umber-200">
            <CalendarDays size={14} aria-hidden />
            {formatDate(data.wedding_date, locale)}
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink-500 dark:text-umber-300">
            {t("guest_portal.date_tbd")}
          </p>
        )}
        {/* Welcome message — couple-authored greeting under the date. */}
        {data.guest_page_intro ? (
          <p className="mx-auto mt-4 max-w-prose whitespace-pre-line text-sm text-ink-700 dark:text-paper-100">
            {data.guest_page_intro}
          </p>
        ) : isPreview && onEditIntro ? (
          <button
            type="button"
            onClick={onEditIntro}
            title={t("guest_portal.edit_section_hint")}
            className="mx-auto mt-4 inline-flex items-center gap-1 rounded-lg border border-dashed border-paper-300 bg-paper-50 px-3 py-1.5 text-sm text-ink-400 transition hover:border-ink-300 hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-800/40 dark:text-umber-300 dark:hover:border-umber-600"
          >
            <Plus size={12} aria-hidden />
            {t("guest_portal.ghost.welcome_cta")}
          </button>
        ) : null}
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Schedule — read-only timeline of the day-of run-of-show. Empty
         *  state stays muted so the card doesn't shout when the couple
         *  hasn't filled it in yet. */}
        <section
          className={`rounded-2xl border border-paper-200 bg-white p-5 dark:border-umber-700 dark:bg-umber-800/60${editClass(onEditSchedule)}`}
          aria-labelledby="guest-portal-schedule-title"
          {...editProps(onEditSchedule)}
        >
          <div className="mb-3 flex items-center gap-2">
            <Clock size={16} className="text-ink-500 dark:text-umber-300" aria-hidden />
            <h2
              id="guest-portal-schedule-title"
              className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300"
            >
              {t("guest_portal.schedule_title")}
            </h2>
            {onEditSchedule && (
              <Pencil size={13} className="ml-auto text-ink-400 dark:text-umber-300" aria-hidden />
            )}
          </div>
          {data.schedule.length === 0 ? (
            isPreview ? (
              <GhostSlot
                icon={Clock}
                title={t("guest_portal.ghost.schedule_title")}
                cta={t("guest_portal.ghost.schedule_cta")}
              />
            ) : (
              <p className="text-sm text-ink-500 dark:text-umber-300">
                {t("guest_portal.schedule_empty")}
              </p>
            )
          ) : (
            <ol className="space-y-3">
              {data.schedule.map((ev) => (
                <ScheduleRow key={ev.id} event={ev} t={t} />
              ))}
            </ol>
          )}
        </section>

        {/* Location — map pin link + ceremony kind. Two small facts merged
         *  so the card isn't half-empty when only one is filled in. */}
        <section
          className={`rounded-2xl border border-paper-200 bg-white p-5 dark:border-umber-700 dark:bg-umber-800/60${editClass(onEditVenue)}`}
          aria-labelledby="guest-portal-location-title"
          {...editProps(onEditVenue)}
        >
          <div className="mb-3 flex items-center gap-2">
            <MapPin size={16} className="text-ink-500 dark:text-umber-300" aria-hidden />
            <h2
              id="guest-portal-location-title"
              className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300"
            >
              {t("guest_portal.location_title")}
            </h2>
            {onEditVenue && (
              <Pencil size={13} className="ml-auto text-ink-400 dark:text-umber-300" aria-hidden />
            )}
          </div>
          {hasLocation ? (
            <a
              href={googleMapsUrl(data.location_lat as number, data.location_lng as number)}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-sm text-blush-700 underline-offset-2 hover:underline dark:text-blush-300"
            >
              {t("guest_portal.location_open_map")}
            </a>
          ) : isPreview ? (
            <GhostSlot
              icon={MapPin}
              title={t("guest_portal.ghost.venue_title")}
              cta={t("guest_portal.ghost.venue_cta")}
            />
          ) : (
            <p className="text-sm text-ink-500 dark:text-umber-300">
              {t("guest_portal.location_empty")}
            </p>
          )}
          {ceremonyLabel && (
            <div className="mt-4 flex items-center gap-2 text-sm text-ink-700 dark:text-paper-100">
              <Sparkles size={14} className="text-ink-500 dark:text-umber-300" aria-hidden />
              <span className="text-ink-500 dark:text-umber-300">
                {t("guest_portal.ceremony_label")}
              </span>
              <span className="font-medium">{ceremonyLabel}</span>
            </div>
          )}
        </section>
      </div>

      {/* Household's own RSVP — small green/grey pill per member so the guest
       *  can confirm "yes the system has me down as coming". Hidden when the
       *  household is empty (shouldn't happen — the endpoint gates on
       *  yes-RSVP — but keeps the render defensive). */}
      {data.members.length > 0 && (
        <section
          className="rounded-2xl border border-paper-200 bg-white p-5 dark:border-umber-700 dark:bg-umber-800/60"
          aria-labelledby="guest-portal-household-title"
        >
          <div className="mb-3 flex items-center gap-2">
            <Users size={16} className="text-ink-500 dark:text-umber-300" aria-hidden />
            <h2
              id="guest-portal-household-title"
              className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300"
            >
              {t("guest_portal.household_title", { label: data.household_label })}
            </h2>
          </div>
          <ul className="flex flex-wrap gap-2">
            {data.members.map((m) => (
              <li
                key={m.id}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${
                  m.rsvp_status === "yes"
                    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                    : "bg-paper-100 text-ink-600 dark:bg-umber-700/40 dark:text-umber-200"
                }`}
              >
                <span className="font-medium">{m.full_name}</span>
                <span className="text-xs uppercase tracking-wide opacity-70">
                  {t(`guest_portal.rsvp.${m.rsvp_status}`)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* "Good to know" — parking, getting there, accommodation, … */}
      {data.useful_info ? (
        <section className="rounded-2xl border border-paper-200 bg-white p-5 dark:border-umber-700 dark:bg-umber-800/60">
          <div className="mb-3 flex items-center gap-2">
            <Info size={16} className="text-ink-500 dark:text-umber-300" aria-hidden />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
              {t("guest_portal.useful_info_title")}
            </h2>
          </div>
          <p className="whitespace-pre-line text-sm text-ink-700 dark:text-paper-100">
            {data.useful_info}
          </p>
        </section>
      ) : isPreview ? (
        <GhostSlot
          icon={Info}
          title={t("guest_portal.ghost.useful_info_title")}
          cta={t("guest_portal.ghost.useful_info_cta")}
        />
      ) : null}

      {/* Wishlist decks — confirmed-tier only. Renders ONLY when the caller
       *  passes a non-empty array; the base GuestPortalView shape has no
       *  wishlist, so a nullish guard keeps it absent everywhere else. Gifts
       *  and personal requests render as two separate sections. No money /
       *  payment copy anywhere — the only interaction is a soft "I'd like to
       *  help" tap (+ optional pledge) on gifts. */}
      {wishlist &&
        wishlist.length > 0 &&
        (() => {
          const gifts = wishlist.filter((e) => e.kind === "gift");
          const requests = wishlist.filter((e) => e.kind === "request");
          return (
            <>
              {gifts.length > 0 && (
                <section
                  className="rounded-2xl border border-paper-200 bg-white p-5 dark:border-umber-700 dark:bg-umber-800/60"
                  aria-labelledby="guest-portal-wishlist-title"
                >
                  <div className="mb-3 flex items-center gap-2">
                    <Gift size={16} className="text-ink-500 dark:text-umber-300" aria-hidden />
                    <h2
                      id="guest-portal-wishlist-title"
                      className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300"
                    >
                      {t("guest_portal.wishlist_section_title")}
                    </h2>
                  </div>
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {gifts.map((entry) => (
                      <GuestWishlistCard
                        key={entry.id}
                        entry={entry}
                        currency={currency}
                        locale={locale}
                        coupleSlug={coupleSlug}
                        householdCode={householdCode}
                        onToggleInterest={onToggleWishlistInterest}
                        t={t}
                      />
                    ))}
                  </ul>
                </section>
              )}
              {requests.length > 0 && (
                <section
                  className="rounded-2xl border border-paper-200 bg-white p-5 dark:border-umber-700 dark:bg-umber-800/60"
                  aria-labelledby="guest-portal-requests-title"
                >
                  <div className="mb-3 flex items-center gap-2">
                    <HeartHandshake
                      size={16}
                      className="text-ink-500 dark:text-umber-300"
                      aria-hidden
                    />
                    <h2
                      id="guest-portal-requests-title"
                      className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300"
                    >
                      {t("guest_portal.wishlist_requests_title")}
                    </h2>
                  </div>
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {requests.map((entry) => (
                      <GuestWishlistCard
                        key={entry.id}
                        entry={entry}
                        currency={currency}
                        locale={locale}
                        coupleSlug={coupleSlug}
                        householdCode={householdCode}
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

      {/* Live countdown at the very bottom of the guest page. */}
      <WeddingCountdown date={data.wedding_date} isPreview={isPreview} onEdit={onEditDate} />
    </div>
  );
}

/** Gray dashed "potential slot" placeholder shown in the couple's editor
 *  preview where a section is still empty. Clickable when `onAdd` is given;
 *  otherwise purely visual (the parent card already handles the click). */
function GhostSlot({
  icon: Icon,
  title,
  cta,
  onAdd,
}: {
  icon: typeof Clock;
  title: string;
  cta: string;
  onAdd?: () => void;
}) {
  const clickable = Boolean(onAdd);
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border border-dashed border-paper-300 bg-paper-50 p-5 dark:border-umber-700 dark:bg-umber-800/40${
        clickable
          ? " cursor-pointer transition hover:border-ink-300 hover:bg-paper-100 dark:hover:border-umber-600 dark:hover:bg-umber-800"
          : ""
      }`}
      {...(clickable
        ? {
            role: "button" as const,
            tabIndex: 0,
            onClick: onAdd,
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onAdd?.();
              }
            },
          }
        : {})}
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

function ScheduleRow({
  event,
  t,
}: {
  event: GuestScheduleEntry;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const dayTwo = event.starts_at_minutes >= SCHEDULE_DAY_TWO_MINUTES;
  const start = formatHHMM(event.starts_at_minutes);
  const end =
    event.duration_minutes && event.duration_minutes > 0
      ? formatHHMM(event.starts_at_minutes + event.duration_minutes)
      : null;
  return (
    <li className="flex gap-3">
      <div className="w-20 shrink-0 pt-0.5 text-sm tabular-nums text-ink-700 dark:text-paper-100">
        <span className="font-medium">
          {start}
          {dayTwo && (
            <sup className="ml-0.5 text-[9px] font-semibold text-ink-700 dark:text-paper-200">
              +1
            </sup>
          )}
        </span>
        {end && <span className="text-ink-400 dark:text-umber-300"> – {end}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink-900 dark:text-paper-50">{event.label}</div>
        {event.location && (
          <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-ink-500 dark:text-umber-300">
            <MapPin size={11} aria-hidden />
            {event.location}
          </div>
        )}
        {event.notes && (
          <p className="mt-1 text-xs text-ink-600 dark:text-umber-200">{event.notes}</p>
        )}
      </div>
    </li>
  );
}
