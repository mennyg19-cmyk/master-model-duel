// Minimal CSV reader for staff imports (R-063): quoted fields, escaped quotes,
// CRLF, and a header row. Deliberately not a streaming parser — imports are
// bounded (MAX_IMPORT_ROWS) long before memory matters.

export const MAX_IMPORT_ROWS = 5000;

// CSV writer half (P12 export center, R-092). Quotes any field containing a
// comma, quote, or newline; doubles embedded quotes — the inverse of parseCsv,
// so an exported file round-trips through our own reader.
//
// Formula neutralization (SR-04): exports are opened in Excel by staff, and
// customer-controlled text (names, greetings, addresses) starting with = + -
// or @ would execute as a formula there. A leading tab prefix defangs it —
// spreadsheets show the value, and our own parseCsv round-trips it unchanged
// apart from the invisible prefix.
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@]/.test(text)) text = `\t${text}`;
  return /[",\r\n\t]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(values: (string | number | null | undefined)[]): string {
  return values.map(csvField).join(",") + "\r\n";
}

export type CsvTable = { headers: string[]; rows: string[][] };

export function parseCsv(text: string): CsvTable | { error: string } {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    // Skip fully blank lines.
    if (record.length > 1 || record[0]?.trim() !== "") records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      inQuotes = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      pushField();
      pushRecord();
    } else {
      field += char;
    }
  }
  if (inQuotes) return { error: "Unclosed quote in CSV" };
  if (field !== "" || record.length > 0) {
    pushField();
    pushRecord();
  }

  if (records.length === 0) return { error: "CSV is empty" };
  if (records.length - 1 > MAX_IMPORT_ROWS) {
    return { error: `Too many rows — the limit is ${MAX_IMPORT_ROWS} per import` };
  }
  const headers = records[0].map((header) => header.trim().toLowerCase());
  return { headers, rows: records.slice(1) };
}
