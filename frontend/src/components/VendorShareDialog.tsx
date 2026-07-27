// "Share my profile" dialog behind the header's share icon. Wraps the same
// VendorShareSheet the Vélemények page uses, pointed at the plain public
// profile URL rather than the `?review=1` composer: forwarding the page to a
// couple, a venue or an Instagram bio is a different job from asking a past
// client for a review, and it was the one with nowhere to live.

import { vendorPublicId } from "@shared/vendor_slug";
import { useT } from "../lib/i18n";
import { Dialog } from "./ui/Dialog";
import { VendorShareSheet } from "./VendorShareSheet";

export function VendorShareDialog({
  open,
  onClose,
  listingId,
  listingName,
}: {
  open: boolean;
  onClose: () => void;
  listingId: string;
  listingName: string;
}) {
  const { t, locale } = useT();
  const url = `${window.location.origin}/vendors/${vendorPublicId(listingId, listingName)}`;
  const message =
    locale === "hu"
      ? `Itt találsz meg minket a Weddlyn: ${url}`
      : `Here's where you can find us on Weddly: ${url}`;
  const subject = locale === "hu" ? listingName : listingName;

  return (
    <Dialog open={open} onClose={onClose} title={t("vendor.share.title")} role="dialog" size="lg">
      <VendorShareSheet
        url={url}
        message={message}
        subject={subject}
        label={t("vendor.share.title")}
        lead={<p className="text-sm text-ink-600 dark:text-paper-300">{t("vendor.share.body")}</p>}
      />
    </Dialog>
  );
}
