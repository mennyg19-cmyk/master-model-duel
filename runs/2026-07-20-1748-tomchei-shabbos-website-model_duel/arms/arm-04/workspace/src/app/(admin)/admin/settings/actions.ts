'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { recordAudit } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/staff';
import { dollarsFromForm } from '@/lib/core/money';
import { db } from '@/lib/db';
import { parseDeliveryZipList } from '@/lib/delivery-area';
import { writeSetting } from '@/lib/settings';
import type { StaffContext } from '@/lib/auth/staff';

/**
 * Every settings action follows the same three steps: check the permission,
 * parse the whole form with one named schema, and hand a failure back to the
 * page that submitted it through `?error=`. Settings pages are plain forms with
 * no client state, which is why the message travels on the URL rather than in a
 * `useActionState` return the way the catalog forms do.
 */

const STOREFRONT_PATHS = ['/', '/collection', '/order'];

const SETTINGS_PATH = '/admin/settings';
const SHIPPING_PATH = '/admin/settings/shipping';
const EMAIL_PATH = '/admin/settings/email';

/** Numbers arrive from a form as text, so they are read as text and then converted. */
const wholeNumber = (message: string) => z.string().trim().regex(/^\d+$/, message).transform(Number);

const storeOpenSchema = z.object({
  open: z.enum(['true', 'false']).transform((value) => value === 'true'),
});

const FOLLOW_UP_MESSAGE = 'Follow-up is a whole number of days between 0 and 90.';
const orderSettingsSchema = z.object({
  followUpDays: wholeNumber(FOLLOW_UP_MESSAGE).refine((days) => days <= 90, FOLLOW_UP_MESSAGE),
});

const BOX_MESSAGE = 'Box sizes need a name and whole-number dimensions above zero.';
const boxDimension = wholeNumber(BOX_MESSAGE).refine((value) => value > 0, BOX_MESSAGE);
const packageTypeSchema = z.object({
  name: z.string().trim().min(1, BOX_MESSAGE),
  lengthMm: boxDimension,
  widthMm: boxDimension,
  heightMm: boxDimension,
  maxWeightGrams: boxDimension,
});

const pickupLocationSchema = z.object({
  name: z.string().trim().min(1, 'Give the pickup location a name.'),
  line1: z.string().trim().min(1, 'A pickup location needs a street address.'),
  city: z.string().trim().min(1, 'A pickup location needs a city.'),
  state: z.string().trim().length(2, 'Use the two-letter state code.'),
  postalCode: z.string().trim().regex(/^\d{5}$/, 'Use a five-digit ZIP code.'),
  instructions: z.string().trim().optional(),
});

const shippingSchema = z.object({
  baseRate: dollarsFromForm,
  freeShippingThreshold: dollarsFromForm,
  deliveryZips: z.string(),
  deliveryDays: z.string(),
  // Where carriers collect from. Blank is allowed and means "not set up yet":
  // checkout then quotes nobody and prices shipping at the flat rate above,
  // which is a working store rather than a broken one.
  originName: z.string().trim(),
  originLine1: z.string().trim(),
  originLine2: z.string().trim(),
  originCity: z.string().trim(),
  originState: z.string().trim().max(2, 'Use the two-letter state code.'),
  originPostalCode: z
    .string()
    .trim()
    .regex(/^(\d{5})?$/, 'Use a five-digit ZIP code, or leave it empty.'),
  originPhone: z.string().trim(),
});

/** One label per line, in the words the drivers use ("Sunday 12 Adar"). */
function parseDeliveryDays(raw: string): string[] {
  return [...new Set(raw.split('\n').map((line) => line.trim()).filter(Boolean))].slice(0, 20);
}

/** Blank means "not set yet", which is different from a name nobody can read. */
const senderAddress = z
  .string()
  .trim()
  .refine(
    (value) => value === '' || z.email().safeParse(value).success,
    'Sender addresses have to be email addresses, or blank.',
  );

const emailSenderSchema = z.object({
  fromName: z
    .string()
    .trim()
    .min(1, 'Email has to come from a name, so recipients know who wrote.')
    .max(80, 'Keep the sender name to 80 characters or fewer.'),
  fromAddress: senderAddress,
  replyToAddress: senderAddress,
});

export async function setStoreOpenAction(formData: FormData) {
  const context = await requirePermission('settings.manage');
  const parsed = storeOpenSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) rejectWith(SETTINGS_PATH, 'The store can only be opened or closed.');

  await writeSetting('store.open', parsed.data.open);
  await recordAudit(context, {
    action: 'settings.store_open_changed',
    entityType: 'Setting',
    entityId: 'store.open',
    detail: { open: parsed.data.open },
  });

  revalidateStorefront(SETTINGS_PATH);
}

export async function saveOrderSettingsAction(formData: FormData) {
  const context = await requirePermission('settings.manage');
  const parsed = orderSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) rejectWith(SETTINGS_PATH, firstMessage(parsed.error));

  const { followUpDays } = parsed.data;
  await writeSetting('orders.followUpDays', followUpDays);
  await audit(context, 'orders.followUpDays', `${followUpDays} days`);

  revalidateStorefront(SETTINGS_PATH);
}

export async function savePackageTypeAction(formData: FormData) {
  const context = await requirePermission('settings.manage');
  const parsed = packageTypeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) rejectWith(SETTINGS_PATH, firstMessage(parsed.error));

  const packageTypeId = optionalText(formData, 'packageTypeId');
  const saved = packageTypeId
    ? await db.packageType.update({ where: { id: packageTypeId }, data: parsed.data })
    : await db.packageType.create({ data: parsed.data });

  await audit(context, 'orders.packageTypes', `saved ${saved.name}`);
  revalidatePath(SETTINGS_PATH);
}

export async function savePickupLocationAction(formData: FormData) {
  const context = await requirePermission('settings.manage');
  const parsed = pickupLocationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) rejectWith(SETTINGS_PATH, firstMessage(parsed.error));

  const pickupLocationId = optionalText(formData, 'pickupLocationId');
  const saved = pickupLocationId
    ? await db.pickupLocation.update({ where: { id: pickupLocationId }, data: parsed.data })
    : await db.pickupLocation.create({ data: parsed.data });

  await audit(context, 'orders.pickupLocations', `saved ${saved.name}`);
  revalidatePath(SETTINGS_PATH);
}

export async function saveShippingSettingsAction(formData: FormData) {
  const context = await requirePermission('settings.manage');
  const parsed = shippingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) rejectWith(SHIPPING_PATH, firstMessage(parsed.error));

  const { zips, rejected } = parseDeliveryZipList(parsed.data.deliveryZips);
  const days = parseDeliveryDays(parsed.data.deliveryDays);

  await writeSetting('shipping.baseRateCents', parsed.data.baseRate);
  await writeSetting('shipping.freeShippingThresholdCents', parsed.data.freeShippingThreshold);
  await writeSetting('shipping.deliveryZips', zips);
  await writeSetting('delivery.dayChoices', days);
  await writeSetting('shipping.origin', {
    name: parsed.data.originName,
    line1: parsed.data.originLine1,
    line2: parsed.data.originLine2,
    city: parsed.data.originCity,
    state: parsed.data.originState.toUpperCase(),
    postalCode: parsed.data.originPostalCode,
    phone: parsed.data.originPhone,
  });
  await audit(
    context,
    'shipping',
    `${zips.length} delivery ZIPs, ${days.length} delivery days, base rate ${parsed.data.baseRate}c, ` +
      `origin ${parsed.data.originPostalCode || 'unset'}`,
  );

  revalidateStorefront(SHIPPING_PATH);

  // Saved what was valid and said what was not: dropping the whole edit because
  // of one typo would lose the rest of the list.
  if (rejected.length > 0) {
    rejectWith(SHIPPING_PATH, `Saved ${zips.length} ZIP codes. Ignored: ${rejected.join(', ')}`);
  }
}

export async function saveEmailSettingsAction(formData: FormData) {
  const context = await requirePermission('settings.manage');
  const parsed = emailSenderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) rejectWith(EMAIL_PATH, firstMessage(parsed.error));

  await writeSetting('email.fromName', parsed.data.fromName);
  await writeSetting('email.fromAddress', parsed.data.fromAddress);
  await writeSetting('email.replyToAddress', parsed.data.replyToAddress);
  await audit(context, 'email', `sender ${parsed.data.fromAddress || 'unset'}`);

  revalidatePath(EMAIL_PATH);
}

async function audit(context: StaffContext, key: string, summary: string) {
  await recordAudit(context, {
    action: 'settings.changed',
    entityType: 'Setting',
    entityId: key,
    detail: { key, summary },
  });
}

function firstMessage(error: { issues: { message: string }[] }): string {
  return error.issues[0].message;
}

function rejectWith(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

/**
 * Settings drive storefront gates, so the pages that read them are revalidated
 * with the settings page itself — otherwise a closed store keeps serving a
 * cached "open" homepage.
 */
function revalidateStorefront(settingsPath: string) {
  revalidatePath(settingsPath);
  for (const path of STOREFRONT_PATHS) revalidatePath(path);
}

function optionalText(formData: FormData, field: string): string | undefined {
  const value = String(formData.get(field) ?? '').trim();
  return value === '' ? undefined : value;
}
