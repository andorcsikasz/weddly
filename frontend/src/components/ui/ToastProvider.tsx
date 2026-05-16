import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useT } from "../../lib/i18n";

export type ToastKind = "success" | "error" | "info";

export type ToastInput = {
  message: string;
  kind?: ToastKind;
  /** ms before auto-dismiss. Default 6000 (WCAG 2.2.1 — enough time to read a
   *  short notification). Set 0 to require manual dismiss. */
  duration?: number;
};

type Toast = ToastInput & { id: string; kind: ToastKind; duration: number };

/** Default auto-dismiss window. Tuned up from 4s to 6s to give screen-reader
 *  + low-vision users enough time to read short notifications without having
 *  to hover or focus the toast. */
const DEFAULT_DURATION_MS = 6000;

type ToastApi = {
  push: (input: ToastInput) => string;
  success: (message: string, duration?: number) => string;
  error: (message: string, duration?: number) => string;
  info: (message: string, duration?: number) => string;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const KIND_STYLE: Record<ToastKind, { wrap: string; icon: ReactNode }> = {
  success: {
    wrap: "border-ink-200 bg-paper-50 text-ink-800 dark:border-sage-400/40 dark:bg-sage-500 dark:text-umber-900",
    icon: (
      <CheckCircle2 size={18} className="text-ink-700 dark:text-umber-900" aria-hidden="true" />
    ),
  },
  error: {
    wrap: "border-blush-300 bg-blush-50 text-blush-900 dark:border-blush-400/40 dark:bg-blush-500 dark:text-umber-900",
    icon: (
      <AlertCircle size={18} className="text-blush-700 dark:text-umber-900" aria-hidden="true" />
    ),
  },
  info: {
    wrap: "border-paper-300 bg-paper-100 text-ink-800 dark:border-umber-700 dark:bg-paper-50 dark:text-umber-900",
    icon: <Info size={18} className="text-ink-600 dark:text-umber-700" aria-hidden="true" />,
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useT();
  const [toasts, setToasts] = useState<Toast[]>([]);
  // `timers` holds the live setTimeout handle per toast. `remaining` holds
  // the ms left when a toast is paused (hover / focus / Esc-armed). When the
  // pointer leaves or focus blurs we re-arm using the remaining time so a
  // half-read toast doesn't restart its full clock.
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const startedAt = useRef<Map<string, number>>(new Map());
  const remaining = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    const handle = timers.current.get(id);
    if (handle) {
      clearTimeout(handle);
      timers.current.delete(id);
    }
    startedAt.current.delete(id);
    remaining.current.delete(id);
    setToasts((cur) => cur.filter((x) => x.id !== id));
  }, []);

  const arm = useCallback(
    (id: string, ms: number) => {
      if (ms <= 0) return;
      const handle = setTimeout(() => dismiss(id), ms);
      timers.current.set(id, handle);
      startedAt.current.set(id, Date.now());
      remaining.current.set(id, ms);
    },
    [dismiss],
  );

  /** Pause auto-dismiss for a toast (pointer enter / focus in). Stashes the
   *  remaining ms so a `resume` can pick up where it left off. */
  const pause = useCallback((id: string) => {
    const handle = timers.current.get(id);
    if (!handle) return;
    clearTimeout(handle);
    timers.current.delete(id);
    const started = startedAt.current.get(id);
    const total = remaining.current.get(id) ?? 0;
    if (started !== undefined && total > 0) {
      const elapsed = Date.now() - started;
      const left = Math.max(0, total - elapsed);
      remaining.current.set(id, left);
    }
    startedAt.current.delete(id);
  }, []);

  const resume = useCallback(
    (id: string) => {
      if (timers.current.has(id)) return; // already running
      const left = remaining.current.get(id) ?? 0;
      if (left > 0) arm(id, left);
    },
    [arm],
  );

  const push = useCallback(
    (input: ToastInput) => {
      const id = crypto.randomUUID();
      const kind: ToastKind = input.kind ?? "info";
      const duration = input.duration ?? DEFAULT_DURATION_MS;
      const toast: Toast = { ...input, id, kind, duration };
      setToasts((cur) => [...cur, toast]);
      if (duration > 0) arm(id, duration);
      return id;
    },
    [arm],
  );

  const success = useCallback(
    (message: string, duration?: number) => push({ message, kind: "success", duration }),
    [push],
  );
  const error = useCallback(
    (message: string, duration?: number) => push({ message, kind: "error", duration }),
    [push],
  );
  const info = useCallback(
    (message: string, duration?: number) => push({ message, kind: "info", duration }),
    [push],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const handle of map.values()) clearTimeout(handle);
      map.clear();
    };
  }, []);

  // Esc dismisses the topmost (most recent) toast. We only listen while at
  // least one toast is on screen so we don't fight other Esc handlers.
  useEffect(() => {
    if (toasts.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const top = toasts[toasts.length - 1];
      if (!top) return;
      dismiss(top.id);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toasts, dismiss]);

  const api = useMemo<ToastApi>(
    () => ({ push, success, error, info, dismiss }),
    [push, success, error, info, dismiss],
  );

  // Split toasts by severity so we can mount them in separate live regions.
  // `role="status" aria-live="polite"` is appropriate for success/info, while
  // errors deserve `role="alert" aria-live="assertive"` so screen readers
  // announce them immediately.
  const politeToasts = toasts.filter((tt) => tt.kind !== "error");
  const assertiveToasts = toasts.filter((tt) => tt.kind === "error");
  const dismissLabel = t("a11y.dismiss");

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 pb-20 safe-bottom lg:pb-4 sm:bottom-4 sm:right-4 sm:left-auto sm:items-end">
          {/* Polite region: success + info. Additions only — removals are
              not announced because they'd duplicate the original message. */}
          <div role="status" aria-live="polite" aria-relevant="additions" className="contents">
            {politeToasts.map((tt) => (
              <ToastItem
                key={tt.id}
                toast={tt}
                onDismiss={dismiss}
                onPause={pause}
                onResume={resume}
                dismissLabel={dismissLabel}
              />
            ))}
          </div>
          {/* Assertive region: errors. Screen readers interrupt to announce. */}
          <div role="alert" aria-live="assertive" aria-relevant="additions" className="contents">
            {assertiveToasts.map((tt) => (
              <ToastItem
                key={tt.id}
                toast={tt}
                onDismiss={dismiss}
                onPause={pause}
                onResume={resume}
                dismissLabel={dismissLabel}
              />
            ))}
          </div>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
  onPause,
  onResume,
  dismissLabel,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  dismissLabel: string;
}) {
  return (
    <div
      // Pause auto-dismiss while the user is engaging with the toast. focusin /
      // focusout fire when the dismiss button (or any future interactive
      // child) gains/loses focus — keyboard parity for the hover behaviour.
      onMouseEnter={() => onPause(toast.id)}
      onMouseLeave={() => onResume(toast.id)}
      onFocus={() => onPause(toast.id)}
      onBlur={() => onResume(toast.id)}
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-soft animate-fade-in-up ${KIND_STYLE[toast.kind].wrap}`}
    >
      <span className="mt-0.5 shrink-0">{KIND_STYLE[toast.kind].icon}</span>
      <p className="flex-1 text-sm">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="-m-1 rounded-full p-1 text-ink-500 hover:text-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:text-umber-700 dark:hover:text-umber-900 dark:focus-visible:ring-umber-700"
        aria-label={dismissLabel}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
