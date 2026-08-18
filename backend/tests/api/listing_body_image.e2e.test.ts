// Body-image candidates for the listing hero backfill.
//
// The og:image path covers the sites that have one. Measured on the July 2026
// Maps venue batch, that was NONE of 30 Hungarian venue homepages, so the
// directory card for every one of them would stay a placeholder. Their photos
// are in the page body, which is what this parser reads.
//
// The parser is pure, so it is tested without a network — same split as
// extractLinkPreview above it. What matters here is the ORDER (document order,
// because a site's own hero is near the top) and the junk filter, since the
// caller pays a download for every candidate it is handed.

import "../setup";

import { describe, expect, test } from "bun:test";
import {
  extractBodyImageCandidates,
  withGalleryFullSizeCandidates,
} from "../../src/lib/link_preview";
import { isAcceptableHero } from "../../src/domain/listing_image_backfill";

const BASE = "https://venue.test/";

describe("extractBodyImageCandidates", () => {
  test("reads img src, lazy data-src and srcset, in document order", () => {
    const html = `<body>
      <img src="/img/hall.jpg">
      <img data-src="/img/garden.jpeg" src="/img/blank.gif">
      <img srcset="/img/terrace-320.webp 320w, /img/terrace-960.webp 960w">
    </body>`;
    expect(extractBodyImageCandidates(html, BASE)).toEqual([
      "https://venue.test/img/hall.jpg",
      "https://venue.test/img/garden.jpeg",
      "https://venue.test/img/terrace-320.webp",
    ]);
  });

  test("reads inline background-image urls, quoted or not", () => {
    const html = `<div style="background-image: url('/img/a.jpg')"></div>
                  <div style="background-image:url(/img/b.png)"></div>`;
    expect(extractBodyImageCandidates(html, BASE)).toEqual([
      "https://venue.test/img/a.jpg",
      "https://venue.test/img/b.png",
    ]);
  });

  test("drops logos, icons and other furniture by filename", () => {
    const html = `<body>
      <img src="/assets/logo.png">
      <img src="/assets/favicon.png">
      <img src="/assets/arrow-up.png">
      <img src="/assets/cookie-banner.jpg">
      <img src="/photos/ceremony.jpg">
    </body>`;
    expect(extractBodyImageCandidates(html, BASE)).toEqual([
      "https://venue.test/photos/ceremony.jpg",
    ]);
  });

  test("ignores non-images, data: URIs and unresolvable srcs", () => {
    const html = `<body>
      <img src="data:image/gif;base64,R0lGOD">
      <img src="/video/tour.mp4">
      <img src="/tracker">
      <img src="::::">
      <img src="/photos/hall.jpg">
    </body>`;
    expect(extractBodyImageCandidates(html, BASE)).toEqual(["https://venue.test/photos/hall.jpg"]);
  });

  test("dedupes repeats and caps the list", () => {
    const repeated = Array.from({ length: 30 }, (_, i) => `<img src="/p/${i}.jpg">`).join("");
    const dupes = '<img src="/p/1.jpg"><img src="/p/1.jpg">';
    const out = extractBodyImageCandidates(dupes + repeated, BASE);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(new Set(out).size).toBe(out.length);
    expect(out[0]).toBe("https://venue.test/p/1.jpg");
  });

  test("resolves against the page URL, absolute urls pass through", () => {
    const html = `<img src="photos/a.jpg"><img src="https://cdn.other.test/b.jpg">`;
    expect(extractBodyImageCandidates(html, "https://venue.test/rendezvenyek/eskuvo/")).toEqual([
      "https://venue.test/rendezvenyek/eskuvo/photos/a.jpg",
      "https://cdn.other.test/b.jpg",
    ]);
  });

  test("the quality gate is what actually stops a logo that got through", () => {
    // The filename filter is a cheap first pass; anything called banner_2.jpg
    // still reaches the downloader, and the size gate is what rejects it.
    expect(isAcceptableHero(120, 60)).toBe(false); // too small
    expect(isAcceptableHero(1600, 200)).toBe(false); // banner strip
    expect(isAcceptableHero(1024, 683)).toBe(true); // a real photo
    expect(isAcceptableHero(null, null)).toBe(true); // unmeasurable, don't block
  });
});

describe("withGalleryFullSizeCandidates", () => {
  test("inserts a gallery-plugin thumb's full-size sibling right after it", () => {
    const out = withGalleryFullSizeCandidates([
      "https://venue.test/gallery/wedding/thumbs/thumbs_hall-001.jpg",
      "https://venue.test/gallery/wedding/thumbs/thumbs_hall-002.jpg?v=2",
    ]);
    expect(out).toEqual([
      "https://venue.test/gallery/wedding/thumbs/thumbs_hall-001.jpg",
      "https://venue.test/gallery/wedding/hall-001.jpg",
      "https://venue.test/gallery/wedding/thumbs/thumbs_hall-002.jpg?v=2",
      "https://venue.test/gallery/wedding/hall-002.jpg?v=2",
    ]);
  });

  test("leaves non-thumb candidates untouched and dedupes", () => {
    const out = withGalleryFullSizeCandidates([
      "https://venue.test/photos/ceremony.jpg",
      "https://venue.test/photos/ceremony.jpg",
    ]);
    expect(out).toEqual(["https://venue.test/photos/ceremony.jpg"]);
  });
});
