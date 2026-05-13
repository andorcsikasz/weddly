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
  footer: ReactNode;
  onClose: () => void;
  /** Defaults to "alertdialog" — use "dialog" for non-blocking entry prompts. */
  role?: "alertdialog" | "dialog";
  /** When true, clicking the backdrop closes the dialog. Off for destructive
   * confirm flows where accidental dismiss could lose context. */
  closeOnBackdrop?: boolean;
  /** Width preset. Defaults to "sm" (max-w-md) — use "lg" for embedded
   * previews like PDFs. */
  size?: "sm" | "lg";
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
      <div
        ref={containerRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedById}
        className={`card relative max-h-[90vh] w-full ${size === "lg" ? "max-w-3xl" : "max-w-md"} overflow-y-auto rounded-b-none rounded-t-2xl shadow-pop sm:rounded-2xl dark:bg-umber-800 dark:border-umber-700 dark:text-paper-100`}
      >
        <div className="flex items-start gap-4">
          <h2 id={titleId} className="flex-1 text-xl">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost btn-sm -mr-2 -mt-1"
            aria-label={t("a11y.close")}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="mt-3 text-sm text-ink-700 dark:text-paper-100">{children}</div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}
