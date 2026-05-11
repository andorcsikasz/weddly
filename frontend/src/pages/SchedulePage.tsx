// Day-of run-of-show. CRUD over the `schedule_events` table — rows are
// sorted by `starts_at_minutes`, and the page prints to a single-column A4
// PDF via `schedulePdfUrl`. Times are stored as minutes-from-midnight so a
// last-minute date shift doesn't rewrite every row.

import type { ScheduleEvent, UpsertScheduleEventInput } from "@shared/schedule";
import {
  SCHEDULE_MAX_DURATION,
  SCHEDULE_MAX_LABEL_LEN,
  SCHEDULE_MAX_LOCATION_LEN,
  SCHEDULE_MAX_MINUTES,
  SCHEDULE_MAX_NOTES_LEN,
  SCHEDULE_MIN_DURATION,
} from "@shared/schedule";
import { Clock, Download, MapPin, Pencil, Plus, Trash2, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { fetchPdfBlob, scheduleApi, schedulePdfUrl } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

interface DrawerInit {
  /** Existing event being edited, or `null` for "create new". */
  event: ScheduleEvent | null;
}

/** Default starter timeline — appears as a one-click bootstrap on the empty
 *  state. Times chosen to mirror a typical HU civil-ceremony day. */
interface StarterRow {
  labelKey:
    | "schedule.starter_arrival"
    | "schedule.starter_ceremony"
    | "schedule.starter_group_photo"
    | "schedule.starter_dinner"
    | "schedule.starter_first_dance";
  minutes: number;
}

const STARTER_ROWS: StarterRow[] = [
  { labelKey: "schedule.starter_arrival", minutes: 15 * 60 },
  { labelKey: "schedule.starter_ceremony", minutes: 15 * 60 + 30 },
  { labelKey: "schedule.starter_group_photo", minutes: 16 * 60 + 30 },
  { labelKey: "schedule.starter_dinner", minutes: 19 * 60 },
  { labelKey: "schedule.starter_first_dance", minutes: 21 * 60 },
];

function formatHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseHHMM(text: string): number | null {
  if (!/^\d{1,2}:\d{2}$/.test(text)) return null;
  const [hRaw, mRaw] = text.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  const value = h * 60 + m;
  if (value > SCHEDULE_MAX_MINUTES) return null;
  return value;
}

export default function SchedulePage() {
  const { t } = useT();
  useDocumentMeta("seo.schedule_title", "seo.schedule_description");
  const toast = useToast();
  const confirm = useConfirm();
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<DrawerInit | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [seedingStarter, setSeedingStarter] = useState(false);

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

  async function onSeedStarter() {
    setSeedingStarter(true);
    try {
      // Create sequentially so a partial failure leaves a coherent prefix
      // behind instead of N parallel rows in indeterminate order.
      for (const row of STARTER_ROWS) {
        await scheduleApi.create({
          label: t(row.labelKey),
          starts_at_minutes: row.minutes,
        });
      }
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      // Refresh so any partial-success rows are reflected.
      await refresh();
    } finally {
      setSeedingStarter(false);
    }
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
    <AppShell>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>{t("schedule.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">{t("schedule.sub")}</p>
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
          <button type="button" className="btn-primary" onClick={() => setEditing({ event: null })}>
            <Plus size={16} />
            {t("schedule.add_event")}
          </button>
        </div>
      </header>

      {loading ? (
        <p className="card text-sm text-ink-500">{t("common.loading")}</p>
      ) : sortedEvents.length === 0 ? (
        <div className="card stationery text-center">
          <h3 className="text-base font-semibold">{t("schedule.empty_title")}</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-600">{t("schedule.empty_body")}</p>
          <button
            type="button"
            className="btn-primary mt-4 inline-flex"
            onClick={onSeedStarter}
            disabled={seedingStarter}
          >
            {seedingStarter ? t("schedule.saving") : t("schedule.starter_button")}
          </button>
        </div>
      ) : (
        <ul className="card divide-y divide-paper-200 p-0">
          {sortedEvents.map((event) => (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => setEditing({ event })}
                className="flex w-full items-start gap-4 px-4 py-3 text-left transition-colors hover:bg-paper-100/60 focus:outline-none focus-visible:bg-paper-100"
              >
                <span className="stat-num min-w-[4.5rem] shrink-0 text-base font-semibold tabular-nums text-ink-900">
                  {formatHHMM(event.starts_at_minutes)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink-900">{event.label}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-500">
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
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  <span
                    aria-label={t("schedule.edit_event")}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-900"
                  >
                    <Pencil size={14} />
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={t("schedule.delete_event")}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-blush-700 transition-colors hover:bg-blush-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onDelete(event);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        void onDelete(event);
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <ScheduleEventDialog
          init={editing}
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
    </AppShell>
  );
}

function ScheduleEventDialog({
  init,
  onClose,
  onSaved,
  onConflict,
}: {
  init: DrawerInit;
  onClose: () => void;
  onSaved: (event: ScheduleEvent) => void;
  onConflict: () => Promise<void>;
}) {
  const { t } = useT();
  const toast = useToast();
  const existing = init.event;
  const [label, setLabel] = useState(existing?.label ?? "");
  const [time, setTime] = useState(existing ? formatHHMM(existing.starts_at_minutes) : "15:00");
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
    const minutes = parseHHMM(time);
    if (minutes === null) {
      setTimeError(t("schedule.time_required"));
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
        className="flex w-full max-w-lg max-h-[85vh] flex-col overflow-hidden rounded-2xl bg-paper-50 shadow-pop"
        onSubmit={onSubmit}
      >
        <div className="flex items-center justify-between border-b border-paper-200 px-6 py-4">
          <h2 className="text-base font-semibold text-ink-900">
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
        <div className="flex gap-2 border-t border-paper-200 px-6 py-4">
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
