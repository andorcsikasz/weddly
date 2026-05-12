// Public confirmation page for community-supplier listings. Linked from the
// verification email sent to the listing's `contact_email`. No auth — the
// token in the path acts as bearer. Distinct page from /verify-email so the
// copy can speak to the vendor (not the couple) without ambiguity.

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { ApiError } from "../lib/api";
import { supplierApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

type State =
  | { kind: "loading" }
  | { kind: "success"; alreadyConsumed: boolean }
  | { kind: "invalid" }
  | { kind: "expired" }
  | { kind: "missing" };

export default function VerifySupplierPage() {
  const { token = "" } = useParams<{ token: string }>();
  const { t } = useT();
  useDocumentMeta("verify_supplier.page_title", "verify_supplier.page_body");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!token) {
      setState({ kind: "invalid" });
      return;
    }
    let cancelled = false;
    supplierApi
      .verifyCommunity(token)
      .then((res) => {
        if (cancelled) return;
        setState({ kind: "success", alreadyConsumed: res.already_consumed });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          if (err.status === 410) setState({ kind: "expired" });
          else if (err.status === 404) setState({ kind: "missing" });
          else setState({ kind: "invalid" });
        } else {
          setState({ kind: "invalid" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <Shell>
      <div className="mx-auto max-w-md">
        <div className="card">
          <h1 className="text-2xl">{t("verify_supplier.page_title")}</h1>
          <p className="mt-4 text-sm text-ink-700">
            {state.kind === "loading" && t("verify_supplier.page_loading")}
            {state.kind === "success" &&
              (state.alreadyConsumed
                ? t("verify_supplier.page_already")
                : t("verify_supplier.page_success"))}
            {state.kind === "invalid" && t("verify_supplier.page_invalid")}
            {state.kind === "expired" && t("verify_supplier.page_expired")}
            {state.kind === "missing" && t("verify_supplier.page_missing")}
          </p>
          {state.kind !== "loading" && (
            <p className="mt-4 text-sm text-ink-600">
              <Link to="/" className="font-medium text-ink-900 underline">
                {t("verify_supplier.page_home")}
              </Link>
            </p>
          )}
        </div>
      </div>
    </Shell>
  );
}
