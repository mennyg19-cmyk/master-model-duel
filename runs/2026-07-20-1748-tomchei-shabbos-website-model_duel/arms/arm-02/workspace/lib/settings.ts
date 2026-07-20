import { z } from "zod";
import { db } from "@/lib/db";

/**
 * Typed registry over the Setting key-value table (R-161). Every business
 * setting declares its shape and default here; readers always get a valid
 * value and writers can't store a malformed one. Reads hit the DB every time
 * on purpose — an admin edit (e.g. delivery ZIPs) must apply on the next
 * request, with no cache to invalidate.
 */
const SETTING_SCHEMAS = {
  "store.closed_message": z
    .string()
    .default("The Purim store is closed for the season. Browse past collections and join the newsletter to hear when we reopen."),
  "orders.followup_days": z.number().int().min(0).default(3),
  "shipping.delivery_zips": z.array(z.string().regex(/^\d{5}$/, "ZIPs are 5 digits")).default(["08701"]),
  "shipping.rates": z
    .array(z.object({ name: z.string().min(1), amountCents: z.number().int().min(0) }))
    .default([{ name: "Local delivery (bulk)", amountCents: 500 }]),
  "shipping.rules": z
    .object({ bulkFeePerDestinationCents: z.number().int().min(0), perPackageFeeCents: z.number().int().min(0) })
    .default({ bulkFeePerDestinationCents: 500, perPackageFeeCents: 1200 }),
  // Purim-week day choices for per-package delivery (UR-009, G-015), set by a
  // manager each season. Checkout requires picking one when any line uses
  // per-package delivery.
  "delivery.purim_day_choices": z
    .array(z.string().min(1))
    .default(["Sunday before Purim", "Erev Purim (morning)", "Purim day"]),
  "email.from_address": z.string().default("purim@tomcheishabbos.example.org"),
  "email.reply_to": z.string().default("office@tomcheishabbos.example.org"),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_SCHEMAS)[K]>;

export const SETTING_KEYS = Object.keys(SETTING_SCHEMAS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return key in SETTING_SCHEMAS;
}

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const row = await db.setting.findUnique({ where: { key } });
  const parsed = SETTING_SCHEMAS[key].safeParse(row?.value);
  if (parsed.success) return parsed.data as SettingValue<K>;
  // Missing or malformed stored value: fall back to the declared default.
  return SETTING_SCHEMAS[key].parse(undefined) as SettingValue<K>;
}

/** Validates against the key's schema; throws ZodError on bad input. */
export async function setSetting<K extends SettingKey>(key: K, value: unknown): Promise<SettingValue<K>> {
  const parsed = SETTING_SCHEMAS[key].parse(value) as SettingValue<K>;
  await db.setting.upsert({
    where: { key },
    update: { value: parsed },
    create: { key, value: parsed },
  });
  return parsed;
}
