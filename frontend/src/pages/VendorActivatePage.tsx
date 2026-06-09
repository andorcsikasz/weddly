// Activation landing for the link in the accepted-waitlist email
// (/vendor/activate/:token). The token in the path is the bearer credential —
// no auth required. Flow:
//   1. Mount → POST /api/vendor/onboard/verify/:token → render the activate view
//      (business name + honest "N of 100 spots left").
//   2. Vendor fills name + password → POST /api/vendor/onboard/complete →
//      server creates the vendor user + account + a live listing + the founding
//      (or trial) subscription. No card is asked.
//   3. Install the returned session via useAuth().setSession → navigate to
//      /vendor (the listing editor).
//
// Status branches: pending → form; expired/completed → explanatory copy.

import { Sparkles } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { Skeleton, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { vendorOnboardingApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import type { VendorOnboardingVerifyView } from "@shared/vendor_onboarding";

function detailCode(err: ApiError): string | undefined {
  const d = err.detail;
  if (d && typeof d === "object" && "code" in d) {
    const c = (d as { code: unknown }).code;
    return typeof c === "string" ? c : undefined;
  }
  return undefined;
}

type State =
  | { kind: "loading" }
  | { kind: "form"; view: VendorOnboardingVerifyView }
  | { kind: "completing"; view: VendorOnboardingVerifyView }
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "completed" };

export default function VendorActivatePage() {
  const { token = "" } = useParams<{ token: string }>();
  const { t, locale } = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const { setSession } = useAuth();
  useDocumentMeta("vendor_activate.page_title", "vendor_activate.page_body");

  const [state, setState] = useState<State>({ kind: "loading" });
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!token) {
      setState({ kind: "invalid" });
      return;
    }
    let cancelled = false;
    vendorOnboardingApi
      .verify(token)
      .then((res) => {
        if (cancelled) return;
        const o = res.onboarding;
        if (o.status === "expired") setState({ kind: "expired" });
        else if (o.status === "cancelled") setState({ kind: "expired" });
        else if (o.status === "completed") setState({ kind: "completed" });
        else setState({ kind: "form", view: o });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 410) setState({ kind: "expired" });
        else setState({ kind: "invalid" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (state.kind !== "form") return;
    const trimmedName = fullName.trim();
    if (trimmedName.length < 1) {
      toast.error(t("vendor_activate.form_err_name"));
      return;
    }
    if (password.length < 8) {
      toast.error(t("vendor_activate.form_err_password"));
      return;
    }
    setState({ kind: "completing", view: state.view });
    try {
      const session = await vendorOnboardingApi.complete({
        token,
        password,
        full_name: trimmedName,
        locale,
      });
      setSession(session.token, session.user);
      toast.success(t("vendor_activate.success_toast"));
      navigate("/vendor", { replace: true });
    } catch (err) {
      setState({ kind: "form", view: state.view });
      if (err instanceof ApiError) {
        const code = detailCode(err);
        if (err.status === 409 && code === "email_taken") {
          toast.error(t("vendor_activate.form_err_email_taken"));
        } else if (err.status === 409 && code === "already_completed") {
          setState({ kind: "completed" });
        } else if (err.status === 410) {
          setState({ kind: "expired" });
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error(t("common.error_generic"));
      }
    }
  }

  const view = state.kind === "form" || state.kind === "completing" ? state.view : null;
  const hasFoundingSpots = view != null && view.founding_spots_left > 0;

  return (
    <Shell>
      <div className="mx-auto max-w-md">
        <div className="card">
          {state.kind === "loading" ? (
            <>
              <Skeleton variant="circle" width={40} />
              <Skeleton variant="block" height={28} rounded="md" className="mt-4 w-3/5" />
              <div className="mt-4 flex flex-col gap-2">
                <Skeleton variant="line" height={12} width="85%" />
                <Skeleton variant="line" height={12} width="55%" />
              </div>
            </>
          ) : view != null ? (
            <>
              {hasFoundingSpots ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-blush-200 bg-blush-50 px-3 py-1 text-xs font-medium text-blush-700 dark:border-blush-400/30 dark:bg-blush-400/15 dark:text-blush-200">
                  <Sparkles size={13} aria-hidden />
                  {t("vendor_activate.founding_badge", {
                    left: view.founding_spots_left,
                    cap: view.founding_cap,
                  })}
                </span>
              ) : null}
              <h1 className="mt-3 text-2xl">
                {t("vendor_activate.form_title", { name: view.business_name })}
              </h1>
              <p className="mt-2 text-sm text-ink-700 dark:text-paper-100">
                {t("vendor_activate.form_intro")}
              </p>
              <p className="mt-2 text-sm text-ink-500 dark:text-umber-300">
                {hasFoundingSpots
                  ? t("vendor_activate.founding_note")
                  : t("vendor_activate.cohort_full_note")}
              </p>
              <form className="mt-6 space-y-4" onSubmit={onSubmit}>
                <div>
                  <label className="field-label" htmlFor="activate-full-name">
                    {t("vendor_activate.form_name_label")}
                  </label>
                  <input
                    id="activate-full-name"
                    className="input"
                    type="text"
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    disabled={state.kind === "completing"}
                    maxLength={200}
                    required
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="activate-password">
                    {t("vendor_activate.form_password_label")}
                  </label>
                  <input
                    id="activate-password"
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={state.kind === "completing"}
                    minLength={8}
                    required
                  />
                  <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">
                    {t("vendor_activate.form_password_hint")}
                  </p>
                </div>
                <button
                  type="submit"
                  className="btn-primary w-full"
                  disabled={state.kind === "completing"}
                >
                  {state.kind === "completing"
                    ? t("vendor_activate.form_submitting")
                    : t("vendor_activate.form_submit")}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="text-2xl">{t("vendor_activate.page_title")}</h1>
              <p className="mt-4 text-sm text-ink-700 dark:text-paper-100">
                {state.kind === "invalid" && t("vendor_activate.page_invalid")}
                {state.kind === "expired" && t("vendor_activate.page_expired")}
                {state.kind === "completed" && t("vendor_activate.page_completed")}
              </p>
              <p className="mt-6">
                <Link to="/" className="btn-ghost">
                  {t("vendor_activate.page_home")}
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
