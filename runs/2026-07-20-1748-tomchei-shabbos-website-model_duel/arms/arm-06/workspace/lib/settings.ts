import { z } from "zod";
import { prisma } from "@/lib/db";

// Typed key-value settings store (R-161). Every key has a schema; reads
// validate so a bad row fails loudly instead of poisoning callers.
const zipSchema = z.string().regex(/^\d{5}$/, "ZIPs are 5 digits");

const settingSchemas = {
  "brand.name": z.string().min(1),
  "setup.completed": z.boolean(),
  // P3 settings hub (R-094/095): the delivery ZIP allowlist gates per-package
  // delivery at checkout (read live — edits take effect on the next request).
  "shipping.deliveryZips": z.array(zipSchema),
  "shipping.rules": z.array(z.object({ name: z.string().min(1), description: z.string() })),
  // P8 margin engine (UR-003): which carrier service levels count as
  // ground-comparable per carrier. Falls back to the code default
  // (GROUND_SERVICE_TOKENS) when unset; DB-editable for ops, no hub UI yet.
  "shipping.groundServiceTokens": z.record(z.string(), z.array(z.string().min(1))),
  // P5 delivery rules (UR-009/G-015): placeholder rate resolution — bulk is
  // one fee per destination, per-package one fee per recipient. P8 swaps
  // these for live Shippo rates behind the same resolver seam.
  "delivery.fees": z.object({
    bulkPerDestinationCents: z.number().int().nonnegative(),
    perPackagePerRecipientCents: z.number().int().nonnegative(),
  }),
  // Manager-set Purim-week day choices offered for per-package delivery.
  "delivery.days": z.array(z.string().min(1)),
  // P8: the org's shipping origin — carrier labels and rate quotes ship FROM
  // here. Editable in the settings hub (P12); seeded for Lakewood.
  "shipping.origin": z.object({
    name: z.string().min(1),
    line1: z.string().min(1),
    line2: z.string().optional(),
    city: z.string().min(1),
    region: z.string().min(1),
    postalCode: zipSchema,
    country: z.string().length(2),
  }),
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingSchemas)[K]>;

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K> | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return null;
  return settingSchemas[key].parse(row.value) as SettingValue<K>;
}

export async function setSetting<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<void> {
  const parsed = settingSchemas[key].parse(value);
  await prisma.setting.upsert({
    where: { key },
    update: { value: parsed },
    create: { key, value: parsed },
  });
}
