import { FulfillmentChoice, PrintBatchTrigger } from "@prisma/client";
import { PDFDocument, PDFFont, PDFPage, StandardFonts } from "pdf-lib";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { CHANNEL_LABELS } from "@/lib/packages/fulfillment";
import { sortForFiling } from "@/lib/packages/print-batches";

// UR-005/UR-013/R-056: server-rendered print artifacts for a persisted batch.
// One PDF per filing group per artifact kind: slips (one page per order),
// labels (one page per package), greeting cards (one card-stock page per
// package with a greeting). PDFs render on demand from batch membership, so
// a reprint never touches what was already filed.

export type BatchArtifact = "slips" | "labels" | "cards";
export const BATCH_ARTIFACTS: readonly BatchArtifact[] = ["slips", "labels", "cards"];

export interface PrintPackageLine {
  orderLineId: string;
  productName: string;
  qty: number;
  optionLabel: string | null;
  parentLineId: string | null;
}

export interface PrintPackage {
  id: string;
  recipientName: string;
  channel: FulfillmentChoice;
  deliveryDay: string | null;
  greeting: string | null;
  address: { line1: string; line2: string | null; city: string; region: string; postalCode: string } | null;
  lines: PrintPackageLine[];
}

export interface PrintOrder {
  id: string;
  wireFormat: string | null;
  orderNumber: number | null;
  customerName: string;
  packages: PrintPackage[];
}

export interface BatchPrintData {
  id: string;
  filingGroup: string;
  trigger: PrintBatchTrigger;
  createdAt: Date;
  orders: PrintOrder[];
}

export async function loadBatchForPrint(batchId: string): Promise<BatchPrintData> {
  const batch = await prisma.printBatch.findUnique({
    where: { id: batchId },
    include: {
      items: {
        include: {
          package: {
            include: {
              recipientAddress: true,
              lines: { include: { orderLine: true } },
            },
          },
        },
      },
    },
  });
  if (!batch) throw new NotFoundError("PrintBatch", batchId);

  const orderIds = [...new Set(batch.items.map((batchItem) => batchItem.orderId))];
  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    include: { customer: true },
  });
  const orderById = new Map(orders.map((order) => [order.id, order]));

  const packages: (PrintPackage & { orderId: string; orderNumber: number | null })[] = batch.items.map((batchItem) => ({
    orderId: batchItem.orderId,
    orderNumber: orderById.get(batchItem.orderId)?.orderNumber ?? null,
    id: batchItem.package.id,
    recipientName: batchItem.package.recipientName,
    channel: batchItem.package.channel,
    deliveryDay: batchItem.package.deliveryDay,
    greeting: batchItem.package.greeting,
    address: batchItem.package.recipientAddress
      ? {
          line1: batchItem.package.recipientAddress.line1,
          line2: batchItem.package.recipientAddress.line2,
          city: batchItem.package.recipientAddress.city,
          region: batchItem.package.recipientAddress.region,
          postalCode: batchItem.package.recipientAddress.postalCode,
        }
      : null,
    lines: batchItem.package.lines.map((line) => ({
      orderLineId: line.orderLineId,
      productName: line.orderLine.productName,
      qty: line.qty,
      optionLabel: line.orderLine.optionLabel,
      parentLineId: line.orderLine.parentLineId,
    })),
  }));

  // The nightly filing sort — same comparator, same id tiebreaker, so the
  // rendered page order matches the persisted PrintBatchItem order.
  const filed = sortForFiling(packages);

  const printOrders: PrintOrder[] = [];
  for (const orderId of orderIds) {
    const order = orderById.get(orderId);
    const orderPackages = filed.filter((pkg) => pkg.orderId === orderId);
    if (!order || orderPackages.length === 0) continue;
    printOrders.push({
      id: order.id,
      wireFormat: order.wireFormat,
      orderNumber: order.orderNumber,
      customerName: order.customer.name,
      packages: orderPackages.map(({ orderId: _orderId, orderNumber: _orderNumber, ...pkg }) => pkg),
    });
  }

  return { id: batch.id, filingGroup: batch.filingGroup, trigger: batch.trigger, createdAt: batch.createdAt, orders: printOrders };
}

// pdf-lib standard fonts are WinAnsi-only: map the usual smart punctuation to
// ASCII and blank anything else outside CP1252 instead of throwing mid-batch.
function toPdfSafe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

interface TextLine {
  text: string;
  size?: number;
  bold?: boolean;
  gapBefore?: number;
}

const LETTER: [number, number] = [612, 792];
const CARD: [number, number] = [432, 288]; // 6in x 4in card stock
const MARGIN = 54;
// Helvetica metrics estimates the layout math depends on: average glyph width
// ~0.48em (wrap), line height 1.35em (left text) / 1.5em (centered cards).
const CHAR_WIDTH_EM = 0.48;
const LINE_SPACING_EM = 1.35;
const CENTERED_SPACING_EM = 1.5;
const LABELS_PER_PAGE = 4;

function wrap(text: string, size: number, width: number): string[] {
  const maxChars = Math.max(10, Math.floor(width / (size * CHAR_WIDTH_EM)));
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

class PdfWriter {
  private constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
    private pageSize: [number, number],
  ) {}

  static async create(pageSize: [number, number]): Promise<PdfWriter> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    return new PdfWriter(doc, font, bold, pageSize);
  }

  private page: PDFPage | null = null;
  private y = 0;
  pageNumber = 0;

  addPage(): void {
    this.page = this.doc.addPage(this.pageSize);
    this.y = this.pageSize[1] - MARGIN;
    this.pageNumber += 1;
  }

  private ensurePage(): PDFPage {
    if (!this.page) this.addPage();
    return this.page!;
  }

  line(entry: TextLine): void {
    const size = entry.size ?? 10;
    const wrapped = wrap(toPdfSafe(entry.text), size, this.pageSize[0] - 2 * MARGIN);
    this.y -= entry.gapBefore ?? 0;
    for (const text of wrapped) {
      if (this.y < MARGIN) this.addPage();
      this.ensurePage().drawText(text, {
        x: MARGIN,
        y: this.y,
        size,
        font: entry.bold ? this.bold : this.font,
      });
      this.y -= size * LINE_SPACING_EM;
    }
  }

  centered(text: string, size: number, bold = false): void {
    const page = this.ensurePage();
    const font = bold ? this.bold : this.font;
    for (const chunk of wrap(toPdfSafe(text), size, this.pageSize[0] - 2 * MARGIN)) {
      const width = font.widthOfTextAtSize(chunk, size);
      if (this.y < MARGIN) this.addPage();
      page.drawText(chunk, { x: (this.pageSize[0] - width) / 2, y: this.y, size, font });
      this.y -= size * CENTERED_SPACING_EM;
    }
  }

  async save(): Promise<Uint8Array> {
    // pdf-lib Flate-compresses page content streams unconditionally; object
    // streams stay off so the file structure itself stays simple to inspect
    // (smoke checks inflate the stream blocks to grep the text).
    return this.doc.save({ useObjectStreams: false });
  }
}

function packageContents(pkg: PrintPackage, indent: string): TextLine[] {
  const lines: TextLine[] = [];
  const productLines = pkg.lines.filter((line) => line.parentLineId === null);
  for (const line of productLines) {
    const addOns = pkg.lines
      .filter((addOn) => addOn.parentLineId === line.orderLineId)
      .map((addOn) => ` +${addOn.qty} x ${addOn.productName}`)
      .join("");
    lines.push({
      text: `${indent}${line.qty} x ${line.productName}${line.optionLabel ? ` (${line.optionLabel})` : ""}${addOns}`,
      size: 10,
      gapBefore: 2,
    });
  }
  return lines;
}

// Slips: one page per ORDER — the packing slip (R-056) covering this batch's
// packages for that order.
export async function renderSlipsPdf(batch: BatchPrintData): Promise<Uint8Array> {
  const writer = await PdfWriter.create(LETTER);
  for (const order of batch.orders) {
    writer.addPage();
    writer.line({ text: `Packing slip — ${order.wireFormat ?? order.id}`, size: 16, bold: true });
    writer.line({ text: `Ordered by ${order.customerName}`, size: 10, gapBefore: 4 });
    for (const pkg of order.packages) {
      writer.line({ text: "", size: 6 });
      writer.line({
        text: `Package for ${pkg.recipientName} — ${CHANNEL_LABELS[pkg.channel]}${pkg.deliveryDay ? ` (${pkg.deliveryDay})` : ""}`,
        size: 12,
        bold: true,
        gapBefore: 10,
      });
      for (const entry of packageContents(pkg, "  ")) writer.line(entry);
      if (pkg.greeting) writer.line({ text: `  Greeting card enclosed: "${pkg.greeting}"`, size: 9, gapBefore: 3 });
    }
    writer.line({ text: `Filing group ${batch.filingGroup} · batch ${batch.id}`, size: 8, gapBefore: 14 });
  }
  return writer.save();
}

// Labels: one page per PACKAGE — recipient, address, channel, order ref.
export async function renderLabelsPdf(batch: BatchPrintData): Promise<Uint8Array> {
  const writer = await PdfWriter.create(LETTER);
  let labelsOnPage = 0;
  for (const order of batch.orders) {
    for (const pkg of order.packages) {
      if (labelsOnPage === LABELS_PER_PAGE) {
        writer.addPage();
        labelsOnPage = 0;
      }
      const pageAtStart = writer.pageNumber;
      writer.line({ text: pkg.recipientName, size: 20, bold: true, gapBefore: 24 });
      if (pkg.address) {
        writer.line({ text: pkg.address.line1, size: 12, gapBefore: 6 });
        if (pkg.address.line2) writer.line({ text: pkg.address.line2, size: 12 });
        writer.line({ text: `${pkg.address.city}, ${pkg.address.region} ${pkg.address.postalCode}`, size: 12 });
      } else {
        writer.line({ text: "PICKUP — no delivery address", size: 12, gapBefore: 6 });
      }
      writer.line({
        text: `${CHANNEL_LABELS[pkg.channel]}${pkg.deliveryDay ? ` · ${pkg.deliveryDay}` : ""}`,
        size: 11,
        bold: true,
        gapBefore: 8,
      });
      writer.line({ text: `${order.wireFormat ?? order.id} · package ${pkg.id.slice(-8)}`, size: 9, gapBefore: 4 });
      writer.line({ text: "", size: 8 });
      // A label that overflowed mid-page already forced a fresh page; count
      // against that one instead of forcing another at the next multiple of 4.
      labelsOnPage = writer.pageNumber === pageAtStart ? labelsOnPage + 1 : 1;
    }
  }
  return writer.save();
}

// Cards (UR-013, G-021): one 6x4 card-stock page per package that carries a
// greeting; greetingless packages are skipped by design.
export async function renderCardsPdf(batch: BatchPrintData): Promise<Uint8Array> {
  const writer = await PdfWriter.create(CARD);
  let cardCount = 0;
  for (const order of batch.orders) {
    for (const pkg of order.packages) {
      if (!pkg.greeting) continue;
      cardCount += 1;
      writer.addPage();
      writer.centered(pkg.greeting, 20);
      writer.line({ text: "", size: 10 });
      writer.centered(`For ${pkg.recipientName}`, 12, true);
      writer.centered(order.wireFormat ?? order.id, 8);
    }
  }
  if (cardCount === 0) {
    writer.addPage();
    writer.centered(`No greeting cards in batch ${batch.id}`, 12);
  }
  return writer.save();
}

export async function renderBatchPdf(batch: BatchPrintData, artifact: BatchArtifact): Promise<Uint8Array> {
  if (artifact === "slips") return renderSlipsPdf(batch);
  if (artifact === "labels") return renderLabelsPdf(batch);
  return renderCardsPdf(batch);
}
