import { Prisma } from "@prisma/client";

/** Prisma unique-constraint violation (P2002) — the "lost the insert race" signal. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Prisma record-not-found on update/delete (P2025). */
export function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
}
