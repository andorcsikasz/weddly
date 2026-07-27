// The vendor's "pass this link on" widget: the URL, a one-tap copy, and
// pre-filled WhatsApp / email shares.
//
// Extracted from VendorReviewsPage, which had the only copy of it and pointed
// it exclusively at the `?review=1` composer. The same three affordances are
// what a vendor wants for their plain public profile — from the header, from
// the listing editor — so the sheet takes its URL and its message from the
// caller and owns nothing but the clipboard state.
//
// Layout: the link sits in its own read-only pill, Copy is the one primary
// action underneath it, and WhatsApp / email are a secondary two-up row — a
// clean vertical stack that reads the same in a dialog or inline in the editor.

import { Check, Copy, Link2, Mail, MessageCircle } from "lucide-react";
import { useState } from "react";
import { useT } from "../lib/i18n";

export function VendorShareSheet({
  url,
  message,
  subject,
  label,
  className = "",
}: {
  /** What lands in the clipboard and in the pre-filled messages. */
  url: string;
  /** Message body for WhatsApp / email, already containing the URL. */
  message: string;
  subject: string;
  /** Accessible name for the readonly URL field. */
  label: string;
  className?: string;
}) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
  const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked (or unavailable in tests) — the field stays selectable */
    }
  };

  const shareLink =
    "inline-flex items-center justify-center gap-2 rounded-xl border border-paper-300 bg-white px-3 py-2.5 text-sm font-medium text-ink-700 transition hover:border-ink-900 hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-paper-200 dark:hover:bg-umber-700/60";

  return (
    <div className={`flex flex-col gap-2.5 ${className}`}>
      {/* The link, in its own read-only pill. Click to select-all; the button
          below is the actual copy. */}
      <div className="flex items-center gap-2 rounded-xl border border-paper-300 bg-paper-50 px-3 py-2.5 dark:border-umber-700 dark:bg-umber-800/60">
        <Link2
          size={15}
          aria-hidden
          className="shrink-0 -rotate-45 text-ink-400 dark:text-umber-300"
        />
        <input
          type="text"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={label}
          className="min-w-0 flex-1 truncate bg-transparent font-mono text-xs text-ink-700 focus:outline-none dark:text-paper-100"
        />
      </div>

      {/* Primary action. */}
      <button
        type="button"
        onClick={() => void copy()}
        className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
          copied
            ? "bg-sage-100 text-sage-800 dark:bg-sage-500/20 dark:text-sage-200"
            : "bg-ink-900 text-paper-50 hover:bg-ink-800 dark:bg-paper-100 dark:text-ink-900 dark:hover:bg-paper-200"
        }`}
      >
        {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        <span>{copied ? t("vendor.reviews.share_copied") : t("vendor.reviews.share_copy")}</span>
      </button>

      {/* Secondary: hand it straight to a chat or an inbox. */}
      <div className="grid grid-cols-2 gap-2">
        <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className={shareLink}>
          <MessageCircle size={16} aria-hidden="true" className="text-[#25D366]" />
          <span>{t("vendor.reviews.share_whatsapp")}</span>
        </a>
        <a href={mailtoUrl} className={shareLink}>
          <Mail size={16} aria-hidden="true" className="text-ink-500 dark:text-umber-300" />
          <span>{t("vendor.reviews.share_email")}</span>
        </a>
      </div>
    </div>
  );
}
