// The vendor's "pass this link on" widget: the URL, a one-tap copy, and
// pre-filled WhatsApp / email / native shares.
//
// Extracted from VendorReviewsPage, which had the only copy of it and pointed
// it exclusively at the `?review=1` composer. The same affordances are what a
// vendor wants for their plain public profile — from the header, from the
// listing editor — so the sheet takes its URL and its message from the caller
// and owns nothing but the clipboard state.
//
// Layout: two columns. The caller's own heading/blurb (`lead`) sits above the
// read-only link pill on the left, and every action stacks in a narrow column
// on the right, so the whole block is roughly one paragraph tall instead of
// five stacked rows. Below `sm` it degrades to the plain vertical stack.

import { Check, Copy, Link2, Mail, MessageCircle, Share2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { canNativeShare } from "../lib/share_weddly";
import { useT } from "../lib/i18n";

export function VendorShareSheet({
  url,
  message,
  subject,
  label,
  lead,
  className = "",
}: {
  /** What lands in the clipboard and in the pre-filled messages. */
  url: string;
  /** Message body for WhatsApp / email, already containing the URL. */
  message: string;
  subject: string;
  /** Accessible name for the readonly URL field. */
  label: string;
  /** Heading + blurb rendered above the link, inside the left column. */
  lead?: ReactNode;
  className?: string;
}) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  // Resolved once on the client: a Share button that opens nothing is worse
  // than no button, and every browser without the API keeps the other three.
  const [canShare] = useState(canNativeShare);

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

  const share = async () => {
    try {
      // The message ends with the URL and `navigator.share` renders text and
      // url together, so the link would otherwise appear twice in the target.
      await navigator.share({ title: subject, text: message.replace(url, "").trim(), url });
    } catch {
      /* dismissed by the user, or the target refused it */
    }
  };

  const action =
    "inline-flex items-center gap-2 rounded-xl border border-paper-300 bg-white px-3 py-2 text-sm font-medium text-ink-700 transition hover:border-ink-900 hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-paper-200 dark:hover:bg-umber-700/60";

  return (
    <div className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5 ${className}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {lead}
        {/* The link, in its own read-only pill. Click to select-all; the Copy
            action on the right is the actual copy. */}
        <div className="flex items-center gap-2 rounded-xl border border-paper-300 bg-paper-50 px-3 py-2 dark:border-umber-700 dark:bg-umber-800/60">
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
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 sm:w-40">
        <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className={action}>
          <MessageCircle size={16} aria-hidden="true" className="text-[#25D366]" />
          <span>{t("vendor.reviews.share_whatsapp")}</span>
        </a>
        <a href={mailtoUrl} className={action}>
          <Mail size={16} aria-hidden="true" className="text-ink-500 dark:text-umber-300" />
          <span>{t("vendor.reviews.share_email")}</span>
        </a>
        <button
          type="button"
          onClick={() => void copy()}
          className={
            copied
              ? "inline-flex items-center gap-2 rounded-xl border border-sage-300 bg-sage-100 px-3 py-2 text-sm font-medium text-sage-800 dark:border-sage-700 dark:bg-sage-500/20 dark:text-sage-200"
              : action
          }
        >
          {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          <span>{copied ? t("vendor.reviews.share_copied") : t("vendor.reviews.share_copy")}</span>
        </button>
        {canShare && (
          <button type="button" onClick={() => void share()} className={action}>
            <Share2 size={16} aria-hidden="true" className="text-ink-500 dark:text-umber-300" />
            <span>{t("vendor.reviews.share_native")}</span>
          </button>
        )}
      </div>
    </div>
  );
}
