import 'server-only';

import { recordAudit, type AuditActor } from '../audit';
import { BRAND } from '../brand';
import { failure, ok, type Result } from '../core/result';
import { renderArtifact } from '../print/documents';
import { fileNameFor } from '../print/print-filing';
import { readPrintablePackages } from '../print/print-data';
import type { PrintedDocument } from '../print/print-render';
import { LETTER, renderPdf, wrapText, type PdfLine, type PdfPage } from '../print/pdf';
import type { RouteArtifact } from './paths';
import { readRouteForAdmin, type RouteView } from './route-view';

/**
 * Paper for a van (R-075, R-076, UR-013).
 *
 * Two documents. The **route sheet** is the fallback the whole magic-link design
 * depends on: a phone with no signal in a stairwell is normal, so the same route
 * has to be drivable off a clipboard — every stop, in order, with the address and
 * the phone number, and a box to tick. The **cards** are the greeting cards for
 * this run only, so the driver is not handed the whole night's card stock.
 *
 * Neither changes a package. Printing is paper (G-002, G-004).
 */
export const ROUTE_NOT_PRINTABLE = 'route_not_printable';

export async function renderRouteArtifact(
  actor: AuditActor,
  input: { routeId: string; seasonId: string; artifact: RouteArtifact },
): Promise<Result<PrintedDocument>> {
  const route = await readRouteForAdmin(input.routeId, input.seasonId);

  if (!route) return failure(ROUTE_NOT_PRINTABLE, 'That route is not one of this season\u2019s.');
  if (route.stops.length === 0) {
    return failure(ROUTE_NOT_PRINTABLE, 'This route has no stops on it, so there is nothing to print.');
  }

  const bytes =
    input.artifact === 'sheet'
      ? renderPdf(sheetPages(route))
      : renderArtifact(
          'cards',
          route.label,
          await readPrintablePackages({ id: { in: route.stops.map((stop) => stop.packageId) } }),
        );

  await recordAudit(actor, {
    action: 'print.rendered',
    entityType: 'DeliveryRoute',
    entityId: route.id,
    detail: {
      artifact: input.artifact === 'sheet' ? 'route sheet' : 'greeting cards',
      scope: 'group',
      packageCount: route.stops.length,
    },
  });

  return ok({
    fileName: fileNameFor(`${route.label}-${input.artifact === 'sheet' ? 'route sheet' : 'greeting cards'}`),
    bytes,
  });
}

const MARGIN = 48;
const LINE_HEIGHT = 15;
const STOPS_PER_PAGE = 6;

function sheetPages(route: RouteView): PdfPage[] {
  const pages: PdfPage[] = [];

  for (let start = 0; start < route.stops.length; start += STOPS_PER_PAGE) {
    const slice = route.stops.slice(start, start + STOPS_PER_PAGE);
    const cursor = new Cursor(LETTER.heightPt - MARGIN);

    const lines: PdfLine[] = [
      { text: BRAND.organization, x: MARGIN, y: cursor.next(), size: 15, bold: true },
      {
        text: `${route.label}${route.deliveryDay ? ` — ${route.deliveryDay}` : ''}`,
        x: MARGIN,
        y: cursor.next(),
        size: 12,
        bold: true,
      },
      {
        text: `Driver: ${route.driverName ?? 'not assigned'} · ${route.stops.length} stop(s) · page ${
          Math.floor(start / STOPS_PER_PAGE) + 1
        }`,
        x: MARGIN,
        y: cursor.next(),
        size: 10,
      },
    ];

    for (const stop of slice) {
      lines.push(
        {
          text: `[  ]  ${stop.sequence + 1}. ${stop.recipientName}`,
          x: MARGIN,
          y: cursor.next(LINE_HEIGHT * 2),
          size: 13,
          bold: true,
        },
        { text: stop.addressLine, x: MARGIN + 24, y: cursor.next(), size: 11 },
        {
          text: [
            `${stop.itemCount} item(s)`,
            stop.orderLabel,
            stop.contactPhone ? `call ${stop.contactPhone}` : '',
            stop.deliveryWindow ?? '',
          ]
            .filter((part) => part !== '')
            .join(' · '),
          x: MARGIN + 24,
          y: cursor.next(),
          size: 10,
        },
      );

      if (stop.greetingMessage) {
        for (const wrapped of wrapText(`Card: ${stop.greetingMessage}`, 9, LETTER.widthPt - MARGIN * 2 - 24)) {
          lines.push({ text: wrapped, x: MARGIN + 24, y: cursor.next(12), size: 9 });
        }
      }
    }

    lines.push({
      text: 'Tick each box as you deliver it and hand this sheet back to the office.',
      x: MARGIN,
      y: MARGIN,
      size: 9,
    });

    pages.push({ size: LETTER, lines });
  }

  return pages;
}

/** Walks down a page. PDF measures y from the bottom, so "next line" subtracts. */
class Cursor {
  constructor(private y: number) {}

  next(step: number = LINE_HEIGHT): number {
    this.y -= step;
    return this.y;
  }
}
