// Placeholder for the post-wedding photo share. Surfaces the sidebar entry
// today; full content (upload + "send link to every yes RSVP" batch email)
// lands in a follow-up.

import { Camera } from "lucide-react";
import { useT } from "../lib/i18n";

// Brand silhouettes — Lucide ships no Google Drive / iCloud marks, and these
// renderings stay monochrome to inherit the surrounding text colour rather
// than forcing the chip into Drive's tri-colour palette.
function GoogleDriveIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 87.3 78" aria-hidden="true" fill="currentColor">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" />
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" />
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" />
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" />
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
      <path d="m73.4 26.5-12.7-22a9.395 9.395 0 0 0 -3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" />
    </svg>
  );
}

function ICloudIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M17.42 11.04a5.51 5.51 0 0 0-10.6-1.16 4.06 4.06 0 0 0-.65-.05A4.18 4.18 0 0 0 2 14.02 4.16 4.16 0 0 0 6.17 18.2h11.07A3.78 3.78 0 0 0 21 14.42a3.83 3.83 0 0 0-3.58-3.38z" />
    </svg>
  );
}

export default function MediaPage() {
  const { t } = useT();
  return (
    <>
      <header className="mb-4">
        <h1>{t("media.title")}</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">{t("media.sub")}</p>
      </header>

      {/* The card sits ~30% down the visual area instead of pinning to the
          top — without this nudge the "Coming soon" copy floats above a
          vast empty viewport on mobile, reading as "this page is broken"
          rather than "this page is intentionally empty until photos
          land". The min-h fills the column on phone heights and shrinks
          out of the way on desktop where the rest of the shell carries
          the layout. */}
      <div className="flex min-h-[40vh] flex-col items-center justify-center sm:block sm:min-h-0">
        <div className="card flex w-full flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:text-left">
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

        <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
          <button
            type="button"
            disabled
            className="btn-outline btn-sm inline-flex items-center gap-2"
          >
            <GoogleDriveIcon size={16} />
            {t("media.share_drive")}
          </button>
          <button
            type="button"
            disabled
            className="btn-outline btn-sm inline-flex items-center gap-2"
          >
            <ICloudIcon size={16} />
            {t("media.share_icloud")}
          </button>
        </div>
      </div>
    </>
  );
}
