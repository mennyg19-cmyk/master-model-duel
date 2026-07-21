import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizeZip } from "@/lib/storefront/settings-keys";

type DbClient = Prisma.TransactionClient | typeof db;

export function recipientMemoryKey(input: {
  recipientName: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string | null;
}): string {
  return createHash("sha256")
    .update(
      [
        input.recipientName.trim().toLowerCase(),
        input.addressLine1.trim().toLowerCase(),
        input.city.trim().toLowerCase(),
        input.state.trim().toLowerCase(),
        normalizeZip(input.postalCode),
        (input.country ?? "US").trim().toLowerCase(),
      ].join("|"),
    )
    .digest("hex");
}

export async function rememberRecipientGreeting(input: {
  customerId: string;
  seasonId: string;
  recipientName: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string | null;
  greeting: string;
  tx?: DbClient;
}): Promise<void> {
  const client = input.tx ?? db;
  const recipientKey = recipientMemoryKey(input);
  await client.recipientGreetingMemory.upsert({
    where: {
      customerId_recipientKey: {
        customerId: input.customerId,
        recipientKey,
      },
    },
    create: {
      customerId: input.customerId,
      recipientKey,
      greeting: input.greeting,
      lastSeasonId: input.seasonId,
    },
    update: {
      greeting: input.greeting,
      lastSeasonId: input.seasonId,
    },
  });
}

export async function lookupRememberedGreeting(input: {
  customerId: string;
  recipientName: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string | null;
}): Promise<string | null> {
  const recipientKey = recipientMemoryKey(input);
  const row = await db.recipientGreetingMemory.findUnique({
    where: {
      customerId_recipientKey: {
        customerId: input.customerId,
        recipientKey,
      },
    },
  });
  return row?.greeting ?? null;
}

/** Effective greeting: per-line override, else order default, else remembered, else empty. */
export function resolveLineGreeting(
  lineGreeting: string | null | undefined,
  orderDefault: string | null | undefined,
  remembered: string | null | undefined,
): string {
  const override = (lineGreeting ?? "").trim();
  if (override) return override;
  const def = (orderDefault ?? "").trim();
  if (def) return def;
  return (remembered ?? "").trim();
}
