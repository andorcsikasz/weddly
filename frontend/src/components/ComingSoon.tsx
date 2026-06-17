import { Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { useT } from "../lib/i18n";

/**
 * Full-page coming-soon placeholder for features that are still in development.
 * Shown to non-admin users on pages like /app/media and /app/design.
 */
export function ComingSoon() {
  const { t } = useT();
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6">
      <div className="flex max-w-sm flex-col items-center gap-5 text-center">
        {/* Icon ring */}
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-umber-200/60 bg-paper-100 dark:border-umber-700 dark:bg-umber-800/50">
          <Sparkles
            size={24}
            strokeWidth={1.4}
            className="text-umber-500 dark:text-umber-300"
            aria-hidden
          />
        </div>

        {/* Copy */}
        <div className="space-y-2">
          <h2 className="font-serif text-2xl italic text-ink-900 dark:text-paper-100">
            {t("common.coming_soon_headline")}
          </h2>
          <p className="text-sm leading-relaxed text-ink-500 dark:text-umber-300">
            {t("common.coming_soon_body")}
          </p>
        </div>

        {/* CTA */}
        <Link
          to="/app/dashboard"
          className="btn-outline btn-sm inline-flex items-center gap-1.5"
        >
          {t("common.page_back_to_app")}
        </Link>
      </div>
    </div>
  );
}
