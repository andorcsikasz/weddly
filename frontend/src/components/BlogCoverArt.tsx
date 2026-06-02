// Default blog cover art. Every post has a topical Unsplash photo as
// the background (DEFAULT_PHOTO_BY_SLUG) overlaid with the Wēddly
// wordmark and a content-themed lucide icon so the feed reads as a
// series of editorial covers from the same publication. Admin uploads
// override the default; the overlay still renders on top so the brand
// stays consistent across user-supplied imagery too.
//
// If no bgUrl resolves (unknown slug + no upload), falls back to the
// original paper composition so the layout never breaks.

import {
  BookOpen,
  CalendarCheck,
  CalendarDays,
  Castle,
  ClipboardCheck,
  Gem,
  Heart,
  Landmark,
  LayoutGrid,
  type LucideIcon,
  Mail,
  MailCheck,
  Mountain,
  Quote,
  Users,
  Wallet,
} from "lucide-react";
import { useId } from "react";

/** Per-slug content icon. Each post gets a lucide glyph that hints at
 *  the topic so the cover isn't purely photographic. Unknown slugs fall
 *  back to a generic glyph (Heart) so the layout never breaks. */
const ICON_BY_SLUG: Record<string, LucideIcon> = {
  "miert-hazasodunk-a-biblia-szerint": BookOpen,
  "bibliai-idezetek-eskuvore": Quote,
  "eskuvoi-koltsegvetes-keszitese": Wallet,
  "eskuvoi-vendeglista-keszitese": Users,
  "eskuvoi-hagyomanyok-praktikusan": Gem,
  "eskuvoi-szertartas-menete": Heart,
  "eskuvoi-ultetesi-rend-keszitese": LayoutGrid,
  "eskuvoi-rsvp-kerdesek": MailCheck,
  "eskuvoi-ugyintezes-lepesrol-lepesre": ClipboardCheck,
  "eskuvoszervezesi-checklist-12-honapra": CalendarDays,
  "eskuvoszervezesi-checklist-6-honapra": CalendarCheck,
  "digitalis-eskuvoi-meghivo-vagy-papir-meghivo": Mail,
  "where-to-get-married-in-hungary": Landmark,
  "where-to-get-married-in-austria": Mountain,
  "where-to-get-married-in-slovakia": Castle,
};

/** Topical Unsplash photo per post slug. Aesthetic is "wedding
 *  ceremony, church, light, romantic" — every photo is soft-lit,
 *  airy, neutral-palette editorial wedding work. Each URL was
 *  visually inspected from its bytes (not just URL-verified) so the
 *  content matches what the slug says. Admin uploads override these
 *  via cover_image_url; the URL here is only used when no upload
 *  exists for a post. */
export const DEFAULT_PHOTO_BY_SLUG: Record<string, string> = {
  // Theology of marriage: a couple's hands clasped across a table, one
  // wedding ring visible. Reads as the covenant the post is about.
  "miert-hazasodunk-a-biblia-szerint":
    "https://images.unsplash.com/photo-1604881991720-f91add269bed?w=1200&auto=format&fit=crop&q=75",
  // Bible verses: open Bible turned to Jeremiah, hand on the page. The
  // post is about scripture, so the cover shows scripture literally.
  "bibliai-idezetek-eskuvore":
    "https://images.unsplash.com/photo-1504052434569-70ad5836ab65?w=1200&auto=format&fit=crop&q=75",
  // Budget: hands stacking coins. No face. The literal motion of
  // counting money lines up with budget planning.
  "eskuvoi-koltsegvetes-keszitese":
    "https://images.unsplash.com/photo-1633158829585-23ba8f7c8caf?w=1200&auto=format&fit=crop&q=75",
  // Guest list: hand-addressed forest-green wedding envelope with white
  // calligraphy, nib pen, blush ribbon, pinecone. Reads as the act of
  // writing the list — quieter and more editorial than a tablescape.
  "eskuvoi-vendeglista-keszitese":
    "https://images.unsplash.com/photo-1537843147573-84a454793cf6?w=1200&auto=format&fit=crop&q=75",
  "eskuvoi-hagyomanyok-praktikusan":
    "https://images.unsplash.com/photo-1606800052052-a08af7148866?w=1200&auto=format&fit=crop&q=75",
  // Ceremony walkthrough: empty wooden church pews with warm window-
  // light raking across a stone floor. No staging, no florals, no
  // crowd — light does the work. Editorial alternative to the earlier
  // saturated outdoor-altar shot the user flagged as kitsch.
  "eskuvoi-szertartas-menete":
    "https://images.unsplash.com/photo-1552600552-4d7c157e7db8?w=1200&auto=format&fit=crop&q=75",
  "eskuvoi-ultetesi-rend-keszitese":
    "https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=1200&auto=format&fit=crop&q=75",
  // RSVP: a single envelope on a dark surface. RSVP cards live inside
  // envelopes, so the cover reads correspondence-first.
  "eskuvoi-rsvp-kerdesek":
    "https://images.unsplash.com/photo-1649019489428-70f505daacd6?w=1200&auto=format&fit=crop&q=75",
  // Paperwork: fountain-pen nib mid-stroke on handwritten paper.
  // Hand-less close-up reads as signing a document.
  "eskuvoi-ugyintezes-lepesrol-lepesre":
    "https://images.unsplash.com/photo-1455390582262-044cdead277a?w=1200&auto=format&fit=crop&q=75",
  // 12-month checklist: open yearly planner with months listed top to
  // bottom and a rose-gold pen. Reads "year-out planning" at a glance.
  "eskuvoszervezesi-checklist-12-honapra":
    "https://images.unsplash.com/photo-1541140911322-98afe66ea6da?w=1200&auto=format&fit=crop&q=75",
  // 6-month checklist: a hand filling out a checkbox list with a pen.
  // Visually different from #12-honapra so the feed doesn't repeat.
  "eskuvoszervezesi-checklist-6-honapra":
    "https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=1200&auto=format&fit=crop&q=75",
  // Digital vs paper invitation: full paper-invitation flat-lay with
  // envelope, wax stamp, vintage postage stamps, ranunculus. Anchors
  // the "paper" half of the topic.
  "digitalis-eskuvoi-meghivo-vagy-papir-meghivo":
    "https://images.unsplash.com/photo-1721176487015-5408ae0e9bc2?w=1200&auto=format&fit=crop&q=75",
  "where-to-get-married-in-hungary":
    "https://images.unsplash.com/photo-1633895365999-20d132bf9319?w=1200&auto=format&fit=crop&q=75",
  "where-to-get-married-in-austria":
    "https://images.unsplash.com/photo-1698871061456-1834361d4e44?w=1200&auto=format&fit=crop&q=75",
  "where-to-get-married-in-slovakia":
    "https://images.unsplash.com/photo-1764816455462-dc5165344abe?w=1200&auto=format&fit=crop&q=75",
};

/** Catch-all photo for posts whose slug isn't in DEFAULT_PHOTO_BY_SLUG
 *  (admin-created posts with arbitrary slugs, legacy entries that
 *  haven't been migrated, etc). Soft pink rose in a glass vase — no
 *  face, neutral palette, doesn't lock in any topic. Keeps every card
 *  photographic so the feed never falls back to the paper composition
 *  in the wild. */
const GENERIC_FALLBACK_PHOTO =
  "https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=1200&auto=format&fit=crop&q=75";

interface BlogCoverArtProps {
  /** Post slug for picking the content icon + default Unsplash photo. */
  slug?: string;
  /** Category eyebrow — accepted for API compatibility; not rendered on
   *  the photo overlay since the card layout already shows it next to
   *  the title. */
  category?: string;
  /** Photo URL to use as the background. Pass the admin-uploaded
   *  cover_image_url when set; otherwise the component derives the
   *  default from `slug`. */
  bgUrl?: string | null;
  className?: string;
}

export function BlogCoverArt({ slug, bgUrl, className }: BlogCoverArtProps) {
  const Icon = (slug && ICON_BY_SLUG[slug]) || Heart;
  // `||` (not `??`) so empty-string bgUrls fall through to the slug
  // default; `??` would treat "" as a valid override and render nothing.
  const resolvedBg = bgUrl || (slug && DEFAULT_PHOTO_BY_SLUG[slug]) || GENERIC_FALLBACK_PHOTO;
  // useId keeps the linearGradient id unique across mounted instances —
  // SVG defs are document-global, so without this every cover would
  // share (and overwrite) the same gradient id.
  const gradId = useId().replace(/:/g, "");
  return (
    <svg
      viewBox="0 0 800 500"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className={className}
    >
      <defs>
        {/* Subtle diagonal dark gradient so the wordmark + icon stay
            legible on busy photos. Light at top-left where the photo
            usually has its focal point, darker bottom-right behind the
            Wēddly wordmark anchor. */}
        <linearGradient id={`tint-${gradId}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(0,0,0,0.05)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.42)" />
        </linearGradient>
      </defs>

      {resolvedBg ? (
        <image
          href={resolvedBg}
          x="0"
          y="0"
          width="800"
          height="500"
          preserveAspectRatio="xMidYMid slice"
        />
      ) : (
        // No photo resolved — paper fallback so the cover never renders
        // empty. Matches the original composition's tonal anchor.
        <rect width="800" height="500" fill="#f6f2e7" />
      )}

      {/* Dark tint layer (only meaningful over a photo, harmless over
          paper). Keeps overlay legible without flattening the image. */}
      {resolvedBg ? <rect width="800" height="500" fill={`url(#tint-${gradId})`} /> : null}

      {/* Wēddly wordmark — small italic serif anchored to the bottom-
          left as a quiet publication mark, like a magazine masthead.
          White on photos, paper-300 on the paper fallback. */}
      <text
        x="40"
        y="465"
        fontFamily="Cormorant, 'Cormorant Garamond', Georgia, serif"
        fontStyle="italic"
        fontWeight="500"
        fontSize="48"
        letterSpacing="2"
        fill={resolvedBg ? "rgba(255,255,255,0.88)" : "#bfae7b"}
      >
        Wēddly
      </text>

      {/* Content icon top-right. White stroke on photos, paper-300 on
          fallback — same tonal family as the wordmark in both cases. */}
      <g transform="translate(668, 48)">
        <Icon
          width={72}
          height={72}
          stroke={resolvedBg ? "rgba(255,255,255,0.92)" : "#e3d9bf"}
          strokeWidth={1.6}
          fill="none"
        />
      </g>
    </svg>
  );
}
