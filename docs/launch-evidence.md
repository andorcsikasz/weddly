# Launch evidence register

Code being green is necessary but not sufficient. Every row below needs a dated
artifact, owner and approver. A link to this file or an unchecked checklist is
not evidence.

## Paid/legal gate

- registered operator identity, Ektv. §4 imprint fields and complaint contacts;
- accountant approval for NAV invoicing, VAT/OSS, bank and Stripe merchant data;
- Hungarian/EU counsel approval for couple, planner and vendor terms, pricing,
  renewal/cancellation/refund/withdrawal and checkout button wording;
- signed provider register: role, region, DPA/controller terms, retention,
  DPF/SCC/TIA where applicable;
- exact rendered HU/EN policy archive and versioned clickwrap/checkout receipts;
- written decisions for Hungary-only versus cross-border targeting, minors,
  special-category guest data, DSA classification, EAA exemption/conformance and
  AI Act measures.

Only after approval may production set `LEGAL_PAID_LAUNCH_APPROVED=1`; each
payment product still requires its independent audited launch switch and live
Stripe preflight.

## Security/operations gate

- branch protection and required CI checks captured from GitHub;
- MFA/access review for GitHub, Railway, Stripe, Resend, R2, Sentry and IdPs;
- production variables reviewed without copying secret values;
- dependency, secret, container and SAST reports with findings resolved/accepted;
- successful encrypted backup restore and forced-failure alert drill;
- production health, TLS/header, storage-capacity, stop/recovery and rollback
  drill with measured RTO/RPO;
- incident-response tabletop and named on-call contacts;
- Cookiebot reject/accept/withdraw network-and-storage recordings proving no
  optional analytics executes before statistics consent;
- Google OAuth verification and Apple private-relay sender configuration when
  those features are enabled.

Release sign-off is invalid if any artifact is stale relative to the deployed
commit or current vendor configuration.
