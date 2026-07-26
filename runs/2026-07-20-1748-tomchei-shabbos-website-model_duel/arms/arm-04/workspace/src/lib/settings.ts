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
} as const;

type SettingKey = keyof typeof SETTING_SCHEMAS;
type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_SCHEMAS)[K]>;

const DEFAULTS: { [K in SettingKey]: SettingValue<K> } = {
  'setup.completed': false,
  'store.open': false,
  'brand.announcement': '',
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
