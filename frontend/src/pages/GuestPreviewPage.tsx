// Couple-side preview of the public /g/:slug/:code guest portal. Pulls the
// couple's own data via the authed endpoints (couples/current + schedule)
// and renders the same `<GuestPortalView>` the public page uses, so the
// couple can see exactly what their guests get after RSVPing yes. Adds a
// "Share with guests" panel that explains the slug + household-code
// credential and exposes a "Copy" button for the airport-style /rsvp URL.

import { Check, Copy, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { GuestPortalView } from "../components/GuestPortalView";
import { coupleApi, scheduleApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import { useToast } from "../components/ui";
import type { Couple } from "@shared/types";
import type { ScheduleEvent } from "@shared/schedule";
import type {
  GuestPortalView as GuestPortalViewType,
  GuestScheduleEntry,
} from "@shared/guest_portal";

export default function GuestPreviewPage() {
  const { t, locale } = useT();
  useDocumentMeta("seo.guest_preview_title", "seo.guest_preview_description");
  const toast = useToast();

  const [couple, setCouple] = useState<Couple | null>(null);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([coupleApi.current(), scheduleApi.list()])
      .then(([cR, sR]) => {
        if (cancelled) return;
        setCouple(cR.couple);
        setEvents(sR.events);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Synthesize a `GuestPortalView` from the couple's own data. No real
  // household is attached — the couple's preview is "what a guest would
  // see"; the household-members section just renders empty (defensive
  // `{members.length > 0 && ...}` check inside the shared component).
  const preview: GuestPortalViewType | null = couple
    ? {
        couple_slug: couple.slug ?? "",
        couple_display_name: couple.display_name,
        wedding_date: couple.wedding_date,
        ceremony_kind: couple.ceremony_kind,
        location_lat: couple.location_lat,
        location_lng: couple.location_lng,
        location_radius_km: couple.location_radius_km,
        schedule: events.map(
          (e): GuestScheduleEntry => ({
            id: e.id,
            label: e.label,
            starts_at_minutes: e.starts_at_minutes,
            duration_minutes: e.duration_minutes,
            location: e.location,
            notes: e.notes,
          }),
        ),
        household_code: "",
        household_label: "",
        members: [],
        fetched_at: Date.now(),
      }
    : null;

  return (
    <>
      <header className="mb-6">
        <h1>{t("guest_preview.title")}</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">
          {t("guest_preview.subtitle")}
        </p>
      </header>

      <SharePanel
        slug={couple?.slug ?? null}
        onCopy={(text) => {
          navigator.clipboard
            .writeText(text)
            .then(() => toast.success(t("guest_preview.share_copied")))
            .catch(() => toast.error(t("guest_preview.share_copy_failed")));
        }}
        t={t}
      />

      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-ink-500 dark:text-umber-300">{t("common.loading")}</p>
        ) : preview ? (
          <GuestPortalView data={preview} locale={locale} />
        ) : (
          <p className="text-sm text-ink-500 dark:text-umber-300">{t("guest_preview.empty")}</p>
        )}
      </div>
    </>
  );
}

function SharePanel({
  slug,
  onCopy,
  t,
}: {
  slug: string | null;
  onCopy: (text: string) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedSlug, setCopiedSlug] = useState(false);
  const rsvpUrl = typeof window !== "undefined" && slug ? `${window.location.origin}/rsvp` : "";

  return (
    <section className="card-hover">
      <div className="flex items-start gap-2">
        <Info size={16} className="mt-0.5 shrink-0 text-ink-500 dark:text-umber-300" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink-900 dark:text-paper-50">
            {t("guest_preview.share_title")}
          </h2>
          <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
            {t("guest_preview.share_body")}
          </p>

          {slug ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-ink-400 dark:text-umber-300">
                  {t("guest_preview.share_slug_label")}
                </div>
                <button
                  type="button"
                  className="mt-1 inline-flex items-center gap-2 rounded-md border border-paper-300 px-2.5 py-1 font-mono text-sm uppercase tracking-[0.2em] text-ink-800 hover:border-paper-400 dark:border-umber-700 dark:text-paper-100 dark:hover:border-umber-600"
                  onClick={() => {
                    onCopy(slug);
                    setCopiedSlug(true);
                    setTimeout(() => setCopiedSlug(false), 1500);
                  }}
                  aria-label={t("guest_preview.share_copy_slug_aria")}
                >
                  {slug}
                  {copiedSlug ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                </button>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-ink-400 dark:text-umber-300">
                  {t("guest_preview.share_link_label")}
                </div>
                <button
                  type="button"
                  className="mt-1 inline-flex items-center gap-2 rounded-md border border-paper-300 px-2.5 py-1 text-sm text-ink-800 hover:border-paper-400 dark:border-umber-700 dark:text-paper-100 dark:hover:border-umber-600"
                  onClick={() => {
                    onCopy(rsvpUrl);
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 1500);
                  }}
                  aria-label={t("guest_preview.share_copy_link_aria")}
                >
                  <span className="truncate">{rsvpUrl}</span>
                  {copiedLink ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-ink-500 dark:text-umber-300">
              {t("guest_preview.share_no_slug")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
