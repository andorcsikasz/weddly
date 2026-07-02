// Hungary + Belgium via the EU VIES REST API (European Commission, official,
// free, no key). VIES validates a VAT number and, for HU and BE, returns the
// registered name and address, which is exactly what the profile auto-fill
// needs.
//
// Why VIES and not the national registries:
//   - HU: the company register (Céginformációs Szolgálat) has no free API;
//     programmatic access is a paid Ministry of Justice contract. The HU tax
//     number's first 8 digits ARE the VAT base, so a tax-number lookup via
//     VIES covers the common "type your adószám" flow.
//   - BE: the CBE Public Search web service is pay-per-request (EUR 50 per
//     2000). The Belgian enterprise number IS the VAT number, so an
//     enterprise-number lookup via VIES covers the identifier flow.
// Name search stays unsupported for both; the UI keeps manual entry open.
//
// Fair use: one call per explicit user search, never bulk. Endpoint:
// https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number

import type { CompanyLookupResult } from "@shared/company_lookup";
import { lookupJson } from "./client";
import type { CompanyLookupProvider } from "./types";

const VIES_URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";

interface ViesResponse {
  valid?: boolean;
  name?: string;
  address?: string;
}

/** VIES masks some fields as "---"; treat that as absent. */
function cleanField(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s || s === "---") return null;
  return s.replace(/\s*\n\s*/g, ", ");
}

async function checkVat(
  countryCode: "HU" | "BE",
  vatNumber: string,
  displayNumber: string,
  sourceName: string,
): Promise<CompanyLookupResult[] | null> {
  const answer = await lookupJson(VIES_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ countryCode, vatNumber }),
  });
  if (!answer || answer.status !== 200 || !answer.body || typeof answer.body !== "object") {
    return null;
  }
  const body = answer.body as ViesResponse;
  if (body.valid !== true) return [];
  return [
    {
      id: `${countryCode}${vatNumber}`,
      country: countryCode,
      source_name: sourceName,
      name: cleanField(body.name),
      registry_number: countryCode === "BE" ? displayNumber : null,
      vat_number: `${countryCode}${vatNumber}`,
      legal_form: null,
      address: cleanField(body.address),
      city: null,
      postal_code: null,
      region: null,
      status: "active",
      activity: null,
      registration_date: null,
    },
  ];
}

/** HU tax number ("adószám", 12345678-1-02 or just the 8-digit base) to the
 *  VIES VAT base. Null when the input is not a plausible tax number. */
function huVatBase(query: string): string | null {
  const digits = query.replace(/[\s-]/g, "");
  if (!/^\d{8}(\d{3})?$/.test(digits)) return null;
  return digits.slice(0, 8);
}

/** BE enterprise number (0123.456.749, BE0123456749 or bare digits) to the
 *  10-digit VIES form. Accepts the legacy 9-digit form with a leading 0. */
function beEnterpriseNumber(query: string): string | null {
  const digits = query.replace(/^be/i, "").replace(/[\s.-]/g, "");
  if (/^\d{9}$/.test(digits)) return `0${digits}`;
  if (/^[01]\d{9}$/.test(digits)) return digits;
  return null;
}

const HU_SOURCE = "EU VIES VAT registry (European Commission)";

export const hungaryProvider: CompanyLookupProvider = {
  countryCode: "HU",
  sourceName: HU_SOURCE,
  isFree: true,
  searchKinds: ["tax_number"],
  async search(query: string): Promise<CompanyLookupResult[] | null> {
    const base = huVatBase(query.trim());
    if (!base) return [];
    return checkVat("HU", base, base, HU_SOURCE);
  },
  async getCompany(id: string): Promise<CompanyLookupResult | null> {
    const base = huVatBase(id.replace(/^HU/i, ""));
    if (!base) return null;
    const r = await checkVat("HU", base, base, HU_SOURCE);
    return r?.[0] ?? null;
  },
};

const BE_SOURCE = "EU VIES VAT registry (European Commission)";

export const belgiumProvider: CompanyLookupProvider = {
  countryCode: "BE",
  sourceName: BE_SOURCE,
  isFree: true,
  searchKinds: ["registry_number"],
  async search(query: string): Promise<CompanyLookupResult[] | null> {
    const num = beEnterpriseNumber(query.trim());
    if (!num) return [];
    const display = `${num.slice(0, 4)}.${num.slice(4, 7)}.${num.slice(7)}`;
    return checkVat("BE", num, display, BE_SOURCE);
  },
  async getCompany(id: string): Promise<CompanyLookupResult | null> {
    const num = beEnterpriseNumber(id);
    if (!num) return null;
    const display = `${num.slice(0, 4)}.${num.slice(4, 7)}.${num.slice(7)}`;
    const r = await checkVat("BE", num, display, BE_SOURCE);
    return r?.[0] ?? null;
  },
};
