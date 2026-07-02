// Planner-side demo banner + conversion nudge. Lives inside /app/planner
// whenever the active session is the "Fairy Godmother Weddings" demo.
//
// Detection is authoritative and network-free: the demo planner's email always
// ends in `@demo.weddly.local` (the same predicate the backend sweeps reap by),
// and the auth user is already in context — so no /api round-trip and no risk
// of a stale localStorage flag mislabelling a real planner.
//
// Two surfaces, mirroring the couple DemoOverlay:
//   1. A top bar — "Fairy Godmother Weddings demo · changes vanish · start your
//      own". Placed above the sticky header in normal flow so it scrolls away
//      instead of fighting the header for top:0.
//   2. A nudge popup after ~3 minutes → /planners (start your own).

import { ArrowLeft, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { clearDemoSessionFlag } from "../lib/demoSession";
import { useT } from "../lib/i18n";

const NUDGE_DELAY_MS = 3 * 60 * 1000;
const NUDGE_COOLDOWN_MS = 4 * 60 * 1000;
const NUDGE_LAST_SEEN_KEY = "weddly.planner_demo_nudge_last_seen";

const DEMO_EMAIL_SUFFIX = "@demo.weddly.local";

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

export function PlannerDemoOverlay() {
  const { t } = useT();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [nudgeOpen, setNudgeOpen] = useState(false);

  const isDemo =
    user?.user_type === "planner" && user.email.toLowerCase().endsWith(DEMO_EMAIL_SUFFIX);

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

  const exitDemo = async (destination: "/planners" | "/signup") => {
    stampNudgeLastSeen();
    setNudgeOpen(false);
    clearDemoSessionFlag();
    try {
      await logout();
    } catch {
      // logout swallows errors; fall through to navigate
    }
    navigate(destination);
  };

  if (!isDemo) return null;

  return (
    <>
      {!bannerDismissed && (
        <div
          role="status"
          aria-live="polite"
          className="border-b border-paper-300 bg-paper-100 px-4 py-2 text-sm text-ink-800 dark:border-umber-700 dark:bg-umber-800/70 dark:text-paper-100"
        >
          <div className="mx-auto flex max-w-7xl items-center gap-3 sm:gap-4">
            <Sparkles
              size={16}
              aria-hidden="true"
              className="shrink-0 text-umber-500 dark:text-umber-300"
            />
            <div className="min-w-0 flex-1 truncate font-semibold">
              {t("planner_demo.banner_title")}
            </div>
            <button
              type="button"
              onClick={() => exitDemo("/planners")}
              className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-ink-700 underline decoration-paper-400 decoration-1 underline-offset-4 transition-colors hover:text-ink-900 hover:decoration-umber-400 dark:text-paper-200 dark:decoration-umber-500 dark:hover:text-paper-50"
            >
              <ArrowLeft size={12} aria-hidden="true" />
              {t("planner_demo.banner_exit")}
            </button>
            <button
              type="button"
              onClick={() => setNudgeOpen(true)}
              className="hidden shrink-0 rounded-full bg-sage-700 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-sage-800 dark:bg-sage-600 dark:text-paper-50 dark:hover:bg-sage-500 sm:inline-flex"
            >
              {t("planner_demo.banner_cta")}
            </button>
            <button
              type="button"
              onClick={() => setBannerDismissed(true)}
              aria-label={t("planner_demo.banner_dismiss_aria")}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-900 dark:text-paper-200 dark:hover:bg-umber-700"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {nudgeOpen && (
        <PlannerDemoNudgeModal onClose={closeNudge} onConvert={() => exitDemo("/signup")} />
      )}
    </>
  );
}

function PlannerDemoNudgeModal({
  onClose,
  onConvert,
}: {
  onClose: () => void;
  onConvert: () => void;
}) {
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
      aria-labelledby="planner-demo-nudge-title"
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
          aria-label={t("planner_demo.banner_dismiss_aria")}
        >
          <X size={16} aria-hidden="true" />
        </button>
        <div className="p-7 text-center sm:p-9">
          <h2
            id="planner-demo-nudge-title"
            className="font-grotesk text-3xl italic leading-[1.05] text-ink-900 dark:text-paper-50 sm:text-4xl"
          >
            {t("planner_demo.popup_title")}
          </h2>
          <p className="mt-4 font-grotesk text-base leading-relaxed text-ink-700 dark:text-paper-100">
            {t("planner_demo.popup_body")}
          </p>
          <button
            type="button"
            onClick={onConvert}
            className="btn-primary btn-lg mt-6 inline-flex w-full items-center justify-center gap-2 shadow-sm"
          >
            {t("planner_demo.popup_cta")}
          </button>
          <p className="mt-3 text-xs text-ink-500 dark:text-umber-300">
            {t("planner_demo.popup_microcopy")}
          </p>
        </div>
      </div>
    </div>
  );
}
