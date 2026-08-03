// AI Concierge — the assistant strip on the vendor's client detail.
//
// A strip, not a chatbot. It does three things and then it is done: summarise
// the inquiry, name what the couple did NOT say, and draft a reply the vendor
// edits themselves. Nothing here sends anything, and there is no control on
// this component that could.
//
// Rules the rendering has to keep:
//
//   * IT HIDES ITSELF COMPLETELY when the feature is unconfigured or the vendor
//     is not on PRO. `available:false` renders null — no empty card, no locked
//     teaser, no "coming soon". Exactly like the Fordítás button with no DeepL
//     key.
//   * NOTHING FIRES ON MOUNT except the availability check, which costs nothing.
//     The model call is a click, because a strip that generates on every page
//     view spends money on inquiries the vendor was only scrolling past.
//   * A FAILURE IS A QUIET LINE, never a toast and never an error state that
//     blocks the page. The vendor's job does not depend on this working.
//   * THE DRAFT IS EDITABLE AND LABELLED. It lands in a textarea with the word
//     "draft" above it and a copy handle beside it. The vendor writes the
//     message that goes out, in the thread composer, by hand.
//   * The suggested package quotes the vendor's OWN saved price verbatim. When
//     they have saved none, the strip says so rather than leaving a gap the
//     vendor reads as "nothing fits".
//
// Vendor-portal colour rule: blush is the one interactive colour (the generate
// button, the copy handle), steel/ink/paper carry everything else, and no icon
// sits on a tinted medallion.

import type { InquiryAssist } from "@shared/ai_assist";
import { Check, Copy, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { aiAssistApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { Button, useToast } from "./ui";

type State =
  /** Availability not answered yet, or the feature is off. Renders nothing. */
  | { kind: "hidden" }
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "ready"; assist: InquiryAssist }
  /** The model gave nothing usable, or the request failed. A line, not an
   *  error: the button stays and the page is untouched. */
  | { kind: "empty" };

export function InquiryAssistant({ bookingId, pro }: { bookingId: number; pro: boolean }) {
  const { t } = useT();
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: "hidden" });
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The only thing that runs on mount. A pure env-flag read server-side, so it
  // costs nothing and can safely gate the whole strip out of existence.
  useEffect(() => {
    if (!pro) {
      setState({ kind: "hidden" });
      return;
    }
    let cancelled = false;
    aiAssistApi
      .availability()
      .then((r) => {
        if (!cancelled) setState(r.available ? { kind: "idle" } : { kind: "hidden" });
      })
      .catch(() => {
        // Unreachable availability is the same answer as unavailable: no strip.
        if (!cancelled) setState({ kind: "hidden" });
      });
    return () => {
      cancelled = true;
    };
  }, [pro]);

  // A new client means a new inquiry: drop whatever the last one produced
  // rather than showing one couple's draft above another couple's name.
  useEffect(() => {
    setState((s) => (s.kind === "hidden" ? s : { kind: "idle" }));
    setDraft("");
  }, [bookingId]);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  if (state.kind === "hidden") return null;

  const generate = () => {
    setState({ kind: "working" });
    aiAssistApi
      .generate(bookingId)
      .then((r) => {
        if (r.generated && r.assist) {
          setDraft(r.assist.draft_reply);
          setState({ kind: "ready", assist: r.assist });
        } else {
          setState({ kind: "empty" });
        }
      })
      // Every failure lands here, including the rate limit. One quiet line, no
      // toast, no thrown error: this strip must never be able to break the page.
      .catch(() => setState({ kind: "empty" }));
  };

  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
      toast.success(t("vendor.assistant.copied"));
    } catch {
      toast.error(t("vendor.assistant.copy_failed"));
    }
  };

  const assist = state.kind === "ready" ? state.assist : null;

  return (
    <section
      id="vc-assistant"
      className="rounded-xl border border-paper-300 bg-paper-50 p-4 dark:border-umber-700 dark:bg-umber-900"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Sparkles
            size={20}
            strokeWidth={1.5}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-steel-600 dark:text-steel-300"
          />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-paper-400">
              {t("vendor.assistant.title")}
            </p>
            <p className="mt-0.5 text-sm text-ink-600 dark:text-paper-300">
              {t("vendor.assistant.intro")}
            </p>
          </div>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={generate}
          loading={state.kind === "working"}
          loadingLabel={t("vendor.assistant.working")}
          className="shrink-0 self-start sm:self-auto"
        >
          {state.kind === "idle"
            ? t("vendor.assistant.generate")
            : t("vendor.assistant.regenerate")}
        </Button>
      </div>

      {state.kind === "empty" ? (
        <p className="mt-3 text-sm text-ink-500 dark:text-paper-400">
          {t("vendor.assistant.unavailable")}
        </p>
      ) : null}

      {assist ? (
        <div className="mt-4 space-y-4">
          {/* 1. What the inquiry says. */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-paper-400">
              {t("vendor.assistant.summary_title")}
            </h3>
            <p className="mt-1 whitespace-pre-line text-sm text-ink-800 dark:text-paper-200">
              {assist.summary}
            </p>
          </div>

          {/* 2. What it does NOT say — the half a summary always drops, and the
              reason the vendor knows what to ask back. */}
          {assist.missing.length > 0 ? (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-paper-400">
                {t("vendor.assistant.missing_title")}
              </h3>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {assist.missing.map((m) => (
                  <li
                    key={m}
                    className="rounded-full border border-amber-300 bg-amber-50/60 px-2.5 py-0.5 text-xs text-ink-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-paper-200"
                  >
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* 3. The suggestion. Always one of the vendor's own saved packages,
              with their own price text — or an honest "you have saved none". */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-paper-400">
              {t("vendor.assistant.package_title")}
            </h3>
            {assist.package ? (
              <div className="mt-1 text-sm">
                <p className="font-semibold text-ink-900 dark:text-paper-50">
                  {assist.package.name}
                  {assist.package.price_text ? (
                    <span className="ml-2 font-normal text-ink-600 dark:text-paper-300">
                      {assist.package.price_text}
                    </span>
                  ) : null}
                </p>
                {assist.package.reason ? (
                  <p className="mt-0.5 text-ink-600 dark:text-paper-300">{assist.package.reason}</p>
                ) : null}
              </div>
            ) : (
              <p className="mt-1 text-sm text-ink-500 dark:text-paper-400">
                {assist.no_packages
                  ? t("vendor.assistant.no_packages")
                  : t("vendor.assistant.no_package_fit")}
              </p>
            )}
          </div>

          {/* The draft. Editable, labelled, and going nowhere on its own. */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-paper-400">
                {t("vendor.assistant.draft_title")}
              </h3>
              <button
                type="button"
                onClick={copyDraft}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-blush-700 hover:bg-blush-50 dark:text-blush-300 dark:hover:bg-umber-800"
              >
                {copied ? (
                  <Check size={14} aria-hidden="true" />
                ) : (
                  <Copy size={14} aria-hidden="true" />
                )}
                {t("vendor.assistant.copy")}
              </button>
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={7}
              aria-label={t("vendor.assistant.draft_title")}
              className="input mt-1 w-full resize-y text-sm"
            />
            <p className="mt-1 text-xs text-ink-500 dark:text-paper-400">
              {t("vendor.assistant.draft_note")}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
