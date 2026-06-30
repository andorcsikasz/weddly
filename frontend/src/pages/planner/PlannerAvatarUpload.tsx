// Planner profile-photo control for the settings hero: shows the uploaded
// avatar (or initials fallback) with a camera button to pick a new photo and a
// remove button when one is set. Uploads JPEG/PNG/WebP up to 5 MB.

import { Camera, X } from "lucide-react";
import { useRef, useState } from "react";
import type { PlannerProfile } from "@shared/types";
import { useToast } from "../../components/ui";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";

export function PlannerAvatarUpload({
  url,
  initials,
  onUpdated,
}: {
  url: string | null;
  initials: string;
  onUpdated: (p: PlannerProfile) => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handlePick(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error(t("planner_profile.avatar_invalid"));
      return;
    }
    setBusy(true);
    try {
      const updated = await plannerApi.uploadAvatar(file);
      onUpdated(updated);
      toast.success(t("planner_profile.avatar_saved"));
    } catch {
      toast.error(t("planner_profile.avatar_error"));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      const updated = await plannerApi.deleteAvatar();
      onUpdated(updated);
    } catch {
      toast.error(t("planner_profile.avatar_error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative h-16 w-16 shrink-0">
      {url ? (
        <img
          src={url}
          alt=""
          className={`h-16 w-16 rounded-full object-cover ${busy ? "opacity-50" : ""}`}
        />
      ) : (
        <div
          className={`flex h-16 w-16 items-center justify-center rounded-full bg-umber-900 font-grotesk text-xl font-semibold text-paper-50 dark:bg-umber-700 ${
            busy ? "opacity-50" : ""
          }`}
        >
          {initials}
        </div>
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label={t("planner_profile.avatar_change")}
        title={t("planner_profile.avatar_change")}
        className="absolute -bottom-1 -right-1 inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-paper-50 bg-moss-600 text-paper-50 shadow-sm transition-colors hover:bg-moss-700 disabled:opacity-60 dark:border-umber-950"
      >
        <Camera size={13} aria-hidden="true" />
      </button>

      {url && !busy && (
        <button
          type="button"
          onClick={() => void handleRemove()}
          aria-label={t("planner_profile.avatar_remove")}
          title={t("planner_profile.avatar_remove")}
          className="absolute -right-1 -top-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-paper-300 bg-paper-50 text-umber-600 shadow-sm transition-colors hover:bg-paper-200 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-200"
        >
          <X size={11} aria-hidden="true" />
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handlePick(file);
        }}
      />
    </div>
  );
}
