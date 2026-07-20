import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../lib/i18n";

/** Selector for elements that should participate in the focus trap.
 *  Broadened beyond the basics to include role="button" widgets we build by
 *  hand, native media controls (audio/video[controls]), and <summary> tags. */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
  '[role="button"][tabindex]:not([tabindex="-1"])',
  "audio[controls]",
  "video[controls]",
  "summary",
].join(",");

function collectFocusables(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.hasAttribute("disabled")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    // Filter to elements that are actually rendered.
    return el.getClientRects().length > 0;
  });
}

type DialogProps = {
  open: boolean;
  title: string;
  describedById?: string;
  children: ReactNode;
  /** Omit for dialogs whose body already carries the primary action — the
   *  footer strip (and its top border) disappears rather than sitting empty. */
  footer?: ReactNode;
  onClose: () => void;
  /** Defaults to "alertdialog" — use "dialog" for non-blocking entry prompts. */
  role?: "alertdialog" | "dialog";
  /** When true, clicking the backdrop closes the dialog. Off for destructive
   * confirm flows where accidental dismiss could lose context. */
  closeOnBackdrop?: boolean;
  /** Width preset. Defaults to "sm" (max-w-md). "lg" (max-w-3xl) suits
   * embedded previews like PDFs; "xl" (max-w-5xl) makes room for wide
   * grids like supplier comparisons. */
  size?: "sm" | "lg" | "xl";
};

/** Portal-mounted accessible dialog. Manages ESC, focus restore, and scroll
 *  lock. Layout/styling is centralised here so Confirm and Entry stay thin. */
export function Dialog({
  open,
  title,
  describedById,
  children,
  footer,
  onClose,
  role = "alertdialog",
  closeOnBackdrop = false,
  size = "sm",
}: DialogProps) {
  const { t } = useT();
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    document.body.style.overflow = "hidden";
    // Mark every direct child of <body> as `inert` so VoiceOver's rotor /
    // tab order can't reach background content while the dialog is open.
    // The portal node itself (where the dialog mounts) is skipped. We
    // remember which nodes we actually toggled so we don't accidentally
    // strip `inert` from siblings that were inert before the dialog opened.
    const toggled: HTMLElement[] = [];
    // Snapshot active element so we can find its portal root after render.
    const container = containerRef.current;
    for (const child of Array.from(document.body.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (container && child.contains(container)) continue;
      if (child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      toggled.push(child);
    }
    return () => {
      document.body.style.overflow = "";
      for (const el of toggled) el.removeAttribute("inert");
      // Restore focus to whatever opened the dialog (asynchronously so React
      // finishes unmounting the portal before we touch the DOM).
      const trigger = triggerRef.current;
      queueMicrotask(() => trigger?.focus?.());
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      // Trap Tab within the dialog so focus can't escape to the
      // background page while the modal is open. Without this, screen
      // reader + keyboard users can lose context.
      if (e.key === "Tab") {
        const node = containerRef.current;
        if (!node) return;
        const focusables = collectFocusables(node);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const node = containerRef.current;
    if (!node) return;
    const [first] = collectFocusables(node);
    first?.focus();
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      {/* Flex column so the header + footer stay pinned while only the body
       *  scrolls. Without this, long-content dialogs (e.g. the task-template
       *  wand with 22 items) push the action buttons off-screen and force
       *  the user to scroll back up to confirm. The outer card no longer
       *  scrolls — only the middle slot does. */}
      <div
        ref={containerRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedById}
        /* `max-h-[100dvh]` over `90vh` keeps the footer reachable on iOS
         * Safari when the URL bar collapses; vh-units freeze at the
         * largest viewport and would clip below the home indicator. The
         * mobile variant fills the available height so the dialog behaves
         * like a near-fullscreen sheet without rebuilding the layout. */
        className={`card relative flex max-h-[100dvh] w-full flex-col ${size === "xl" ? "sm:max-w-5xl" : size === "lg" ? "sm:max-w-3xl" : "sm:max-w-md"} rounded-b-none rounded-t-2xl p-0 shadow-pop sm:max-h-[90vh] sm:rounded-2xl dark:bg-umber-800 dark:border-umber-700 dark:text-paper-100`}
      >
        <div className="flex shrink-0 items-start gap-3 px-4 pt-4 sm:px-6 sm:pt-6">
          <h2 id={titleId} className="flex-1 pt-1 text-xl">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            /* 44×44 tap target — the previous `btn-sm -mr-2 -mt-1` made
             *  the X around 28px and pushed it toward the screen edge
             *  where it overlapped the iOS Safari address-bar
             *  reload-pull on /onboarding and any full-screen modal. */
            className="-mr-2 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-600 transition-colors hover:bg-paper-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:text-paper-200 dark:hover:bg-umber-700 dark:focus-visible:ring-paper-100"
            aria-label={t("a11y.close")}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div
          /* When any input inside the dialog gains focus, scroll it
           *  toward the dialog's vertical center. iOS Safari otherwise
           *  parks the focused field at the bottom of the visible region
           *  where the virtual keyboard immediately covers it. */
          onFocus={(e) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;
            if (target.matches("input, textarea, select, [contenteditable='true']")) {
              target.scrollIntoView({ block: "center", behavior: "smooth" });
            }
          }}
          className={`mt-3 flex-1 overflow-y-auto overscroll-contain px-4 text-sm text-ink-700 sm:px-6 dark:text-paper-100 ${footer ? "pb-2" : "pb-4 sm:pb-6"}`}
        >
          {children}
        </div>
        {footer ? (
          <div className="safe-bottom flex shrink-0 flex-col-reverse gap-2 border-t border-paper-200 px-4 py-4 sm:flex-row sm:justify-end sm:px-6 dark:border-umber-700">
            {footer}
          </div>
        ) : (
          <div className="safe-bottom shrink-0" aria-hidden />
        )}
      </div>
    </div>,
    document.body,
  );
}
