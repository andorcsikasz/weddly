// In-app vendor onboarding wizard — the planner-style flow a vendor runs right
// after self-serve signup. It edits the listing that register.ts already created
// (via the existing vendor listing endpoints) then marks the account onboarded.
//
//   Step 0  Welcome
//   Step 1  Company profile  — city (required), phone, website
//   Step 2  Listing basics   — hero photo, blurb, price band
//   Step 3  Done             — completeOnboarding, land on /vendor
//
// Standalone layout (own header + Wordmark), not the VendorShell — a focused
// flow, mirroring PlannerOnboardingPage.
//
// Two rules this file is built on, both from walking the flow as a vendor:
//
//   1. EVERY FIELD ANSWERS AT THE FIELD. Phone and website are validated as
//      you leave them, the message sits under the input that caused it, and a
//      rejected save maps the server's field back onto that same input. The
//      flow used to accept "abc123" / "not-a-valid-url" silently and then fail
//      the whole step with one generic "couldn't save", which leaves the vendor
//      guessing which of three inputs to fix. A website missing its scheme is
//      normalised (`example.com` → `https://example.com`) rather than rejected.
//      City is a geocoder typeahead (kind=city), not free text, because that
//      value is what couples filter the directory by: "bp" and "Budpest" both
//      make a listing unfindable.
//   2. STEP 2 IS THE LISTING, NOT A FORM. The photo, name, city and blurb are
//      laid out as the card a couple sees, so the empty state argues for itself.
//      A vendor can still go live with nothing filled in (friction here costs
//      completions), but the empty path now costs one deliberate tap: the
//      primary button asks once, and the answer is a plain fact about how the
//      card renders, never an invented conversion statistic.

import { Camera, Check } from "lucide-react";
import { type ChangeEvent, Fragment, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { VendorListingView } from "@shared/listings";
import { AddressAutocomplete } from "../../components/AddressAutocomplete";
import { Wordmark } from "../../components/Wordmark";
import { ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { vendorListingApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";

const TOTAL_STEPS = 4;
const PRICE_BANDS = [1, 2, 3, 4, 5] as const;

/** Punctuation people actually write phone numbers with. Deliberately not a
 *  dialling-plan check: the job is to catch "abc123" while it is still on
 *  screen, not to rule on +36 vs 06 vs +43. */
const PHONE_SHAPE = /^[+(\d][\d\s()./-]*$/;
const MIN_PHONE_DIGITS = 6;

function phoneValid(raw: string): boolean {
  const v = raw.trim();
  if (!v) return true; // optional field
  return PHONE_SHAPE.test(v) && (v.match(/\d/g)?.length ?? 0) >= MIN_PHONE_DIGITS;
}

/** `example.com` is what people type into a website field; store it as a URL
 *  instead of scolding them for the missing scheme. */
function normalizeWebsite(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

function websiteValid(raw: string): boolean {
  if (!raw.trim()) return true; // optional field
  try {
    const u = new URL(normalizeWebsite(raw));
    // A host with no dot ("not-a-valid-url") parses fine but is not a site.
    return (
      (u.protocol === "http:" || u.protocol === "https:") &&
      u.hostname.includes(".") &&
      !u.hostname.startsWith(".") &&
      !u.hostname.endsWith(".")
    );
  } catch {
    return false;
  }
}

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
  // One message per input, plus a form-level one for a failure that belongs to
  // no single field (network, 500).
  const [cityError, setCityError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [websiteError, setWebsiteError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [listingSaving, setListingSaving] = useState(false);
  const [listingError, setListingError] = useState<string | null>(null);
  const [heroUploading, setHeroUploading] = useState(false);
  // Set when the vendor tries to leave step 2 with an empty listing; swaps the
  // button row for the one question we ask before publishing an empty card.
  const [askEmpty, setAskEmpty] = useState(false);
  const heroInputRef = useRef<HTMLInputElement>(null);

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

  /** Put a rejected save back on the input that caused it. The backend names
   *  the field in its 400 ("website must be a valid http(s) URL"), which is the
   *  only signal we have — anything unrecognised stays a form-level message
   *  rather than being pinned on the wrong input. */
  function applyProfileSaveError(e: unknown) {
    const msg = e instanceof ApiError && e.status < 500 ? e.message : "";
    if (/website/i.test(msg)) setWebsiteError(t("vendor_onboarding.website_invalid"));
    else if (/phone/i.test(msg)) setPhoneError(t("vendor_onboarding.phone_invalid"));
    else if (/city/i.test(msg)) setCityError(t("vendor_onboarding.city_required"));
    else setProfileError(t("vendor_onboarding.save_error"));
  }

  async function handleProfileNext() {
    const trimmedCity = city.trim();
    const phoneOk = phoneValid(phone);
    const websiteOk = websiteValid(website);
    setCityError(trimmedCity ? null : t("vendor_onboarding.city_required"));
    setPhoneError(phoneOk ? null : t("vendor_onboarding.phone_invalid"));
    setWebsiteError(websiteOk ? null : t("vendor_onboarding.website_invalid"));
    if (!trimmedCity || !phoneOk || !websiteOk) return;

    // Save the normalised URL and show it, so what the vendor sees next time is
    // what the listing actually holds.
    const site = normalizeWebsite(website);
    if (site !== website) setWebsite(site);
    setProfileError(null);
    setProfileSaving(true);
    try {
      await vendorListingApi.patch({
        city: trimmedCity,
        contact_phone: phone.trim() || null,
        website: site || null,
      });
      setStep(2);
    } catch (e) {
      applyProfileSaveError(e);
    } finally {
      setProfileSaving(false);
    }
  }

  /** `force` comes from the "publish it empty" answer. Without it, a listing
   *  with neither a photo nor a blurb asks first. */
  async function handleListingNext(force = false) {
    if (!force && !heroUrl && !blurb.trim()) {
      setAskEmpty(true);
      return;
    }
    setAskEmpty(false);
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

  async function handleHeroFile(e: ChangeEvent<HTMLInputElement>) {
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
                            : "border border-paper-300 bg-paper-50 text-umber-400 dark:border-umber-600 dark:bg-umber-900 dark:text-umber-600"
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
              {/* City is a typeahead, not free text: this string is what couples
                  filter the directory by, so it has to be one spelling per town. */}
              <AddressAutocomplete
                id="vo_city"
                kind="city"
                required
                label={t("vendor_onboarding.city_label")}
                value={city}
                error={cityError}
                onChange={(v) => {
                  setCity(v);
                  if (cityError) setCityError(null);
                }}
                onPick={() => setCityError(null)}
                maxLength={80}
              />
              <div>
                <label htmlFor="vo_phone" className="field-label">
                  {t("vendor_onboarding.phone_label")}
                </label>
                <input
                  id="vo_phone"
                  type="tel"
                  inputMode="tel"
                  className={`input ${phoneError ? "border-blush-500 dark:border-blush-400" : ""}`}
                  value={phone}
                  aria-invalid={phoneError ? true : undefined}
                  aria-describedby={phoneError ? "vo_phone_err" : undefined}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    if (phoneError) setPhoneError(null);
                  }}
                  // Checked when you leave the field, not on every keystroke:
                  // a half-typed number is not yet wrong.
                  onBlur={() =>
                    setPhoneError(phoneValid(phone) ? null : t("vendor_onboarding.phone_invalid"))
                  }
                  placeholder={t("vendor_onboarding.phone_placeholder")}
                  maxLength={40}
                />
                {phoneError && (
                  <p
                    id="vo_phone_err"
                    role="alert"
                    className="mt-1 text-sm text-blush-700 dark:text-blush-300"
                  >
                    {phoneError}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="vo_website" className="field-label">
                  {t("vendor_onboarding.website_label")}
                </label>
                <input
                  id="vo_website"
                  type="text"
                  inputMode="url"
                  className={`input ${websiteError ? "border-blush-500 dark:border-blush-400" : ""}`}
                  value={website}
                  aria-invalid={websiteError ? true : undefined}
                  aria-describedby={websiteError ? "vo_website_err" : undefined}
                  onChange={(e) => {
                    setWebsite(e.target.value);
                    if (websiteError) setWebsiteError(null);
                  }}
                  // Blur repairs what it can (adds the scheme) and only then
                  // complains about what is left.
                  onBlur={() => {
                    if (!websiteValid(website)) {
                      setWebsiteError(t("vendor_onboarding.website_invalid"));
                      return;
                    }
                    setWebsiteError(null);
                    setWebsite(normalizeWebsite(website));
                  }}
                  placeholder={t("vendor_onboarding.website_placeholder")}
                  maxLength={240}
                />
                {websiteError && (
                  <p
                    id="vo_website_err"
                    role="alert"
                    className="mt-1 text-sm text-blush-700 dark:text-blush-300"
                  >
                    {websiteError}
                  </p>
                )}
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

            {/* The step IS the card a couple sees: photo on top, name and city
                from step 1, the blurb written in place. No field labels — the
                shape says what each part is, and the empty state is the honest
                argument for filling it in. */}
            <div className="mt-6 overflow-hidden rounded-2xl ring-1 ring-paper-300 dark:ring-umber-700">
              <label
                htmlFor="vo_hero"
                className="relative flex aspect-[3/2] cursor-pointer items-center justify-center bg-paper-100 transition-colors hover:bg-paper-200 dark:bg-umber-800 dark:hover:bg-umber-700"
              >
                {heroUrl && <img src={heroUrl} alt="" className="h-full w-full object-cover" />}
                <span
                  className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium ${
                    heroUrl
                      ? "absolute bottom-3 right-3 bg-ink-900/70 text-paper-50 backdrop-blur"
                      : "text-umber-600 dark:text-umber-200"
                  }`}
                >
                  <Camera size={heroUrl ? 15 : 20} aria-hidden="true" />
                  {heroUploading
                    ? t("vendor_onboarding.hero_uploading")
                    : heroUrl
                      ? t("vendor_onboarding.hero_replace")
                      : t("vendor_onboarding.hero_cta")}
                </span>
                <input
                  id="vo_hero"
                  ref={heroInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={heroUploading}
                  onChange={(e) => void handleHeroFile(e)}
                />
              </label>

              <div className="p-4">
                <h3 className="truncate font-grotesk text-base text-ink-900 dark:text-paper-100">
                  {businessName || t("vendor_onboarding.your_business")}
                </h3>
                {city.trim().length > 0 && (
                  <p className="mt-0.5 truncate text-xs text-ink-500 dark:text-umber-300">{city}</p>
                )}
                <textarea
                  id="vo_blurb"
                  aria-label={t("vendor_onboarding.blurb_placeholder")}
                  // Borderless so the card reads as a card, but the focus ring
                  // stays (WCAG 2.4.7) — without a border it is the only thing
                  // telling a keyboard user where they are.
                  className="mt-2 min-h-[76px] w-full resize-none rounded-md border-0 bg-transparent p-0 text-sm leading-relaxed text-ink-700 placeholder:text-ink-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-umber-400 dark:text-umber-100 dark:placeholder:text-umber-400"
                  value={blurb}
                  maxLength={2000}
                  onChange={(e) => setBlurb(e.target.value)}
                  placeholder={t("vendor_onboarding.blurb_placeholder")}
                />
                {/* Counter only once the limit is in sight — a 0/2000 next to an
                    empty box is noise. */}
                {blurb.length > 1600 && (
                  <p className="text-right text-xs tabular-nums text-umber-400">
                    {blurb.length} / 2000
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5">
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
                          : "border-paper-300 bg-paper-50 text-umber-500 hover:border-umber-400 dark:border-umber-600 dark:bg-umber-900 dark:text-umber-300"
                      }`}
                    >
                      {"€".repeat(b)}
                    </button>
                  );
                })}
              </div>
            </div>

            {listingError && (
              <p className="mt-4 text-sm text-blush-700 dark:text-blush-300" role="alert">
                {listingError}
              </p>
            )}

            {askEmpty ? (
              // Asked once, and only for a listing with neither photo nor text.
              // The body is what the card above already shows, not a made-up
              // "listings with photos get N× more inquiries".
              <div className="mt-6 rounded-xl bg-paper-100 p-4 dark:bg-umber-800">
                <p className="font-grotesk text-base text-umber-900 dark:text-paper-50">
                  {t("vendor_onboarding.empty_title")}
                </p>
                <p className="mt-1 text-sm text-umber-600 dark:text-umber-300">
                  {t("vendor_onboarding.empty_body")}
                </p>
                <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={listingSaving}
                    onClick={() => void handleListingNext(true)}
                  >
                    {t("vendor_onboarding.skip")}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => {
                      setAskEmpty(false);
                      heroInputRef.current?.click();
                    }}
                  >
                    {t("vendor_onboarding.empty_upload")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-8 flex items-center justify-between">
                <button type="button" className="btn-ghost" onClick={() => setStep(1)}>
                  {t("common.back")}
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
            )}
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
