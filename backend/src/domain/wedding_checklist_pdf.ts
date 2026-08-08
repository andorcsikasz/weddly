import { readFileSync } from "node:fs";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import type { UiLocale } from "@shared/locales";

const MM_TO_PT = 2.83465;
const mm = (value: number) => value * MM_TO_PT;
const FONT_DIR = join(import.meta.dir, "pdf_fonts");
const REGULAR_BYTES = readFileSync(join(FONT_DIR, "NotoSans-Regular.ttf"));
const BOLD_BYTES = readFileSync(join(FONT_DIR, "NotoSans-Bold.ttf"));
const HEADING_BYTES = readFileSync(join(FONT_DIR, "BodoniModa-SemiBold.ttf"));

export interface ChecklistPdfItem {
  title: string;
  done: boolean;
  dueDate?: string | null;
  owner?: string | null;
}

export interface ChecklistPdfSection {
  title: string;
  items: ChecklistPdfItem[];
}

export interface WeddingChecklistPdfInput {
  locale: UiLocale;
  coupleName?: string | null;
  weddingDate?: string | null;
  completed: number;
  total: number;
  includeProgress: boolean;
  includeDates: boolean;
  includeOwners: boolean;
  remainingOnly: boolean;
  sections: ChecklistPdfSection[];
}

const COPY: Record<
  UiLocale,
  {
    eyebrow: string;
    title: string;
    progress: string;
    generated: string;
    date: string;
    owner: string;
  }
> = {
  en: {
    eyebrow: "WEDDLY",
    title: "Wedding Planning Checklist",
    progress: "{done} of {total} complete",
    generated: "Generated with Weddly",
    date: "Recommended",
    owner: "Owner",
  },
  hu: {
    eyebrow: "WEDDLY",
    title: "Esküvőtervezési ellenőrzőlista",
    progress: "{done} / {total} kész",
    generated: "Készült a Weddlyvel",
    date: "Ajánlott",
    owner: "Felelős",
  },
  es: {
    eyebrow: "WEDDLY",
    title: "Lista de planificación de boda",
    progress: "{done} de {total} completadas",
    generated: "Creado con Weddly",
    date: "Recomendado",
    owner: "Responsable",
  },
  hr: {
    eyebrow: "WEDDLY",
    title: "Popis za planiranje vjenčanja",
    progress: "{done} od {total} dovršeno",
    generated: "Izrađeno uz Weddly",
    date: "Preporučeno",
    owner: "Zadužen/a",
  },
  de: {
    eyebrow: "WEDDLY",
    title: "Checkliste zur Hochzeitsplanung",
    progress: "{done} von {total} erledigt",
    generated: "Erstellt mit Weddly",
    date: "Empfohlen",
    owner: "Verantwortlich",
  },
};

const PAPER = rgb(0.984, 0.98, 0.961); // paper-50 #fbfaf5
const INK = rgb(0.063, 0.094, 0.188); // ink-900 #101830
const MUTED = rgb(0.275, 0.341, 0.478); // ink-500 #46577a
const BORDER = rgb(0.878, 0.835, 0.702); // paper-300 #e3d9bf
const ACCENT = rgb(0.631, 0.553, 0.365); // paper-600 #a18d5d
const COMPLETE = rgb(0.11, 0.4, 0.2); // sage-700

function formatDate(value: string, locale: UiLocale): string {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  const localeTag: Record<UiLocale, string> = {
    en: "en-GB",
    hu: "hu-HU",
    es: "es-ES",
    hr: "hr-HR",
    de: "de-DE",
  };
  return new Intl.DateTimeFormat(localeTag[locale], {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawCheckbox(page: PDFPage, x: number, y: number, done: boolean) {
  const size = mm(3.2);
  page.drawRectangle({
    x,
    y: y - size + 1,
    width: size,
    height: size,
    borderWidth: 0.8,
    borderColor: done ? COMPLETE : MUTED,
    color: done ? COMPLETE : undefined,
  });
  if (done) {
    page.drawLine({
      start: { x: x + 2.0, y: y - 3.7 },
      end: { x: x + 4.0, y: y - 5.8 },
      thickness: 1.1,
      color: PAPER,
    });
    page.drawLine({
      start: { x: x + 4.0, y: y - 5.8 },
      end: { x: x + 7.4, y: y - 1.8 },
      thickness: 1.1,
      color: PAPER,
    });
  }
}

export async function renderWeddingChecklistPdf(
  input: WeddingChecklistPdfInput,
): Promise<Uint8Array> {
  const copy = COPY[input.locale];
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(REGULAR_BYTES, { subset: true });
  const bold = await pdf.embedFont(BOLD_BYTES, { subset: true });
  const heading = await pdf.embedFont(HEADING_BYTES, { subset: true });
  const pageW = mm(210);
  const pageH = mm(297);
  const marginX = mm(15);
  const footerY = mm(10);
  const gutter = mm(8);
  const columnW = (pageW - marginX * 2 - gutter) / 2;
  const topY = pageH - mm(48);
  const bottomY = mm(18);
  let page!: PDFPage;
  let column = 0;
  let y = topY;
  let pageNumber = 0;

  const addPage = () => {
    page = pdf.addPage([pageW, pageH]);
    pageNumber += 1;
    page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: PAPER });
    page.drawText(copy.eyebrow, {
      x: marginX,
      y: pageH - mm(13),
      size: 8,
      font: bold,
      color: ACCENT,
    });
    if (pageNumber === 1) {
      page.drawText(copy.title, {
        x: marginX,
        y: pageH - mm(25),
        size: 22,
        font: heading,
        color: INK,
      });
      const detail = [
        input.coupleName?.trim(),
        input.weddingDate ? formatDate(input.weddingDate, input.locale) : null,
      ]
        .filter(Boolean)
        .join("  ·  ");
      if (detail)
        page.drawText(detail, {
          x: marginX,
          y: pageH - mm(33),
          size: 8.5,
          font: regular,
          color: MUTED,
        });
      if (input.includeProgress) {
        const progress = copy.progress
          .replace("{done}", String(input.completed))
          .replace("{total}", String(input.total));
        page.drawText(progress, {
          x: pageW - marginX - bold.widthOfTextAtSize(progress, 8.5),
          y: pageH - mm(33),
          size: 8.5,
          font: bold,
          color: INK,
        });
      }
      page.drawLine({
        start: { x: marginX, y: pageH - mm(39) },
        end: { x: pageW - marginX, y: pageH - mm(39) },
        thickness: 0.8,
        color: BORDER,
      });
    } else {
      page.drawText(copy.title, {
        x: marginX,
        y: pageH - mm(25),
        size: 13,
        font: heading,
        color: INK,
      });
      page.drawLine({
        start: { x: marginX, y: pageH - mm(32) },
        end: { x: pageW - marginX, y: pageH - mm(32) },
        thickness: 0.6,
        color: BORDER,
      });
    }
    const footer = `${copy.generated}  ·  ${pageNumber}`;
    page.drawText(footer, {
      x: pageW / 2 - regular.widthOfTextAtSize(footer, 7) / 2,
      y: footerY,
      size: 7,
      font: regular,
      color: MUTED,
    });
    column = 0;
    y = topY;
  };

  const nextColumn = () => {
    if (column === 0) {
      column = 1;
      y = topY;
    } else addPage();
  };
  const columnX = () => marginX + column * (columnW + gutter);
  addPage();

  for (const section of input.sections) {
    const visibleItems = input.remainingOnly
      ? section.items.filter((entry) => !entry.done)
      : section.items;
    if (visibleItems.length === 0) continue;
    const minimumSectionHeight = mm(9) + Math.min(visibleItems.length, 2) * mm(6);
    if (y - minimumSectionHeight < bottomY) nextColumn();
    let x = columnX();
    page.drawText(section.title.toLocaleUpperCase(input.locale), {
      x,
      y,
      size: 9,
      font: bold,
      color: ACCENT,
    });
    y -= mm(6.5);

    for (const entry of visibleItems) {
      const metaParts: string[] = [];
      if (input.includeDates && entry.dueDate)
        metaParts.push(`${copy.date}: ${formatDate(entry.dueDate, input.locale)}`);
      if (input.includeOwners && entry.owner) metaParts.push(`${copy.owner}: ${entry.owner}`);
      const titleLines = wrap(regular, entry.title, 8.2, columnW - mm(6));
      const metaLines = metaParts.length
        ? wrap(regular, metaParts.join(" · "), 6.8, columnW - mm(6))
        : [];
      const itemHeight = Math.max(
        mm(5.4),
        titleLines.length * mm(4.2) + metaLines.length * mm(3.4) + mm(1.1),
      );
      if (y - itemHeight < bottomY) {
        nextColumn();
        x = columnX();
      }
      drawCheckbox(page, x, y + 1, input.includeProgress && entry.done);
      const textX = x + mm(5.2);
      let lineY = y;
      for (const line of titleLines) {
        page.drawText(line, {
          x: textX,
          y: lineY,
          size: 8.2,
          font: regular,
          color: input.includeProgress && entry.done ? MUTED : INK,
        });
        if (input.includeProgress && entry.done) {
          const width = regular.widthOfTextAtSize(line, 8.2);
          page.drawLine({
            start: { x: textX, y: lineY + 3.2 },
            end: { x: textX + width, y: lineY + 3.2 },
            thickness: 0.45,
            color: MUTED,
          });
        }
        lineY -= mm(4.2);
      }
      for (const line of metaLines) {
        page.drawText(line, {
          x: textX,
          y: lineY + mm(0.5),
          size: 6.8,
          font: regular,
          color: MUTED,
        });
        lineY -= mm(3.4);
      }
      y -= itemHeight;
    }
    y -= mm(3.5);
  }

  pdf.setTitle(copy.title);
  pdf.setAuthor("Weddly");
  pdf.setCreator("Weddly");
  return pdf.save();
}
