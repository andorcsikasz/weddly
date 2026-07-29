// /app/outreach — the Outreach Inbox as its own destination.
//
// The inbox itself is one component (components/OutreachInbox.tsx) and it also
// sits at the bottom of /app/vendors, which is where a couple meets it: you
// shortlist vendors, you write to them, all on one screen. This page exists for
// the couple who has already done that a few times (OUTREACH_NAV_UNLOCK_SENT),
// at which point the rail grows a row for it and "what did I send, who
// answered" stops being something to scroll a directory to reach.
//
// Deliberately the same component in both places rather than a split: the data
// is server-owned, so the two surfaces cannot drift, and composing a new
// campaign has to work from either one.

import { OutreachInbox } from "../components/OutreachInbox";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function OutreachPage() {
  const { t } = useT();
  useDocumentMeta("seo.outreach_title", "seo.outreach_description");

  return (
    <div className="animate-fade-in">
      <header className="mb-4">
        <h1 className="font-grotesk text-2xl font-semibold tracking-tight text-ink-900 dark:text-paper-50">
          {t("outreach.page_title")}
        </h1>
        <p className="mt-0.5 text-sm text-ink-600 dark:text-umber-200">{t("outreach.page_body")}</p>
      </header>
      <OutreachInbox />
    </div>
  );
}
