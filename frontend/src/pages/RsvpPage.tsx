// Legacy single-guest RSVP page — `/rsvp/<6char-invite-code>`. Old invites
// printed before the household refactor still resolve here. The server
// returns the guest's whole household, so we render the same airport-style
// HouseholdRsvpForm as the new check-in page.

import type { PublicCheckinView } from "@shared/types";
import { Languages } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { HouseholdRsvpForm } from "../components/HouseholdRsvpForm";
import { Wordmark } from "../components/Wordmark";
import { Skeleton } from "../components/ui";
import { ApiError } from "../lib/api";
import { rsvpApi } from "../lib/endpoints";
import { nextLocale, useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function RsvpPage() {
  const { code = "" } = useParams<{ code: string }>();
  const { t, locale, setLocale } = useT();
  useDocumentMeta("seo.rsvp_legacy_title", "seo.rsvp_legacy_description");
  const [view, setView] = useState<PublicCheckinView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rsvpApi
      .legacyGet(code)
      .then((r) => setView(r.rsvp))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) setError(t("rsvp.not_found"));
        else setError(e instanceof ApiError ? e.message : t("common.error_generic"));
      });
  }, [code, t]);

  return (
    <FullPage>
      <div className="mb-6 flex items-center justify-between">
        <Link
          to="/"
          aria-label="Weddly, back to home"
          className="inline-block text-ink-700 transition-colors hover:text-ink-900"
        >
          <Wordmark size="sm" />
        </Link>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => setLocale(nextLocale(locale))}
          aria-label={t("nav.switch_language")}
          title={nextLocale(locale).toUpperCase()}
        >
          <Languages size={18} aria-hidden="true" />
        </button>
      </div>

      {error ? (
        <p className="text-sm text-blush-700">{error}</p>
      ) : view ? (
        <HouseholdRsvpForm view={view} onUpdated={setView} />
      ) : (
        <div className="card">
          <Skeleton variant="block" width={180} height={28} rounded="md" />
          <Skeleton variant="line" height={12} width="70%" className="mt-3" />
          <div className="mt-6 flex flex-col gap-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton variant="line" height={10} width="40%" />
                <Skeleton variant="block" height={44} rounded="lg" />
              </div>
            ))}
          </div>
          <Skeleton variant="block" height={48} rounded="lg" className="mt-8 w-full" />
        </div>
      )}
    </FullPage>
  );
}

function FullPage({ children }: { children: React.ReactNode }) {
  // pb-32 keeps the submit CTA visible above the iOS soft keyboard.
  return (
    <div className="min-h-full bg-paper-100 px-4 pb-32 pt-8 sm:pt-16">
      <div className="mx-auto max-w-md">{children}</div>
    </div>
  );
}
