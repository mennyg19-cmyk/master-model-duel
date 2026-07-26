/** All money in this system is stored and computed as integer cents. Never floats. */

import { z } from 'zod';

/**
 * The one rule for what a dollar amount typed into a form looks like. Prices and
 * shipping rates used to each carry their own copy of this regex, which is two
 * places for the answer to drift.
 */
export const dollarsFromForm = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount like 36 or 36.50.')
  .transform((dollars) => Math.round(Number(dollars) * 100));

export function toCents(dollars: number): number {
  if (!Number.isFinite(dollars)) {
    throw new Error(`Cannot convert ${dollars} to cents; expected a finite dollar amount.`);
  }
  return Math.round(dollars * 100);
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}$${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

export function sumCents(amounts: number[]): number {
  return amounts.reduce((total, amount) => total + amount, 0);
}
