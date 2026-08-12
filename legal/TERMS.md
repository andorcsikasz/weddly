# Terms source of truth

The canonical, versioned bilingual user terms are served from:

- content: `frontend/src/locales/en.ts` and `frontend/src/locales/hu.ts`, under `terms`
- rendering: `frontend/src/pages/TermsPage.tsx`
- acceptance/version identifier: `TERMS_VERSION` in `shared/legal.ts`

Vendor subscription terms are the `subscription_terms` locale documents and
their dedicated route. Paid couple, planner and vendor products must remain
disabled until counsel-approved terms, checkout disclosures, withdrawal and
cancellation handling, invoicing/tax setup and exact-version acceptance evidence
are complete. Production enforces this independently with
`LEGAL_PAID_LAUNCH_APPROVED=1` in addition to the per-product launch controls.
