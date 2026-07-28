import { z } from "zod";
import { prisma } from "@/lib/db";

// Typed key-value settings store (R-161). Every key has a schema; reads
// validate so a bad row fails loudly instead of poisoning callers.
const settingSchemas = {
  "brand.name": z.string().min(1),
  "setup.completed": z.boolean(),
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
