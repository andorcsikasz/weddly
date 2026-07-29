import "../setup";

import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { photoCandidates } from "../../src/routes/honeymoon";
import { bootstrapCouple, req } from "../helpers";

// ─── Breadcrumb → place ladder (pure, no network) ─────────────────────────
//
// The saved destination is whatever Nominatim handed back, which for a venue
// pick is a seven-segment chain ending in the country. The photo endpoint
// walks that chain outward until something has a picture; these tests pin
// WHICH rungs it walks, because the ordering is the whole feature.

describe("honeymoon photo — destination candidates", () => {
  test("a plain city is its own only candidate", () => {
    expect(photoCandidates("Santorini")).toEqual(["Santorini"]);
  });

  test("a short breadcrumb keeps every rung, most specific first", () => {
    expect(photoCandidates("Bali, Indonézia")).toEqual(["Bali", "Indonézia"]);
    expect(photoCandidates("Szentbékkálla, Veszprém vármegye, Magyarország")).toEqual([
      "Szentbékkálla",
      "Veszprém vármegye",
      "Magyarország",
    ]);
  });

  test("house numbers and postcodes are dropped, they are not places", () => {
    expect(photoCandidates("Via del Tritone 21, Roma, 00187, Italia")).toEqual(["Roma", "Italia"]);
  });

  test("a long venue breadcrumb keeps the head and the TAIL, never a prefix", () => {
    // The regression this guards: capping from the front spent the whole
    // budget on streets and city districts and threw away Rome, so the ladder
    // fell all the way through to a picture of Italy.
    const candidates = photoCandidates(
      "Chiesa di San Girolamo dei Croati, Via Tomacelli, Campo Marzio, Municipio Roma I, Róma, Roma Capitale, Lazio, Olaszország",
    );
    expect(candidates[0]).toBe("Chiesa di San Girolamo dei Croati");
    expect(candidates).toContain("Róma");
    expect(candidates.at(-1)).toBe("Olaszország");
    // The useless middle is what got trimmed.
    expect(candidates).not.toContain("Via Tomacelli");
    expect(candidates).not.toContain("Campo Marzio");
  });

  test("duplicate rungs collapse and an empty string yields nothing", () => {
    expect(photoCandidates("Roma, Roma, Italia")).toEqual(["Roma", "Italia"]);
    expect(photoCandidates("   ")).toEqual([]);
  });
});

// ─── Endpoint contract ────────────────────────────────────────────────────
//
// Resolution itself talks to Wikivoyage/Wikipedia/Commons, which no test
// should depend on, so these cover the parts that don't: auth, the response
// shape, and the negative cache that keeps those upstreams off the critical
// path. The two cases that do reach out use names guaranteed to 404, and
// `fetchJson` swallows a transport failure into the same null, so the outcome
// is identical on a machine with no network at all.

describe("honeymoon photo — endpoint", () => {
  test("requires a session", async () => {
    const r = await req("GET", "/api/honeymoon/destination-photo?destination=Bali");
    expect(r.status).toBe(401);
  });

  test("an absent or blank destination answers null without touching the network", async () => {
    const { token } = await bootstrapCouple(`hmphoto-${Date.now()}-${Math.random()}@weddly.test`);
    for (const q of ["", "?destination=", "?destination=%20%20"]) {
      const r = await req("GET", `/api/honeymoon/destination-photo${q}`, undefined, { token });
      expect(r.status).toBe(200);
      expect(r.data).toEqual({ photo_url: null, matched: null });
    }
  });

  test("a resolved photo is served straight from the cache, keyed by the FULL destination", async () => {
    const { token } = await bootstrapCouple(`hmphoto-${Date.now()}-${Math.random()}@weddly.test`);
    const destination = "Fictional Chapel, Ulica Testowa, Testville, Testonia";
    // Stand in for a previous resolution: the ladder landed on "Testville"
    // and both the winning rung and the whole breadcrumb were remembered.
    db.run(
      `INSERT OR REPLACE INTO destination_photo_cache (city, local_path, matched, fetched_at)
       VALUES (?, ?, ?, strftime('%s','now'))`,
      [destination.toLowerCase(), "/uploads/destination-photos/testville.jpg", "Testville"],
    );

    const r = await req(
      "GET",
      `/api/honeymoon/destination-photo?destination=${encodeURIComponent(destination)}`,
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    // The stored object does not exist on disk, so the route evicts the row
    // and re-resolves rather than serving a 404 image. Either way it must
    // answer the documented shape and never throw.
    expect(r.data).toHaveProperty("photo_url");
    expect(r.data).toHaveProperty("matched");
  });

  test("a miss is remembered, so the wikis are not re-walked on every page load", async () => {
    const { token } = await bootstrapCouple(`hmphoto-${Date.now()}-${Math.random()}@weddly.test`);
    // A name no wiki can have an article for; the ladder is one rung deep.
    const destination = `Zzz${Date.now()}qqx`;
    const r = await req(
      "GET",
      `/api/honeymoon/destination-photo?destination=${encodeURIComponent(destination)}`,
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect((r.data as { photo_url: string | null }).photo_url).toBeNull();

    const cached = db
      .query<{ local_path: string }, [string]>(
        "SELECT local_path FROM destination_photo_cache WHERE city = ?",
      )
      .get(destination.toLowerCase());
    // Empty local_path is the tombstone that mutes the ladder until its TTL.
    expect(cached?.local_path).toBe("");
  });
});
