// Couple-facing editor for the public wedding-website at /w/:slug. Flips the
// `is_public` publish toggle and edits the two free-form fields (venue name
// + hero image URL). Without this page, the public endpoint stays 404'd for
// every couple because `is_public` defaults to 0 — there was previously no UI
// to flip it.

import type { Couple } from "@shared/types";
import { Clipboard, ExternalLink, Globe } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { coupleApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function WeddingSiteEditorPage() {
  const { t } = useT();
  useDocumentMeta("seo.wedding_site_title", "seo.wedding_site_description");
  const toast = useToast();
  const [couple, setCouple] = useState<Couple | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [venueName, setVenueName] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    coupleApi.current().then((r) => {
      if (!r.couple) return;
      setCouple(r.couple);
      setIsPublic(r.couple.is_public);
      setVenueName(r.couple.venue_name ?? "");
      setCoverImageUrl(r.couple.cover_image_url ?? "");
    });
  }, []);

  const slug = couple?.slug ?? "";
  const publicUrl = slug ? `${window.location.origin}/w/${slug}` : null;

  // Compute which fields actually changed so we send a minimal PATCH and so
  // the Save button can stay disabled when there's nothing to commit.
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

  async function copyUrl() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success(t("wedding_site_editor.url_copied"));
    } catch {
      // Clipboard blocked (insecure context / permission denied) — fall back
      // to selecting the text so the user can Cmd/Ctrl-C it themselves.
    }
  }

  return (
    <>
      <h1>{t("wedding_site_editor.page_title")}</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-600 dark:text-umber-200">
        {t("wedding_site_editor.intro", { slug: slug || "…" })}
      </p>

      {/* Public URL — same big-mono treatment as the dashboard's check-in
       *  URL so the address reads as "this is the thing you share". Hidden
       *  until a slug exists; otherwise we'd render an empty `/w/`. */}
      <section className="card mt-6">
        <h2 className="text-lg flex items-center gap-2">
          <Globe size={18} aria-hidden /> {t("wedding_site_editor.url_label")}
        </h2>
        {publicUrl ? (
          <>
            <button
              type="button"
              onClick={copyUrl}
              className="mt-3 inline-block w-full max-w-2xl rounded-2xl border border-ink-200 bg-white px-4 py-3 text-left font-mono text-base tabular-nums text-ink-900 transition hover:border-ink-400 sm:text-lg dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50 dark:hover:border-umber-600"
              aria-label={t("wedding_site_editor.url_copied")}
            >
              {publicUrl}
            </button>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-outline btn-sm" onClick={copyUrl}>
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
          <p className="mt-3 rounded-xl border border-blush-300 bg-white px-4 py-3 text-sm text-ink-700 dark:border-blush-400/40 dark:bg-umber-800 dark:text-paper-100">
            {t("wedding_site_editor.url_no_slug")}
          </p>
        )}
      </section>

      <form onSubmit={onSubmit}>
        {/* Publish toggle — single switch with a copy block that swaps to
         *  explain the current state. Card border tint mirrors the toggle
         *  state so it's visually obvious whether the link is live. */}
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

        {/* Venue name + cover image — simple text + URL fields. */}
        <section className="card mt-6">
          <div>
            <label htmlFor="wedding-site-venue" className="field-label">
              {t("wedding_site_editor.venue_label")}
            </label>
            <input
              id="wedding-site-venue"
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
            <label htmlFor="wedding-site-cover" className="field-label">
              {t("wedding_site_editor.cover_image_label")}
            </label>
            <input
              id="wedding-site-cover"
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
    </>
  );
}
