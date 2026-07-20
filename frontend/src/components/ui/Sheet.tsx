// A bottom sheet. The phone-shaped sibling of <Dialog>: same plumbing (portal,
// focus trap, Escape, scroll lock, inert background) via useModalShell, but
// anchored to the bottom edge instead of centred.
//
// It exists because a centred dialog is the wrong shape for picking something.
// On a phone, a centred box lands under the fingers that are meant to scroll a
// row of options, and it covers the middle of the screen where the thing being
// changed is drawn. A sheet rises from the thumb, leaves the top of the page
// visible, and puts its own content exactly where the hand already is.

import { type ReactNode, useRef } from "react";
import { createPortal } from "react-dom";
import { useModalShell } from "./modal_shell";

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name. Rendered visibly as the sheet's own heading. */
  title: string;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  useModalShell(open, onClose, containerRef);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop. Umber rather than black so it reads as the warm workspace
          dimming, not as a system alert. Written explicitly (not via a dark:
          variant) because opacity utilities are not remapped by the shell. */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-umber-950/50 backdrop-blur-[2px]"
      />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-paper-50 pb-[env(safe-area-inset-bottom)] shadow-pop dark:bg-umber-800"
        style={{ animation: "sheetUp 220ms cubic-bezier(0.22, 1, 0.36, 1)" }}
      >
        {/* Grabber. Purely a shape cue that this panel came from the bottom
            edge and goes back there; the real dismissals are the backdrop,
            Escape, and the sheet's own Done button. */}
        <div className="sticky top-0 z-10 flex flex-col items-center gap-2 bg-paper-50 pb-2 pt-2.5 dark:bg-umber-800">
          <span className="h-1 w-10 rounded-full bg-paper-300 dark:bg-umber-600" aria-hidden />
          <p className="text-sm font-medium text-ink-900 dark:text-paper-50">{title}</p>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
