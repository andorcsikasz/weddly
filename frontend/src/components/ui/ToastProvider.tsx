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

export type ToastKind = "success" | "error" | "info";

export type ToastInput = {
  message: string;
  kind?: ToastKind;
  /** ms before auto-dismiss. Default 4000. Set 0 to require manual dismiss. */
  duration?: number;
};

type Toast = ToastInput & { id: string; kind: ToastKind; duration: number };

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
    wrap: "border-ink-200 bg-paper-50 text-ink-800",
    icon: <CheckCircle2 size={18} className="text-ink-700" aria-hidden="true" />,
  },
  error: {
    wrap: "border-blush-300 bg-blush-50 text-blush-900",
    icon: <AlertCircle size={18} className="text-blush-700" aria-hidden="true" />,
  },
  info: {
    wrap: "border-paper-300 bg-paper-100 text-ink-800",
    icon: <Info size={18} className="text-ink-600" aria-hidden="true" />,
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setToasts((cur) => cur.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = crypto.randomUUID();
      const kind: ToastKind = input.kind ?? "info";
      const duration = input.duration ?? 4000;
      const toast: Toast = { ...input, id, kind, duration };
      setToasts((cur) => [...cur, toast]);
      if (duration > 0) {
        const handle = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, handle);
      }
      return id;
    },
    [dismiss],
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
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({ push, success, error, info, dismiss }),
    [push, success, error, info, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          aria-live="polite"
          aria-relevant="additions"
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 safe-bottom sm:bottom-4 sm:right-4 sm:left-auto sm:items-end"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              role={t.kind === "error" ? "alert" : "status"}
              className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-soft animate-fade-in-up ${KIND_STYLE[t.kind].wrap}`}
            >
              <span className="mt-0.5 shrink-0">{KIND_STYLE[t.kind].icon}</span>
              <p className="flex-1 text-sm">{t.message}</p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="-m-1 rounded-full p-1 text-ink-500 hover:text-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2"
                aria-label="Dismiss notification"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
