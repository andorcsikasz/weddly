import "../setup";

import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { BookingMessage } from "@shared/booking_messages";
import type { VendorClientView } from "@shared/vendor_clients";
import { BookingThreadPanel } from "@/components/BookingThreadPanel";
import { NextActionBar, scrollToActionTarget } from "@/components/VendorNextAction";
import { ToastProvider } from "@/components/ui";
import { I18nProvider } from "@/lib/i18n";

const CLIENT: VendorClientView = {
  id: 188,
  couple_id: 10,
  couple_display_name: "Andor & Sári",
  event_date: "2027-05-29",
  status: "confirmed",
  stage: null,
  contract_value: null,
  deposit_paid: null,
  balance: null,
  created_at: Date.now(),
  unread_count: 0,
  vendor_seen_at: Date.now(),
  next_action: "record_contract",
  attention: null,
  attention_snoozed_until: null,
};

const MESSAGE: BookingMessage = {
  id: 1,
  booking_id: 188,
  sender_kind: "couple",
  body: "Is the date available?",
  status: "seen",
  sent_at: Date.now(),
  delivered_at: Date.now(),
  seen_at: Date.now(),
  attachments: [],
};

function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <ToastProvider>{children}</ToastProvider>
    </I18nProvider>
  );
}

describe("vendor client UX regressions", () => {
  it("focuses the contract field instead of the first control in the CRM section", () => {
    const scrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = () => undefined;
    try {
      document.body.innerHTML = `
        <section id="vc-crm">
          <select id="vc-status"><option>Confirmed</option></select>
          <input id="vc-contract" />
        </section>`;

      scrollToActionTarget("vc-contract");

      expect(document.activeElement?.id).toBe("vc-contract");
    } finally {
      HTMLElement.prototype.scrollIntoView = scrollIntoView;
    }
  });

  it("uses action wording on the contract CTA instead of repeating the heading", () => {
    localStorage.setItem("weddly.locale", "en");
    render(<NextActionBar client={CLIENT} />, { wrapper: Providers });

    expect(screen.getByText("Record the agreed price")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enter price/i })).toBeInTheDocument();
  });

  it("keeps the conversation in page flow and gives the composer a stable name", () => {
    localStorage.setItem("weddly.locale", "en");
    render(
      <BookingThreadPanel
        side="vendor"
        messages={[MESSAGE]}
        loading={false}
        onSend={async () => undefined}
      />,
      { wrapper: Providers },
    );

    const thread = screen.getByRole("list");
    expect(thread.className).not.toContain("overflow-y-auto");
    expect(thread.className).not.toContain("max-h-");
    expect(screen.getByRole("textbox", { name: "Write a message" })).toBeInTheDocument();
  });
});
