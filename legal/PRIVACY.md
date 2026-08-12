# Privacy notice source of truth

This repository does not maintain a second Markdown privacy policy. The served,
versioned bilingual notice is the canonical product text:

- content: `frontend/src/locales/en.ts` and `frontend/src/locales/hu.ts`, under `privacy`
- rendering: `frontend/src/pages/PrivacyPage.tsx`
- acceptance/version identifier: `PRIVACY_VERSION` in `shared/legal.ts`

Any user-visible change must update both languages and bump the version. The
release evidence pack must archive the exact rendered documents and retain the
matching acceptance ledger. Provider contracts, transfer safeguards, retention
configuration and counsel approval are operational evidence and must not be
asserted merely because a provider appears in source code.
