// media_links probe — covers the Photos-page link save/clear flow that backs
// the "Pro Gallery" (photographer) + guests/other cards on /app/media. The
// photographer slot is a list (up to MAX_PHOTOGRAPHER_LINKS); guests/other stay
// single links. Tests span:
//
//   A. 15 couples concurrently save links → all succeed, no cross-couple bleed
//   B. All three slots (guests / photographer / other) work independently
//   C. Partial update: one slot doesn't wipe the others
//   D. Null / empty-string clear flow
//   E. Partner B (invited second user) sees the same links as partner A
//   F. Input validation: non-http, non-string items, too-long, non-object rejected
//   G. Pro Gallery: array of up to 3 links, legacy single-string coercion, cap

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

type MediaLinks = { guests: string | null; photographer: string[]; other: string | null };
type CoupleResp = { couple: { id: number; media_links: MediaLinks } };

async function getLinks(token: string): Promise<MediaLinks> {
  const r = await req<CoupleResp>("GET", "/api/couples/current", undefined, { token });
  expect(r.status).toBe(200);
  return r.data.couple.media_links;
}

async function setLinks(
  token: string,
  patch: Record<string, unknown>,
): Promise<{ status: number; links: MediaLinks }> {
  const r = await req<CoupleResp>(
    "PATCH",
    "/api/couples/current",
    { media_links: patch },
    { token },
  );
  return {
    status: r.status,
    links:
      r.status === 200
        ? r.data.couple.media_links
        : { guests: null, photographer: [], other: null },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A. 15 couples concurrently save photographer links — no collision, no bleed
// ─────────────────────────────────────────────────────────────────────────────

describe("A. 15 concurrent photographer link saves", () => {
  test("each couple saves a unique link and reads it back correctly", async () => {
    wipeAll();
    const COHORT = 15;
    const couples = await Promise.all(
      Array.from({ length: COHORT }, async (_, i) => {
        const { token } = await bootstrapCouple(`photos-a-${i}@weddly.test`);
        return { token, url: `https://gallery.example.com/wedding-${i}` };
      }),
    );

    // All save their own link in parallel.
    const saves = await Promise.all(
      couples.map(({ token, url }) => setLinks(token, { photographer: [url] })),
    );
    expect(saves.every((s) => s.status === 200)).toBe(true);

    // Each couple reads back only their own link.
    const reads = await Promise.all(couples.map(({ token }) => getLinks(token)));
    for (let i = 0; i < COHORT; i++) {
      expect(reads[i]!.photographer).toEqual([couples[i]!.url]);
      // guests and other must remain unset — no spillover from other couples.
      expect(reads[i]!.guests).toBeNull();
      expect(reads[i]!.other).toBeNull();
    }

    // Every link is distinct — no couple received a neighbor's value.
    const stored = reads.map((r) => r.photographer[0]);
    expect(new Set(stored).size).toBe(COHORT);
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// B. All three slots operate independently
// ─────────────────────────────────────────────────────────────────────────────

describe("B. all three slots are independent", () => {
  test("guests / photographer / other each persist without overwriting the others", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("photos-b@weddly.test");

    await setLinks(token, { guests: "https://guests.example.com" });
    await setLinks(token, { photographer: ["https://photographer.example.com"] });
    await setLinks(token, { other: "https://other.example.com" });

    const links = await getLinks(token);
    expect(links.guests).toBe("https://guests.example.com/");
    expect(links.photographer).toEqual(["https://photographer.example.com/"]);
    expect(links.other).toBe("https://other.example.com/");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. Partial update preserves existing slots
// ─────────────────────────────────────────────────────────────────────────────

describe("C. partial update", () => {
  test("patching one slot leaves the others unchanged", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("photos-c@weddly.test");

    // Seed all three.
    await setLinks(token, {
      guests: "https://guests.example.com",
      photographer: ["https://photographer.example.com"],
      other: "https://other.example.com",
    });

    // Update only photographer.
    const { status, links } = await setLinks(token, {
      photographer: ["https://new-gallery.example.com"],
    });
    expect(status).toBe(200);
    expect(links.photographer).toEqual(["https://new-gallery.example.com/"]);
    expect(links.guests).toBe("https://guests.example.com/");
    expect(links.other).toBe("https://other.example.com/");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Null / empty clears the photographer slot
// ─────────────────────────────────────────────────────────────────────────────

describe("D. clearing links", () => {
  test("null empties the photographer slot", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("photos-d1@weddly.test");
    await setLinks(token, { photographer: ["https://gallery.example.com"] });
    const { status, links } = await setLinks(token, { photographer: null });
    expect(status).toBe(200);
    expect(links.photographer).toEqual([]);
  });

  test("empty string is dropped (clear)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("photos-d2@weddly.test");
    await setLinks(token, { photographer: ["https://gallery.example.com"] });
    const { status, links } = await setLinks(token, { photographer: "" });
    expect(status).toBe(200);
    expect(links.photographer).toEqual([]);
  });

  test("clearing the last slot nullifies the whole media_links object", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("photos-d3@weddly.test");
    await setLinks(token, { photographer: ["https://gallery.example.com"] });
    await setLinks(token, { photographer: [] });
    const links = await getLinks(token);
    expect(links.guests).toBeNull();
    expect(links.photographer).toEqual([]);
    expect(links.other).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. Partner B sees the same links as partner A
// ─────────────────────────────────────────────────────────────────────────────

describe("E. couple-shared visibility", () => {
  test("invited partner reads the same media_links after A saves them", async () => {
    wipeAll();
    const { token: tokenA } = await bootstrapCouple("photos-e-a@weddly.test");
    await setLinks(tokenA, {
      photographer: ["https://gallery.example.com"],
      other: "https://other.example.com",
    });

    // Register partner B first (no couple yet), then invite and accept.
    const regB = await registerAndVerify({
      email: "photos-e-b@weddly.test",
      password: "supersafe123",
      full_name: "Bea Nagy",
    });
    expect(regB.status).toBe(201);
    const tokenB = regB.data.token;

    const inviteR = await req<{ invite: { token: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "photos-e-b@weddly.test" },
      { token: tokenA },
    );
    expect(inviteR.status).toBe(201);
    const inviteToken = inviteR.data.invite.token;

    const joinR = await req("POST", `/api/invites/${inviteToken}/accept`, {}, { token: tokenB });
    expect(joinR.status).toBe(200);

    const linksB = await getLinks(tokenB);
    expect(linksB.photographer).toEqual(["https://gallery.example.com/"]);
    expect(linksB.other).toBe("https://other.example.com/");
    expect(linksB.guests).toBeNull();

    // Partner B can also update the link and A sees the change.
    await setLinks(tokenB, { photographer: ["https://updated-gallery.example.com"] });
    const linksA = await getLinks(tokenA);
    expect(linksA.photographer).toEqual(["https://updated-gallery.example.com/"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. Input validation — invalid payloads all rejected
// ─────────────────────────────────────────────────────────────────────────────

describe("F. input validation", () => {
  const CASES: Array<{ label: string; payload: unknown }> = [
    // Non-http schemes (single-string photographer)
    { label: "ftp:// rejected", payload: { photographer: "ftp://gallery.example.com" } },
    { label: "javascript: rejected", payload: { photographer: "javascript:alert(1)" } },
    { label: "data: rejected", payload: { photographer: "data:text/html,<h1>x</h1>" } },
    { label: "file:// rejected", payload: { photographer: "file:///etc/passwd" } },
    { label: "ssh:// rejected", payload: { photographer: "ssh://user@host" } },
    // Not a URL at all
    { label: "bare word rejected", payload: { photographer: "not-a-url" } },
    { label: "relative path rejected", payload: { photographer: "/some/path" } },
    // Invalid values inside the photographer array
    {
      label: "array with a bad URL rejected",
      payload: { photographer: ["https://ok.example.com", "ftp://bad.example.com"] },
    },
    {
      label: "array with a non-string item rejected",
      payload: { photographer: ["https://ok.example.com", 42] },
    },
    // Non-string, non-array value for the photographer slot
    { label: "number slot rejected", payload: { photographer: 42 } },
    { label: "object slot rejected", payload: { photographer: { url: "https://x.com" } } },
    { label: "true slot rejected", payload: { photographer: true } },
    // Over the cap
    {
      label: "4 links rejected",
      payload: {
        photographer: [
          "https://a.example.com/1",
          "https://b.example.com/2",
          "https://c.example.com/3",
          "https://d.example.com/4",
        ],
      },
    },
    // Badly typed media_links container
    { label: "string container rejected", payload: "https://example.com" },
    { label: "array container rejected", payload: ["https://example.com"] },
    { label: "number container rejected", payload: 42 },
    // URL too long
    {
      label: "URL >2048 chars rejected",
      payload: { photographer: `https://example.com/${"x".repeat(2050)}` },
    },
  ];

  // One bootstrapped couple for all validation probes (no wipeAll between
  // cases — the couple state doesn't matter, we're only checking 400s).
  let token = "";

  test("setup: bootstrap validation couple", async () => {
    wipeAll();
    const c = await bootstrapCouple("photos-f@weddly.test");
    token = c.token;
  }, 15_000);

  for (const { label, payload } of CASES) {
    test(label, async () => {
      const r = await req("PATCH", "/api/couples/current", { media_links: payload }, { token });
      expect(r.status).toBe(400);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// G. Pro Gallery — up to 3 links, legacy coercion, empties dropped
// ─────────────────────────────────────────────────────────────────────────────

describe("G. Pro Gallery multi-link", () => {
  test("saves up to 3 links and reads them back in order", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("photos-g1@weddly.test");
    const urls = ["https://a.example.com/x", "https://b.example.com/y", "https://c.example.com/z"];
    const { status, links } = await setLinks(token, { photographer: urls });
    expect(status).toBe(200);
    expect(links.photographer).toEqual(urls);
  });

  test("a single string is coerced to a one-element array (legacy client)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("photos-g2@weddly.test");
    const { links } = await setLinks(token, { photographer: "https://legacy.example.com/album" });
    expect(links.photographer).toEqual(["https://legacy.example.com/album"]);
  });

  test("empty / whitespace entries are dropped", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("photos-g3@weddly.test");
    const { links } = await setLinks(token, {
      photographer: ["https://a.example.com/x", "", "   "],
    });
    expect(links.photographer).toEqual(["https://a.example.com/x"]);
  });
});
