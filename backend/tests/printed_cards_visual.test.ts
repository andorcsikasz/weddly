import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BORDER_STYLES, resolveDesign } from "@shared/design";
import { PRINT_CARD_TYPES } from "@shared/print_cards";
import { renderPrintableCardPdf } from "../src/domain/pdf";
import {
  printedCardAdditionalVisualCases,
  printedCardVisualDocuments,
} from "./fixtures/printed_cards";

const baselineDir = resolve(import.meta.dir, "visual_baselines/printed_cards");

function rasterize(pdf: Uint8Array, name: string): Uint8Array {
  const temporary = mkdtempSync(join(tmpdir(), "weddly-card-visual-"));
  try {
    const pdfPath = join(temporary, `${name}.pdf`);
    const rasterRoot = join(temporary, name);
    writeFileSync(pdfPath, pdf);
    const result = Bun.spawnSync([
      "pdftoppm",
      "-f",
      "1",
      "-singlefile",
      "-r",
      "96",
      pdfPath,
      rasterRoot,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`pdftoppm is required for printed-card visual tests: ${result.stderr}`);
    }
    return readFileSync(`${rasterRoot}.ppm`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function ppmPixelOffset(ppm: Uint8Array): number {
  // Poppler emits P6 plus width/height/max-value tokens. Comments are legal,
  // so parse tokens instead of assuming a fixed three-line header.
  let tokenCount = 0;
  let index = 0;
  while (tokenCount < 4 && index < ppm.length) {
    while (ppm[index] === 10 || ppm[index] === 13 || ppm[index] === 32 || ppm[index] === 9) index++;
    if (ppm[index] === 35) {
      while (index < ppm.length && ppm[index] !== 10) index++;
      continue;
    }
    while (
      index < ppm.length &&
      ppm[index] !== 10 &&
      ppm[index] !== 13 &&
      ppm[index] !== 32 &&
      ppm[index] !== 9
    )
      index++;
    tokenCount++;
  }
  while (ppm[index] === 10 || ppm[index] === 13 || ppm[index] === 32 || ppm[index] === 9) index++;
  return index;
}

describe("printed-card PDF visual regression", () => {
  const cases = { ...printedCardVisualDocuments, ...printedCardAdditionalVisualCases };
  for (const [caseName, documents] of Object.entries(cases)) {
    test(`${caseName} matches its reviewed 96 DPI raster`, async () => {
      const baselinePath = join(baselineDir, `${caseName}.ppm.gz`);
      const baseline = Bun.gunzipSync(readFileSync(baselinePath));
      const actual = rasterize(await renderPrintableCardPdf(documents), caseName);
      const baselineOffset = ppmPixelOffset(baseline);
      const actualOffset = ppmPixelOffset(actual);
      expect(new TextDecoder().decode(actual.slice(0, actualOffset))).toBe(
        new TextDecoder().decode(baseline.slice(0, baselineOffset)),
      );
      const expectedPixels = baseline.subarray(baselineOffset);
      const actualPixels = actual.subarray(actualOffset);
      expect(actualPixels.length).toBe(expectedPixels.length);

      let materiallyChanged = 0;
      let totalDifference = 0;
      for (let index = 0; index < expectedPixels.length; index++) {
        const difference = Math.abs(expectedPixels[index]! - actualPixels[index]!);
        totalDifference += difference;
        if (difference > 12) materiallyChanged++;
      }
      const changedRatio = materiallyChanged / expectedPixels.length;
      const meanDifference = totalDifference / expectedPixels.length;
      // Small rasterizer-version anti-aliasing differences are tolerated.
      // Missing glyphs, clipped lines and wrong templates change thousands of
      // pixels and exceed both thresholds by a wide margin.
      expect(changedRatio).toBeLessThan(0.0015);
      expect(meanDifference).toBeLessThan(0.12);
    });
  }

  test("every border/divider combination renders for every card type", async () => {
    for (const cardType of PRINT_CARD_TYPES) {
      const source = printedCardVisualDocuments[cardType][0]!;
      for (const border of BORDER_STYLES) {
        for (const ornament of [false, true]) {
          const theme = resolveDesign({
            ...source.theme,
            borderStyle: border.slug,
            print: {
              ...source.theme.print,
              border: border.slug !== "none",
              ornament,
            },
          });
          const pdf = await renderPrintableCardPdf([{ ...source, theme }]);
          expect(pdf.length).toBeGreaterThan(5_000);
        }
      }
    }
  }, 30_000);
});
