import { BRAND } from '../brand';
import {
  CARD_STOCK,
  LABEL_STOCK,
  LETTER,
  renderPdf,
  wrapText,
  type PdfLine,
  type PdfPage,
} from './pdf';
import type { PrintablePackage } from './print-data';

/**
 * The three things that come off the printer for a filing group (UR-005,
 * UR-013, R-056). Each is its own PDF so three people can print three stacks at
 * once, and so a reprint of the cards does not reprint the labels.
 *
 * None of these functions touches a package's stage. Printing is paper coming
 * out of a machine; whether the box has been packed or sent is a thing a person
 * says afterwards (G-002, G-004), and the footer on every slip says so.
 */
export const PRINT_ARTIFACTS = ['slips', 'labels', 'cards'] as const;
export type PrintArtifact = (typeof PRINT_ARTIFACTS)[number];

export const ARTIFACT_LABELS: Record<PrintArtifact, string> = {
  slips: 'Packing slips',
  labels: 'Box labels',
  cards: 'Greeting cards',
};

export function isPrintArtifact(value: string): value is PrintArtifact {
  return (PRINT_ARTIFACTS as readonly string[]).includes(value);
}

export function renderArtifact(
  artifact: PrintArtifact,
  heading: string,
  packages: PrintablePackage[],
): Buffer {
  if (artifact === 'slips') return renderPdf(packages.map((box) => slipPage(heading, box)));
  if (artifact === 'labels') return renderPdf(packages.map((box) => labelPage(heading, box)));

  return renderPdf(cardPages(packages));
}

const MARGIN = 54;
const LINE_HEIGHT = 16;

function slipPage(heading: string, box: PrintablePackage): PdfPage {
  const cursor = new Cursor(LETTER.heightPt - MARGIN);

  const lines: PdfLine[] = [
    { text: BRAND.organization, x: MARGIN, y: cursor.next(), size: 16, bold: true },
    { text: heading, x: MARGIN, y: cursor.next(), size: 10 },
    { text: orderLabel(box), x: MARGIN, y: cursor.next(LINE_HEIGHT * 1.5), size: 13, bold: true },
    { text: `Ordered by ${box.customerName}`, x: MARGIN, y: cursor.next(), size: 10 },
    { text: `To: ${box.recipientName}`, x: MARGIN, y: cursor.next(LINE_HEIGHT * 1.5), size: 13, bold: true },
    ...box.addressLines.map((line) => ({ text: line, x: MARGIN, y: cursor.next(), size: 11 })),
    {
      text: box.deliveryDay ? `${box.methodLabel} — ${box.deliveryDay}` : box.methodLabel,
      x: MARGIN,
      y: cursor.next(),
      size: 11,
    },
    { text: `${box.itemCount} item(s) in this box`, x: MARGIN, y: cursor.next(LINE_HEIGHT * 1.5), bold: true },
    ...box.lines.map((line) => ({
      text: `${line.quantity} x ${line.description}`,
      x: MARGIN,
      y: cursor.next(),
    })),
  ];

  if (box.greetingMessage) {
    lines.push({ text: 'Card message', x: MARGIN, y: cursor.next(LINE_HEIGHT * 1.5), bold: true });
    for (const wrapped of wrapText(box.greetingMessage, 11, LETTER.widthPt - MARGIN * 2)) {
      lines.push({ text: wrapped, x: MARGIN, y: cursor.next() });
    }
  }

  lines.push(
    {
      text: 'Printing this slip does not mark the box packed or sent.',
      x: MARGIN,
      y: MARGIN + LINE_HEIGHT,
      size: 9,
    },
    { text: `Box ${box.id}`, x: MARGIN, y: MARGIN, size: 8 },
  );

  return { size: LETTER, lines };
}

function labelPage(heading: string, box: PrintablePackage): PdfPage {
  const cursor = new Cursor(LABEL_STOCK.heightPt - 36);

  return {
    size: LABEL_STOCK,
    lines: [
      { text: BRAND.organization, x: 24, y: cursor.next(), size: 12, bold: true },
      { text: heading, x: 24, y: cursor.next(), size: 9 },
      { text: orderLabel(box), x: 24, y: cursor.next(), size: 9 },
      { text: box.recipientName, x: 24, y: cursor.next(LINE_HEIGHT * 2), size: 16, bold: true },
      ...box.addressLines.map((line) => ({ text: line, x: 24, y: cursor.next(LINE_HEIGHT * 1.2), size: 13 })),
      {
        text: box.deliveryDay ? `${box.methodLabel} — ${box.deliveryDay}` : box.methodLabel,
        x: 24,
        y: cursor.next(LINE_HEIGHT * 2),
        size: 10,
      },
      { text: `${box.itemCount} item(s)`, x: 24, y: cursor.next(), size: 10 },
      { text: `Box ${box.id}`, x: 24, y: 24, size: 7 },
    ],
  };
}

/**
 * One card per box that has a message (UR-013, G-021). A box with no greeting
 * gets no card rather than a blank one: card stock is expensive and a blank
 * card in a box reads as a mistake.
 */
function cardPages(packages: PrintablePackage[]): PdfPage[] {
  const withGreetings = packages.filter((box) => box.greetingMessage);

  if (withGreetings.length === 0) {
    return [
      {
        size: CARD_STOCK,
        lines: [
          { text: 'No greeting cards in this group.', x: 36, y: CARD_STOCK.heightPt / 2, size: 13 },
        ],
      },
    ];
  }

  return withGreetings.map((box) => {
    const cursor = new Cursor(CARD_STOCK.heightPt - 90);
    const message = wrapText(box.greetingMessage ?? '', 14, CARD_STOCK.widthPt - 72);

    return {
      size: CARD_STOCK,
      lines: [
        { text: BRAND.productName, x: 36, y: CARD_STOCK.heightPt - 54, size: 12, bold: true },
        { text: `To ${box.recipientName}`, x: 36, y: cursor.next(28), size: 16, bold: true },
        ...message.map((line) => ({ text: line, x: 36, y: cursor.next(22), size: 14 })),
        { text: `From ${box.customerName}`, x: 36, y: cursor.next(36), size: 13 },
        { text: `${orderLabel(box)} · ${box.methodLabel}`, x: 36, y: 30, size: 7 },
      ],
    };
  });
}

function orderLabel(box: PrintablePackage): string {
  return box.orderNumber === null ? box.draftReference : `Order #${box.orderNumber}`;
}

/** Walks down a page. PDF measures y from the bottom, so "next line" subtracts. */
class Cursor {
  constructor(private y: number) {}

  next(step: number = LINE_HEIGHT): number {
    this.y -= step;
    return this.y;
  }
}
