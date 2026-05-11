// Placeholder for the post-wedding honeymoon planner. Surfaces the sidebar
// entry today; full content (destination, dates, packing, budget tie-in)
// lands in a follow-up.

import { Plane } from "lucide-react";
import { AppShell } from "../components/AppShell";
import { useT } from "../lib/i18n";

export default function HoneymoonPage() {
  const { t } = useT();
  return (
    <AppShell>
      <header className="mb-6">
        <h1>{t("honeymoon.title")}</h1>
        <p className="mt-1 text-sm text-ink-500">{t("honeymoon.sub")}</p>
      </header>

      <div className="card flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:text-left">
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blush-50 text-blush-700">
          <Plane size={22} aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-serif text-xl">{t("honeymoon.coming_soon_title")}</h2>
          <p className="mt-1 text-sm text-ink-700">{t("honeymoon.coming_soon_body")}</p>
        </div>
      </div>
    </AppShell>
  );
}
