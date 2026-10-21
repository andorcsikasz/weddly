// /camera/start: the non-Weddly path into Weddly Camera. Someone who picked the
// stand-alone price on /camera lands here, names the wedding, picks the guest
// tier and goes straight to Stripe (EUR). No planner onboarding on the way.
//
// Three states, decided by the session:
//   - signed out: the page remembers itself (post_signup_destination) and
//     sends the visitor to sign up; after email verification the onboarding
//     route hands them straight back here (takeCameraStartDestination).
//   - signed in WITH a workspace: they already have Weddly, so the film lives
//     in their workspace at the couple price → /app/media.
//   - signed in without one: the form below.
//
// A tryout code (an admin hands out /camera/start?code=…) replaces the
// payment step: the form checks it before creating anything, then creates
// the workspace and the film and redeems the code instead of going to Stripe.

import { checkRealName } from "@shared/real_names";
import { FILM_PRICE_TIERS, filmTier, formatEurCents } from "@shared/film_pricing";
import { ArrowRight, Check, Lock, Ticket, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { filmCodeApi, photoAlbumApi } from "../lib/endpoints";
import { filmCodeErrorKey, normalizeFilmCode } from "../lib/film_codes";
import { useT } from "../lib/i18n";
import { rememberDestination } from "../lib/post_signup_destination";
import { realNameErrorKey } from "../lib/real_names";
import { useDocumentMeta } from "../lib/seo";

const DEFAULT_CAP = 100;

export default function CameraStartPage() {
  const { t } = useT();
  useDocumentMeta("camera.seo_title", "camera.seo_description");
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requested = Number(params.get("cap"));
  const [cap, setCap] = useState(filmTier(requested) ? requested : DEFAULT_CAP);
  const [bride, setBride] = useState("");
  const [groom, setGroom] = useState("");
  const [date, setDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameErrorsShown, setNameErrorsShown] = useState(false);
  const linkCode = normalizeFilmCode(params.get("code") ?? "");
  const [codeOpen, setCodeOpen] = useState(linkCode !== null);
  const [codeInput, setCodeInput] = useState(linkCode ?? "");
  const [applied, setApplied] = useState<{ code: string; cap: number } | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // Signed out: remember this page (with its tier and any code) across sign-up.
  useEffect(() => {
    if (loading || user) return;
    rememberDestination(`/camera/start?cap=${cap}${linkCode ? `&code=${linkCode}` : ""}`);
    navigate("/signup", { replace: true });
  }, [loading, user, cap, linkCode, navigate]);

  async function applyCode(raw: string) {
    const code = normalizeFilmCode(raw);
    if (!code) {
      setCodeError(t("camera.code_error_invalid_code"));
      return;
    }
    setChecking(true);
    setCodeError(null);
    try {
      const { cap: codeCap } = await filmCodeApi.check(code);
      setApplied({ code, cap: codeCap });
    } catch (err) {
      setCodeError(t(filmCodeErrorKey(err)));
    } finally {
      setChecking(false);
    }
  }

  // A code that arrived in the link is checked as soon as we know who is asking.
  useEffect(() => {
    if (!loading && user && user.couple_id === null && linkCode) void applyCode(linkCode);
  }, [loading, user?.id]);

  if (loading || !user) return null;
  if (user.couple_id !== null || user.user_type === "planner" || user.role === "vendor") {
    // Someone with a workspace redeems on the film page, code and all.
    return <Navigate to={linkCode ? `/app/media?code=${linkCode}` : "/app/media"} replace />;
  }

  const tier = filmTier(cap) ?? FILM_PRICE_TIERS[2];
  const brideVerdict = checkRealName(bride.trim());
  const groomVerdict = checkRealName(groom.trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    setNameErrorsShown(true);
    if (brideVerdict || groomVerdict) return;
    setSubmitting(true);
    setError(null);
    try {
      await photoAlbumApi.createCameraEvent({
        bride_name: bride.trim(),
        groom_name: groom.trim(),
        wedding_date: date || null,
      });
      await photoAlbumApi.create({ title: `${bride.trim()} & ${groom.trim()}` });
      await refresh();
      if (applied) {
        // The workspace and film exist now; if the code was spent in the
        // meantime the film page says so and offers the plans instead.
        try {
          await filmCodeApi.redeem(applied.code);
          navigate(`/app/media?film=code&cap=${applied.cap}`, { replace: true });
        } catch {
          navigate("/app/media", { replace: true });
        }
        return;
      }
      try {
        const { url } = await photoAlbumApi.filmCheckout(cap);
        window.location.href = url;
      } catch (err) {
        // The workspace and the film exist; if payments are not live yet the
        // film page explains it and offers the plan again once they are.
        if (err instanceof ApiError && err.status === 503) {
          navigate("/app/media", { replace: true });
          return;
        }
        throw err;
      }
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && err.status === 409) {
        navigate("/app/media", { replace: true });
        return;
      }
      setError(t("common.error_generic"));
    }
  }

  const inputClass =
    "min-h-12 w-full rounded-xl border border-paper-50/15 bg-paper-50/[0.05] px-4 text-base text-paper-50 placeholder:text-paper-500 focus:border-paper-50/60 focus:outline-none";

  return (
    <PublicShell flushFooter>
      <div className="dark bg-umber-950 font-grotesk text-paper-100">
        <div className="mx-auto max-w-lg px-4 py-12 sm:px-6 sm:py-20">
          <h1 className="text-3xl font-semibold tracking-tight text-paper-50 sm:text-4xl">
            {t("camera.start_title")}
          </h1>
          <p className="mt-2 text-sm text-paper-400">{t("camera.start_body")}</p>

          <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-paper-300">
                  {t("camera.start_bride")}
                </span>
                <input
                  className={inputClass}
                  value={bride}
                  onChange={(e) => setBride(e.target.value)}
                  autoComplete="given-name"
                  required
                />
                {nameErrorsShown && brideVerdict && (
                  <span className="mt-1 block text-xs text-amber-400">
                    {t(realNameErrorKey(brideVerdict.reason))}
                  </span>
                )}
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-paper-300">
                  {t("camera.start_groom")}
                </span>
                <input
                  className={inputClass}
                  value={groom}
                  onChange={(e) => setGroom(e.target.value)}
                  required
                />
                {nameErrorsShown && groomVerdict && (
                  <span className="mt-1 block text-xs text-amber-400">
                    {t(realNameErrorKey(groomVerdict.reason))}
                  </span>
                )}
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-paper-300">
                {t("camera.start_date")}
              </span>
              <input
                type="date"
                className={`${inputClass} [color-scheme:dark]`}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>

            {!applied && (
              <fieldset>
                <legend className="mb-1.5 block text-xs font-semibold text-paper-300">
                  {t("camera.standalone_title")}
                </legend>
                <div className="grid grid-cols-6 gap-1 rounded-full bg-paper-50/[0.06] p-1">
                  {FILM_PRICE_TIERS.map((tw) => (
                    <button
                      key={tw.cap}
                      type="button"
                      aria-pressed={tw.cap === cap}
                      aria-label={t("camera.pricing_guest_cap", { n: tw.cap })}
                      onClick={() => setCap(tw.cap)}
                      className={`min-h-10 rounded-full text-sm font-semibold tabular-nums transition-colors ${
                        tw.cap === cap
                          ? "bg-paper-50 text-umber-950"
                          : "text-paper-50/40 hover:text-paper-50/80"
                      }`}
                    >
                      {tw.cap}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {applied ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-umber-900 px-5 py-4 ring-2 ring-paper-50">
                <div className="flex min-w-0 items-center gap-3">
                  <Check size={18} className="shrink-0 text-sage-300" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-paper-50">
                      {t("camera.code_applied", { n: applied.cap })}
                    </p>
                    <p className="mt-0.5 font-mono text-sm tracking-wide text-paper-400">
                      {applied.code}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setApplied(null);
                    setCodeInput("");
                  }}
                  aria-label={t("camera.code_remove")}
                  title={t("camera.code_remove")}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-paper-400 transition-colors hover:bg-paper-50/10 hover:text-paper-50"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-2xl bg-umber-900 px-5 py-4 ring-2 ring-paper-50">
                <div>
                  <p className="text-base font-semibold text-paper-50">
                    {t("camera.pricing_standard")}
                  </p>
                  <p className="mt-0.5 text-sm text-paper-400">
                    {t("camera.pricing_guest_cap", { n: tier?.cap ?? cap })}
                  </p>
                </div>
                <span className="stat-num text-2xl font-semibold tabular-nums text-paper-50">
                  {formatEurCents(tier?.standaloneCents ?? 0)}
                </span>
              </div>
            )}

            {!applied &&
              (codeOpen ? (
                <div>
                  <div className="flex gap-2">
                    <input
                      className={`${inputClass} font-mono uppercase tracking-wide`}
                      value={codeInput}
                      onChange={(e) => {
                        setCodeInput(e.target.value.toUpperCase());
                        setCodeError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void applyCode(codeInput);
                        }
                      }}
                      placeholder={t("camera.code_placeholder")}
                      aria-label={t("camera.code_placeholder")}
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      enterKeyHint="done"
                    />
                    <button
                      type="button"
                      onClick={() => void applyCode(codeInput)}
                      disabled={checking || codeInput.trim() === ""}
                      className="min-h-12 shrink-0 rounded-xl border border-paper-50/25 px-4 text-sm font-semibold text-paper-50 transition-colors hover:bg-paper-50/10 disabled:opacity-40"
                    >
                      {checking ? "…" : t("camera.code_apply")}
                    </button>
                  </div>
                  {codeError && (
                    <p className="mt-1.5 text-xs text-amber-400" role="alert">
                      {codeError}
                    </p>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCodeOpen(true)}
                  className="flex items-center gap-1.5 text-sm font-medium text-paper-400 underline-offset-4 transition-colors hover:text-paper-50 hover:underline"
                >
                  <Ticket size={15} strokeWidth={1.5} aria-hidden="true" />
                  {t("camera.code_toggle")}
                </button>
              ))}

            {error && <p className="text-sm text-amber-400">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-paper-50 px-7 py-3.5 text-base font-semibold text-umber-950 transition-[transform,background-color] duration-150 hover:bg-paper-100 active:scale-[0.98] disabled:opacity-60"
            >
              {submitting ? "…" : applied ? t("camera.code_cta") : t("camera.start_pay_cta")}
              {!submitting && <ArrowRight size={18} aria-hidden="true" />}
            </button>
            {!applied && (
              <p className="flex items-center justify-center gap-1.5 text-xs text-paper-500">
                <Lock size={12} aria-hidden="true" />
                {t("camera.start_secure_note")}
              </p>
            )}
          </form>
        </div>
      </div>
    </PublicShell>
  );
}
