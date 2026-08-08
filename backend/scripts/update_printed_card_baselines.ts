import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renderPrintableCardPdf } from "../src/domain/pdf";
import {
  printedCardAdditionalVisualCases,
  printedCardVisualDocuments,
} from "../tests/fixtures/printed_cards";

if (!process.argv.includes("--update")) {
  throw new Error(
    "Refusing to replace reviewed images. Re-run with --update after visually inspecting all six cards.",
  );
}

const baselineDir = resolve(import.meta.dir, "../tests/visual_baselines/printed_cards");
const temporary = mkdtempSync(join(tmpdir(), "weddly-card-baselines-"));
mkdirSync(baselineDir, { recursive: true });

try {
  const cases = { ...printedCardVisualDocuments, ...printedCardAdditionalVisualCases };
  for (const [caseName, documents] of Object.entries(cases)) {
    const pdfPath = join(temporary, `${caseName}.pdf`);
    const rasterRoot = join(temporary, caseName);
    writeFileSync(pdfPath, await renderPrintableCardPdf(documents));
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
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    const ppm = readFileSync(`${rasterRoot}.ppm`);
    writeFileSync(join(baselineDir, `${caseName}.ppm.gz`), Bun.gzipSync(ppm));
    console.log(`updated ${caseName}: ${ppm.length} raster bytes`);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
