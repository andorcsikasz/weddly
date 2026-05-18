// Persistent demo banner + nudge popup. Lives inside /app whenever the
// active couple is a demo workspace (`couple.is_demo === true`).
//
// Two surfaces:
//
//   1. Slim banner across the top — "Shrek & Fiona demo · changes vanish on
//      sign-out · Start your own". Dismissable; reappears on every reload.
//
//   2. A nudge popup that fires after ~3 minutes of demo usage with a
//      Shrek-flavoured "the prince may not arrive on a white horse, but
//      it's time to start your happily ever after" line. CTA → /signup.
//      Dismissal stamps a localStorage cooldown so it doesn't pester
//      every navigation.

import { ArrowRight, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Couple } from "@shared/types";
import { useAuth } from "../lib/auth";
import { coupleApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { clearDemoSessionFlag, isCurrentSessionDemo } from "./DemoLaunchCard";

/** Fire the conversion popup after this many ms of session activity. */
const NUDGE_DELAY_MS = 3 * 60 * 1000;
/** Cooldown after the user dismisses the popup — don't bug them every nav. */
const NUDGE_COOLDOWN_MS = 4 * 60 * 1000;

const NUDGE_LAST_SEEN_KEY = "weddly.demo_nudge_last_seen";

function readNudgeLastSeen(): number {
  try {
    const raw = localStorage.getItem(NUDGE_LAST_SEEN_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function stampNudgeLastSeen() {
  try {
    localStorage.setItem(NUDGE_LAST_SEEN_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

export function DemoOverlay() {
  const { t } = useT();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [couple, setCouple] = useState<Couple | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [nudgeOpen, setNudgeOpen] = useState(false);

  // Quick-path detection: the landing card stamps a localStorage flag the
  // moment /api/demo/start returns, so we already know the active session
  // is a demo before /api/couples/current resolves. The server response is
  // the source of truth and overrides the flag on the next tick.
  const looksLikeDemo = isCurrentSessionDemo();

  // Fetch the active couple to confirm is_demo. We deliberately don't share
  // state with the rest of the app via a context — the demo overlay reads
  // once on mount + on user change, which is enough since the demo couple
  // never changes its is_demo flag mid-session.
  useEffect(() => {
    if (!user) {
      setCouple(null);
      return;
    }
    let cancelled = false;
    coupleApi
      .current()
      .then((res) => {
        if (cancelled) return;
        setCouple(res.couple);
        if (!res.couple?.is_demo) {
          // Couple isn't a demo — clear the stale local flag so a real user
          // landing on this device doesn't see the banner.
          clearDemoSessionFlag();
        }
      })
      .catch(() => {
        /* non-critical — the banner just won't render */
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const isDemo = couple?.is_demo === true || (looksLikeDemo && couple === null);

  // Schedule the conversion popup. Fires once per NUDGE_COOLDOWN_MS window —
  // dismissal stamps a localStorage timestamp so a refresh / navigation
  // doesn't immediately re-open it.
  useEffect(() => {
    if (!isDemo) return;
    const elapsed = Date.now() - readNudgeLastSeen();
    const delay = Math.max(NUDGE_DELAY_MS - elapsed, NUDGE_DELAY_MS);
    const timer = window.setTimeout(() => {
      if (Date.now() - readNudgeLastSeen() < NUDGE_COOLDOWN_MS) return;
      setNudgeOpen(true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [isDemo]);

  const closeNudge = () => {
    stampNudgeLastSeen();
    setNudgeOpen(false);
  };

  const convert = async () => {
    stampNudgeLastSeen();
    setNudgeOpen(false);
    // Sign the demo session out before we hand the visitor to /signup so the
    // registration form doesn't think they're already authenticated and the
    // RedirectIfAuthed gate bounces them back into the demo workspace.
    clearDemoSessionFlag();
    try {
      await logout();
    } catch {
      // logout already swallows errors; fall through to navigate
    }
    navigate("/signup");
  };

  if (!isDemo) return null;

  return (
    <>
      {/* Banner — sticks above the AppShell header. Dismissable, reappears on
          reload (kept intentional so the demo nature stays unmissable). */}
      {!bannerDismissed && (
        <div
          role="status"
          aria-live="polite"
          className="sticky top-0 z-30 border-b border-blush-200 bg-gradient-to-r from-blush-100 via-blush-50 to-blush-100 px-4 py-2 text-sm text-ink-800 shadow-sm dark:border-blush-700/40 dark:from-umber-800 dark:via-umber-900 dark:to-umber-800 dark:text-paper-100"
        >
          <div className="mx-auto flex max-w-7xl items-center gap-3 sm:gap-4">
            <Sparkles
              size={16}
              aria-hidden="true"
              className="shrink-0 text-blush-700 dark:text-blush-300"
            />
            <div className="min-w-0 flex-1 truncate font-semibold">
              {t("demo.banner_title")}
            </div>
            <button
              type="button"
              onClick={() => setNudgeOpen(true)}
              className="hidden shrink-0 rounded-full bg-ink-900 px-3 py-1 text-xs font-semibold text-paper-50 transition-colors hover:bg-ink-700 dark:bg-paper-100 dark:text-umber-900 dark:hover:bg-blush-200 sm:inline-flex"
            >
              {t("demo.banner_cta")}
            </button>
            <button
              type="button"
              onClick={() => setBannerDismissed(true)}
              aria-label={t("demo.banner_dismiss_aria")}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-blush-200/60 hover:text-ink-900 dark:text-paper-200 dark:hover:bg-umber-700"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {nudgeOpen && <DemoNudgeModal onClose={closeNudge} onConvert={convert} />}
    </>
  );
}

function DemoNudgeModal({ onClose, onConvert }: { onClose: () => void; onConvert: () => void }) {
  const { t } = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-nudge-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/45 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg overflow-hidden rounded-t-3xl bg-paper-50 shadow-pop ring-1 ring-paper-300 sm:rounded-3xl dark:bg-umber-800 dark:ring-umber-700">
        {/* Watercolor accent — keeps the popup feeling on-brand instead of
            looking like a generic JS confirm. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-blush-200/70 blur-2xl dark:bg-blush-700/30"
        />
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-900 dark:text-paper-300 dark:hover:bg-umber-700"
          aria-label={t("demo.banner_dismiss_aria")}
        >
          <X size={16} aria-hidden="true" />
        </button>
        <div className="relative p-7 sm:p-9">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-700 dark:text-blush-300">
            {t("demo.popup_eyebrow")}
          </p>
          <h2
            id="demo-nudge-title"
            className="mt-3 font-serif text-3xl italic leading-[1.05] text-ink-900 dark:text-paper-50 sm:text-4xl"
          >
            {t("demo.popup_title")}
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-ink-700 dark:text-paper-100 sm:text-base">
            {t("demo.popup_body")}
          </p>
          <p className="mt-3 font-serif text-sm italic text-ink-500 dark:text-umber-300">
            {t("demo.popup_signoff")}
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={onConvert}
              className="btn-primary btn-lg inline-flex w-full items-center justify-center gap-2 shadow-sm sm:w-auto"
            >
              {t("demo.popup_cta_primary")}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
            <button type="button" onClick={onClose} className="btn-outline btn-lg w-full sm:w-auto">
              {t("demo.popup_cta_secondary")}
            </button>
          </div>
          <p className="mt-4 text-xs text-ink-500 dark:text-umber-300">
            {t("demo.popup_seen_again_in")}
          </p>
        </div>
      </div>
    </div>
  );
}
