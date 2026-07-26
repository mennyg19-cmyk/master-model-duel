/**
 * The PDF writer for every printed artifact (UR-005, R-056).
 *
 * Hand-written rather than a library because the whole job is text at fixed
 * positions in the two base-14 fonts every reader already has: no images, no
 * embedded fonts, no layout engine. A dependency for this would be a megabyte
 * of code to place a hundred strings.
 *
 * The bytes are deterministic — no creation date, no ids — so the same batch
 * rendered twice is byte-for-byte the same document. That is what lets a
 * reprint be checked against the original instead of trusted.
 */
export type PageSize = { widthPt: number; heightPt: number };

/** 8.5 x 11 in, at PDF's 72 points to the inch. */
export const LETTER: PageSize = { widthPt: 612, heightPt: 792 };

/** 5 x 7 in card stock, which is what the greeting cards are cut to (UR-013). */
export const CARD_STOCK: PageSize = { widthPt: 360, heightPt: 504 };

/** 4 x 6 in, the label stock the box labels are printed on. */
export const LABEL_STOCK: PageSize = { widthPt: 288, heightPt: 432 };

export type PdfLine = { text: string; x: number; y: number; size?: number; bold?: boolean };
export type PdfPage = { size: PageSize; lines: PdfLine[] };

const DEFAULT_FONT_SIZE = 11;
const REGULAR_FONT = 3;
const BOLD_FONT = 4;
const FIRST_PAGE_OBJECT = 5;

export function renderPdf(pages: PdfPage[]): Buffer {
  const drawn = pages.length === 0 ? [{ size: LETTER, lines: [] }] : pages;
  const pageIds = drawn.map((_, index) => FIRST_PAGE_OBJECT + index * 2);

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${drawn.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];

  for (const [index, page] of drawn.entries()) {
    const contentId = pageIds[index] + 1;
    const content = contentStream(page);

    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.size.widthPt} ${page.size.heightPt}] ` +
        `/Resources << /Font << /F1 ${REGULAR_FONT} 0 R /F2 ${BOLD_FONT} 0 R >> >> ` +
        `/Contents ${contentId} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    );
  }

  return assemble(objects);
}

function contentStream(page: PdfPage): string {
  return page.lines
    .map((line) => {
      const font = line.bold ? '/F2' : '/F1';
      const size = line.size ?? DEFAULT_FONT_SIZE;
      return `BT ${font} ${size} Tf ${round(line.x)} ${round(line.y)} Td (${escapeText(line.text)}) Tj ET`;
    })
    .join('\n');
}

/**
 * Assembles the objects into a file with a cross-reference table. Every offset
 * is counted in bytes rather than characters: a latin-1 accent is one byte, and
 * a table that counted it as anything else points a reader at the wrong object.
 */
function assemble(objects: string[]): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets: number[] = [];
  let position = parts[0].length;

  for (const [index, body] of objects.entries()) {
    offsets.push(position);
    const chunk = Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, 'latin1');
    parts.push(chunk);
    position += chunk.length;
  }

  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF\n`,
  ].join('');

  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

/**
 * Anything outside latin-1 becomes a question mark. A recipient's name in
 * Hebrew would otherwise be written as bytes the reader decodes as noise, and a
 * label nobody can read is worse than one that says a character is missing.
 */
function escapeText(text: string): string {
  return [...text]
    .map((character) => {
      if (character === '\\' || character === '(' || character === ')') return `\\${character}`;
      const code = character.codePointAt(0) ?? 63;
      return code >= 32 && code <= 255 ? character : '?';
    })
    .join('');
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

/** Rough width in points for Helvetica at `size`, used to wrap a card message. */
export function wrapText(text: string, size: number, widthPt: number): string[] {
  const charactersPerLine = Math.max(Math.floor(widthPt / (size * 0.5)), 8);
  const lines: string[] = [];
  let current = '';

  for (const word of text.split(/\s+/).filter((part) => part !== '')) {
    if (current === '') current = word;
    else if (current.length + 1 + word.length <= charactersPerLine) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }

  if (current !== '') lines.push(current);
  return lines;
}
