import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { PlannerProfile } from "@shared/types";
import { useToast } from "../../components/ui";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import { PlannerPortfolioSection } from "./PlannerPortfolioSection";

interface OutletCtx {
  profile: PlannerProfile | null;
  setProfile: (p: PlannerProfile) => void;
  loadError: boolean;
}

export default function PlannerSettingsAccount() {
  const { t } = useT();
  const toast = useToast();
  const { profile, setProfile, loadError } = useOutletContext<OutletCtx>();

  const [form, setFormState] = useState<PlannerProfile | null>(null);
  const [saving, setSaving] = useState(false);

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
      waitlist_prefill: null,
    };
    setFormState({ ...base, [field]: value || null } as PlannerProfile);
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
      });
      setProfile(updated);
      setFormState(null);
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

  return (
    <>
      <form onSubmit={(e) => void handleSubmit(e)} className="mt-8 space-y-5">
        <div>
          <label className="mb-1 block text-sm font-medium text-umber-700 dark:text-umber-300">
            {t("planner_profile.full_name_label")}
          </label>
          <input
            type="text"
            className="input w-full"
            value={active.full_name}
            onChange={(e) => set("full_name", e.target.value)}
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-umber-700 dark:text-umber-300">
            {t("planner_profile.business_name_label")}
          </label>
          <input
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
            type="url"
            className="input w-full"
            value={active.planner_website ?? ""}
            onChange={(e) => set("planner_website", e.target.value)}
            placeholder="https://"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-umber-700 dark:text-umber-300">
            {t("planner_profile.bio_label")}
          </label>
          <textarea
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

        <button type="submit" disabled={saving} className="btn-primary w-full">
          {saving ? "..." : t("planner_profile.save_button")}
        </button>
      </form>

      {profile && <PlannerPortfolioSection profile={profile} setProfile={setProfile} />}
    </>
  );
}
