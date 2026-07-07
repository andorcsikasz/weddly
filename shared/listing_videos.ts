// Vendor listing video embeds — the "reference reel" beside the photo gallery.
//
// YouTube is the only provider in v1, but the shape and the parser are
// deliberately provider-agnostic: adding Vimeo later is a new matcher in
// `PROVIDER_MATCHERS` plus a `case` in the three URL builders, with zero
// changes to the DB columns, the routes, or the React components. That's the
// "prepare the architecture so Vimeo drops in" requirement made concrete.
//
// The parser lives in `shared/` so the backend (input validation on POST/PATCH)
// and the frontend (live validation in the editor, embed/thumbnail rendering)
// share ONE definition of "what is a valid video link" — no drift.

/** Which platform a listing video lives on. YouTube (incl. Shorts) today;
 *  the union grows as `PROVIDER_MATCHERS` does. */
export type VideoProvider = "youtube";

/** One embedded video on a claimed listing, stored beside the photo gallery.
 *  `video_id` is the provider's opaque id (YouTube's 11-char id, Shorts
 *  included); `url` preserves exactly what the vendor pasted so the edit field
 *  round-trips their input. Embeds/thumbnails are ALWAYS derived from
 *  `provider` + `video_id`, never from `url`, so a hostile paste can't point an
 *  iframe or an <img> anywhere but the provider's own domain. */
export interface ListingVideo {
  id: number;
  provider: VideoProvider;
  video_id: string;
  url: string;
  /** 0-based display order. Vendors drag to reorder; the public grid honours it. */
  position: number;
}

/** Video cap per listing — enforced server-side, mirrored in the editor UI.
 *  Matches the "up to 6 videos" product requirement. */
export const MAX_LISTING_VIDEOS = 6;

/** The result of recognising a pasted link: which provider + the extracted id.
 *  Null from {@link parseVideoUrl} means "not a link we can embed". */
export interface ParsedVideo {
  provider: VideoProvider;
  video_id: string;
}

/** A provider matcher: given a trimmed URL, return the parsed id or null.
 *  Registered in {@link PROVIDER_MATCHERS}; the first non-null wins. */
type ProviderMatcher = (raw: string) => ParsedVideo | null;

/** YouTube ids are exactly 11 chars from this alphabet — Shorts share the shape. */
const YT_ID = "[A-Za-z0-9_-]{11}";

/** Ordered id extractors covering every public YouTube URL flavour: short
 *  links, Shorts, already-embed URLs, live permalinks, `watch?v=`, and the
 *  legacy `/v/` path. Each captures the 11-char id in group 1. */
const YT_EXTRACTORS: RegExp[] = [
  new RegExp(`youtu\\.be/(${YT_ID})`, "i"), // youtu.be/<id>
  new RegExp(`/shorts/(${YT_ID})`, "i"), // youtube.com/shorts/<id>
  new RegExp(`/embed/(${YT_ID})`, "i"), // youtube.com/embed/<id>
  new RegExp(`/live/(${YT_ID})`, "i"), // youtube.com/live/<id>
  new RegExp(`[?&]v=(${YT_ID})`, "i"), // youtube.com/watch?v=<id>
  new RegExp(`/v/(${YT_ID})`, "i"), // legacy youtube.com/v/<id>
];

/** Host gate: the string must reference a real YouTube host at a boundary
 *  (`//`, `.`, or start) so `notyoutube.com` and lookalikes don't slip through.
 *  We never navigate to the pasted URL — embeds are built from the id against a
 *  hardcoded host — but a tight gate keeps "is this a YouTube link" honest. */
const YT_HOST = /(?:^|\/\/|\.)(?:youtube\.com|youtu\.be|youtube-nocookie\.com)(?:$|[/:])/i;

const matchYouTube: ProviderMatcher = (raw) => {
  if (!YT_HOST.test(raw)) return null;
  for (const re of YT_EXTRACTORS) {
    const m = raw.match(re);
    if (m?.[1]) return { provider: "youtube", video_id: m[1] };
  }
  return null;
};

/** The provider registry. Add Vimeo by appending `matchVimeo` here. */
const PROVIDER_MATCHERS: ProviderMatcher[] = [matchYouTube];

/** Recognise a pasted video link. Returns the provider + id, or null when the
 *  string isn't an embeddable video URL. Trims first so trailing whitespace
 *  from a paste never trips it. */
export function parseVideoUrl(raw: string): ParsedVideo | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  for (const matcher of PROVIDER_MATCHERS) {
    const parsed = matcher(trimmed);
    if (parsed) return parsed;
  }
  return null;
}

/** Privacy-friendly embed URL for an <iframe src>. `youtube-nocookie.com`
 *  + `rel=0` + `modestbranding=1` strip the worst of the branding / related-
 *  video clutter (the "avoid unnecessary branding" requirement) while keeping
 *  the native controls. Any future provider adds its own branch. */
export function videoEmbedUrl(v: ParsedVideo, opts?: { autoplay?: boolean }): string {
  const autoplay = opts?.autoplay ? "&autoplay=1" : "";
  switch (v.provider) {
    case "youtube":
      return `https://www.youtube-nocookie.com/embed/${v.video_id}?rel=0&modestbranding=1&playsinline=1${autoplay}`;
  }
}

/** Poster thumbnail for the click-to-play state. `hqdefault.jpg` (480×360)
 *  exists for every YouTube video (unlike `maxresdefault`), so it never 404s
 *  into a broken image. Served from img.youtube.com (whitelisted in the CSP). */
export function videoThumbnailUrl(v: ParsedVideo): string {
  switch (v.provider) {
    case "youtube":
      return `https://img.youtube.com/vi/${v.video_id}/hqdefault.jpg`;
  }
}

/** Canonical "open on the platform" URL — built from the id, never the raw
 *  paste, so it's always a safe, well-formed link. */
export function videoWatchUrl(v: ParsedVideo): string {
  switch (v.provider) {
    case "youtube":
      return `https://www.youtube.com/watch?v=${v.video_id}`;
  }
}
