/**
 * Minimal PDF generator (no third-party deps).
 * Enough for printable slips/labels/cards in smoke + staff download.
 */
export function buildSimplePdf(lines: string[]): Buffer {
  const escaped = lines.map((line) =>
    line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"),
  );

  const contentParts: string[] = ["BT", "/F1 11 Tf", "50 780 Td", "14 TL"];
  for (let i = 0; i < escaped.length; i += 1) {
    if (i === 0) {
      contentParts.push(`(${escaped[i]}) Tj`);
    } else {
      contentParts.push("T*", `(${escaped[i]}) Tj`);
    }
  }
  contentParts.push("ET");
  const stream = contentParts.join("\n");

  const objects: string[] = [];
  objects.push("1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n");
  objects.push("2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n");
  objects.push(
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n",
  );
  objects.push(
    `4 0 obj<< /Length ${Buffer.byteLength(stream, "utf8")} >>stream\n${stream}\nendstream\nendobj\n`,
  );
  objects.push("5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += obj;
  }
  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

export function pdfToDataUrl(pdf: Buffer): string {
  return `data:application/pdf;base64,${pdf.toString("base64")}`;
}
