import { PrismaClient } from "@prisma/client";
import { NotFoundError } from "@/lib/errors";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Engine pattern: conditional UPDATE → re-fetch the row the update just
// wrote. The row can only be missing if it vanished mid-transaction, which is
// a real failure — throw instead of casting the null away.
export async function reloadOrThrow<T>(
  reload: () => Promise<T | null>,
  entity: string,
  id: string,
): Promise<T> {
  const row = await reload();
  if (!row) throw new NotFoundError(entity, id);
  return row;
}
