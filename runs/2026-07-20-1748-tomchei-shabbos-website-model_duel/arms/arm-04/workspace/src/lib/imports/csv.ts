/**
 * A small RFC 4180 reader for the office's spreadsheets (R-063).
 *
 * Written rather than pulled in because the input is one thing — a file someone
 * exported from Excel or Google Sheets — and the whole surface is quoted fields,
 * doubled quotes and either line ending. Anything stranger than that belongs in
 * an error message telling the operator to re-export, not in a parser.
 *
 * ponytail: values that begin `=`, `+`, `-` or `@` are stored as they were
 * typed. Nothing in this app writes a CSV back out, so there is no spreadsheet
 * to run them as formulas; the place to escape them is the export in P12, at the
 * point where a file is produced, not here on the way in where it would corrupt
 * a legitimate `-5` and still miss anything written by another route.
 */
export type CsvTable = {
  headers: string[];
  /** One record per data row, keyed by the header, in file order. */
  rows: { lineNumber: number; values: Record<string, string> }[];
};

export const CSV_MAX_ROWS = 5_000;

export class CsvError extends Error {}

export function parseCsv(input: string): CsvTable {
  const records = readRecords(stripBom(input));
  if (records.length === 0) throw new CsvError('That file is empty.');

  const headers = records[0].map(normalizeHeader);
  if (headers.some((header) => header === '')) throw new CsvError('Every column needs a heading.');
  if (new Set(headers).size !== headers.length) {
    throw new CsvError('Two columns share a heading, so a row could mean two things.');
  }

  const dataRecords = records.slice(1).filter((record) => !isBlank(record));
  if (dataRecords.length > CSV_MAX_ROWS) {
    throw new CsvError(`Import at most ${CSV_MAX_ROWS.toLocaleString('en-US')} rows at a time.`);
  }

  return {
    headers,
    rows: dataRecords.map((record, index) => ({
      // The heading is line 1, so the operator's line numbers match their editor.
      lineNumber: index + 2,
      values: Object.fromEntries(headers.map((header, column) => [header, record[column]?.trim() ?? ''])),
    })),
  };
}

function readRecords(input: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (quoted) {
      if (character !== '"') {
        field += character;
        continue;
      }

      // A doubled quote inside a quoted field is one literal quote.
      if (input[index + 1] === '"') {
        field += '"';
        index += 1;
        continue;
      }

      quoted = false;
      continue;
    }

    if (character === '"' && field === '') {
      quoted = true;
      continue;
    }

    if (character === ',') {
      record.push(field);
      field = '';
      continue;
    }

    if (character === '\n' || character === '\r') {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      continue;
    }

    field += character;
  }

  if (quoted) throw new CsvError('A quoted value is missing its closing quote.');

  record.push(field);
  if (!isBlank(record)) records.push(record);

  return records;
}

function stripBom(input: string): string {
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}

function isBlank(record: string[]): boolean {
  return record.every((value) => value.trim() === '');
}

/** `Full Name`, `full_name` and `FULL NAME` are the same column to a human. */
function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_-]+/g, '');
}
