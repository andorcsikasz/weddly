// Minimum vendor landing page — what a freshly-claimed vendor lands on after
// the verify-and-complete flow. Phase 2.5+ will replace this with a real
// dashboard (listing editor, lead inbox, analytics). For now, the page
// confirms the claim worked and surfaces the next steps in plain copy.
//
// Auth requirements: this page is for `role === 'vendor'` users only.
// Non-vendor authenticated users get bounced to /app; anon users get bounced
// to /login. The redirect avoids ambient onboarding flow side-effects that
// would otherwise fire for `couple_id === null` users.

import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Shell } from "../components/Shell";
import { useAuth } from "../lib/auth";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function VendorHomePage() {
  const { user, loading } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();
  useDocumentMeta("vendor_home.page_title", "vendor_home.page_body");

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }
    if (user.role !== "vendor") {
      navigate("/app", { replace: true });
    }
  }, [user, loading, navigate]);

  if (loading || !user || user.role !== "vendor") {
    return null;
  }

  return (
    <Shell>
      <div className="mx-auto max-w-2xl">
        <div className="card">
          <h1 className="text-2xl">{t("vendor_home.welcome", { name: user.full_name })}</h1>
          <p className="mt-4 text-sm text-ink-700 dark:text-paper-100">
            {t("vendor_home.intro")}
          </p>
          <p className="mt-4 text-sm text-ink-600 dark:text-umber-200">
            {t("vendor_home.coming_soon")}
          </p>
          <p className="mt-6">
            <Link to="/vendors" className="btn-ghost">
              {t("vendor_home.back_to_directory")}
            </Link>
          </p>
        </div>
      </div>
    </Shell>
  );
}
