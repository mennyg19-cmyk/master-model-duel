import 'server-only';

import type { Prisma } from '@prisma/client';

import { db } from './db';
import { ok, type Failure, type Result } from './core/result';

/**
 * Finalizing serializes on the season's number counter, so a burst of checkouts
 * queues rather than running in parallel. Prisma's five second default is not
 * enough headroom for that at Purim-week volumes.
 */
const TRANSACTION_TIMEOUT_MS = 20_000;

/**
 * Prisma only rolls a transaction back when the callback throws, so a domain
 * failure has to travel out as an exception and be unwrapped here. Returning a
 * failure from inside the callback would commit the half-finished work.
 */
class TransactionAbort extends Error {
  constructor(readonly reason: Failure) {
    super(reason.code);
    this.name = 'TransactionAbort';
  }
}

/** Rolls the surrounding `runInTransaction` back and reports `reason` to its caller. */
export function abort(reason: Failure): never {
  throw new TransactionAbort(reason);
}

export async function runInTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<Result<T>> {
  try {
    const value = await db.$transaction(work, {
      timeout: TRANSACTION_TIMEOUT_MS,
      maxWait: TRANSACTION_TIMEOUT_MS,
    });
    return ok(value);
  } catch (error) {
    if (error instanceof TransactionAbort) return error.reason;
    throw error;
  }
}
