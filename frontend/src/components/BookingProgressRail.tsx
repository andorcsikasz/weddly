// The booking progress rail: `shared/booking_stage.ts`, drawn.
//
// It renders the ladder and nothing else. No verdict is taken here, for the
// same reason `VendorNextAction` takes none: the moment a screen re-derives how
// far along a booking is, two screens start telling the vendor two things about
// one couple.
//
// Design notes worth not re-deriving:
//
//   * NO PERCENTAGE, ANYWHERE. The rungs are named, and the name is the
//     information. "60%" would be true of a hundred different bookings in a
//     hundred different situations.
//   * Reached rungs are `sage`, the same fill Revenue Pulse gives collected
//     money: a fact that has landed. Blush is not available to it, because the
//     portal keeps that colour for what the vendor can act on and a rung is not
//     a control. Amber is not available either, because nothing here is wrong.
//   * The labels are hidden below `sm` and only the CURRENT rung is named, so
//     the rail keeps its shape on a 375px phone instead of stacking five
//     truncated words. The full ladder is still in the group's accessible name.
//   * A closed lead draws a grey rail with its closing status, rather than a
//     part-filled one: a rail stuck at "2 of 5" over a lead the vendor declined
//     last month is an invitation to finish work nobody wants finished.

import { Timer } from "lucide-react";
import { Fragment } from "react";
import { BOOKING_STAGES, type BookingStageView, isStageReached } from "@shared/booking_stage";
import { useT } from "../lib/i18n";

/** Rung colours. `sage` for what has landed, the neutral track for what has
 *  not, and a single neutral wash for a closed lead. */
const DOT_REACHED = "bg-sage-600 dark:bg-sage-500";
const DOT_PENDING = "bg-paper-300 dark:bg-umber-700";
const DOT_CLOSED = "bg-paper-300 dark:bg-umber-700";

export function BookingProgressRail({ stage }: { stage: BookingStageView }) {
  const { t } = useT();

  const stageLabel = (key: (typeof BOOKING_STAGES)[number]) => t(`vendor.stage.${key}`);
  // Reuses the client list's own status copy rather than a second set of words
  // for the same three states: two names for "cancelled" is how a glossary
  // starts to disagree with itself.
  const closedLabel = stage.closed_status
    ? t(`vendor.clients.status_${stage.closed_status}`)
    : null;

  // One accessible sentence for the whole rail: a screen reader gets the
  // current rung by name rather than five unlabelled dots.
  const ariaLabel = stage.closed
    ? t("vendor.stage.aria_closed", { status: closedLabel ?? "" })
    : t("vendor.stage.aria", { stage: stage.key ? stageLabel(stage.key) : "" });

  return (
    <div className="flex flex-col gap-2" role="group" aria-label={ariaLabel}>
      <div className="flex items-center px-1" aria-hidden="true">
        {BOOKING_STAGES.map((key, i) => {
          const reached = isStageReached(stage, key);
          const current = stage.key === key;
          return (
            <Fragment key={key}>
              {i > 0 && (
                <span
                  className={`h-px flex-1 transition-colors duration-500 ${
                    stage.closed ? DOT_CLOSED : reached ? DOT_REACHED : DOT_PENDING
                  }`}
                />
              )}
              <span
                className={`block shrink-0 rounded-full transition-colors duration-500 ${
                  current ? "h-2.5 w-2.5 ring-4 ring-sage-600/15 dark:ring-sage-500/20" : "h-2 w-2"
                } ${stage.closed ? DOT_CLOSED : reached ? DOT_REACHED : DOT_PENDING}`}
              />
            </Fragment>
          );
        })}
      </div>

      {stage.closed ? (
        // A closed lead gets its outcome and nothing else. Naming five rungs
        // it will never move along again is filing, not information.
        <p className="text-sm text-ink-500 line-through dark:text-umber-300">{closedLabel}</p>
      ) : (
        <>
          {/* Full ladder from `sm` up. Below it there is no room for five
              words, so only the rung the booking is on is named; the rest are
              still in the group's accessible name above. */}
          <div className="hidden grid-cols-5 gap-1 sm:grid" aria-hidden="true">
            {BOOKING_STAGES.map((key) => {
              const reached = isStageReached(stage, key);
              const current = stage.key === key;
              return (
                <span
                  key={key}
                  className={`text-center text-[11px] leading-tight transition-colors duration-500 ${
                    current
                      ? "font-semibold text-ink-900 dark:text-paper-50"
                      : reached
                        ? "text-ink-600 dark:text-paper-300"
                        : "text-ink-400 dark:text-umber-400"
                  }`}
                >
                  {stageLabel(key)}
                </span>
              );
            })}
          </div>
          <p
            className="text-sm font-medium text-ink-900 sm:hidden dark:text-paper-50"
            aria-hidden="true"
          >
            {stage.key ? stageLabel(stage.key) : null}
          </p>
        </>
      )}

      {/* The date hold rides alongside the ladder, never on it: most bookings
          never have one, and a rung nobody reaches reads as a skipped step. */}
      {stage.hold_live && (
        <p className="flex items-center gap-1.5 text-xs text-ink-600 dark:text-paper-300">
          <Timer
            size={14}
            strokeWidth={1.5}
            aria-hidden="true"
            className="shrink-0 text-steel-600 dark:text-steel-300"
          />
          {t("vendor.stage.hold_live")}
        </p>
      )}
    </div>
  );
}
