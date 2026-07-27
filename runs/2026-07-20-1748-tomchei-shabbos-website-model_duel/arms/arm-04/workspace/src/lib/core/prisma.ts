import { Prisma } from '@prisma/client';

/**
 * What a Prisma write error means, in one place.
 *
 * Three modules had grown their own copy of the P2002 detector and they had
 * already started to drift — two duck-typed the `code` property, one checked
 * the error class. A miss here is not a crash but a silent behaviour change:
 * an idempotent insert stops being idempotent and the caller reports a
 * duplicate as a real failure.
 */
export function isUniqueViolation(error: unknown): boolean {
  return hasPrismaCode(error, 'P2002');
}

/** The row a form asked to update was deleted between the page load and the save. */
export function isMissingRecord(error: unknown): boolean {
  return hasPrismaCode(error, 'P2025');
}

function hasPrismaCode(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
