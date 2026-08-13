# Cloudflare R2 storage — operator setup

Weddly can store uploads (couple photos, moodboard, blog covers, vendor hero
images, couple/honeymoon covers, budget documents, vendor-waitlist price lists)
in Cloudflare R2 instead of the local `/data` volume. The application backup
worker stores encrypted SQLite snapshots in a separate R2 bucket. Uploads
remain on local disk until the web-service R2 variables below are set.

The upload code is wired in `backend/src/lib/storage.ts`; the backup worker is
in `backend/src/domain/backup.ts`. What remains is account/dashboard work that
only an account owner can do.

## 1. Enable R2 (one-time, dashboard)

R2 is not active on the account yet — the API returns *"Please enable R2 through
the Cloudflare Dashboard"* and the account S3 endpoint fails its TLS handshake
until it's provisioned.

1. Cloudflare Dashboard → **R2** → **Enable R2** (requires a payment method;
   there is a generous free tier).
2. Create distinct **`weddly-uploads`** and **`weddly-backups`** buckets.

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

Configure the `OFFSITE_BACKUP_*` variables from `.env.example` on the web
service using a second token scoped only to `weddly-backups`. Railway volumes
cannot be shared between services, so the online SQLite snapshot runs inside
the app and encrypts before upload. Follow `docs/backup-restore-runbook.md`.

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
- Check the upload bucket for the new object.
- For encrypted database backups, verify the worker heartbeat and perform the
  restore drill in `docs/backup-restore-runbook.md`.
