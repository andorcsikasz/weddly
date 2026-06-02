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
  ClipboardCheck,
  Gem,
  Heart,
  LayoutGrid,
  type LucideIcon,
  Mail,
  MailCheck,
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
};

/** Topical Unsplash photo per post slug. Aesthetic is "wedding
 *  ceremony, church, light, romantic" — every photo is soft-lit,
 *  airy, neutral-palette editorial wedding work. Each URL was
 *  visually inspected from its bytes (not just URL-verified) so the
 *  content matches what the slug says. Admin uploads override these
 *  via cover_image_url; the URL here is only used when no upload
 *  exists for a post. */
export const DEFAULT_PHOTO_BY_SLUG: Record<string, string> = {
  "miert-hazasodunk-a-biblia-szerint":
    "https://images.unsplash.com/photo-1465495976277-4387d4b0b4c6?w=1200&auto=format&fit=crop&q=75",
  "bibliai-idezetek-eskuvore":
    "https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=1200&auto=format&fit=crop&q=75",
  "eskuvoi-koltsegvetes-keszitese":
    "https://images.unsplash.com/photo-1604017011826-d3b4c23f8914?w=1200&auto=format&fit=crop&q=75",
  "eskuvoi-vendeglista-keszitese":
    "https://images.unsplash.com/photo-1525772764200-be829a350797?w=1200&auto=format&fit=crop&q=75",
  "eskuvoi-hagyomanyok-praktikusan":
    "https://images.unsplash.com/photo-1606800052052-a08af7148866?w=1200&auto=format&fit=crop&q=75",
  "eskuvoi-szertartas-menete":
    "https://images.unsplash.com/photo-1469371670807-013ccf25f16a?w=1200&auto=format&fit=crop&q=75",
  "eskuvoi-ultetesi-rend-keszitese":
    "https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=1200&auto=format&fit=crop&q=75",
  "eskuvoi-rsvp-kerdesek":
    "https://images.unsplash.com/photo-1522413452208-996ff3f3e740?w=1200&auto=format&fit=crop&q=75",
  "eskuvoi-ugyintezes-lepesrol-lepesre":
    "https://images.unsplash.com/photo-1606490194859-07c18c9f0968?w=1200&auto=format&fit=crop&q=75",
  "eskuvoszervezesi-checklist-12-honapra":
    "https://images.unsplash.com/photo-1546032996-6dfacbacbf3f?w=1200&auto=format&fit=crop&q=75",
  "eskuvoszervezesi-checklist-6-honapra":
    "https://images.unsplash.com/photo-1591604466107-ec97de577aff?w=1200&auto=format&fit=crop&q=75",
  "digitalis-eskuvoi-meghivo-vagy-papir-meghivo":
    "https://images.unsplash.com/photo-1525258946800-98cfd641d0de?w=1200&auto=format&fit=crop&q=75",
};

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
  const resolvedBg = bgUrl ?? (slug && DEFAULT_PHOTO_BY_SLUG[slug]) ?? null;
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

      {/* Wēddly wordmark — large italic serif, centered. On a photo
          it's white with low opacity so it reads as a watermark; on the
          paper fallback it stays paper-300 like the original. */}
      <text
        x="400"
        y="290"
        textAnchor="middle"
        fontFamily="Cormorant, 'Cormorant Garamond', Georgia, serif"
        fontStyle="italic"
        fontWeight="500"
        fontSize="140"
        letterSpacing="6"
        fill={resolvedBg ? "rgba(255,255,255,0.78)" : "#e3d9bf"}
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
