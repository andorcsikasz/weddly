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
// Resolution talks to Wikivoyage/Wikipedia/Commons, so `HONEYMOON_PHOTO_FAKE=1`
// (pinned in tests/setup.ts) swaps it for a stub that "has a photo of" a
// handful of places. That is what makes the ladder assertable: against the
// live wikis every rung answers, so a test could never prove the walk reached
// the city rather than stopping at the church.

type PhotoResponse = { photo_url: string | null; matched: string | null };

async function photoFor(token: string, destination: string) {
  return req<PhotoResponse>(
    "GET",
    `/api/honeymoon/destination-photo?destination=${encodeURIComponent(destination)}&lang=hu`,
    undefined,
    { token },
  );
}

const freshCouple = () =>
  bootstrapCouple(`hmphoto-${Date.now()}-${Math.random().toString(36).slice(2)}@weddly.test`);

describe("honeymoon photo — endpoint", () => {
  test("requires a session", async () => {
    const r = await req("GET", "/api/honeymoon/destination-photo?destination=Bali");
    expect(r.status).toBe(401);
  });

  test("an absent or blank destination answers null", async () => {
    const { token } = await freshCouple();
    for (const q of ["", "?destination=", "?destination=%20%20"]) {
      const r = await req("GET", `/api/honeymoon/destination-photo${q}`, undefined, { token });
      expect(r.status).toBe(200);
      expect(r.data).toEqual({ photo_url: null, matched: null });
    }
  });

  test("a city resolves on the first rung and says so", async () => {
    const { token } = await freshCouple();
    const r = await photoFor(token, "Bali, Indonézia");
    expect(r.status).toBe(200);
    expect(r.data.matched).toBe("Bali");
    expect(r.data.photo_url).toBe("/uploads/destination-photos/bali.jpg");
  });

  test("a venue with no photo falls through to the CITY, not to the country", async () => {
    // The whole point of the ladder. The stub has Róma and Magyarország but
    // nothing between, so a result of "Róma" proves the walk skipped the
    // church and the districts and stopped at the first rung that answered.
    const { token } = await freshCouple();
    const r = await photoFor(
      token,
      "Chiesa di San Girolamo dei Croati, Via Tomacelli, Campo Marzio, Municipio Roma I, Róma, Roma Capitale, Lazio, Olaszország",
    );
    expect(r.status).toBe(200);
    expect(r.data.matched).toBe("Róma");
    expect(r.data.photo_url).toBe("/uploads/destination-photos/r-ma.jpg");
  });

  test("the full destination string is cached, so a repeat is one row read", async () => {
    const { token } = await freshCouple();
    const destination = "Valami Kápolna, Fő utca, Szentbékkálla, Magyarország";
    const first = await photoFor(token, destination);
    expect(first.data.matched).toBe("Magyarország");
    const firstUrl = first.data.photo_url;
    expect(firstUrl).toBeTruthy();

    // Both ends of the ladder are remembered: the rung that won (shared with
    // every other couple going there) and this couple's whole breadcrumb.
    const byFull = db
      .query<{ local_path: string; matched: string | null }, [string]>(
        "SELECT local_path, matched FROM destination_photo_cache WHERE city = ?",
      )
      .get(destination.toLowerCase());
    expect(byFull?.matched).toBe("Magyarország");
    expect(byFull?.local_path).toBe(firstUrl as string);

    const second = await photoFor(token, destination);
    expect(second.data).toEqual(first.data);
  });

  test("a miss is remembered, so the wikis are not re-walked on every page load", async () => {
    const { token } = await freshCouple();
    const destination = "Nowhereton, Nowhereshire, Nowhereland";
    const r = await photoFor(token, destination);
    expect(r.status).toBe(200);
    expect(r.data.photo_url).toBeNull();

    const cached = db
      .query<{ local_path: string }, [string]>(
        "SELECT local_path FROM destination_photo_cache WHERE city = ?",
      )
      .get(destination.toLowerCase());
    // Empty local_path is the tombstone that mutes the ladder until its TTL.
    expect(cached?.local_path).toBe("");
  });
});
