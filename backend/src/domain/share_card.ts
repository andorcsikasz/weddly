// Link-preview cards (iMessage, WhatsApp, Slack, Messenger): a 1200×630 JPEG
// per RSVP invite and per venue, drawn from the thing the link is about.
//
// Text is drawn as vector outlines from the bundled fonts (@pdf-lib/fontkit),
// so the card looks the same on any machine, including the production image,
// which has no system fonts. The raster step is sharp (libvips), the same
// pairing GoodDay ships.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { create as createFont, type Font } from "@pdf-lib/fontkit";
import sharp from "sharp";
import { getCoupleById } from "./couples";
import { getGuestByInviteCode } from "./guests";
import { storage, keyFromUploadUrl } from "../lib/storage";
import { lookupVendorPageMeta } from "../lib/seo_ssr";
import { shareVersion } from "../lib/share_version";

export const CARD_W = 1200;
export const CARD_H = 630;
const PAD = 72;
const BG = "#16100c";

// ─── Fonts ────────────────────────────────────────────────────────────────────

const FONT_DIR = join(import.meta.dir, "pdf_fonts");
const fontCache = new Map<string, Font>();

function loadFont(file: string): Font {
  let f = fontCache.get(file);
  if (!f) {
    const bytes = new Uint8Array(readFileSync(join(FONT_DIR, file)));
    f = createFont(bytes);
    fontCache.set(file, f);
  }
  return f;
}

/** Upright display serif for names and titles. */
const SERIF = "EBGaramond-Regular.ttf";
/** Upright serif for the supporting line (no italic, house rule). */
const SUPPORT = "EBGaramond-Regular.ttf";
/** Sans for the small letter-spaced labels. */
const SANS = "DMSans-Bold.ttf";

function measure(font: Font, text: string, size: number, tracking = 0): number {
  const run = font.layout(text);
  const scale = size / font.unitsPerEm;
  const advance = run.positions.reduce((sum, p) => sum + p.xAdvance, 0);
  return advance * scale + tracking * Math.max(0, run.glyphs.length - 1);
}

/** A line of text as SVG outlines, left edge at x and baseline at y. */
function outline(
  font: Font,
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  opacity = 1,
  tracking = 0,
): string {
  const run = font.layout(text);
  const scale = size / font.unitsPerEm;
  let pen = 0;
  const paths = run.glyphs.map((glyph, i) => {
    const pos = run.positions[i];
    if (!pos) return "";
    const gx = x + (pen + pos.xOffset) * scale;
    const gy = y - pos.yOffset * scale;
    pen += pos.xAdvance + tracking / scale;
    const d = glyph.path.toSVG();
    return d
      ? `<path transform="translate(${gx.toFixed(1)} ${gy.toFixed(1)}) scale(${scale.toFixed(5)} ${(-scale).toFixed(5)})" d="${d}"/>`
      : "";
  });
  return `<g fill="${fill}" fill-opacity="${opacity}">${paths.join("")}</g>`;
}

/** The largest size, down from `max`, at which `text` fits `width` on one line. */
function fitSize(font: Font, text: string, width: number, max: number, min: number): number {
  let size = max;
  while (size > min && measure(font, text, size) > width) size -= 2;
  return size;
}

/** Cut `text` to `width` with an ellipsis. */
function fitText(font: Font, text: string, size: number, width: number): string {
  if (measure(font, text, size) <= width) return text;
  let cut = text;
  while (cut && measure(font, `${cut}…`, size) > width) cut = cut.slice(0, -1).trimEnd();
  return `${cut}…`;
}

/** Break `text` into at most `max` lines of `width`, the last one ellipsised. */
function wrapLines(font: Font, text: string, size: number, width: number, max: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (measure(font, next, size) <= width || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= max && lines.every((l) => measure(font, l, size) <= width)) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = fitText(font, kept.slice(max - 1).join(" "), size, width);
  return kept;
}

// ─── Layers ───────────────────────────────────────────────────────────────────

/** Bottom-heavy shade so light text reads over any photo. */
function shadeSvg(strength: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">
  <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#000" stop-opacity="${(0.5 * strength).toFixed(2)}"/>
    <stop offset="0.35" stop-color="#000" stop-opacity="${(0.08 * strength).toFixed(2)}"/>
    <stop offset="0.5" stop-color="#000" stop-opacity="${(0.1 * strength).toFixed(2)}"/>
    <stop offset="1" stop-color="#000" stop-opacity="${(0.7 * strength).toFixed(2)}"/>
  </linearGradient></defs>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#s)"/>
</svg>`;
}

/** The brand field for cards without a photo: the og-rsvp palette, with a soft
 *  light source top right so it is not a flat slab. */
function brandFieldSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">
  <defs><radialGradient id="g" cx="0.88" cy="0.1" r="0.8">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0.12"/>
    <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
  </radialGradient></defs>
  <rect width="${CARD_W}" height="${CARD_H}" fill="${BG}"/>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#g)"/>
</svg>`;
}

/** The hairline frame from og-rsvp.svg, so every card shares one border. */
function frame(): string {
  return `<rect x="40" y="40" width="${CARD_W - 80}" height="${CARD_H - 80}" fill="none" stroke="#ffffff" stroke-width="1" stroke-opacity="0.22"/>`;
}

async function photoLayer(photo: Uint8Array | null): Promise<Buffer | null> {
  if (!photo) return null;
  try {
    return await sharp(photo)
      .resize(CARD_W, CARD_H, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();
  } catch {
    // An unreadable upload is a missing photo, not a failed card.
    return null;
  }
}

async function compose(overlay: string, photo: Uint8Array | null, shade: number): Promise<Buffer> {
  const photoPng = await photoLayer(photo);
  const base = photoPng ? sharp(photoPng) : sharp(Buffer.from(brandFieldSvg()));
  const layers: sharp.OverlayOptions[] = [];
  if (photoPng) layers.push({ input: Buffer.from(shadeSvg(shade)), top: 0, left: 0 });
  layers.push({ input: Buffer.from(overlay), top: 0, left: 0 });
  return base
    .composite(layers)
    .flatten({ background: BG })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

function wordmark(): string {
  return outline(loadFont(SANS), "WĒDDLY", PAD, PAD + 26, 22, "#ffffff", 0.92, 5);
}

// ─── RSVP invite ──────────────────────────────────────────────────────────────

export interface RsvpCardSource {
  coupleName: string;
  date: string | null;
  venue: string | null;
  /** The couple's cover photo bytes, when it is a local upload. */
  photo: Uint8Array | null;
  /** Changes whenever what the card shows changes, so the URL cache-busts. */
  version: string;
}

/** Everything an RSVP card shows, for an invite code. Null when the code is
 *  unknown, so an invalid code gets no picture. Guest names are NOT on the
 *  card: it is a link preview, and the link may be forwarded. */
export async function rsvpCardSource(code: string): Promise<RsvpCardSource | null> {
  const guest = getGuestByInviteCode(code.toUpperCase());
  if (!guest) return null;
  const couple = getCoupleById(guest.couple_id);
  if (!couple) return null;
  const coverKey = couple.cover_image_url ? keyFromUploadUrl(couple.cover_image_url) : null;
  const photo = coverKey ? await storage.read(coverKey) : null;
  return {
    coupleName: couple.display_name,
    date: couple.wedding_date,
    venue: couple.venue_name,
    photo,
    version: shareVersion([
      couple.display_name,
      couple.wedding_date,
      couple.venue_name,
      couple.cover_image_url,
    ]),
  };
}

function longDate(iso: string): string | null {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export async function renderRsvpCard(src: RsvpCardSource): Promise<Buffer> {
  const serif = loadFont(SERIF);
  const support = loadFont(SUPPORT);
  const textW = CARD_W - PAD * 2;

  const size = fitSize(serif, src.coupleName, textW, 104, 56);
  const names = wrapLines(serif, src.coupleName, size, textW, 2);
  const lead = Math.round(size * 1.04);

  const dateText = src.date ? longDate(src.date) : null;
  const sub = [dateText, src.venue].filter(Boolean).join("  ·  ");
  const subLine = sub ? fitText(support, sub, 36, textW) : null;

  // Bottom-up layout: sub line, then the names above it.
  let y = CARD_H - PAD + 6;
  const parts: string[] = [];
  parts.push(outline(loadFont(SANS), "RSVP", PAD, y, 20, "#ffffff", 0.82, 5));
  y -= 84;
  if (subLine) {
    parts.push(outline(support, subLine, PAD, y, 36, "#ffffff", 0.95));
    y -= 60;
  }
  // The title block sits above the sub line, bottom line first.
  let ny = y - (names.length - 1) * lead;
  for (const line of names) {
    parts.push(outline(serif, line, PAD - 2, ny, size, "#ffffff"));
    ny += lead;
  }

  const chip = "YOU'RE INVITED";
  const chipFont = loadFont(SANS);
  const chipSize = 20;
  const chipW = measure(chipFont, chip, chipSize, 4) + 44;
  const chipX = CARD_W - PAD - chipW;
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">
  ${frame()}
  ${wordmark()}
  <rect x="${chipX.toFixed(1)}" y="${PAD - 6}" width="${chipW.toFixed(1)}" height="46" rx="23" fill="#ffffff" fill-opacity="0.16"/>
  ${outline(chipFont, chip, chipX + 22, PAD + 22, chipSize, "#ffffff", 0.95, 4)}
  ${parts.join("\n  ")}
</svg>`;
  return compose(overlay, src.photo, src.photo ? 1 : 0);
}

// ─── Venue ────────────────────────────────────────────────────────────────────

export interface VendorCardSource {
  name: string;
  city: string;
  category: string;
  photo: Uint8Array | null;
  version: string;
}

/** Everything a venue card shows, for a public vendor id (pretty or bare).
 *  Goes through the same page meta as the public page, so an unclaimed
 *  import shows its name and photo and never its bio, exactly as the page does. */
export async function vendorCardSource(id: string): Promise<VendorCardSource | null> {
  const meta = lookupVendorPageMeta(`/suppliers/${encodeURIComponent(id)}`);
  if (!meta) return null;
  const key = meta.heroImageUrl ? keyFromUploadUrl(meta.heroImageUrl) : null;
  const photo = key ? await storage.read(key) : null;
  return {
    name: meta.name,
    city: meta.city,
    category: meta.category,
    photo,
    version: shareVersion([meta.name, meta.city, meta.category, meta.heroImageUrl]),
  };
}

export async function renderVendorCard(src: VendorCardSource): Promise<Buffer> {
  const serif = loadFont(SERIF);
  const support = loadFont(SUPPORT);
  const sans = loadFont(SANS);
  const textW = CARD_W - PAD * 2;

  const size = fitSize(serif, src.name, textW, 96, 52);
  const names = wrapLines(serif, src.name, size, textW, 2);
  const lead = Math.round(size * 1.04);

  const category = src.category.toUpperCase();
  const catSize = 20;
  const catText = fitText(sans, category, catSize, 420);

  let y = CARD_H - PAD + 6;
  const parts: string[] = [];
  parts.push(outline(sans, "WĒDDLY  ·  TRYWEDDLY.COM", PAD, y, 18, "#ffffff", 0.78, 4));
  y -= 84;
  if (src.city) {
    parts.push(
      outline(support, fitText(support, src.city, 36, textW), PAD, y, 36, "#ffffff", 0.95),
    );
    y -= 60;
  }
  let ny = y - (names.length - 1) * lead;
  for (const line of names) {
    parts.push(outline(serif, line, PAD - 2, ny, size, "#ffffff"));
    ny += lead;
  }

  const chipW = measure(sans, catText, catSize, 4) + 44;
  const chipX = CARD_W - PAD - chipW;
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">
  ${frame()}
  ${wordmark()}
  <rect x="${chipX.toFixed(1)}" y="${PAD - 6}" width="${chipW.toFixed(1)}" height="46" rx="23" fill="#ffffff" fill-opacity="0.16"/>
  ${outline(sans, catText, chipX + 22, PAD + 22, catSize, "#ffffff", 0.95, 4)}
  ${parts.join("\n  ")}
</svg>`;
  return compose(overlay, src.photo, src.photo ? 1 : 0);
}

// ─── Cache + helpers ──────────────────────────────────────────────────────────

const renderCache = new Map<string, Buffer>();
const CACHE_LIMIT = 200;

/** Rendered once per (kind, id, version). A burst of preview fetches from one
 *  chat app, or a re-share, costs one render. */
export async function cachedCard(key: string, render: () => Promise<Buffer>): Promise<Buffer> {
  const hit = renderCache.get(key);
  if (hit) return hit;
  const jpeg = await render();
  renderCache.set(key, jpeg);
  if (renderCache.size > CACHE_LIMIT) renderCache.delete(renderCache.keys().next().value!);
  return jpeg;
}

/** Test seam: the rendered-card cache is process-wide. */
export function __clearShareCardCache(): void {
  renderCache.clear();
}
