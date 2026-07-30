import {
  Briefcase,
  Flag,
  Globe,
  Hash,
  Landmark,
  MapPin,
  Palette,
  Phone,
  ReceiptText,
  ScrollText,
  SquarePen,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { CompanyLookupResult } from "@shared/company_lookup";
import { countryName } from "@shared/country_list";
import type { PlannerProfile } from "@shared/types";
import { CountryCombobox } from "../../components/CountryCombobox";
import { PLANNER_STYLE_SLUGS, plannerStyleLabel } from "../../components/PlannerDirectoryRail";
import { PlannerPointsPanel, usePlannerPoints } from "../../components/PlannerPointsRail";
import { CompanyLookupBox } from "../../components/planner/CompanyLookupBox";
import { PlannerSetupChecklist } from "../../components/planner/PlannerSetupChecklist";
import { useToast } from "../../components/ui";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import { PlannerPortfolioSection } from "./PlannerPortfolioSection";

interface OutletCtx {
  profile: PlannerProfile | null;
  setProfile: (p: PlannerProfile) => void;
  loadError: boolean;
}

/** How many styles a planner may claim. Three is the same ceiling the /planners
 *  application offers, and it is a ceiling on purpose: a planner who works in
 *  every style has told a couple nothing. */
const MAX_STYLES = 3;

/** Anything beyond the always-present name/email counts as "filled in" —
 *  that's when the tab flips from the blank form to the read view. */
function hasDetails(p: PlannerProfile): boolean {
  return Boolean(
    p.business_name ||
      p.planner_city ||
      p.planner_phone ||
      p.planner_website ||
      p.planner_bio ||
      p.planner_country ||
      p.planner_registry_number ||
      p.planner_vat_number ||
      p.planner_address ||
      p.planner_styles?.length,
  );
}

export default function PlannerSettingsAccount() {
  const { t, locale } = useT();
  const toast = useToast();
  const { profile, setProfile, loadError } = useOutletContext<OutletCtx>();
  const points = usePlannerPoints();
  // The setup checklist's photo step lives in the portfolio section at the foot
  // of this page, so that row scrolls rather than navigates.
  const portfolioRef = useRef<HTMLDivElement>(null);

  const [form, setFormState] = useState<PlannerProfile | null>(null);
  const [saving, setSaving] = useState(false);
  // null = mode not decided yet (profile still loading). A filled profile
  // opens on the read view; a fresh one drops straight into the form.
  const [editing, setEditing] = useState<boolean | null>(null);

  useEffect(() => {
    if (profile && editing === null) setEditing(!hasDetails(profile));
  }, [profile, editing]);

  // Sync local form when parent profile loads.
  const active = form ?? profile;

  function set(field: keyof PlannerProfile, value: string) {
    const base = active ?? {
      full_name: "",
      email: "",
      business_name: null,
      planner_bio: null,
      planner_city: null,
      planner_website: null,
      planner_phone: null,
      planner_country: null,
      planner_registry_number: null,
      planner_vat_number: null,
      planner_legal_form: null,
      planner_address: null,
      waitlist_prefill: null,
    };
    setFormState({ ...base, [field]: value || null } as PlannerProfile);
  }

  /** Toggle one style slug, capped at MAX_STYLES. Empty saves as null rather
   *  than `[]`, matching how every other optional field on this form clears. */
  function toggleStyle(slug: string) {
    if (!active) return;
    const current = active.planner_styles ?? [];
    const next = current.includes(slug)
      ? current.filter((s) => s !== slug)
      : current.length >= MAX_STYLES
        ? current
        : [...current, slug];
    setFormState({ ...active, planner_styles: next.length ? next : null });
  }

  /** Auto-fill the editable fields from an official lookup result. Only
   *  fields the registry actually returned are overwritten. */
  function applyCompany(r: CompanyLookupResult) {
    if (!active) return;
    setFormState({
      ...active,
      business_name: r.name ?? active.business_name,
      planner_city: r.city ?? active.planner_city,
      planner_registry_number: r.registry_number ?? active.planner_registry_number,
      planner_vat_number: r.vat_number ?? active.planner_vat_number,
      planner_legal_form: r.legal_form ?? active.planner_legal_form,
      planner_address: r.address ?? active.planner_address,
    });
    toast.success(t("company_lookup.filled_toast"));
  }

  function startEdit(field?: keyof PlannerProfile) {
    setEditing(true);
    if (field) {
      requestAnimationFrame(() => document.getElementById(`planner-acct-${field}`)?.focus());
    }
  }

  /** Bring the portfolio section into view. Scroll rather than a jump: the
   *  planner is being moved down their own page, and the section keeps its own
   *  collapsed add-form, so landing on the heading is the honest destination. */
  function showPortfolio() {
    portfolioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cancelEdit() {
    setFormState(null);
    setEditing(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!active) return;
    setSaving(true);
    try {
      const updated = await plannerApi.updateProfile({
        full_name: active.full_name,
        business_name: active.business_name,
        planner_bio: active.planner_bio,
        planner_city: active.planner_city,
        planner_website: active.planner_website,
        planner_phone: active.planner_phone,
        planner_country: active.planner_country,
        planner_registry_number: active.planner_registry_number,
        planner_vat_number: active.planner_vat_number,
        planner_legal_form: active.planner_legal_form,
        planner_address: active.planner_address,
        // Sent as an array (the PATCH only writes the column when it gets one),
        // so an emptied picker clears the styles instead of silently keeping the
        // ones the planner just removed.
        planner_styles: active.planner_styles ?? [],
      });
      setProfile(updated);
      setFormState(null);
      setEditing(!hasDetails(updated));
      toast.success(t("planner_profile.save_success"));
    } catch {
      toast.error("Hiba a mentés során");
    } finally {
      setSaving(false);
    }
  }

  if (!active) {
    // The parent surfaces the load error banner; render nothing here rather
    // than an endless skeleton once the fetch has failed.
    if (loadError) return null;
    return <div className="mt-8 h-64 animate-pulse rounded-2xl bg-paper-100 dark:bg-umber-800" />;
  }

  const saved = profile ?? active;
  const detailRows: Array<{
    field: keyof PlannerProfile;
    icon: React.ReactNode;
    value: string | null;
  }> = [
    { field: "business_name", icon: <Briefcase size={16} />, value: saved.business_name },
    {
      field: "planner_country",
      icon: <Flag size={16} />,
      value: saved.planner_country ? countryName(saved.planner_country, locale) : null,
    },
    { field: "planner_city", icon: <MapPin size={16} />, value: saved.planner_city },
    { field: "planner_phone", icon: <Phone size={16} />, value: saved.planner_phone },
    { field: "planner_website", icon: <Globe size={16} />, value: saved.planner_website },
    {
      field: "planner_registry_number",
      icon: <Hash size={16} />,
      value: saved.planner_registry_number,
    },
    {
      field: "planner_vat_number",
      icon: <ReceiptText size={16} />,
      value: saved.planner_vat_number,
    },
    {
      field: "planner_legal_form",
      icon: <ScrollText size={16} />,
      value: saved.planner_legal_form,
    },
    { field: "planner_address", icon: <Landmark size={16} />, value: saved.planner_address },
    {
      field: "planner_styles",
      icon: <Palette size={16} />,
      value: saved.planner_styles?.length
        ? saved.planner_styles.map((s) => plannerStyleLabel(t, s)).join(" · ")
        : null,
    },
  ];
  const filledRows = detailRows.filter((r) => r.value);

  return (
    <>
      {/* "What do I do next", above the profile itself: the checklist is read
          off the SAVED profile, never the local form draft, so a half-typed
          city can't tick a step the server has not seen. */}
      {profile && (
        <PlannerSetupChecklist
          checklist={profile.checklist}
          onEditField={startEdit}
          onShowPhotos={showPortfolio}
        />
      )}

      {editing === false ? (
        /* Read view — the saved profile as a quiet presentation. Every section
         * is a button that drops back into the form with that field focused. */
        <div className="mt-8 space-y-4">
          {saved.planner_bio ? (
            <button
              type="button"
              onClick={() => startEdit("planner_bio")}
              aria-label={`${t("planner_profile.bio_label")}: ${t("common.edit")}`}
              className="group relative w-full rounded-2xl border border-paper-300 bg-white p-6 text-left shadow-soft transition-colors hover:border-paper-400 dark:border-umber-700 dark:bg-umber-800 dark:shadow-none dark:hover:border-umber-500"
            >
              <p className="font-serif text-lg italic leading-relaxed text-ink-800 dark:text-paper-100">
                {saved.planner_bio}
              </p>
              <SquarePen
                size={15}
                aria-hidden="true"
                className="absolute right-4 top-4 text-umber-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:text-umber-300"
              />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => startEdit("planner_bio")}
              className="w-full rounded-2xl border border-dashed border-paper-400 p-6 text-left text-sm italic text-umber-400 transition-colors hover:border-umber-400 hover:text-umber-500 dark:border-umber-600 dark:text-umber-400 dark:hover:border-umber-400"
            >
              {t("planner_profile.bio_placeholder")}
            </button>
          )}

          {filledRows.length > 0 && (
            <div className="divide-y divide-paper-200 rounded-2xl border border-paper-300 bg-white shadow-soft dark:divide-umber-700 dark:border-umber-700 dark:bg-umber-800 dark:shadow-none">
              {filledRows.map((row) => (
                <button
                  key={row.field}
                  type="button"
                  onClick={() => startEdit(row.field)}
                  aria-label={t("common.edit")}
                  className="group flex w-full items-center gap-3 px-5 py-3.5 text-left text-sm text-ink-800 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-paper-50 dark:text-paper-100 dark:hover:bg-umber-700/50"
                >
                  <span className="text-umber-400 dark:text-umber-300" aria-hidden="true">
                    {row.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{row.value}</span>
                  <SquarePen
                    size={14}
                    aria-hidden="true"
                    className="shrink-0 text-umber-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:text-umber-300"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="mt-8 space-y-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-umber-700 dark:text-umber-300">
              {t("planner_profile.full_name_label")}
            </label>
            <input
              id="planner-acct-full_name"
              type="text"
              className="input w-full"
              value={active.full_name}
              onChange={(e) => set("full_name", e.target.value)}
              required
            />
          </div>

          <CountryCombobox
            id="planner-acct-planner_country"
            label={t("planner_profile.country_label")}
            value={active.planner_country ?? ""}
            onChange={(code) => set("planner_country", code)}
          />

          <CompanyLookupBox country={active.planner_country ?? ""} onPick={applyCompany} />

          <div>
            <label className="mb-1 block text-sm font-medium text-umber-700 dark:text-umber-300">
              {t("planner_profile.business_name_label")}
            </label>
            <input
              id="planner-acct-business_name"
              type="text"
              className="input w-full"
              value={active.business_name ?? ""}
              onChange={(e) => set("business_name", e.target.value)}
              placeholder="Nagy Eszter Wedding Planning"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-umber-700 dark:text-umber-300">
              {t("planner_profile.city_label")}
            </label>
            <input
              id="planner-acct-planner_city"
              type="text"
              className="input w-full"
              value={active.planner_city ?? ""}
              onChange={(e) => set("planner_city", e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-umber-700 dark:text-umber-300">
              {t("planner_profile.phone_label")}
            </label>
            <input
              id="planner-acct-planner_phone"
              type="tel"
              className="input w-full"
              value={active.planner_phone ?? ""}
              onChange={(e) => set("planner_phone", e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-umber-700 dark:text-umber-300">
              {t("planner_profile.website_label")}
            </label>
            <input
              id="planner-acct-planner_website"
              type="url"
              className="input w-full"
              value={active.planner_website ?? ""}
              onChange={(e) => set("planner_website", e.target.value)}
              placeholder="https://"
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-umber-700 dark:text-umber-300">
                {t("planner_profile.registry_number_label")}
              </label>
              <input
                id="planner-acct-planner_registry_number"
                type="text"
                className="input w-full"
                value={active.planner_registry_number ?? ""}
                onChange={(e) => set("planner_registry_number", e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-umber-700 dark:text-umber-300">
                {t("planner_profile.vat_number_label")}
              </label>
              <input
                id="planner-acct-planner_vat_number"
                type="text"
                className="input w-full"
                value={active.planner_vat_number ?? ""}
                onChange={(e) => set("planner_vat_number", e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-umber-700 dark:text-umber-300">
              {t("planner_profile.legal_form_label")}
            </label>
            <input
              id="planner-acct-planner_legal_form"
              type="text"
              className="input w-full"
              value={active.planner_legal_form ?? ""}
              onChange={(e) => set("planner_legal_form", e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-umber-700 dark:text-umber-300">
              {t("planner_profile.address_label")}
            </label>
            <input
              id="planner-acct-planner_address"
              type="text"
              className="input w-full"
              value={active.planner_address ?? ""}
              onChange={(e) => set("planner_address", e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-umber-700 dark:text-umber-300">
              {t("planner_profile.bio_label")}
            </label>
            <textarea
              id="planner-acct-planner_bio"
              rows={4}
              maxLength={400}
              className="input w-full resize-none"
              value={active.planner_bio ?? ""}
              onChange={(e) => set("planner_bio", e.target.value)}
              placeholder={t("planner_profile.bio_placeholder")}
            />
            <p className="mt-1 text-right text-xs text-umber-400">
              {(active.planner_bio ?? "").length}/400
            </p>
          </div>

          {/* Styles. Until now these only ever arrived from the /planners
              application, so a planner who signed up any other way had no way to
              set them and the profile checklist held a step nobody could finish.
              Chips rather than three selects: the ceiling is what needs to be
              obvious here, and a picked chip that goes quiet says it without a
              counter. The full slug list lives in PlannerDirectoryRail, which is
              also what labels them on the card a couple sees. */}
          <div>
            <span className="mb-1 block text-sm font-medium text-umber-700 dark:text-umber-300">
              {t("planner_profile.styles_label")}
            </span>
            <p className="mb-2 text-xs text-umber-500 dark:text-umber-400">
              {t("planner_profile.styles_hint", { max: MAX_STYLES })}
            </p>
            <div
              role="group"
              aria-label={t("planner_profile.styles_label")}
              className="flex flex-wrap gap-2"
            >
              {PLANNER_STYLE_SLUGS.map((slug, idx) => {
                const picked = (active.planner_styles ?? []).includes(slug);
                // The cap disables what is not already picked, so the limit is
                // felt as "these are full" rather than as a rejected click.
                const full = (active.planner_styles ?? []).length >= MAX_STYLES && !picked;
                return (
                  <button
                    // The first chip carries the field id, so the checklist row
                    // and the read view's Styles row land focus somewhere real.
                    id={idx === 0 ? "planner-acct-planner_styles" : undefined}
                    key={slug}
                    type="button"
                    aria-pressed={picked}
                    disabled={full}
                    onClick={() => toggleStyle(slug)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      picked
                        ? "border-moss-600 bg-moss-600 font-medium text-paper-50 dark:border-moss-500 dark:bg-moss-500 dark:text-umber-950"
                        : full
                          ? "cursor-not-allowed border-paper-300 text-umber-300 dark:border-umber-700 dark:text-umber-600"
                          : "border-paper-300 text-umber-700 hover:border-moss-400 hover:text-umber-900 dark:border-umber-700 dark:text-paper-200 dark:hover:border-moss-500 dark:hover:text-paper-50"
                    }`}
                  >
                    {plannerStyleLabel(t, slug)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex gap-3">
            {profile && hasDetails(profile) && (
              <button type="button" onClick={cancelEdit} className="btn-outline">
                {t("common.cancel")}
              </button>
            )}
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? "..." : t("planner_profile.save_button")}
            </button>
          </div>
        </form>
      )}

      {/* scroll-mt clears the shell's sticky header, so the checklist's photo
          row lands on the section heading and not underneath it. */}
      {profile && (
        <div ref={portfolioRef} className="scroll-mt-24">
          <PlannerPortfolioSection profile={profile} setProfile={setProfile} />
        </div>
      )}

      {/* The score, under the work that earns it. The panel renders nothing
          without a status, and the spacer is guarded by the same condition so a
          slow points call leaves no empty gap under the portfolio. */}
      {points && (
        <div className="mt-10">
          <PlannerPointsPanel points={points} />
        </div>
      )}
    </>
  );
}
