// In-app vendor onboarding wizard — the planner-style flow a vendor runs right
// after self-serve signup. It edits the listing that register.ts already created
// (via the existing vendor listing endpoints) then marks the account onboarded.
//
//   Step 0  Welcome
//   Step 1  Company profile  — city (required), phone, website
//   Step 2  Listing basics   — short blurb, price band, hero photo (skippable)
//   Step 3  Done             — completeOnboarding, land on /vendor
//
// Standalone layout (own header + Wordmark), not the VendorShell — a focused
// flow, mirroring PlannerOnboardingPage.

import { Fragment, type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import type { VendorListingView } from "@shared/listings";
import { Wordmark } from "../../components/Wordmark";
import { useAuth } from "../../lib/auth";
import { vendorListingApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";

const TOTAL_STEPS = 4;
const PRICE_BANDS = [1, 2, 3, 4, 5] as const;

export default function VendorOnboardingPage() {
  const { t, locale } = useT();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const [businessName, setBusinessName] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [blurb, setBlurb] = useState("");
  const [priceBand, setPriceBand] = useState<number | null>(null);
  const [heroUrl, setHeroUrl] = useState<string | null>(null);

  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [listingSaving, setListingSaving] = useState(false);
  const [listingError, setListingError] = useState<string | null>(null);
  const [heroUploading, setHeroUploading] = useState(false);

  // Prefill from the listing register.ts created. If the vendor already
  // finished onboarding, bounce them to the dashboard.
  useEffect(() => {
    vendorListingApi
      .me()
      .then((view) => {
        if (view.account.onboarding_done) {
          navigate("/vendor", { replace: true });
          return;
        }
        applyView(view);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyView(view: VendorListingView) {
    setBusinessName(view.account.display_name);
    setCity(view.listing.city ?? "");
    setPhone(view.listing.contact_phone ?? "");
    setWebsite(view.listing.website ?? "");
    setBlurb((locale === "hu" ? view.listing.blurb_hu : view.listing.blurb_en) ?? "");
    setPriceBand(view.listing.price_band ?? null);
    setHeroUrl(view.listing.hero_image_url ?? null);
  }

  const firstName = (user?.full_name ?? "").split(" ")[0] ?? "";

  async function handleProfileNext() {
    if (!city.trim()) {
      setProfileError(t("vendor_onboarding.city_required"));
      return;
    }
    setProfileError(null);
    setProfileSaving(true);
    try {
      await vendorListingApi.patch({
        city: city.trim(),
        contact_phone: phone.trim() || null,
        website: website.trim() || null,
      });
      setStep(2);
    } catch {
      setProfileError(t("vendor_onboarding.save_error"));
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleListingNext() {
    setListingError(null);
    setListingSaving(true);
    try {
      const trimmed = blurb.trim();
      await vendorListingApi.patch({
        blurb_hu: locale === "hu" ? trimmed || null : undefined,
        blurb_en: locale === "hu" ? undefined : trimmed || null,
        price_band: (priceBand as 1 | 2 | 3 | 4 | 5 | null) ?? null,
      });
      setStep(3);
    } catch {
      setListingError(t("vendor_onboarding.save_error"));
    } finally {
      setListingSaving(false);
    }
  }

  async function handleHeroFile(e: FormEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setListingError(null);
    setHeroUploading(true);
    try {
      const view = await vendorListingApi.uploadHero(file);
      setHeroUrl(view.listing.hero_image_url ?? null);
    } catch {
      setListingError(t("vendor_onboarding.hero_error"));
    } finally {
      setHeroUploading(false);
    }
  }

  async function handleFinish() {
    try {
      await vendorListingApi.completeOnboarding();
    } catch {
      // Non-fatal — navigate anyway; the dashboard re-checks the flag.
    }
    navigate("/vendor", { replace: true });
  }

  return (
    <div className="min-h-screen bg-paper-50 dark:bg-umber-950">
      <header className="sticky top-0 z-30 border-b border-paper-300 bg-paper-50/85 backdrop-blur dark:border-umber-700 dark:bg-umber-900/85">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3 sm:px-6">
          <Link
            to="/vendor"
            className="inline-flex h-11 items-center text-ink-900 transition-colors hover:text-ink-700 dark:text-paper-50 dark:hover:text-blush-300"
          >
            <Wordmark size="sm" />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-10 sm:px-6">
        {step > 0 && step < TOTAL_STEPS - 1 && (
          <div className="mb-8 flex items-start">
            {([1, 2] as const).map((s, i) => {
              const active = step === s;
              const done = step > s;
              const labels = [
                t("vendor_onboarding.step_label_profile"),
                t("vendor_onboarding.step_label_listing"),
              ];
              return (
                <Fragment key={s}>
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                        done
                          ? "bg-umber-700 text-paper-50 dark:bg-umber-400 dark:text-umber-900"
                          : active
                            ? "border-2 border-umber-700 bg-paper-50 text-umber-900 dark:border-umber-400 dark:bg-umber-900 dark:text-paper-50"
                            : "border border-paper-300 bg-paper-50 text-umber-400 dark:border-umber-700 dark:bg-umber-900 dark:text-umber-600"
                      }`}
                    >
                      {done ? <Check size={12} aria-hidden="true" /> : s}
                    </div>
                    <span
                      className={`hidden text-[10px] font-medium uppercase tracking-wider sm:block ${
                        active
                          ? "text-umber-800 dark:text-paper-100"
                          : "text-umber-400 dark:text-umber-600"
                      }`}
                    >
                      {labels[i]}
                    </span>
                  </div>
                  {i < 1 && (
                    <div
                      className={`mt-3.5 h-px flex-1 ${
                        done ? "bg-umber-700 dark:bg-umber-400" : "bg-paper-300 dark:bg-umber-700"
                      }`}
                    />
                  )}
                </Fragment>
              );
            })}
          </div>
        )}

        {/* ── Step 0: Welcome ── */}
        {step === 0 && (
          <div className="card animate-fade-in-up text-center">
            <h1 className="font-grotesk text-4xl font-semibold leading-[1] tracking-tight text-umber-900 dark:text-paper-50 sm:text-5xl">
              {t("vendor_onboarding.welcome_title").replace("{{name}}", firstName)}
            </h1>
            <p className="mt-5 max-w-sm mx-auto font-grotesk text-base leading-snug text-umber-700 dark:text-umber-200">
              {t("vendor_onboarding.welcome_body").replace(
                "{{business}}",
                businessName || t("vendor_onboarding.your_business"),
              )}
            </p>
            <button
              type="button"
              className="btn-primary btn-lg mt-8 w-full"
              onClick={() => setStep(1)}
              disabled={!loaded}
            >
              {t("vendor_onboarding.welcome_cta")}
            </button>
          </div>
        )}

        {/* ── Step 1: Company profile ── */}
        {step === 1 && (
          <div className="card animate-fade-in-up">
            <h2 className="font-grotesk text-xl font-semibold text-umber-900 dark:text-paper-50">
              {t("vendor_onboarding.profile_title")}
            </h2>
            <p className="mt-1 text-sm text-umber-600 dark:text-umber-300">
              {t("vendor_onboarding.profile_body")}
            </p>

            <div className="mt-6 flex flex-col gap-4">
              <div>
                <label htmlFor="vo_city" className="field-label">
                  {t("vendor_onboarding.city_label")} <span className="text-blush-600">*</span>
                </label>
                <input
                  id="vo_city"
                  className="input"
                  value={city}
                  onChange={(e) => {
                    setCity(e.target.value);
                    if (profileError) setProfileError(null);
                  }}
                  maxLength={80}
                  required
                />
              </div>
              <div>
                <label htmlFor="vo_phone" className="field-label">
                  {t("vendor_onboarding.phone_label")}
                </label>
                <input
                  id="vo_phone"
                  type="tel"
                  className="input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={40}
                />
              </div>
              <div>
                <label htmlFor="vo_website" className="field-label">
                  {t("vendor_onboarding.website_label")}
                </label>
                <input
                  id="vo_website"
                  type="url"
                  className="input"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  maxLength={240}
                  placeholder="https://"
                />
              </div>
              {profileError && (
                <p className="text-sm text-blush-700 dark:text-blush-300" role="alert">
                  {profileError}
                </p>
              )}
            </div>

            <div className="mt-8 flex items-center justify-between">
              <button type="button" className="btn-ghost" onClick={() => setStep(0)}>
                {t("common.back")}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={profileSaving}
                onClick={() => void handleProfileNext()}
              >
                {profileSaving ? t("common.saving") : t("common.next")}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Listing basics ── */}
        {step === 2 && (
          <div className="card animate-fade-in-up">
            <h2 className="font-grotesk text-xl font-semibold text-umber-900 dark:text-paper-50">
              {t("vendor_onboarding.listing_title")}
            </h2>
            <p className="mt-1 text-sm text-umber-600 dark:text-umber-300">
              {t("vendor_onboarding.listing_body")}
            </p>

            <div className="mt-6 flex flex-col gap-5">
              <div>
                <label htmlFor="vo_blurb" className="field-label">
                  {t("vendor_onboarding.blurb_label")}
                </label>
                <textarea
                  id="vo_blurb"
                  className="input min-h-[120px] resize-y"
                  value={blurb}
                  maxLength={2000}
                  onChange={(e) => setBlurb(e.target.value)}
                  placeholder={t("vendor_onboarding.blurb_placeholder")}
                />
                <p className="mt-1 text-right text-xs tabular-nums text-umber-400">
                  {blurb.length} / 2000
                </p>
              </div>

              <div>
                <span className="field-label">{t("vendor_onboarding.price_band_label")}</span>
                <div className="mt-1 flex gap-2">
                  {PRICE_BANDS.map((b) => {
                    const isActive = priceBand === b;
                    return (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setPriceBand(isActive ? null : b)}
                        aria-pressed={isActive}
                        className={`flex h-11 flex-1 items-center justify-center rounded-lg border text-sm font-semibold transition-colors ${
                          isActive
                            ? "border-umber-800 bg-umber-800 text-paper-50 dark:border-umber-400 dark:bg-umber-400 dark:text-umber-900"
                            : "border-paper-300 bg-paper-50 text-umber-500 hover:border-umber-400 dark:border-umber-700 dark:bg-umber-900 dark:text-umber-300"
                        }`}
                      >
                        {"€".repeat(b)}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-umber-400">
                  {t("vendor_onboarding.price_band_hint")}
                </p>
              </div>

              <div>
                <span className="field-label">{t("vendor_onboarding.hero_label")}</span>
                {heroUrl && (
                  <img src={heroUrl} alt="" className="mt-1 h-40 w-full rounded-xl object-cover" />
                )}
                <label
                  htmlFor="vo_hero"
                  className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-paper-400 bg-paper-50 px-3 py-3 text-sm text-umber-600 transition-colors hover:border-umber-400 dark:border-umber-600 dark:bg-umber-800 dark:text-umber-200"
                >
                  {heroUploading
                    ? t("vendor_onboarding.hero_uploading")
                    : heroUrl
                      ? t("vendor_onboarding.hero_replace")
                      : t("vendor_onboarding.hero_cta")}
                  <input
                    id="vo_hero"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    disabled={heroUploading}
                    onChange={(e) => void handleHeroFile(e)}
                  />
                </label>
              </div>

              {listingError && (
                <p className="text-sm text-blush-700 dark:text-blush-300" role="alert">
                  {listingError}
                </p>
              )}
            </div>

            <div className="mt-8 flex items-center justify-between">
              <button type="button" className="btn-ghost" onClick={() => setStep(1)}>
                {t("common.back")}
              </button>
              <div className="flex gap-2">
                <button type="button" className="btn-outline" onClick={() => setStep(3)}>
                  {t("vendor_onboarding.skip")}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={listingSaving}
                  onClick={() => void handleListingNext()}
                >
                  {listingSaving ? t("common.saving") : t("common.next")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 3: Done ── */}
        {step === 3 && (
          <div className="card animate-fade-in-up text-center">
            <div
              className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-sage-100 ring-2 ring-sage-400 dark:bg-sage-900 dark:ring-sage-600"
              aria-hidden="true"
            >
              <svg
                className="h-10 w-10 text-sage-600 dark:text-sage-300"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h2 className="mt-6 font-grotesk text-xl font-semibold text-umber-900 dark:text-paper-50">
              {t("vendor_onboarding.done_title")}
            </h2>
            <p className="mt-3 text-sm text-umber-600 dark:text-umber-300">
              {t("vendor_onboarding.done_body")}
            </p>
            <button
              type="button"
              className="btn-primary btn-lg mt-8 w-full"
              onClick={() => void handleFinish()}
            >
              {t("vendor_onboarding.done_cta")}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
