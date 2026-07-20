// The "share Weddly" referral prompt. Two icon-led actions (share, copy) over
// three selectable message variants, in one language — whichever the interface
// is speaking. Opened automatically once per account (AppShell) and on demand
// from the profile dropdown, forever.
//
// Copy and message variants come from the locale tree, so the complete
// localised set is in hand the moment the modal renders; nothing is translated
// at share time. See lib/share_weddly.ts for the language rule and the funnel.

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
  variantLabelKey,
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
  const [variant, setVariant] = useState<ShareVariant>("warm");
  const [phase, setPhase] = useState<Phase>("idle");
  /** Non-blocking status line, mirrored into an aria-live region so copied /
   *  sharing / success / cancelled / error all reach a screen reader. */
  const [status, setStatus] = useState<string>("");
  const shareBtnRef = useRef<HTMLButtonElement>(null);
  const copiedTimer = useRef<number | null>(null);

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

  // The three cards, resolved in the ACTIVE language when the modal opens.
  const messages = useMemo(
    () =>
      SHARE_VARIANTS.map((v) => ({
        variant: v,
        label: t(variantLabelKey(v)),
        message: t(variantMessageKey(v)),
      })),
    [t],
  );

  const selectedMessage =
    messages.find((m) => m.variant === variant)?.message ?? messages[0]?.message ?? "";

  // Reset per opening so a re-open never inherits a stale checkmark or the
  // previous session's pick. `weddly_share_popup_viewed` fires here, once.
  useEffect(() => {
    if (!open) return;
    setVariant("warm");
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

  const handleSelect = useCallback(
    (next: ShareVariant) => {
      if (next === variant) return;
      setVariant(next);
      trackShare("weddly_share_message_selected", {
        source,
        language,
        message_variant: next,
      });
    },
    [variant, source, language],
  );

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
      titleClassName="text-2xl leading-[1.15] sm:text-[1.75rem]"
      onClose={handleClose}
      closeOnBackdrop={phase !== "sharing"}
    >
      <div className="pb-2">
        <p className="text-base leading-relaxed text-ink-600 dark:text-umber-200">
          {t("share_weddly.body")}
        </p>

        <p className="mt-7 text-sm font-medium text-ink-900 dark:text-paper-50">
          {t("share_weddly.supporting")}
        </p>

        {/* Radio-group rather than a listbox: three mutually exclusive options,
         *  arrow keys move between them, the whole card is the control. */}
        <div
          role="radiogroup"
          aria-label={t("share_weddly.messages_label")}
          className="mt-3 flex flex-col gap-2"
        >
          {messages.map((m) => {
            const selected = m.variant === variant;
            return (
              <button
                key={m.variant}
                type="button"
                role="radio"
                aria-checked={selected}
                // Roving tabindex — the group is one tab stop, arrows move
                // within it, which is the expected radio-group behaviour.
                tabIndex={selected ? 0 : -1}
                onClick={() => handleSelect(m.variant)}
                onKeyDown={(e) => {
                  if (
                    e.key !== "ArrowDown" &&
                    e.key !== "ArrowRight" &&
                    e.key !== "ArrowUp" &&
                    e.key !== "ArrowLeft"
                  ) {
                    return;
                  }
                  e.preventDefault();
                  const idx = SHARE_VARIANTS.indexOf(m.variant);
                  const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
                  const next =
                    SHARE_VARIANTS[(idx + step + SHARE_VARIANTS.length) % SHARE_VARIANTS.length];
                  if (!next) return;
                  handleSelect(next);
                  // Move focus with the selection so the arrow keys keep working.
                  const group = e.currentTarget.parentElement;
                  const target =
                    group?.querySelectorAll<HTMLElement>('[role="radio"]')[
                      (idx + step + SHARE_VARIANTS.length) % SHARE_VARIANTS.length
                    ];
                  target?.focus();
                }}
                className={`relative w-full rounded-lg border p-4 pr-11 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:focus-visible:ring-paper-100 ${
                  selected
                    ? "border-ink-900 bg-paper-100 dark:border-paper-100 dark:bg-umber-700"
                    : "border-paper-300 bg-white hover:border-paper-400 dark:border-umber-600 dark:bg-umber-800 dark:hover:border-umber-500"
                }`}
              >
                <span className="block text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-ink-500 dark:text-umber-300">
                  {m.label}
                </span>
                <span className="mt-1.5 block text-sm leading-relaxed text-ink-800 dark:text-paper-100">
                  {m.message}
                </span>
                {selected && (
                  <span
                    aria-hidden="true"
                    className="absolute right-3 top-4 flex h-5 w-5 items-center justify-center rounded-full bg-ink-900 text-paper-50 dark:bg-paper-100 dark:text-umber-900"
                  >
                    <Check size={13} strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Two icon-only actions. Share stays visually primary; copy is the
         *  quiet secondary. Both are 44×44 minimum and carry a native tooltip
         *  plus an aria-label, so the icon is never the only affordance. */}
        <div className="mt-7 flex items-center gap-3">
          <button
            ref={shareBtnRef}
            type="button"
            onClick={() => void handleShare()}
            disabled={phase === "sharing"}
            title={shareLabel}
            aria-label={shareLabel}
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-ink-900 text-paper-50 transition-colors hover:bg-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 disabled:opacity-70 dark:bg-paper-100 dark:text-umber-900 dark:hover:bg-paper-200 dark:focus-visible:ring-paper-100"
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
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-paper-300 text-ink-700 transition-colors hover:bg-paper-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:border-umber-600 dark:text-paper-100 dark:hover:bg-umber-700 dark:focus-visible:ring-paper-100"
          >
            {phase === "copied" ? (
              <Check size={18} aria-hidden="true" />
            ) : (
              <Copy size={18} aria-hidden="true" />
            )}
          </button>

          {/* The success line earns its space only after a confirmed share;
           *  every other state speaks through the live region alone rather
           *  than parking instructional text under the buttons. */}
          {phase === "shared" && (
            <p className="text-sm font-medium text-ink-900 dark:text-paper-50">
              {t("share_weddly.success")}
            </p>
          )}
        </div>

        <p aria-live="polite" className="sr-only">
          {status}
        </p>
      </div>
    </Dialog>
  );
}
