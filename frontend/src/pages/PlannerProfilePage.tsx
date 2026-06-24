import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { PlannerProfile } from "@shared/types";
import { Wordmark } from "../components/Wordmark";
import { plannerApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useToast } from "../components/ui";

export default function PlannerProfilePage() {
  const { t } = useT();
  const toast = useToast();

  const [form, setForm] = useState<PlannerProfile>({
    full_name: "",
    email: "",
    business_name: null,
    planner_bio: null,
    planner_city: null,
    planner_website: null,
    planner_phone: null,
    waitlist_prefill: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    plannerApi
      .getProfile()
      .then((p) => setForm(p))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function set(field: keyof PlannerProfile, value: string) {
    setForm((prev) => ({ ...prev, [field]: value || null }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await plannerApi.updateProfile({
        full_name: form.full_name,
        business_name: form.business_name,
        planner_bio: form.planner_bio,
        planner_city: form.planner_city,
        planner_website: form.planner_website,
        planner_phone: form.planner_phone,
      });
      setForm(updated);
      toast.success(t("planner_profile.save_success"));
    } catch {
      toast.error("Hiba a mentés során");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-paper-50 dark:bg-umber-950">
        <div className="mx-auto max-w-xl px-4 py-16 sm:px-8">
          <div className="h-64 animate-pulse rounded-xl bg-paper-100 dark:bg-umber-800" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper-50 dark:bg-umber-950">
      <header className="sticky top-0 z-30 border-b border-paper-300 bg-paper-50/85 backdrop-blur dark:border-umber-700 dark:bg-umber-900/85">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3 sm:px-6">
          <Link
            to="/app/planner"
            className="inline-flex h-11 items-center text-ink-900 transition-colors hover:text-ink-700 dark:text-paper-50 dark:hover:text-blush-300"
          >
            <Wordmark size="sm" />
          </Link>
          <Link
            to="/app/planner"
            className="inline-flex items-center gap-1.5 text-sm text-ink-700 hover:text-ink-900 dark:text-paper-200 dark:hover:text-paper-50"
          >
            <ArrowLeft size={15} />
            {t("planner_home.back_label")}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 pt-10 pb-16 sm:px-6">
        <h1 className="mb-8 font-grotesk text-3xl font-semibold tracking-tight text-umber-900 dark:text-paper-50">
          {t("planner_profile.heading")}
        </h1>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-umber-700 dark:text-umber-300">
              {t("planner_profile.full_name_label")}
            </label>
            <input
              type="text"
              className="input w-full"
              value={form.full_name}
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
              value={form.business_name ?? ""}
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
              value={form.planner_city ?? ""}
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
              value={form.planner_phone ?? ""}
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
              value={form.planner_website ?? ""}
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
              value={form.planner_bio ?? ""}
              onChange={(e) => set("planner_bio", e.target.value)}
              placeholder={t("planner_profile.bio_placeholder")}
            />
            <p className="mt-1 text-right text-xs text-umber-400">
              {(form.planner_bio ?? "").length}/400
            </p>
          </div>

          <button type="submit" disabled={saving} className="btn-primary w-full">
            {saving ? "…" : t("planner_profile.save_button")}
          </button>
        </form>
      </main>
    </div>
  );
}
