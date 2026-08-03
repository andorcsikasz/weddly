// The picture on a wishlist card, in three descending rungs of truth.
//
// 1. THE PRODUCT'S OWN PHOTO, from the link the couple pasted (og:image,
//    resolved and re-hosted server-side). Nothing beats showing the thing.
// 2. THE SHOP'S LOGO, when the page publishes no og:image — which is most of
//    them: Booking, the marketplaces and anything behind a bot wall answer 403
//    to any crawler, and plenty of webshops simply ship none. A wish sitting
//    under the IKEA mark is read at a glance, and it is a fact about the link
//    rather than an ornament we invented.
// 3. AN ICON THE COUPLE PICKED, for a wish with no link at all (every
//    `request`, and any gift typed by hand). One tap in the dialog, from a
//    short concrete strip; untouched, it falls back to the kind's own mark.
//
// This replaced a set of hand-drawn line motifs chosen from the title by
// keyword and hash. They were pretty and they were guesses: an item called
// "hosszúhétvége" got a suitcase because a regex said so, and the couple had no
// way to disagree. Owner direction, 2026-08-03 — show the real picture, and
// where there is none, let the couple choose the mark themselves.
//
// The two image rungs need OPPOSITE framing, which is why `image_kind` exists:
// a photo is cropped to fill, a logo is contained and padded on the ground. A
// logo cropped to fill is a wall of brand colour with a slice of one letter in
// it.

import {
  Armchair,
  BedDouble,
  Camera,
  Coffee,
  CookingPot,
  Flower2,
  Gift,
  Heart,
  House,
  Laptop,
  Mail,
  Music,
  Plane,
  Smartphone,
  Ticket,
  TreePalm,
  UtensilsCrossed,
  Wine,
} from "lucide-react";
import type { ComponentType } from "react";
import { useState } from "react";
import type { WishlistIconSlug, WishlistImageKind, WishlistKind } from "@shared/wishlist";
import { WISHLIST_ICON_SLUGS } from "@shared/wishlist";
import { SmartImage } from "./ui/SmartImage";

type IconComponent = ComponentType<{ className?: string; strokeWidth?: number }>;

/** Slug → component. Keyed by the shared slug union, so adding a slug there is
 *  a compile error here until it has a glyph — an icon the server accepts and
 *  the client cannot draw would render as nothing at all. */
const ICONS: Record<WishlistIconSlug, IconComponent> = {
  Gift,
  House,
  UtensilsCrossed,
  CookingPot,
  Coffee,
  Wine,
  BedDouble,
  Armchair,
  Flower2,
  Smartphone,
  Laptop,
  Camera,
  Plane,
  TreePalm,
  Ticket,
  Music,
  Heart,
  Mail,
};

/** The picker's own order, and the only list the UI iterates. */
export const WISHLIST_ICON_CHOICES: ReadonlyArray<{ slug: WishlistIconSlug; Icon: IconComponent }> =
  WISHLIST_ICON_SLUGS.map((slug) => ({ slug, Icon: ICONS[slug] }));

/** The mark a wish wears when the couple has not picked one: a parcel for
 *  something to be given, a heart for something to be done. Both are already
 *  the kind's icon in the dialog's own type toggle, so the card and the form
 *  agree without a second decision. */
export function defaultWishlistIcon(kind: WishlistKind): WishlistIconSlug {
  return kind === "request" ? "Heart" : "Gift";
}

export function resolveWishlistIcon(
  icon: WishlistIconSlug | null | undefined,
  kind: WishlistKind,
): IconComponent {
  return ICONS[icon ?? defaultWishlistIcon(kind)];
}

/** Everything the tile needs, named so both the couple-side `WishlistItem` and
 *  the guest-side `WishlistEntry` satisfy it without a mapper. */
export interface WishlistPictureSubject {
  title: string;
  kind: WishlistKind;
  image_url: string | null;
  image_kind: WishlistImageKind | null;
  icon: WishlistIconSlug | null;
}

/** The tile. Fills its parent, which owns the frame, the size and the corner
 *  radius — the same art has to work in a 40 px row thumbnail and a 4:5 card.
 *
 *  `zoom` grows a photo slightly while its card is hovered. `dense` shrinks the
 *  icon's share of a small tile, where a 38 % glyph reads as a blob. */
export function WishlistPicture({
  item,
  zoom = false,
  dense = false,
  className = "",
}: {
  item: WishlistPictureSubject;
  zoom?: boolean;
  dense?: boolean;
  className?: string;
}) {
  // A picture that will not load falls back to the icon rather than to the
  // browser's broken-image glyph — a wall of grey squares reads as "the app is
  // broken". Keyed by the src that failed, so a new image after an edit is
  // given its own chance.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = item.image_url && item.image_url !== failedSrc ? item.image_url : null;
  const zoomClass = zoom ? "transition-transform duration-700 group-hover:scale-[1.04]" : "";

  if (src && item.image_kind !== "logo") {
    return (
      <SmartImage
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailedSrc(src)}
        wrapperClassName={`h-full w-full ${className}`}
        className={`h-full w-full object-cover ${zoomClass}`}
      />
    );
  }

  // Ground shared by the two drawn-on rungs. The theme's SURFACE tone rather
  // than a shade below it: the wishlist grid draws no border around the tile,
  // and umber-850 sat close enough to the umber-900 page that a picture-less
  // item read as a hole in it. `.stationery` is the app's own hairline paper
  // texture, so the tile still looks composed rather than blank.
  const ground = `relative block overflow-hidden bg-paper-100 stationery dark:bg-umber-800 ${className}`;

  if (src) {
    return (
      <span className={ground} aria-hidden>
        <SmartImage
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailedSrc(src)}
          wrapperClassName="absolute inset-0 flex items-center justify-center p-[16%]"
          className={`max-h-full max-w-full object-contain ${zoomClass}`}
        />
      </span>
    );
  }

  const Icon = resolveWishlistIcon(item.icon, item.kind);
  return (
    <span className={ground} aria-hidden>
      <span className="absolute inset-0 flex items-center justify-center">
        <Icon
          className={`${dense ? "h-1/3 w-1/3" : "h-[38%] w-[38%]"} text-paper-600 dark:text-umber-400`}
          strokeWidth={1.25}
        />
      </span>
    </span>
  );
}
