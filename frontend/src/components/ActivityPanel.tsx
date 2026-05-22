// Couple-wide audit log surface. Renders as a dark "console" card with
// per-action verb phrases reconstructed from `before_json` / `after_json`.
//
// Originally lived inside ProfilePage.tsx; extracted so the Dashboard can
// host it instead (the agent debate's recommendation: this is a "what
// just changed in the workspace" feed, which fits Dashboard's mental
// model better than a settings page).

import type { CoupleActivityEntry } from "@shared/types";
import { ChevronDown, History } from "lucide-react";
import { useState } from "react";
import {
  formatDate,
  formatHuf,
  formatHufRange,
  formatTimestamp,
  formatYearMonth,
} from "../lib/format";
import type { Locale } from "../lib/i18n";

type T = (path: string, vars?: Record<string, string | number>) => string;

function safeParse(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Try a localized lookup; fall back to a generic phrase if the key isn't
 *  translated (i.e. the returned string is identical to the key path). */
function tWithFallback(t: T, key: string, vars: Record<string, string | number>): string {
  const out = t(key, vars);
  if (out === key) return t("profile.activity_action_generic", vars);
  return out;
}

/** Format a budget side (before or after) — honours `budget_kind` so a range
 *  renders as "min – max" and tbd renders as the i18n "TBD" string. */
function formatBudgetSide(side: Record<string, unknown>, locale: Locale, t: T): string {
  const kind = asString(side.budget_kind);
  const exact = asNumber(side.budget_ceiling_huf);
  const min = asNumber(side.budget_ceiling_min_huf);
  const max = asNumber(side.budget_ceiling_max_huf);
  if (kind === "range" && min !== null && max !== null) return formatHufRange(min, max, locale);
  if (kind === "exact" && exact !== null) return formatHuf(exact, locale);
  if (exact !== null) return formatHuf(exact, locale);
  if (min !== null && max !== null) return formatHufRange(min, max, locale);
  return t("profile.activity_value_empty");
}

/** Format a wedding-date side respecting the chosen `wedding_date_kind`. */
function formatWeddingDateSide(side: Record<string, unknown>, locale: Locale, t: T): string {
  const kind = asString(side.wedding_date_kind);
  const exact = asString(side.wedding_date);
  const year = asNumber(side.wedding_target_year);
  const month = asNumber(side.wedding_target_month);
  const season = asString(side.wedding_target_season);
  if (kind === "tbd") return t("profile.activity_date_tbd");
  if (kind === "exact" && exact) return formatDate(exact, locale);
  if (kind === "month" && year !== null && month !== null) {
    return formatYearMonth(year, month, locale);
  }
  if (kind === "season" && year !== null && season) {
    return t("goal.date_season", { season: t(`season.${season}`), year });
  }
  if (kind === "year" && year !== null) return String(year);
  if (exact) return formatDate(exact, locale);
  return t("profile.activity_date_tbd");
}

/** Bride & Groom — both sides always carry both names so a single field
 *  edit still produces a paired "Anna & Béla → Anna & Botond" diff.
 *  Separator is i18n'd so HU reads "Anna és Béla" instead of the EN "&". */
function formatNamesSide(side: Record<string, unknown>, t: T): string {
  const bride = asString(side.bride_name) ?? "";
  const groom = asString(side.groom_name) ?? "";
  if (!bride && !groom) return "—";
  const sep = t("profile.activity_names_separator");
  return `${bride}${sep}${groom}`.trim();
}

/** Localized ceremony kind label. Backend stores raw enum strings; falls
 *  back to the raw value if a new kind ever ships without an i18n pair. */
function formatCeremonyKind(value: string | null, t: T): string {
  if (!value) return t("profile.activity_value_empty");
  const label = t(`onboarding.ceremony_kind_${value}`);
  if (label === `onboarding.ceremony_kind_${value}`) return value;
  return label;
}

/** Returns the localized verb-phrase for one activity entry. The actor name
 *  is rendered separately by `ActivityPanel`, so this string starts with the
 *  verb ("updated the budget cap: X → Y"). */
function renderActivityEntry(entry: CoupleActivityEntry, t: T, locale: Locale): string {
  const before = safeParse(entry.before_json);
  const after = safeParse(entry.after_json);
  const action = entry.action;
  const empty = t("profile.activity_value_empty");

  if (action === "couple.budget_cap_update" && before && after) {
    return tWithFallback(t, "profile.activity_action_couple_budget_cap_update", {
      before: formatBudgetSide(before, locale, t),
      after: formatBudgetSide(after, locale, t),
    });
  }
  if (action === "couple.wedding_date_update" && before && after) {
    return tWithFallback(t, "profile.activity_action_couple_wedding_date_update", {
      before: formatWeddingDateSide(before, locale, t),
      after: formatWeddingDateSide(after, locale, t),
    });
  }
  if (action === "couple.names_update" && before && after) {
    return tWithFallback(t, "profile.activity_action_couple_names_update", {
      before: formatNamesSide(before, t),
      after: formatNamesSide(after, t),
    });
  }
  if (action === "couple.ceremony_kind_update" && before && after) {
    return tWithFallback(t, "profile.activity_action_couple_ceremony_kind_update", {
      before: formatCeremonyKind(asString(before.ceremony_kind), t),
      after: formatCeremonyKind(asString(after.ceremony_kind), t),
    });
  }
  if (action === "couple.planning_count_update" && before && after) {
    const b = asNumber(before.planning_count);
    const a = asNumber(after.planning_count);
    return tWithFallback(t, "profile.activity_action_couple_planning_count_update", {
      before: b === null ? t("profile.activity_value_empty") : String(b),
      after: a === null ? t("profile.activity_value_empty") : String(a),
    });
  }

  if (action === "pick.upsert" || action === "pick.remove") {
    const side = after ?? before;
    const cat = side ? asString(side.category) : null;
    const catLabel = cat ? t(`suppliers.cat.${cat}`) : null;
    return tWithFallback(t, `profile.activity_action_${action.replace(/\./g, "_")}`, {
      category: catLabel && catLabel !== `suppliers.cat.${cat}` ? catLabel : (cat ?? ""),
    });
  }

  if (
    action === "schedule.create" ||
    action === "schedule.update" ||
    action === "schedule.delete" ||
    action === "schedule.event_create" ||
    action === "schedule.event_update" ||
    action === "schedule.event_delete"
  ) {
    const label = asString(after?.label) ?? asString(before?.label) ?? "";
    const normalised = action.replace("event_", "");
    return tWithFallback(t, `profile.activity_action_${normalised.replace(/\./g, "_")}`, {
      label,
    });
  }

  if (
    action === "couple_supplier.create" ||
    action === "couple_supplier.update" ||
    action === "couple_supplier.delete"
  ) {
    const name = asString(after?.name) ?? asString(before?.name) ?? "";
    return tWithFallback(t, `profile.activity_action_${action.replace(/\./g, "_")}`, { name });
  }

  if (action === "guest.create" || action === "guest.update" || action === "guest.delete") {
    const side = action === "guest.delete" ? before : after;
    return tWithFallback(t, `profile.activity_action_${action.replace(/\./g, "_")}`, {
      name: asString(side?.full_name) ?? empty,
    });
  }

  if (action === "household.update" && (before || after)) {
    const lb = asString(before?.label);
    const la = asString(after?.label);
    if (lb && la && lb !== la) {
      return tWithFallback(t, "profile.activity_action_household_update_rename", {
        before: lb,
        after: la,
      });
    }
    return tWithFallback(t, "profile.activity_action_household_update", {
      label: la ?? lb ?? empty,
    });
  }
  if (action === "household.create" || action === "household.delete") {
    const side = action === "household.delete" ? before : after;
    return tWithFallback(t, `profile.activity_action_${action.replace(/\./g, "_")}`, {
      label: asString(side?.label) ?? empty,
    });
  }

  if (action === "table.update") {
    const lb = asString(before?.label);
    const la = asString(after?.label);
    if (lb && la && lb !== la) {
      return tWithFallback(t, "profile.activity_action_table_update_rename", {
        before: lb,
        after: la,
      });
    }
    return tWithFallback(t, "profile.activity_action_table_update", {
      label: la ?? lb ?? empty,
    });
  }
  if (action === "table.create" || action === "table.delete") {
    const side = action === "table.delete" ? before : after;
    return tWithFallback(t, `profile.activity_action_${action.replace(/\./g, "_")}`, {
      label: asString(side?.label) ?? empty,
    });
  }

  if (action === "budget.line_update" && (before || after)) {
    const labelBefore = asString(before?.label);
    const labelAfter = asString(after?.label);
    if (labelBefore && labelAfter && labelBefore !== labelAfter) {
      return tWithFallback(t, "profile.activity_action_budget_line_update_rename", {
        before: labelBefore,
        after: labelAfter,
      });
    }
    const segments: string[] = [];
    const plannedBefore = asNumber(before?.planned_huf);
    const plannedAfter = asNumber(after?.planned_huf);
    const actualBefore = asNumber(before?.actual_huf);
    const actualAfter = asNumber(after?.actual_huf);
    if (plannedBefore !== null && plannedAfter !== null && plannedBefore !== plannedAfter) {
      segments.push(
        `${t("profile.activity_budget_planned")}: ${formatHuf(plannedBefore, locale)} → ${formatHuf(plannedAfter, locale)}`,
      );
    }
    if (actualBefore !== null && actualAfter !== null && actualBefore !== actualAfter) {
      segments.push(
        `${t("profile.activity_budget_actual")}: ${formatHuf(actualBefore, locale)} → ${formatHuf(actualAfter, locale)}`,
      );
    }
    const label = labelAfter ?? labelBefore ?? empty;
    if (segments.length > 0) {
      return tWithFallback(t, "profile.activity_action_budget_line_update_diff", {
        label,
        changes: segments.join(", "),
      });
    }
    return tWithFallback(t, "profile.activity_action_budget_line_update", { label });
  }
  if (action === "budget.line_create" || action === "budget.line_delete") {
    const side = action === "budget.line_delete" ? before : after;
    return tWithFallback(t, `profile.activity_action_${action.replace(/\./g, "_")}`, {
      label: asString(side?.label) ?? empty,
    });
  }

  if (action === "seat.assign") {
    return tWithFallback(t, "profile.activity_action_seat_assign", {
      guest: asString(after?.guest_name) ?? empty,
      table: asString(after?.table_label) ?? empty,
    });
  }
  if (action === "seat.unassign") {
    return tWithFallback(t, "profile.activity_action_seat_unassign", {
      guest: asString(before?.guest_name) ?? empty,
    });
  }
  if (action === "seat.swap") {
    return tWithFallback(t, "profile.activity_action_seat_swap", {
      a: asString(after?.guest_a_name) ?? empty,
      b: asString(after?.guest_b_name) ?? empty,
    });
  }

  const key = `profile.activity_action_${action.replace(/\./g, "_")}`;
  const resolved = t(key);
  if (resolved !== key) return resolved;
  return t("profile.activity_action_generic");
}

/** Compact human time — relative for recent events, locale date+time for
 *  anything older than a week. */
function relativeTime(ms: number, locale: Locale, t: T): string {
  const diffMs = Date.now() - ms;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return t("profile.activity_just_now");
  if (diffMin < 60) return t("profile.activity_mins_ago", { n: diffMin });
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return t("profile.activity_hours_ago", { n: diffHour });
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return t("profile.activity_yesterday");
  if (diffDay < 7) return t("profile.activity_days_ago", { n: diffDay });
  return formatTimestamp(ms, locale);
}

/** Dark "what happened" console — Dashboard-level audit feed. Collapsed
 *  by default since the 14-day feed can grow long; header doubles as a
 *  collapse toggle. State is component-local — no need to survive a
 *  refresh; users open/close per visit. */
export function ActivityPanel({
  entries,
  currentUserId,
  locale,
  t,
}: {
  entries: CoupleActivityEntry[];
  currentUserId: number | null;
  locale: Locale;
  t: T;
}) {
  const [open, setOpen] = useState(false);
  const toggleLabel = open
    ? t("profile.activity_toggle_collapse")
    : t("profile.activity_toggle_expand");
  return (
    <section className="mt-6 overflow-hidden rounded-2xl bg-ink-900 text-paper-100 shadow-pop">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="activity-panel-body"
        className="flex w-full items-start gap-4 border-b border-ink-800 px-6 py-4 text-left transition-colors hover:bg-ink-800/40"
      >
        <span className="flex-1">
          <span className="flex items-center gap-2 text-lg text-paper-50">
            <History size={18} className="text-ink-300" aria-hidden />
            {t("profile.activity_title")}
          </span>
          <span className="mt-1 block text-xs text-ink-200">{t("profile.activity_body")}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 pt-1 text-xs text-ink-200">
          <span className="sr-only">{toggleLabel}</span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {open ? (
        entries.length === 0 ? (
          <p id="activity-panel-body" className="px-6 py-5 text-sm text-ink-300">
            {t("profile.activity_empty")}
          </p>
        ) : (
          <ul id="activity-panel-body" className="divide-y divide-ink-800">
            {entries.map((e) => {
              const actorIsSelf = e.actor_id !== null && e.actor_id === currentUserId;
              const actorName = actorIsSelf
                ? t("profile.activity_actor_you")
                : (e.actor_full_name ?? t("profile.activity_actor_unknown"));
              const phrase = renderActivityEntry(e, t, locale);
              return (
                <li
                  key={e.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-6 py-3 text-sm"
                >
                  <span className="font-medium text-paper-50">{actorName}</span>
                  <span className="text-paper-200">{phrase}</span>
                  <span className="ml-auto font-mono text-xs text-ink-300">
                    {relativeTime(e.created_at, locale, t)}
                  </span>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </section>
  );
}
