import 'server-only';

import type { ImportRowStatus } from '@prisma/client';
import { z } from 'zod';

import { normalizeEmail } from '../core/normalize';
import { normalizePhone } from '../core/phone';
import { db } from '../db';

/**
 * What one spreadsheet row means (R-063).
 *
 * The readers are separate from the pipeline because this is the part that
 * changes: a new column, a new rule about phone numbers. Each one answers the
 * same three questions — is this row usable, does it already exist, and what
 * exactly will be written — and the answer is stored so the commit does not
 * have to trust the preview screen.
 */
export type StagedRow = {
  lineNumber: number;
  status: ImportRowStatus;
  parsed: Record<string, string>;
  problem: string | null;
  matchedId: string | null;
};

type CsvRow = { lineNumber: number; values: Record<string, string> };

/**
 * The columns the schemas below actually accept, in one place, because the
 * upload form has to tell the operator what to put in the file and a hint that
 * has drifted from the reader is worse than no hint. `price` is dollars — the
 * reader turns it into cents.
 */
export const IMPORT_COLUMNS = {
  CUSTOMERS: 'fullName (or name), email, phone',
  PRODUCTS: 'slug, name, price (in dollars), category',
} as const;

const customerSchema = z.object({
  fullname: z.string().trim().min(1, 'A customer needs a name.').max(120),
  email: z.email('That is not an email address.'),
  phone: z
    .string()
    .trim()
    .refine((value) => value === '' || normalizePhone(value) !== null, 'That is not a 10-digit US phone number.'),
});

export async function readCustomerRow(row: CsvRow, seenEmails: Set<string>): Promise<StagedRow> {
  const parsed = customerSchema.safeParse({
    fullname: row.values.fullname ?? row.values.name ?? '',
    email: row.values.email ?? '',
    phone: row.values.phone ?? '',
  });

  if (!parsed.success) return invalid(row, parsed.error.issues[0].message);

  const normalizedEmail = normalizeEmail(parsed.data.email);
  const values = {
    fullname: parsed.data.fullname,
    email: parsed.data.email.trim(),
    phone: parsed.data.phone,
  };

  // The same address twice in one file is the operator's mistake, not a record
  // to update: importing it would apply whichever line happened to be last.
  if (seenEmails.has(normalizedEmail)) {
    return { ...base(row, values), status: 'INVALID', problem: 'This address appears earlier in the file.' };
  }
  seenEmails.add(normalizedEmail);

  const existing = await db.customer.findUnique({ where: { normalizedEmail } });
  if (existing) {
    return {
      ...base(row, values),
      status: 'DUPLICATE',
      problem: `Already on file as ${existing.fullName}; the import will update it.`,
      matchedId: existing.id,
    };
  }

  const phoneDigits = parsed.data.phone === '' ? null : normalizePhone(parsed.data.phone);
  const phoneOwner = phoneDigits
    ? await db.customer.findUnique({ where: { normalizedPhone: phoneDigits } })
    : null;

  if (phoneOwner) {
    return {
      ...base(row, values),
      status: 'DUPLICATE',
      problem: `That phone number is already on ${phoneOwner.fullName}'s record; the import will leave that name alone.`,
      matchedId: phoneOwner.id,
    };
  }

  return base(row, values);
}

const productSchema = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'A slug is lower-case words joined by hyphens.')
    .max(80),
  name: z.string().trim().min(1, 'A product needs a name.').max(120),
  price: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'Enter a price like 36 or 36.50.')
    .transform((dollars) => Math.round(Number(dollars) * 100)),
  category: z.string().trim().max(60),
});

export async function readProductRow(
  row: CsvRow,
  seasonId: string,
  seenSlugs: Set<string>,
): Promise<StagedRow> {
  const parsed = productSchema.safeParse({
    slug: row.values.slug ?? '',
    name: row.values.name ?? '',
    // Only `price`, and only in dollars. A `priceCents` column used to be read
    // here as well — as dollars — so a file that said 3650 meaning $36.50 was
    // imported at $3,650.
    price: row.values.price ?? '',
    category: row.values.category ?? '',
  });

  if (!parsed.success) return invalid(row, parsed.error.issues[0].message);

  const values = {
    slug: parsed.data.slug,
    name: parsed.data.name,
    pricecents: String(parsed.data.price),
    category: parsed.data.category,
  };

  if (seenSlugs.has(parsed.data.slug)) {
    return { ...base(row, values), status: 'INVALID', problem: 'This slug appears earlier in the file.' };
  }
  seenSlugs.add(parsed.data.slug);

  const existing = await db.product.findUnique({
    where: { seasonId_slug: { seasonId, slug: parsed.data.slug } },
  });

  if (existing) {
    return {
      ...base(row, values),
      status: 'DUPLICATE',
      problem: `Already in this season as ${existing.name}; the import will update it.`,
      matchedId: existing.id,
    };
  }

  return base(row, values);
}

function base(row: CsvRow, values: Record<string, string>): StagedRow {
  return { lineNumber: row.lineNumber, status: 'VALID', parsed: values, problem: null, matchedId: null };
}

/** An unusable row keeps what was typed, so the preview can show it back. */
function invalid(row: CsvRow, problem: string): StagedRow {
  return {
    lineNumber: row.lineNumber,
    status: 'INVALID',
    parsed: row.values,
    problem,
    matchedId: null,
  };
}
