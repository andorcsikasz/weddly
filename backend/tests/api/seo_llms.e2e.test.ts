import "../setup";

import { describe, expect, test } from "bun:test";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

// Before this route existed, /llms.txt hit the SPA catch-all and returned
// index.html with a 200 (which is why the audit "found" an llms.txt that was
// really HTML). These assertions pin that it now serves a real, generated
// llms.txt listing the citable tool + blog assets.
describe("seo: /llms.txt", () => {
  test("serves plain text, not the SPA HTML fallback", async () => {
    const res = await fetch(`${BASE}/llms.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body).not.toContain("<!doctype html");
    expect(body).not.toContain("<div id=\"root\"");
  });

  test("opens with the Weddly entity statement", async () => {
    const body = await (await fetch(`${BASE}/llms.txt`)).text();
    expect(body.startsWith("# Weddly")).toBe(true);
    expect(body).toContain("> Weddly is a shared wedding-planning workspace");
  });

  test("lists the free tools and the blog, with canonical URLs", async () => {
    const body = await (await fetch(`${BASE}/llms.txt`)).text();
    expect(body).toContain("## Free wedding tools");
    expect(body).toContain("## Wedding blog");
    // EN canonical tool slug + a seeded blog post URL.
    expect(body).toContain("https://weddly.hu/tools/wedding-budget-calculator");
    expect(body).toContain("https://weddly.hu/blog/");
  });
});
