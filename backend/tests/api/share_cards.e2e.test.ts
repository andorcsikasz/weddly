import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req, wipeAll } from "../helpers";
import { DIRECTORY } from "../../src/domain/suppliers_data";
import { HU_HOST, renderIndexHtml } from "../../src/lib/seo_ssr";
import { vendorPublicId } from "../../../shared/vendor_slug";

// Link-preview cards: an RSVP invite and a venue each get a 1200×630 JPEG
// drawn from their own facts, and the page head points at it. Chat apps fetch
// these with no session, so the routes are public.

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<!-- SEO_HEAD_START -->
<title>placeholder</title>
<!-- SEO_HEAD_END -->
</head>
<body><div id="root"></div></body>
</html>`;

function metaContent(html: string, key: string): string | null {
  const re = new RegExp(
    `<meta (?:property|name)="${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" content="([^"]*)" />`,
  );
  return re.exec(html)?.[1] ?? null;
}

function renderPath(pathname: string): string {
  return renderIndexHtml(TEMPLATE, {
    host: HU_HOST,
    pathname,
    isRsvp: pathname.startsWith("/rsvp/"),
    acceptLanguage: "en-US,en;q=0.9",
  });
}

/** Fetch a card and drain the body (an unread body stalls keep-alive). */
async function fetchCard(
  path: string,
): Promise<{ status: number; type: string | null; bytes: Uint8Array }> {
  const res = await fetch(`${BASE}${path}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get("content-type"), bytes };
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

describe("share card: RSVP invite", () => {
  test("a valid invite code gets a JPEG card", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("share-card-rsvp@weddly.test");
    const g = await req<{ guest: { invite_code: string } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna" },
      { token },
    );
    const code = g.data.guest.invite_code;

    const card = await fetchCard(`/api/share-cards/rsvp/${code}`);
    expect(card.status).toBe(200);
    expect(card.type).toBe("image/jpeg");
    expect(isJpeg(card.bytes)).toBe(true);
    expect(card.bytes.length).toBeGreaterThan(5_000);
  });

  test("an unknown code gets no card, the same 404 the lookup gives", async () => {
    const card = await fetchCard("/api/share-cards/rsvp/ZZZZZZ");
    expect(card.status).toBe(404);
  });

  test("the /rsvp/<code> head points og:image at that card, with the couple's names and no guest name", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("share-card-head@weddly.test");
    const g = await req<{ guest: { invite_code: string } }>(
      "POST",
      "/api/guests",
      { full_name: "Zsófi Titkos" },
      { token },
    );
    const code = g.data.guest.invite_code;

    const html = renderPath(`/rsvp/${code}`);
    const image = metaContent(html, "og:image") ?? "";
    expect(image.startsWith(`https://${HU_HOST}/api/share-cards/rsvp/${code}?v=`)).toBe(true);
    expect(metaContent(html, "og:image:type")).toBe("image/jpeg");
    expect(metaContent(html, "twitter:image")).toBe(image);
    expect(metaContent(html, "og:title")).toContain("Mia");
    expect(metaContent(html, "og:description")).toContain("September 12, 2026");
    // The forwardable preview never names the guest it was sent to.
    expect(html).not.toContain("Zsófi");
    expect(html).not.toContain("Titkos");
    expect(metaContent(html, "robots")).toBe("noindex,follow");
  });

  test("an unknown code's head falls back to the brand RSVP card, not a guessed couple", async () => {
    const html = renderPath("/rsvp/ZZZZZZ");
    expect(metaContent(html, "og:image")).toBe(`https://${HU_HOST}/og-rsvp.png`);
  });
});

describe("share card: venue", () => {
  const venue = DIRECTORY.find((entry) => entry.hero_image_url);

  test("a venue id gets a JPEG card", async () => {
    if (!venue) throw new Error("no curated entry with a hero photo to test against");
    const card = await fetchCard(`/api/share-cards/vendor/${encodeURIComponent(venue.id)}`);
    expect(card.status).toBe(200);
    expect(card.type).toBe("image/jpeg");
    expect(isJpeg(card.bytes)).toBe(true);
  });

  test("the venue page head points og:image at the venue's card, not at the bare photo", () => {
    if (!venue) throw new Error("no curated entry with a hero photo to test against");
    const publicId = vendorPublicId(venue.id, venue.name);
    const html = renderPath(`/suppliers/${publicId}`);
    const image = metaContent(html, "og:image") ?? "";
    expect(image.startsWith(`https://${HU_HOST}/api/share-cards/vendor/${publicId}?v=`)).toBe(true);
    expect(metaContent(html, "og:image:type")).toBe("image/jpeg");
    expect(metaContent(html, "og:title")).toContain(venue.name);
  });

  test("an unknown venue id gets no card", async () => {
    const card = await fetchCard("/api/share-cards/vendor/no-such-venue-v999999");
    expect(card.status).toBe(404);
  });
});
