// R-063 import parsing + R-092 groundwork serialization: one CSV engine for
// both directions so the export center never grows a second dialect. RFC-4180
// shape: quoted fields, "" escapes, commas/newlines inside quotes, CRLF or LF.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let index = 0;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 2;
        } else {
          inQuotes = false;
          index += 1;
        }
      } else {
        cell += char;
        index += 1;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      index += 1;
    } else if (char === ",") {
      pushCell();
      index += 1;
    } else if (char === "\n") {
      pushRow();
      index += 1;
    } else if (char === "\r") {
      index += 1; // swallowed; the \n ends the row
    } else {
      cell += char;
      index += 1;
    }
  }
  // A trailing newline already pushed the last row; otherwise flush the tail.
  // A completely empty input parses to zero rows, not one empty row.
  if (cell !== "" || row.length > 0 || inQuotes) pushRow();
  return rows;
}

export function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
