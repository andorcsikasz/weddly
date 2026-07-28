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

import { ArrowLeft, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Couple } from "@shared/types";
import { useAuth } from "../lib/auth";
import { clearDemoSessionFlag, isCurrentSessionDemo } from "../lib/demoSession";
import { coupleApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

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

  const exitDemo = async (destination: "/" | "/signup") => {
    stampNudgeLastSeen();
    setNudgeOpen(false);
    // Sign the demo session out before we hand the visitor anywhere — both
    // /signup's RedirectIfAuthed and /'s public shell would otherwise still
    // see the active demo token and bounce them back into /app.
    clearDemoSessionFlag();
    try {
      await logout();
    } catch {
      // logout already swallows errors; fall through to navigate
    }
    navigate(destination);
  };

  const convert = () => exitDemo("/signup");
  const goHome = () => exitDemo("/");

  if (!isDemo) return null;

  return (
    <>
      {/* Banner — sticks above the AppShell header. Dismissable, reappears on
          reload (kept intentional so the demo nature stays unmissable). */}
      {!bannerDismissed && (
        <div
          role="status"
          aria-live="polite"
          data-banner
          className="sticky top-0 z-30 border-b border-sage-300 bg-sage-100 px-4 py-2 text-sm text-ink-800 dark:border-sage-700/60 dark:bg-sage-900/40 dark:text-paper-100"
        >
          <div className="mx-auto flex max-w-7xl items-center gap-3 sm:gap-4">
            <Sparkles
              size={16}
              aria-hidden="true"
              className="shrink-0 text-sage-700 dark:text-sage-300"
            />
            <div className="min-w-0 flex-1 truncate font-semibold">{t("demo.banner_title")}</div>
            <button
              type="button"
              onClick={goHome}
              className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-ink-700 underline decoration-sage-400 decoration-1 underline-offset-4 transition-colors hover:text-ink-900 hover:decoration-sage-600 dark:text-paper-200 dark:decoration-sage-500 dark:hover:text-paper-50"
            >
              <ArrowLeft size={12} aria-hidden="true" />
              {t("demo.banner_exit")}
            </button>
            <button
              type="button"
              onClick={() => setNudgeOpen(true)}
              className="hidden shrink-0 rounded-full bg-ink-900 px-3 py-1 text-xs font-semibold text-paper-50 transition-colors hover:bg-ink-700 dark:bg-paper-100 dark:text-umber-900 dark:hover:bg-paper-200 sm:inline-flex"
            >
              {t("demo.banner_cta")}
            </button>
            <button
              type="button"
              onClick={() => setBannerDismissed(true)}
              aria-label={t("demo.banner_dismiss_aria")}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-sage-200 hover:text-ink-900 dark:text-paper-200 dark:hover:bg-sage-800/60"
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
      <div className="relative w-full max-w-md overflow-hidden rounded-t-3xl bg-paper-50 ring-1 ring-paper-300 shadow-pop sm:rounded-3xl dark:bg-umber-800 dark:ring-umber-700">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:text-paper-300 dark:hover:bg-umber-700 dark:focus-visible:ring-paper-100"
          aria-label={t("demo.banner_dismiss_aria")}
        >
          <X size={16} aria-hidden="true" />
        </button>
        <div className="p-7 text-center sm:p-9">
          <h2
            id="demo-nudge-title"
            className="font-grotesk text-3xl italic leading-[1.05] text-ink-900 dark:text-paper-50 sm:text-4xl"
          >
            {t("demo.popup_title")}
          </h2>
          <p className="mt-4 font-grotesk text-base leading-relaxed text-ink-700 dark:text-paper-100">
            {t("demo.popup_body")}
          </p>
          <button
            type="button"
            onClick={onConvert}
            className="btn-primary btn-lg mt-6 inline-flex w-full items-center justify-center gap-2 shadow-sm"
          >
            {t("demo.popup_cta")}
          </button>
          <p className="mt-3 text-xs text-ink-500 dark:text-umber-300">
            {t("demo.popup_microcopy")}
          </p>
        </div>
      </div>
    </div>
  );
}
