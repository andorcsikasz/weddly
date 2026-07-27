// The vendor's "pass this link on" widget: the URL, a one-tap copy, and
// pre-filled WhatsApp / email shares.
//
// Extracted from VendorReviewsPage, which had the only copy of it and pointed
// it exclusively at the `?review=1` composer. The same three affordances are
// what a vendor wants for their plain public profile — from the header, from
// the listing editor — so the sheet takes its URL and its message from the
// caller and owns nothing but the clipboard state.

import { Check, Copy, Mail, MessageCircle } from "lucide-react";
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

  return (
    <div className={`flex flex-col gap-2 sm:flex-row sm:items-center ${className}`}>
      <input
        type="text"
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="input flex-1 font-mono text-xs"
        aria-label={label}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void copy()} className="btn-primary">
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          <span>{copied ? t("vendor.reviews.share_copied") : t("vendor.reviews.share_copy")}</span>
        </button>
        <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost">
          <MessageCircle size={15} aria-hidden="true" />
          <span>{t("vendor.reviews.share_whatsapp")}</span>
        </a>
        <a href={mailtoUrl} className="btn-ghost">
          <Mail size={15} aria-hidden="true" />
          <span>{t("vendor.reviews.share_email")}</span>
        </a>
      </div>
    </div>
  );
}
