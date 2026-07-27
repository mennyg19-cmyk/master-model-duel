import { addressProblem } from '../core/addresses';
import { normalizeEmail } from '../core/normalize';
import { normalizePhone } from '../core/phone';

/**
 * Reading one line of the old system's export (R-186, G-029).
 *
 * Pure on purpose: no database, no customer matching, nothing that needs a
 * connection. A decade of volunteers typed this file and the rules for what
 * `#1,042 ` means are the part worth testing on their own, separately from
 * which customer record the row eventually lands on.
 *
 * The export is one line per item sent: who gave it, who received it, what it
 * was and what it cost. Orders are reassembled from the repaired order number,
 * which is why repairing it is the first thing that happens and an
 * unrepairable one is fatal to the row.
 */
export const LEGACY_COLUMNS =
  'orderNo, orderDate, donor, donorEmail, donorPhone, recipient, street, street2, city, state, zip, itemCode, item, qty, price, greeting';

export type LegacyAddress = {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  /** Why it cannot be delivered to as written, for the cleanup queue to repeat back. */
  problem: string | null;
};

export type LegacyParsedRow = {
  orderReference: string;
  placedAt: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  recipientName: string;
  address: LegacyAddress;
  productSlug: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  greeting: string | null;
};

export type LegacyReadResult =
  | { ok: true; row: LegacyParsedRow; note: string | null }
  | { ok: false; problem: string };

/**
 * `#1,042 `, `01042`, `1042 ` and `1042` are one order.
 *
 * Punctuation and padding come off; letters do not. A suffix like `1042-A` was
 * a real distinction in the old system — the second half of an order taken on a
 * different day — and folding it into `1042` would merge two people's boxes.
 *
 * At least one digit is required, which is what separates a reference from the
 * `see note` a volunteer typed in the column. Both are letters and punctuation
 * once the spaces come off, and one of them must not become an order.
 */
export function repairOrderReference(raw: string): string | null {
  const stripped = raw.replace(/[#,\s]+/g, '').toUpperCase();
  if (stripped === '') return null;
  if (!/^[A-Z0-9-]+$/.test(stripped) || !/\d/.test(stripped)) return null;

  const digitsOnly = /^0*(\d+)$/.exec(stripped);
  return digitsOnly ? digitsOnly[1] : stripped;
}

/** `$36.00`, `36`, `1,250.50` — all money the old system wrote down. */
export function parseLegacyMoney(raw: string): number | null {
  const stripped = raw.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(stripped)) return null;

  return Math.round(Number(stripped) * 100);
}

/** The old system wrote dates several ways; anything the platform can read is fine. */
export function parseLegacyDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const EMAIL_SHAPE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

export function readLegacyRow(values: Record<string, string>): LegacyReadResult {
  const orderReference = repairOrderReference(values.orderno ?? '');
  if (orderReference === null) {
    return { ok: false, problem: 'The order number is missing or is not a number this can repair.' };
  }

  const placedAt = parseLegacyDate(values.orderdate ?? '');
  if (placedAt === null) return { ok: false, problem: 'The order date cannot be read.' };

  const customerName = (values.donor ?? '').trim();
  if (customerName === '') return { ok: false, problem: 'The row does not say who gave it.' };

  const recipientName = (values.recipient ?? '').trim();
  if (recipientName === '') return { ok: false, problem: 'The row does not say who received it.' };

  const productName = (values.item ?? '').trim();
  if (productName === '') return { ok: false, problem: 'The row does not say what was sent.' };

  const unitPriceCents = parseLegacyMoney(values.price ?? '');
  if (unitPriceCents === null) return { ok: false, problem: 'The price cannot be read as an amount.' };

  const quantity = readQuantity(values.qty ?? '');
  if (quantity === null) return { ok: false, problem: 'The quantity is not a whole number of boxes.' };

  const rawEmail = (values.donoremail ?? '').trim();
  const email = EMAIL_SHAPE.test(rawEmail) ? normalizeEmail(rawEmail) : null;
  const phone = normalizePhone((values.donorphone ?? '').trim());

  const address = readAddress(values);

  return {
    ok: true,
    row: {
      orderReference,
      placedAt: placedAt.toISOString(),
      customerName,
      customerEmail: email,
      customerPhone: phone,
      recipientName,
      address,
      productSlug: productSlugOf(values.itemcode ?? '', productName),
      productName,
      quantity,
      unitPriceCents,
      greeting: (values.greeting ?? '').trim() || null,
    },
    note: noteFor(rawEmail, email, address),
  };
}

/**
 * A blank quantity is one box. Every line of the old export is something that
 * was physically delivered, and the column was only filled in when it was more
 * than one — refusing the row would throw away a real order over a habit.
 */
function readQuantity(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return 1;
  if (!/^\d+$/.test(trimmed)) return null;

  const quantity = Number(trimmed);
  return quantity >= 1 ? quantity : null;
}

/**
 * A broken address does not lose the order. The line still records that a box
 * went to this person — that is the history the repeat feature reads — and the
 * entry still goes in the address book, because an address nobody can fix is
 * the only thing the office knows about that recipient. It goes in carrying the
 * reason it is broken, which is what puts it in the cleanup queue (UR-014).
 */
function readAddress(values: Record<string, string>): LegacyAddress {
  const line1 = (values.street ?? '').trim();
  const city = (values.city ?? '').trim();
  const state = (values.state ?? '').trim().toUpperCase();
  const postalCode = (values.zip ?? '').trim();

  return {
    line1,
    line2: (values.street2 ?? '').trim() || null,
    city,
    state,
    postalCode,
    problem: addressProblem({ line1, city, state, postalCode }),
  };
}

/** The old item code when there is one, otherwise a slug made from the name. */
function productSlugOf(code: string, name: string): string {
  const source = code.trim() === '' ? name : code;

  return (
    source
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'legacy-item'
  );
}

function noteFor(rawEmail: string, email: string | null, address: LegacyAddress): string | null {
  const notes = [
    rawEmail !== '' && email === null ? `"${rawEmail}" is not an email address.` : null,
    address.problem,
  ].filter((note): note is string => note !== null);

  return notes.length === 0 ? null : notes.join(' ');
}
