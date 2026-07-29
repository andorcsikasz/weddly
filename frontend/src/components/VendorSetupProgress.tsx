// Vendor listing-setup progress: ONE ring, ONE row style, everywhere the
// question "how far along am I" is asked. The dashboard panel (+ its collapsed
// chip) and the sticky column of the listing editor both render off
// `VendorStats.listing_steps` / `listingChecklistFor`.
//
// The rows deliberately use the portal's list anatomy — full-bleed lines on
// hairlines, label left, chevron right — the same one the dashboard's upcoming
// events and the points rulebook use. Before this, setup was a tinted alert box
// with circle bullets while the dashboard recommended the SAME work again as
// hairline cards two screens down: one task, two visual languages, and the
// vendor had to notice they were the same thing.
//
// The rules themselves live in shared/vendor_clients.ts — this file is purely
// presentation.

import { type ReactNode, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Circle, CircleCheck, X } from "lucide-react";
import { Link } from "react-router-dom";
import type { VendorListingStep } from "@shared/vendor_clients";
import { listingCompletenessFor } from "@shared/vendor_clients";
import { fireConfetti } from "../lib/confetti";
import { useT } from "../lib/i18n";
import { ProgressRing } from "./ProgressRing";

/** Listing-setup completion ring. Thin alias over the portal's single
 *  {@link ProgressRing} — kept as a named export because half a dozen call
 *  sites read better as "completeness ring", but there is deliberately only ONE
 *  ring implementation now that tier and quest progress render the same shape. */
export function CompletenessRing({
  pct,
  size = 20,
  stroke = 3,
}: {
  pct: number;
  size?: number;
  stroke?: number;
}) {
  return <ProgressRing pct={pct} size={size} stroke={stroke} />;
}

// Completion choreography, in ms. A finished step doesn't just vanish: it ticks
// (the circle becomes a check), then strikes through, then collapses out of the
// list. Each stage has to be legible on its own, hence the deliberate beats.
const TICK_MS = 260; // circle → check, text starts striking
const STRIKE_MS = 420; // the strike sweeps across the label
const COLLAPSE_MS = 260; // the row folds up and fades
const EXIT_MS = TICK_MS + STRIKE_MS + COLLAPSE_MS;

/** The checklist behind the ring. Every row deep-links into the matching
 *  section of the listing editor via the `#vendor-section-<key>` anchors, so
 *  "gallery" lands on the gallery fieldset rather than the top of a long form.
 *
 *  Only unfinished work is listed, but a step earns its exit: when it flips
 *  done it ticks, strikes through, then folds away, so the vendor SEES the
 *  thing they just did leave the list. Steps already done on mount are simply
 *  absent — replaying a celebration for work finished last week would be a lie.
 *  Emptying the list fires confetti once. The ring keeps counting every step. */
export function SetupChecklist({ steps }: { steps: VendorListingStep[] }) {
  const { t } = useT();
  // Keys mid-exit → the ms elapsed marker that drives their stage. Held here
  // (not derived) because the row must outlive the prop that removed it.
  const [exiting, setExiting] = useState<Record<string, number>>({});
  // Seeded from the first render so pre-existing done steps never animate.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) seen.current = new Set(steps.filter((s) => s.done).map((s) => s.key));
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      for (const id of timers.current) window.clearTimeout(id);
    },
    [],
  );

  // The editor recomputes `steps` on every keystroke, so the effect keys off
  // WHICH steps are done rather than the array identity — otherwise it would
  // re-run on each character typed into the blurb.
  const doneSig = steps
    .filter((s) => s.done)
    .map((s) => s.key)
    .join("|");
  const allDone = steps.length > 0 && steps.every((s) => s.done);

  useEffect(() => {
    const known = seen.current;
    if (!known) return;
    const done = doneSig ? doneSig.split("|") : [];
    const fresh = done.filter((k) => !known.has(k));
    // Rebuild rather than add: a step that went back to undone (photo deleted,
    // blurb cleared) has to become celebratable again.
    known.clear();
    for (const k of done) known.add(k);
    if (fresh.length === 0) return;

    setExiting((prev) => {
      const next = { ...prev };
      for (const k of fresh) next[k] = 0;
      return next;
    });
    // Advance the stage so CSS has a frame to transition FROM, then drop the
    // row entirely. Nothing here reads state, so the timers stay independent.
    timers.current.push(
      window.setTimeout(() => {
        setExiting((prev) => {
          const next = { ...prev };
          for (const k of fresh) if (k in next) next[k] = TICK_MS;
          return next;
        });
      }, 30),
    );
    timers.current.push(
      window.setTimeout(() => {
        setExiting((prev) => {
          const next = { ...prev };
          for (const k of fresh) if (k in next) next[k] = TICK_MS + STRIKE_MS;
          return next;
        });
      }, TICK_MS + STRIKE_MS),
    );
    timers.current.push(
      window.setTimeout(() => {
        setExiting((prev) => {
          const next = { ...prev };
          for (const k of fresh) delete next[k];
          return next;
        });
        // The whole list is gone — that's the moment worth celebrating, and
        // only when the last step was finished HERE, not on arrival.
        if (allDone) fireConfetti();
      }, EXIT_MS),
    );
  }, [doneSig, allDone]);

  // Pending work, plus whatever is still playing its exit, in the canonical
  // step order so nothing jumps position on its way out.
  const rows = steps.filter((s) => !s.done || s.key in exiting);
  if (rows.length === 0) return null;

  return (
    <ul className="flex flex-col divide-y divide-paper-200 border-y border-paper-200 dark:divide-umber-700 dark:border-umber-700">
      {rows.map((step) => {
        const stage = exiting[step.key];
        const leaving = stage !== undefined;
        const ticked = leaving && stage >= TICK_MS;
        const collapsing = leaving && stage >= TICK_MS + STRIKE_MS;
        return (
          <li
            key={step.key}
            className="overflow-hidden transition-all duration-[260ms] ease-out"
            style={
              collapsing
                ? { maxHeight: 0, opacity: 0, transform: "translateX(6px)" }
                : { maxHeight: "3.5rem", opacity: 1 }
            }
          >
            <Link
              to={`/vendor/listing#vendor-section-${step.key}`}
              className="group -mx-2 flex items-center gap-3 px-2 py-3 transition-colors hover:bg-paper-100 dark:hover:bg-umber-800"
              // Mid-exit the row is a receipt, not a destination.
              tabIndex={leaving ? -1 : undefined}
            >
              {leaving ? (
                <CircleCheck
                  size={16}
                  aria-hidden="true"
                  className="shrink-0 animate-tick-pop text-sage-600 dark:text-sage-400"
                />
              ) : (
                <Circle
                  size={16}
                  aria-hidden="true"
                  className="shrink-0 text-ink-300 dark:text-paper-400"
                />
              )}
              {/* The strike is a pseudo-free overlay rule that sweeps left to
                  right, rather than `line-through` snapping on in one frame. */}
              <span
                className={`relative min-w-0 flex-1 font-medium ${
                  ticked ? "text-ink-500 dark:text-paper-400" : "text-ink-900 dark:text-paper-50"
                } transition-colors duration-200`}
              >
                {t(`vendor.setup.step_${step.key}`)}
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 my-auto h-px origin-left bg-current transition-transform duration-[420ms] ease-out"
                  style={{ width: "100%", transform: `scaleX(${ticked ? 1 : 0})` }}
                />
              </span>
              <ChevronRight
                size={16}
                aria-hidden="true"
                className="shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5 dark:text-paper-400"
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** True while the setup surface should stay on screen. Normally that's simply
 *  "not finished yet", but the last step needs a grace period: unmounting the
 *  panel the instant it hits 100% would cut the tick-strike-fade (and the
 *  confetti) off mid-flight. A listing that was ALREADY complete on arrival
 *  gets no grace — there is nothing to watch. */
export function useSetupLinger(complete: boolean): boolean {
  const [linger, setLinger] = useState(false);
  const wasIncomplete = useRef(!complete);
  useEffect(() => {
    if (!complete) {
      wasIncomplete.current = true;
      setLinger(false);
      return;
    }
    if (!wasIncomplete.current) return; // complete on arrival — nothing to play
    wasIncomplete.current = false;
    setLinger(true);
    const id = window.setTimeout(() => setLinger(false), EXIT_MS + 1400);
    return () => window.clearTimeout(id);
  }, [complete]);
  return !complete || linger;
}

/** Component form of {@link useSetupLinger}, for the surfaces whose visibility
 *  is decided after an early return (where a hook can't go). Renders its
 *  children while the setup surface should stay on screen. */
export function SetupLinger({ complete, children }: { complete: boolean; children: ReactNode }) {
  return useSetupLinger(complete) ? <>{children}</> : null;
}

/** The listing-editor's copy of the progress: ring + percent + the checklist.
 *  Renders nothing once the list is done and its exit has played — a fully
 *  ticked list is noise on the page the vendor is already working in. */
export function SetupProgressPanel({ steps }: { steps: VendorListingStep[] }) {
  const { t } = useT();
  const pct = listingCompletenessFor(steps);
  const visible = useSetupLinger(pct >= 100);
  if (!visible) return null;
  return (
    <section className="mt-3">
      <h2 className="flex items-center gap-2 pb-2 text-sm font-semibold text-ink-900 dark:text-paper-50">
        <CompletenessRing pct={pct} size={22} stroke={3} />
        {t("vendor.setup.panel_title", { pct: String(pct) })}
      </h2>
      <SetupChecklist steps={steps} />
    </section>
  );
}

/** THE setup surface for the dashboard: ring, headline, the remaining work as
 *  rows, and a dismiss that collapses it to {@link SetupProgressChip} rather
 *  than hiding it. This is the only place the dashboard recommends listing
 *  work — the "next steps" cards below it take over once there is none left,
 *  so the same task is never proposed twice in two shapes. */
export function VendorSetupPanel({
  steps,
  pct,
  onDismiss,
  dismissLabel,
}: {
  steps: VendorListingStep[];
  pct: number;
  onDismiss: () => void;
  dismissLabel: string;
}) {
  const { t } = useT();
  return (
    <section className="flex flex-col">
      <div className="flex items-start gap-3 pb-3">
        <CompletenessRing pct={pct} size={36} stroke={4} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="font-grotesk text-lg font-semibold tracking-[-0.01em] text-ink-900 dark:text-paper-50">
            {t("vendor.dashboard.completeness_alert", { pct: String(pct) })}
          </h2>
          <p className="text-sm text-ink-500 dark:text-paper-400">
            {t("vendor.dashboard.completeness_alert_body")}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          title={dismissLabel}
          className="-m-1 shrink-0 rounded-lg p-1 text-ink-400 transition-colors hover:bg-paper-100 hover:text-ink-900 dark:text-paper-400 dark:hover:bg-umber-800 dark:hover:text-paper-50"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <SetupChecklist steps={steps} />
    </section>
  );
}

/** The dismissed state: a small, persistent, reopenable chip. The percent is
 *  never lost while the listing is unfinished, which is why dismissing
 *  collapses rather than hides. */
export function SetupProgressChip({
  pct,
  onExpand,
  label,
}: {
  pct: number;
  onExpand: () => void;
  label: string;
}) {
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label={label}
      className="inline-flex items-center gap-2 self-start rounded-full border border-paper-300 py-1.5 pl-2 pr-3.5 text-sm text-ink-700 transition-colors hover:bg-paper-100 dark:border-umber-700 dark:text-paper-200 dark:hover:bg-umber-800"
    >
      <CompletenessRing pct={pct} />
      <span className="font-medium">
        {t("vendor.dashboard.completeness_chip", { pct: String(pct) })}
      </span>
      <ChevronDown size={15} aria-hidden="true" className="text-ink-400 dark:text-paper-400" />
    </button>
  );
}
