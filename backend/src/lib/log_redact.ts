// Redact high-entropy credential segments from a URL path before it is written
// to request logs or attached to Sentry. Many routes carry a single-use or
// long-lived capability token IN THE PATH (email verify/change, photo-album
// view+upload links, planner activation, couple + vendor invites, listing
// claim, email opt-out). Those log lines are forwarded to a third-party log
// service, so an un-consumed token in a log line is a replayable credential.
//
// Rather than an allowlist of known token routes (which a newly added route can
// silently escape), this masks ANY path segment that looks like a minted token:
// 24+ characters drawn only from the token alphabet (hex / base64url, plus `.`
// for the `<id>.<hmac>` opt-out shape). Route SHAPE is preserved — the endpoint
// is still identifiable — only the secret segment becomes `[token]`. Ordinary
// slugs, numeric ids, and short check-in codes are well under the threshold and
// pass through unchanged.

const TOKEN_SEGMENT = /^[A-Za-z0-9._-]{24,}$/;

export function redactTokensInPath(pathname: string): string {
  if (!pathname.includes("/")) return pathname;
  return pathname
    .split("/")
    .map((seg) => (TOKEN_SEGMENT.test(seg) ? "[token]" : seg))
    .join("/");
}
