// Context-aware feature tour triggered from the Compass button in the top nav.
// When on a known page, shows that page's own feature steps (2-4 deep).
// From an unrecognised path it falls back to the global overview (one step per surface).

import {
  Armchair,
  Bed,
  CalendarClock,
  Camera,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Coins,
  GanttChartSquare,
  Gift,
  Globe,
  Image as ImageIcon,
  LayoutDashboard,
  Palette,
  Plane,
  Store,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useT } from "../lib/i18n";

interface PageSubStep {
  titleKey: string;
  bodyKey: string;
  target?: string;
}

interface TourStep {
  href: string;
  titleKey: string;
  bodyKey: string;
  icon: ReactNode;
  target?: string;
  // When present, clicking Compass on this page uses these steps instead of the global blurb.
  pageSteps?: PageSubStep[];
}

const STEPS: TourStep[] = [
  {
    href: "/app",
    titleKey: "tour.dashboard_title",
    bodyKey: "tour.dashboard_body",
    icon: <LayoutDashboard size={20} />,
    pageSteps: [
      {
        titleKey: "tour.dashboard_p1_title",
        bodyKey: "tour.dashboard_p1_body",
        target: "dashboard-kpi",
      },
      {
        titleKey: "tour.dashboard_p2_title",
        bodyKey: "tour.dashboard_p2_body",
        target: "dashboard-budget",
      },
      { titleKey: "tour.dashboard_p3_title", bodyKey: "tour.dashboard_p3_body" },
    ],
  },
  {
    href: "/app/guests",
    titleKey: "tour.guests_title",
    bodyKey: "tour.guests_body",
    icon: <Users size={20} />,
    pageSteps: [
      { titleKey: "tour.guests_p1_title", bodyKey: "tour.guests_p1_body", target: "guests-tools" },
      { titleKey: "tour.guests_p2_title", bodyKey: "tour.guests_p2_body", target: "guests-search" },
      { titleKey: "tour.guests_p3_title", bodyKey: "tour.guests_p3_body" }, // no dedicated meal-filter element
      { titleKey: "tour.guests_p4_title", bodyKey: "tour.guests_p4_body", target: "guests-tools" },
    ],
  },
  {
    href: "/app/budget",
    titleKey: "tour.budget_title",
    bodyKey: "tour.budget_body",
    icon: <Coins size={20} />,
    pageSteps: [
      { titleKey: "tour.budget_p1_title", bodyKey: "tour.budget_p1_body", target: "budget-header" },
      { titleKey: "tour.budget_p2_title", bodyKey: "tour.budget_p2_body", target: "budget-lines" },
      { titleKey: "tour.budget_p3_title", bodyKey: "tour.budget_p3_body", target: "budget-table" },
    ],
  },
  {
    href: "/app/vendors",
    titleKey: "tour.vendors_title",
    bodyKey: "tour.vendors_body",
    icon: <Store size={20} />,
    pageSteps: [
      {
        titleKey: "tour.vendors_p1_title",
        bodyKey: "tour.vendors_p1_body",
        target: "vendors-search",
      },
      {
        titleKey: "tour.vendors_p2_title",
        bodyKey: "tour.vendors_p2_body",
        target: "vendors-list",
      },
      {
        titleKey: "tour.vendors_p3_title",
        bodyKey: "tour.vendors_p3_body",
        target: "vendors-list",
      },
    ],
  },
  {
    href: "/app/planning",
    titleKey: "tour.planning_title",
    bodyKey: "tour.planning_body",
    icon: <ClipboardList size={20} />,
    pageSteps: [
      {
        titleKey: "tour.planning_p1_title",
        bodyKey: "tour.planning_p1_body",
        target: "planning-tabs",
      },
      {
        titleKey: "tour.planning_p2_title",
        bodyKey: "tour.planning_p2_body",
        target: "planning-tabs",
      },
      {
        titleKey: "tour.planning_p3_title",
        bodyKey: "tour.planning_p3_body",
        target: "planning-tabs",
      },
    ],
  },
  {
    href: "/app/timeline",
    titleKey: "tour.timeline_title",
    bodyKey: "tour.timeline_body",
    icon: <GanttChartSquare size={20} />,
  },
  {
    href: "/app/schedule",
    titleKey: "tour.schedule_title",
    bodyKey: "tour.schedule_body",
    icon: <CalendarClock size={20} />,
    pageSteps: [
      {
        titleKey: "tour.schedule_p1_title",
        bodyKey: "tour.schedule_p1_body",
        target: "schedule-toolbar",
      },
      {
        titleKey: "tour.schedule_p2_title",
        bodyKey: "tour.schedule_p2_body",
        target: "schedule-events",
      },
      {
        titleKey: "tour.schedule_p3_title",
        bodyKey: "tour.schedule_p3_body",
        target: "schedule-toolbar",
      },
    ],
  },
  {
    href: "/app/seating",
    titleKey: "tour.seating_title",
    bodyKey: "tour.seating_body",
    icon: <Armchair size={20} />,
    pageSteps: [
      {
        titleKey: "tour.seating_p1_title",
        bodyKey: "tour.seating_p1_body",
        target: "seating-canvas",
      },
      {
        titleKey: "tour.seating_p2_title",
        bodyKey: "tour.seating_p2_body",
        target: "seating-modes",
      },
      {
        titleKey: "tour.seating_p3_title",
        bodyKey: "tour.seating_p3_body",
        target: "seating-unassigned",
      },
      {
        titleKey: "tour.seating_p4_title",
        bodyKey: "tour.seating_p4_body",
        target: "seating-export",
      },
    ],
  },
  {
    href: "/app/logistics",
    titleKey: "tour.logistics_title",
    bodyKey: "tour.logistics_body",
    icon: <Bed size={20} />,
  },
  {
    href: "/app/moodboard",
    titleKey: "tour.moodboard_title",
    bodyKey: "tour.moodboard_body",
    icon: <ImageIcon size={20} />,
  },
  {
    href: "/app/design",
    titleKey: "tour.design_title",
    bodyKey: "tour.design_body",
    icon: <Palette size={20} />,
    pageSteps: [
      { titleKey: "tour.design_p1_title", bodyKey: "tour.design_p1_body", target: "design-style" },
      { titleKey: "tour.design_p2_title", bodyKey: "tour.design_p2_body", target: "design-tabs" },
      { titleKey: "tour.design_p3_title", bodyKey: "tour.design_p3_body", target: "design-tabs" },
    ],
  },
  {
    href: "/app/honeymoon",
    titleKey: "tour.honeymoon_title",
    bodyKey: "tour.honeymoon_body",
    icon: <Plane size={20} />,
  },
  {
    href: "/app/media",
    titleKey: "tour.media_title",
    bodyKey: "tour.media_body",
    icon: <Camera size={20} />,
  },
  {
    href: "/app/wishlist",
    titleKey: "tour.wishlist_title",
    bodyKey: "tour.wishlist_body",
    icon: <Gift size={20} />,
  },
  {
    href: "/app/guest-page",
    titleKey: "tour.guest_page_title",
    bodyKey: "tour.guest_page_body",
    icon: <Globe size={20} />,
    pageSteps: [
      {
        titleKey: "tour.guest_page_p1_title",
        bodyKey: "tour.guest_page_p1_body",
        target: "guest-page-preview",
      },
      {
        titleKey: "tour.guest_page_p2_title",
        bodyKey: "tour.guest_page_p2_body",
        target: "guest-page-preview",
      },
      {
        titleKey: "tour.guest_page_p3_title",
        bodyKey: "tour.guest_page_p3_body",
        target: "guest-page-preview",
      },
    ],
  },
];

function buildActiveSteps(pathname: string): { steps: TourStep[]; initialIndex: number } {
  const matchedIdx = STEPS.findIndex((s) =>
    s.href === "/app" ? pathname === "/app" : pathname.startsWith(s.href),
  );
  if (matchedIdx >= 0) {
    const matched = STEPS[matchedIdx];
    if (matched?.pageSteps) {
      return {
        steps: matched.pageSteps.map((ps) => ({
          // When there is no page-element target, clear the href so the nav-link
          // fallback in useTargetRect doesn't spotlight the sidebar item and push
          // the card into the top-left corner of the content area.
          href: ps.target ? matched.href : "",
          icon: matched.icon,
          titleKey: ps.titleKey,
          bodyKey: ps.bodyKey,
          target: ps.target,
        })),
        initialIndex: 0,
      };
    }
    // WIP page — use the global list but land on this page's step.
    return { steps: STEPS, initialIndex: matchedIdx };
  }
  return { steps: STEPS, initialIndex: 0 };
}

const CARD_W = 296;

function findPageTarget(target: string): Element | null {
  const el = document.querySelector(`[data-tour-target="${target}"]`);
  if (!el) return null;
  const r = (el as HTMLElement).getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? el : null;
}

function findNavTarget(href: string): Element | null {
  const visible = (el: Element | null): Element | null => {
    if (!el) return null;
    const r = (el as HTMLElement).getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? el : null;
  };
  return (
    visible(document.querySelector(`aside a[href="${href}"]`)) ??
    visible(document.querySelector(`[data-coach-target="bottom-nav"] a[href="${href}"]`)) ??
    null
  );
}

function useTargetRect(href: string, active: boolean, target?: string): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!active) return;
    const findEl = () => (target ? findPageTarget(target) : findNavTarget(href));
    const update = () => {
      const el = findEl();
      setRect(el ? (el as HTMLElement).getBoundingClientRect() : null);
    };
    // Scroll the spotlighted element into view once when this step activates.
    // Without this, a target below the fold leaves the user staring at a dimmed
    // screen with no visible highlight (it's down-page) — so the tour reads as
    // "the screen just greyed out". Only scroll when it isn't already fully on
    // screen, to avoid a needless jiggle for targets that are already visible.
    // The scroll listener below keeps the spotlight glued to the element while
    // the smooth scroll plays out, so the cutout animates onto the target.
    const el = findEl();
    if (el) {
      const r = (el as HTMLElement).getBoundingClientRect();
      const HEADER_H = 64; // sticky app header height — keep the target clear of it.
      const fullyVisible = r.top >= HEADER_H && r.bottom <= window.innerHeight - 8;
      if (!fullyVisible) {
        (el as HTMLElement).scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "nearest",
        });
      }
    }
    update();
    const t1 = window.setTimeout(update, 80);
    const t2 = window.setTimeout(update, 320);
    // Settle pass after the smooth scroll finishes, so the final rect is exact
    // even if the scroll listener missed the last frame.
    const t3 = window.setTimeout(update, 650);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [href, active, target]);
  return rect;
}

function computeCardPos(targetRect: DOMRect | null): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 16;
  const cardH = 268;

  if (!targetRect) {
    return {
      left: Math.max(16, (vw - CARD_W) / 2),
      top: Math.max(80, (vh - cardH) / 2),
    };
  }

  // Clamp rect to the visible viewport so off-screen elements don't mislead placement.
  const visTop = Math.max(0, targetRect.top);
  const visBottom = Math.min(vh, targetRect.bottom);
  const visLeft = Math.max(0, targetRect.left);
  const visRight = Math.min(vw, targetRect.right);
  const visCenterX = (visLeft + visRight) / 2;
  const visCenterY = (visTop + visBottom) / 2;
  const visWidth = visRight - visLeft;

  // Tall bottom-nav strip → place card above it, horizontally centered.
  if (targetRect.height > 60 && targetRect.bottom > vh * 0.7) {
    return {
      left: Math.max(16, Math.min((vw - CARD_W) / 2, vw - CARD_W - 16)),
      top: Math.max(16, targetRect.top - cardH - gap),
    };
  }

  // Wide element (>55% of viewport) → place below when there's room, else above.
  if (visWidth > vw * 0.55) {
    const belowTop = visBottom + gap;
    const aboveTop = visTop - cardH - gap;
    const left = Math.max(16, Math.min(visLeft + 16, vw - CARD_W - 16));
    if (belowTop + cardH < vh - 8) return { left, top: belowTop };
    return { left, top: Math.max(80, aboveTop) };
  }

  // Small/narrow element anchored near the top (toolbars, mode tabs) → place below.
  if (visTop < vh * 0.25 && visBottom < vh * 0.35) {
    return {
      left: Math.max(16, Math.min(visCenterX - CARD_W / 2, vw - CARD_W - 16)),
      top: visBottom + gap,
    };
  }

  // Element on the left half → place card to the right.
  if (visLeft < vw * 0.45) {
    const left = Math.min(visRight + gap, vw - CARD_W - 16);
    const top = Math.max(80, Math.min(vh - cardH - 16, visCenterY - cardH / 2));
    return { left, top };
  }

  // Element on the right half → place card to the left.
  const left = Math.max(16, visLeft - CARD_W - gap);
  const top = Math.max(80, Math.min(vh - cardH - 16, visCenterY - cardH / 2));
  return { left, top };
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function FeatureTour({ open, onClose }: Props) {
  const { t } = useT();
  const location = useLocation();
  const [activeSteps, setActiveSteps] = useState<TourStep[]>(
    () => buildActiveSteps(location.pathname).steps,
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [fade, setFade] = useState<"in" | "out">("in");
  const fadeTimer = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      const { steps, initialIndex } = buildActiveSteps(location.pathname);
      setActiveSteps(steps);
      setStepIndex(initialIndex);
      setFade("in");
    }
    return () => {
      if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
    };
  }, [open, location.pathname]);

  const step = activeSteps[stepIndex];
  const targetRect = useTargetRect(step?.href ?? "", open, step?.target);
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === activeSteps.length - 1;

  const goTo = useCallback((next: number) => {
    if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
    setFade("out");
    fadeTimer.current = window.setTimeout(() => {
      setStepIndex(next);
      setFade("in");
    }, 150);
  }, []);

  const advance = useCallback(() => {
    if (isLast) {
      onClose();
      return;
    }
    goTo(stepIndex + 1);
  }, [isLast, stepIndex, goTo, onClose]);

  const goBack = useCallback(() => {
    if (!isFirst) goTo(stepIndex - 1);
  }, [isFirst, stepIndex, goTo]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") advance();
      else if (e.key === "ArrowLeft") goBack();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [open, advance, goBack, onClose]);

  const cardPos = useMemo(() => computeCardPos(targetRect), [targetRect]);

  if (!open || !step) return null;

  const pad = 5;
  const spotStyle = targetRect
    ? {
        left: targetRect.left - pad,
        top: targetRect.top - pad,
        width: targetRect.width + pad * 2,
        height: targetRect.height + pad * 2,
      }
    : null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("tour.aria_label")}
      className="fixed inset-0 z-[90]"
    >
      {/* Dim backdrop. When a target is spotlighted, the cutout div below dims
          the whole screen via its huge box-shadow spread and leaves the target
          as a bright hole — so we keep this layer transparent (click-to-close
          only). Painting bg-ink-900/60 here too would re-dim the spotlighted
          element, so the "highlighted place" never reads as fully bright.
          Without a spotlight (centered card) we still need the full dim. */}
      <div
        className={`absolute inset-0 ${spotStyle ? "" : "bg-ink-900/60"}`}
        onClick={onClose}
      />

      {/* Spotlight cutout + ring */}
      {spotStyle && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute rounded-xl transition-all duration-300 ease-out"
            style={{
              ...spotStyle,
              boxShadow: "0 0 0 9999px rgba(28, 25, 23, 0.65)",
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute rounded-xl ring-2 ring-ink-700 ring-offset-1 transition-all duration-300 ease-out dark:ring-paper-100"
            style={spotStyle}
          />
        </>
      )}

      {/* Feature card */}
      <div
        className="absolute rounded-2xl border border-paper-300 bg-paper-50 p-5 shadow-pop dark:border-umber-700 dark:bg-umber-900"
        style={{
          left: cardPos.left,
          top: cardPos.top,
          width: CARD_W,
          opacity: fade === "in" ? 1 : 0,
          transform: fade === "in" ? "translateY(0)" : "translateY(4px)",
          transition: "opacity 150ms ease, transform 150ms ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon + counter + close */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-ink-700 dark:text-paper-200">
              {step.icon}
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
              {t("tour.step_position", {
                current: String(stepIndex + 1),
                total: String(activeSteps.length),
              })}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("a11y.close")}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-800 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
          >
            <X size={15} aria-hidden />
          </button>
        </div>

        {/* Title + body */}
        <h2 className="mt-3 text-sm font-semibold text-ink-900 dark:text-paper-50">
          {t(step.titleKey)}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-600 dark:text-paper-200">
          {t(step.bodyKey)}
        </p>

        {/* Dot progress */}
        <div className="mt-4 flex justify-center gap-1.5">
          {activeSteps.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Step ${i + 1}`}
              onClick={() => i !== stepIndex && goTo(i)}
              className={`h-1.5 rounded-full transition-all duration-200 ${
                i === stepIndex
                  ? "w-5 bg-blush-500 dark:bg-paper-100"
                  : "w-1.5 bg-paper-400 hover:bg-paper-500 dark:bg-umber-600 dark:hover:bg-umber-500"
              }`}
            />
          ))}
        </div>

        {/* Navigation */}
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={goBack}
            disabled={isFirst}
            aria-label={t("common.back")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-200 disabled:opacity-25 dark:text-umber-300 dark:hover:bg-umber-700"
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm text-xs">
            {t("tour.skip")}
          </button>
          <button
            type="button"
            onClick={advance}
            className="btn-primary btn-sm inline-flex items-center gap-1 text-xs"
          >
            {isLast ? t("tour.done") : t("tour.next")}
            {!isLast && <ChevronRight size={13} aria-hidden />}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
