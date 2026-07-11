// Full-page profile for a registered planner ACCOUNT (users.user_type='planner'),
// reached from the planner card on /app/vendors. Planner accounts are a parallel
// aggregate to the vendor listings, so they don't get /app/suppliers/:id — this
// gives them the same editorial, two-column detail page vendors have (hero, big
// name, about, styles, availability, references), fed by the couple-scoped
// planner-directory detail endpoint, with the same "Felkérés" consent CTA the
// card uses. Distinct from the vendor CTA: Felkérés is a bidirectional
// account-link handshake (invite → planner accepts → linked), not a booking lead.

import { countryName } from "@shared/country_list";
import type { PlannerDirectoryDetail, PlannerDirectoryEntry } from "@shared/types";
import {
  BadgeCheck,
  Check,
  ChevronLeft,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  MapPin,
  Phone,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AvailabilityCalendar } from "../components/AvailabilityCalendar";
import { hrefFor, plannerInitials, plannerStyleLabel } from "../components/PlannerDirectoryRail";
import { useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { couplePlannerApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

type LinkStatus = PlannerDirectoryEntry["link_status"];

/** Format an ISO 'YYYY-MM-DD' in the reader's locale ("2027. jún. 12."). */
function formatIsoDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export default function PlannerDetailPage() {
  const { plannerUserId } = useParams<{ plannerUserId: string }>();
  const id = Number(plannerUserId);
  const { t, locale } = useT();
  const toast = useToast();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<PlannerDirectoryDetail | null>(null);
  const [status, setStatus] = useState<LinkStatus>("none");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!Number.isInteger(id) || id < 1) {
      setFailed(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    couplePlannerApi
      .plannerDetail(id)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setStatus(d.link_status);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function act(fn: () => Promise<unknown>, next: LinkStatus) {
    setBusy(true);
    try {
      await fn();
      setStatus(next);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    if (window.history.length > 1) navigate(-1);
    else navigate("/app/vendors");
  }

  const back = (
    <button
      type="button"
      onClick={goBack}
      className="mb-4 inline-flex items-center gap-1 rounded-md text-sm text-ink-500 transition hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 dark:text-umber-300 dark:hover:text-umber-100"
    >
      <ChevronLeft size={14} aria-hidden />
      {t("planner_directory.back")}
    </button>
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 xl:px-10">
        {back}
        <div className="flex items-center justify-center py-20 text-ink-400 dark:text-umber-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      </div>
    );
  }

  if (failed || !detail) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 xl:px-10">
        {back}
        <p className="py-16 text-center text-sm italic text-ink-500 dark:text-umber-300">
          {t("planner_directory.not_found")}
        </p>
      </div>
    );
  }

  const meta = [detail.city, detail.country ? countryName(detail.country, locale) : null]
    .filter(Boolean)
    .join(" · ");
  const heroImage = detail.portfolio.find((p) => p.image_url)?.image_url ?? null;

  /** The "Felkérés" consent CTA — same states as the card. `block` stretches it
   *  to full width for the sidebar; the header keeps it inline. */
  function cta(block: boolean) {
    const w = block ? "w-full" : "";
    if (status === "none") {
      return (
        <button
          type="button"
          className={`btn-primary ${w}`}
          disabled={busy}
          onClick={() => void act(() => couplePlannerApi.invitePlannerById(id), "invited")}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : t("planner_directory.connect")}
        </button>
      );
    }
    if (status === "invited") {
      return (
        <span
          className={`inline-flex items-center justify-center gap-1.5 text-sm font-medium text-ink-500 dark:text-umber-300 ${w}`}
        >
          <Clock size={14} /> {t("planner_directory.invited")}
        </span>
      );
    }
    if (status === "requested") {
      return (
        <button
          type="button"
          className={`btn-primary ${w}`}
          disabled={busy}
          onClick={() => void act(() => couplePlannerApi.acceptPlanner(id), "active")}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : t("planner_directory.approve")}
        </button>
      );
    }
    return (
      <span
        className={`inline-flex items-center justify-center gap-1.5 text-sm font-medium text-sage-700 dark:text-sage-400 ${w}`}
      >
        <Check size={14} /> {t("planner_directory.linked")}
      </span>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-6 xl:px-10">
      {back}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* ─── MAIN COLUMN ──────────────────────────────────────────────── */}
        <main className="min-w-0">
          {/* Hero — first portfolio photo when present, else a monogram tile so
              the page never opens with bare text on white (mirrors the vendor
              page's always-render-something hero). */}
          <section className="mb-10">
            {heroImage ? (
              <img
                src={heroImage}
                alt=""
                className="aspect-[16/9] w-full rounded-2xl object-cover"
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex aspect-[16/9] w-full items-center justify-center rounded-2xl bg-paper-100 dark:bg-umber-800"
              >
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-ink-900 text-2xl font-semibold text-paper-50 dark:bg-paper-50 dark:text-ink-900">
                  {plannerInitials(detail.business_name || detail.full_name)}
                </div>
              </div>
            )}

            <div className="mt-5 text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
              {t("suppliers.cat.wedding_planner")}
              {meta ? ` · ${meta}` : ""}
            </div>
            <h1 className="mt-1 inline-flex flex-wrap items-center gap-x-2 text-3xl font-bold leading-tight tracking-tight text-ink-900 dark:text-cream-50 sm:text-4xl">
              <span>{detail.business_name || detail.full_name}</span>
              {detail.verified && (
                <BadgeCheck
                  size={28}
                  aria-label={t("planner_directory.verified")}
                  className="shrink-0 fill-verified stroke-white"
                />
              )}
            </h1>

            {/* Capacity + website chips */}
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-600 dark:text-umber-200">
              {detail.website && (
                <a
                  href={hrefFor(detail.website)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 font-medium text-ink-700 hover:underline dark:text-paper-200"
                >
                  <ExternalLink size={13} /> {t("planner_directory.website")}
                </a>
              )}
              {detail.weddings_per_year != null && detail.weddings_per_year > 0 && (
                <span>
                  {t("planner_directory.weddings_per_year", { n: detail.weddings_per_year })}
                </span>
              )}
              {detail.km_radius != null && detail.km_radius > 0 && (
                <span>{t("planner_directory.km_radius", { n: detail.km_radius })}</span>
              )}
            </div>

            {/* Primary action (desktop; also lives in the sticky rail). */}
            <div className="mt-5">{cta(false)}</div>
          </section>

          {/* About / bio */}
          {detail.bio && (
            <section className="mb-10">
              <h2 className="mb-3 text-xl font-semibold tracking-tight text-ink-900 dark:text-cream-50">
                {t("planner_directory.about_label")}
              </h2>
              <p className="whitespace-pre-line leading-relaxed text-ink-700 dark:text-paper-100">
                {detail.bio}
              </p>
            </section>
          )}

          {/* Styles */}
          {detail.styles?.length ? (
            <section className="mb-10">
              <h2 className="mb-3 text-xl font-semibold tracking-tight text-ink-900 dark:text-cream-50">
                {t("planner_directory.styles_label")}
              </h2>
              <div className="flex flex-wrap gap-2">
                {detail.styles.map((s) => (
                  <span
                    key={s}
                    className="rounded-full bg-paper-200 px-3 py-1 text-sm font-medium text-ink-600 dark:bg-umber-800 dark:text-umber-200"
                  >
                    {plannerStyleLabel(t, s)}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {/* Pricing packages (árajánlat) — the planner's published price offers,
              same card grid as the vendor detail page. Renders only when the
              planner added at least one. */}
          {detail.packages.length > 0 && (
            <section className="mb-10">
              <h2 className="mb-3 text-xl font-semibold tracking-tight text-ink-900 dark:text-cream-50">
                {t("planner_directory.pricing_label")}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {detail.packages.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-col rounded-xl border border-paper-300 bg-paper-50 p-4 dark:border-umber-700 dark:bg-umber-800"
                  >
                    <h3 className="text-base font-semibold text-ink-900 dark:text-cream-50">
                      {p.name}
                    </h3>
                    {p.price_text && (
                      <p className="mt-1 text-sm font-semibold text-steel-700 dark:text-steel-300">
                        {p.price_text}
                      </p>
                    )}
                    {p.description && (
                      <p className="mt-2 whitespace-pre-line text-sm text-ink-600 dark:text-umber-200">
                        {p.description}
                      </p>
                    )}
                    {p.pdf_url && (
                      <a
                        href={p.pdf_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-3 inline-flex items-center gap-1.5 self-start text-sm text-steel-700 hover:underline dark:text-steel-300"
                      >
                        <FileText size={15} aria-hidden />
                        {p.pdf_name ?? t("planner_directory.package_download")}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Availability — a read-only busy calendar (opens on the couple's
              wedding month) when the planner keeps one, plus their free-text
              note. Hidden entirely when neither is set. */}
          {(detail.unavailable_dates.length > 0 || detail.availability) && (
            <section className="mb-10">
              <h2 className="mb-3 text-xl font-semibold tracking-tight text-ink-900 dark:text-cream-50">
                {t("planner_directory.availability_label")}
              </h2>
              {detail.unavailable_dates.length > 0 && (
                <div className="max-w-sm rounded-xl border border-paper-300 bg-paper-50 p-4 dark:border-umber-700 dark:bg-umber-800">
                  <AvailabilityCalendar
                    blockedDates={detail.unavailable_dates}
                    initialMonth={detail.wedding_date}
                  />
                  {detail.next_available && (
                    <p className="mt-3 text-xs text-ink-500 dark:text-umber-300">
                      {t("planner_directory.busy_next_free", {
                        date: formatIsoDate(detail.next_available, locale),
                      })}
                    </p>
                  )}
                </div>
              )}
              {detail.availability && (
                <p className="mt-3 leading-relaxed text-ink-700 dark:text-paper-100">
                  {detail.availability}
                </p>
              )}
            </section>
          )}

          {/* References — portfolio grid + external links */}
          {detail.portfolio.length > 0 || detail.reference_links?.length ? (
            <section className="mb-10">
              <h2 className="mb-3 text-xl font-semibold tracking-tight text-ink-900 dark:text-cream-50">
                {t("planner_directory.references_label")}
              </h2>
              {detail.portfolio.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {detail.portfolio.map((p) => (
                    <figure
                      key={p.id}
                      className="overflow-hidden rounded-xl bg-paper-100 dark:bg-umber-800"
                    >
                      {p.image_url && (
                        <img
                          src={p.image_url}
                          alt={p.title}
                          loading="lazy"
                          className="aspect-square w-full object-cover"
                        />
                      )}
                      {p.title && (
                        <figcaption className="truncate px-2 py-1.5 text-xs text-ink-500 dark:text-umber-300">
                          {p.title}
                        </figcaption>
                      )}
                    </figure>
                  ))}
                </div>
              )}
              {detail.reference_links?.length ? (
                <ul className="mt-3 space-y-1.5">
                  {detail.reference_links.map((link) => (
                    <li key={link}>
                      <a
                        href={hrefFor(link)}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1.5 break-all text-sm text-ink-700 hover:underline dark:text-paper-200"
                      >
                        <ExternalLink size={13} className="shrink-0" /> {link}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </main>

        {/* ─── SIDEBAR ──────────────────────────────────────────────────── */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <div className="card !p-5">
            <div className="flex items-start gap-3">
              {detail.avatar_url ? (
                <img
                  src={detail.avatar_url}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink-900 text-sm font-semibold text-paper-50 dark:bg-paper-50 dark:text-ink-900"
                >
                  {plannerInitials(detail.business_name || detail.full_name)}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink-900 dark:text-paper-50">
                  {detail.business_name || detail.full_name}
                </p>
                {meta && (
                  <p className="truncate text-xs text-ink-500 dark:text-umber-300">{meta}</p>
                )}
              </div>
            </div>

            {detail.website && (
              <a
                href={hrefFor(detail.website)}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-700 hover:underline dark:text-paper-200"
              >
                <ExternalLink size={13} /> {t("planner_directory.website")}
              </a>
            )}

            {/* Contact — surfaced only on the auth-gated detail page (the couple
                is already looking at a single planner they can reach out to). */}
            {(detail.phone || detail.email || detail.address) && (
              <dl className="mt-4 space-y-2.5 border-t border-paper-200 pt-4 text-sm dark:border-umber-700">
                {detail.phone && (
                  <div className="flex items-start gap-2.5">
                    <Phone size={14} className="mt-0.5 shrink-0 text-ink-400 dark:text-umber-400" />
                    <a
                      href={`tel:${detail.phone.replace(/\s+/g, "")}`}
                      className="break-all text-ink-700 hover:underline dark:text-paper-200"
                    >
                      {detail.phone}
                    </a>
                  </div>
                )}
                {detail.email && (
                  <div className="flex items-start gap-2.5">
                    <Mail size={14} className="mt-0.5 shrink-0 text-ink-400 dark:text-umber-400" />
                    <a
                      href={`mailto:${detail.email}`}
                      className="break-all text-ink-700 hover:underline dark:text-paper-200"
                    >
                      {detail.email}
                    </a>
                  </div>
                )}
                {detail.address && (
                  <div className="flex items-start gap-2.5">
                    <MapPin
                      size={14}
                      className="mt-0.5 shrink-0 text-ink-400 dark:text-umber-400"
                    />
                    <span className="text-ink-700 dark:text-paper-200">{detail.address}</span>
                  </div>
                )}
              </dl>
            )}

            <div className="mt-4">{cta(true)}</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
