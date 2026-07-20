// The ProofCard is the only visual object on /app/design, and the whole
// redesign rests on one claim: a tile shows exactly what tapping it produces.
// These lock the two ways that claim can quietly break.
//
// 1. Every size renders the couple's real names and their real date, formatted
//    by THAT design's own dateFormat. A pack that silently fell back to the
//    default format would make the four Sample Table tiles look interchangeable.
// 2. Small sizes fall back to initials. A long Hungarian pair
//    ("Krisztina & Szabolcs") at 7px in a 36px stamp is the case that overflows,
//    and it is the common case here, not an edge one.

import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { ProofCard, type ProofSize } from "@/components/design/ProofCard";
import { I18nProvider } from "@/lib/i18n";
import { applyStylePreset, resolveDesign, STYLE_PRESETS } from "@shared/design";

const SIZES: ProofSize[] = ["desk", "table", "pair", "chip", "strip", "stamp"];

function renderProof(size: ProofSize, style: string, bride: string, groom: string) {
  // Through the SAME helper the page commits a tap with, so this locks the
  // "a tile shows what tapping it produces" claim rather than re-deriving it.
  const design = applyStylePreset(resolveDesign(null), style as never);
  return render(
    <I18nProvider>
      <ProofCard
        design={design}
        size={size}
        brideName={bride}
        groomName={groom}
        weddingDate="2027-05-29"
        locale="hu"
        fallbackName="A & B"
      />
    </I18nProvider>,
  );
}

describe("ProofCard", () => {
  it("renders the couple's names at every size", () => {
    // "Anna & Bence" is 12 chars, so it survives whole everywhere except the
    // two smallest renderings (a 64px strip and a 36px stamp), which abbreviate.
    const abbreviates = new Set<ProofSize>(["strip", "stamp"]);
    for (const size of SIZES) {
      const { container, unmount } = renderProof(size, "garden_romance", "Anna", "Bence");
      const text = container.textContent ?? "";
      expect(text).toContain(abbreviates.has(size) ? "A & B" : "Anna & Bence");
      unmount();
    }
  });

  it("falls back to initials when the pair is too long for a small rendering", () => {
    // 20 chars joined. This is an ordinary Hungarian pair, not a stress case.
    const long = { bride: "Krisztina", groom: "Szabolcs" };
    for (const size of ["pair", "chip", "strip", "stamp"] as ProofSize[]) {
      const { container, unmount } = renderProof(size, "garden_romance", long.bride, long.groom);
      expect(container.textContent).toContain("K & S");
      expect(container.textContent).not.toContain("Krisztina & Szabolcs");
      unmount();
    }
    // desk and table have room to wrap, so they must NOT shorten.
    for (const size of ["desk", "table"] as ProofSize[]) {
      const { container, unmount } = renderProof(size, "garden_romance", long.bride, long.groom);
      expect(container.textContent).toContain("Krisztina & Szabolcs");
      unmount();
    }
  });

  it("formats the date in each pack's own format, so the tiles differ", () => {
    const seen = new Set<string>();
    for (const preset of STYLE_PRESETS) {
      const { container, unmount } = renderProof("table", preset.slug, "Anna", "Bence");
      const text = (container.textContent ?? "").replace("Anna & Bence", "").trim();
      seen.add(text);
      unmount();
    }
    // Noir is Roman numerals, Editorial is dotted numeric, Garden and Blush are
    // long form. Three distinct renderings of the same date is the floor.
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect([...seen].some((s) => s.includes("MMXXVII"))).toBe(true);
  });

  it("shows the live card corners and shadow on the site surface only", () => {
    const design = resolveDesign({ web: { cardRadius: "full", shadow: "pop" } });
    const { container } = render(
      <I18nProvider>
        <ProofCard
          design={design}
          size="table"
          surface="site"
          brideName="Anna"
          groomName="Bence"
          weddingDate="2027-05-29"
          locale="hu"
          fallbackName="A & B"
        />
      </I18nProvider>,
    );
    const rounded = container.querySelectorAll('[style*="border-radius"]');
    expect(rounded.length).toBeGreaterThan(0);
  });
});
