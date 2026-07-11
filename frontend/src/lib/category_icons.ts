// Single source for supplier-category + group icons. Previously each of five
// components kept its own Record<SupplierCategory, Icon> literal; they drifted
// and, worse, a lookup on a stale/unknown slug returned `undefined` and
// white-screened the page (no fallback). This module keeps ONE map and a
// fallback-safe accessor so an unexpected slug degrades to a neutral icon
// instead of crashing.

import type { SupplierCategory, SupplierGroup } from "@shared/suppliers";
import {
  Aperture,
  BedDouble,
  Building2,
  Cake,
  Camera,
  Car,
  Clapperboard,
  ClipboardList,
  Crown,
  Disc3,
  Flower2,
  Gem,
  Hand,
  Lightbulb,
  type LucideIcon,
  Mail,
  Martini,
  Mic,
  MoreHorizontal,
  Music,
  Package,
  PartyPopper,
  PenTool,
  Scissors,
  Shirt,
  Speaker,
  Sparkles,
  Tent,
  Truck,
  UtensilsCrossed,
  Video,
} from "lucide-react";

export const CATEGORY_ICON: Record<SupplierCategory, LucideIcon> = {
  wedding_planner: ClipboardList,
  rental_equipment: Package,
  venue: Building2,
  accommodation: BedDouble,
  tent_pavilion: Tent,
  catering: UtensilsCrossed,
  cake_dessert: Cake,
  bar_drinks: Martini,
  food_trucks: Truck,
  wedding_decor: Sparkles,
  florist: Flower2,
  lighting: Lightbulb,
  photography: Camera,
  videography: Video,
  content_creator: Clapperboard,
  photo_booth: Aperture,
  dj: Disc3,
  live_music: Music,
  entertainment: PartyPopper,
  mc_celebrant: Mic,
  sound_tech: Speaker,
  bridal_boutique: Crown,
  suit_formal: Shirt,
  hair_makeup: Scissors,
  nails: Hand,
  wedding_jewelry: Gem,
  stationery: Mail,
  invitation_graphics: PenTool,
  transport: Car,
  other: MoreHorizontal,
};

export const GROUP_ICON: Record<SupplierGroup, LucideIcon> = {
  planning_rentals: ClipboardList,
  venue_stay: Building2,
  food_drink: UtensilsCrossed,
  decor_flowers: Flower2,
  media: Camera,
  entertainment: Music,
  fashion_beauty: Shirt,
  paper_design: Mail,
  transport: Car,
};

/** Icon for a category slug, with a neutral fallback for any stale/unknown value
 *  (a pre-v2 slug on an un-migrated row must never crash the render). */
export function categoryIcon(category: string): LucideIcon {
  return CATEGORY_ICON[category as SupplierCategory] ?? MoreHorizontal;
}

/** Icon for a group slug, with the same neutral fallback. */
export function groupIcon(group: string): LucideIcon {
  return GROUP_ICON[group as SupplierGroup] ?? MoreHorizontal;
}
