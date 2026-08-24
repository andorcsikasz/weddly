// The community up/downvote pill on a directory card stays hidden until the
// listing has VOTE_MIN_REVIEWS published reviews — a handful of votes on a
// business nobody has reviewed reads as a verdict, not a signal. See
// shared/suppliers.ts VOTE_MIN_REVIEWS.

import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import type { DirectorySupplier } from "@shared/suppliers";
import { VOTE_MIN_REVIEWS } from "@shared/suppliers";
import { VoteRow } from "@/pages/SuppliersPage";

const t = (key: string) => key;

function makeSupplier(over: Partial<DirectorySupplier> = {}): DirectorySupplier {
  return {
    id: "s1",
    name: "Foto One",
    category: "photography",
    city: "Budapest",
    country: "HU",
    blurb_hu: "",
    blurb_en: "",
    website: "",
    contact_email: null,
    contact_phone: null,
    has_contact_email: false,
    has_contact_phone: false,
    address: null,
    capacity_min: null,
    capacity_max: null,
    venue_style: null,
    lat: null,
    lng: null,
    source: "curated",
    submitter_type: null,
    price_band: 2,
    vendor_account_id: null,
    hero_image_url: null,
    gallery_urls: null,
    votes_score: 3,
    user_vote: 0,
    listing_complete: false,
    reviews_count: 0,
    ...over,
  };
}

describe("<VoteRow>", () => {
  it("renders nothing below VOTE_MIN_REVIEWS", () => {
    const { container } = render(
      <VoteRow
        supplier={makeSupplier({ reviews_count: VOTE_MIN_REVIEWS - 1 })}
        onVote={() => {}}
        t={t}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the pill at exactly VOTE_MIN_REVIEWS reviews", () => {
    const { getByText } = render(
      <VoteRow
        supplier={makeSupplier({ reviews_count: VOTE_MIN_REVIEWS, votes_score: 3 })}
        onVote={() => {}}
        t={t}
      />,
    );
    expect(getByText("3")).toBeTruthy();
  });

  it("renders above VOTE_MIN_REVIEWS too", () => {
    const { getByText } = render(
      <VoteRow
        supplier={makeSupplier({ reviews_count: VOTE_MIN_REVIEWS + 50, votes_score: 1 })}
        onVote={() => {}}
        t={t}
      />,
    );
    expect(getByText("1")).toBeTruthy();
  });
});
