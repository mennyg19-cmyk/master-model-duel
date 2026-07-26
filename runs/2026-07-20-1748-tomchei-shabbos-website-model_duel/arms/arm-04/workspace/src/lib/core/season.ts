/**
 * A season is one Purim campaign year. Purim falls in Adar (Feb/Mar), so the
 * season year rolls over on July 1 — an order placed in August 2026 belongs to
 * the 2027 season.
 */
const SEASON_ROLLOVER_MONTH = 6;

export function seasonYearFor(date: Date): number {
  return date.getMonth() >= SEASON_ROLLOVER_MONTH ? date.getFullYear() + 1 : date.getFullYear();
}

export function seasonLabel(year: number): string {
  return `Purim ${year}`;
}
