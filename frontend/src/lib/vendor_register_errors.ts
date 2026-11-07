// What a failed vendor signup says to the vendor. Shared by the full signup
// form (/suppliers/signup) and the short in-person QR form (/suppliers/join),
// which post to the same endpoint and must explain its refusals the same way.

import { ApiError } from "./api";
import type { useT } from "./i18n";

export function vendorRegisterErrorMessage(err: unknown, t: ReturnType<typeof useT>["t"]): string {
  if (err instanceof ApiError) {
    if (err.status === 409) {
      // Two very different 409s, and every one of them used to read as
      // "that email is taken". The business already being in the directory is
      // not a duplicate account, it is an invitation to take over the card
      // couples are already browsing, so it has to say which business and
      // where to go. Claiming is a separate, email-verified flow on purpose.
      const detail = err.detail as
        | { code?: string; listing?: { id?: string; name?: string } }
        | undefined;
      if (detail?.code === "listing_exists_unclaimed") {
        return t("vendor_register.err_listing_exists", {
          name: detail.listing?.name ?? "",
          url: `/suppliers/${detail.listing?.id ?? ""}`,
        });
      }
      return t("auth.duplicate_email");
    }
    if (err.status === 429) return t("auth.rate_limited");
    if (err.status === 400) return err.message;
  }
  return t("common.error_generic");
}
