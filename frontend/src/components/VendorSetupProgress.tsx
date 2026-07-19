// Vendor listing-setup progress, shared by the two surfaces that show it: the
// dashboard's completeness alert (+ its collapsed chip) and the sticky column
// of the listing editor. Both render the SAME ring and the SAME checklist rows
// off `VendorStats.listing_steps` / `listingChecklistFor`, so a vendor never
// sees two different answers to "how far along am I".
//
// The rules themselves live in shared/vendor_clients.ts — this file is purely
// presentation.

import { Circle, CircleCheck } from "lucide-react";
import { Link } from "react-router-dom";
import type { VendorListingStep } from "@shared/vendor_clients";
import { listingCompletenessFor } from "@shared/vendor_clients";
import { useT } from "../lib/i18n";

/** Listing-setup completion ring. Pure tokenised SVG (no chart lib); it
 *  animates as the percent climbs and is shared by every surface that shows
 *  progress, so the number reads identically wherever it appears. */
export function CompletenessRing({
  pct,
  size = 20,
  stroke = 3,
}: {
  pct: number;
  size?: number;
  stroke?: number;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = circumference * (1 - clamped / 100);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      className="-rotate-90 shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        className="stroke-steel-200 dark:stroke-steel-600/40"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="stroke-steel-600 transition-[stroke-dashoffset] duration-700 ease-out dark:stroke-steel-300"
      />
    </svg>
  );
}

/** The checklist behind the ring. Every row deep-links into the matching
 *  section of the listing editor via the `#vendor-section-<key>` anchors, so
 *  "gallery" lands on the gallery fieldset rather than the top of a long form.
 *  Done rows stay visible (and stay links) — seeing what's already finished is
 *  half of what makes a checklist feel like progress. */
export function SetupChecklist({ steps }: { steps: VendorListingStep[] }) {
  const { t } = useT();
  if (steps.length === 0) return null;
  return (
    <ul className="mt-1.5 flex flex-col gap-0.5">
      {steps.map((step) => (
        <li key={step.key}>
          <Link
            to={`/vendor/listing#vendor-section-${step.key}`}
            className="-mx-1.5 flex items-center gap-2 rounded-lg px-1.5 py-1 text-sm transition-colors hover:bg-steel-100 dark:hover:bg-steel-600/25"
          >
            {step.done ? (
              <CircleCheck
                size={15}
                aria-hidden="true"
                className="shrink-0 text-sage-600 dark:text-sage-400"
              />
            ) : (
              <Circle
                size={15}
                aria-hidden="true"
                className="shrink-0 text-steel-400 dark:text-steel-500"
              />
            )}
            <span
              className={
                step.done
                  ? "text-ink-500 line-through dark:text-paper-400"
                  : "text-ink-700 dark:text-paper-200"
              }
            >
              {t(`vendor.setup.step_${step.key}`)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The listing-editor's copy of the progress: ring + percent + the checklist.
 *  Renders nothing at 100% — a fully-ticked list is noise on the page the
 *  vendor is already working in. */
export function SetupProgressPanel({ steps }: { steps: VendorListingStep[] }) {
  const { t } = useT();
  const pct = listingCompletenessFor(steps);
  if (pct >= 100) return null;
  return (
    <section className="mt-3 rounded-2xl border border-steel-200 bg-steel-50 p-4 dark:border-steel-600/30 dark:bg-steel-600/15">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-paper-50">
        <CompletenessRing pct={pct} size={22} stroke={3} />
        {t("vendor.setup.panel_title", { pct: String(pct) })}
      </h2>
      <SetupChecklist steps={steps} />
    </section>
  );
}
