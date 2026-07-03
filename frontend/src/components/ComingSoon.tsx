import { HardHat } from "lucide-react";
import { useT } from "../lib/i18n";

export function ComingSoon() {
  const { t } = useT();
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-ink-900 dark:text-paper-100">
      <HardHat size={36} strokeWidth={1.3} aria-hidden />
      <p className="font-grotesk text-3xl font-semibold tracking-tight">
        {t("dashboard.coming_soon_headline")}
      </p>
      <p className="text-sm text-ink-600 dark:text-umber-300">{t("dashboard.coming_soon_body")}</p>
    </div>
  );
}
