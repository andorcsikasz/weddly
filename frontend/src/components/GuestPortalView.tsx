// Read-only "for guests" surface — the same JSX used by the public page at
// /g/:slug/:code AND the couple-side preview at /app/guest-portal. Renders
// wedding date, ceremony info, location pin, day-of schedule, and the
// household's own RSVP status. No interactive controls — every editable
// surface lives elsewhere (couple's /app/schedule, /app/profile, etc.).

import type { GuestPortalView, GuestScheduleEntry } from "@shared/guest_portal";
import { CalendarDays, Clock, MapPin, Sparkles, Users } from "lucide-react";
import { SCHEDULE_DAY_TWO_MINUTES } from "@shared/schedule";
import { formatDate } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";

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

export function GuestPortalView({ data, locale }: { data: GuestPortalView; locale: Locale }) {
  const { t } = useT();
  const hasLocation = data.location_lat !== null && data.location_lng !== null;
  const ceremonyLabel = data.ceremony_kind
    ? t(`guest_portal.ceremony.${data.ceremony_kind}`)
    : null;

  return (
    <div className="space-y-6">
      {/* Full-width cover photo at the very top, when the couple uploaded one.
       *  Mirrors the public wedding page's 16:9 hero image. */}
      {data.cover_image_url && (
        <div className="overflow-hidden rounded-2xl border border-paper-200 dark:border-umber-700">
          <img
            src={data.cover_image_url}
            alt=""
            loading="lazy"
            className="aspect-[16/9] w-full object-cover"
          />
        </div>
      )}

      {/* Hero — the two facts every guest wants first: who's getting married
       *  and on what day. Centered serif date echoes the marketing landing. */}
      <header className="rounded-2xl border border-paper-200 bg-paper-50 p-6 text-center dark:border-umber-700 dark:bg-umber-800/60">
        <h1 className="font-serif text-3xl text-ink-900 sm:text-4xl dark:text-paper-50">
          {data.couple_display_name}
        </h1>
        {data.wedding_date ? (
          <p className="mt-2 inline-flex items-center gap-2 text-sm text-ink-600 dark:text-umber-200">
            <CalendarDays size={14} aria-hidden />
            {formatDate(data.wedding_date, locale)}
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink-500 dark:text-umber-300">
            {t("guest_portal.date_tbd")}
          </p>
        )}
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Schedule — read-only timeline of the day-of run-of-show. Empty
         *  state stays muted so the card doesn't shout when the couple
         *  hasn't filled it in yet. */}
        <section
          className="rounded-2xl border border-paper-200 bg-white p-5 dark:border-umber-700 dark:bg-umber-800/60"
          aria-labelledby="guest-portal-schedule-title"
        >
          <div className="mb-3 flex items-center gap-2">
            <Clock size={16} className="text-ink-500 dark:text-umber-300" aria-hidden />
            <h2
              id="guest-portal-schedule-title"
              className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300"
            >
              {t("guest_portal.schedule_title")}
            </h2>
          </div>
          {data.schedule.length === 0 ? (
            <p className="text-sm text-ink-500 dark:text-umber-300">
              {t("guest_portal.schedule_empty")}
            </p>
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
          className="rounded-2xl border border-paper-200 bg-white p-5 dark:border-umber-700 dark:bg-umber-800/60"
          aria-labelledby="guest-portal-location-title"
        >
          <div className="mb-3 flex items-center gap-2">
            <MapPin size={16} className="text-ink-500 dark:text-umber-300" aria-hidden />
            <h2
              id="guest-portal-location-title"
              className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300"
            >
              {t("guest_portal.location_title")}
            </h2>
          </div>
          {hasLocation ? (
            <a
              href={googleMapsUrl(data.location_lat as number, data.location_lng as number)}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-sm text-blush-700 underline-offset-2 hover:underline dark:text-blush-300"
            >
              {t("guest_portal.location_open_map")}
            </a>
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
        <span className="font-medium">{start}</span>
        {end && <span className="text-ink-400 dark:text-umber-300"> – {end}</span>}
        {dayTwo && (
          <span className="ml-1 rounded-full bg-blush-50 px-1.5 py-0.5 text-[10px] font-medium text-blush-700 dark:bg-blush-400/15 dark:text-blush-300">
            {t("guest_portal.schedule_next_day")}
          </span>
        )}
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
