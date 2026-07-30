// Planner setup progress, on /app/planner/settings/account: the seven things a
// couple actually meets when they open this planner in the directory. It is the
// fuller counterpart of the dashboard's three-item `PlannerProfileNudge`, and
// the two must never disagree, which is why neither of them owns the rules:
// both read `PLANNER_CHECKLIST_STEPS` / `plannerChecklistCompleteness` from
// shared/planner_points.ts. That same helper is what the server awards
// profile-completeness points from, so re-deriving the percentage here would
// eventually put "you are 71% done" next to points earned for something else,
// and a ring that disagrees with the score is worse than no ring.
//
// Two deliberate differences from the dashboard nudge:
//
//   1. DONE ROWS STAY, quietly. The planner should be able to see what they
//      already finished on the page where they finished it, rather than having
//      the list silently shrink under them.
//   2. THE BLOCK SURVIVES 100%, as a finished state (`done_title`/`done_body`).
//      The nudge is right to vanish: the dashboard is a list of what to do
//      today, and a completed to-do is noise there. This page is where a planner
//      comes to look after the profile itself, so losing the progress block the
//      moment it is earned reads as the page breaking, not as work finished.
//
// Not dismissible: there is nothing to dismiss it back to (no collapsed chip
// like the vendor dashboard's), and the whole block is the page's answer to
// "what do I do next".

import {
  Briefcase,
  CalendarDays,
  Camera,
  Check,
  MapPin,
  PenLine,
  Sparkles,
  Tag,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { Link } from "react-router-dom";
import {
  PLANNER_CHECKLIST_STEPS,
  PLANNER_POINTS_BY_EVENT,
  type PlannerChecklistStep,
  plannerChecklistCompleteness,
} from "@shared/planner_points";
import type { PlannerProfile, PlannerProfileChecklist } from "@shared/types";
import { useT } from "../../lib/i18n";
import { ProgressRing } from "../ProgressRing";

type IconType = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

/** The account-form field each in-form step focuses. Written out rather than
 *  built from the step key, because the two vocabularies deliberately differ:
 *  the checklist says `city`, the profile column says `planner_city`, and
 *  concatenating a prefix would produce `planner-acct-city`, an id that exists
 *  nowhere and fails silently (the form would open with nothing focused). */
const FIELD_FOR_STEP = {
  business_name: "business_name",
  city: "planner_city",
  bio: "planner_bio",
  styles: "planner_styles",
} as const satisfies Partial<Record<PlannerChecklistStep, keyof PlannerProfile>>;

// `planner_styles` used to be the one step with no editor anywhere: styles only
// ever arrived from the /planners application, which onboarding carries forward,
// so a planner who signed up any other way could not reach 100% and the fourth
// profile-completeness milestone was unreachable points. The account form now
// owns a style picker (chips, capped at three, same slug vocabulary the couple's
// card labels from), so every step on this list has somewhere real to go.

/** The profile fields this checklist can send a planner to. Narrower than
 *  `keyof PlannerProfile` on purpose: the callback's contract is "one of the
 *  four fields the account form owns", not "any column". */
export type PlannerChecklistField = (typeof FIELD_FOR_STEP)[keyof typeof FIELD_FOR_STEP];

/** Where the work for each step actually lives. Every step has a home, so
 *  there is no unlinked row: a checklist item nothing can act on is a
 *  complaint, not a task. */
type StepTarget =
  | { kind: "field"; field: PlannerChecklistField }
  /** The portfolio section further down this same page. */
  | { kind: "photos" }
  | { kind: "route"; to: string };

const OFFERINGS = "/app/planner/settings/offerings";

const TARGET: Record<PlannerChecklistStep, StepTarget> = {
  business_name: { kind: "field", field: FIELD_FOR_STEP.business_name },
  city: { kind: "field", field: FIELD_FOR_STEP.city },
  bio: { kind: "field", field: FIELD_FOR_STEP.bio },
  styles: { kind: "field", field: FIELD_FOR_STEP.styles },
  has_photo: { kind: "photos" },
  has_package: { kind: "route", to: OFFERINGS },
  has_availability: { kind: "route", to: OFFERINGS },
};

/** One glyph per step. The last three repeat the dashboard nudge's icons
 *  (camera / tag / calendar) on purpose: it is the same three tasks, and a
 *  planner should recognise them from the shorter list. */
const ICON: Record<PlannerChecklistStep, IconType> = {
  business_name: Briefcase,
  city: MapPin,
  bio: PenLine,
  styles: Sparkles,
  has_photo: Camera,
  has_package: Tag,
  has_availability: CalendarDays,
};

export function PlannerSetupChecklist({
  checklist,
  onEditField,
  onShowPhotos,
}: {
  checklist: PlannerProfileChecklist;
  /** Drop the account form into edit mode with this field focused. */
  onEditField: (field: PlannerChecklistField) => void;
  /** Bring the portfolio section (further down the same page) into view. */
  onShowPhotos: () => void;
}) {
  const { t } = useT();
  const pct = plannerChecklistCompleteness(checklist);
  const finished = pct >= 100;

  return (
    <section className="card mt-8 p-5">
      <div className="flex items-start gap-4">
        {/* Moss track + arc, not the ring's default `active` tone: that default
            is blush, the VENDOR portal's one interactive colour, and progress a
            planner is being asked to act on has to wear the planner portal's
            own moss. Both classes are passed together, per the ring's own rule
            about an arc on a foreign track. */}
        <ProgressRing
          pct={pct}
          size={44}
          stroke={4}
          trackClass="stroke-moss-100 dark:stroke-moss-900/60"
          arcClass="stroke-moss-600 dark:stroke-moss-400"
          label={t("planner_setup.ring_label")}
        />
        <div className="min-w-0 flex-1">
          <h2 className="font-grotesk text-lg font-semibold text-umber-900 dark:text-paper-50">
            {t(finished ? "planner_setup.done_title" : "planner_setup.title")}
          </h2>
          <p className="mt-1 text-sm text-umber-600 dark:text-umber-300">
            {t(finished ? "planner_setup.done_body" : "planner_setup.body")}
          </p>
          {/* The percentage in words next to the ring, plus what the next
              milestone pays. The point value is read from the shared table so a
              rebalance is one edit in shared/planner_points.ts and never a
              translation round; the copy only owns the sentence. */}
          <p className="mt-1.5 text-xs text-umber-500 dark:text-umber-400">
            <span className="font-semibold tabular-nums text-moss-700 dark:text-moss-300">
              {t("planner_setup.progress", { pct: String(pct) })}
            </span>
            {!finished && (
              <>
                {" · "}
                {t("planner_setup.points_hint", {
                  points: String(PLANNER_POINTS_BY_EVENT.profile_completeness),
                })}
              </>
            )}
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-1">
        {PLANNER_CHECKLIST_STEPS.map((step) => {
          const done = checklist[step];
          const Icon = ICON[step];
          const target = TARGET[step];
          const label = t(`planner_setup.step_${step}`);
          const cta = t("planner_setup.cta");
          // "Add" on its own is meaningless out of context, and every row's
          // button says the same word, so the accessible name carries the step.
          const ctaLabel = `${label}: ${cta}`;
          return (
            <li key={step} className="flex items-center gap-3 rounded-lg px-1 py-2">
              {done ? (
                <Check
                  size={18}
                  aria-hidden="true"
                  className="shrink-0 text-moss-600 dark:text-moss-400"
                />
              ) : (
                <Icon
                  size={18}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  className="shrink-0 text-umber-400 dark:text-umber-500"
                />
              )}
              <span
                className={`min-w-0 flex-1 text-sm ${
                  done
                    ? "text-umber-400 dark:text-umber-500"
                    : "font-medium text-umber-800 dark:text-paper-100"
                }`}
              >
                {label}
              </span>
              {!done &&
                (target.kind === "route" ? (
                  <Link
                    to={target.to}
                    aria-label={ctaLabel}
                    className="btn-outline btn-sm shrink-0"
                  >
                    {cta}
                  </Link>
                ) : (
                  <button
                    type="button"
                    aria-label={ctaLabel}
                    onClick={() =>
                      target.kind === "field" ? onEditField(target.field) : onShowPhotos()
                    }
                    className="btn-outline btn-sm shrink-0"
                  >
                    {cta}
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
