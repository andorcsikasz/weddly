import { Briefcase, Globe, MapPin, Phone, SquarePen } from "lucide-react";
import { useEffect, useState } from "react";
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

/** Anything beyond the always-present name/email counts as "filled in" —
 *  that's when the tab flips from the blank form to the read view. */
function hasDetails(p: PlannerProfile): boolean {
  return Boolean(
    p.business_name || p.planner_city || p.planner_phone || p.planner_website || p.planner_bio,
  );
}

export default function PlannerSettingsAccount() {
  const { t } = useT();
  const toast = useToast();
  const { profile, setProfile, loadError } = useOutletContext<OutletCtx>();

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
      waitlist_prefill: null,
    };
    setFormState({ ...base, [field]: value || null } as PlannerProfile);
  }

  function startEdit(field?: keyof PlannerProfile) {
    setEditing(true);
    if (field) {
      requestAnimationFrame(() => document.getElementById(`planner-acct-${field}`)?.focus());
    }
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
    { field: "planner_city", icon: <MapPin size={16} />, value: saved.planner_city },
    { field: "planner_phone", icon: <Phone size={16} />, value: saved.planner_phone },
    { field: "planner_website", icon: <Globe size={16} />, value: saved.planner_website },
  ];
  const filledRows = detailRows.filter((r) => r.value);

  return (
    <>
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

      {profile && <PlannerPortfolioSection profile={profile} setProfile={setProfile} />}
    </>
  );
}
