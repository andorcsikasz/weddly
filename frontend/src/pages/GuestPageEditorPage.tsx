// Single couple-facing editor for the public guest-facing page. Replaces the
// older split between /app/wedding-site (publish + venue + cover) and
// /app/guest-portal (read-only preview of the gated /g/:slug/:code view).
// The merger reflects how couples actually think about the artifact: one
// thing they share with guests, with a public top section (anyone with the
// link) and a deeper post-RSVP-yes block that unlocks for confirmed guests.

import type { Couple } from "@shared/types";
import type {
  GuestPortalView as GuestPortalViewType,
  GuestScheduleEntry,
} from "@shared/guest_portal";
import type { ScheduleEvent } from "@shared/schedule";
import { Check, Clipboard, Copy, ExternalLink, Globe, Info, Lock, Unlock } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { GuestPortalView } from "../components/GuestPortalView";
import { useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { coupleApi, scheduleApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function GuestPageEditorPage() {
  const { t, locale } = useT();
  useDocumentMeta("seo.guest_page_title", "seo.guest_page_description");
  const toast = useToast();

  const [couple, setCouple] = useState<Couple | null>(null);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [isPublic, setIsPublic] = useState(false);
  const [venueName, setVenueName] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([coupleApi.current(), scheduleApi.list()])
      .then(([cR, sR]) => {
        if (cancelled) return;
        if (cR.couple) {
          setCouple(cR.couple);
          setIsPublic(cR.couple.is_public);
          setVenueName(cR.couple.venue_name ?? "");
          setCoverImageUrl(cR.couple.cover_image_url ?? "");
        }
        setEvents(sR.events);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const slug = couple?.slug ?? "";
  const publicUrl = slug ? `${window.location.origin}/w/${slug}` : null;
  const rsvpUrl = typeof window !== "undefined" && slug ? `${window.location.origin}/rsvp` : "";

  const venueTrimmed = venueName.trim();
  const coverTrimmed = coverImageUrl.trim();
  const venueChanged = venueTrimmed !== (couple?.venue_name ?? "");
  const coverChanged = coverTrimmed !== (couple?.cover_image_url ?? "");
  const publishChanged = isPublic !== Boolean(couple?.is_public);
  const dirty = venueChanged || coverChanged || publishChanged;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!couple || !dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const body: Parameters<typeof coupleApi.update>[0] = {};
      if (publishChanged) body.is_public = isPublic;
      if (venueChanged) body.venue_name = venueTrimmed === "" ? null : venueTrimmed;
      if (coverChanged) body.cover_image_url = coverTrimmed === "" ? null : coverTrimmed;
      const r = await coupleApi.update(body);
      setCouple(r.couple);
      setIsPublic(r.couple.is_public);
      setVenueName(r.couple.venue_name ?? "");
      setCoverImageUrl(r.couple.cover_image_url ?? "");
      toast.success(t("wedding_site_editor.save_success"));
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : t("wedding_site_editor.save_error_generic");
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  async function copyText(text: string, successKey: "share_copied" | "url_copied") {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(
        successKey === "share_copied"
          ? t("guest_preview.share_copied")
          : t("wedding_site_editor.url_copied"),
      );
    } catch {
      toast.error(t("guest_preview.share_copy_failed"));
    }
  }

  // Synthesised preview — same shape as the public /g/:slug/:code endpoint
  // returns, with empty household so the shared component's defensive
  // `members.length > 0` check renders the no-household branch.
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
          (ev): GuestScheduleEntry => ({
            id: ev.id,
            label: ev.label,
            starts_at_minutes: ev.starts_at_minutes,
            duration_minutes: ev.duration_minutes,
            location: ev.location,
            notes: ev.notes,
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
        <h1>{t("guest_page_editor.title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-600 dark:text-umber-200">
          {t("guest_page_editor.subtitle")}
        </p>
      </header>

      {/* ── Share ────────────────────────────────────────────────────────
       *  Two pieces side-by-side: the public /w/:slug URL (one share artefact
       *  for save-the-dates / Instagram bio) and the slug + /rsvp pair the
       *  couple uses to brief individual guests on how to RSVP. */}
      <section className="card">
        <h2 className="text-lg flex items-center gap-2">
          <Globe size={18} aria-hidden /> {t("guest_page_editor.section_share_title")}
        </h2>
        <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">
          {t("guest_page_editor.section_share_body")}
        </p>

        {publicUrl ? (
          <>
            <button
              type="button"
              onClick={() => copyText(publicUrl, "url_copied")}
              className="mt-4 inline-block w-full max-w-2xl rounded-2xl border border-ink-200 bg-white px-4 py-3 text-left font-mono text-base tabular-nums text-ink-900 transition hover:border-ink-400 sm:text-lg dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50 dark:hover:border-umber-600"
              aria-label={t("wedding_site_editor.url_copied")}
            >
              {publicUrl}
            </button>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-outline btn-sm"
                onClick={() => copyText(publicUrl, "url_copied")}
              >
                <Clipboard size={14} aria-hidden />
                {t("wedding_site_editor.url_copied")}
              </button>
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-outline btn-sm inline-flex"
              >
                <ExternalLink size={14} aria-hidden />
                {t("wedding_site_editor.url_open")}
              </a>
            </div>
          </>
        ) : (
          <p className="mt-4 rounded-xl border border-blush-300 bg-white px-4 py-3 text-sm text-ink-700 dark:border-blush-400/40 dark:bg-umber-800 dark:text-paper-100">
            {t("wedding_site_editor.url_no_slug")}
          </p>
        )}

        {slug && (
          <div className="mt-5 grid gap-3 border-t border-paper-300 pt-4 sm:grid-cols-2 dark:border-umber-700">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-400 dark:text-umber-300">
                {t("guest_preview.share_slug_label")}
              </div>
              <button
                type="button"
                className="mt-1 inline-flex items-center gap-2 rounded-md border border-paper-300 px-2.5 py-1 font-mono text-sm uppercase tracking-[0.2em] text-ink-800 hover:border-paper-400 dark:border-umber-700 dark:text-paper-100 dark:hover:border-umber-600"
                onClick={() => copyText(slug, "share_copied")}
                aria-label={t("guest_preview.share_copy_slug_aria")}
              >
                {slug}
                <Copy size={14} aria-hidden />
              </button>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-400 dark:text-umber-300">
                {t("guest_preview.share_link_label")}
              </div>
              <button
                type="button"
                className="mt-1 inline-flex items-center gap-2 rounded-md border border-paper-300 px-2.5 py-1 text-sm text-ink-800 hover:border-paper-400 dark:border-umber-700 dark:text-paper-100 dark:hover:border-umber-600"
                onClick={() => copyText(rsvpUrl, "share_copied")}
                aria-label={t("guest_preview.share_copy_link_aria")}
              >
                <span className="truncate">{rsvpUrl}</span>
                <Copy size={14} aria-hidden />
              </button>
            </div>
          </div>
        )}
      </section>

      <form onSubmit={onSubmit}>
        {/* ── Publish toggle ──────────────────────────────────────────── */}
        <section
          className={`card mt-6 border-2 ${
            isPublic
              ? "border-sage-400 dark:border-sage-500"
              : "border-paper-300 dark:border-umber-700"
          }`}
        >
          <h2 className="text-lg">{t("wedding_site_editor.publish_title")}</h2>
          <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">
            {isPublic
              ? t("wedding_site_editor.publish_body_on")
              : t("wedding_site_editor.publish_body_off")}
          </p>
          <label className="mt-4 inline-flex cursor-pointer items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={isPublic}
              onClick={() => setIsPublic((v) => !v)}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                isPublic ? "bg-sage-500 dark:bg-sage-400" : "bg-paper-300 dark:bg-umber-700"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  isPublic ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
            <span className="text-sm font-medium text-ink-800 dark:text-paper-100">
              {isPublic
                ? t("wedding_site_editor.publish_label_on")
                : t("wedding_site_editor.publish_label_off")}
            </span>
          </label>
        </section>

        {/* ── Public content (anyone with the link) ──────────────────── */}
        <section className="card mt-6">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-500 dark:text-umber-300">
            <Unlock size={12} aria-hidden /> {t("guest_page_editor.section_public_eyebrow")}
          </div>
          <h2 className="mt-1 text-lg">{t("guest_page_editor.section_public_title")}</h2>
          <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">
            {t("guest_page_editor.section_public_hint")}
          </p>
          <div className="mt-5">
            <label htmlFor="guest-page-venue" className="field-label">
              {t("wedding_site_editor.venue_label")}
            </label>
            <input
              id="guest-page-venue"
              type="text"
              className="input"
              value={venueName}
              onChange={(e) => setVenueName(e.target.value)}
              placeholder={t("wedding_site_editor.venue_placeholder")}
              maxLength={200}
            />
            <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">
              {t("wedding_site_editor.venue_hint")}
            </p>
          </div>
          <div className="mt-5">
            <label htmlFor="guest-page-cover" className="field-label">
              {t("wedding_site_editor.cover_image_label")}
            </label>
            <input
              id="guest-page-cover"
              type="url"
              className="input"
              value={coverImageUrl}
              onChange={(e) => setCoverImageUrl(e.target.value)}
              placeholder={t("wedding_site_editor.cover_image_placeholder")}
              maxLength={2048}
              inputMode="url"
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-ink-500 dark:text-umber-300">
              {t("wedding_site_editor.cover_image_hint")}
            </p>
          </div>
        </section>

        {/* ── Post-RSVP unlocked content ────────────────────────────── */}
        <section className="card mt-6">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-blush-700 dark:text-blush-300">
            <Lock size={12} aria-hidden /> {t("guest_page_editor.section_unlocked_eyebrow")}
          </div>
          <h2 className="mt-1 text-lg">{t("guest_page_editor.section_unlocked_title")}</h2>
          <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">
            {t("guest_page_editor.section_unlocked_hint")}
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            <li>
              <Link to="/app/schedule" className="btn-outline btn-sm">
                {t("guest_page_editor.section_unlocked_link_schedule")}
              </Link>
            </li>
            <li>
              <Link to="/app/settings/workspace" className="btn-outline btn-sm">
                {t("guest_page_editor.section_unlocked_link_profile")}
              </Link>
            </li>
          </ul>
        </section>

        {error && (
          <p className="field-error mt-4" role="alert">
            {error}
          </p>
        )}

        <div className="mt-6">
          <button type="submit" className="btn-primary" disabled={!dirty || saving}>
            {saving ? t("wedding_site_editor.save_saving") : t("wedding_site_editor.save_button")}
          </button>
        </div>
      </form>

      {/* ── Live preview ────────────────────────────────────────────── */}
      <section className="mt-10">
        <div className="mb-3 flex items-start gap-2">
          <Info size={16} className="mt-0.5 text-ink-500 dark:text-umber-300" aria-hidden />
          <div>
            <h2 className="text-lg">{t("guest_page_editor.preview_title")}</h2>
            <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">
              {t("guest_page_editor.preview_subtitle")}
            </p>
          </div>
        </div>
        {loading ? (
          <p className="text-sm text-ink-500 dark:text-umber-300">{t("common.loading")}</p>
        ) : preview ? (
          <GuestPortalView data={preview} locale={locale} />
        ) : (
          <p className="text-sm text-ink-500 dark:text-umber-300">{t("guest_preview.empty")}</p>
        )}
      </section>
    </>
  );
}
