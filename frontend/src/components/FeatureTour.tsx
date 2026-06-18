// Spotlight-based feature tour triggered from the Sparkles button in the top nav.
// Walks through key Weddly surfaces, highlighting the matching sidebar/bottom-nav link.
// Works on desktop (sidebar) and mobile (bottom-nav or centered card when no link visible).

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
import { useT } from "../lib/i18n";
import { useLocation } from "react-router-dom";

interface TourStep {
  href: string;
  titleKey: string;
  bodyKey: string;
  icon: ReactNode;
}

const STEPS: TourStep[] = [
  {
    href: "/app",
    titleKey: "tour.dashboard_title",
    bodyKey: "tour.dashboard_body",
    icon: <LayoutDashboard size={20} />,
  },
  {
    href: "/app/guests",
    titleKey: "tour.guests_title",
    bodyKey: "tour.guests_body",
    icon: <Users size={20} />,
  },
  {
    href: "/app/budget",
    titleKey: "tour.budget_title",
    bodyKey: "tour.budget_body",
    icon: <Coins size={20} />,
  },
  {
    href: "/app/vendors",
    titleKey: "tour.vendors_title",
    bodyKey: "tour.vendors_body",
    icon: <Store size={20} />,
  },
  {
    href: "/app/planning",
    titleKey: "tour.planning_title",
    bodyKey: "tour.planning_body",
    icon: <ClipboardList size={20} />,
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
  },
  {
    href: "/app/seating",
    titleKey: "tour.seating_title",
    bodyKey: "tour.seating_body",
    icon: <Armchair size={20} />,
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
  },
];

const CARD_W = 296;

// Find the nav link element for a given route href, preferring visible elements.
// Sidebar links are display:none on mobile (rect=0), so rect check distinguishes desktop from mobile.
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

function useTargetRect(href: string, active: boolean): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!active) return;
    const update = () => {
      const el = findNavTarget(href);
      setRect(el ? (el as HTMLElement).getBoundingClientRect() : null);
    };
    update();
    const t1 = window.setTimeout(update, 80);
    const t2 = window.setTimeout(update, 320);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [href, active]);
  return rect;
}

function computeCardPos(targetRect: DOMRect | null): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 20;
  const cardH = 268;

  if (!targetRect) {
    return {
      left: Math.max(16, (vw - CARD_W) / 2),
      top: Math.max(80, (vh - cardH) / 2),
    };
  }

  // Target in a tall bottom-nav strip → place card above it, horizontally centered
  if (targetRect.height > 60) {
    return {
      left: Math.max(16, Math.min((vw - CARD_W) / 2, vw - CARD_W - 16)),
      top: Math.max(16, targetRect.top - cardH - gap),
    };
  }

  // Target on the left (sidebar) → place card to the right
  if (targetRect.left < vw * 0.45) {
    const left = Math.min(targetRect.right + gap, vw - CARD_W - 16);
    const top = Math.max(
      80,
      Math.min(vh - cardH - 16, targetRect.top + targetRect.height / 2 - cardH / 2),
    );
    return { left, top };
  }

  // Target on the right → place card to the left
  const left = Math.max(16, targetRect.left - CARD_W - gap);
  const top = Math.max(
    80,
    Math.min(vh - cardH - 16, targetRect.top + targetRect.height / 2 - cardH / 2),
  );
  return { left, top };
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function FeatureTour({ open, onClose }: Props) {
  const { t } = useT();
  const location = useLocation();
  const [stepIndex, setStepIndex] = useState(0);
  const [fade, setFade] = useState<"in" | "out">("in");
  const fadeTimer = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      const matchIdx = STEPS.findIndex((s) =>
        s.href === "/app" ? location.pathname === "/app" : location.pathname.startsWith(s.href),
      );
      setStepIndex(matchIdx >= 0 ? matchIdx : 0);
      setFade("in");
    }
    return () => {
      if (fadeTimer.current) window.clearTimeout(fadeTimer.current);
    };
  }, [open, location.pathname]);

  const step = STEPS[stepIndex];
  const targetRect = useTargetRect(step?.href ?? "", open);
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;

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
      {/* Dim backdrop */}
      <div className="absolute inset-0 bg-ink-900/60" onClick={onClose} />

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
        {/* Icon badge + counter + close */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-ink-700 dark:text-paper-200">
              {step.icon}
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
              {t("tour.step_position", {
                current: String(stepIndex + 1),
                total: String(STEPS.length),
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
          {STEPS.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Step ${i + 1}`}
              onClick={() => i !== stepIndex && goTo(i)}
              className={`h-1.5 rounded-full transition-all duration-200 ${
                i === stepIndex
                  ? "w-5 bg-ink-900 dark:bg-paper-100"
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
