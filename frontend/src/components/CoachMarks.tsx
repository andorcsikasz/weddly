// First-run coach-marks for mobile users — surfaces the three affordances
// that cohort C (older relatives, less tech-literate helpers) tend to miss
// on first use: the bottom-nav, the More sheet, and the partner-invite
// section. Shows once per device. Touch-only — hidden at the `lg:` breakpoint
// where the desktop sidebar replaces the bottom bar.
//
// Targets are picked up via `data-coach-target="..."` attributes:
//   • bottom-nav     → the whole mobile bottom-nav strip
//   • more-button    → the More button (last slot)
//   • partner-invite → the partner-invite section on the Dashboard
//
// A step that can't find its target is skipped — that handles the case where
// the partner has already been invited and the section is gone.

import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useT } from "../lib/i18n";

const STORAGE_KEY = "weddly.coachmarks.v1";
const MOBILE_BREAKPOINT_PX = 1024; // matches Tailwind `lg:`

/**
 * Routes that render a FULL-VIEWPORT surface over the app shell, where the
 * coach tour cannot do its job and must not be shown at all.
 *
 * The runner pins itself over the shell with `position: fixed; inset: 0` at
 * `z-index: 60` (runner.css `.rn-page`), which puts it UNDER this tour's
 * `z-[80]` swallower. Every one of the tour's targets — the bottom nav, the
 * More button, the partner-invite section — is shell chrome that the game
 * surface covers, so on a phone the player got a full-screen overlay they
 * could neither complete nor tap through: Start did nothing, every swipe was
 * swallowed, and the only way out was the browser's back gesture. The tour is
 * also about the SHELL's navigation, which a full-screen game does not have.
 *
 * Deliberately not a blanket `/app/games` prefix: the hub and the quiz /
 * markets management pages are ordinary scrolling shell pages, they scroll,
 * and the tour reads perfectly well there. Only a route that hides the shell
 * is exempt. A NEW full-screen game route has to be added here.
 *
 * Note this suppresses the overlay rather than completing the tour, so the
 * player still gets it the moment they leave the game — nothing is skipped,
 * it is only deferred to a screen where it works.
 */
function isFullscreenGameRoute(pathname: string): boolean {
  return pathname === "/app/games/runner" || pathname.startsWith("/app/games/runner/");
}

interface CoachStep {
  /** `data-coach-target` value of the element to highlight. */
  target: string;
  /** i18n key for the headline shown in the tooltip. */
  titleKey: string;
  /** i18n key for the body copy under the headline. */
  bodyKey: string;
  /** Preferred tooltip side. The component flips to the opposite side when
   *  there isn't enough room, but this is the default. */
  side: "top" | "bottom";
}

const STEPS: CoachStep[] = [
  {
    target: "bottom-nav",
    titleKey: "coach.bottom_nav_title",
    bodyKey: "coach.bottom_nav_body",
    side: "top",
  },
  {
    target: "more-button",
    titleKey: "coach.more_button_title",
    bodyKey: "coach.more_button_body",
    side: "top",
  },
  {
    target: "partner-invite",
    titleKey: "coach.partner_invite_title",
    bodyKey: "coach.partner_invite_body",
    side: "bottom",
  },
];

/** Reactive bounding rect for a `[data-coach-target="…"]` element. Recomputes
 *  on resize + scroll so the spotlight tracks the element. Returns null while
 *  the element isn't on screen yet. */
function useTargetRect(target: string): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const update = () => {
      const el = document.querySelector<HTMLElement>(`[data-coach-target="${target}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    // Re-probe a couple of times to catch elements that mount slightly after
    // the page (e.g. partner-invite section hydrates from /api/coupleApi).
    const t1 = window.setTimeout(update, 200);
    const t2 = window.setTimeout(update, 800);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [target]);
  return rect;
}

function hasCompleted(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

function markCompleted() {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* localStorage blocked — the user will see the coach-marks again next
     * load. Better than crashing the page. */
  }
}

export function CoachMarks() {
  const { t } = useT();
  const { pathname } = useLocation();
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  // Decide whether to show on mount: not completed yet AND we're on a mobile
  // viewport. We capture the breakpoint as a one-shot check — flipping it
  // mid-session is unusual and not worth the wiring.
  useEffect(() => {
    if (hasCompleted()) return;
    if (typeof window === "undefined") return;
    if (window.innerWidth >= MOBILE_BREAKPOINT_PX) return;
    // Delay so the bottom nav has time to mount.
    const id = window.setTimeout(() => setActive(true), 400);
    return () => window.clearTimeout(id);
  }, []);

  const step = STEPS[stepIndex];
  const targetRect = useTargetRect(step?.target ?? "");
  const lastStep = stepIndex === STEPS.length - 1;

  const skipMissingStep = useCallback(() => {
    if (!active || !step) return;
    // If a step's target isn't in the DOM (e.g. partner already invited),
    // advance silently to the next step or finish.
    const el = document.querySelector(`[data-coach-target="${step.target}"]`);
    if (!el) {
      if (lastStep) {
        markCompleted();
        setActive(false);
      } else {
        setStepIndex((i) => i + 1);
      }
    }
  }, [active, step, lastStep]);

  useEffect(() => {
    if (!active) return;
    // Run on every step change so a missing partner-invite section skips
    // cleanly forward. Wait a tick so the target rect lookup runs first.
    const id = window.setTimeout(skipMissingStep, 100);
    return () => window.clearTimeout(id);
  }, [active, skipMissingStep]);

  // ESC dismisses the whole flow (treated as "skip" — same as the Skip
  // button, marks complete so we don't pop the overlay back next reload).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        markCompleted();
        setActive(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active]);

  const tooltipPos = useMemo(() => {
    if (!targetRect) return null;
    const margin = 12;
    const tooltipWidth = Math.min(window.innerWidth - 32, 320);
    // Anchor the tooltip's horizontal centre to the target's centre, then
    // clamp to the viewport so the box never spills off the right or left
    // edge on narrow phones.
    const centreX = targetRect.left + targetRect.width / 2;
    const left = Math.max(
      16,
      Math.min(centreX - tooltipWidth / 2, window.innerWidth - tooltipWidth - 16),
    );
    // Default to the preferred side, but flip if there's no room.
    const preferTop = step?.side === "top";
    const roomTop = targetRect.top;
    const roomBottom = window.innerHeight - targetRect.bottom;
    const placeOnTop = preferTop ? roomTop > 200 : roomTop > roomBottom + 120;
    const top = placeOnTop
      ? Math.max(16, targetRect.top - margin - 200)
      : Math.min(window.innerHeight - 220, targetRect.bottom + margin);
    return { left, top, width: tooltipWidth };
  }, [targetRect, step?.side]);

  if (!active || !step) return null;
  // A full-screen game route covers every target this tour points at, so the
  // overlay would be an inescapable blank sheet. Checked HERE rather than in
  // the mount effect on purpose: the player can walk INTO a game while the tour
  // is already up, and the route has to be able to dismiss it mid-flight.
  // Nothing is marked completed, so the tour is waiting on the next shell page.
  if (isFullscreenGameRoute(pathname)) return null;

  const advance = () => {
    if (lastStep) {
      markCompleted();
      setActive(false);
      return;
    }
    setStepIndex((i) => i + 1);
  };
  const skip = () => {
    markCompleted();
    setActive(false);
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] lg:hidden">
      {targetRect ? (
        <>
          {/* Cutout dimmer: a 0-padding rect positioned over the target with
              a huge spread box-shadow that paints the dim everywhere EXCEPT
              inside the rect. The target stays at full brightness so users
              can see exactly what the tooltip is pointing at. Clicks on the
              shadow area dismiss (via the sibling swallower below); clicks
              inside the cutout pass through so the user can also just tap
              the highlighted control to act on it. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute rounded-xl transition-all duration-200"
            style={{
              left: targetRect.left - 4,
              top: targetRect.top - 4,
              width: targetRect.width + 8,
              height: targetRect.height + 8,
              boxShadow: "0 0 0 9999px rgba(28, 25, 23, 0.55)",
            }}
          />
          {/* Click swallower covering the dimmed area only — built from four
              strips around the cutout so the target itself stays tappable. */}
          <div
            className="absolute inset-x-0 top-0"
            style={{ height: Math.max(0, targetRect.top - 4) }}
            onClick={skip}
          />
          <div
            className="absolute inset-x-0 bottom-0"
            style={{ top: targetRect.bottom + 4 }}
            onClick={skip}
          />
          <div
            className="absolute left-0"
            style={{
              top: Math.max(0, targetRect.top - 4),
              width: Math.max(0, targetRect.left - 4),
              height: targetRect.height + 8,
            }}
            onClick={skip}
          />
          <div
            className="absolute right-0"
            style={{
              top: Math.max(0, targetRect.top - 4),
              left: targetRect.right + 4,
              height: targetRect.height + 8,
            }}
            onClick={skip}
          />
          {/* Highlight ring around the target. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute rounded-xl ring-4 ring-blush-400 ring-offset-2 ring-offset-paper-50 transition-all duration-200 dark:ring-offset-umber-900"
            style={{
              left: targetRect.left - 4,
              top: targetRect.top - 4,
              width: targetRect.width + 8,
              height: targetRect.height + 8,
            }}
          />
        </>
      ) : (
        // No target rect yet — fall back to a full dim so the tooltip
        // doesn't sit on top of a fully interactive page. The next render
        // (once the rect is measured) will swap in the cutout.
        <div className="absolute inset-0 bg-ink-900/55" onClick={skip} />
      )}

      {/* Tooltip. Stops propagation so the buttons inside aren't read as a
          backdrop tap (which would dismiss). */}
      {tooltipPos && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="coach-title"
          aria-describedby="coach-body"
          className="absolute rounded-2xl border border-paper-300 bg-paper-50 p-4 shadow-pop dark:border-umber-700 dark:bg-umber-800"
          style={{ left: tooltipPos.left, top: tooltipPos.top, width: tooltipPos.width }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-blush-700 dark:text-blush-300">
              {t("coach.step_position", {
                current: String(stepIndex + 1),
                total: String(STEPS.length),
              })}
            </div>
            <button
              type="button"
              onClick={skip}
              aria-label={t("coach.skip")}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-500 hover:bg-paper-200 hover:text-ink-800 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
          <h2
            id="coach-title"
            className="mt-1 text-base font-semibold text-ink-900 dark:text-paper-50"
          >
            {t(step.titleKey)}
          </h2>
          <p id="coach-body" className="mt-1 text-sm text-ink-700 dark:text-paper-100">
            {t(step.bodyKey)}
          </p>
          <div className="mt-4 flex items-center justify-between gap-2">
            <button type="button" className="btn-ghost btn-sm" onClick={skip}>
              {t("coach.skip")}
            </button>
            <button type="button" className="btn-primary btn-sm" onClick={advance}>
              {lastStep ? t("coach.done") : t("coach.next")}
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
