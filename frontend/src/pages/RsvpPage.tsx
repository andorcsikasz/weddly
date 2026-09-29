// Legacy single-guest RSVP page — `/rsvp/<6char-invite-code>`. Old invites
// printed before the household refactor still resolve here. The server
// returns the guest's whole household, so we render the same airport-style
// HouseholdRsvpForm as the new check-in page.

import type { PublicCheckinView } from "@shared/types";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { HouseholdRsvpForm } from "../components/HouseholdRsvpForm";
import { RsvpShell, RsvpTopBar } from "../components/RsvpShell";
import { Skeleton } from "../components/ui";
import { ApiError } from "../lib/api";
import { rsvpApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function RsvpPage() {
  const { code = "" } = useParams<{ code: string }>();
  const { t } = useT();
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
    <RsvpShell>
      <RsvpTopBar />

      {error ? (
        // On the photo, not beside it. `text-blush-700` was chosen against a
        // paper-100 page; the backdrop is a dark print, so the message has to
        // arrive on its own card or it is unreadable at exactly the moment the
        // guest most needs to read it.
        <div className="card stationery shadow-pop">
          <p className="text-sm text-blush-700">{error}</p>
        </div>
      ) : view ? (
        <HouseholdRsvpForm view={view} onUpdated={setView} />
      ) : (
        // The skeleton is the same print the form becomes, so the swap when the
        // payload lands doesn't change the weight of anything on screen.
        <div className="card stationery shadow-pop">
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
    </RsvpShell>
  );
}
