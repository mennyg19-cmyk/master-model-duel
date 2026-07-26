import 'server-only';

import type { Prisma } from '@prisma/client';

import { filingGroupOf, filingSortKey, orderFilingGroups } from './filing-groups';
import { readPrintablePackages, type PrintablePackage } from './print-data';

/**
 * How boxes become the rows a batch stores, and how those rows become a pile
 * again. The batch service writes through this and the render path reads
 * through it, which is why neither of them owns it.
 */
export const PRINT_GROUP_NOT_FOUND = 'print_group_not_found';
export const NOTHING_TO_PRINT = 'nothing_to_print';
export const NOT_PRINTABLE = 'not_printable';

/**
 * Turns a set of boxes into the nested group-and-item rows a batch is created
 * with, in the order the printer should hand them over.
 */
export function groupCreateInput(
  packages: PrintablePackage[],
): Prisma.PrintBatchGroupCreateWithoutBatchInput[] {
  const groups = new Map<string, { label: string; methodSortOrder: number; boxes: PrintablePackage[] }>();

  for (const box of packages) {
    const filing = filingGroupOf(box);
    const existing = groups.get(filing.filingKey);

    if (existing) existing.boxes.push(box);
    else {
      groups.set(filing.filingKey, {
        label: filing.label,
        methodSortOrder: filing.methodSortOrder,
        boxes: [box],
      });
    }
  }

  const ordered = orderFilingGroups(
    [...groups].map(([filingKey, group]) => ({
      filingKey,
      label: group.label,
      methodSortOrder: group.methodSortOrder,
    })),
  );

  return ordered.map((group, index) => {
    const boxes = groups.get(group.filingKey)?.boxes ?? [];

    return {
      filingKey: group.filingKey,
      label: group.label,
      sortIndex: index,
      packageCount: boxes.length,
      items: {
        create: boxes.map((box) => ({
          packageId: box.id,
          orderId: box.orderId,
          sortKey: filingSortKey(box),
        })),
      },
    };
  });
}

/**
 * The boxes of a group in the order the batch froze them in. A box deleted since
 * the batch was built simply is not in the pile any more, which is why this maps
 * over what came back rather than over the item rows.
 */
export async function readInFilingOrder(
  filings: { packageId: string; sortKey: string }[],
): Promise<PrintablePackage[]> {
  const sortKeys = new Map(filings.map((filing) => [filing.packageId, filing.sortKey]));
  const packages = await readPrintablePackages({ id: { in: [...sortKeys.keys()] } });

  return packages.sort((left, right) =>
    (sortKeys.get(left.id) ?? '').localeCompare(sortKeys.get(right.id) ?? ''),
  );
}

export function fileNameFor(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return `${slug || 'print'}.pdf`;
}
