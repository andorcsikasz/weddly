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
