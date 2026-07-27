// Dependency-free text PDF writer (UR-005 ladder: stdlib only, no pdf package).
// It produces plain-text PDFs — Helvetica, one content stream per page, a
// correct xref table — which is all slips, labels, and greeting cards need.
// Text is Latin-1; characters outside it render as "?" (the org's data is
// English greetings and US addresses).

export type PdfLine = {
  text: string;
  size?: number;
  bold?: boolean;
  /** Extra vertical gap (in points) inserted before this line. */
  gapBefore?: number;
};

export type PdfPageSize = { width: number; height: number };

// Points: 72/inch.
export const LETTER: PdfPageSize = { width: 612, height: 792 };
export const LABEL_4X6: PdfPageSize = { width: 288, height: 432 };
export const CARD_5X7: PdfPageSize = { width: 360, height: 504 };

const MARGIN = 36;
const DEFAULT_SIZE = 10;
const LINE_GAP = 4;

function escapePdfText(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (char === "\\" || char === "(" || char === ")") out += `\\${char}`;
    else if (code >= 32 && code <= 255) out += char;
    else out += "?";
  }
  return out;
}

// All text has been through escapePdfText (pure Latin-1), so byte length is exact.
function latin1Length(text: string): number {
  return Buffer.byteLength(text, "latin1");
}

function pageContent(lines: PdfLine[], size: PdfPageSize): string {
  const parts: string[] = ["BT"];
  let y = size.height - MARGIN;
  let first = true;
  for (const line of lines) {
    const fontSize = line.size ?? DEFAULT_SIZE;
    y -= (line.gapBefore ?? 0) + fontSize + (first ? 0 : LINE_GAP);
    first = false;
    parts.push(`/${line.bold ? "F2" : "F1"} ${fontSize} Tf`);
    parts.push(`1 0 0 1 ${MARGIN} ${y.toFixed(1)} Tm`);
    parts.push(`(${escapePdfText(line.text)}) Tj`);
  }
  parts.push("ET");
  return parts.join("\n");
}

/**
 * Split a long run of lines into pages that fit the given page size.
 * Explicit page breaks (one package per card/label) come from passing
 * pre-split pages to renderPdf instead.
 */
export function paginate(lines: PdfLine[], size: PdfPageSize = LETTER): PdfLine[][] {
  const usable = size.height - MARGIN * 2;
  const pages: PdfLine[][] = [];
  let current: PdfLine[] = [];
  let used = 0;
  for (const line of lines) {
    const cost = (line.gapBefore ?? 0) + (line.size ?? DEFAULT_SIZE) + (current.length > 0 ? LINE_GAP : 0);
    if (current.length > 0 && used + cost > usable) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(line);
    used += cost;
  }
  if (current.length > 0) pages.push(current);
  return pages.length > 0 ? pages : [[]];
}

/** Render pages of text lines into PDF bytes. Every page uses the same size. */
export function renderPdf(pages: PdfLine[][], size: PdfPageSize = LETTER): Buffer {
  // Objects: 1 catalog, 2 pages tree, 3 font regular, 4 font bold,
  // then per page: page object + content stream.
  const objects: string[] = [];
  const pageObjectIds = pages.map((_, index) => 5 + index * 2);

  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`
  );
  objects.push(`3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`);
  objects.push(
    `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`
  );

  pages.forEach((lines, index) => {
    const pageId = 5 + index * 2;
    const contentId = pageId + 1;
    objects.push(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size.width} ${size.height}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`
    );
    const content = pageContent(lines, size);
    objects.push(`${contentId} 0 obj\n<< /Length ${latin1Length(content)} >>\nstream\n${content}\nendstream\nendobj\n`);
  });

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(latin1Length(body));
    body += object;
  }
  const xrefOffset = latin1Length(body);
  const count = objects.length + 1;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `${xref}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
