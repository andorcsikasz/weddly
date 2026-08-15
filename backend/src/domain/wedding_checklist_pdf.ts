import { readFileSync } from "node:fs";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import QRCode from "qrcode";
import type { UiLocale } from "@shared/locales";
import { CONFIG } from "../config";

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
    continued: string;
  }
> = {
  en: {
    eyebrow: "WEDDLY",
    title: "Wedding Planning Checklist",
    progress: "{done} of {total} complete",
    generated: "Generated with Weddly",
    date: "Recommended",
    owner: "Owner",
    continued: "continued",
  },
  hu: {
    eyebrow: "WEDDLY",
    title: "Esküvőtervezési ellenőrzőlista",
    progress: "{done} / {total} kész",
    generated: "Készült a Weddlyvel",
    date: "Ajánlott",
    owner: "Felelős",
    continued: "folytatás",
  },
  es: {
    eyebrow: "WEDDLY",
    title: "Lista de planificación de boda",
    progress: "{done} de {total} completadas",
    generated: "Creado con Weddly",
    date: "Recomendado",
    owner: "Responsable",
    continued: "continuación",
  },
  hr: {
    eyebrow: "WEDDLY",
    title: "Popis za planiranje vjenčanja",
    progress: "{done} od {total} dovršeno",
    generated: "Izrađeno uz Weddly",
    date: "Preporučeno",
    owner: "Zadužen/a",
    continued: "nastavak",
  },
  de: {
    eyebrow: "WEDDLY",
    title: "Checkliste zur Hochzeitsplanung",
    progress: "{done} von {total} erledigt",
    generated: "Erstellt mit Weddly",
    date: "Empfohlen",
    owner: "Verantwortlich",
    continued: "Fortsetzung",
  },
};

const PAPER = rgb(0.984, 0.98, 0.961); // paper-50 #fbfaf5
const INK = rgb(0.063, 0.094, 0.188); // ink-900 #101830
const MUTED = rgb(0.275, 0.341, 0.478); // ink-500 #46577a
const BORDER = rgb(0.878, 0.835, 0.702); // paper-300 #e3d9bf
const ACCENT = rgb(0.631, 0.553, 0.365); // paper-600 #a18d5d
const COMPLETE = rgb(0.11, 0.4, 0.2); // sage-700

const HEADER_LINE_HEIGHT = mm(4);
const HEADER_BOTTOM_GAP = mm(2.5);
const SECTION_GAP = mm(3.5);

const LANDING_URL_LABEL = "tryweddly.com";
const LANDING_URL = `${CONFIG.frontendBaseUrl}/?utm_source=checklist_pdf&utm_medium=print&utm_campaign=wedding_checklist`;

/** Small enough to sit in the footer corner, dark enough at that size to
 *  still scan. `light` matches PAPER so the code has no visible box edge
 *  against the page background. */
async function generateFooterQrPng(): Promise<Buffer> {
  return QRCode.toBuffer(LANDING_URL, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 300,
    color: { dark: "#101830", light: "#fbfaf5" },
  });
}

export interface ChecklistLayoutMetric {
  height: number;
  sectionIndex: number;
  itemIndex: number;
  sectionLength: number;
  headerHeight: number;
  continuationHeaderHeight: number;
}

export interface ChecklistColumnLayout {
  start: number;
  end: number;
  height: number;
}

export interface ChecklistPageLayout {
  left: ChecklistColumnLayout;
  right: ChecklistColumnLayout | null;
}

function columnLayoutOptions(
  items: ChecklistLayoutMetric[],
  start: number,
  capacity: number,
): ChecklistColumnLayout[] {
  const options: ChecklistColumnLayout[] = [];
  let height = 0;
  let tasksAfterHeader = 0;
  let tasksRequiredWithHeader = 0;

  for (let index = start; index < items.length; index += 1) {
    const item = items[index];
    if (!item) break;
    const previous = index > start ? items[index - 1] : null;
    const startsSectionBlock = index === start || previous?.sectionIndex !== item.sectionIndex;

    if (startsSectionBlock) {
      const gap = index === start ? 0 : SECTION_GAP;
      const isContinuation = index === start && item.itemIndex > 0;
      const headerHeight = isContinuation ? item.continuationHeaderHeight : item.headerHeight;
      if (height + gap + headerHeight + item.height > capacity) break;
      height += gap + headerHeight;
      tasksAfterHeader = 0;
      tasksRequiredWithHeader = Math.min(2, item.sectionLength - item.itemIndex);
    }

    if (height + item.height > capacity) break;
    height += item.height;
    tasksAfterHeader += 1;

    const finishesSection = item.itemIndex === item.sectionLength - 1;
    if (finishesSection || tasksAfterHeader >= tasksRequiredWithHeader) {
      options.push({ start, end: index + 1, height });
    }
  }

  return options;
}

function planChecklistPdfPage(
  items: ChecklistLayoutMetric[],
  start: number,
  capacity: number,
): ChecklistPageLayout {
  const leftOptions = columnLayoutOptions(items, start, capacity);
  if (leftOptions.length === 0) {
    throw new Error("A wedding checklist block is taller than the printable column");
  }

  let best: ChecklistPageLayout | null = null;
  let bestEnd = -1;
  let bestImbalance = Number.POSITIVE_INFINITY;

  for (const left of leftOptions) {
    const rightOptions =
      left.end >= items.length
        ? [null]
        : columnLayoutOptions(items, left.end, capacity).map((option) => option);
    if (rightOptions.length === 0) continue;

    for (const right of rightOptions) {
      const end = right?.end ?? left.end;
      const imbalance = Math.abs(left.height - (right?.height ?? 0));
      if (end > bestEnd || (end === bestEnd && imbalance < bestImbalance)) {
        best = { left, right };
        bestEnd = end;
        bestImbalance = imbalance;
      }
    }
  }

  if (!best) throw new Error("Unable to paginate the wedding checklist");
  return best;
}

export function planChecklistPdfPages(
  items: ChecklistLayoutMetric[],
  firstPageCapacity: number,
  continuationPageCapacity = firstPageCapacity,
): ChecklistPageLayout[] {
  const pages: ChecklistPageLayout[] = [];
  let start = 0;
  while (start < items.length) {
    const capacity = pages.length === 0 ? firstPageCapacity : continuationPageCapacity;
    const page = planChecklistPdfPage(items, start, capacity);
    pages.push(page);
    start = page.right?.end ?? page.left.end;
  }
  return pages;
}

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
  const qrImage = await pdf.embedPng(await generateFooterQrPng());
  const pageW = mm(210);
  const pageH = mm(297);
  const marginX = mm(15);
  const footerY = mm(10);
  const gutter = mm(8);
  const columnW = (pageW - marginX * 2 - gutter) / 2;
  const firstPageTopY = pageH - mm(48);
  const continuationPageTopY = pageH - mm(41);
  const bottomY = mm(18);

  interface MeasuredItem {
    source: ChecklistPdfItem;
    titleLines: string[];
    metaLines: string[];
    metric: ChecklistLayoutMetric;
    headerLines: string[];
    continuationHeaderLines: string[];
  }

  const measuredItems: MeasuredItem[] = [];
  const visibleSections = input.sections
    .map((section) => ({
      ...section,
      items: input.remainingOnly ? section.items.filter((entry) => !entry.done) : section.items,
    }))
    .filter((section) => section.items.length > 0);

  visibleSections.forEach((section, sectionIndex) => {
    const headerLabel = section.title.toLocaleUpperCase(input.locale);
    const continuationLabel = `${section.title} – ${copy.continued}`.toLocaleUpperCase(
      input.locale,
    );
    const headerLines = wrap(bold, headerLabel, 9, columnW);
    const continuationHeaderLines = wrap(bold, continuationLabel, 9, columnW);
    const headerHeight = headerLines.length * HEADER_LINE_HEIGHT + HEADER_BOTTOM_GAP;
    const continuationHeaderHeight =
      continuationHeaderLines.length * HEADER_LINE_HEIGHT + HEADER_BOTTOM_GAP;

    section.items.forEach((entry, itemIndex) => {
      const metaParts: string[] = [];
      if (input.includeDates && entry.dueDate) {
        metaParts.push(`${copy.date}: ${formatDate(entry.dueDate, input.locale)}`);
      }
      if (input.includeOwners && entry.owner) metaParts.push(`${copy.owner}: ${entry.owner}`);
      const titleLines = wrap(regular, entry.title, 8.2, columnW - mm(6));
      const metaLines = metaParts.length
        ? wrap(regular, metaParts.join(" · "), 6.8, columnW - mm(6))
        : [];
      const height = Math.max(
        mm(5.4),
        titleLines.length * mm(4.2) + metaLines.length * mm(3.4) + mm(1.1),
      );
      measuredItems.push({
        source: entry,
        titleLines,
        metaLines,
        headerLines,
        continuationHeaderLines,
        metric: {
          height,
          sectionIndex,
          itemIndex,
          sectionLength: section.items.length,
          headerHeight,
          continuationHeaderHeight,
        },
      });
    });
  });

  const layouts = planChecklistPdfPages(
    measuredItems.map((entry) => entry.metric),
    firstPageTopY - bottomY,
    continuationPageTopY - bottomY,
  );

  const addPage = (pageNumber: number) => {
    const page = pdf.addPage([pageW, pageH]);
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

    // Bottom-right corner, below the content floor (bottomY) so it never
    // competes with a checklist line — a scannable way back to the site on
    // a printed page that has long since left the browser.
    const qrSize = mm(9);
    const qrX = pageW - marginX - qrSize;
    const qrY = mm(4);
    page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });
    const labelSize = 7;
    const labelWidth = bold.widthOfTextAtSize(LANDING_URL_LABEL, labelSize);
    page.drawText(LANDING_URL_LABEL, {
      x: qrX - mm(2) - labelWidth,
      y: qrY + qrSize / 2 - labelSize * 0.35,
      size: labelSize,
      font: bold,
      color: ACCENT,
    });
    return page;
  };

  const drawColumn = (
    page: PDFPage,
    layout: ChecklistColumnLayout,
    column: number,
    topY: number,
  ) => {
    const x = marginX + column * (columnW + gutter);
    let y = topY;

    for (let index = layout.start; index < layout.end; index += 1) {
      const measured = measuredItems[index];
      if (!measured) continue;
      const previous = index > layout.start ? measuredItems[index - 1] : null;
      const startsSectionBlock =
        index === layout.start || previous?.metric.sectionIndex !== measured.metric.sectionIndex;
      if (startsSectionBlock) {
        if (index > layout.start) y -= SECTION_GAP;
        const isContinuation = index === layout.start && measured.metric.itemIndex > 0;
        const headerLines = isContinuation
          ? measured.continuationHeaderLines
          : measured.headerLines;
        for (const line of headerLines) {
          page.drawText(line, {
            x,
            y,
            size: 9,
            font: bold,
            color: ACCENT,
          });
          y -= HEADER_LINE_HEIGHT;
        }
        y -= HEADER_BOTTOM_GAP;
      }

      const entry = measured.source;
      drawCheckbox(page, x, y + 1, input.includeProgress && entry.done);
      const textX = x + mm(5.2);
      let lineY = y;
      for (const line of measured.titleLines) {
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
      for (const line of measured.metaLines) {
        page.drawText(line, {
          x: textX,
          y: lineY + mm(0.5),
          size: 6.8,
          font: regular,
          color: MUTED,
        });
        lineY -= mm(3.4);
      }
      y -= measured.metric.height;
    }
  };

  layouts.forEach((layout, pageIndex) => {
    const pageNumber = pageIndex + 1;
    const page = addPage(pageNumber);
    const topY = pageIndex === 0 ? firstPageTopY : continuationPageTopY;
    drawColumn(page, layout.left, 0, topY);
    if (layout.right) drawColumn(page, layout.right, 1, topY);
  });

  if (layouts.length === 0) {
    addPage(1);
  }

  pdf.setTitle(copy.title);
  pdf.setAuthor("Weddly");
  pdf.setCreator("Weddly");
  return pdf.save();
}
