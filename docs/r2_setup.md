# Cloudflare R2 storage — operator setup

Weddly can store uploads (couple photos, moodboard, blog covers, vendor hero
images, couple/honeymoon covers, budget documents, vendor-waitlist price lists)
and periodic SQLite backups in Cloudflare R2 instead of the local `/data`
volume. The app picks R2 automatically once the env vars below are set; until
then it uses local disk with no behaviour change.

The code is already wired (`backend/src/lib/storage.ts`, `domain/backup.ts`).
What remains is account/dashboard work that only an account owner can do.

## 1. Enable R2 (one-time, dashboard)

R2 is not active on the account yet — the API returns *"Please enable R2 through
the Cloudflare Dashboard"* and the account S3 endpoint fails its TLS handshake
until it's provisioned.

1. Cloudflare Dashboard → **R2** → **Enable R2** (requires a payment method;
   there is a generous free tier).
2. Create a bucket, e.g. **`weddly-uploads`**. Optionally a second bucket
   **`weddly-backups`** for DB snapshots (otherwise backups land under a
   `backups/` prefix in the uploads bucket).

## 2. S3 credentials

The app talks to R2 over the S3 API. Use an **R2 API token** (R2 → *Manage API
Tokens* → *Create*), which yields:

- **Access Key ID** — used as `R2_ACCESS_KEY_ID`
- **Secret Access Key** — used as `R2_SECRET_ACCESS_KEY`
- the account **S3 endpoint** `https://<account-id>.r2.cloudflarestorage.com` —
  used as `R2_ENDPOINT`

Give the token **Object Read & Write** on the bucket(s).

## 3. Railway env vars

Set these on the Railway service (never commit them):

| Var | Required | Example / default |
|---|---|---|
| `R2_ENDPOINT` | yes | `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | yes | (from the R2 token) |
| `R2_SECRET_ACCESS_KEY` | yes | (from the R2 token) |
| `R2_BUCKET` | yes | `weddly-uploads` |
| `R2_BACKUP_BUCKET` | no | `weddly-backups` (falls back to `R2_BUCKET`) |
| `R2_BACKUP_INTERVAL_HOURS` | no | `24` (set `0` to disable backups) |
| `R2_BACKUP_RETENTION` | no | `14` |

All four of the first group must be present, or the app silently stays on local
disk (`R2_ENABLED` is false). Redeploy after setting them.

## 4. Migrating existing files

Switching the env vars makes **new** uploads go to R2; files already on the
`/data` volume are NOT copied automatically. To move them, do a one-time sync
of `/data/uploads/` into the bucket (preserving the relative paths as keys),
e.g. with `rclone` configured against the R2 S3 endpoint:

```
rclone copy /data/uploads/ r2:weddly-uploads/ --s3-no-check-bucket
```

Keys must mirror the on-disk layout exactly (`couples/…`, `blog/…`,
`listings/…`, `vendor_waitlist/…`, `destination-photos/…`) so the existing
`/uploads/<key>` URLs resolve. Verify a few URLs, then the `/data` upload files
can be removed.

## 5. Verify

- Upload a new image in the app and confirm it serves at its `/uploads/...` URL
  (the request is streamed from R2 through the app, same URL as before).
- Check the bucket for the new object, and (after `R2_BACKUP_INTERVAL_HOURS`,
  or the ~30s boot run) for a `backups/weddly-<timestamp>.db` snapshot.
- Logs: `backup.uploaded` / `backup.pruned` confirm the backup loop.
