# Backup and restore release gate

Production backup is a separate failure domain from the web process. Do not
claim recoverability based only on the in-process R2 snapshot worker.

Required production design:

- independent scheduled service/image with SQLite online backup or `.backup`;
- `PRAGMA integrity_check` before upload and after restore;
- age encryption before data leaves the volume, with the decryption key outside
  Railway, R2 and database backups;
- separate least-privilege backup bucket credentials, object versioning or
  immutability, and documented retention;
- success heartbeat, missed-run and failure paging; uploads/media protected by
  their own replication/versioning policy;
- documented RPO/RTO and named operator.

Monthly restore drill:

1. Select the newest completed encrypted snapshot and record object version,
   size and checksum.
2. Restore into an isolated temporary service; never overwrite production.
3. Decrypt, open SQLite and run `PRAGMA integrity_check` and
   `PRAGMA foreign_key_check`.
4. Compare critical row counts (`users`, `couples`, `guests`, bookings,
   acceptance and audit tables) with the backup manifest.
5. Exercise login, guest RSVP, JSON/CSV export and representative uploaded
   objects without sending email or contacting Stripe.
6. Record start/end time, achieved RPO/RTO, operator, result and follow-ups.
7. Destroy the temporary plaintext copy using the platform's supported
   recoverable/verified process.

Quarterly, force one scheduled backup to fail and prove the page reaches both
primary and backup responders. Paid/public launch is blocked until one successful
restore and one alert-delivery drill are attached to the release evidence pack.
