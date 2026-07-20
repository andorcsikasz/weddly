// The behaviour every modal surface owes the user, in one place: portal-safe
// focus trapping, Escape, body scroll lock, `inert` on background content, and
// focus restore to whatever opened it.
//
// Extracted from <Dialog> when <Sheet> arrived. Two hand-rolled focus traps in
// one codebase drift, and the half that drifts is always the one nobody tests
// with a screen reader. Both surfaces call this now, so a fix to one is a fix
// to both; only the geometry differs between them.

import { type RefObject, useEffect, useRef } from "react";

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

export function collectFocusables(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.hasAttribute("disabled")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    // Filter to elements that are actually rendered.
    return el.getClientRects().length > 0;
  });
}

/** Wire up a portal-mounted modal surface. `containerRef` must point at the
 *  element that holds the modal's own focusable content. */
export function useModalShell(
  open: boolean,
  onClose: () => void,
  containerRef: RefObject<HTMLElement | null>,
) {
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    document.body.style.overflow = "hidden";
    // Mark every direct child of <body> as `inert` so VoiceOver's rotor / tab
    // order can't reach background content while the modal is open. The portal
    // node itself is skipped. We remember which nodes we actually toggled so we
    // never strip `inert` from siblings that were inert before we opened.
    const toggled: HTMLElement[] = [];
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
      // Restore focus asynchronously so React finishes unmounting the portal
      // before we touch the DOM.
      const trigger = triggerRef.current;
      queueMicrotask(() => trigger?.focus?.());
    };
  }, [open, containerRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      // Trap Tab inside the modal. Without this, keyboard and screen-reader
      // users walk straight out into the page behind it and lose context.
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
  }, [open, onClose, containerRef]);

  useEffect(() => {
    if (!open) return;
    const node = containerRef.current;
    if (!node) return;
    const [first] = collectFocusables(node);
    first?.focus();
  }, [open, containerRef]);
}
