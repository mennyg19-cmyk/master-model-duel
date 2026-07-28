// All prices are integer cents (R-164); these are the only conversions.

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Admin forms collect dollars ("36.00"); reject anything that isn't a clean
// non-negative cents amount instead of silently rounding fractions of a cent.
export function dollarsToCents(dollars: number): number | null {
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  const cents = dollars * 100;
  return Math.abs(cents - Math.round(cents)) < 1e-6 ? Math.round(cents) : null;
}

export function formatDelta(cents: number): string {
  if (cents === 0) return "included";
  const sign = cents > 0 ? "+" : "−";
  return `${sign}${formatCents(Math.abs(cents))}`;
}
