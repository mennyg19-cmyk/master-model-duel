import 'server-only';

import { ZIP_CODE } from './core/addresses';
import { readSetting } from './settings';

/**
 * Volunteer delivery only runs where volunteers actually drive, so the ZIP list
 * is a hard block with no manager override (G-014). Shipping is the answer for
 * everywhere else, which is why an out-of-area address is a redirect to
 * shipping rather than an error.
 */
export type DeliveryAreaCheck =
  | { deliverable: true; postalCode: string }
  | { deliverable: false; reason: 'malformed' | 'out_of_area' | 'not_configured' };

/** Accepts "08701", "08701-1234" and " 08701 "; anything else is not a US ZIP. */
export function normalizePostalCode(value: string): string | null {
  const match = ZIP_CODE.exec(value.trim().replace(/\s+/g, ''));
  return match ? match[1] : null;
}

export function checkDeliveryArea(postalCode: string, deliveryZips: string[]): DeliveryAreaCheck {
  const normalized = normalizePostalCode(postalCode);
  if (!normalized) return { deliverable: false, reason: 'malformed' };
  if (deliveryZips.length === 0) return { deliverable: false, reason: 'not_configured' };

  return deliveryZips.includes(normalized)
    ? { deliverable: true, postalCode: normalized }
    : { deliverable: false, reason: 'out_of_area' };
}

export const DELIVERY_AREA_MESSAGES: Record<
  Exclude<DeliveryAreaCheck, { deliverable: true }>['reason'],
  string
> = {
  malformed: 'That does not look like a US ZIP code. Enter five digits, for example 08701.',
  out_of_area: 'Volunteers do not drive to that ZIP code. Shipping is available everywhere.',
  not_configured: 'Volunteer delivery is not set up yet. Shipping is available everywhere.',
};

/** Reads the list on every call: a settings edit must apply to the next request. */
export async function checkDeliveryAreaNow(postalCode: string): Promise<DeliveryAreaCheck> {
  return checkDeliveryArea(postalCode, await readSetting('shipping.deliveryZips'));
}

/** Parses the settings textarea: one ZIP per line or comma-separated, deduped. */
export function parseDeliveryZipList(raw: string): { zips: string[]; rejected: string[] } {
  const zips = new Set<string>();
  const rejected: string[] = [];

  for (const entry of raw.split(/[\s,;]+/).filter(Boolean)) {
    const normalized = normalizePostalCode(entry);
    if (normalized) zips.add(normalized);
    else rejected.push(entry);
  }

  return { zips: [...zips].sort(), rejected };
}
