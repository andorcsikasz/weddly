import "../setup";

import { afterEach, describe, expect, test } from "bun:test";
import { renderIndexHtml } from "../../src/lib/seo_ssr";

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
      '<script defer data-domain="weddly.hu" src="https://plausible.io/js/script.js"></script>',
    );
  });

  test("the configured domain is reflected in data-domain", () => {
    process.env.PLAUSIBLE_DOMAIN = "weddly.com";
    expect(render()).toContain('data-domain="weddly.com"');
  });
});

// GTM is injected into the SSR <head> only when GTM_CONTAINER_ID is set. We
// load gtm.js with a plain async <script src> (not Google's inline bootstrap)
// so the strict CSP — script-src has no 'unsafe-inline' — doesn't block it.
describe("seo: Google Tag Manager injection", () => {
  test("no GTM when GTM_CONTAINER_ID is unset", () => {
    process.env.GTM_CONTAINER_ID = "";
    expect(render()).not.toContain("googletagmanager.com");
  });

  test("injects the async gtm.js loader for the configured container", () => {
    process.env.GTM_CONTAINER_ID = "GTM-K9NCXCL9";
    expect(render()).toContain(
      '<script async src="https://www.googletagmanager.com/gtm.js?id=GTM-K9NCXCL9"></script>',
    );
  });

  test("ignores a malformed container id rather than emitting junk", () => {
    process.env.GTM_CONTAINER_ID = "not a real id";
    expect(render()).not.toContain("googletagmanager.com");
  });
});
