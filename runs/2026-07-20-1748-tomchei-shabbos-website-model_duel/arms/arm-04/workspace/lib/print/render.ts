import type { PrintArtifactKind } from "@prisma/client";
import { CARD_5X7, LABEL_4X6, LETTER, paginate, renderPdf, type PdfLine } from "@/lib/pdf";
import type { GroupArtifactPayload, PackingSlipPayload, PrintPackage } from "@/lib/print/payload";

// Turns stored artifact payloads into PDFs (UR-005, UR-013, R-056). Rendering
// reads the snapshot only — it never touches Package rows, so printing can
// never advance a stage (G-002).

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && current.length + word.length + 1 > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function addressLines(entry: PrintPackage): string[] {
  return [
    entry.addressLine1,
    ...(entry.addressLine2 ? [entry.addressLine2] : []),
    `${entry.city}, ${entry.state} ${entry.zip}`,
  ];
}

function itemLines(entry: PrintPackage): string[] {
  return entry.items.map((item) => {
    const addOns = item.addOns.length > 0 ? ` (+ ${item.addOns.join(", ")})` : "";
    return `${item.quantity} x ${item.name}${addOns}`;
  });
}

/** Letter pages: every package in the filing group as a slip block. */
function packageSlipsPages(payload: GroupArtifactPayload): PdfLine[][] {
  const lines: PdfLine[] = [
    { text: `Package slips — ${payload.filingGroup}`, size: 16, bold: true },
    { text: `Generated ${payload.generatedAt} · ${payload.packages.length} package(s)`, size: 9 },
  ];
  for (const entry of payload.packages) {
    lines.push({ text: entry.recipientName, size: 12, bold: true, gapBefore: 14 });
    for (const address of addressLines(entry)) lines.push({ text: address });
    lines.push({ text: `Method: ${entry.methodName} · Orders: ${entry.orderRefs.join(", ")}`, size: 9 });
    for (const item of itemLines(entry)) lines.push({ text: `  ${item}` });
    if (entry.greeting) {
      for (const part of wrap(`Greeting: "${entry.greeting}"`, 90)) lines.push({ text: part, size: 9 });
    }
  }
  return paginate(lines, LETTER);
}

/** 4x6 label stock: one label page per package. */
function labelPages(payload: GroupArtifactPayload): PdfLine[][] {
  return payload.packages.map((entry) => [
    { text: entry.recipientName, size: 16, bold: true },
    ...addressLines(entry).map((address) => ({ text: address, size: 13 })),
    { text: entry.methodName, size: 10, gapBefore: 12 },
    { text: `Package ${entry.packageId.slice(-8)} · ${payload.filingGroup}`, size: 8, gapBefore: 6 },
  ]);
}

/** 5x7 card stock (UR-013, G-021): one greeting card page per package. */
function greetingCardPages(payload: GroupArtifactPayload): PdfLine[][] {
  return payload.packages.map((entry) => [
    { text: `To ${entry.recipientName}`, size: 13, bold: true, gapBefore: 40 },
    ...wrap(entry.greeting, 38).map((part) => ({ text: part, size: 14, gapBefore: 6 })),
  ]);
}

/** Letter: what is in this order's shipment, package by package (R-056). */
function packingSlipPages(payload: PackingSlipPayload): PdfLine[][] {
  const lines: PdfLine[] = [
    { text: `Packing slip — ${payload.orderRef}`, size: 16, bold: true },
    { text: `Customer: ${payload.customerName} · Generated ${payload.generatedAt}`, size: 9 },
  ];
  payload.packages.forEach((entry, index) => {
    lines.push({ text: `Package ${index + 1} of ${payload.packages.length} — ${entry.recipientName}`, size: 12, bold: true, gapBefore: 14 });
    for (const address of addressLines(entry)) lines.push({ text: address });
    lines.push({ text: `Method: ${entry.methodName}`, size: 9 });
    for (const item of itemLines(entry)) lines.push({ text: `  ${item}` });
  });
  return paginate(lines, LETTER);
}

export function renderArtifactPdf(kind: PrintArtifactKind, payload: unknown): Buffer {
  switch (kind) {
    case "PACKAGE_SLIPS":
      return renderPdf(packageSlipsPages(payload as GroupArtifactPayload), LETTER);
    case "LABELS":
      return renderPdf(labelPages(payload as GroupArtifactPayload), LABEL_4X6);
    case "GREETING_CARDS":
      return renderPdf(greetingCardPages(payload as GroupArtifactPayload), CARD_5X7);
    case "PACKING_SLIP":
      return renderPdf(packingSlipPages(payload as PackingSlipPayload), LETTER);
  }
}
