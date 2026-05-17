// Public guest portal — what a yes-RSVP'd guest sees at /g/:slug/:code.
// Mirrors the airport-style RSVP credential (couple slug + 4-digit
// household code). Renders the same `<GuestPortalView>` the couple's
// /app/guest-portal preview uses. On 403 with `code: "not_rsvpd"` we
// route the user back to /rsvp instead of showing a generic error —
// the page framing is "for guests who confirmed".

import { ArrowLeft } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { GuestPortalView } from "../components/GuestPortalView";
import { Wordmark } from "../components/Wordmark";
import { ApiError } from "../lib/api";
import { guestPortalApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import type { GuestPortalView as GuestPortalViewType } from "@shared/guest_portal";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: GuestPortalViewType }
  | { kind: "not_rsvpd" }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

export default function GuestPortalPage() {
  const { t, locale, setLocale } = useT();
  useDocumentMeta("seo.guest_portal_title", "seo.guest_portal_description");
  const { slug = "", code = "" } = useParams<{ slug: string; code: string }>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    guestPortalApi
      .get(slug, code)
      .then((r) => {
        if (!cancelled) setState({ kind: "ready", data: r.portal });
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError) {
          // Server distinguishes "not yet RSVP'd" from "wrong credential"
          // via `detail.code`. The former is a gentle redirect; the latter
          // is a hard 404.
          const detailCode =
            e.detail && typeof e.detail === "object"
              ? (e.detail as { code?: unknown }).code
              : undefined;
          if (e.status === 403 && detailCode === "not_rsvpd") {
            setState({ kind: "not_rsvpd" });
            return;
          }
          if (e.status === 404) {
            setState({ kind: "not_found" });
            return;
          }
        }
        setState({ kind: "error", message: t("guest_portal.load_error") });
      });
    return () => {
      cancelled = true;
    };
  }, [slug, code, t]);

  return (
    <Frame
      onSwitchLocale={() => setLocale(locale === "hu" ? "en" : "hu")}
      localeButtonLabel={locale === "hu" ? "EN" : "HU"}
    >
      {state.kind === "loading" && (
        <p className="text-center text-sm text-ink-500 dark:text-umber-300">
          {t("common.loading")}
        </p>
      )}
      {state.kind === "ready" && <GuestPortalView data={state.data} locale={locale} />}
      {state.kind === "not_rsvpd" && (
        <div className="rounded-2xl border border-paper-200 bg-paper-50 p-6 text-center dark:border-umber-700 dark:bg-umber-800/60">
          <h1 className="font-serif text-2xl text-ink-900 dark:text-paper-50">
            {t("guest_portal.gate_title")}
          </h1>
          <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">
            {t("guest_portal.gate_body")}
          </p>
          <Link
            to={`/rsvp?couple=${encodeURIComponent(slug)}&code=${encodeURIComponent(code)}`}
            className="btn-primary mt-4 inline-flex"
          >
            {t("guest_portal.gate_cta")}
          </Link>
        </div>
      )}
      {state.kind === "not_found" && (
        <div className="rounded-2xl border border-paper-200 bg-paper-50 p-6 text-center dark:border-umber-700 dark:bg-umber-800/60">
          <h1 className="font-serif text-2xl text-ink-900 dark:text-paper-50">
            {t("guest_portal.not_found_title")}
          </h1>
          <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">
            {t("guest_portal.not_found_body")}
          </p>
          <Link to="/rsvp" className="btn-outline mt-4 inline-flex items-center gap-1">
            <ArrowLeft size={14} aria-hidden /> {t("guest_portal.not_found_cta")}
          </Link>
        </div>
      )}
      {state.kind === "error" && (
        <p
          role="alert"
          className="rounded-md border border-blush-300 bg-blush-50 px-4 py-3 text-sm text-blush-800 dark:border-blush-400/40 dark:bg-blush-400/10 dark:text-blush-200"
        >
          {state.message}
        </p>
      )}
    </Frame>
  );
}

function Frame({
  children,
  onSwitchLocale,
  localeButtonLabel,
}: {
  children: ReactNode;
  onSwitchLocale: () => void;
  localeButtonLabel: string;
}) {
  return (
    <div className="min-h-full bg-paper-100 px-4 pb-32 pt-8 dark:bg-umber-900 sm:pt-12">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <Link
            to="/"
            aria-label="Weddly — home"
            className="inline-block text-ink-700 transition-colors hover:text-ink-900 dark:text-paper-100"
          >
            <Wordmark size="sm" />
          </Link>
          <button type="button" className="btn-ghost btn-sm" onClick={onSwitchLocale}>
            {localeButtonLabel}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
