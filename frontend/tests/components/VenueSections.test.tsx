import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { emptyVenueProfile, type VenueDetail, type VenuePricingRule } from "@shared/venue";
import en from "@/locales/en";
import {
  VenueOverviewSection,
  VenueRatesSection,
  VenueRulesSection,
} from "@/components/VenueSections";

const t = (key: string, vars?: Record<string, string | number>) => {
  let node: unknown = en;
  for (const part of key.split(".")) node = (node as Record<string, unknown>)?.[part];
  let out = typeof node === "string" ? node : key;
  for (const [name, value] of Object.entries(vars ?? {})) {
    out = out.replaceAll(`{${name}}`, String(value));
  }
  return out;
};

const peak: VenuePricingRule = {
  id: 1,
  name: "Peak season",
  start_month: 5,
  end_month: 9,
  days: ["saturday"],
  min_guests: 100,
  max_guests: null,
  min_spend: null,
  available: true,
  position: 0,
  updated_at: 0,
  items: [
    {
      key: "venue_rental",
      label: null,
      mode: "fixed",
      amount: 650000,
      quantity: null,
      optional: false,
    },
    {
      key: "catering",
      label: null,
      mode: "per_guest",
      amount: 30990,
      quantity: null,
      optional: false,
    },
    { key: "drinks", label: null, mode: "included", amount: null, quantity: null, optional: false },
    {
      key: "ceremony_location",
      label: null,
      mode: "free",
      amount: null,
      quantity: null,
      optional: false,
    },
  ],
};

function venue(over: Partial<VenueDetail> = {}): VenueDetail {
  return {
    profile: emptyVenueProfile(),
    spaces: [],
    pricing_rules: [peak],
    currency: "HUF",
    country: "HU",
    ...over,
  };
}

describe("VenueRatesSection", () => {
  it("warns before the couple writes when their headcount is under the rule's minimum", () => {
    render(
      <VenueRatesSection
        id="rates"
        venue={venue()}
        initialDate="2026-06-13"
        initialGuests={79}
        locale="en"
        t={t}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("at least 100 guests");
    expect(screen.getByText("Included")).toBeTruthy();
    expect(screen.getByText("Free")).toBeTruthy();
    expect(screen.getByText("Estimated total")).toBeTruthy();
  });

  it("hands the priced date, headcount and rule to the offer request", () => {
    let got: unknown = null;
    render(
      <VenueRatesSection
        id="rates"
        venue={venue()}
        initialDate="2026-06-13"
        initialGuests={120}
        locale="en"
        t={t}
        onRequest={(r) => {
          got = r;
        }}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Request an offer" }));
    expect(got).toMatchObject({ date: "2026-06-13", guests: 120, rule: "Peak season" });
  });

  it("renders nothing without pricing rules", () => {
    const { container } = render(
      <VenueRatesSection
        id="rates"
        venue={venue({ pricing_rules: [] })}
        initialDate={null}
        initialGuests={null}
        locale="en"
        t={t}
      />,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("unanswered venue facts render nothing", () => {
  it("draws no overview and no rules section for an empty profile", () => {
    const { container } = render(
      <>
        <VenueOverviewSection id="v" venue={venue()} currency="HUF" locale="en" t={t} />
        <VenueRulesSection id="r" venue={venue()} t={t} />
      </>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("names the catering rule the vendor chose", () => {
    const profile = { ...emptyVenueProfile(), catering: ["in_house_required" as const] };
    render(<VenueRulesSection id="r" venue={venue({ profile })} t={t} />);
    expect(screen.getByText("In-house catering required")).toBeTruthy();
  });
});
