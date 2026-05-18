// Placeholder for the post-wedding photo share. Surfaces the sidebar entry
// today; full content (upload + "send link to every yes RSVP" batch email)
// lands in a follow-up.

import { Camera } from "lucide-react";
import { useT } from "../lib/i18n";

export default function MediaPage() {
  const { t } = useT();
  return (
    <>
      <header className="mb-6">
        <h1>{t("media.title")}</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">{t("media.sub")}</p>
      </header>

      <div className="card flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:text-left">
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blush-50 text-blush-700 dark:bg-blush-400/15 dark:text-blush-300">
          <Camera size={22} aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-serif text-xl">{t("media.coming_soon_title")}</h2>
          <p className="mt-1 text-sm text-ink-700 dark:text-paper-100">
            {t("media.coming_soon_body")}
          </p>
        </div>
      </div>
    </>
  );
}
