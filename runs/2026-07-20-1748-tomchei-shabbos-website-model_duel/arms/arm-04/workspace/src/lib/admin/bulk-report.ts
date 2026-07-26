/**
 * How every bulk sweep in the admin reports itself (G-024).
 *
 * The rule: a bulk action never claims success it did not have. Two members of
 * staff sweeping the same list on Purim morning is the normal case, and the
 * second one has to be told exactly which rows somebody else already moved.
 *
 * Orders and packages both sweep, so the bounding, the counting and the
 * one-line summary live here rather than once per list. The batch id ties every
 * audit row a sweep wrote — the summary and the per-row ones — together.
 */
export const MAX_BULK_ITEMS = 100;

export type BulkOutcome = 'applied' | 'skipped' | 'conflict';

export type BulkRecord = {
  id: string;
  /** What the row is called on the screen: an order number, a recipient's name. */
  label: string;
  outcome: BulkOutcome;
  detail: string;
};

export type BulkReport = {
  batchId: string;
  action: string;
  requested: number;
  applied: number;
  skipped: number;
  conflicts: number;
  records: BulkRecord[];
  /** Ids past `MAX_BULK_ITEMS` that were not attempted at all. */
  droppedCount: number;
};

/**
 * De-duplicated and capped before anything is read, so a form posting the whole
 * table cannot turn one click into a thousand transactions.
 */
export function boundedIds(ids: string[]): { ids: string[]; droppedCount: number } {
  const unique = [...new Set(ids.filter((id) => id.trim() !== ''))];

  return {
    ids: unique.slice(0, MAX_BULK_ITEMS),
    droppedCount: Math.max(unique.length - MAX_BULK_ITEMS, 0),
  };
}

export function bulkReport(
  batchId: string,
  action: string,
  records: BulkRecord[],
  droppedCount: number,
): BulkReport {
  // Sorted by what staff read off the screen, not by the order the ids happened
  // to arrive in: two people running the same batch compare line by line.
  const sorted = [...records].sort((left, right) => left.label.localeCompare(right.label));

  return {
    batchId,
    action,
    requested: records.length + droppedCount,
    applied: countOf(records, 'applied'),
    skipped: countOf(records, 'skipped'),
    conflicts: countOf(records, 'conflict'),
    records: sorted,
    droppedCount,
  };
}

/** The one-line summary a redirect can carry back to the list. */
export function summarizeBulk(report: BulkReport): string {
  const parts = [`${report.applied} updated`];
  if (report.skipped > 0) parts.push(`${report.skipped} skipped`);
  if (report.conflicts > 0) parts.push(`${report.conflicts} conflicted`);
  if (report.droppedCount > 0) parts.push(`${report.droppedCount} over the ${MAX_BULK_ITEMS} limit`);

  return parts.join(', ');
}

/** Enough of a report to act on without opening the audit log. */
const OUTCOMES_IN_NOTICE = 4;

export function firstFewOutcomes(report: BulkReport): string {
  const notable = report.records.filter((record) => record.outcome !== 'applied');
  const shown = (notable.length > 0 ? notable : report.records).slice(0, OUTCOMES_IN_NOTICE);
  const rest = (notable.length > 0 ? notable.length : report.records.length) - shown.length;

  return [
    ...shown.map((record) => `${record.label} ${record.outcome}: ${record.detail}`),
    ...(rest > 0 ? [`and ${rest} more`] : []),
  ].join('; ');
}

function countOf(records: BulkRecord[], outcome: BulkOutcome): number {
  return records.filter((record) => record.outcome === outcome).length;
}
