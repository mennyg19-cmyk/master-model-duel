import 'server-only';

import { z } from 'zod';

import { db } from './db';

/**
 * Typed key-value settings (R-161). Callers name a key and get a parsed value
 * with a guaranteed default, so no page has to defend against missing rows or
 * hand-written JSON shapes.
 */
const SETTING_SCHEMAS = {
  'setup.completed': z.boolean(),
  'store.open': z.boolean(),
  'brand.announcement': z.string(),
  'orders.followUpDays': z.number().int().min(0).max(90),
  // Five-digit ZIPs volunteer delivery covers. An empty list means nobody can
  // pick delivery, which is the safe reading of "not configured yet" (G-014).
  'shipping.deliveryZips': z.array(z.string().regex(/^\d{5}$/)),
  'shipping.baseRateCents': z.number().int().min(0),
  'shipping.freeShippingThresholdCents': z.number().int().min(0),
  // Days the manager opened for volunteer delivery in Purim week (UR-009,
  // G-015). Free text because the org labels them the way the drivers do
  // ("Sunday 12 Adar"), and an empty list means no day choice is offered.
  'delivery.dayChoices': z.array(z.string().min(1).max(60)),
  'email.fromName': z.string(),
  'email.fromAddress': z.string(),
  'email.replyToAddress': z.string(),
} as const;

type SettingKey = keyof typeof SETTING_SCHEMAS;
type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_SCHEMAS)[K]>;

const DEFAULTS: { [K in SettingKey]: SettingValue<K> } = {
  'setup.completed': false,
  'store.open': false,
  'brand.announcement': '',
  'orders.followUpDays': 3,
  'shipping.deliveryZips': [],
  'shipping.baseRateCents': 0,
  'shipping.freeShippingThresholdCents': 0,
  'delivery.dayChoices': [],
  'email.fromName': '',
  'email.fromAddress': '',
  'email.replyToAddress': '',
};

export async function readSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const row = await db.setting.findUnique({ where: { key } });
  if (!row) return DEFAULTS[key];

  const parsed = SETTING_SCHEMAS[key].safeParse(row.value);
  return parsed.success ? (parsed.data as SettingValue<K>) : DEFAULTS[key];
}

export async function writeSetting<K extends SettingKey>(key: K, value: SettingValue<K>) {
  const parsed = SETTING_SCHEMAS[key].parse(value);
  await db.setting.upsert({
    where: { key },
    create: { key, value: parsed },
    update: { value: parsed },
  });
}
