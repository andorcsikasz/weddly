// Community supplier submission. A short 4-step wizard (Who → Where → Reach →
// Pitch, see WIZARD_STEPS) with a live preview card (right column, sticky on
// wide viewports) so the user sees the exact listing they're creating as they
// type. The Where step carries a one-shot Google Maps link paste — the server
// resolves it and back-fills name/address/website/phone directly above the
// address. Category is a searchable typeahead (common categories first), so the
// booking-order vocabulary stays consistent with the directory chain on
// /app/suppliers without dumping all 29 categories on screen at once.

import type {
  SubmitCommunitySupplierInput,
  PriceBand,
  SupplierNameMatch,
} from "@shared/community_suppliers";
import type { DirectorySupplier, SupplierCategory, SupplierGroup } from "@shared/suppliers";
import { SUPPLIER_GROUPS } from "@shared/suppliers";
import {
  BedDouble,
  Brush,
  Building2,
  Bus,
  Cake,
  Camera,
  Check,
  ChefHat,
  ClipboardList,
  Disc3,
  Flower2,
  Gem,
  Globe,
  Hand,
  Lightbulb,
  Mail,
  MapPin,
  PartyPopper,
  Phone,
  Pizza,
  Scissors,
  Shirt,
  Sparkles,
  Sparkle,
  Speaker,
  PenTool,
  StickyNote,
  Tent,
  UtensilsCrossed,
  Wine,
} from "lucide-react";
import type { ComponentType, FormEvent, SVGProps } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../lib/api";
import { fireConfetti } from "../lib/confetti";
import { getVisitorToken, setVisitorToken, supplierApi, visitorApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { Button, Dialog, FieldError, HelperText, TextField, useToast } from "./ui";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmitted: (supplier: DirectorySupplier) => void;
  /** When set, the category is pinned to this value and the category picker
   *  is replaced by a read-only pill. Used by the "Már foglaltam" card on the
   *  directory page, which already knows which sub-category the user is
   *  filling in for. */
  initialCategory?: SupplierCategory | null;
  /** When set, pre-fills the name field on open. Used by the "Már
   *  foglaltam" card so the user doesn't have to retype what they already
   *  typed on the card. */
  initialName?: string;
  /** Public/visitor mode: no logged-in session. The submitter first verifies
   *  their email (Google one-tap → device token) and the submit is authed by
   *  X-Visitor-Token instead of a bearer. Used by the /vendors recommend
   *  section so anyone can register a vendor. Default false = couple mode. */
  visitor?: boolean;
};

type FieldKey =
  | "category"
  | "name"
  | "city"
  | "address"
  | "website"
  | "contact_email"
  | "contact_phone"
  | "blurb"
  | "price_band";

type Errors = Partial<Record<FieldKey, string>>;

const PRICE_BANDS: PriceBand[] = [1, 2, 3, 4, 5];

/** Uber-style monochrome CTA — black in light mode, white in dark. Overrides
 *  btn-primary's blush accent so the recommend form stays black-and-white. */
const BLACK_BTN =
  "!bg-ink-900 !text-paper-50 !border-ink-900 hover:!bg-ink-800 dark:!bg-paper-50 dark:!text-ink-900 dark:!border-paper-50 dark:hover:!bg-paper-200";

/** The submit flow is a short 4-step wizard (Who → Where → Reach → Pitch) so
 *  each screen shows 2-4 fields instead of one long scroll. `fields` is the
 *  subset of validated keys the step gates Next on; the required ones (name,
 *  category, price_band) sit on the first and last steps. */
const WIZARD_STEPS: ReadonlyArray<{ titleKey: string; fields: FieldKey[] }> = [
  { titleKey: "suppliers.submit.section_who", fields: ["name", "category"] },
  { titleKey: "suppliers.submit.section_where", fields: ["address"] },
  { titleKey: "suppliers.submit.section_contact", fields: ["website", "contact_email"] },
  { titleKey: "suppliers.submit.section_pitch", fields: ["blurb", "price_band"] },
];

/** Slim step progress bar + "n/total". Replaces the old "0 of 3 required
 *  filled" counter — in a wizard, step position is the natural progress cue. */
function StepProgress({ step, total }: { step: number; total: number }) {
  const pct = ((step + 1) / total) * 100;
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
        <div
          className="h-full rounded-full bg-ink-800 transition-all dark:bg-paper-50"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-500 dark:text-umber-300">
        {step + 1}/{total}
      </span>
    </div>
  );
}

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

// Mirrors the icon palette in SuppliersPage so the chip grid + preview card
// stay visually consistent with the directory cards.
import { CATEGORY_ICON, GROUP_ICON } from "../lib/category_icons";

function emptyForm() {
  return {
    category: "" as SupplierCategory | "",
    /** When true, the submitter is the vendor themselves (drives the
     *  "Szolgáltató" pill on the public card). Default false = couple
     *  recommendation. */
    is_self: false,
    name: "",
    city: "",
    address: "",
    website: "",
    contact_email: "",
    contact_phone: "",
    blurb: "",
    price_band: null as PriceBand | null,
  };
}

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isLikelyEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function looksLikeMapsUrl(s: string): boolean {
  const v = s.trim().toLowerCase();
  if (!v.startsWith("http")) return false;
  return (
    v.includes("maps.app.goo.gl") ||
    v.includes("goo.gl/maps") ||
    v.includes("google.com/maps") ||
    v.includes("google.hu/maps") ||
    v.includes("maps.google.")
  );
}

export function SubmitSupplierModal({
  open,
  onClose,
  onSubmitted,
  initialCategory,
  initialName,
  visitor = false,
}: Props) {
  const { t, locale } = useT();
  const toast = useToast();
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  // Visitor mode gates the form behind an email verification. Couple mode is
  // verified by definition (a logged-in session), so this is true immediately.
  const [verified, setVerified] = useState<boolean>(() => !visitor || Boolean(getVisitorToken()));
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  // Live "already on Weddly?" check keyed to the name field, rendered on step 0.
  const [nameMatches, setNameMatches] = useState<SupplierNameMatch[]>([]);
  const [checkingName, setCheckingName] = useState(false);

  // Hero Maps-link input. Lives in its own state because the value is
  // ephemeral — once the resolver fires, the parsed fields land in `form` and
  // the hero shows a celebratory "we filled it in" confirmation. Keeping it
  // separate also means accidental edits to the parsed address below don't
  // re-trigger another resolve.
  const [mapsLink, setMapsLink] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveState, setResolveState] = useState<
    | { kind: "idle" }
    | { kind: "ok"; filled: number }
    | { kind: "partial" }
    | { kind: "rate_limited" }
    | { kind: "failed" }
  >({ kind: "idle" });
  const lastResolvedRef = useRef<string>("");

  useEffect(() => {
    if (open) {
      // Seed with whatever the launcher pre-set (used by the "Már foglaltam"
      // card on /app/suppliers, which carries the active sub-category and
      // the name the user already typed on the card so they don't have to
      // re-enter either).
      const seeded = emptyForm();
      if (initialCategory) seeded.category = initialCategory;
      if (initialName) seeded.name = initialName;
      setForm(seeded);
      setErrors({});
      setSubmitting(false);
      setMapsLink("");
      setResolving(false);
      setResolveState({ kind: "idle" });
      lastResolvedRef.current = "";
      // Re-check verification each open: a returning visitor with a stored
      // device token skips the gate; couple mode is always verified.
      setVerified(!visitor || Boolean(getVisitorToken()));
      setVerifyError(null);
      setStep(0);
      setNameMatches([]);
      setCheckingName(false);
    }
  }, [open, initialCategory, initialName, visitor]);

  // Debounced "is this supplier already listed?" lookup — runs whenever the
  // name changes (≥3 chars) and drives the dedupe panel on step 0, so the
  // submitter can jump to an existing listing instead of filing a duplicate.
  useEffect(() => {
    const q = form.name.trim();
    if (q.length < 3) {
      setNameMatches([]);
      setCheckingName(false);
      return;
    }
    setCheckingName(true);
    const handle = window.setTimeout(() => {
      supplierApi
        .nameCheck(q)
        .then((res) => setNameMatches(res.matches))
        .catch(() => setNameMatches([]))
        .finally(() => setCheckingName(false));
    }, 400);
    return () => window.clearTimeout(handle);
  }, [form.name]);

  async function resolveMapsLink(raw: string) {
    const trimmed = raw.trim();
    if (!looksLikeMapsUrl(trimmed)) {
      setResolveState({ kind: "failed" });
      return;
    }
    if (lastResolvedRef.current === trimmed) return;
    lastResolvedRef.current = trimmed;

    setResolving(true);
    setResolveState({ kind: "idle" });
    try {
      const { place } = await supplierApi.resolveMapsUrl(
        trimmed,
        visitor ? (getVisitorToken() ?? undefined) : undefined,
      );
      setForm((cur) => ({
        ...cur,
        address: place.address ?? cur.address,
        city: cur.city.trim() ? cur.city : (place.city ?? cur.city),
        name: cur.name.trim() ? cur.name : (place.name ?? cur.name),
        website: cur.website.trim() ? cur.website : (place.website ?? cur.website),
        contact_phone: cur.contact_phone.trim()
          ? cur.contact_phone
          : (place.phone ?? cur.contact_phone),
      }));
      const filled =
        Number(!!place.address) +
        Number(!!place.city) +
        Number(!!place.name) +
        Number(!!place.website) +
        Number(!!place.phone);
      setResolveState(filled > 0 ? { kind: "ok", filled } : { kind: "partial" });
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setResolveState({ kind: "rate_limited" });
      } else {
        setResolveState({ kind: "failed" });
      }
    } finally {
      setResolving(false);
    }
  }

  function setField<K extends keyof ReturnType<typeof emptyForm>>(
    key: K,
    value: ReturnType<typeof emptyForm>[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!(key in e)) return e;
      const next = { ...e };
      delete next[key as FieldKey];
      return next;
    });
  }

  function validate(): Errors {
    const next: Errors = {};
    const required = t("suppliers.submit.err_required");
    const tooLong = t("suppliers.submit.err_too_long");

    if (!form.category) next.category = required;

    const name = form.name.trim();
    if (!name) next.name = required;
    else if (name.length > 120) next.name = tooLong;

    if (form.city.trim().length > 80) next.city = tooLong;

    const address = form.address.trim();
    if (address && address.length > 600) next.address = tooLong;

    const website = form.website.trim();
    if (website && !isValidUrl(website)) next.website = t("suppliers.submit.err_invalid_url");

    const email = form.contact_email.trim();
    if (!email) next.contact_email = required;
    else if (!isLikelyEmail(email)) next.contact_email = t("suppliers.submit.err_invalid_email");

    if (form.blurb.trim().length > 500) next.blurb = tooLong;

    if (form.price_band === null) next.price_band = required;

    return next;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    // Enter on an intermediate step advances rather than submitting the form.
    if (step < WIZARD_STEPS.length - 1) {
      goNext();
      return;
    }

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    if (!form.category || form.price_band === null) return;

    const trimmedEmail = form.contact_email.trim();
    const payload: SubmitCommunitySupplierInput = {
      category: form.category,
      submitter_type: form.is_self ? "self" : "user",
      name: form.name.trim(),
      city: form.city.trim(),
      address: form.address.trim() ? form.address.trim() : null,
      website: form.website.trim(),
      contact_email: trimmedEmail ? trimmedEmail : null,
      contact_phone: form.contact_phone.trim() ? form.contact_phone.trim() : null,
      blurb: form.blurb.trim(),
      price_band: form.price_band,
    };

    setSubmitting(true);
    try {
      const res = visitor
        ? await visitorApi.submitSupplier(payload)
        : await supplierApi.submitCommunity(payload);
      // End-of-flow celebration.
      fireConfetti();
      toast.success(
        trimmedEmail
          ? `${t("suppliers.submit.next_steps_title")} ${t("suppliers.submit.next_steps_body")}`
          : `${t("suppliers.submit.next_steps_review_title")} ${t("suppliers.submit.next_steps_review_body")}`,
      );
      onSubmitted(res.supplier);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        const detail = err.detail && typeof err.detail === "object" ? err.detail : {};
        const detailCode = (detail as { code?: string }).code;
        if (visitor && err.status === 401) {
          // Device token expired/unknown — drop it and send the visitor back
          // through the verify gate rather than showing a raw auth error.
          setVisitorToken(null);
          setVerified(false);
          setVerifyError(t("suppliers.submit.visitor_reverify"));
        } else if (err.status === 429) {
          toast.error(t("suppliers.submit.err_rate_limited"));
        } else if (err.status === 409 && detailCode === "already_listed") {
          // Already curated/claimed/approved: point them at the live listing
          // instead of queuing a duplicate.
          const existing = (detail as { existing?: { name?: string } }).existing;
          toast.info(t("suppliers.submit.err_already_listed", { name: existing?.name ?? "" }));
          onClose();
        } else if (err.status === 409 && detailCode === "duplicate_email") {
          // Re-submission from a contact already in the moderation queue: tell
          // them they're already registered and waitlisted, not a hard error.
          toast.info(t("suppliers.submit.err_duplicate_email"));
          onClose();
        } else if (err.status >= 400 && err.status < 500) {
          toast.error(err.message);
        } else {
          toast.error(t("common.error_generic"));
        }
      } else {
        toast.error(t("common.error_generic"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Per-step gate: run the full validator, then keep only the current step's
  // field errors so Next blocks on this screen's problems (a required name on
  // step 0, price on the last) without flagging fields the user hasn't reached.
  function validateStep(idx: number): Errors {
    const all = validate();
    const keys = WIZARD_STEPS[idx]?.fields ?? [];
    const out: Errors = {};
    for (const k of keys) {
      const msg = all[k];
      if (msg) out[k] = msg;
    }
    return out;
  }

  function goNext() {
    const stepErrors = validateStep(step);
    if (Object.keys(stepErrors).length > 0) {
      setErrors((prev) => ({ ...prev, ...stepErrors }));
      return;
    }
    setStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1));
  }

  function goBack() {
    setStep((s) => Math.max(0, s - 1));
  }

  const blurbLen = form.blurb.length;

  const onVisitorVerify = async (credential: string) => {
    setVerifyError(null);
    try {
      await visitorApi.googleVerify(credential, locale === "hu" ? "hu" : "en");
      setVerified(true);
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : t("common.error_generic"));
    }
  };

  // Visitor mode, not yet verified: gate the whole form behind a one-tap email
  // verification (same device-token flow as the public review composer). Once
  // verified we fall through to the normal form below.
  if (visitor && !verified) {
    return (
      <Dialog
        open={open}
        role="dialog"
        size="lg"
        title={t("suppliers.submit.title")}
        onClose={onClose}
      >
        <div className="mx-auto max-w-md py-2 text-center">
          <h3 className="text-base font-semibold text-ink-900 dark:text-paper-50">
            {t("suppliers.submit.visitor_verify_title")}
          </h3>
          <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">
            {t("suppliers.submit.visitor_verify_body")}
          </p>
          <div className="mt-5 flex justify-center">
            <GoogleSignInButton mode="signin" onCredential={onVisitorVerify} />
          </div>
          {verifyError && (
            <p className="mt-3 text-xs text-rose-600 dark:text-rose-300">{verifyError}</p>
          )}
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      role="dialog"
      size="lg"
      title={t("suppliers.submit.title")}
      onClose={() => {
        if (!submitting) onClose();
      }}
      footer={
        <div className="flex w-full flex-col gap-3">
          <StepProgress step={step} total={WIZARD_STEPS.length} />
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              type="button"
              onClick={step === 0 ? onClose : goBack}
              disabled={submitting}
            >
              {step === 0 ? t("suppliers.submit.cancel") : t("common.back")}
            </Button>
            {step < WIZARD_STEPS.length - 1 ? (
              <Button
                variant="primary"
                type="button"
                onClick={goNext}
                disabled={submitting}
                className={BLACK_BTN}
              >
                {t("common.next")}
              </Button>
            ) : (
              <Button
                variant="primary"
                type="submit"
                form="submit-supplier-form"
                loading={submitting}
                loadingLabel={t("suppliers.submit.submitting")}
                className={BLACK_BTN}
              >
                {t("suppliers.submit.submit_button")}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* LEFT — one wizard step at a time */}
        <form id="submit-supplier-form" onSubmit={onSubmit} className="min-w-0">
          <SectionHeading id="submit-supplier-step-heading">
            {t(WIZARD_STEPS[step]?.titleKey ?? "suppliers.submit.section_who")}
          </SectionHeading>

          {/* STEP 0 — WHO they are: name + category */}
          {step === 0 && (
            <div className="mt-4 space-y-3">
              <TextField
                id="submit-supplier-name"
                label={t("suppliers.submit.name_label")}
                required
                maxLength={120}
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                errorText={errors.name}
                placeholder={t("suppliers.submit.name_placeholder")}
              />
              {/* Live "already on Weddly?" dedupe — if the typed name matches a
                  live listing, thank the submitter and link them to it instead
                  of queuing a duplicate. */}
              {(checkingName || nameMatches.length > 0) && (
                <div className="rounded-xl border border-ink-200 bg-ink-50 p-3 dark:border-umber-700 dark:bg-umber-800/50">
                  {nameMatches.length === 0 ? (
                    <p className="text-xs text-ink-500 dark:text-umber-300">
                      {t("suppliers.submit.already_checking")}
                    </p>
                  ) : (
                    <>
                      <p className="text-xs font-semibold text-ink-900 dark:text-paper-50">
                        {t("suppliers.submit.already_title")}
                      </p>
                      <p className="mt-1 text-[11px] text-ink-600 dark:text-umber-200">
                        {t("suppliers.submit.already_body")}
                      </p>
                      <ul className="mt-2 space-y-1.5">
                        {nameMatches.map((m) => (
                          <li key={m.id}>
                            <a
                              href={`${visitor ? "/vendors/" : "/app/suppliers/"}${encodeURIComponent(m.id)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-between gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm transition hover:border-ink-900 dark:border-umber-700 dark:bg-umber-800 dark:hover:border-paper-50"
                            >
                              <span className="min-w-0 flex-1 truncate font-medium text-ink-900 dark:text-paper-50">
                                {m.name}
                                {m.city && (
                                  <span className="ml-1.5 text-xs font-normal text-ink-500 dark:text-umber-300">
                                    {m.city}
                                  </span>
                                )}
                              </span>
                              <span className="shrink-0 text-xs font-medium text-ink-900 underline underline-offset-2 dark:text-paper-50">
                                {t("suppliers.submit.already_view")}
                              </span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
              {/* When the launcher pre-pinned a category (the "Már foglaltam"
                  card on /app/suppliers), skip the picker — a read-only pill
                  keeps the form context obvious. */}
              {initialCategory ? (
                <div className="rounded-xl border border-paper-200 bg-paper-50 px-3 py-2 text-xs text-ink-600 dark:border-umber-700 dark:bg-umber-800/40 dark:text-paper-100">
                  <span className="font-semibold uppercase tracking-wide text-[10px] text-ink-500 dark:text-umber-300">
                    {t("suppliers.submit.category_label")}
                  </span>
                  <span className="ml-2">{t(`suppliers.cat.${initialCategory}`)}</span>
                </div>
              ) : (
                <>
                  <CategorySearchPicker
                    value={form.category}
                    onPick={(c) => setField("category", c)}
                    invalid={Boolean(errors.category)}
                    t={t}
                  />
                  {errors.category && (
                    <FieldError id="submit-supplier-category-error">{errors.category}</FieldError>
                  )}
                </>
              )}
            </div>
          )}

          {/* STEP 1 — WHERE to find them: the Maps smart-fill sits directly
              above the address it fills, so the autofilled address is
              reviewable in one glance. */}
          {step === 1 && (
            <div className="mt-4 space-y-3">
              <MapsLinkHero
                value={mapsLink}
                onChange={setMapsLink}
                onResolve={() => resolveMapsLink(mapsLink)}
                resolving={resolving}
                state={resolveState}
                compact
                t={t}
              />
              <TextField
                id="submit-supplier-address"
                label={t("suppliers.submit.address_label")}
                maxLength={600}
                value={form.address}
                onChange={(e) => setField("address", e.target.value)}
                errorText={errors.address}
                placeholder={t("suppliers.submit.address_placeholder")}
              />
            </div>
          )}

          {/* STEP 2 — how to REACH them: the vendor's own contact. Email is
              required (it's how the listing is confirmed); phone + website
              stay optional. */}
          {step === 2 && (
            <div className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  id="submit-supplier-email"
                  label={t("suppliers.submit.email_label")}
                  required
                  type="email"
                  inputMode="email"
                  value={form.contact_email}
                  onChange={(e) => setField("contact_email", e.target.value)}
                  errorText={errors.contact_email}
                  placeholder={t("suppliers.submit.email_placeholder")}
                />
                <TextField
                  id="submit-supplier-phone"
                  label={t("suppliers.submit.phone_label")}
                  type="tel"
                  inputMode="tel"
                  value={form.contact_phone}
                  onChange={(e) => setField("contact_phone", e.target.value)}
                  errorText={errors.contact_phone}
                  placeholder="+36 30 123 4567"
                />
              </div>
              <TextField
                id="submit-supplier-website"
                label={t("suppliers.submit.website_label")}
                type="url"
                inputMode="url"
                placeholder="https://"
                value={form.website}
                onChange={(e) => setField("website", e.target.value)}
                errorText={errors.website}
              />
            </div>
          )}

          {/* STEP 3 — the PITCH: blurb + price + self-flag + trust lines. */}
          {step === 3 && (
            <div className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="submit-supplier-blurb"
                  className="field-label flex items-baseline justify-between"
                >
                  <span>{t("suppliers.submit.blurb_label")}</span>
                  <span className="font-mono text-[10px] tabular-nums text-ink-400">
                    {t("suppliers.submit.blurb_count", { n: blurbLen })}
                  </span>
                </label>
                <textarea
                  id="submit-supplier-blurb"
                  className={["input", errors.blurb ? "input-invalid" : ""]
                    .filter(Boolean)
                    .join(" ")}
                  rows={3}
                  maxLength={500}
                  value={form.blurb}
                  onChange={(e) => setField("blurb", e.target.value)}
                  placeholder={t("suppliers.submit.blurb_help")}
                  aria-invalid={errors.blurb ? true : undefined}
                  aria-describedby={
                    errors.blurb ? "submit-supplier-blurb-error" : "submit-supplier-blurb-help"
                  }
                />
                {errors.blurb ? (
                  <FieldError id="submit-supplier-blurb-error">{errors.blurb}</FieldError>
                ) : (
                  <HelperText id="submit-supplier-blurb-help">
                    {t("suppliers.submit.blurb_help")}
                  </HelperText>
                )}
              </div>

              <div>
                <PriceBandPicker
                  value={form.price_band}
                  onPick={(b) => setField("price_band", b)}
                  invalid={Boolean(errors.price_band)}
                  t={t}
                />
                {errors.price_band ? (
                  <FieldError id="submit-supplier-price-error">{errors.price_band}</FieldError>
                ) : (
                  <HelperText id="submit-supplier-price-help">
                    {t("suppliers.submit.price_help")}
                  </HelperText>
                )}
              </div>

              {/* Self-vs-recommendation switch — a final attestation next to
                  submit. Drives the trust pill on the public card. */}
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-paper-200 bg-paper-50 p-3 text-sm text-ink-700 transition-colors hover:border-ink-400 hover:bg-ink-50 dark:border-umber-700 dark:bg-umber-800/40 dark:text-paper-100 dark:hover:border-umber-600 dark:hover:bg-umber-800/60">
                <input
                  type="checkbox"
                  checked={form.is_self}
                  onChange={(e) => setField("is_self", e.target.checked)}
                  className="mt-0.5 h-4 w-4 cursor-pointer rounded border-paper-300 text-ink-900 focus:ring-ink-500 dark:border-umber-600"
                />
                <span className="flex-1">
                  <span className="block font-medium text-ink-800 dark:text-paper-50">
                    {t("suppliers.submit.is_self_label")}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-500 dark:text-umber-300">
                    {t("suppliers.submit.is_self_help")}
                  </span>
                </span>
              </label>

              <ul className="space-y-1.5 border-t border-paper-200 dark:border-umber-700 pt-4 text-xs text-ink-500 dark:text-umber-300">
                <TrustLine icon={<Mail size={12} aria-hidden />}>
                  {t("suppliers.submit.trust_review")}
                </TrustLine>
                <TrustLine icon={<Check size={12} aria-hidden />}>
                  {t("suppliers.submit.trust_email_private")}
                </TrustLine>
              </ul>
            </div>
          )}
        </form>

        {/* RIGHT — live preview, sticky on wide screens. */}
        <aside
          aria-label={t("suppliers.submit.preview_title")}
          className="lg:sticky lg:top-0 lg:self-start"
        >
          <p className="field-label">{t("suppliers.submit.preview_title")}</p>
          <LivePreviewCard form={form} t={t} />
          <p className="mt-2 text-[11px] text-ink-500 dark:text-umber-300">
            {t("suppliers.submit.preview_caption")}
          </p>
        </aside>
      </div>
    </Dialog>
  );
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3
      id={id}
      className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500 dark:text-umber-300"
    >
      {children}
    </h3>
  );
}

function TrustLine({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden className="mt-0.5 shrink-0 text-ink-500 dark:text-umber-300">
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}

function MapsLinkHero({
  value,
  onChange,
  onResolve,
  resolving,
  state,
  compact = false,
  t,
}: {
  value: string;
  onChange: (v: string) => void;
  onResolve: () => void;
  resolving: boolean;
  state:
    | { kind: "idle" }
    | { kind: "ok"; filled: number }
    | { kind: "partial" }
    | { kind: "rate_limited" }
    | { kind: "failed" };
  /** Tighter padding + smaller icon and copy. Used when the helper sits
   *  inside a section instead of being a full-width hero strip. */
  compact?: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const inputId = "submit-supplier-maps-link";
  const ok = state.kind === "ok";
  const partial = state.kind === "partial";
  const error = state.kind === "failed" || state.kind === "rate_limited";

  return (
    <div
      className={`${compact ? "rounded-xl p-2.5" : "rounded-2xl p-4"} border transition-colors ${
        ok
          ? "border-ink-300 bg-ink-50 dark:border-umber-600 dark:bg-umber-800"
          : error
            ? "border-ink-300 bg-paper-100 dark:border-umber-600 dark:bg-umber-800"
            : "border-paper-300 bg-paper-100 dark:border-umber-700 dark:bg-umber-800/60"
      }`}
    >
      <div className={`flex items-start ${compact ? "gap-2" : "gap-3"}`}>
        <span
          aria-hidden
          className={`mt-0.5 inline-flex shrink-0 items-center justify-center rounded-full ${
            compact ? "h-5 w-5" : "h-7 w-7"
          } bg-ink-900 text-paper-50 dark:bg-paper-50 dark:text-ink-900`}
        >
          {ok ? <Check size={compact ? 11 : 14} /> : <Sparkles size={compact ? 11 : 14} />}
        </span>
        <div className="min-w-0 flex-1">
          <label
            htmlFor={inputId}
            className={`block font-semibold text-ink-900 dark:text-paper-50 ${compact ? "text-xs" : "text-sm"}`}
          >
            {t("suppliers.submit.magic_title")}
          </label>
          <p
            className={`mt-0.5 text-ink-600 dark:text-umber-200 ${compact ? "text-[11px]" : "text-xs"}`}
          >
            {t("suppliers.submit.magic_help")}
          </p>
          <div className={`flex flex-col gap-2 sm:flex-row ${compact ? "mt-2" : "mt-3"}`}>
            <input
              id={inputId}
              type="url"
              inputMode="url"
              autoComplete="off"
              className="input flex-1"
              placeholder={t("suppliers.submit.magic_placeholder")}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onPaste={() => {
                // Resolve immediately when the user pastes — the only reason
                // to use this field is to paste a link, so we don't make them
                // hit a button afterwards. setTimeout 0 so the paste event
                // finishes updating the input value first.
                setTimeout(() => onResolve(), 0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onResolve();
                }
              }}
              disabled={resolving}
              aria-describedby="submit-supplier-maps-status"
            />
            <Button
              type="button"
              variant="primary"
              size="sm"
              className={BLACK_BTN}
              onClick={onResolve}
              loading={resolving}
              disabled={!value.trim() || resolving}
              loadingLabel={t("suppliers.submit.address_resolving")}
            >
              {t("suppliers.submit.magic_resolve")}
            </Button>
          </div>
          <p
            id="submit-supplier-maps-status"
            aria-live="polite"
            className={`mt-2 text-[11px] ${
              ok
                ? "text-ink-900 dark:text-paper-50"
                : partial
                  ? "text-ink-500 dark:text-umber-300"
                  : error
                    ? "text-ink-700 dark:text-paper-100"
                    : "text-ink-400 dark:text-umber-300"
            }`}
          >
            {ok && t("suppliers.submit.address_resolved")}
            {partial && t("suppliers.submit.address_resolved_partial")}
            {state.kind === "rate_limited" && t("suppliers.submit.err_rate_limited")}
            {state.kind === "failed" && t("suppliers.submit.address_resolve_failed")}
            {state.kind === "idle" && !resolving && t("suppliers.submit.magic_or_manual")}
            {resolving && t("suppliers.submit.address_resolving")}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Searchable category field. Type to filter every category by its translated
 *  name ("photo" → Photography). Once chosen, collapses to a single selected
 *  pill with a "change" affordance, so the picker never dominates the step. */
function CategorySearchPicker({
  value,
  onPick,
  invalid,
  t,
}: {
  value: SupplierCategory | "";
  onPick: (c: SupplierCategory) => void;
  invalid: boolean;
  t: (key: string) => string;
}) {
  const [query, setQuery] = useState("");

  const all = useMemo(
    () =>
      SUPPLIER_GROUPS.flatMap((g) =>
        g.categories.map((c) => ({
          c,
          group: g.id as SupplierGroup,
          label: t(`suppliers.cat.${c}`),
        })),
      ),
    [t],
  );

  const q = query.trim().toLowerCase();
  const results = q
    ? all.filter(
        (x) =>
          x.label.toLowerCase().includes(q) ||
          t(`suppliers.group.${x.group}`).toLowerCase().includes(q),
      )
    : [];

  // Chosen state: one pill + a "change" button. The user only sees the full
  // search when they have no pick yet, or explicitly ask to change it.
  if (value) {
    const Icon = CATEGORY_ICON[value];
    return (
      <div>
        <span className="field-label">
          {t("suppliers.submit.category_label")}
          <span aria-hidden="true" className="ml-0.5 text-ink-900 dark:text-paper-50">
            *
          </span>
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-800 px-3 py-1.5 text-sm font-medium text-paper-100 dark:bg-paper-50 dark:text-umber-900">
            <Icon size={14} aria-hidden />
            {t(`suppliers.cat.${value}`)}
          </span>
          <button
            type="button"
            onClick={() => {
              onPick("" as SupplierCategory);
              setQuery("");
            }}
            className="text-xs font-medium text-ink-500 underline underline-offset-2 hover:text-ink-900 dark:text-umber-300 dark:hover:text-paper-50"
          >
            {t("suppliers.submit.category_change")}
          </button>
        </div>
      </div>
    );
  }

  const pick = (c: SupplierCategory) => {
    onPick(c);
    setQuery("");
  };

  return (
    <div>
      <label htmlFor="submit-supplier-category-search" className="field-label">
        {t("suppliers.submit.category_label")}
        <span aria-hidden="true" className="ml-0.5 text-ink-900 dark:text-paper-50">
          *
        </span>
      </label>
      <input
        id="submit-supplier-category-search"
        type="text"
        role="combobox"
        aria-expanded={q.length > 0}
        aria-controls="submit-supplier-category-results"
        aria-invalid={invalid || undefined}
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("suppliers.submit.category_search_placeholder")}
        className={["input", invalid ? "input-invalid" : ""].filter(Boolean).join(" ")}
      />
      {q ? (
        <ul
          id="submit-supplier-category-results"
          className="mt-2 max-h-56 divide-y divide-paper-100 overflow-y-auto rounded-xl border border-paper-200 bg-white dark:divide-umber-700/60 dark:border-umber-700 dark:bg-umber-800"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2.5 text-sm italic text-ink-400 dark:text-umber-300">
              {t("suppliers.submit.category_no_match")}
            </li>
          ) : (
            results.map((x) => {
              const Icon = CATEGORY_ICON[x.c];
              return (
                <li key={x.c}>
                  <button
                    type="button"
                    onClick={() => pick(x.c)}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-ink-800 transition hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
                  >
                    <Icon
                      size={15}
                      aria-hidden
                      className="shrink-0 text-ink-500 dark:text-umber-300"
                    />
                    <span className="min-w-0 flex-1 truncate">{x.label}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-400 dark:text-umber-400">
                      {t(`suppliers.group.${x.group}`)}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}

function PriceBandPicker({
  value,
  onPick,
  invalid,
  t,
}: {
  value: PriceBand | null;
  onPick: (b: PriceBand) => void;
  invalid: boolean;
  t: (key: string) => string;
}) {
  return (
    <div>
      <span className="field-label">
        {t("suppliers.submit.price_label")}
        <span aria-hidden="true" className="ml-0.5 text-ink-900 dark:text-paper-50">
          *
        </span>
      </span>
      <div
        role="radiogroup"
        aria-label={t("suppliers.submit.price_label")}
        aria-invalid={invalid || undefined}
        className="grid grid-cols-5 gap-1.5"
      >
        {PRICE_BANDS.map((band) => {
          const selected = value === band;
          // Word labels (Pénztárcabarát / Kedvező / …) live in the tooltip only
          // — the visible row is just the dollar-sign pattern so the chips
          // stay narrow and don't overflow in 5-up grids on small screens.
          const label = t(`suppliers.submit.band_name.b${band}`);
          // Accessible name combines the visual scale with the word so
          // screen-reader users hear "$$$ Prémium" and our regression test
          // (which scans by the dollar count) keeps passing. Only the
          // filled-band count goes into the aria pattern — the greyed
          // remainder is purely visual.
          const dollarPattern = "$".repeat(band);
          return (
            <button
              key={band}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${dollarPattern} ${label}`}
              onClick={() => onPick(band)}
              title={label}
              className={
                selected
                  ? "flex min-h-tap items-center justify-center rounded-xl border border-ink-800 bg-ink-800 dark:border-paper-50 dark:bg-paper-50 dark:text-umber-900 px-2 py-2 text-paper-100 transition"
                  : invalid
                    ? "flex min-h-tap items-center justify-center rounded-xl border border-ink-400 bg-white dark:bg-umber-700 dark:border-paper-300 px-2 py-2 text-ink-700 dark:text-paper-100 transition hover:border-ink-700 dark:hover:border-paper-100"
                    : "flex min-h-tap items-center justify-center rounded-xl border border-paper-300 bg-white dark:bg-umber-700 dark:border-umber-700 px-2 py-2 text-ink-700 dark:text-paper-100 transition hover:border-ink-400 dark:hover:border-umber-600"
              }
            >
              {/* Just the filled signs — no greyed remainder, which read as a
                  half-filled rating rather than a discrete price tier. The
                  solid-fill vs outline state carries the selection. */}
              <span className="font-mono text-xs leading-none">{"$".repeat(band)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LivePreviewCard({
  form,
  t,
}: {
  form: ReturnType<typeof emptyForm>;
  t: (key: string) => string;
}) {
  const name = form.name.trim();
  const displayName = name || t("suppliers.submit.preview_placeholder_name");
  const initial = (name.charAt(0) || "?").toUpperCase();
  const Icon: IconCmp | null = form.category ? CATEGORY_ICON[form.category] : null;
  const blurb = form.blurb.trim();
  const blurbDisplay = blurb || t("suppliers.submit.preview_placeholder_blurb");

  return (
    <div className="card mt-1 overflow-hidden border-l-4 border-l-ink-900 dark:border-l-paper-50 !p-4 shadow-sm">
      {/* "Pending" pill — its own top row so the long HU label
          ("MEGERŐSÍTÉSRE VÁR") can't crash into the supplier name. */}
      <div className="mb-2 flex justify-end">
        <span className="inline-flex items-center gap-1 rounded-full border border-ink-200 bg-ink-50 dark:border-umber-600 dark:bg-umber-800 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-ink-700 dark:text-paper-100">
          <Sparkles size={9} aria-hidden />
          {t("suppliers.submit.preview_pending_pill")}
        </span>
      </div>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-paper-300 dark:border-umber-700 bg-paper-100 dark:bg-umber-700/60 font-grotesk text-lg text-ink-700 dark:text-paper-100">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <h4
            className={`truncate text-sm font-semibold ${name ? "text-ink-900 dark:text-paper-50" : "text-ink-400 dark:text-umber-300"}`}
          >
            {displayName}
          </h4>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-500 dark:text-umber-300">
            {form.category && Icon && (
              <span className="inline-flex items-center gap-1 uppercase tracking-wide">
                <Icon size={11} aria-hidden />
                {t(`suppliers.cat.${form.category}`)}
              </span>
            )}
            {form.category && form.city.trim() && (
              <span aria-hidden className="text-paper-400 dark:text-umber-300">
                ·
              </span>
            )}
            {form.city.trim() && (
              <span className="uppercase tracking-wide">{form.city.trim()}</span>
            )}
            {form.price_band !== null && (
              <>
                {(form.category || form.city.trim()) && (
                  <span aria-hidden className="text-paper-400 dark:text-umber-300">
                    ·
                  </span>
                )}
                <span className="font-mono text-ink-600 dark:text-umber-200">
                  {"$".repeat(form.price_band)}
                </span>
              </>
            )}
          </p>
        </div>
      </div>
      {form.address.trim() && !looksLikeMapsUrl(form.address) && (
        <p className="mt-2 line-clamp-1 text-[11px] text-ink-500 dark:text-umber-300">
          {form.address.trim()}
        </p>
      )}
      <p
        className={`mt-3 line-clamp-3 text-xs ${blurb ? "text-ink-700 dark:text-paper-100" : "italic text-ink-400 dark:text-umber-300"}`}
      >
        {blurbDisplay}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-500 dark:text-umber-300">
        {form.website.trim() && (
          <span className="inline-flex items-center gap-1 rounded-full border border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-700/60 px-2 py-0.5">
            <Mail size={10} aria-hidden />
            {t("suppliers.visit_website")}
          </span>
        )}
        {form.contact_phone.trim() && (
          <span className="inline-flex items-center gap-1 rounded-full border border-paper-300 bg-paper-50 dark:border-umber-700 dark:bg-umber-700/60 px-2 py-0.5">
            <Phone size={10} aria-hidden />
            {form.contact_phone.trim()}
          </span>
        )}
      </div>
    </div>
  );
}
