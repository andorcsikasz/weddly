// Day-of run-of-show. CRUD over the `schedule_events` table — rows are
// sorted by `starts_at_minutes`, and the page prints to a single-column A4
// PDF via `schedulePdfUrl`. Times are stored as minutes-from-midnight so a
// last-minute date shift doesn't rewrite every row.

import type { ScheduleEvent, UpsertScheduleEventInput } from "@shared/schedule";
import {
  SCHEDULE_DAY_TWO_MINUTES,
  SCHEDULE_MAX_DURATION,
  SCHEDULE_MAX_LABEL_LEN,
  SCHEDULE_MAX_LOCATION_LEN,
  SCHEDULE_MAX_NOTES_LEN,
  SCHEDULE_MIN_DURATION,
} from "@shared/schedule";
import { Clock, Download, MapPin, Pencil, Plus, Trash2, Wand2, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { InfoHint } from "../components/InfoHint";
import { Dialog, Skeleton, useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { fetchPdfBlob, scheduleApi, schedulePdfUrl } from "../lib/endpoints";
import { type Locale, useT } from "../lib/i18n";
import {
  SCHEDULE_TEMPLATE,
  buildScheduleProposal,
  localizeKnownLabel,
} from "../lib/schedule_templates";
import { useDocumentMeta } from "../lib/seo";

interface DrawerInit {
  /** Existing event being edited, or `null` for "create new". */
  event: ScheduleEvent | null;
}

/** Wedding-day clock formatter. Day-2 minutes (>= 1440) wrap back to a 0-23
 *  clock value — callers render the "next day" badge alongside. */
function formatHHMM(minutes: number): string {
  const safe = Math.max(0, Math.floor(minutes));
  const wall = safe % 1440;
  const h = Math.floor(wall / 60);
  const m = wall % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** True for any minutes value that belongs to the post-midnight half of the
 *  2-day timeline. Used to decide when to render the day-2 badge. */
function isDayTwo(minutes: number): boolean {
  return minutes >= SCHEDULE_DAY_TWO_MINUTES;
}

/** Parse a single `<input type="time">` value into wall-clock minutes
 *  (0..1439). The day-2 offset is applied separately by the caller via
 *  a checkbox or the wand's overnight detection — we never infer it
 *  from the text alone. */
function parseHHMM(text: string): number | null {
  if (!/^\d{1,2}:\d{2}$/.test(text)) return null;
  const [hRaw, mRaw] = text.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  const value = h * 60 + m;
  if (value >= SCHEDULE_DAY_TWO_MINUTES) return null;
  return value;
}

/** End of an event's booked span. Zero-duration / null events occupy a single
 *  minute, so two distinct events at the same minute still register as a
 *  collision via the `===` branch in `findConflictingEvent`. */
function eventEndMinutes(e: { starts_at_minutes: number; duration_minutes: number | null }) {
  return e.starts_at_minutes + (e.duration_minutes ?? 0);
}

/** Returns the first event that already covers `startMinutes`. Used by both
 *  the create/edit form (to reject saves on a busy slot) and the wand
 *  proposal (to skip suggesting items that would collide with an existing
 *  row). Pass the event currently being edited as `excludeId` so a no-op
 *  resave doesn't flag the row as overlapping with itself. */
function findConflictingEvent(
  startMinutes: number,
  events: ScheduleEvent[],
  excludeId: number | null,
): ScheduleEvent | null {
  for (const ev of events) {
    if (excludeId !== null && ev.id === excludeId) continue;
    const start = ev.starts_at_minutes;
    const end = eventEndMinutes(ev);
    if (end > start) {
      if (startMinutes >= start && startMinutes < end) return ev;
    } else if (startMinutes === start) {
      return ev;
    }
  }
  return null;
}

export default function SchedulePage() {
  const { t, locale } = useT();
  useDocumentMeta("seo.schedule_title", "seo.schedule_description");
  const toast = useToast();
  const confirm = useConfirm();
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<DrawerInit | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [wandOpen, setWandOpen] = useState(false);
  const [wandApplying, setWandApplying] = useState(false);

  async function refresh() {
    try {
      const r = await scheduleApi.list();
      setEvents(r.events);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onDelete(event: ScheduleEvent) {
    const ok = await confirm({
      title: t("schedule.delete_confirm_title"),
      body: t("schedule.delete_confirm_body"),
      confirmLabel: t("common.confirm_delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    const snapshot = events;
    setEvents((prev) => prev.filter((e) => e.id !== event.id));
    try {
      await scheduleApi.remove(event.id);
    } catch (e) {
      setEvents(snapshot);
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  /** Bulk-create wand picks sequentially. Mirrors PlanningPage's pattern so
   *  a mid-run failure still leaves a coherent prefix behind, and the
   *  successful rows still land in state. */
  async function onApplyWand(
    picks: { label: string; starts_at_minutes: number; duration_minutes: number | null }[],
  ): Promise<number> {
    if (picks.length === 0) return 0;
    setWandApplying(true);
    let added = 0;
    const created: ScheduleEvent[] = [];
    try {
      for (const pick of picks) {
        const r = await scheduleApi.create({
          label: pick.label,
          starts_at_minutes: pick.starts_at_minutes,
          duration_minutes: pick.duration_minutes,
        });
        created.push(r.event);
        added += 1;
      }
      setEvents((prev) => [...prev, ...created]);
      if (added > 0) {
        toast.success(t("schedule.wand_apply_done", { count: added }));
        setWandOpen(false);
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      if (created.length > 0) setEvents((prev) => [...prev, ...created]);
    } finally {
      setWandApplying(false);
    }
    return added;
  }

  async function onDownloadPdf() {
    if (downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      const blob = await fetchPdfBlob(schedulePdfUrl);
      const typed =
        blob.type === "application/pdf" ? blob : blob.slice(0, blob.size, "application/pdf");
      const url = URL.createObjectURL(typed);
      const a = document.createElement("a");
      a.href = url;
      a.download = "weddly-schedule.pdf";
      a.click();
      // Give the browser a beat to actually start the download before we
      // revoke — Safari otherwise occasionally drops the click.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error(t("common.error_generic"));
    } finally {
      setDownloadingPdf(false);
    }
  }

  const sortedEvents = useMemo(
    () =>
      [...events].sort((a, b) => {
        if (a.starts_at_minutes !== b.starts_at_minutes) {
          return a.starts_at_minutes - b.starts_at_minutes;
        }
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.id - b.id;
      }),
    [events],
  );

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="font-grotesk">{t("schedule.title")}</h1>
          <InfoHint text={t("schedule.sub")} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-outline"
            onClick={onDownloadPdf}
            disabled={downloadingPdf || sortedEvents.length === 0}
          >
            <Download size={16} />
            {t("schedule.download_pdf")}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setWandOpen(true)}
            title={t("schedule.wand_button_hint")}
          >
            <Wand2 size={16} aria-hidden="true" />
            {t("schedule.wand_button")}
          </button>
          <button type="button" className="btn-primary" onClick={() => setEditing({ event: null })}>
            <Plus size={16} />
            {t("schedule.add_event")}
          </button>
        </div>
      </header>

      {loading ? (
        <ScheduleListSkeleton />
      ) : sortedEvents.length === 0 ? (
        <div className="card stationery text-center">
          <h3 className="text-base font-semibold">{t("schedule.empty_title")}</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-600 dark:text-umber-200">
            {t("schedule.empty_body")}
          </p>
          <button
            type="button"
            className="btn-primary mt-4 inline-flex"
            onClick={() => setWandOpen(true)}
          >
            <Wand2 size={16} aria-hidden="true" />
            {t("schedule.wand_button")}
          </button>
        </div>
      ) : (
        <ul className="card divide-y divide-paper-200 p-0 dark:divide-umber-700">
          {sortedEvents.map((event) => (
            <li
              key={event.id}
              className="flex items-start gap-4 px-4 py-3 transition-colors hover:bg-paper-100/60 dark:hover:bg-umber-700"
            >
              {/* The big edit hit-area is a `<button>` so keyboard users get
                  a real Tab stop. We keep the delete action as a sibling
                  button rather than nesting inside it (nested interactive
                  controls break a11y trees + violate HTML semantics). */}
              <button
                type="button"
                onClick={() => setEditing({ event })}
                aria-label={t("schedule.edit_event")}
                className="flex min-w-0 flex-1 items-start gap-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 focus-visible:ring-offset-2"
              >
                <span className="flex min-w-[4.5rem] shrink-0 flex-col items-start gap-0.5 leading-none">
                  <span className="stat-num text-base font-semibold tabular-nums text-ink-900 dark:text-paper-50">
                    {formatHHMM(event.starts_at_minutes)}
                  </span>
                  {isDayTwo(event.starts_at_minutes) && (
                    <span className="inline-flex items-center rounded-full bg-blush-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-blush-700 dark:bg-blush-400/15 dark:text-blush-300">
                      {t("schedule.day_two_badge")}
                    </span>
                  )}
                  {event.duration_minutes !== null && event.duration_minutes > 0 && (
                    <span className="stat-num text-[11px] tabular-nums text-ink-400 dark:text-umber-300">
                      –{formatHHMM(event.starts_at_minutes + event.duration_minutes)}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink-900 dark:text-paper-50">
                    {localizeKnownLabel(event.label, locale)}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-500 dark:text-umber-300">
                    {event.duration_minutes !== null && (
                      <span className="inline-flex items-center gap-1">
                        <Clock size={12} aria-hidden="true" />
                        {t("schedule.duration_unit", { n: event.duration_minutes })}
                      </span>
                    )}
                    {event.location && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={12} aria-hidden="true" />
                        {event.location}
                      </span>
                    )}
                    {event.notes && (
                      <span className="truncate">
                        {event.notes.length > 80 ? `${event.notes.slice(0, 80)}…` : event.notes}
                      </span>
                    )}
                  </span>
                </span>
              </button>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={t("schedule.edit_event")}
                  title={t("schedule.edit_event")}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-800 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
                  onClick={() => setEditing({ event })}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  aria-label={t("schedule.delete_event")}
                  title={t("schedule.delete_event")}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-blush-700 transition-colors hover:bg-blush-100 dark:text-blush-300 dark:hover:bg-blush-400/15"
                  onClick={() => void onDelete(event)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <ScheduleEventDialog
          init={editing}
          events={events}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            setEvents((prev) => {
              const idx = prev.findIndex((e) => e.id === saved.id);
              if (idx === -1) return [...prev, saved];
              const next = prev.slice();
              next[idx] = saved;
              return next;
            });
          }}
          onConflict={async () => {
            // Server-detected concurrent edit — refetch so the form reopens
            // against the freshest copy.
            await refresh();
          }}
        />
      )}

      {wandOpen && (
        <ScheduleWandDialog
          locale={locale}
          existingEvents={events}
          applying={wandApplying}
          onClose={() => {
            if (!wandApplying) setWandOpen(false);
          }}
          onApply={onApplyWand}
        />
      )}
    </>
  );
}

function ScheduleListSkeleton() {
  const labelWidths = ["68%", "52%", "78%", "44%", "60%"];
  return (
    <ul className="card divide-y divide-paper-200 p-0 dark:divide-umber-700" aria-hidden="true">
      {labelWidths.map((w, i) => (
        <li key={i} className="flex items-start gap-4 px-4 py-3">
          <div className="flex min-w-[4.5rem] shrink-0 flex-col gap-1">
            <Skeleton variant="block" width={56} height={18} rounded="md" />
            <Skeleton variant="block" width={44} height={11} rounded="md" />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton variant="block" height={14} width={w} rounded="md" />
            <div className="flex items-center gap-3">
              <Skeleton variant="block" width={56} height={11} rounded="md" />
              <Skeleton variant="block" width={88} height={11} rounded="md" />
            </div>
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

function ScheduleEventDialog({
  init,
  events,
  onClose,
  onSaved,
  onConflict,
}: {
  init: DrawerInit;
  /** All current rows, used to reject a new start time that lands inside
   *  another event's booked window. Excludes the row being edited via its id. */
  events: ScheduleEvent[];
  onClose: () => void;
  onSaved: (event: ScheduleEvent) => void;
  onConflict: () => Promise<void>;
}) {
  const { t, locale } = useT();
  const toast = useToast();
  const existing = init.event;
  const [label, setLabel] = useState(existing?.label ?? "");
  const [time, setTime] = useState(existing ? formatHHMM(existing.starts_at_minutes) : "15:00");
  // Day-2 toggle. Stored separately from `time` (which is a wall-clock value
  // 00:00..23:59) because `<input type="time">` has no notion of which day.
  // Pre-populated from the existing row's `starts_at_minutes` so editing a
  // day-2 event opens with the box already ticked.
  const [nextDay, setNextDay] = useState<boolean>(
    existing !== null && existing.starts_at_minutes >= SCHEDULE_DAY_TWO_MINUTES,
  );
  const [duration, setDuration] = useState<string>(
    existing?.duration_minutes !== null && existing?.duration_minutes !== undefined
      ? String(existing.duration_minutes)
      : "",
  );
  const [location, setLocation] = useState(existing?.location ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setLabelError(t("schedule.label_required"));
      return;
    }
    const wallMinutes = parseHHMM(time);
    if (wallMinutes === null) {
      setTimeError(t("schedule.time_required"));
      return;
    }
    const minutes = nextDay ? wallMinutes + SCHEDULE_DAY_TWO_MINUTES : wallMinutes;
    const conflict = findConflictingEvent(minutes, events, existing?.id ?? null);
    if (conflict) {
      setTimeError(
        t("schedule.time_conflict", { label: localizeKnownLabel(conflict.label, locale) }),
      );
      return;
    }
    setLabelError(null);
    setTimeError(null);
    // Optional duration — parse to number, clamp into bounds, or leave null.
    let durationMinutes: number | null = null;
    const trimmedDuration = duration.trim();
    if (trimmedDuration !== "") {
      const parsed = Number(trimmedDuration);
      if (Number.isFinite(parsed) && parsed >= SCHEDULE_MIN_DURATION) {
        durationMinutes = Math.min(SCHEDULE_MAX_DURATION, Math.round(parsed));
      }
    }
    const body: UpsertScheduleEventInput = {
      label: trimmedLabel.slice(0, SCHEDULE_MAX_LABEL_LEN),
      starts_at_minutes: minutes,
      duration_minutes: durationMinutes,
      location: location.trim() ? location.trim().slice(0, SCHEDULE_MAX_LOCATION_LEN) : null,
      notes: notes.trim() ? notes.trim().slice(0, SCHEDULE_MAX_NOTES_LEN) : null,
    };
    setSubmitting(true);
    try {
      if (existing) {
        const r = await scheduleApi.update(existing.id, body, { ifMatch: existing.updated_at });
        onSaved(r.event);
      } else {
        const r = await scheduleApi.create(body);
        onSaved(r.event);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(t("schedule.save_conflict"));
        await onConflict();
        onClose();
        return;
      }
      toast.error(err instanceof ApiError ? err.message : t("schedule.save_failed"));
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
            {existing ? t("schedule.edit_event") : t("schedule.add_event")}
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
          <FormRow label={t("schedule.field_label")} error={labelError}>
            <input
              className={`input ${labelError ? "input-invalid" : ""}`}
              type="text"
              value={label}
              maxLength={SCHEDULE_MAX_LABEL_LEN}
              placeholder={t("schedule.field_label_placeholder")}
              onChange={(e) => {
                setLabel(e.target.value);
                if (labelError) setLabelError(null);
              }}
              aria-invalid={labelError ? true : undefined}
              autoFocus
            />
          </FormRow>

          <div className="grid grid-cols-2 gap-3">
            <FormRow label={t("schedule.field_time")} error={timeError}>
              <input
                className={`input ${timeError ? "input-invalid" : ""}`}
                type="time"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value);
                  if (timeError) setTimeError(null);
                }}
                aria-invalid={timeError ? true : undefined}
              />
            </FormRow>
            <FormRow label={t("schedule.field_duration")}>
              <input
                className="input"
                type="number"
                min={SCHEDULE_MIN_DURATION}
                max={SCHEDULE_MAX_DURATION}
                inputMode="numeric"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder={t("schedule.field_duration_placeholder")}
              />
            </FormRow>
          </div>
          <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-ink-700 dark:text-paper-100">
            <input
              type="checkbox"
              checked={nextDay}
              onChange={(e) => {
                setNextDay(e.target.checked);
                if (timeError) setTimeError(null);
              }}
              className="h-4 w-4 cursor-pointer rounded border-paper-300 text-ink-900 dark:border-umber-600"
            />
            <span>{t("schedule.field_next_day")}</span>
          </label>

          <FormRow label={t("schedule.field_location")}>
            <input
              className="input"
              type="text"
              value={location}
              maxLength={SCHEDULE_MAX_LOCATION_LEN}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={t("schedule.field_location_placeholder")}
            />
          </FormRow>

          <FormRow label={t("schedule.field_notes")}>
            <textarea
              className="input"
              rows={3}
              value={notes}
              maxLength={SCHEDULE_MAX_NOTES_LEN}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("schedule.field_notes_placeholder")}
            />
          </FormRow>
        </div>
        <div className="flex gap-2 border-t border-paper-200 px-6 py-4 dark:border-umber-700">
          <button type="button" className="btn-ghost flex-1" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={submitting}>
            {submitting ? t("schedule.saving") : t("schedule.save")}
          </button>
        </div>
      </form>
    </div>
  );
}

function FormRow({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="mb-3">
      <label className="field-label">{label}</label>
      {children}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

/** Ask for start + end, scale the canonical milestone template across that
 *  window, let the couple uncheck what they don't want, then bulk-create. */
function ScheduleWandDialog({
  locale,
  existingEvents,
  applying,
  onClose,
  onApply,
}: {
  locale: Locale;
  /** Already-saved schedule rows. Proposal entries whose start time falls
   *  inside one of these are excluded from the suggestion list. */
  existingEvents: ScheduleEvent[];
  applying: boolean;
  onClose: () => void;
  onApply: (
    picks: { label: string; starts_at_minutes: number; duration_minutes: number | null }[],
  ) => Promise<number>;
}) {
  const { t } = useT();
  const [startText, setStartText] = useState("15:00");
  const [endText, setEndText] = useState("23:00");
  // Default: nothing selected. The couple picks the milestones they actually
  // want — matches the planning task/idea wand behaviour and avoids the
  // "now uncheck 8 of 10" friction.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const startMinutes = parseHHMM(startText);
  const rawEndMinutes = parseHHMM(endText);
  // Overnight: if the user picks an end time at or before the start, treat
  // it as the small hours of the next day so the schedule scales across
  // the full party (e.g. 15:00 → 02:00 = 11h window, not "invalid").
  const overnight =
    startMinutes !== null && rawEndMinutes !== null && rawEndMinutes <= startMinutes;
  const endMinutes =
    rawEndMinutes === null || startMinutes === null
      ? rawEndMinutes
      : overnight
        ? rawEndMinutes + SCHEDULE_DAY_TWO_MINUTES
        : rawEndMinutes;
  const windowValid = startMinutes !== null && endMinutes !== null && endMinutes > startMinutes;

  const proposal = useMemo(() => {
    if (!windowValid || startMinutes === null || endMinutes === null) return [];
    return buildScheduleProposal(startMinutes, endMinutes).map((row) => ({
      ...row,
      conflictsWith: findConflictingEvent(row.starts_at_minutes, existingEvents, null),
    }));
  }, [windowValid, startMinutes, endMinutes, existingEvents]);

  const availableCount = proposal.filter((row) => row.conflictsWith === null).length;
  // "All selected" tracks the user-pickable slots only — conflicted items are
  // out of reach so they shouldn't bias the toggle's "fill / clear" affordance.
  const selectedAvailable = proposal.filter(
    (row) => row.conflictsWith === null && selected.has(row.item.key),
  ).length;
  const allSelected = availableCount > 0 && selectedAvailable === availableCount;

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function onConfirm() {
    if (!windowValid) return;
    const picks = proposal
      .filter((row) => row.conflictsWith === null && selected.has(row.item.key))
      .map((row) => ({
        label: row.item.title[locale],
        starts_at_minutes: row.starts_at_minutes,
        duration_minutes: row.duration_minutes,
      }));
    await onApply(picks);
  }

  return (
    <Dialog
      open
      title={t("schedule.wand_dialog_title")}
      role="dialog"
      closeOnBackdrop
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={applying}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={applying || !windowValid || selectedAvailable === 0}
          >
            {applying
              ? t("common.loading")
              : t("schedule.wand_apply", { count: selectedAvailable })}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-700 dark:text-paper-100">{t("schedule.wand_dialog_body")}</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="field-label">{t("schedule.wand_start_label")}</span>
            <input
              className="input"
              type="time"
              value={startText}
              onChange={(e) => setStartText(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="field-label">{t("schedule.wand_end_label")}</span>
            <div className="relative">
              <input
                className="input"
                type="time"
                value={endText}
                onChange={(e) => setEndText(e.target.value)}
              />
              {windowValid && overnight && (
                <span
                  aria-label={t("schedule.field_next_day")}
                  className="pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 select-none rounded-full bg-blush-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-blush-700 dark:bg-blush-400/20 dark:text-blush-300"
                >
                  +1
                </span>
              )}
            </div>
          </label>
        </div>
        {!windowValid && (
          <p className="rounded-lg border border-blush-300 bg-blush-50 px-3 py-2 text-xs text-blush-700 dark:border-blush-400/40 dark:bg-blush-400/15 dark:text-blush-300">
            {t("schedule.wand_window_error")}
          </p>
        )}
        {windowValid && overnight && (
          <p className="rounded-lg border border-paper-300 bg-paper-100/60 px-3 py-2 text-xs text-ink-600 dark:border-umber-700 dark:bg-umber-700/60 dark:text-umber-200">
            {t("schedule.wand_overnight_hint")}
          </p>
        )}
        {existingEvents.length > 0 && (
          <p className="rounded-lg border border-paper-300 bg-paper-100/60 px-3 py-2 text-xs text-ink-600 dark:border-umber-700 dark:bg-umber-700/60 dark:text-umber-200">
            {t("schedule.wand_warning_existing")}
          </p>
        )}
        <div className="rounded-lg border border-paper-200 bg-paper-50 p-3 dark:border-umber-700 dark:bg-umber-800">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-ink-500 dark:text-umber-300">
              {t("schedule.wand_select_label", { count: selectedAvailable, total: availableCount })}
            </p>
            <button
              type="button"
              onClick={() =>
                setSelected(
                  allSelected
                    ? new Set()
                    : new Set(
                        proposal
                          .filter((row) => row.conflictsWith === null)
                          .map((row) => row.item.key),
                      ),
                )
              }
              className="text-xs text-ink-600 underline decoration-dotted underline-offset-2 hover:text-ink-900 dark:text-umber-200 dark:hover:text-paper-50"
            >
              {allSelected ? t("schedule.wand_select_none") : t("schedule.wand_select_all")}
            </button>
          </div>
          <ul className="space-y-0.5">
            {proposal.map((row) => {
              const conflict = row.conflictsWith;
              const on = conflict === null && selected.has(row.item.key);
              return (
                <li key={row.item.key}>
                  <button
                    type="button"
                    onClick={() => toggle(row.item.key)}
                    aria-pressed={on}
                    disabled={conflict !== null}
                    className={`flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                      conflict !== null
                        ? "cursor-not-allowed text-ink-300 dark:text-umber-300"
                        : on
                          ? "bg-paper-100 text-ink-900 hover:bg-paper-200 dark:bg-umber-700/60 dark:text-paper-50 dark:hover:bg-umber-700"
                          : "text-ink-400 hover:bg-paper-100 hover:text-ink-600 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
                    }`}
                  >
                    <span className="flex min-w-[5rem] shrink-0 flex-col items-start gap-0.5 leading-none tabular-nums">
                      <span>{formatHHMM(row.starts_at_minutes)}</span>
                      {isDayTwo(row.starts_at_minutes) && (
                        <span className="inline-flex items-center rounded-full bg-blush-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-blush-700 dark:bg-blush-400/15 dark:text-blush-300">
                          {t("schedule.day_two_badge")}
                        </span>
                      )}
                    </span>
                    {/* Title + (conflict-badge OR duration) stacked in one
                     *  flex-1 column with min-w-0 so the title can shrink and
                     *  the conflict pill never overflows the dialog edge. */}
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span>{row.item.title[locale]}</span>
                      {conflict !== null ? (
                        <span
                          className="inline-flex w-fit max-w-full rounded-full bg-paper-200 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-500 dark:bg-umber-700 dark:text-umber-300"
                          title={localizeKnownLabel(conflict.label, locale)}
                        >
                          <span className="truncate">{t("schedule.wand_item_conflict")}</span>
                        </span>
                      ) : (
                        row.duration_minutes !== null &&
                        on && (
                          <span className="text-xs text-ink-500 dark:text-umber-300">
                            {t("schedule.duration_unit", { n: row.duration_minutes })}
                          </span>
                        )
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}
