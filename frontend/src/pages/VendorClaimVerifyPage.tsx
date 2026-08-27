// Landing page for the verify-email link sent by /api/vendor/claim/start. The
// token in the path is the bearer credential — no auth required. Flow:
//   1. Mount → POST /api/vendor/claim/verify/:token → render the claim view
//      (listing name, email confirmed, status).
//   2. User fills password + name → POST /api/vendor/claim/complete → server
//      atomically creates the vendor user + account + flips the listing.
//   3. Frontend installs the returned session via useAuth().setSession and
//      navigates to /vendor (the new vendor home stub).
//
// Status branches: pending → render form; expired/cancelled/already_verified
// → render explanatory copy + link home.

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { Skeleton, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { vendorClaimApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import type { ClaimVerifyView } from "@shared/vendor_claim";
import { PRIVACY_VERSION, VENDOR_TERMS_VERSION } from "@shared/legal";

// Narrow ApiError.detail (typed `unknown`) to its conventional `{ code }`
// shape so callers can branch on `code === "email_taken"` etc. without
// scattering casts. Mirror of the helper in ClaimListingModal.tsx — kept
// local to avoid a one-helper lib module for now.
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
  | { kind: "form"; view: ClaimVerifyView }
  | { kind: "completing"; view: ClaimVerifyView }
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "cancelled" }
  | { kind: "already_verified" }
  /** The listing is a wedding planner's: claiming it would mint a vendor
   *  account, which is the wrong product for them. Sends them to /planners
   *  instead of failing. Reachable from links minted before the guard existed. */
  | { kind: "planner"; view: ClaimVerifyView };

export default function VendorClaimVerifyPage() {
  const { token = "" } = useParams<{ token: string }>();
  const { t } = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const { setSession } = useAuth();
  useDocumentMeta("vendor_claim.page_title", "vendor_claim.page_body");

  const [state, setState] = useState<State>({ kind: "loading" });
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedVendorTerms, setAcceptedVendorTerms] = useState(false);
  const [acceptedHighlightedTerms, setAcceptedHighlightedTerms] = useState(false);

  useEffect(() => {
    if (!token) {
      setState({ kind: "invalid" });
      return;
    }
    let cancelled = false;
    vendorClaimApi
      .verify(token)
      .then((res) => {
        if (cancelled) return;
        if (res.claim.blocked === "planner") setState({ kind: "planner", view: res.claim });
        else if (res.claim.status === "expired") setState({ kind: "expired" });
        else if (res.claim.status === "cancelled") setState({ kind: "cancelled" });
        else if (res.claim.status === "verified") setState({ kind: "already_verified" });
        else setState({ kind: "form", view: res.claim });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          if (err.status === 410) setState({ kind: "expired" });
          else if (err.status === 404) setState({ kind: "invalid" });
          else setState({ kind: "invalid" });
        } else {
          setState({ kind: "invalid" });
        }
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
      toast.error(t("vendor_claim.form_err_name"));
      return;
    }
    if (password.length < 8) {
      toast.error(t("vendor_claim.form_err_password"));
      return;
    }
    if (!acceptedVendorTerms || !acceptedHighlightedTerms) {
      toast.error(t("vendor_register.legal_accept_required"));
      return;
    }
    setState({ kind: "completing", view: state.view });
    try {
      const session = await vendorClaimApi.complete({
        token,
        password,
        full_name: trimmedName,
        privacy_version: PRIVACY_VERSION,
        vendor_terms_version: VENDOR_TERMS_VERSION,
        highlighted_terms_accepted: true,
      });
      setSession(session.token, session.user);
      toast.success(t("vendor_claim.success_toast"));
      navigate("/vendor", { replace: true });
    } catch (err) {
      setState({ kind: "form", view: state.view });
      if (err instanceof ApiError) {
        const code = detailCode(err);
        if (err.status === 409 && code === "email_taken") {
          toast.error(t("vendor_claim.form_err_email_taken"));
        } else if (err.status === 409 && code === "already_claimed") {
          toast.error(t("vendor_claim.form_err_already_claimed"));
        } else if (err.status === 409 && code === "already_verified") {
          setState({ kind: "already_verified" });
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
          ) : state.kind === "planner" ? (
            <>
              <h1 className="text-2xl">{t("vendor_claim.planner_title")}</h1>
              <p className="mt-2 text-sm text-ink-700 dark:text-paper-100">
                {t("vendor_claim.planner_body", { name: state.view.listing_name })}
              </p>
              <p className="mt-6">
                <Link to="/planners" className="btn-primary w-full justify-center">
                  {t("vendor_claim.planner_cta")}
                </Link>
              </p>
              <p className="mt-3 text-center">
                <Link to="/" className="btn-ghost">
                  {t("vendor_claim.page_home")}
                </Link>
              </p>
            </>
          ) : state.kind === "form" || state.kind === "completing" ? (
            <>
              <h1 className="text-2xl">{t("vendor_claim.form_title")}</h1>
              <p className="mt-2 text-sm text-ink-700 dark:text-paper-100">
                {t("vendor_claim.form_intro", {
                  name: state.view.listing_name,
                  email: state.view.email,
                })}
              </p>
              <form className="mt-6 space-y-4" onSubmit={onSubmit}>
                <div>
                  <label className="field-label" htmlFor="claim-full-name">
                    {t("vendor_claim.form_name_label")}
                  </label>
                  <input
                    id="claim-full-name"
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
                  <label className="field-label" htmlFor="claim-password">
                    {t("vendor_claim.form_password_label")}
                  </label>
                  <input
                    id="claim-password"
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
                    {t("vendor_claim.form_password_hint")}
                  </p>
                </div>
                <div className="space-y-3 rounded-xl border border-umber-200 bg-paper-50 p-4 text-sm text-umber-800">
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={acceptedVendorTerms}
                      onChange={(e) => setAcceptedVendorTerms(e.target.checked)}
                      disabled={state.kind === "completing"}
                      required
                    />
                    <span>
                      {t("vendor_register.legal_accept_prefix")}{" "}
                      <Link
                        to="/terms/vendor-subscription"
                        target="_blank"
                        rel="noopener"
                        className="underline hover:text-umber-950"
                      >
                        {t("vendor_register.legal_accept_link")}
                      </Link>{" "}
                      {t("vendor_register.legal_accept_suffix")}
                    </span>
                  </label>
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={acceptedHighlightedTerms}
                      onChange={(e) => setAcceptedHighlightedTerms(e.target.checked)}
                      disabled={state.kind === "completing"}
                      required
                    />
                    <span>{t("vendor_register.highlighted_accept")}</span>
                  </label>
                </div>
                <button
                  type="submit"
                  className="btn-primary w-full"
                  disabled={state.kind === "completing"}
                >
                  {state.kind === "completing"
                    ? t("vendor_claim.form_submitting")
                    : t("vendor_claim.form_submit")}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="text-2xl">{t("vendor_claim.page_title")}</h1>
              <p className="mt-4 text-sm text-ink-700 dark:text-paper-100">
                {state.kind === "invalid" && t("vendor_claim.page_invalid")}
                {state.kind === "expired" && t("vendor_claim.page_expired")}
                {state.kind === "cancelled" && t("vendor_claim.page_cancelled")}
                {state.kind === "already_verified" && t("vendor_claim.page_already_verified")}
              </p>
              <p className="mt-6">
                <Link to="/" className="btn-ghost">
                  {t("vendor_claim.page_home")}
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
