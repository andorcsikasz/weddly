# Incident and personal-data breach response

This runbook is operational, not a substitute for counsel. Every production
incident gets an incident ID, start time, named incident commander and a private
evidence folder. Do not paste personal data, access tokens or guest codes into
chat, tickets or logs.

## Severity and first actions

- **SEV-1:** confirmed/suspected data disclosure, account takeover, payment
  compromise, destructive database event, or total outage over 30 minutes.
  Page the incident commander immediately; stop the affected feature or put the
  service in maintenance mode; preserve logs/snapshots; notify counsel/security.
- **SEV-2:** material degradation, contained tenant leak, failed backup window,
  or high-risk vulnerability without evidence of exploitation. Respond within
  one hour and assign an owner and next update time.
- **SEV-3:** limited defect with a safe workaround. Track normally.

Never destroy evidence while containing an incident. Record every command and
external dashboard change with operator and UTC timestamp. Rotate compromised
credentials in this order: session/JWT secret and revoke sessions; admin/IdP;
database/storage; email; payment/webhooks; OAuth; analytics/observability. Use a
staged calendar-encryption-key rotation rather than changing `JWT_SECRET` until
stored Google tokens have been re-encrypted.

## Personal-data breach assessment

Within the first working session, document data categories, affected people and
tenants, volume, duration, likely consequences, containment and confidence.
Counsel/DPO decides whether GDPR supervisory notification is required and owns
the 72-hour clock, authority communication and any Art. 34 user notice. Preserve
the decision even when notification is not required. Use only verified facts;
do not promise deletion, recovery or scope before evidence supports it.

## Recovery and communications

Restore into an isolated environment first. Run `PRAGMA integrity_check`,
`PRAGMA foreign_key_check`, compare critical table counts and exercise login,
RSVP, exports and billing webhook idempotency before promoting data. Status
updates state impact, workaround and next update time—never speculation.

After containment, revoke temporary access, verify monitoring, write a blameless
timeline/root cause/corrective-action report, assign owners and dates, and test
the corrective controls. Run a tabletop twice yearly and after material vendor
or architecture changes.

## External contacts (release evidence)

The production evidence pack must name primary and backup incident commanders,
privacy counsel/DPO contact, Railway, Cloudflare/R2, Resend, Stripe, Sentry,
Google/Apple and cyber-insurance escalation paths. It must also record MFA and
break-glass custody. Do not commit personal phone numbers or credentials here.
