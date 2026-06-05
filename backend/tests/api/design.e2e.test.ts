// Design feature — the curated visual identity persisted on couples.design_json
// and exposed (resolved) on the couple DTO + the public wedding-website view.
// Owns the wire contract: PATCH persistence + slug validation + merge-on-
// partial, the Botanical Green default for NULL rows, the public payload at
// every tier, and the per-cluster audit row. The catalog values themselves
// live in shared/design.ts.

import "../setup";

import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { req, verifyUserEmail, wipeAll } from "../helpers";

interface RegisterResp {
  token: string;
  user: { id: number; email: string };
}

interface CoupleDesign {
  style: string;
  palette: string;
  fonts: string;
  print: { border: boolean; ornament: boolean; qr: boolean };
}

async function registerVerified(email: string): Promise<string> {
  const r = await req<RegisterResp>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Design Test",
  });
  expect(r.status).toBe(201);
  await verifyUserEmail(email);
  return r.data.token;
}

async function onboard(token: string): Promise<{ couple: { id: number; design: CoupleDesign } }> {
  const r = await req<{ couple: { id: number; design: CoupleDesign } }>(
    "POST",
    "/api/couples/onboard",
    {
      display_name: "Mira & Levi",
      wedding_date_goal: { kind: "tbd", exact_date: null },
      guest_count_goal: { kind: "tbd" },
      budget_goal: { kind: "tbd" },
    },
    { token },
  );
  expect(r.status).toBe(201);
  return r.data;
}

describe("design: default resolution", () => {
  test("a fresh couple (NULL design_json) reads back as Botanical Green", async () => {
    wipeAll();
    const token = await registerVerified("design-default@weddly.test");
    const { couple } = await onboard(token);
    // NULL in the DB, fully-resolved default on the DTO.
    const stored = db.prepare("SELECT design_json FROM couples WHERE id = ?").get(couple.id) as {
      design_json: string | null;
    };
    expect(stored.design_json).toBeNull();
    expect(couple.design).toEqual({
      style: "botanical_green",
      palette: "botanical_green",
      fonts: "classic_serif",
      print: { border: true, ornament: false, qr: false },
    });
  });
});

describe("design: PATCH /api/couples/current", () => {
  test("a valid design persists, round-trips, and writes one audit row", async () => {
    wipeAll();
    const token = await registerVerified("design-patch@weddly.test");
    const { couple } = await onboard(token);
    const r = await req<{ couple: { design: CoupleDesign } }>(
      "PATCH",
      "/api/couples/current",
      { design: { style: "editorial", palette: "espresso", fonts: "modern_clean" } },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.couple.design.style).toBe("editorial");
    expect(r.data.couple.design.palette).toBe("espresso");
    expect(r.data.couple.design.fonts).toBe("modern_clean");

    // Round-trips on a fresh GET.
    const me = await req<{ couple: { design: CoupleDesign } }>(
      "GET",
      "/api/couples/current",
      undefined,
      { token },
    );
    expect(me.data.couple.design.palette).toBe("espresso");

    const audit = db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE couple_id = ? AND action = ?")
      .get(couple.id, "couple.design_update") as { n: number };
    expect(audit.n).toBe(1);
  });

  test("a partial PATCH merges onto the current design without wiping other fields", async () => {
    wipeAll();
    const token = await registerVerified("design-merge@weddly.test");
    await onboard(token);
    // First set a full identity.
    await req(
      "PATCH",
      "/api/couples/current",
      { design: { style: "romantic_soft", palette: "blush", fonts: "soft_romantic" } },
      { token },
    );
    // Then change only the palette — style + fonts must survive.
    const r = await req<{ couple: { design: CoupleDesign } }>(
      "PATCH",
      "/api/couples/current",
      { design: { palette: "sage_cream", print: { border: false } } },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.couple.design.style).toBe("romantic_soft");
    expect(r.data.couple.design.fonts).toBe("soft_romantic");
    expect(r.data.couple.design.palette).toBe("sage_cream");
    expect(r.data.couple.design.print.border).toBe(false);
    // The untouched print toggles keep their default.
    expect(r.data.couple.design.print.qr).toBe(false);
  });

  test("an invalid palette slug is rejected with 400 and persists nothing", async () => {
    wipeAll();
    const token = await registerVerified("design-bad@weddly.test");
    await onboard(token);
    const r = await req(
      "PATCH",
      "/api/couples/current",
      { design: { palette: "neon_chaos" } },
      { token },
    );
    expect(r.status).toBe(400);
    const stored = db.prepare("SELECT design_json FROM couples").get() as {
      design_json: string | null;
    };
    expect(stored.design_json).toBeNull();
  });

  test("an invalid style and an invalid font are each rejected with 400", async () => {
    wipeAll();
    const token = await registerVerified("design-bad2@weddly.test");
    await onboard(token);
    const badStyle = await req(
      "PATCH",
      "/api/couples/current",
      { design: { style: "not_a_style" } },
      { token },
    );
    expect(badStyle.status).toBe(400);
    const badFont = await req(
      "PATCH",
      "/api/couples/current",
      { design: { fonts: "comic_sans" } },
      { token },
    );
    expect(badFont.status).toBe(400);
  });
});

describe("design: public wedding-website payload", () => {
  test("the public view exposes resolved hex + font stacks (never the slugs)", async () => {
    wipeAll();
    const token = await registerVerified("design-public@weddly.test");
    const { couple } = await onboard(token);
    await req(
      "PATCH",
      "/api/couples/current",
      { design: { palette: "espresso", fonts: "modern_clean" } },
      { token },
    );
    // Publish so the anonymous /w/:slug surface resolves.
    db.prepare("UPDATE couples SET is_public = 1 WHERE id = ?").run(couple.id);
    const slug = (
      db.prepare("SELECT slug FROM couples WHERE id = ?").get(couple.id) as {
        slug: string;
      }
    ).slug;

    const r = await req<{ wedding: { design: Record<string, string> } }>(
      "GET",
      `/api/public/wedding/${encodeURIComponent(slug)}`,
    );
    expect(r.status).toBe(200);
    const d = r.data.wedding.design;
    // Espresso primary hex from the catalog; resolved, not a slug.
    expect(d.primary).toBe("#4A3B32");
    expect(d.heading_font).toContain("General Sans");
    // The internal slugs must NOT leak onto the public payload.
    expect("palette" in d).toBe(false);
    expect("style" in d).toBe(false);
  });
});
