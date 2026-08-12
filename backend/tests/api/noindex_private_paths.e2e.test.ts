// A page whose URL IS the credential must never land in a search index.
//
// The one this was written for: /w/:slug/:code. `/w/:slug` is a couple's public
// wedding page and is supposed to be indexed, but adding the household code to
// the same URL turns it into that household's own view, with their names, who
// is coming, meal choices and dietary notes. Household codes travel through
// group chats and get pasted into public places, and once a crawler follows one
// the guest list is a search result. Nothing marked it before this.
//
// robots.txt is the wrong instrument on its own: it asks a crawler not to
// FETCH, which neither removes an already-indexed URL nor binds a crawler that
// ignores it. Only `noindex` de-indexes, and the crawler has to be allowed to
// fetch the page to read the header. So these stay crawlable and carry
// X-Robots-Tag.
//
// Pairs with server.ts (isPrivateByTokenPath).

import "../setup";

import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { bootstrapCouple, req, wipeAll } from "../helpers";

const BASE = `http://localhost:${process.env.PORT}`;

async function robotsTagFor(path: string): Promise<string | null> {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: "text/html" } });
  const tag = res.headers.get("x-robots-tag");
  await res.arrayBuffer();
  return tag;
}

describe("private-by-token pages are never indexable", () => {
  test("a household's own guest-page view carries noindex, the public one does not", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("noindex@weddly.test");

    // Opt the workspace in, which is the only state where /w/:slug is served.
    const pub = await req("PATCH", "/api/couples/current", { is_public: true }, { token });
    expect(pub.status).toBe(200);

    const hh = await req<{ household: { code: string } }>(
      "POST",
      "/api/households",
      { label: "Kovács family" },
      { token },
    );
    expect(hh.status).toBe(201);
    const code = hh.data.household.code;

    const slug = (
      db.prepare("SELECT slug FROM couples WHERE id = ?").get(coupleId) as { slug: string }
    ).slug;

    // The public page is the couple's shop window. It must stay indexable, or
    // this guard would be quietly costing them the thing they opted into.
    expect(await robotsTagFor(`/w/${slug}`)).toBeNull();

    // The same URL plus the household code is that household's private view.
    const gated = await robotsTagFor(`/w/${slug}/${code}`);
    expect(gated).toContain("noindex");
    // Keep links crawlable so bots can discover canonical public pages while
    // excluding the user-specific URL itself from search results.
    expect(gated).toContain("follow");
  });

  test("every other URL-as-credential surface carries it too", async () => {
    for (const path of [
      "/invite/sometoken",
      "/reset-password/sometoken",
      "/verify-email/sometoken",
      "/photo-albums/sometoken",
      "/planner-activation/sometoken",
      "/rsvp/SOMECODE",
    ]) {
      const tag = await robotsTagFor(path);
      expect(tag, `${path} should be noindex`).toContain("noindex");
    }
  });

  test("ordinary marketing pages stay fully indexable", async () => {
    for (const path of ["/", "/blog", "/suppliers/browse"]) {
      expect(await robotsTagFor(path), `${path} must stay indexable`).toBeNull();
    }
    expect(await robotsTagFor("/signup")).toContain("noindex");
  });
});
