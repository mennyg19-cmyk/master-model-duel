import type { Prisma } from '@prisma/client';

import type { db } from '../db';

/**
 * Anything a query can run on: the shared client, or the scoped client Prisma
 * hands a transaction callback. Every helper that may be called from inside a
 * transaction takes this, so a caller never has to guess which spelling a
 * particular module chose.
 *
 * Type-only import of `db`, so this module carries no runtime dependency on the
 * server-only Prisma client.
 */
export type DbClient = Prisma.TransactionClient | typeof db;
