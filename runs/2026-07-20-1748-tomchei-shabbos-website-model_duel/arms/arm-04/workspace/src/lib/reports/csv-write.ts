/**
 * Writing a CSV the office can open in Excel without it becoming a weapon
 * (R-092).
 *
 * Two separate problems live here. Quoting is the boring one: a recipient
 * called "Klein, Miriam" must not become two columns. Formula injection is the
 * other — a greeting typed as `=HYPERLINK("http://…")` is text in this app and
 * a live formula the moment the file is opened in a spreadsheet, so a value
 * that starts like a formula is prefixed with an apostrophe.
 *
 * `src/lib/imports/csv.ts` deliberately does *not* escape on the way in: a
 * legitimate `-5` would be corrupted, and a value that arrived by some other
 * route would still be missed. This is the one point where a spreadsheet file
 * is produced, so this is where it is done.
 */

/** Excel treats these leading characters as the start of a formula. */
const FORMULA_STARTERS = /^[=+@\t\r]/;

/** A minus sign only starts a formula when what follows is not just a number. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvRow(values: string[]): string {
  return `${values.map(csvValue).join(',')}\r\n`;
}

export function toCsv(headers: string[], rows: string[][]): string {
  return [csvRow(headers), ...rows.map(csvRow)].join('');
}

/** Cents as a bare decimal, so a spreadsheet column of them adds up. */
export function csvAmount(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';

  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

/** ISO 8601 date only: unambiguous between the office and whoever it is sent to. */
export function csvDate(date: Date | null | undefined): string {
  return date ? date.toISOString().slice(0, 10) : '';
}

function csvValue(raw: string): string {
  const value = escapeFormula(raw);
  const needsQuotes = /[",\r\n]/.test(value) || value !== value.trim();

  return needsQuotes ? `"${value.replaceAll('"', '""')}"` : value;
}

function escapeFormula(value: string): string {
  if (FORMULA_STARTERS.test(value)) return `'${value}`;
  if (value.startsWith('-') && !PLAIN_NUMBER.test(value)) return `'${value}`;
  return value;
}
