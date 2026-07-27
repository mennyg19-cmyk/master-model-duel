import 'server-only';

import { recordAudit, type AuditActor } from '../audit';
import { BRAND } from '../brand';
import { failure, ok, type Result } from '../core/result';
import { fileNameFor } from '../print/print-filing';
import { LETTER, renderPdf, type PdfLine, type PdfPage } from '../print/pdf';
import type { PrintedDocument } from '../print/print-render';
import { listPickupCounter, type PickupRow } from './pickup-service';

/**
 * The door list (UR-010).
 *
 * What the person on the door works from: every box that is on the shelf and
 * not collected, in name order, with a tick box and the counter it is at. It is
 * paper and changes nothing, like every other document this app prints.
 */
export const NOTHING_TO_PRINT = 'pickup_door_list_empty';

export async function renderPickupDoorList(
  actor: AuditActor,
  input: { seasonId: string; seasonLabel: string },
): Promise<Result<PrintedDocument>> {
  const waiting = (await listPickupCounter(input.seasonId)).filter(
    (row) => row.pickedUpAt === null && row.blockedBy.length === 0,
  );

  if (waiting.length === 0) {
    return failure(NOTHING_TO_PRINT, 'No pickup box is waiting on the shelf, so there is no list.');
  }

  const sorted = [...waiting].sort((left, right) =>
    `${left.locationName}${left.recipientName}`.localeCompare(
      `${right.locationName}${right.recipientName}`,
    ),
  );

  await recordAudit(actor, {
    action: 'print.rendered',
    entityType: 'Season',
    entityId: input.seasonId,
    detail: { artifact: 'pickup door list', scope: 'group', packageCount: sorted.length },
  });

  return ok({
    fileName: fileNameFor(`${input.seasonLabel}-pickup door list`),
    bytes: renderPdf(doorListPages(sorted, input.seasonLabel)),
  });
}

const MARGIN = 48;
const LINE_HEIGHT = 16;
const ROWS_PER_PAGE = 30;

function doorListPages(rows: PickupRow[], seasonLabel: string): PdfPage[] {
  const pages: PdfPage[] = [];

  for (let start = 0; start < rows.length; start += ROWS_PER_PAGE) {
    const slice = rows.slice(start, start + ROWS_PER_PAGE);
    let y = LETTER.heightPt - MARGIN;

    const lines: PdfLine[] = [
      { text: BRAND.organization, x: MARGIN, y, size: 15, bold: true },
      { text: `${seasonLabel} — pickup door list`, x: MARGIN, y: (y -= LINE_HEIGHT), size: 12, bold: true },
      {
        text: `${rows.length} box(es) waiting · page ${Math.floor(start / ROWS_PER_PAGE) + 1}`,
        x: MARGIN,
        y: (y -= LINE_HEIGHT),
        size: 10,
      },
    ];

    for (const row of slice) {
      lines.push({
        text: `[  ]  ${row.recipientName} — ${row.customerName} · ${row.locationName} · ${row.orderLabel}`,
        x: MARGIN,
        y: (y -= LINE_HEIGHT),
        size: 11,
      });
    }

    pages.push({ size: LETTER, lines });
  }

  return pages;
}
