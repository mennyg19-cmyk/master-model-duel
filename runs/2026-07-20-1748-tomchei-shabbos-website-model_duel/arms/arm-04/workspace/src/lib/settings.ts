import 'server-only';

import { z } from 'zod';

import { DEFAULT_TIME_ZONE, isValidTimeZone } from './core/timezone';
import { db } from './db';

/**
 * Typed key-value settings (R-161). Callers name a key and get a parsed value
 * with a guaranteed default, so no page has to defend against missing rows or
 * hand-written JSON shapes.
 */
const SETTING_SCHEMAS = {
  'setup.completed': z.boolean(),
  'store.open': z.boolean(),
  // R-101, R-129. The deployment is a rehearsal: every screen says so and the
  // destructive test console will answer. Stored rather than derived from
  // NODE_ENV because the rehearsal that matters is the one on the real hosting,
  // with the real database, the week before the season opens.
  'platform.testMode': z.boolean(),
  'brand.announcement': z.string(),
  // The office's own clock (UR-008). A scheduled season flip is entered as a
  // wall-clock time and stored as an instant, and this is what the two are
  // converted through.
  'store.timezone': z.string().refine(isValidTimeZone, 'That is not a timezone this server knows.'),
  'orders.followUpDays': z.number().int().min(0).max(90),
  // Five-digit ZIPs volunteer delivery covers. An empty list means nobody can
  // pick delivery, which is the safe reading of "not configured yet" (G-014).
  'shipping.deliveryZips': z.array(z.string().regex(/^\d{5}$/)),
  'shipping.baseRateCents': z.number().int().min(0),
  'shipping.freeShippingThresholdCents': z.number().int().min(0),
  // Where carriers collect from. Without it there is nothing to rate against,
  // so checkout falls back to the flat rate above rather than guessing an
  // origin (R-173).
  'shipping.origin': z.object({
    name: z.string(),
    line1: z.string(),
    line2: z.string(),
    city: z.string(),
    state: z.string(),
    postalCode: z.string(),
    phone: z.string(),
  }),
  // Days the manager opened for volunteer delivery in Purim week (UR-009,
  // G-015). Free text because the org labels them the way the drivers do
  // ("Sunday 12 Adar"), and an empty list means no day choice is offered.
  'delivery.dayChoices': z.array(z.string().min(1).max(60)),
  'email.fromName': z.string(),
  'email.fromAddress': z.string(),
  'email.replyToAddress': z.string(),
  // Branding every email wears (R-085). One header line, one footer line and
  // one colour is the whole of it: an org that wants a designed letter writes
  // it in the campaign body.
  'email.logoUrl': z.string(),
  'email.footerText': z.string(),
  'email.accentColor': z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #8a1c1c.'),
  // How long a delivered message stays readable before the purge takes it
  // (R-172). Queued and failed rows are never eligible whatever this says.
  'email.logRetentionDays': z.number().int().min(7).max(730),
} as const;

type SettingKey = keyof typeof SETTING_SCHEMAS;
type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_SCHEMAS)[K]>;

const DEFAULTS: { [K in SettingKey]: SettingValue<K> } = {
  'setup.completed': false,
  'store.open': false,
  'platform.testMode': false,
  'brand.announcement': '',
  'store.timezone': DEFAULT_TIME_ZONE,
  'orders.followUpDays': 3,
  'shipping.deliveryZips': [],
  'shipping.baseRateCents': 0,
  'shipping.freeShippingThresholdCents': 0,
  'shipping.origin': { name: '', line1: '', line2: '', city: '', state: '', postalCode: '', phone: '' },
  'delivery.dayChoices': [],
  'email.fromName': '',
  'email.fromAddress': '',
  'email.replyToAddress': '',
  'email.logoUrl': '',
  'email.footerText': '',
  'email.accentColor': '#8a1c1c',
  'email.logRetentionDays': 90,
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
