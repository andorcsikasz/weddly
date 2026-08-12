import { PRIVACY_VERSION, TERMS_VERSION } from "@shared/legal";
import type { PlannerInvitePublic } from "@shared/types";
import { Mail } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppleSignInButton } from "../components/AppleSignInButton";
import { GoogleSignInButton } from "../components/GoogleSignInButton";
import { Shell } from "../components/Shell";
import { Button, PasswordField, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { authApi, plannerInviteApi } from "../lib/endpoints";
import { contentLocale, useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function RegisterPage() {
  const { t, locale } = useT();
  const toast = useToast();
  useDocumentMeta("seo.register_title", "seo.register_description");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the signup is parked server-side, which switches this page to the
  // "check your inbox" interstitial. There is no session to hold: register
  // creates nothing but a pending_signups row, and the account (plus its
  // session) only comes into being when the emailed link is clicked — see
  // VerifyEmailPage.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const errorId = useId();
  const [searchParams] = useSearchParams();
  // Set when the signup was reached via a planner email invitation
  // (`?planner_invite=<token>`). Drives the "X invited you" banner + email
  // prefill, and the token is forwarded to /api/auth/register so the backend
  // can link the new couple to the planner (consent-gated; the couple still
  // approves later).
  const plannerInviteToken = searchParams.get("planner_invite");
  const [plannerInvite, setPlannerInvite] = useState<PlannerInvitePublic | null>(null);

  useEffect(() => {
    // Persist the referral code for the onboarding wizard, which runs after
    // registration in a separate step (and may be on a different URL).
    const refCode = searchParams.get("ref_code");
    if (refCode) {
      try {
        localStorage.setItem("weddly.pending_ref_code", refCode.toUpperCase());
      } catch {
        // localStorage blocked (private mode etc.) — referral just won't fire
      }
    }
  }, [searchParams]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 640px)").matches) {
      nameRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (!plannerInviteToken) return;
    let cancelled = false;
    plannerInviteApi
      .lookup(plannerInviteToken)
      .then((info) => {
        if (cancelled) return;
        setPlannerInvite(info);
        // Prefill the invited address so the invitee doesn't have to retype it.
        setEmail(info.email);
      })
      .catch(() => {
        // Expired / unknown token — fall back to a plain signup, no banner.
      });
    return () => {
      cancelled = true;
    };
  }, [plannerInviteToken]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== passwordConfirm) {
      setError(t("auth.password_mismatch"));
      return;
    }
    setSubmitting(true);
    try {
      // Submitting the form is the affirmative act that records consent —
      // the "By continuing…" microcopy below the button names both
      // documents. Sending both version stamps means the audit ledger
      // gets a row per accepted document.
      // Funnel attribution: LandingPage stashes `?ref=rsvp|site|share` into
      // sessionStorage on first visit; carry that across the signup hop
      // and into the backend so growth_events can pin the acquisition
      // source instead of relying on the (often-empty) Referer header.
      let referrer: string | undefined;
      try {
        const raw = window.sessionStorage.getItem("weddly.ref");
        if (raw === "rsvp" || raw === "site" || raw === "share") referrer = raw;
      } catch {
        // sessionStorage blocked — drop attribution, keep the signup.
      }
      // UTM campaign params the LandingPage stashed this session. Spread into
      // the register body; the backend coerces + length-caps each field.
      const utm = readUtm();
      // Forward the planner-invite token (if any) so the backend links the
      // brand-new couple to the inviting planner. Spread in so the register
      // body type doesn't need to enumerate it; apiFetch sends the whole
      // object as JSON. (See report: endpoints.ts can add `planner_invite?:
      // string` to the register signature to type this explicitly.)
      const plannerInviteField = plannerInviteToken ? { planner_invite: plannerInviteToken } : {};
      const pending = await authApi.register({
        email: email.trim(),
        password,
        full_name: fullName.trim(),
        privacy_version: PRIVACY_VERSION,
        terms_version: TERMS_VERSION,
        // Carry the rendered locale so the user's preference survives across
        // devices — backend persists to users.locale. Only the two values
        // the i18n layer actually supports flow through.
        locale: contentLocale(locale),
        referrer,
        ...utm,
        ...plannerInviteField,
      });
      // Clear after a successful register so a re-signup attempt on the
      // same tab doesn't double-attribute. Failures keep the value so the
      // user's retry still carries the source.
      try {
        window.sessionStorage.removeItem("weddly.ref");
        window.sessionStorage.removeItem("weddly.utm");
      } catch {
        /* non-fatal */
      }
      setPendingEmail(pending.email);
    } catch (err) {
      setError(messageFor(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    if (!pendingEmail) return;
    setResending(true);
    try {
      // The public, email-keyed resend: there is no account and no session yet
      // (the signup is parked in pending_signups until the link is clicked), so
      // the authenticated /verify/request has nothing to authenticate with.
      await authApi.requestVerifyPublic(pendingEmail);
      toast.success(t("verify.banner_resent"));
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 429
          ? t("auth.rate_limited")
          : t("common.error_generic");
      toast.error(msg);
    } finally {
      setResending(false);
    }
  }

  if (pendingEmail) {
    return (
      <Shell>
        <div className="mx-auto max-w-md">
          <div className="card text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center text-umber-800">
              <Mail size={28} strokeWidth={1.5} />
            </div>
            <h1 className="mt-5 font-grotesk text-2xl text-umber-900 dark:text-paper-50">
              {t("verify.check_inbox_title")}
            </h1>
            <p className="mt-3 text-sm text-umber-800">{t("verify.check_inbox_body")}</p>
            <p className="mt-4 break-all rounded-lg bg-paper-100 px-3 py-2 text-sm font-medium text-umber-900">
              {pendingEmail}
            </p>
            <p className="mt-4 text-xs text-umber-600">{t("verify.check_inbox_spam_hint")}</p>
            {/* No "skip into the app" affordance any more: the account doesn't
                exist until the link is clicked, so there is nothing to skip
                into. Clicking the link is what creates it and signs them in. */}
            <div className="mt-6 flex flex-col gap-3">
              <Button
                type="button"
                variant="outline"
                fullWidth
                loading={resending}
                loadingLabel={t("verify.banner_resending")}
                onClick={onResend}
              >
                {t("verify.banner_resend")}
              </Button>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mx-auto max-w-md">
        <div className="card">
          {plannerInvite && (
            <div className="mb-5 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
              <p className="text-sm font-medium text-amber-950 break-words hyphens-auto dark:text-amber-100">
                {t("auth.planner_invite_banner", { planner: plannerInvite.planner_label })}
              </p>
              <p className="mt-1 text-xs text-amber-900/80 dark:text-amber-200/80">
                {t("auth.planner_invite_banner_hint")}
              </p>
            </div>
          )}
          <h1 className="font-grotesk text-2xl text-umber-900 dark:text-paper-50">
            {t("auth.register_title")}
          </h1>
          <div className="mt-6 space-y-3">
            {/* oneTap (without autoSelect) means a returning Google user
                lands here, gets the floating prompt, and one-taps to sign
                in. We deliberately leave autoSelect off on /signup so a
                visitor who came specifically to register doesn't get
                silently signed in as an existing account. */}
            <GoogleSignInButton mode="signup" redirectTo="/onboarding" oneTap />
            <AppleSignInButton mode="signup" redirectTo="/onboarding" />
          </div>
          <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-umber-600">
            <span className="h-px flex-1 bg-paper-200 dark:bg-umber-700" />
            <span>{t("auth.or")}</span>
            <span className="h-px flex-1 bg-paper-200 dark:bg-umber-700" />
          </div>
          <form className="space-y-4" onSubmit={onSubmit} noValidate>
            <div>
              <label htmlFor="full_name" className="field-label">
                {t("auth.full_name_label")}
              </label>
              <input
                ref={nameRef}
                id="full_name"
                type="text"
                className={`input ${error ? "input-invalid" : ""}`}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                required
              />
            </div>
            <div>
              <label htmlFor="email" className="field-label">
                {t("auth.email_label")}
              </label>
              <input
                id="email"
                type="email"
                className={`input ${error ? "input-invalid" : ""}`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                inputMode="email"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                required
              />
            </div>
            <PasswordField
              id="password"
              label={t("auth.password_label")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              helperText={t("auth.short_password")}
            />
            <PasswordField
              id="password_confirm"
              label={t("auth.password_confirm_label")}
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              errorText={
                passwordConfirm.length > 0 && passwordConfirm !== password
                  ? t("auth.password_mismatch")
                  : undefined
              }
            />
            {error && (
              <p id={errorId} className="field-error" role="alert">
                {error}
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              fullWidth
              loading={submitting}
              loadingLabel={t("common.loading")}
            >
              {t("auth.submit_register")}
            </Button>
            {/* Clickwrap-style consent: submitting the form is the
                affirmative act that accepts both policies. Both links
                stay react-router <Link>s so the SPA doesn't reload. */}
            <p className="field-help mt-3 text-center">
              {t("register.continuing_prefix")}
              <Link to="/privacy" className="underline hover:text-umber-800">
                {t("register.continuing_privacy_link")}
              </Link>
              {t("register.continuing_and")}
              <Link to="/terms" className="underline hover:text-umber-800">
                {t("register.continuing_terms_link")}
              </Link>
              {t("register.continuing_suffix")}
            </p>
          </form>
          <p className="mt-4 text-center text-sm text-umber-700">
            {t("auth.have_account")}{" "}
            <Link to="/login" className="font-medium text-umber-900 underline">
              {t("auth.submit_login")}
            </Link>
          </p>
          {/* Mobile-only escape hatch: a vendor / planner who landed on the
              couple signup gets a clear way across. On desktop these live in
              the landing hero's role chips + header, so hide there. */}
          <div className="mt-4 border-t border-paper-200 pt-4 text-center sm:hidden dark:border-umber-700">
            <p className="text-xs uppercase tracking-wider text-umber-600">
              {t("auth.register_role_prompt")}
            </p>
            <div className="mt-2 flex items-center justify-center gap-5 text-sm">
              <Link
                to="/suppliers"
                className="font-medium text-umber-900 underline dark:text-paper-100"
              >
                {t("auth.register_as_vendor")}
              </Link>
              <Link
                to="/planners"
                className="font-medium text-umber-900 underline dark:text-paper-100"
              >
                {t("auth.register_as_planner")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

/** UTM params the LandingPage stashed to sessionStorage this session. Returns
 *  only the canonical keys with string values; a blocked/empty/corrupt store
 *  yields {} so the signup proceeds without attribution. */
function readUtm(): {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
} {
  try {
    const raw = window.sessionStorage.getItem("weddly.utm");
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
      const v = parsed[key];
      if (typeof v === "string" && v.length > 0) out[key] = v.slice(0, 200);
    }
    return out;
  } catch {
    return {};
  }
}

function messageFor(err: unknown, t: ReturnType<typeof useT>["t"]): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return t("auth.duplicate_email");
    if (err.status === 429) return t("auth.rate_limited");
    if (err.status === 400) return err.message;
  }
  return t("common.error_generic");
}
