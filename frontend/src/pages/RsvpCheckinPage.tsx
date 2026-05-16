// Public airport-style RSVP check-in. Two big fields (couple slug + 4-digit
// code) → one resolved household → one RSVP submission for everyone in it.

import type { PublicCheckinView } from "@shared/types";
import { Lock } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { HouseholdRsvpForm } from "../components/HouseholdRsvpForm";
import { Wordmark } from "../components/Wordmark";
import { useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { rsvpApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

const KIOSK_STORAGE_KEY = "weddly.rsvp.kiosk";
/** Long-press threshold for the bottom-right kiosk-exit hotspot. 1 s is long
 *  enough to prevent accidental child / pocket-touch exits but short enough
 *  that a deliberate adult tap-and-hold lands quickly. */
const KIOSK_EXIT_HOLD_MS = 1000;
/** Cancel the press if the pointer drifts this many pixels — most likely a
 *  scroll-start rather than a deliberate hold. */
const KIOSK_PRESS_MOVE_TOLERANCE_PX = 10;

/** Which input the lookup error highlights. `null` = generic banner. */
type LookupErrorField = "couple" | "code" | "both" | null;

export default function RsvpCheckinPage() {
  const { t, locale, setLocale } = useT();
  const toast = useToast();
  useDocumentMeta("seo.rsvp_checkin_title", "seo.rsvp_checkin_description");
  const [params, setParams] = useSearchParams();

  const initialCouple = (params.get("couple") ?? "").toUpperCase();
  const initialCode = params.get("code") ?? "";

  // Kiosk mode: either a URL flag or a sticky localStorage hint. Once entered
  // we persist so refreshing the device's browser keeps the lock — greeters
  // typically tape a phone to a stand and walk away. Exit is via long-press
  // hotspot (or Shift+K), so reload alone can't bail.
  const [kiosk, setKiosk] = useState<boolean>(() => {
    if (params.get("kiosk") === "1") return true;
    try {
      return localStorage.getItem(KIOSK_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const [coupleInput, setCoupleInput] = useState(initialCouple);
  const [codeInput, setCodeInput] = useState(initialCode);
  const [view, setView] = useState<PublicCheckinView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<LookupErrorField>(null);
  const [submitting, setSubmitting] = useState(false);

  const coupleInputRef = useRef<HTMLInputElement>(null);

  const enterKiosk = useCallback(() => {
    try {
      localStorage.setItem(KIOSK_STORAGE_KEY, "1");
    } catch {
      // ignore — kiosk mode still works for this tab via state
    }
    setKiosk(true);
  }, []);

  const exitKiosk = useCallback(() => {
    try {
      localStorage.removeItem(KIOSK_STORAGE_KEY);
    } catch {
      // ignore
    }
    setKiosk(false);
    // Strip ?kiosk=1 from the URL so the next refresh doesn't re-enter.
    setParams(
      (cur) => {
        const next = new URLSearchParams(cur);
        next.delete("kiosk");
        return next;
      },
      { replace: true },
    );
    // Short confirm-toast so a pet/child accidental long-press is at least
    // visible to the host.
    toast.info(t("rsvp.kiosk_exit_confirmed"), 2000);
  }, [setParams, toast, t]);

  // Persist kiosk mode if it was entered via URL flag — sticky from then on.
  useEffect(() => {
    if (kiosk) {
      try {
        localStorage.setItem(KIOSK_STORAGE_KEY, "1");
      } catch {
        // ignore
      }
    }
  }, [kiosk]);

  // Keyboard escape hatch — Shift+K is the documented chord. Used in tandem
  // with the long-press hotspot so the host can exit even from a Bluetooth
  // keyboard plugged into the kiosk device.
  useEffect(() => {
    if (!kiosk) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.key === "K" || e.key === "k")) {
        e.preventDefault();
        exitKiosk();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kiosk, exitKiosk]);

  // Auto-submit when the URL was hand-fed both values (e.g. couple shared
  // a pre-filled link). Run once.
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current) return;
    if (initialCouple && initialCode && !view) {
      autoTried.current = true;
      void doLookup(initialCouple, initialCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function focusCoupleInput() {
    // Refocus the slug input next-frame so the toast/animation has time
    // to start fading before we steal focus.
    requestAnimationFrame(() => coupleInputRef.current?.focus());
  }

  function resetForNextGuest() {
    setView(null);
    setError(null);
    setErrorField(null);
    // Always clear BOTH fields when handing off to the next guest. In kiosk
    // mode this is critical — leaving the slug pre-filled would leak the
    // previous guest's couple (and they probably typed it wrong anyway).
    setCoupleInput("");
    setCodeInput("");
    // Strip the deep-link params so the browser back button can't resurface
    // a just-submitted form. Preserve `kiosk=1` if we're locked in.
    setParams(
      (cur) => {
        const next = new URLSearchParams();
        if (cur.get("kiosk") === "1" || kiosk) next.set("kiosk", "1");
        return next;
      },
      { replace: true },
    );
    focusCoupleInput();
  }

  async function doLookup(couple: string, code: string) {
    setSubmitting(true);
    setError(null);
    setErrorField(null);
    try {
      const r = await rsvpApi.lookup(couple, code);
      setView(r.rsvp);
      // In kiosk mode we DON'T mirror the resolved (couple, code) into the
      // URL — it would leak the previous guest's identity to the next one
      // (and the browser-back button would resurface a submitted form).
      if (!kiosk) {
        setParams({ couple, code }, { replace: true });
      }
    } catch (err) {
      // Map the server's text response onto field-level errors. Backend
      // returns "Couple not found" (404) when the slug is wrong, and
      // "Code not found" (404) when the slug is fine but the code isn't.
      // 400 means malformed input — usually one or both fields invalid.
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
        const msg = err.message ?? "";
        if (/couple/i.test(msg)) {
          setError(t("rsvp.checkin_lookup_couple_unknown"));
          setErrorField("couple");
        } else if (/code/i.test(msg)) {
          setError(t("rsvp.checkin_lookup_code_unknown"));
          setErrorField("code");
        } else {
          setError(t("rsvp.checkin_lookup_failed"));
          setErrorField("both");
        }
      } else {
        setError(err instanceof ApiError ? err.message : t("common.error_generic"));
        setErrorField(null);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmitLookup(e: FormEvent) {
    e.preventDefault();
    const couple = coupleInput.trim().toUpperCase();
    const code = codeInput.trim();
    if (!couple || !code) {
      setError(t("rsvp.checkin_lookup_missing"));
      setErrorField(!couple && !code ? "both" : !couple ? "couple" : "code");
      return;
    }
    void doLookup(couple, code);
  }

  return (
    <FullPage>
      <div className="mb-6 flex items-center justify-between">
        {kiosk ? (
          // Kiosk: wordmark stays visible for orientation but is no longer a
          // navigation target — one tap can't escape to the marketing site.
          <span aria-label="Weddly" className="inline-block text-ink-700">
            <Wordmark size="sm" />
          </span>
        ) : (
          <Link
            to="/"
            aria-label="Weddly — back to home"
            className="inline-block text-ink-700 transition-colors hover:text-ink-900"
          >
            <Wordmark size="sm" />
          </Link>
        )}
        {!kiosk && (
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => setLocale(locale === "hu" ? "en" : "hu")}
          >
            {locale === "hu" ? "EN" : "HU"}
          </button>
        )}
      </div>

      {kiosk && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 flex items-center gap-2 rounded-full border border-paper-300 bg-paper-200 px-3 py-1.5 text-xs text-ink-700"
        >
          <Lock size={14} aria-hidden />
          <span>{t("rsvp.kiosk_banner")}</span>
        </div>
      )}

      {view ? (
        <HouseholdRsvpForm
          view={view}
          onUpdated={setView}
          onBack={() => {
            setView(null);
            setError(null);
            setErrorField(null);
          }}
          onNextGuest={resetForNextGuest}
        />
      ) : (
        <form className="card stationery animate-fade-in-up" onSubmit={onSubmitLookup}>
          {/* Quiet airport-style kicker — anchors the metaphor before the
              guest types anything. Mono uppercase, low contrast. */}
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-ink-500">
            {t("rsvp.checkin_kicker")}
          </p>
          <h1 className="mt-1 font-serif text-3xl">{t("rsvp.checkin_title")}</h1>
          <p className="mt-2 text-sm text-ink-600">{t("rsvp.checkin_intro")}</p>

          <div className="mt-6 space-y-4">
            <div>
              <label className="field-label" htmlFor="rsvp-couple">
                {t("rsvp.checkin_couple_label")}
              </label>
              <input
                id="rsvp-couple"
                ref={coupleInputRef}
                className={
                  errorField === "couple" || errorField === "both"
                    ? "input font-mono uppercase tracking-[0.3em] text-center text-lg min-h-14 border-blush-400 focus:border-blush-500 placeholder:text-ink-300 placeholder:font-normal"
                    : "input font-mono uppercase tracking-[0.3em] text-center text-lg min-h-14 placeholder:text-ink-300 placeholder:font-normal"
                }
                value={coupleInput}
                autoCapitalize="characters"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                placeholder="ANNABENCE"
                onChange={(e) => setCoupleInput(e.target.value.toUpperCase())}
                onFocus={(e) =>
                  e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" })
                }
                maxLength={24}
                aria-invalid={errorField === "couple" || errorField === "both"}
                aria-describedby="rsvp-couple-help"
              />
              <p id="rsvp-couple-help" className="mt-1 text-xs text-ink-500">
                {t("rsvp.checkin_couple_help")}
              </p>
            </div>
            <div>
              <label className="field-label" htmlFor="rsvp-code">
                {t("rsvp.checkin_code_label")}
              </label>
              <input
                id="rsvp-code"
                className={
                  errorField === "code" || errorField === "both"
                    ? "input font-mono tracking-[0.5em] text-center text-2xl min-h-14 border-blush-400 focus:border-blush-500 placeholder:text-ink-300"
                    : "input font-mono tracking-[0.5em] text-center text-2xl min-h-14 placeholder:text-ink-300"
                }
                value={codeInput}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                enterKeyHint="go"
                placeholder="0000"
                onChange={(e) => setCodeInput(e.target.value.replace(/[^0-9]/g, ""))}
                onFocus={(e) =>
                  e.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" })
                }
                maxLength={4}
                aria-invalid={errorField === "code" || errorField === "both"}
                aria-describedby="rsvp-code-help"
              />
              <p id="rsvp-code-help" className="mt-1 text-xs text-ink-500">
                {t("rsvp.checkin_code_help")}
              </p>
            </div>
          </div>

          {error && (
            <div className="mt-4 space-y-2" aria-live="polite" aria-atomic="true">
              <p className="field-error" role="alert">
                {error}
              </p>
              <a
                className="inline-block text-sm text-ink-600 underline underline-offset-2 hover:text-ink-900"
                href={t("rsvp.checkin_contact_hosts_email")}
              >
                {t("rsvp.checkin_contact_hosts")}
              </a>
            </div>
          )}

          <button type="submit" className="btn-accent btn-lg mt-6 w-full" disabled={submitting}>
            {submitting ? t("common.loading") : t("rsvp.checkin_submit")}
          </button>
        </form>
      )}

      {/* Kiosk mode controls. Off-state: a faint toggle at the foot of the
          page lets a greeter lock the device before handing it over. On-state:
          a 24px exit hotspot in the bottom-right corner. The hotspot is
          aria-labelled and reachable via Shift+K so keyboard users aren't
          stranded. */}
      {kiosk ? (
        <KioskExitHotspot onExit={exitKiosk} label={t("rsvp.kiosk_exit_hold")} />
      ) : (
        <div className="mt-10 text-center">
          {/* Most couples don't know what "kiosk mode" means without context —
              the hover/focus tooltip below explains why they'd flip it
              (greeter at the wedding hands a tablet to guests) so they don't
              accidentally lock themselves out of their own /rsvp. */}
          <div className="group relative inline-block">
            <button
              type="button"
              className="btn-ghost btn-sm text-ink-500 hover:text-ink-800"
              onClick={enterKiosk}
              aria-describedby="kiosk-enter-help"
            >
              {t("rsvp.kiosk_enter")}
            </button>
            <span
              id="kiosk-enter-help"
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-72 -translate-x-1/2 rounded-lg bg-ink-800 px-3 py-2 text-left text-xs leading-snug text-paper-100 opacity-0 shadow-pop transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
            >
              {t("rsvp.kiosk_enter_help")}
            </span>
          </div>
        </div>
      )}
    </FullPage>
  );
}

/** Bottom-right long-press target for exiting kiosk mode. Renders a tiny
 *  semi-translucent dot — discoverable to the host who knows where it is,
 *  invisible enough to ignore for a guest who doesn't. */
function KioskExitHotspot({ onExit, label }: { onExit: () => void; label: string }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [armed, setArmed] = useState(false);

  function cancel() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
    setArmed(false);
  }

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    startRef.current = { x: e.clientX, y: e.clientY };
    setArmed(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setArmed(false);
      onExit();
    }, KIOSK_EXIT_HOLD_MS);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const s = startRef.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.hypot(dx, dy) > KIOSK_PRESS_MOVE_TOLERANCE_PX) cancel();
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onPointerMove={onPointerMove}
      className={
        armed
          ? "fixed bottom-3 right-3 inline-flex size-8 items-center justify-center rounded-full border border-ink-400 bg-ink-700 text-paper-100 shadow-md transition-colors"
          : "fixed bottom-3 right-3 inline-flex size-8 items-center justify-center rounded-full border border-paper-300 bg-paper-50/70 text-ink-500 transition-colors hover:bg-paper-50"
      }
    >
      <Lock size={14} aria-hidden />
    </button>
  );
}

function FullPage({ children }: { children: React.ReactNode }) {
  // pb-32 reserves space at the bottom so the iOS soft keyboard doesn't park
  // itself directly over the submit button when a guest taps a meal/dietary
  // input — they can scroll past the form and still see the CTA.
  return (
    <div className="min-h-full bg-paper-100 px-4 pb-32 pt-8 sm:pt-16">
      <div className="mx-auto max-w-md">{children}</div>
    </div>
  );
}
