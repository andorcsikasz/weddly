// Planner references / portfolio — a gallery of past-work entries the planner
// showcases on their profile. Each entry is a title + description and an
// optional uploaded photo (JPEG/PNG/WebP up to 5 MB). Add / delete inline.

import { ImagePlus, Plus, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import type { PlannerProfile } from "@shared/types";
import { useToast } from "../../components/ui";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";

export function PlannerPortfolioSection({
  profile,
  setProfile,
}: {
  profile: PlannerProfile;
  setProfile: (p: PlannerProfile) => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [adding, setAdding] = useState(false);
  // Form is collapsed by default so the existing references read as a clean
  // gallery; the planner opens the form deliberately.
  const [formOpen, setFormOpen] = useState(false);

  const items = profile.portfolio;

  function closeForm() {
    setFormOpen(false);
    setTitle("");
    setDescription("");
    setFile(null);
  }

  async function handleAdd() {
    if (!title.trim() && !description.trim() && !file) {
      toast.error(t("planner_profile.reference_need_text"));
      return;
    }
    setAdding(true);
    try {
      const res = await plannerApi.addPortfolio(title.trim(), description.trim(), file);
      setProfile({ ...profile, portfolio: res.portfolio });
      closeForm();
    } catch {
      toast.error(t("planner_profile.avatar_error"));
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      const res = await plannerApi.deletePortfolio(id);
      setProfile({ ...profile, portfolio: res.portfolio });
    } catch {
      toast.error(t("planner_profile.avatar_error"));
    }
  }

  return (
    <section className="mt-10 border-t border-paper-200 pt-8 dark:border-umber-700">
      <h2 className="font-grotesk text-lg font-semibold text-umber-900 dark:text-paper-50">
        {t("planner_profile.references_title")}
      </h2>
      <p className="mt-1 text-sm text-umber-600 dark:text-umber-300">
        {t("planner_profile.references_subtitle")}
      </p>

      {/* Existing entries */}
      {items.length > 0 ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="group relative overflow-hidden rounded-xl border border-paper-200 bg-white dark:border-umber-800 dark:bg-umber-900"
            >
              {item.image_url && (
                <img
                  src={item.image_url}
                  alt=""
                  className="aspect-[4/3] w-full object-cover"
                  loading="lazy"
                />
              )}
              <div className="p-3">
                {item.title && (
                  <p className="font-grotesk text-sm font-semibold text-umber-900 dark:text-paper-50">
                    {item.title}
                  </p>
                )}
                {item.description && (
                  <p className="mt-0.5 whitespace-pre-wrap text-xs text-umber-600 dark:text-umber-300">
                    {item.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void handleDelete(item.id)}
                aria-label={t("planner_profile.reference_delete")}
                title={t("planner_profile.reference_delete")}
                className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-umber-600 shadow-sm transition-colors hover:bg-blush-100 hover:text-blush-700 dark:bg-umber-800/90 dark:text-paper-200"
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-5 text-sm text-umber-400 dark:text-umber-500">
          {t("planner_profile.references_empty")}
        </p>
      )}

      {/* Divider between the existing gallery and the add-new affordance. */}
      <div className="mt-8 border-t border-paper-200 pt-6 dark:border-umber-700">
        {!formOpen ? (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="btn-outline inline-flex items-center gap-1.5"
          >
            <Plus size={15} aria-hidden="true" />
            {t("planner_settings.reference_add_toggle")}
          </button>
        ) : (
          <div className="rounded-xl border border-dashed border-paper-300 p-4 dark:border-umber-700">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-grotesk text-sm font-semibold text-umber-900 dark:text-paper-50">
                {t("planner_settings.reference_add_toggle")}
              </p>
              <button
                type="button"
                onClick={closeForm}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-umber-500 transition-colors hover:bg-paper-100 hover:text-umber-800 dark:text-umber-300 dark:hover:bg-umber-800"
                aria-label={t("planner_settings.reference_form_close")}
                title={t("planner_settings.reference_form_close")}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>
            <input
              type="text"
              className="input w-full"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("planner_profile.reference_title_ph")}
            />
            <textarea
              rows={3}
              maxLength={2000}
              className="input mt-3 w-full resize-none"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("planner_profile.reference_desc_ph")}
            />

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="btn-outline btn-sm inline-flex items-center gap-1.5"
              >
                <ImagePlus size={14} aria-hidden="true" />
                {t("planner_profile.reference_image")}
              </button>
              {file && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-moss-50 px-2.5 py-1 text-xs text-moss-800 dark:bg-moss-900/30 dark:text-moss-200">
                  {file.name.length > 28 ? `${file.name.slice(0, 28)}…` : file.name}
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    aria-label={t("common.remove")}
                    className="text-moss-600 hover:text-moss-900 dark:text-moss-300"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              )}
              <button
                type="button"
                onClick={() => void handleAdd()}
                disabled={adding}
                className="btn-primary btn-sm ml-auto"
              >
                {adding
                  ? t("planner_profile.reference_adding")
                  : t("planner_profile.reference_add")}
              </button>
            </div>

            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const picked = e.target.files?.[0] ?? null;
                e.target.value = "";
                setFile(picked);
              }}
            />
          </div>
        )}
      </div>
    </section>
  );
}
