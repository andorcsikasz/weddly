# Company lookup & auto-fill (free registries only)

Business-profile auto-fill for planner onboarding and settings, backed
exclusively by free, official business-registry sources. No paid APIs, no
scraping, no data brokers. Countries without a free official source fall back
to manual entry; the profile fields always stay editable either way.

## Architecture

```
CountryCombobox (planner onboarding + settings)
  -> CompanyLookupBox (frontend/src/components/planner/CompanyLookupBox.tsx)
  -> companyLookupApi (frontend/src/lib/endpoints.ts)
  -> routes/company_lookup.ts   (auth + per-IP rate limit)
  -> lib/company_lookup/        (factory + one provider per country)
  -> shared/company_lookup.ts   (DTO contract)
```

The frontend contains zero registry logic. `GET /api/company-lookup/availability?country=XX`
reports whether a free source exists and which query kinds it resolves
(`name`, `tax_number`, `registry_number`); the lookup box renders from that
answer or renders nothing. Picking a result auto-fills business name, city,
registry number, VAT number, legal form and address on `users` (planner_*
columns), all of which remain hand-editable.

## Phase 1 sources (verified 2026-07)

| Country | Source | Auth | Search by | Notes |
|---|---|---|---|---|
| FR | API Recherche d'entreprises (DINUM, INSEE SIRENE + INPI data), `recherche-entreprises.api.gouv.fr` | none | name, SIREN, SIRET | ~7 req/s upstream limit; richest payload incl. VAT number |
| NL | KVK Handelsregister Open Dataset (CC BY 4.0), `opendata.kvk.nl` | none | KVK number only | Anonymised by design: no trade name, no address, 2-digit postcode region, BV/NV only. ~1 query/min upstream, absorbed by the 6h cache. The richer KVK Zoeken API costs EUR 6.40/month, out of free scope. |
| GR | GEMI Open Data API (ODC-BY-1.0), `opendata-api.businessportal.gr` | free API key | name, GEMI number, AFM | Key granted by the GEMI Authority: register at https://opendata.businessportal.gr/register/ and set `GEMI_API_KEY`. Unset key = manual entry. |
| HU | EU VIES REST API (European Commission), `ec.europa.eu/taxation_customs/vies` | none | tax number only | The HU company register has NO free API (programmatic access is a paid Ministry of Justice contract). The adószám's first 8 digits are the VAT base, so VIES returns the registered name + address. Name / cégjegyzékszám search stays manual. |
| BE | EU VIES REST API | none | enterprise number only | The CBE Public Search web service is pay-per-request (EUR 50 / 2000 requests). The BE enterprise number IS the VAT number, so VIES covers the identifier flow. Name search stays manual. |

Not supported in the free phase (manual entry only): ES, IT, DE, AT, PT, HR,
UK, US and everyone else. Their official access is paid, restricted, or has no
API. Adding a country later = one new provider file + one factory case; the
frontend needs no change.

## Rules baked into the code

- Lookups fire only on an explicit user search (`Search` button); endpoints
  are auth-gated and rate-limited (`COMPANY_LOOKUP_BUCKET`, 8 burst / ~15 per
  minute per IP) so they cannot be farmed as an anonymous registry proxy.
- Providers map only what the registry returns. Missing fields stay null;
  nothing is enriched from Google/LinkedIn/social scraping.
- Upstream failure = HTTP 502, and the UI suggests manual entry. Definitive
  answers (200/404) are cached in-memory for 6 hours (`lib/company_lookup/client.ts`).
- Tests never touch real registries: `COMPANY_LOOKUP_FAKE=1` (pinned in
  `backend/tests/setup.ts`) routes every provider through deterministic
  fixtures in `lib/company_lookup/fake.ts`. Coverage:
  `backend/tests/api/company_lookup.e2e.test.ts`.

## Env

| Var | Meaning |
|---|---|
| `GEMI_API_KEY` | Enables the Greece provider. Empty = GR reports manual entry. Pin a test value in tests/setup.ts if renamed. |
| `COMPANY_LOOKUP_FAKE` | `1` = fixture mode (test suite only, never set in prod). |
