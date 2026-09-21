// "See my page as a couple sees it", for the vendor. The couple-facing vendor
// page itself, mounted under the vendor shell in read-only preview mode: same
// data, same layout, none of the couple's actions.
//
// It exists because the public page is now a locked teaser (it shows no
// packages, prices or contact), so it can no longer answer "what do couples
// see?". `/app/suppliers/:id` is behind the couple guard and bounces a vendor,
// so the preview lives here and resolves the vendor's own listing id itself.

import { useEffect, useState } from "react";
import { Skeleton } from "../../components/ui";
import { vendorListingApi } from "../../lib/endpoints";
import SupplierDetailPage from "../SupplierDetailPage";

export default function VendorProfilePreviewPage() {
  const [listingId, setListingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    vendorListingApi
      .me()
      .then((view) => {
        if (!cancelled) setListingId(view.listing.id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (listingId === null) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 xl:px-10">
        <Skeleton className="mb-4 h-8 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  return <SupplierDetailPage previewId={listingId} />;
}
