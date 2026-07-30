// Munkarend: the vendor's recurring weekly working hours, plus the dated
// exceptions that sit on top of them. Fifth tab of the settings hub.
//
// Layout follows Calendly's availability screen because vendors already know
// it: a named schedule, then one row per weekday with a circular day toggle, a
// from-to pair per working block, and two per-row actions (add another block,
// copy this day onto other days). Dated exceptions get their own block below.
//
// Two things this screen writes, and they are NOT the same layer:
//   * the weekly schedule (PUT .../pattern) is the recurring default, and its
//     derived weekday set is what couples see on the public busy calendar;
//   * an exception (POST/DELETE .../me) is one date, in either direction:
//     "not working after all" or "working even though this weekday is off".
//
// Blocking is PRO, and so is this: a FREE vendor gets the read-only view with
// the upgrade path instead of a form whose writes would 402.

import { CalendarOff, CalendarPlus, CalendarSync, Check, Copy, Lock, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { hourLabel, type VendorAvailabilityView } from "@shared/listings";
import type { GoogleCalendarStatus } from "@shared/types";
import {
  ALL_WEEKDAYS,
  DAY_MINUTES,
  DEFAULT_WORK_END,
  DEFAULT_WORK_START,
  emptyWeeklyHours,
  MAX_INTERVALS_PER_DAY,
  MAX_SCHEDULE_NAME_LEN,
  minutesToLabel,
  normalizeIntervals,
  SLOT_MINUTES,
  type Weekday,
  type WeeklyHours,
  type WorkInterval,
} from "@shared/vendor_availability";
import { GoogleCalendarConnect } from "../../components/GoogleCalendarConnect";
import { DateField, Dialog, SegmentedControl, useConfirm, useToast } from "../../components/ui";
import { intlLocale } from "../../lib/format";
import {
  vendorAvailabilityApi,
  vendorBillingApi,
  vendorGoogleCalendarApi,
  type VendorGoogleCalendarChoice,
} from "../../lib/endpoints";
import { type Locale, useT } from "../../lib/i18n";

/** Every half hour of the day as select options. 24:00 is offered as an END
 *  only, so a block can run to midnight without a second date. */
const START_OPTIONS = Array.from(
  { length: DAY_MINUTES / SLOT_MINUTES },
  (_, i) => i * SLOT_MINUTES,
);
const END_OPTIONS = Array.from(
  { length: DAY_MINUTES / SLOT_MINUTES },
  (_, i) => (i + 1) * SLOT_MINUTES,
);

function cloneHours(hours: WeeklyHours): WeeklyHours {
  const out = emptyWeeklyHours();
  for (const d of ALL_WEEKDAYS) out[d] = hours[d].map((iv) => ({ ...iv }));
  return out;
}

function sameHours(a: WeeklyHours, b: WeeklyHours): boolean {
  return ALL_WEEKDAYS.every(
    (d) =>
      a[d].length === b[d].length &&
      a[d].every((iv, i) => {
        const other = b[d][i];
        return (
          other !== undefined && iv.start_min === other.start_min && iv.end_min === other.end_min
        );
      }),
  );
}

/** Where a new block starts on a day that already has one: after the last one,
 *  or the default window on an empty day. Nudged rather than stacked on top,
 *  so "add" never produces a block that normalizing would immediately merge. */
function nextInterval(existing: readonly WorkInterval[]): WorkInterval {
  const last = existing[existing.length - 1];
  if (!last) return { start_min: DEFAULT_WORK_START, end_min: DEFAULT_WORK_END };
  const start = Math.min(last.end_min + SLOT_MINUTES, DAY_MINUTES - SLOT_MINUTES);
  return { start_min: start, end_min: Math.min(start + 2 * 60, DAY_MINUTES) };
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(iso: string, locale: Locale): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  }).format(d);
}

// ── one from-to pair ────────────────────────────────────────────────────────

function IntervalRow({
  interval,
  disabled,
  onChange,
  onRemove,
}: {
  interval: WorkInterval;
  disabled: boolean;
  onChange: (next: WorkInterval) => void;
  onRemove: () => void;
}) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-2">
      <select
        className="input h-9 w-[5.75rem] py-0 text-sm"
        aria-label={t("vendor.schedule.from")}
        disabled={disabled}
        value={interval.start_min}
        onChange={(e) => {
          const start = Number(e.target.value);
          onChange({
            start_min: start,
            end_min:
              interval.end_min > start
                ? interval.end_min
                : Math.min(start + SLOT_MINUTES, DAY_MINUTES),
          });
        }}
      >
        {START_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {minutesToLabel(m)}
          </option>
        ))}
      </select>
      <span aria-hidden="true" className="text-umber-400">
        -
      </span>
      <select
        className="input h-9 w-[5.75rem] py-0 text-sm"
        aria-label={t("vendor.schedule.to")}
        disabled={disabled}
        value={interval.end_min}
        onChange={(e) => onChange({ ...interval, end_min: Number(e.target.value) })}
      >
        {END_OPTIONS.filter((m) => m > interval.start_min).map((m) => (
          <option key={m} value={m}>
            {minutesToLabel(m)}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={t("vendor.schedule.remove_interval")}
        title={t("vendor.schedule.remove_interval")}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-paper-100 hover:text-ink-700 disabled:opacity-40 dark:text-umber-400 dark:hover:bg-umber-800 dark:hover:text-paper-100"
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

// ── copy-to-other-days popover ──────────────────────────────────────────────

function CopyMenu({
  from,
  dayLabels,
  onApply,
  onClose,
}: {
  from: Weekday;
  dayLabels: Record<Weekday, string>;
  onApply: (targets: Weekday[]) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [targets, setTargets] = useState<Weekday[]>([]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-9 z-20 w-52 rounded-xl border border-paper-200 bg-white p-2 shadow-lg dark:border-umber-700 dark:bg-umber-900"
    >
      <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-umber-400">
        {t("vendor.schedule.copy_title")}
      </p>
      <div className="max-h-56 overflow-y-auto">
        {ALL_WEEKDAYS.filter((d) => d !== from).map((d) => {
          const checked = targets.includes(d);
          return (
            <label
              key={d}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-700 hover:bg-paper-100 dark:text-paper-200 dark:hover:bg-umber-800"
            >
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-paper-400 accent-blush-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blush-600 dark:border-umber-600"
                checked={checked}
                onChange={() =>
                  setTargets((prev) => (checked ? prev.filter((x) => x !== d) : [...prev, d]))
                }
              />
              {dayLabels[d]}
            </label>
          );
        })}
      </div>
      <button
        type="button"
        disabled={targets.length === 0}
        onClick={() => onApply(targets)}
        className="btn btn-sm mt-1 w-full bg-blush-500 text-white hover:bg-blush-600 disabled:opacity-40"
      >
        {t("vendor.schedule.copy_apply")}
      </button>
    </div>
  );
}

// ── one weekday row ─────────────────────────────────────────────────────────

function DayRow({
  day,
  label,
  intervals,
  disabled,
  dayLabels,
  onToggle,
  onChange,
  onCopy,
}: {
  day: Weekday;
  label: string;
  intervals: WorkInterval[];
  disabled: boolean;
  dayLabels: Record<Weekday, string>;
  onToggle: () => void;
  onChange: (next: WorkInterval[]) => void;
  onCopy: (targets: Weekday[]) => void;
}) {
  const { t } = useT();
  const [copyOpen, setCopyOpen] = useState(false);
  const working = intervals.length > 0;

  return (
    <div className="flex items-start gap-3 border-b border-paper-100 py-3 last:border-b-0 dark:border-umber-800">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={working}
        title={working ? t("vendor.schedule.day_off_action") : t("vendor.schedule.day_on_action")}
        className={`mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold uppercase tracking-wide transition-colors disabled:opacity-50 ${
          working
            ? "border-blush-500 bg-blush-500 text-white hover:bg-blush-600"
            : "border-paper-300 text-ink-400 hover:border-ink-400 hover:text-ink-600 dark:border-umber-700 dark:text-umber-400 dark:hover:text-paper-200"
        }`}
      >
        {label}
      </button>

      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        {working ? (
          intervals.map((iv, i) => (
            <IntervalRow
              // Index-keyed on purpose: an interval has no id, and the list is
              // edited in place (a from-to change must not remount the row and
              // drop focus mid-select).
              key={`${day}-${i}`}
              interval={iv}
              disabled={disabled}
              onChange={(next) => onChange(intervals.map((old, j) => (j === i ? next : old)))}
              onRemove={() => onChange(intervals.filter((_, j) => j !== i))}
            />
          ))
        ) : (
          <button
            type="button"
            onClick={onToggle}
            disabled={disabled}
            aria-label={t("vendor.schedule.add_day", { day: label })}
            title={t("vendor.schedule.add_day", { day: label })}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-paper-300 text-ink-400 transition-colors hover:border-ink-400 hover:text-ink-700 disabled:opacity-40 dark:border-umber-700 dark:text-umber-400 dark:hover:text-paper-100"
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {working && (
        <div className="relative flex shrink-0 items-center gap-1 pt-0.5">
          <button
            type="button"
            disabled={disabled || intervals.length >= MAX_INTERVALS_PER_DAY}
            onClick={() => onChange([...intervals, nextInterval(intervals)])}
            aria-label={t("vendor.schedule.add_interval")}
            title={t("vendor.schedule.add_interval")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-100 hover:text-ink-800 disabled:opacity-30 dark:text-umber-300 dark:hover:bg-umber-800 dark:hover:text-paper-100"
          >
            <Plus size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setCopyOpen((o) => !o)}
            aria-label={t("vendor.schedule.copy_to")}
            title={t("vendor.schedule.copy_to")}
            aria-expanded={copyOpen}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-100 hover:text-ink-800 disabled:opacity-30 dark:text-umber-300 dark:hover:bg-umber-800 dark:hover:text-paper-100"
          >
            <Copy size={15} aria-hidden="true" />
          </button>
          {copyOpen && (
            <CopyMenu
              from={day}
              dayLabels={dayLabels}
              onClose={() => setCopyOpen(false)}
              onApply={(targets) => {
                setCopyOpen(false);
                onCopy(targets);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── exception editor ────────────────────────────────────────────────────────

type ExceptionKind = "off" | "on";
type OffMode = "all_day" | "hours";

function ExceptionDialog({
  busy,
  onSave,
  onClose,
}: {
  busy: boolean;
  onSave: (date: string, kind: ExceptionKind, hours: number[] | null) => void;
  onClose: () => void;
}) {
  const { t, locale } = useT();
  const [date, setDate] = useState("");
  const [kind, setKind] = useState<ExceptionKind>("off");
  const [mode, setMode] = useState<OffMode>("all_day");
  const [start, setStart] = useState(9);
  const [end, setEnd] = useState(17);

  const valid = date !== "" && (kind === "on" || mode === "all_day" || end > start);

  return (
    <Dialog
      open
      role="dialog"
      closeOnBackdrop
      title={t("vendor.schedule.exception_add")}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn border border-paper-300 dark:border-umber-700"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={busy || !valid}
            onClick={() => {
              if (!valid) return;
              const hours =
                kind === "off" && mode === "hours"
                  ? Array.from({ length: end - start }, (_, i) => start + i)
                  : null;
              onSave(date, kind, hours);
            }}
            className="btn bg-blush-500 text-white hover:bg-blush-600 disabled:opacity-50"
          >
            {t("common.save")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <DateField
          label={t("vendor.schedule.exception_date")}
          value={date}
          onChange={setDate}
          locale={locale}
          min={todayIso()}
        />
        <div className="flex justify-center">
          <SegmentedControl
            ariaLabel={t("vendor.schedule.exception_kind_label")}
            value={kind}
            onChange={setKind}
            options={[
              { value: "off" as const, label: t("vendor.schedule.exception_kind_off") },
              { value: "on" as const, label: t("vendor.schedule.exception_kind_on") },
            ]}
          />
        </div>

        {kind === "off" ? (
          <div className="space-y-3">
            <div className="flex justify-center">
              <SegmentedControl
                ariaLabel={t("vendor.schedule.exception_scope_label")}
                value={mode}
                onChange={setMode}
                options={[
                  { value: "all_day" as const, label: t("vendor.schedule.exception_all_day") },
                  { value: "hours" as const, label: t("vendor.schedule.exception_hours") },
                ]}
              />
            </div>
            {mode === "hours" && (
              <div className="flex items-end gap-2">
                <label className="block min-w-0 flex-1">
                  <span className="field-label">{t("vendor.schedule.from")}</span>
                  <select
                    className="input"
                    value={start}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setStart(v);
                      if (end <= v) setEnd(Math.min(v + 1, 24));
                    }}
                  >
                    {Array.from({ length: 24 }, (_, h) => h).map((h) => (
                      <option key={h} value={h}>
                        {hourLabel(h)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block min-w-0 flex-1">
                  <span className="field-label">{t("vendor.schedule.to")}</span>
                  <select
                    className="input"
                    value={end}
                    onChange={(e) => setEnd(Number(e.target.value))}
                  >
                    {Array.from({ length: 24 }, (_, h) => h + 1)
                      .filter((h) => h > start)
                      .map((h) => (
                        <option key={h} value={h}>
                          {hourLabel(h)}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-600 dark:text-umber-200">
            {t("vendor.schedule.exception_on_hint")}
          </p>
        )}
      </div>
    </Dialog>
  );
}

// ── Google Calendar, both directions ────────────────────────────────────────

/** The pull half's controls. The connect/sync/disconnect pill is the shared
 *  component both aggregates use; what is local here is the calendar picker,
 *  which only the vendor flow has, and the sentence that says what Weddly reads.
 *
 *  It lives on THIS tab rather than in a generic "integrations" screen because
 *  the only thing the integration changes is availability, and this is the page
 *  that owns availability. */
function GoogleCalendarSection() {
  const { t, locale } = useT();
  const toast = useToast();
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [calendars, setCalendars] = useState<VendorGoogleCalendarChoice[] | null>(null);
  const [pullEnabled, setPullEnabled] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [listFailed, setListFailed] = useState(false);

  const loadStatus = useCallback(() => {
    vendorGoogleCalendarApi
      .status()
      .then(setStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const connected = status?.connected === true;

  useEffect(() => {
    if (!connected) {
      setCalendars(null);
      return;
    }
    setListFailed(false);
    vendorGoogleCalendarApi
      .calendars()
      .then((r) => {
        setCalendars(r.calendars);
        setPullEnabled(r.pull_enabled);
        setSelected(r.calendars.filter((c) => c.selected).map((c) => c.id));
      })
      .catch(() => setListFailed(true));
  }, [connected]);

  async function save(nextIds: string[], nextPull: boolean) {
    setBusy(true);
    try {
      const fresh = await vendorGoogleCalendarApi.saveCalendars({
        calendar_ids: nextIds,
        pull_enabled: nextPull,
      });
      setStatus(fresh);
      setSelected(nextIds);
      setPullEnabled(nextPull);
      toast.success(t("vendor.schedule.gcal_saved"));
    } catch {
      toast.error(t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  // Hidden entirely until the operator has configured the integration, the same
  // rule the connect pill follows: an unconfigured deploy shows no dead
  // affordance.
  if (!status || !status.configured) return null;

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-grotesk text-base font-semibold tracking-tight text-ink-900 dark:text-paper-50">
          <CalendarSync
            size={18}
            strokeWidth={1.5}
            aria-hidden="true"
            className="shrink-0 text-steel-600 dark:text-steel-300"
          />
          {t("vendor.schedule.gcal_title")}
        </h2>
        <GoogleCalendarConnect api={vendorGoogleCalendarApi} keyPrefix="vendor_calendar" />
      </div>
      <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">
        {t("vendor.schedule.gcal_body")}
      </p>

      {connected && (
        <>
          <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm text-ink-700 dark:text-paper-200">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-paper-400 accent-blush-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blush-600 dark:border-umber-600"
              checked={pullEnabled}
              disabled={busy}
              onChange={(e) => void save(selected, e.target.checked)}
            />
            <span>
              {t("vendor.schedule.gcal_pull_label")}
              <span className="mt-0.5 block text-xs text-ink-500 dark:text-umber-300">
                {t("vendor.schedule.gcal_privacy")}
              </span>
            </span>
          </label>

          {listFailed ? (
            <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
              {t("vendor.schedule.gcal_list_failed")}
            </p>
          ) : (
            calendars !== null && (
              <ul className="mt-3 space-y-1.5">
                {calendars.map((c) => {
                  const on = selected.includes(c.id);
                  return (
                    <li key={c.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-2.5 text-sm ${
                          pullEnabled
                            ? "text-ink-700 dark:text-paper-200"
                            : "text-ink-400 dark:text-umber-400"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-paper-400 accent-blush-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blush-600 dark:border-umber-600"
                          checked={on}
                          disabled={busy || !pullEnabled}
                          onChange={() =>
                            void save(
                              on ? selected.filter((x) => x !== c.id) : [...selected, c.id],
                              pullEnabled,
                            )
                          }
                        />
                        <span className="truncate">{c.summary}</span>
                        {c.primary && (
                          <span className="shrink-0 rounded-md bg-paper-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-600 dark:bg-umber-800 dark:text-umber-300">
                            {t("vendor.schedule.gcal_primary")}
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )
          )}

          <p className="mt-3 text-xs text-ink-500 dark:text-umber-300">
            {status.busySyncedAt
              ? t("vendor.schedule.gcal_last_pull", {
                  when: new Intl.DateTimeFormat(intlLocale(locale), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(status.busySyncedAt)),
                  count: status.externalBusyCount,
                })
              : t("vendor.schedule.gcal_never_pulled")}
          </p>
        </>
      )}
    </section>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

export default function VendorSettingsSchedule() {
  const { t, locale } = useT();
  const toast = useToast();
  const confirm = useConfirm();

  const [hours, setHours] = useState<WeeklyHours>(() => emptyWeeklyHours());
  const [savedHours, setSavedHours] = useState<WeeklyHours>(() => emptyWeeklyHours());
  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const [availability, setAvailability] = useState<VendorAvailabilityView | null>(null);
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [exceptionBusy, setExceptionBusy] = useState(false);
  const [canEdit, setCanEdit] = useState(true);

  useEffect(() => {
    vendorAvailabilityApi
      .schedule()
      .then((s) => {
        setHours(cloneHours(s.working_hours));
        setSavedHours(cloneHours(s.working_hours));
        setName(s.schedule_name);
        setSavedName(s.schedule_name);
        setLoaded(true);
      })
      .catch(() => setLoadFailed(true));
    vendorAvailabilityApi
      .me()
      .then(setAvailability)
      .catch(() => {});
    vendorBillingApi
      .get()
      .then((r) => setCanEdit(r.features.calendar_availability))
      .catch(() => {
        /* keep the optimistic default; a FREE vendor's write would 402 anyway */
      });
  }, []);

  const dayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(intlLocale(locale), { weekday: "short" });
    // 2024-01-01 was a Monday, so index i lands on ISO weekday i+1.
    const out = {} as Record<Weekday, string>;
    for (const d of ALL_WEEKDAYS) out[d] = fmt.format(new Date(2024, 0, d));
    return out;
  }, [locale]);

  const dirty = !sameHours(hours, savedHours) || name.trim() !== savedName;
  const anyWorkingDay = ALL_WEEKDAYS.some((d) => hours[d].length > 0);
  const editable = canEdit && loaded && !loadFailed && !saving;

  const setDay = useCallback((day: Weekday, next: WorkInterval[]) => {
    setHours((prev) => {
      const out = cloneHours(prev);
      out[day] = next;
      return out;
    });
  }, []);

  async function save() {
    if (!anyWorkingDay) return;
    setSaving(true);
    try {
      // Normalize before sending so what the vendor sees after saving is what
      // the server stored (merged and sorted), not the raw edit order.
      const payload = emptyWeeklyHours();
      for (const d of ALL_WEEKDAYS) payload[d] = normalizeIntervals(hours[d]);
      const saved = await vendorAvailabilityApi.saveSchedule({
        working_hours: payload,
        schedule_name: name.trim(),
      });
      setHours(cloneHours(saved.working_hours));
      setSavedHours(cloneHours(saved.working_hours));
      setName(saved.schedule_name);
      setSavedName(saved.schedule_name);
      toast.success(t("vendor.schedule.saved"));
    } catch {
      toast.error(t("vendor.schedule.save_failed"));
    } finally {
      setSaving(false);
    }
  }

  async function addException(date: string, kind: ExceptionKind, hourList: number[] | null) {
    setExceptionBusy(true);
    try {
      const view =
        kind === "on"
          ? await vendorAvailabilityApi.open(date)
          : await vendorAvailabilityApi.block(date, hourList);
      setAvailability(view);
      setExceptionOpen(false);
      toast.success(t("vendor.schedule.exception_saved"));
    } catch {
      toast.error(t("vendor.schedule.exception_failed"));
    } finally {
      setExceptionBusy(false);
    }
  }

  async function removeException(date: string) {
    const ok = await confirm({
      title: t("vendor.schedule.exception_remove_title"),
      body: t("vendor.schedule.exception_remove_body", { date: formatDate(date, locale) }),
      confirmLabel: t("common.confirm_delete"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    try {
      setAvailability(await vendorAvailabilityApi.unblock(date));
      toast.success(t("vendor.schedule.exception_removed"));
    } catch {
      toast.error(t("vendor.schedule.exception_failed"));
    }
  }

  // Both directions in one dated list, earliest first: this is the only screen
  // that shows an "exceptionally working" day at all.
  const exceptions = useMemo(() => {
    const rows: Array<{ date: string; kind: ExceptionKind; hours: number[] | null }> = [];
    for (const bd of availability?.blocked_days ?? []) {
      rows.push({ date: bd.date, kind: "off", hours: bd.hours });
    }
    for (const d of availability?.open_dates ?? []) {
      rows.push({ date: d, kind: "on", hours: null });
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }, [availability]);

  if (loadFailed) {
    return (
      <p className="mt-8 text-sm text-ink-600 dark:text-umber-200">
        {t("vendor_calendar.availability_no_listing")}
      </p>
    );
  }

  if (!loaded) {
    return (
      <div
        aria-hidden="true"
        className="mt-8 h-64 animate-pulse rounded-2xl bg-paper-200 dark:bg-umber-800"
      />
    );
  }

  return (
    <div className="mt-8 space-y-6">
      {!canEdit && (
        <section className="card flex flex-col gap-3 p-4">
          <div className="flex items-start gap-2.5">
            <Lock
              size={18}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-ink-400 dark:text-paper-500"
            />
            <p className="text-sm text-ink-600 dark:text-umber-200">
              {t("vendor_calendar.availability_locked")}
            </p>
          </div>
          <Link
            to="/vendor/settings/billing"
            className="btn w-fit bg-blush-500 text-white hover:bg-blush-600"
          >
            {t("vendor.upgrade.cta")}
          </Link>
        </section>
      )}

      {/* Weekly schedule */}
      <section className="card p-5">
        <input
          type="text"
          value={name}
          disabled={!editable}
          maxLength={MAX_SCHEDULE_NAME_LEN}
          onChange={(e) => setName(e.target.value)}
          aria-label={t("vendor.schedule.name_label")}
          placeholder={t("vendor.schedule.name_placeholder")}
          className="w-full border-0 bg-transparent p-0 font-grotesk text-lg font-semibold tracking-tight text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-0 disabled:opacity-70 dark:text-paper-50 dark:placeholder:text-umber-500"
        />
        <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">
          {t("vendor.schedule.intro")}
        </p>

        <div className="mt-4">
          {ALL_WEEKDAYS.map((d) => (
            <DayRow
              key={d}
              day={d}
              label={dayLabels[d]}
              intervals={hours[d]}
              disabled={!editable}
              dayLabels={dayLabels}
              onToggle={() =>
                setDay(
                  d,
                  hours[d].length > 0
                    ? []
                    : [{ start_min: DEFAULT_WORK_START, end_min: DEFAULT_WORK_END }],
                )
              }
              onChange={(next) => setDay(d, next)}
              onCopy={(targets) => {
                setHours((prev) => {
                  const out = cloneHours(prev);
                  for (const target of targets) out[target] = prev[d].map((iv) => ({ ...iv }));
                  return out;
                });
              }}
            />
          ))}
        </div>

        {!anyWorkingDay && (
          <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
            {t("vendor.schedule.need_one_day")}
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!editable || !dirty || !anyWorkingDay}
            className="btn bg-blush-500 text-white hover:bg-blush-600 disabled:opacity-50"
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
          {!dirty && loaded && (
            <span className="flex items-center gap-1.5 text-sm text-ink-500 dark:text-umber-300">
              <Check size={14} aria-hidden="true" />
              {t("vendor.schedule.up_to_date")}
            </span>
          )}
        </div>
      </section>

      {/* Two-way Google Calendar. Sits between the weekly schedule and the dated
          exceptions because that is what it is: another source of "when am I
          not free", one the vendor keeps somewhere else. */}
      <GoogleCalendarSection />

      {/* Dated exceptions */}
      <section className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-grotesk text-base font-semibold tracking-tight text-ink-900 dark:text-paper-50">
            <CalendarOff
              size={18}
              strokeWidth={1.5}
              aria-hidden="true"
              className="shrink-0 text-steel-600 dark:text-steel-300"
            />
            {t("vendor.schedule.exceptions_title")}
          </h2>
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => setExceptionOpen(true)}
            className="btn btn-sm inline-flex items-center gap-1.5 border border-paper-300 disabled:opacity-40 dark:border-umber-700"
          >
            <CalendarPlus size={15} aria-hidden="true" />
            {t("vendor.schedule.exception_add")}
          </button>
        </div>
        <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">
          {t("vendor.schedule.exceptions_intro")}
        </p>

        {exceptions.length === 0 ? (
          <p className="mt-4 text-sm text-ink-400 dark:text-umber-400">
            {t("vendor.schedule.exceptions_empty")}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-paper-100 dark:divide-umber-800">
            {exceptions.map((ex) => (
              <li key={`${ex.kind}-${ex.date}`} className="flex items-center gap-3 py-2.5">
                <span className="text-sm text-ink-800 dark:text-paper-100">
                  {formatDate(ex.date, locale)}
                </span>
                <span className="text-sm text-ink-500 dark:text-umber-300">
                  {ex.kind === "on"
                    ? t("vendor.schedule.exception_on_label")
                    : ex.hours && ex.hours.length > 0
                      ? t("vendor.schedule.exception_off_hours_label", {
                          from: hourLabel(Math.min(...ex.hours)),
                          to: hourLabel(Math.max(...ex.hours) + 1),
                        })
                      : t("vendor.schedule.exception_off_label")}
                </span>
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => void removeException(ex.date)}
                  aria-label={t("vendor.schedule.exception_remove")}
                  title={t("vendor.schedule.exception_remove")}
                  className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-paper-100 hover:text-ink-700 disabled:opacity-30 dark:text-umber-400 dark:hover:bg-umber-800 dark:hover:text-paper-100"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {exceptionOpen && (
        <ExceptionDialog
          busy={exceptionBusy}
          onSave={(date, kind, hourList) => void addException(date, kind, hourList)}
          onClose={() => setExceptionOpen(false)}
        />
      )}
    </div>
  );
}
