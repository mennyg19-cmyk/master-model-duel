import { PrismaClient } from "@prisma/client";
import { readServerEnvironment } from "@/lib/env";

readServerEnvironment();

const globalDatabase = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalDatabase.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalDatabase.prisma = db;
}
