// Community supplier submission. The form is built around a live preview card
// (right column, sticky on wide viewports) so the user sees the exact listing
// they're creating as they type. The hero affordance is a one-shot Google Maps
// link paste — server resolves it and back-fills name/address/website/phone.
// Categories are picked from a visual chip grid grouped by SUPPLIER_GROUPS
// rather than a select, so the booking-order vocabulary stays consistent with
// the directory chain on /app/suppliers.

import type { SubmitCommunitySupplierInput, PriceBand } from "@shared/community_suppliers";
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
  Scissors,
  Shirt,
  Sparkles,
  Sparkle,
  Speaker,
  StickyNote,
  Tent,
  UtensilsCrossed,
  Wine,
} from "lucide-react";
import type { ComponentType, FormEvent, SVGProps } from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../lib/api";
import { supplierApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { Button, Dialog, FieldError, HelperText, TextField, useToast } from "./ui";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmitted: (supplier: DirectorySupplier) => void;
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

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

// Mirrors the icon palette in SuppliersPage so the chip grid + preview card
// stay visually consistent with the directory cards.
const CATEGORY_ICON: Record<SupplierCategory, IconCmp> = {
  venue: Building2,
  accommodation: BedDouble,
  tent_pavilion: Tent,
  catering: ChefHat,
  cake_dessert: Cake,
  bar_drinks: Wine,
  decor_floral: Flower2,
  lighting: Lightbulb,
  music_dj: Disc3,
  sound_tech: Speaker,
  photo_video: Camera,
  entertainment: PartyPopper,
  attire: Shirt,
  hair_makeup: Brush,
  nails: Hand,
  rings: Gem,
  stationery: StickyNote,
  wedding_website: Globe,
  transport: Bus,
};

const GROUP_ICON: Record<SupplierGroup, IconCmp> = {
  venue_stay: MapPin,
  food_drink: UtensilsCrossed,
  atmosphere: Sparkle,
  experience: PartyPopper,
  style: Scissors,
  details: Mail,
};

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

export function SubmitSupplierModal({ open, onClose, onSubmitted }: Props) {
  const { t } = useT();
  const toast = useToast();
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

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
      setForm(emptyForm());
      setErrors({});
      setSubmitting(false);
      setMapsLink("");
      setResolving(false);
      setResolveState({ kind: "idle" });
      lastResolvedRef.current = "";
    }
  }, [open]);

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
      const { place } = await supplierApi.resolveMapsUrl(trimmed);
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
    if (email && !isLikelyEmail(email)) {
      next.contact_email = t("suppliers.submit.err_invalid_email");
    }

    if (form.blurb.trim().length > 500) next.blurb = tooLong;

    if (form.price_band === null) next.price_band = required;

    return next;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;

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
      const res = await supplierApi.submitCommunity(payload);
      toast.success(
        trimmedEmail
          ? `${t("suppliers.submit.next_steps_title")} ${t("suppliers.submit.next_steps_body")}`
          : `${t("suppliers.submit.next_steps_review_title")} ${t("suppliers.submit.next_steps_review_body")}`,
      );
      onSubmitted(res.supplier);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          toast.error(t("suppliers.submit.err_rate_limited"));
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

  // The 3 required slots are category / name / price_band. Email is now
  // optional — listings without one skip email-verification and go straight
  // into the admin moderation queue. The progress counter motivates the user
  // across the finish line without surfacing it as gamified "complete your
  // profile" noise.
  const requiredFilled = useMemo(() => {
    let n = 0;
    if (form.category) n++;
    if (form.name.trim()) n++;
    if (form.price_band !== null) n++;
    return n;
  }, [form.category, form.name, form.price_band]);

  const blurbLen = form.blurb.length;

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
        <div className="flex w-full flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-500 dark:text-umber-300" aria-live="polite">
            {t("suppliers.submit.progress_label", { done: requiredFilled, total: 3 })}
          </p>
          <div className="flex gap-2 sm:justify-end">
            <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>
              {t("suppliers.submit.cancel")}
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="submit-supplier-form"
              loading={submitting}
              loadingLabel={t("suppliers.submit.submitting")}
            >
              {t("suppliers.submit.submit_button")}
            </Button>
          </div>
        </div>
      }
    >
      <p className="text-sm text-ink-600 dark:text-umber-200">{t("suppliers.submit.intro")}</p>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* LEFT — form */}
        <form id="submit-supplier-form" onSubmit={onSubmit} className="space-y-6">
          {/* Hero: Maps-link smart-fill. Blush gradient + sparkle so it reads
              as "the magic button", not just another input. Collapses to a
              quiet success row once resolved. */}
          <MapsLinkHero
            value={mapsLink}
            onChange={setMapsLink}
            onResolve={() => resolveMapsLink(mapsLink)}
            resolving={resolving}
            state={resolveState}
            t={t}
          />

          {/* WHO — category chips + name */}
          <section className="space-y-3" aria-labelledby="section-who-heading">
            <SectionHeading id="section-who-heading">
              {t("suppliers.submit.section_who")}
            </SectionHeading>
            <CategoryChipGrid
              value={form.category}
              onPick={(c) => setField("category", c)}
              invalid={Boolean(errors.category)}
              t={t}
            />
            {errors.category && (
              <FieldError id="submit-supplier-category-error">{errors.category}</FieldError>
            )}
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
            {/* Self-vs-recommendation switch. The boolean drives the trust
                pill on the public card — "Szolgáltató" badge when the vendor
                checks this, "Közösségi" otherwise. Defaults to off so the
                couple-recommendation case stays the conservative default. */}
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-paper-200 bg-paper-50 p-3 text-sm text-ink-700 transition-colors hover:border-blush-300 hover:bg-blush-50 dark:border-umber-700 dark:bg-umber-800/40 dark:text-paper-100 dark:hover:border-blush-400/40 dark:hover:bg-blush-400/10">
              <input
                type="checkbox"
                checked={form.is_self}
                onChange={(e) => setField("is_self", e.target.checked)}
                className="mt-0.5 h-4 w-4 cursor-pointer rounded border-paper-300 text-blush-600 focus:ring-blush-500 dark:border-umber-600"
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
          </section>

          {/* WHERE — city + address. Two columns on sm+. */}
          <section className="space-y-3" aria-labelledby="section-where-heading">
            <SectionHeading id="section-where-heading">
              {t("suppliers.submit.section_where")}
            </SectionHeading>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                id="submit-supplier-city"
                label={t("suppliers.submit.city_label")}
                maxLength={80}
                value={form.city}
                onChange={(e) => setField("city", e.target.value)}
                errorText={errors.city}
                placeholder={t("suppliers.submit.city_placeholder")}
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
          </section>

          {/* CONTACT — all fields optional. Email triggers a verification
              email when provided; without one the listing skips straight to
              admin moderation. */}
          <section className="space-y-3" aria-labelledby="section-contact-heading">
            <SectionHeading id="section-contact-heading">
              {t("suppliers.submit.section_contact")}
            </SectionHeading>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                id="submit-supplier-email"
                label={t("suppliers.submit.email_label")}
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
          </section>

          {/* PITCH — blurb + price band. */}
          <section className="space-y-3" aria-labelledby="section-pitch-heading">
            <SectionHeading id="section-pitch-heading">
              {t("suppliers.submit.section_pitch")}
            </SectionHeading>
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
                className={["input", errors.blurb ? "input-invalid" : ""].filter(Boolean).join(" ")}
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
          </section>

          {/* Trust signals — moved to the bottom of the form, small and quiet,
              so they read as guarantees the user discovers AFTER they've
              committed mentally rather than as a noisy preamble. */}
          <ul className="space-y-1.5 border-t border-paper-200 dark:border-umber-700 pt-4 text-xs text-ink-500 dark:text-umber-300">
            <TrustLine icon={<Mail size={12} aria-hidden />}>
              {t("suppliers.submit.trust_review")}
            </TrustLine>
            <TrustLine icon={<Check size={12} aria-hidden />}>
              {t("suppliers.submit.trust_email_private")}
            </TrustLine>
            <TrustLine icon={<Sparkles size={12} aria-hidden />}>
              {t("suppliers.submit.trust_no_fees")}
            </TrustLine>
          </ul>
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
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const inputId = "submit-supplier-maps-link";
  const ok = state.kind === "ok";
  const partial = state.kind === "partial";
  const error = state.kind === "failed" || state.kind === "rate_limited";

  return (
    <div
      className={`rounded-2xl border p-4 transition-colors ${
        ok
          ? "border-sage-300 bg-sage-50/60 dark:border-sage-400/40 dark:bg-sage-400/15"
          : error
            ? "border-blush-300 bg-blush-50/40 dark:border-blush-400/40 dark:bg-blush-400/15"
            : "border-blush-200 bg-gradient-to-br from-blush-50 via-paper-50 to-sage-50 dark:border-blush-400/40 dark:from-blush-400/10 dark:via-umber-800 dark:to-sage-400/10"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
            ok ? "bg-sage-500 text-white" : "bg-blush-600 text-white"
          }`}
        >
          {ok ? <Check size={14} /> : <Sparkles size={14} />}
        </span>
        <div className="min-w-0 flex-1">
          <label
            htmlFor={inputId}
            className="block text-sm font-semibold text-ink-900 dark:text-paper-50"
          >
            {t("suppliers.submit.magic_title")}
          </label>
          <p className="mt-0.5 text-xs text-ink-600 dark:text-umber-200">
            {t("suppliers.submit.magic_help")}
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
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
              variant="accent"
              size="sm"
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
                ? "text-sage-700 dark:text-sage-300"
                : partial
                  ? "text-ink-500 dark:text-umber-300"
                  : error
                    ? "text-blush-700 dark:text-blush-300"
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

function CategoryChipGrid({
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
  return (
    <div>
      <span className="field-label">
        {t("suppliers.submit.category_label")}
        <span aria-hidden="true" className="ml-0.5 text-blush-700">
          *
        </span>
      </span>
      {/* Two-column grid: group caption left, wrapping chip cluster right.
          The auto-sized left column keeps every group's chip cluster left-
          aligned at the same x, so the cluster reads as a tidy table rather
          than the previous inline label-and-chips tangle. */}
      <div
        role="radiogroup"
        aria-label={t("suppliers.submit.category_label")}
        aria-invalid={invalid || undefined}
        className={`grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-2xl border bg-paper-50 dark:bg-umber-800 p-3 ${
          invalid
            ? "border-blush-400 dark:border-blush-400/40"
            : "border-paper-200 dark:border-umber-700"
        }`}
      >
        {SUPPLIER_GROUPS.map((g) => {
          const GroupIcon = GROUP_ICON[g.id];
          return (
            <Fragment key={g.id}>
              <span className="flex items-center gap-1 self-center text-[10px] font-medium uppercase tracking-wide text-ink-400 dark:text-umber-300">
                <GroupIcon size={11} aria-hidden />
                {t(`suppliers.group.${g.id}`)}
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {g.categories.map((c) => {
                  const Icon = CATEGORY_ICON[c];
                  const selected = value === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => onPick(c)}
                      className={
                        selected
                          ? "inline-flex items-center gap-1.5 rounded-full bg-ink-800 dark:bg-paper-50 dark:text-umber-900 px-2.5 py-1 text-xs font-medium text-paper-100 transition"
                          : "inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-white dark:bg-umber-700 dark:border-umber-700 px-2.5 py-1 text-xs text-ink-700 dark:text-paper-100 transition hover:border-ink-400 hover:text-ink-900 dark:hover:border-umber-600"
                      }
                    >
                      <Icon size={12} aria-hidden />
                      {t(`suppliers.cat.${c}`)}
                    </button>
                  );
                })}
              </div>
            </Fragment>
          );
        })}
      </div>
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
        <span aria-hidden="true" className="ml-0.5 text-blush-700">
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
                    ? "flex min-h-tap items-center justify-center rounded-xl border border-blush-300 bg-white dark:bg-umber-700 dark:border-blush-400/40 px-2 py-2 text-ink-700 dark:text-paper-100 transition hover:border-blush-500 dark:hover:border-blush-400/60"
                    : "flex min-h-tap items-center justify-center rounded-xl border border-paper-300 bg-white dark:bg-umber-700 dark:border-umber-700 px-2 py-2 text-ink-700 dark:text-paper-100 transition hover:border-ink-400 dark:hover:border-umber-600"
              }
            >
              <span className="font-mono text-xs leading-none">
                {"$".repeat(band)}
                <span className={selected ? "opacity-50" : "text-ink-300 dark:text-umber-300"}>
                  {"$".repeat(5 - band)}
                </span>
              </span>
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
    <div className="card relative mt-1 overflow-hidden border-l-4 border-l-blush-400 !p-4 shadow-sm">
      {/* "Pending" ribbon — sets expectations that this is what the listing
          will look like AFTER email confirmation. */}
      <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full border border-blush-200 bg-blush-50 dark:border-blush-400/40 dark:bg-blush-400/15 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-blush-700 dark:text-blush-300">
        <Sparkles size={9} aria-hidden />
        {t("suppliers.submit.preview_pending_pill")}
      </span>
      <div className="flex items-start gap-3 pr-16">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-paper-300 dark:border-umber-700 bg-paper-100 dark:bg-umber-700/60 font-serif text-lg text-ink-700 dark:text-paper-100">
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
