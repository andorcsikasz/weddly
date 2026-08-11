import { describe, expect, test } from "bun:test";
import { formatInvoiceAmount } from "@/pages/vendor/VendorBillingPage";

describe("vendor invoice amount formatting", () => {
  test("treats HUF invoice charges as two-decimal Stripe amounts", () => {
    const formatted = formatInvoiceAmount(249_000, "huf", "hu");

    expect(formatted.startsWith("2490")).toBe(true);
    expect(formatted.startsWith("249000")).toBe(false);
  });

  test("keeps true zero-decimal charge currencies in whole units", () => {
    expect(formatInvoiceAmount(2_490, "jpy", "en")).toContain("2,490");
  });
});
