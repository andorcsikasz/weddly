// Tiny CSV parser. Handles quoted fields, escaped quotes ("Smith ""Jr"""), CRLF.
// Returns rows of strings — caller maps to typed shape.

export function parseCsv(text: string): string[][] {
  // Strip BOM if present (Excel exports often include it).
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      // Skip \r\n pair as one separator.
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      // Empty trailing line — don't keep it.
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  // Flush the last cell + row if no trailing newline.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

/** Map the first row (header) to indexes for a given set of expected fields. */
export function indexHeaders(
  header: string[],
  expected: ReadonlyArray<string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  const norm = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "_");
  const normalised = header.map(norm);
  for (const field of expected) {
    const idx = normalised.indexOf(field);
    if (idx >= 0) out[field] = idx;
  }
  return out;
}
