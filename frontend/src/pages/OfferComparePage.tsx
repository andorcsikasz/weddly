// /app/vendors/compare: vendor offers side by side. Nested under /app/vendors
// (like messages) so the vendors rail row stays highlighted and the page is
// reached from the directory's top control band, not from a conversation.

import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { OfferCompare } from "../components/OfferCompare";
import { useT } from "../lib/i18n";

export default function OfferComparePage() {
  const { t } = useT();
  return (
    <div className="animate-fade-in space-y-4">
      <Link
        to="/app/vendors"
        className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 dark:text-paper-300 dark:hover:text-paper-50"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("common.back")}
      </Link>
      <OfferCompare />
    </div>
  );
}
