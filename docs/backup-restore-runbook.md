# Backup and restore release gate

Railway volumes belong to one service and cannot be shared with an independent
cron service. The production design therefore uses two complementary layers:

1. Railway native daily/weekly/monthly volume backups for fast same-project
   recovery of the app volume.
2. Weddly's in-process SQLite online snapshot worker for encrypted, off-site R2
   copies. It uses `VACUUM INTO`, verifies `PRAGMA integrity_check`, encrypts
   with AES-256-GCM before upload, uses a dedicated bucket credential, and pings
   an external missed-run monitor.

The off-site encryption key must remain outside Railway, R2 and database
backups. Keep the first `OFFSITE_BACKUP_ENCRYPTION_KEYS` entry active for new
snapshots and retain older entries until all snapshots using them have expired.
Deleting a Railway volume deletes its native backups, so native backups alone
are not an off-site recovery strategy.

Required production evidence:

- Railway volume backups enabled with documented daily/weekly/monthly retention;
- dedicated R2 backup bucket with versioning/lifecycle protection and a token
  scoped only to that bucket;
- complete `OFFSITE_BACKUP_*` configuration and successful Healthchecks ping;
- upload/media bucket versioning or replication policy;
- documented RPO/RTO, named primary and backup operator;
- one successful isolated restore and one failed-run paging drill.

## Restore an encrypted off-site snapshot

1. Download the newest `prod/weddly-*.db.aes256gcm` object and record its object
   version, size, and timestamp.
2. On an isolated machine, set `OFFSITE_BACKUP_ENCRYPTION_KEYS` to the keyring
   containing the object's key id.
3. Run:

   ```sh
   cd backend
   bun run scripts/decrypt-backup.ts /path/to/weddly.db.aes256gcm /tmp/restored.db
   sqlite3 /tmp/restored.db 'PRAGMA integrity_check; PRAGMA foreign_key_check;'
   ```

4. Never overwrite production during a drill. Open the restored DB in an
   isolated service with outbound email, Stripe, OAuth and analytics disabled.
5. Compare critical row counts (`users`, `couples`, `guests`, bookings,
   acceptance and audit tables) with the source environment at snapshot time.
6. Exercise login, guest RSVP, JSON/CSV export and representative uploaded
   objects. Record start/end time, achieved RPO/RTO, operator and follow-ups.
7. Remove the temporary plaintext copy using the host's supported secure
   disposal process.

Quarterly, force the backup worker to fail by temporarily using invalid backup
bucket credentials in a non-production drill environment and prove the alert
reaches both responders. Paid/public launch remains blocked until the release
evidence pack contains a successful restore and alert-delivery drill.
