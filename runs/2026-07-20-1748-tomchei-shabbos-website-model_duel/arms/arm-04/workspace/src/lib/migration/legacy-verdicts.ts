import 'server-only';

import type { LegacyRowStatus } from '@prisma/client';

import { db } from '../db';
import { readLegacyRow, type LegacyParsedRow } from './legacy-rows';

/**
 * What the dry run decides about every line, before anything is written
 * (R-186, G-029).
 *
 * `legacy-rows.ts` reads a line on its own; this is the part that needs the
 * database: which household the row belongs to, and whether the order is
 * already here from an earlier import. Four verdicts come out of it —
 * readable, already-here, unreadable, and asked-about — and a question is not
 * an error: the commit refuses while one is open and answering it takes one
 * click.
 *
 * The lookups are batched rather than per-row. A decade of history is tens of
 * thousands of lines, and a query for each one is the version of this that
 * nobody waits for.
 */
export type LegacyCandidate = { id: string; label: string };

export type Verdict = {
  lineNumber: number;
  status: LegacyRowStatus;
  orderReference: string | null;
  parsed: LegacyParsedRow | null;
  problem: string | null;
  candidates: LegacyCandidate[];
  mappedCustomerId: string | null;
};

/** One transaction's worth of history. Small enough to never hold a lock long. */
export const ORDERS_PER_CHUNK = 5;

export async function readVerdicts(
  rows: { lineNumber: number; values: Record<string, string> }[],
  seasonId: string,
): Promise<Verdict[]> {
  const parsedRows = rows.map((row) => ({ lineNumber: row.lineNumber, read: readLegacyRow(row.values) }));

  const needName = parsedRows.flatMap((row) =>
    row.read.ok && row.read.row.customerEmail === null ? [row.read.row] : [],
  );

  const [byPhone, byName, alreadyImported] = await Promise.all([
    findCustomersByPhone(needName.flatMap((row) => (row.customerPhone ? [row.customerPhone] : []))),
    findCustomersByName([...new Set(needName.map((row) => row.customerName))]),
    findImportedReferences(
      seasonId,
      parsedRows.flatMap((row) => (row.read.ok ? [row.read.row.orderReference] : [])),
    ),
  ]);

  return parsedRows.map(({ lineNumber, read }) => {
    if (!read.ok) {
      return {
        lineNumber,
        status: 'INVALID' as const,
        orderReference: null,
        parsed: null,
        problem: read.problem,
        candidates: [],
        mappedCustomerId: null,
      };
    }

    const base = {
      lineNumber,
      orderReference: read.row.orderReference,
      parsed: read.row,
      problem: read.note,
    };

    const settled = (status: LegacyRowStatus, mappedCustomerId: string | null) => ({
      ...base,
      status: status === 'VALID' && alreadyImported.has(read.row.orderReference) ? 'DUPLICATE' : status,
      candidates: [],
      mappedCustomerId,
    });

    if (read.row.customerEmail !== null) return settled('VALID', null);

    const phoneMatch = read.row.customerPhone ? byPhone.get(read.row.customerPhone) : undefined;
    if (phoneMatch) return settled('VALID', phoneMatch.id);

    const named = byName.get(read.row.customerName.toLowerCase()) ?? [];
    if (named.length === 1) return settled('VALID', named[0].id);

    if (named.length === 0) {
      return {
        ...base,
        status: 'INVALID' as const,
        problem: `No email address, and nobody on file is called "${read.row.customerName}".`,
        candidates: [],
        mappedCustomerId: null,
      };
    }

    return {
      ...base,
      status: 'NEEDS_MAPPING' as const,
      problem: `No email address, and ${named.length} customers are called "${read.row.customerName}".`,
      candidates: named.map((customer) => ({
        id: customer.id,
        label: `${customer.fullName} <${customer.email}>`,
      })),
      mappedCustomerId: null,
    };
  });
}

const NAME_LOOKUP_BATCH = 100;

async function findCustomersByName(
  names: string[],
): Promise<Map<string, { id: string; fullName: string; email: string }[]>> {
  const found: { id: string; fullName: string; email: string }[] = [];

  for (let start = 0; start < names.length; start += NAME_LOOKUP_BATCH) {
    const batch = names.slice(start, start + NAME_LOOKUP_BATCH);

    found.push(
      ...(await db.customer.findMany({
        where: { OR: batch.map((name) => ({ fullName: { equals: name, mode: 'insensitive' as const } })) },
        select: { id: true, fullName: true, email: true },
      })),
    );
  }

  const byName = new Map<string, { id: string; fullName: string; email: string }[]>();
  for (const customer of found) {
    const key = customer.fullName.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), customer]);
  }

  return byName;
}

async function findCustomersByPhone(phones: string[]): Promise<Map<string, { id: string }>> {
  if (phones.length === 0) return new Map();

  const customers = await db.customer.findMany({
    where: { normalizedPhone: { in: [...new Set(phones)] } },
    select: { id: true, normalizedPhone: true },
  });

  return new Map(
    customers.flatMap((customer) =>
      customer.normalizedPhone === null ? [] : [[customer.normalizedPhone, { id: customer.id }] as const],
    ),
  );
}

async function findImportedReferences(seasonId: string, references: string[]): Promise<Set<string>> {
  if (references.length === 0) return new Set();

  const orders = await db.order.findMany({
    where: { seasonId, importedOrderReference: { in: [...new Set(references)] } },
    select: { importedOrderReference: true },
  });

  return new Set(
    orders.flatMap((order) => (order.importedOrderReference === null ? [] : [order.importedOrderReference])),
  );
}

/** Orders are grouped whole, so a chunk is always a round number of orders. */
export function assignChunks(verdicts: Verdict[]): Map<string, number> {
  const references = [
    ...new Set(
      verdicts.flatMap((verdict) => (verdict.orderReference === null ? [] : [verdict.orderReference])),
    ),
  ].sort();

  return new Map(
    references.map((reference, index) => [reference, Math.floor(index / ORDERS_PER_CHUNK)]),
  );
}

export function countVerdicts(verdicts: Verdict[]) {
  return {
    validCount: verdicts.filter((verdict) => verdict.status === 'VALID').length,
    duplicateCount: verdicts.filter((verdict) => verdict.status === 'DUPLICATE').length,
    needsMappingCount: verdicts.filter((verdict) => verdict.status === 'NEEDS_MAPPING').length,
    invalidCount: verdicts.filter((verdict) => verdict.status === 'INVALID').length,
  };
}

export function sourceTotal(verdicts: Verdict[]): number {
  return verdicts.reduce(
    (total, verdict) =>
      verdict.parsed && verdict.status !== 'INVALID'
        ? total + verdict.parsed.unitPriceCents * verdict.parsed.quantity
        : total,
    0,
  );
}
