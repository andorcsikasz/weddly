// Design feature — the curated visual identity persisted on couples.design_json
// and exposed (resolved) on the couple DTO + the public wedding-website view.
// Owns the wire contract: PATCH persistence + slug validation + merge-on-
// partial, the Classic Elegant default for NULL rows, the public payload at
// every tier, and the per-cluster audit row. The catalog values themselves
// live in shared/design.ts.

import "../setup";

import { describe, expect, test } from "bun:test";
import {
  DATE_FORMATS,
  FONT_FAMILIES,
  FONT_PRESETS,
  formatWeddingDate,
  getFontFamilyStack,
  getStylePreset,
  resolveDesign,
  STYLE_PRESETS,
  toPublicDesign,
  toRomanNumeral,
} from "@shared/design";
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

describe("design: font preset → family mapping", () => {
  // The per-family picker highlights the family a preset resolves to while no
  // override is set, so each preset's headingFamily/bodyFamily must be a real
  // family whose typeface leads the preset's matching stack. If a mapping drifts
  // the picker would highlight the wrong "Aa" chip.
  test("every preset maps to a real family whose typeface matches its stack", () => {
    const slugs = new Set(FONT_FAMILIES.map((f) => f.slug));
    for (const p of FONT_PRESETS) {
      expect(slugs.has(p.headingFamily)).toBe(true);
      expect(slugs.has(p.bodyFamily)).toBe(true);
      const headLead = getFontFamilyStack(p.headingFamily).split(",")[0]!;
      const bodyLead = getFontFamilyStack(p.bodyFamily).split(",")[0]!;
      expect(p.headingStack.startsWith(headLead)).toBe(true);
      expect(p.bodyStack.startsWith(bodyLead)).toBe(true);
    }
  });
});

describe("design: style packs + roman date (M0)", () => {
  test("the four active packs each carry an ornament, layout, and seeded date", () => {
    const slugs = STYLE_PRESETS.map((s) => s.slug);
    expect(slugs).toEqual([
      "garden_romance",
      "modern_monochrome",
      "blush_romantic",
      "midnight_luxe",
    ]);
    for (const p of STYLE_PRESETS) {
      expect(["botanical", "none", "oval", "deco"]).toContain(p.ornament);
      expect(["centered", "asymmetric", "framed", "corners"]).toContain(p.cardLayout);
      expect(DATE_FORMATS.some((d) => d.slug === p.defaultDateFormat)).toBe(true);
    }
    // Midnight Luxe is the Roman-numeral, small-caps, deco-corner pack.
    const noir = getStylePreset("midnight_luxe");
    expect(noir.defaultDateFormat).toBe("roman");
    expect(noir.ornament).toBe("deco");
    expect(noir.headingStyle).toBe("small_caps");
  });

  test("toPublicDesign exposes the active pack's ornament + layout + heading style", () => {
    const pub = toPublicDesign(resolveDesign({ style: "midnight_luxe" }));
    expect(pub.ornament).toBe("deco");
    expect(pub.card_layout).toBe("corners");
    expect(pub.heading_style).toBe("small_caps");
    // A pack with no heading treatment exposes null, not undefined.
    expect(toPublicDesign(resolveDesign({ style: "blush_romantic" })).heading_style).toBeNull();
  });

  test("a legacy style slug degrades to the default pack but keeps its palette", () => {
    const d = resolveDesign({ style: "black_tie_editorial", palette: "midnight" });
    // The retired style slug is no longer in STYLE_PRESETS → degrades to default.
    expect(d.style).toBe("garden_romance");
    // ...but the stored palette is still valid and renders unchanged.
    expect(d.palette).toBe("midnight");
  });

  test("roman date format renders arabic day · roman month · roman year", () => {
    expect(formatWeddingDate("2027-06-10", "roman", "en")).toBe("10 · VI · MMXXVII");
    expect(formatWeddingDate("2027-06-10", "roman", "hu")).toBe("10 · VI · MMXXVII");
    expect(toRomanNumeral(2027)).toBe("MMXXVII");
    expect(toRomanNumeral(6)).toBe("VI");
    expect(toRomanNumeral(4)).toBe("IV");
    expect(toRomanNumeral(1944)).toBe("MCMXLIV");
    // Out-of-range stays arabic rather than throwing.
    expect(toRomanNumeral(0)).toBe("0");
    expect(toRomanNumeral(4000)).toBe("4000");
  });
});

describe("design: default resolution", () => {
  test("a fresh couple (NULL design_json) reads back as Garden Romance", async () => {
    wipeAll();
    const token = await registerVerified("design-default@weddly.test");
    const { couple } = await onboard(token);
    // NULL in the DB, fully-resolved default on the DTO.
    const stored = db.prepare("SELECT design_json FROM couples WHERE id = ?").get(couple.id) as {
      design_json: string | null;
    };
    expect(stored.design_json).toBeNull();
    expect(couple.design).toEqual({
      style: "garden_romance",
      palette: "garden",
      fonts: "garden_serif",
      colors: {},
      headingFont: null,
      bodyFont: null,
      monogram: { enabled: true, separator: "amp" },
      dateFormat: "long",
      borderStyle: "none",
      print: { border: false, ornament: true, qr: false },
      web: {
        cardRadius: "soft",
        shadow: "soft",
        buttonStyle: "outline",
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
      { design: { style: "modern_monochrome", palette: "espresso", fonts: "modern_clean" } },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.couple.design.style).toBe("modern_monochrome");
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
      { design: { style: "blush_romantic", palette: "blush", fonts: "soft_romantic" } },
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
    expect(r.data.couple.design.style).toBe("blush_romantic");
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

  test("every style pack embeds its fonts and renders valid card PDFs", async () => {
    wipeAll();
    const token = await registerVerified("design-packs-print@weddly.test");
    await onboard(token);
    // Move off the default pack (Garden) so the first loop iteration is a real
    // change rather than a no-op PATCH (which the handler 400s).
    await req("PATCH", "/api/couples/current", { design: { style: "midnight_luxe" } }, { token });
    // Each pack pulls in a different bundled display face (Cormorant italic /
    // DM Sans / Bodoni + Crimson / Cormorant SC + EB Garamond) plus its own
    // date format (Roman for Midnight) — so this catches a bad font embed or a
    // formatter crash on any single pack.
    for (const style of [
      "garden_romance",
      "modern_monochrome",
      "blush_romantic",
      "midnight_luxe",
    ] as const) {
      const r = await req("PATCH", "/api/couples/current", { design: { style } }, { token });
      expect(r.status).toBe(200);
      await expectPdf("/api/print/menu", token);
      await expectPdf("/api/print/table-numbers", token);
      await expectPdf("/api/print/place-cards", token);
    }
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
      buttonStyle: "outline",
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

  test("a style with explicit web chrome round-trips end-to-end", async () => {
    wipeAll();
    const token = await registerVerified("design-editorial@weddly.test");
    await onboard(token);
    const r = await req<{ couple: { design: CoupleDesign } }>(
      "PATCH",
      "/api/couples/current",
      {
        design: {
          style: "midnight_luxe",
          palette: "noir",
          web: { imageTreatment: "grayscale", buttonStyle: "outline" },
        },
      },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.couple.design.style).toBe("midnight_luxe");
    expect(r.data.couple.design.palette).toBe("noir");
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
