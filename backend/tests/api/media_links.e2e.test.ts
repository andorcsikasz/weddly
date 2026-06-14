// 15-user media_links probe — covers the photographer gallery link save/clear
// flow that backs the "By photographer" card on /app/media. Tests span:
//
//   A. 15 couples concurrently save links → all succeed, no cross-couple bleed
//   B. All three slots (guests / photographer / other) work independently
//   C. Partial update: one slot doesn't wipe the others
//   D. Null / empty-string clear flow
//   E. Partner B (invited second user) sees the same links as partner A
//   F. Input validation: non-http, non-string, too-long, non-object all rejected

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req, wipeAll } from "../helpers";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

type MediaLinks = { guests: string | null; photographer: string | null; other: string | null };
type CoupleResp = { couple: { id: number; media_links: MediaLinks } };

async function getLinks(token: string): Promise<MediaLinks> {
  const r = await req<CoupleResp>("GET", "/api/couples/current", undefined, { token });
  expect(r.status).toBe(200);
  return r.data.couple.media_links;
}

async function setLinks(
  token: string,
  patch: Record<string, string | null>,
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
        : { guests: null, photographer: null, other: null },
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
      couples.map(({ token, url }) => setLinks(token, { photographer: url })),
    );
    expect(saves.every((s) => s.status === 200)).toBe(true);

    // Each couple reads back only their own link.
    const reads = await Promise.all(couples.map(({ token }) => getLinks(token)));
    for (let i = 0; i < COHORT; i++) {
      expect(reads[i]!.photographer).toBe(couples[i]!.url);
      // guests and other must remain null — no spillover from other couples.
      expect(reads[i]!.guests).toBeNull();
      expect(reads[i]!.other).toBeNull();
    }

    // Every link is distinct — no couple received a neighbor's value.
    const stored = reads.map((r) => r.photographer);
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
    await setLinks(token, { photographer: "https://photographer.example.com" });
    await setLinks(token, { other: "https://other.example.com" });

    const links = await getLinks(token);
    expect(links.guests).toBe("https://guests.example.com/");
    expect(links.photographer).toBe("https://photographer.example.com/");
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
      photographer: "https://photographer.example.com",
      other: "https://other.example.com",
    });

    // Update only photographer.
    const { status, links } = await setLinks(token, {
      photographer: "https://new-gallery.example.com",
    });
    expect(status).toBe(200);
    expect(links.photographer).toBe("https://new-gallery.example.com/");
    expect(links.guests).toBe("https://guests.example.com/");
    expect(links.other).toBe("https://other.example.com/");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Null / empty-string clears the slot
// ─────────────────────────────────────────────────────────────────────────────

describe("D. clearing a link", () => {
  test("null removes the slot", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("photos-d1@weddly.test");
    await setLinks(token, { photographer: "https://gallery.example.com" });
    const { status, links } = await setLinks(token, { photographer: null });
    expect(status).toBe(200);
    expect(links.photographer).toBeNull();
  });

  test("empty string is treated as null (clear)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("photos-d2@weddly.test");
    await setLinks(token, { photographer: "https://gallery.example.com" });
    const { status, links } = await setLinks(token, { photographer: "" });
    expect(status).toBe(200);
    expect(links.photographer).toBeNull();
  });

  test("clearing the last slot nullifies the whole media_links object", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("photos-d3@weddly.test");
    await setLinks(token, { photographer: "https://gallery.example.com" });
    await setLinks(token, { photographer: null });
    const links = await getLinks(token);
    expect(links.guests).toBeNull();
    expect(links.photographer).toBeNull();
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
      photographer: "https://gallery.example.com",
      other: "https://other.example.com",
    });

    // Register partner B first (no couple yet), then invite and accept.
    const regB = await req<{ token: string }>("POST", "/api/auth/register", {
      email: "photos-e-b@weddly.test",
      password: "supersafe123",
      full_name: "Partner B",
    });
    expect(regB.status).toBe(201);
    const tokenB = regB.data.token;
    const { verifyUserEmail } = await import("../helpers");
    await verifyUserEmail("photos-e-b@weddly.test");

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
    expect(linksB.photographer).toBe("https://gallery.example.com/");
    expect(linksB.other).toBe("https://other.example.com/");
    expect(linksB.guests).toBeNull();

    // Partner B can also update the link and A sees the change.
    await setLinks(tokenB, { photographer: "https://updated-gallery.example.com" });
    const linksA = await getLinks(tokenA);
    expect(linksA.photographer).toBe("https://updated-gallery.example.com/");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. Input validation — 15 invalid payloads all rejected
// ─────────────────────────────────────────────────────────────────────────────

describe("F. input validation", () => {
  const CASES: Array<{ label: string; payload: unknown }> = [
    // Non-http schemes
    { label: "ftp:// rejected", payload: { photographer: "ftp://gallery.example.com" } },
    { label: "javascript: rejected", payload: { photographer: "javascript:alert(1)" } },
    { label: "data: rejected", payload: { photographer: "data:text/html,<h1>x</h1>" } },
    { label: "file:// rejected", payload: { photographer: "file:///etc/passwd" } },
    { label: "ssh:// rejected", payload: { photographer: "ssh://user@host" } },
    // Not a URL at all
    { label: "bare word rejected", payload: { photographer: "not-a-url" } },
    { label: "relative path rejected", payload: { photographer: "/some/path" } },
    // Non-string value for a slot
    { label: "number slot rejected", payload: { photographer: 42 } },
    { label: "array slot rejected", payload: { photographer: ["https://x.com"] } },
    { label: "object slot rejected", payload: { photographer: { url: "https://x.com" } } },
    { label: "true slot rejected", payload: { photographer: true } },
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
