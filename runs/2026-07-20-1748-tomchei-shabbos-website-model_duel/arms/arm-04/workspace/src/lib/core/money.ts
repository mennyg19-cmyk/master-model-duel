/** All money in this system is stored and computed as integer cents. Never floats. */

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
