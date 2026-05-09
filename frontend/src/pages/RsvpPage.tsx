// Legacy single-guest RSVP page — `/rsvp/<6char-invite-code>`. Old invites
// printed before the household refactor still resolve here. The server
// returns the guest's whole household, so we render the same airport-style
// HouseholdRsvpForm as the new check-in page.

import type { PublicCheckinView } from "@shared/types";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { HouseholdRsvpForm } from "../components/HouseholdRsvpForm";
import { ApiError } from "../lib/api";
import { rsvpApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

export default function RsvpPage() {
  const { code = "" } = useParams<{ code: string }>();
  const { t, locale, setLocale } = useT();
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
      <div className="mb-6 flex items-center justify-end">
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => setLocale(locale === "hu" ? "en" : "hu")}
        >
          {locale === "hu" ? "EN" : "HU"}
        </button>
      </div>

      {error ? (
        <p className="text-sm text-blush-700">{error}</p>
      ) : view ? (
        <HouseholdRsvpForm view={view} onUpdated={setView} />
      ) : (
        <p className="text-sm text-ink-500">{t("common.loading")}</p>
      )}
    </FullPage>
  );
}

function FullPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-paper-100 px-4 py-8 sm:py-16">
      <div className="mx-auto max-w-md">{children}</div>
    </div>
  );
}
