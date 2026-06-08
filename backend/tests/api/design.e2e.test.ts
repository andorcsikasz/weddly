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
  colors: Partial<Record<"primary" | "background" | "accent" | "text", string>>;
  headingFont: string | null;
  bodyFont: string | null;
  monogram: { enabled: boolean; separator: string };
  dateFormat: string;
  borderStyle: string;
  print: { border: boolean; ornament: boolean; qr: boolean };
  web: {
    cardRadius: string;
    shadow: string;
    buttonStyle: string;
    hiddenSections: string[];
    imageTreatment: string;
  };
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
      colors: {},
      headingFont: null,
      bodyFont: null,
      monogram: { enabled: true, separator: "amp" },
      dateFormat: "long",
      borderStyle: "hairline",
      print: { border: true, ornament: false, qr: false },
      web: {
        cardRadius: "soft",
        shadow: "soft",
        buttonStyle: "lifted",
        hiddenSections: [],
        imageTreatment: "none",
      },
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
      { design: { style: "modern_minimal", palette: "espresso", fonts: "modern_clean" } },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.couple.design.style).toBe("modern_minimal");
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

describe("design: editable custom colours + font families", () => {
  test("a valid custom colour persists, overrides the palette, and clears with null", async () => {
    wipeAll();
    const token = await registerVerified("design-color@weddly.test");
    const { couple } = await onboard(token);
    // Override two roles (mixed case in → stored lowercase).
    const set = await req<{ couple: { design: CoupleDesign } }>(
      "PATCH",
      "/api/couples/current",
      { design: { colors: { primary: "#AABBCC", text: "#112233" } } },
      { token },
    );
    expect(set.status).toBe(200);
    expect(set.data.couple.design.colors.primary).toBe("#aabbcc");
    expect(set.data.couple.design.colors.text).toBe("#112233");

    // The public payload resolves the override over the palette hex.
    db.prepare("UPDATE couples SET is_public = 1 WHERE id = ?").run(couple.id);
    const slug = (
      db.prepare("SELECT slug FROM couples WHERE id = ?").get(couple.id) as { slug: string }
    ).slug;
    const pub = await req<{ wedding: { design: { primary: string } } }>(
      "GET",
      `/api/public/wedding/${encodeURIComponent(slug)}`,
    );
    expect(pub.data.wedding.design.primary).toBe("#aabbcc");

    // `colors` is the authoritative full set (replace): resending only `text`
    // drops the `primary` override back to the palette.
    const cleared = await req<{ couple: { design: CoupleDesign } }>(
      "PATCH",
      "/api/couples/current",
      { design: { colors: { text: "#112233" } } },
      { token },
    );
    expect(cleared.status).toBe(200);
    expect(cleared.data.couple.design.colors.primary).toBeUndefined();
    expect(cleared.data.couple.design.colors.text).toBe("#112233");

    // An empty `colors` object clears every override.
    const wiped = await req<{ couple: { design: CoupleDesign } }>(
      "PATCH",
      "/api/couples/current",
      { design: { colors: {} } },
      { token },
    );
    expect(wiped.status).toBe(200);
    expect(wiped.data.couple.design.colors).toEqual({});
  });

  test("picking a palette clears existing custom colour overrides", async () => {
    wipeAll();
    const token = await registerVerified("design-color-reset@weddly.test");
    await onboard(token);
    await req(
      "PATCH",
      "/api/couples/current",
      { design: { colors: { accent: "#abcdef" } } },
      { token },
    );
    const r = await req<{ couple: { design: CoupleDesign } }>(
      "PATCH",
      "/api/couples/current",
      { design: { palette: "espresso", colors: {} } },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.couple.design.colors.accent).toBeUndefined();
  });

  test("a malformed hex and an unknown colour role are each rejected with 400", async () => {
    wipeAll();
    const token = await registerVerified("design-color-bad@weddly.test");
    await onboard(token);
    const badHex = await req(
      "PATCH",
      "/api/couples/current",
      { design: { colors: { primary: "blue" } } },
      { token },
    );
    expect(badHex.status).toBe(400);
    const badRole = await req(
      "PATCH",
      "/api/couples/current",
      { design: { colors: { border: "#aabbcc" } } },
      { token },
    );
    expect(badRole.status).toBe(400);
  });

  test("heading/body font family persists, resolves to a stack, and clears with null", async () => {
    wipeAll();
    const token = await registerVerified("design-family@weddly.test");
    const { couple } = await onboard(token);
    const set = await req<{ couple: { design: CoupleDesign } }>(
      "PATCH",
      "/api/couples/current",
      { design: { headingFont: "general_sans", bodyFont: "system_serif" } },
      { token },
    );
    expect(set.status).toBe(200);
    expect(set.data.couple.design.headingFont).toBe("general_sans");
    expect(set.data.couple.design.bodyFont).toBe("system_serif");

    db.prepare("UPDATE couples SET is_public = 1 WHERE id = ?").run(couple.id);
    const slug = (
      db.prepare("SELECT slug FROM couples WHERE id = ?").get(couple.id) as { slug: string }
    ).slug;
    const pub = await req<{ wedding: { design: { heading_font: string } } }>(
      "GET",
      `/api/public/wedding/${encodeURIComponent(slug)}`,
    );
    expect(pub.data.wedding.design.heading_font).toContain("General Sans");

    const cleared = await req<{ couple: { design: CoupleDesign } }>(
      "PATCH",
      "/api/couples/current",
      { design: { headingFont: null } },
      { token },
    );
    expect(cleared.status).toBe(200);
    expect(cleared.data.couple.design.headingFont).toBeNull();
  });

  test("an unknown font family is rejected with 400", async () => {
    wipeAll();
    const token = await registerVerified("design-family-bad@weddly.test");
    await onboard(token);
    const r = await req(
      "PATCH",
      "/api/couples/current",
      { design: { headingFont: "papyrus" } },
      { token },
    );
    expect(r.status).toBe(400);
  });
});

describe("design: design-aware print templates", () => {
  const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

  /** Fetch a print endpoint raw (the JSON `req` helper would choke on the
   *  binary PDF body) and assert it is a non-empty `%PDF` stream. */
  async function expectPdf(path: string, token: string): Promise<void> {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(0);
    // Every PDF stream opens with the "%PDF" magic.
    const head = new TextDecoder().decode(bytes.slice(0, 4));
    expect(head).toBe("%PDF");
  }

  test("table-numbers and menu render valid PDFs, and place-cards still does after the design change", async () => {
    wipeAll();
    const token = await registerVerified("design-print@weddly.test");
    await onboard(token);
    // Pick a non-default identity so the design actually threads through.
    await req(
      "PATCH",
      "/api/couples/current",
      { design: { palette: "espresso", fonts: "modern_clean" } },
      { token },
    );

    await expectPdf("/api/print/table-numbers", token);
    await expectPdf("/api/print/menu", token);
    await expectPdf("/api/print/place-cards", token);
  });
});

describe("design: website-only `web` sub-object", () => {
  test("a legacy flat blob (no web key) resolves to the default web object", async () => {
    wipeAll();
    const token = await registerVerified("design-web-legacy@weddly.test");
    const { couple } = await onboard(token);
    // Hand-write a legacy blob with NO `web` key, straight into the column.
    db.prepare("UPDATE couples SET design_json = ? WHERE id = ?").run(
      JSON.stringify({ palette: "espresso", decor: "dots" }),
      couple.id,
    );
    const me = await req<{ couple: { design: CoupleDesign } }>(
      "GET",
      "/api/couples/current",
      undefined,
      { token },
    );
    expect(me.data.couple.design.palette).toBe("espresso");
    // A legacy `decor` key in a stored blob is silently ignored now that the
    // decorative-style feature is gone (the resolved design has no such field).
    expect(me.data.couple.design.web).toEqual({
      cardRadius: "soft",
      shadow: "soft",
      buttonStyle: "lifted",
      hiddenSections: [],
      imageTreatment: "none",
    });
  });

  test("button style + hidden sections round-trip; invalid values 400", async () => {
    wipeAll();
    const token = await registerVerified("design-web2@weddly.test");
    const { couple } = await onboard(token);
    const r = await req<{ couple: { design: CoupleDesign } }>(
      "PATCH",
      "/api/couples/current",
      { design: { web: { buttonStyle: "outline", hiddenSections: ["wishlist", "schedule"] } } },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.couple.design.web.buttonStyle).toBe("outline");
    expect(r.data.couple.design.web.hiddenSections.sort()).toEqual(["schedule", "wishlist"]);

    // The public payload exposes them for the guest renderer.
    db.prepare("UPDATE couples SET is_public = 1 WHERE id = ?").run(couple.id);
    const slug = (
      db.prepare("SELECT slug FROM couples WHERE id = ?").get(couple.id) as { slug: string }
    ).slug;
    const pub = await req<{
      wedding: { design: { website_button_style: string; website_hidden_sections: string[] } };
    }>("GET", `/api/public/wedding/${encodeURIComponent(slug)}`);
    expect(pub.data.wedding.design.website_button_style).toBe("outline");
    expect(pub.data.wedding.design.website_hidden_sections).toContain("wishlist");

    const badBtn = await req(
      "PATCH",
      "/api/couples/current",
      { design: { web: { buttonStyle: "neon" } } },
      { token },
    );
    expect(badBtn.status).toBe(400);
    const badSection = await req(
      "PATCH",
      "/api/couples/current",
      { design: { web: { hiddenSections: ["rsvp"] } } },
      { token },
    );
    expect(badSection.status).toBe(400);
  });

  test("a valid web block round-trips and reaches the public payload as resolved CSS", async () => {
    wipeAll();
    const token = await registerVerified("design-web@weddly.test");
    const { couple } = await onboard(token);
    const r = await req<{ couple: { design: CoupleDesign } }>(
      "PATCH",
      "/api/couples/current",
      { design: { web: { cardRadius: "full", shadow: "pop" } } },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.couple.design.web.cardRadius).toBe("full");
    expect(r.data.couple.design.web.shadow).toBe("pop");

    db.prepare("UPDATE couples SET is_public = 1 WHERE id = ?").run(couple.id);
    const slug = (
      db.prepare("SELECT slug FROM couples WHERE id = ?").get(couple.id) as { slug: string }
    ).slug;
    const pub = await req<{
      wedding: { design: { website_card_radius: string; website_shadow: string } };
    }>("GET", `/api/public/wedding/${encodeURIComponent(slug)}`);
    // Resolved to a concrete CSS length / box-shadow, not the slug.
    expect(pub.data.wedding.design.website_card_radius).toBe("1.5rem");
    expect(pub.data.wedding.design.website_shadow).toContain("rgba");
  });

  test("image treatment round-trips, reaches the public payload, and rejects junk", async () => {
    wipeAll();
    const token = await registerVerified("design-web-img@weddly.test");
    const { couple } = await onboard(token);
    const r = await req<{ couple: { design: CoupleDesign } }>(
      "PATCH",
      "/api/couples/current",
      { design: { web: { imageTreatment: "grayscale" } } },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.couple.design.web.imageTreatment).toBe("grayscale");

    db.prepare("UPDATE couples SET is_public = 1 WHERE id = ?").run(couple.id);
    const slug = (
      db.prepare("SELECT slug FROM couples WHERE id = ?").get(couple.id) as { slug: string }
    ).slug;
    const pub = await req<{ wedding: { design: { website_image_treatment: string } } }>(
      "GET",
      `/api/public/wedding/${encodeURIComponent(slug)}`,
    );
    expect(pub.data.wedding.design.website_image_treatment).toBe("grayscale");

    const bad = await req(
      "PATCH",
      "/api/couples/current",
      { design: { web: { imageTreatment: "sepia" } } },
      { token },
    );
    expect(bad.status).toBe(400);
  });

  test("the Black Tie Editorial style resolves its monochrome palette + grayscale chrome", async () => {
    wipeAll();
    const token = await registerVerified("design-blacktie@weddly.test");
    await onboard(token);
    const r = await req<{ couple: { design: CoupleDesign } }>(
      "PATCH",
      "/api/couples/current",
      // The frontend applies the style's web defaults; mirror that here so the
      // persisted bundle is exercised end-to-end.
      {
        design: {
          style: "black_tie_editorial",
          palette: "noir_ivory",
          web: { imageTreatment: "grayscale", buttonStyle: "outline" },
        },
      },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.couple.design.style).toBe("black_tie_editorial");
    expect(r.data.couple.design.palette).toBe("noir_ivory");
    expect(r.data.couple.design.web.imageTreatment).toBe("grayscale");
  });

  test("an invalid web slug is rejected with 400", async () => {
    wipeAll();
    const token = await registerVerified("design-web-bad@weddly.test");
    await onboard(token);
    const r = await req(
      "PATCH",
      "/api/couples/current",
      { design: { web: { cardRadius: "spiky" } } },
      { token },
    );
    expect(r.status).toBe(400);
  });
});

describe("design: border style (supersedes the legacy print.border boolean)", () => {
  test("a valid border style round-trips; an invalid one 400s", async () => {
    wipeAll();
    const token = await registerVerified("design-border@weddly.test");
    await onboard(token);
    const r = await req<{ couple: { design: CoupleDesign } }>(
      "PATCH",
      "/api/couples/current",
      { design: { borderStyle: "double" } },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.couple.design.borderStyle).toBe("double");

    const bad = await req(
      "PATCH",
      "/api/couples/current",
      { design: { borderStyle: "groovy" } },
      { token },
    );
    expect(bad.status).toBe(400);
  });

  test("a legacy blob with print.border true/false folds to hairline/none", async () => {
    wipeAll();
    const token = await registerVerified("design-border-legacy@weddly.test");
    const { couple } = await onboard(token);
    // Legacy blob: no borderStyle key, only the old print.border boolean.
    db.prepare("UPDATE couples SET design_json = ? WHERE id = ?").run(
      JSON.stringify({ print: { border: false } }),
      couple.id,
    );
    const me = await req<{ couple: { design: CoupleDesign } }>(
      "GET",
      "/api/couples/current",
      undefined,
      { token },
    );
    expect(me.data.couple.design.borderStyle).toBe("none");
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
