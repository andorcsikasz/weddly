// "Ez a sajátom" modal mounted from the public supplier directory. The flow:
// vendor clicks the CTA on their listing's card → confirm the email-on-file
// will receive a verification link → POST /api/vendor/claim/start → toast +
// close. The actual claim completes on the email-link landing page
// (`VendorClaimVerifyPage`) so closing this modal carries zero risk.
//
// Anonymous-friendly: the click works whether the user is signed in or not.
// The CTA is hidden for users already in `role === 'vendor'` by the caller.

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import { vendorClaimApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { Button, Dialog, TextField, useToast } from "./ui";

// Mirror of the backend `parseClaimantEmail` shape check — one `@`, a dot in
// the domain. Kept loose on purpose: this address is a who-is-asking signal
// for admins, not the inbox the verification link goes to.
function looksLikeEmail(value: string): boolean {
  const at = value.indexOf("@");
  return at >= 1 && at === value.lastIndexOf("@") && value.slice(at + 1).includes(".");
}

// ApiError.detail is typed `unknown` because the wire payload is freeform;
// the backend `email_unverified` / `already_claimed` / `no_contact_email`
// conventions carry a string `code`. Narrow once here so the call sites
// can read `.code` without sprinkling `as` casts at every comparison.
function detailCode(err: ApiError): string | undefined {
  const d = err.detail;
  if (d && typeof d === "object" && "code" in d) {
    const c = (d as { code: unknown }).code;
    return typeof c === "string" ? c : undefined;
  }
  return undefined;
}

type Props = {
  /** Public listing id (curated slug / `c{N}`). Null = closed. */
  listingId: string | null;
  listingName: string;
  onClose: () => void;
};

type State = { kind: "idle" } | { kind: "submitting" } | { kind: "sent"; maskedEmail: string };

export function ClaimListingModal({ listingId, listingName, onClose }: Props) {
  const { t } = useT();
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);

  // Reset every time the dialog opens for a new listing — closing + reopening
  // for the same id intentionally keeps the "sent" state so a misclick on
  // the close button doesn't lose the user's progress signal.
  useEffect(() => {
    if (listingId === null) return;
    setState({ kind: "idle" });
    setEmail("");
    setEmailError(null);
  }, [listingId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (listingId === null || state.kind !== "idle") return;
    const trimmed = email.trim();
    if (!looksLikeEmail(trimmed)) {
      setEmailError(t("vendor_claim.modal_email_invalid"));
      return;
    }
    setEmailError(null);
    setState({ kind: "submitting" });
    try {
      const res = await vendorClaimApi.start({
        listing_id: listingId,
        claimant_email: trimmed,
      });
      setState({ kind: "sent", maskedEmail: res.sent_to_masked });
    } catch (err) {
      setState({ kind: "idle" });
      if (err instanceof ApiError) {
        const code = detailCode(err);
        if (err.status === 409 && code === "already_claimed") {
          toast.error(t("vendor_claim.modal_err_already_claimed"));
        } else if (err.status === 409 && code === "no_contact_email") {
          toast.error(t("vendor_claim.modal_err_no_email"));
        } else if (err.status === 429) {
          toast.error(t("vendor_claim.modal_err_rate_limited"));
        } else if (err.status === 404) {
          toast.error(t("vendor_claim.modal_err_not_found"));
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error(t("common.error_generic"));
      }
    }
  }

  const submitting = state.kind === "submitting";

  return (
    <Dialog
      open={listingId !== null}
      role="dialog"
      title={t("vendor_claim.modal_title")}
      onClose={() => {
        if (!submitting) onClose();
      }}
      footer={
        state.kind === "sent" ? (
          <Button variant="primary" type="button" onClick={onClose}>
            {t("vendor_claim.modal_close")}
          </Button>
        ) : (
          <>
            <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="claim-listing-form"
              loading={submitting}
              loadingLabel={t("vendor_claim.modal_submitting")}
            >
              {t("vendor_claim.modal_submit")}
            </Button>
          </>
        )
      }
    >
      {state.kind === "sent" ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-700 dark:text-paper-100">
            {t("vendor_claim.modal_sent_body", { email: state.maskedEmail })}
          </p>
          <p className="text-xs text-ink-500 dark:text-umber-300">
            {t("vendor_claim.modal_sent_hint")}
          </p>
        </div>
      ) : (
        <form id="claim-listing-form" onSubmit={onSubmit} className="space-y-3">
          <p className="text-sm text-ink-700 dark:text-paper-100">
            {t("vendor_claim.modal_body_intro", { name: listingName })}
          </p>
          <TextField
            id="claim-claimant-email"
            type="email"
            autoComplete="email"
            required
            label={t("vendor_claim.modal_email_label")}
            helperText={t("vendor_claim.modal_email_help")}
            errorText={emailError ?? undefined}
            value={email}
            disabled={submitting}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailError) setEmailError(null);
            }}
          />
          <p className="text-sm text-ink-600 dark:text-umber-200">
            {t("vendor_claim.modal_body_email_hidden")}
          </p>
        </form>
      )}
    </Dialog>
  );
}
