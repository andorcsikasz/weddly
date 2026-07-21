// The "share Weddly" referral prompt. Two icon-led actions (share, copy) over a
// swipeable rail of message variants, in one language — whichever the interface
// is speaking. Opened automatically once per account (AppShell) and on demand
// from the profile dropdown, forever.
//
// The variants live side by side in a horizontal scroll-snap rail: one card at a
// time with a peek of its neighbours, dragged sideways on touch or jumped with
// the dots. No variant labels — the message itself is the choice. Copy and
// message variants come from the locale tree, so the complete localised set is
// in hand the moment the modal renders; nothing is translated at share time.
// See lib/share_weddly.ts for the language rule and the funnel.

import { Check, Copy, Share2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fireConfetti } from "../lib/confetti";
import { useT } from "../lib/i18n";
import {
  canNativeShare,
  clipboardMessage,
  SHARE_VARIANTS,
  type ShareAnalyticsContext,
  type ShareSource,
  type ShareVariant,
  shareLanguage,
  splitShareMessage,
  trackShare,
  variantMessageKey,
} from "../lib/share_weddly";
import { Dialog } from "./ui";

/** How long the copy button holds its checkmark before reverting. Long enough
 *  to read, short enough that the button is honest about its next action. */
const COPIED_MS = 2000;

type Phase = "idle" | "sharing" | "copied" | "shared";

export interface ShareWeddlyDialogProps {
  open: boolean;
  onClose: () => void;
  /** Drives the `source` dimension on every funnel event. */
  source: ShareSource;
  /** Trigger counters, forwarded to analytics so we can see which threshold
   *  actually produced the share. Omitted for profile-dropdown opens where
   *  they carry no meaning. */
  sessionNumber?: number;
  meaningfulActions?: number;
}

export function ShareWeddlyDialog({
  open,
  onClose,
  source,
  sessionNumber,
  meaningfulActions,
}: ShareWeddlyDialogProps) {
  const { t, locale } = useT();
  const language = shareLanguage(locale);
  const [active, setActive] = useState(0);
  const variant: ShareVariant = SHARE_VARIANTS[active] ?? "warm";
  const [phase, setPhase] = useState<Phase>("idle");
  /** Non-blocking status line, mirrored into an aria-live region so copied /
   *  sharing / success / cancelled / error all reach a screen reader. */
  const [status, setStatus] = useState<string>("");
  const shareBtnRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const copiedTimer = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  /** Mirror of `active` readable inside the rAF scroll handler without a stale
   *  closure, and the guard that stops the settle-driven selection event from
   *  firing on the reset back to card 0. */
  const activeRef = useRef(0);

  const analytics = useCallback(
    (extra?: Partial<ShareAnalyticsContext>): ShareAnalyticsContext => ({
      source,
      language,
      message_variant: variant,
      ...(sessionNumber === undefined ? {} : { user_session_number: sessionNumber }),
      ...(meaningfulActions === undefined
        ? {}
        : { meaningful_actions_completed: meaningfulActions }),
      ...extra,
    }),
    [source, language, variant, sessionNumber, meaningfulActions],
  );

  // The variants, resolved in the ACTIVE language when the modal opens.
  const messages = useMemo(
    () => SHARE_VARIANTS.map((v) => ({ variant: v, message: t(variantMessageKey(v)) })),
    [t],
  );

  const selectedMessage =
    messages.find((m) => m.variant === variant)?.message ?? messages[0]?.message ?? "";

  // Reset per opening so a re-open never inherits a stale checkmark or the
  // previous session's pick. `weddly_share_popup_viewed` fires here, once.
  useEffect(() => {
    if (!open) return;
    setActive(0);
    activeRef.current = 0;
    railRef.current?.scrollTo({ left: 0 });
    setPhase("idle");
    setStatus("");
    trackShare("weddly_share_popup_viewed", {
      source,
      language,
      message_variant: "warm",
      ...(sessionNumber === undefined ? {} : { user_session_number: sessionNumber }),
      ...(meaningfulActions === undefined
        ? {}
        : { meaningful_actions_completed: meaningfulActions }),
    });
    if (source === "profile_dropdown") {
      trackShare("weddly_share_opened_from_profile", { source, language });
    }
  }, [open, source, language, sessionNumber, meaningfulActions]);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const flashCopied = useCallback((message: string) => {
    setPhase("copied");
    setStatus(message);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => {
      setPhase("idle");
      copiedTimer.current = null;
    }, COPIED_MS);
  }, []);

  /** Clipboard write with a document.execCommand fallback for browsers that
   *  refuse `navigator.clipboard` outside a secure context. Returns success so
   *  callers can decide what to announce. */
  const writeClipboard = useCallback(async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Permission denied or insecure context — fall through to the legacy path.
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }, []);

  /** Whichever card sits nearest the rail's centre is the selection. Called
   *  from a rAF-throttled scroll handler, so a drag settles onto exactly one
   *  variant and the funnel records the switch once per card crossed. */
  const settleActive = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const centre = el.scrollLeft + el.clientWidth / 2;
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < el.children.length; i++) {
      const child = el.children[i] as HTMLElement;
      const childCentre = child.offsetLeft + child.offsetWidth / 2;
      const dist = Math.abs(childCentre - centre);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    if (best === activeRef.current) return;
    activeRef.current = best;
    setActive(best);
    const v = SHARE_VARIANTS[best];
    if (v) {
      trackShare("weddly_share_message_selected", { source, language, message_variant: v });
    }
  }, [source, language]);

  const handleScroll = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      settleActive();
    });
  }, [settleActive]);

  /** Jump the rail to a card, centred. Drives the dots and keyboard arrows;
   *  the ensuing scroll settles `active` through `handleScroll`. */
  const goTo = useCallback((index: number) => {
    const el = railRef.current;
    const child = el?.children[index] as HTMLElement | undefined;
    if (!el || !child) return;
    const left = child.offsetLeft - (el.clientWidth - child.offsetWidth) / 2;
    el.scrollTo({ left, behavior: "smooth" });
  }, []);

  const handleCopy = useCallback(async () => {
    const text = clipboardMessage(selectedMessage);
    const ok = await writeClipboard(text);
    if (ok) {
      flashCopied(t("share_weddly.copied"));
      trackShare("weddly_share_copied", analytics({ share_method: "copy_button" }));
      return;
    }
    // A clipboard failure is recoverable — the message is still on screen and
    // selectable, so we say so and leave the modal open.
    setStatus(t("share_weddly.error"));
    trackShare("weddly_share_failed", analytics({ share_method: "copy_button" }));
  }, [selectedMessage, writeClipboard, flashCopied, t, analytics]);

  const handleShare = useCallback(async () => {
    if (phase === "sharing") return;

    if (!canNativeShare()) {
      // No share sheet on this device: copying the complete message is the
      // honest equivalent, and it's what the user wanted anyway.
      const ok = await writeClipboard(clipboardMessage(selectedMessage));
      if (ok) {
        flashCopied(t("share_weddly.copied"));
        trackShare("weddly_share_copied", analytics({ share_method: "clipboard_fallback" }));
      } else {
        setStatus(t("share_weddly.error"));
        trackShare("weddly_share_failed", analytics({ share_method: "clipboard_fallback" }));
      }
      return;
    }

    setPhase("sharing");
    setStatus(t("share_weddly.sharing"));
    trackShare("weddly_share_started", analytics({ share_method: "native_share" }));

    const { text, url } = splitShareMessage(selectedMessage);
    try {
      // Resolving means the share was COMPLETED — a dismissed sheet rejects
      // with AbortError. We never treat "the sheet opened" as success.
      await navigator.share({ text, url });
      setPhase("shared");
      setStatus(t("share_weddly.success"));
      trackShare("weddly_share_completed", analytics({ share_method: "native_share" }));
      // Keep the burst near the modal rather than centring it on the viewport,
      // so the celebration reads as belonging to this card. fireConfetti is a
      // no-op under prefers-reduced-motion.
      const rect = shareBtnRef.current?.getBoundingClientRect();
      if (rect) fireConfetti({ x: rect.left + rect.width / 2, y: rect.top });
      else fireConfetti();
    } catch (err) {
      setPhase("idle");
      const aborted =
        err instanceof DOMException
          ? err.name === "AbortError"
          : (err as { name?: string } | null)?.name === "AbortError";
      if (aborted) {
        // Cancelling is not a failure and gets no celebration — just the
        // button back the way it was.
        setStatus(t("share_weddly.cancelled"));
        trackShare("weddly_share_cancelled", analytics({ share_method: "native_share" }));
        return;
      }
      setStatus(t("share_weddly.error"));
      trackShare("weddly_share_failed", analytics({ share_method: "native_share" }));
    }
  }, [phase, selectedMessage, writeClipboard, flashCopied, t, analytics]);

  const handleClose = useCallback(() => {
    trackShare("weddly_share_popup_closed", analytics());
    onClose();
  }, [analytics, onClose]);

  const copyLabel = phase === "copied" ? t("share_weddly.copied") : t("share_weddly.copy_action");
  const shareLabel = t("share_weddly.share_action");

  return (
    <Dialog
      open={open}
      role="dialog"
      title={t("share_weddly.title")}
      titleClassName="text-balance text-[1.375rem] leading-[1.15] sm:text-[1.625rem]"
      onClose={handleClose}
      closeOnBackdrop={phase !== "sharing"}
    >
      <div className="pb-2">
        <p className="text-base leading-relaxed text-ink-600 dark:text-umber-200">
          {t("share_weddly.body")}
        </p>

        {/* A horizontal scroll-snap rail: one message centred, its neighbours
         *  peeking, dragged sideways on touch. Left/right arrows and the dots
         *  step through it; whichever card settles at centre is the pick. The
         *  rail is one tab stop, the dots move within it. */}
        <div
          ref={railRef}
          onScroll={handleScroll}
          role="group"
          aria-roledescription="carousel"
          aria-label={t("share_weddly.messages_label")}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") {
              e.preventDefault();
              goTo(Math.min(active + 1, messages.length - 1));
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              goTo(Math.max(active - 1, 0));
            }
          }}
          className="-mx-1 mt-5 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-1 pb-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:focus-visible:ring-paper-100 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {messages.map((m, i) => {
            const selected = i === active;
            return (
              <div
                key={m.variant}
                aria-roledescription="slide"
                aria-hidden={!selected}
                className={`flex min-h-[7.5rem] shrink-0 basis-[86%] snap-center items-end justify-end pr-1.5 transition-all duration-300 ${
                  selected ? "opacity-100" : "scale-[0.96] opacity-60"
                }`}
              >
                {/* Each variant is previewed as an outgoing chat bubble — this is
                 *  exactly how the message lands when they send it. The selected
                 *  card is the filled "sent" bubble; peeking neighbours are quiet.
                 *  Three soft corners and one tightened bottom-right corner read
                 *  as a "sent" bubble without a fussy protruding tail. */}
                <div
                  className={`max-w-[90%] rounded-[1.4rem] rounded-br-md px-4 py-3 transition-colors duration-300 ${
                    selected
                      ? "bg-share text-paper-50"
                      : "bg-paper-100 text-ink-600 dark:bg-umber-700 dark:text-paper-200"
                  }`}
                >
                  <span className="block text-[0.9375rem] leading-relaxed">{m.message}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination dots. The active one stretches into a pill so position is
         *  legible at a glance; each is a real button so the rail is navigable
         *  without a drag. */}
        <div className="mt-3.5 flex justify-center gap-1.5">
          {messages.map((m, i) => {
            const selected = i === active;
            return (
              <button
                key={m.variant}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`${t("share_weddly.messages_label")} ${i + 1}`}
                aria-current={selected}
                className={`h-1.5 rounded-full transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:focus-visible:ring-paper-100 ${
                  selected
                    ? "w-5 bg-share"
                    : "w-1.5 bg-paper-300 hover:bg-paper-400 dark:bg-umber-600 dark:hover:bg-umber-500"
                }`}
              />
            );
          })}
        </div>

        {/* Two icon-only actions, centred under the bubble like a chat
         *  composer. Share stays visually primary; copy is the quiet
         *  secondary. Both are 44×44 minimum and carry a native tooltip plus
         *  an aria-label, so the icon is never the only affordance. */}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            ref={shareBtnRef}
            type="button"
            onClick={() => void handleShare()}
            disabled={phase === "sharing"}
            title={shareLabel}
            aria-label={shareLabel}
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-share text-paper-50 transition-colors hover:bg-share-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-share focus-visible:ring-offset-2 disabled:opacity-70 dark:focus-visible:ring-share"
          >
            {phase === "sharing" ? (
              <span
                aria-hidden="true"
                className="h-[18px] w-[18px] rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin"
              />
            ) : (
              <Share2 size={18} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            title={copyLabel}
            aria-label={copyLabel}
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-paper-300 text-ink-700 transition-colors hover:bg-paper-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:border-umber-600 dark:text-paper-100 dark:hover:bg-umber-700 dark:focus-visible:ring-paper-100"
          >
            {phase === "copied" ? (
              <Check size={18} aria-hidden="true" />
            ) : (
              <Copy size={18} aria-hidden="true" />
            )}
          </button>
        </div>

        {/* The success line earns its space only after a confirmed share;
         *  every other state speaks through the live region alone rather than
         *  parking instructional text under the buttons. Centred to match. */}
        {phase === "shared" && (
          <p className="mt-3 text-center text-sm font-medium text-ink-900 dark:text-paper-50">
            {t("share_weddly.success")}
          </p>
        )}

        <p aria-live="polite" className="sr-only">
          {status}
        </p>
      </div>
    </Dialog>
  );
}
