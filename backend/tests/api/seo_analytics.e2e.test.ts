import "../setup";

import { afterEach, describe, expect, test } from "bun:test";
import { GTM_INLINE_CSP_HASH, renderIndexHtml } from "../../src/lib/seo_ssr";

// Plausible is injected into the SSR <head> only when PLAUSIBLE_DOMAIN is set.
// Cookieless + privacy-friendly, and plausible.io is already in the CSP.

const TEMPLATE = `<!doctype html>
<html lang="hu">
<head>
<!-- SEO_HEAD_START -->
<title>placeholder</title>
<!-- SEO_HEAD_END -->
</head>
<body><div id="root"></div></body>
</html>`;

function render(): string {
  return renderIndexHtml(TEMPLATE, {
    host: "weddly.hu",
    pathname: "/",
    isRsvp: false,
    acceptLanguage: "hu",
  });
}

afterEach(() => {
  process.env.PLAUSIBLE_DOMAIN = "";
  process.env.GTM_CONTAINER_ID = "";
  process.env.GA4_MEASUREMENT_ID = "";
});

describe("seo: direct GA4 injection", () => {
  test("does not inject GA4 when the measurement id is unset", () => {
    process.env.GA4_MEASUREMENT_ID = "";
    expect(render()).not.toContain("googletagmanager.com/gtag/js");
  });

  test("keeps the loader and config inert until statistics consent", () => {
    process.env.GA4_MEASUREMENT_ID = "G-ABC123XYZ";
    const html = render();
    expect(html).toContain(
      '<script type="text/plain" data-cookieconsent="statistics" async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ"></script>',
    );
    expect(html).toContain(
      '<script type="text/plain" data-cookieconsent="statistics">window.dataLayer=',
    );
    expect(html).not.toContain(
      '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ">',
    );
  });

  test("ignores a malformed measurement id", () => {
    process.env.GA4_MEASUREMENT_ID = "not-a-measurement-id";
    expect(render()).not.toContain("googletagmanager.com/gtag/js");
  });
});

describe("seo: Plausible analytics injection", () => {
  test("no script when PLAUSIBLE_DOMAIN is unset", () => {
    process.env.PLAUSIBLE_DOMAIN = "";
    expect(render()).not.toContain("plausible.io");
  });

  test("injects the deferred, domain-scoped script when set", () => {
    process.env.PLAUSIBLE_DOMAIN = "weddly.hu";
    const html = render();
    expect(html).toContain(
      '<script type="text/plain" data-cookieconsent="statistics" defer data-domain="weddly.hu" src="https://plausible.io/js/script.js"></script>',
    );
  });

  test("the configured domain is reflected in data-domain", () => {
    process.env.PLAUSIBLE_DOMAIN = "weddly.com";
    expect(render()).toContain('data-domain="weddly.com"');
  });
});

// GTM is injected into the SSR <head> only when GTM_CONTAINER_ID is set. We
// emit the canonical inline bootstrap (the dataLayer `gtm.js` push) + the async
// gtm.js loader. The inline script is allow-listed via a CSP hash so it runs
// under script-src with no 'unsafe-inline'. Without the push, gtm.js only fires
// gtm.dom + gtm.load and every Page View tag silently never fires.
describe("seo: Google Tag Manager injection", () => {
  test("no GTM when GTM_CONTAINER_ID is unset", () => {
    process.env.GTM_CONTAINER_ID = "";
    expect(render()).not.toContain("googletagmanager.com");
  });

  test("injects the inline bootstrap before the async gtm.js loader", () => {
    process.env.GTM_CONTAINER_ID = "GTM-K9NCXCL9";
    const html = render();
    // The gtm.js event push must be present — it's what fires Page View tags.
    expect(html).toContain("event:'gtm.js'");
    // The gtm.js loader is Cookiebot consent-gated (type="text/plain" +
    // data-cookieconsent="statistics") so it only runs after statistics consent.
    expect(html).toContain(
      '<script type="text/plain" data-cookieconsent="statistics" async src="https://www.googletagmanager.com/gtm.js?id=GTM-K9NCXCL9"></script>',
    );
    // ...and it must run BEFORE the loader so the event is already on the
    // dataLayer when gtm.js processes it.
    const bootstrapIdx = html.indexOf("event:'gtm.js'");
    const loaderIdx = html.indexOf("googletagmanager.com/gtm.js");
    expect(bootstrapIdx).toBeGreaterThanOrEqual(0);
    expect(bootstrapIdx).toBeLessThan(loaderIdx);
  });

  test("the CSP hash token matches the emitted inline bootstrap byte-for-byte", () => {
    process.env.GTM_CONTAINER_ID = "GTM-K9NCXCL9";
    const html = render();
    const m = html.match(/<script>(window\.dataLayer[^<]*)<\/script>/);
    expect(m).not.toBeNull();
    const inline = m![1]!;
    const expected = `'sha256-${new Bun.CryptoHasher("sha256").update(inline).digest("base64")}'`;
    // If this drifts, the browser would block the inline script and no tag
    // would fire — the exact bug we're fixing, re-introduced silently.
    expect(GTM_INLINE_CSP_HASH).toBe(expected);
  });

  test("ignores a malformed container id rather than emitting junk", () => {
    process.env.GTM_CONTAINER_ID = "not a real id";
    expect(render()).not.toContain("googletagmanager.com");
  });
});
