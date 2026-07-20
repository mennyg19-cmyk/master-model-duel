import { normalizeEmail, normalizePhone } from "@/lib/normalize";

export type ImportEntity = "customers" | "products";
export type StagedRow = Record<string, string> & { rowNumber: string };
export type ImportIssue = {
  rowNumber: number;
  code: "INVALID" | "DUPLICATE";
  message: string;
};

function parseCsvLine(line: string) {
  const fields: string[] = [];
  let field = "";
  let isQuoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"' && isQuoted) {
      field += '"';
      index += 1;
    } else if (character === '"') {
      isQuoted = !isQuoted;
    } else if (character === "," && !isQuoted) {
      fields.push(field.trim());
      field = "";
    } else {
      field += character;
    }
  }
  fields.push(field.trim());
  return fields;
}

export function stageCsv(entityType: ImportEntity, csv: string) {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) {
    throw new Error("CSV must include a header and at least one row.");
  }
  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
  const required =
    entityType === "customers"
      ? ["displayname"]
      : ["sku", "name", "pricecents"];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) {
    throw new Error(`CSV is missing required columns: ${missing.join(", ")}.`);
  }

  const seenKeys = new Set<string>();
  const rows: StagedRow[] = [];
  const issues: ImportIssue[] = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const values = parseCsvLine(lines[lineIndex]);
    const row = Object.fromEntries(
      headers.map((header, index) => [header, values[index]?.trim() ?? ""]),
    ) as StagedRow;
    row.rowNumber = String(lineIndex + 1);
    const rowNumber = lineIndex + 1;
    const key =
      entityType === "customers"
        ? normalizeEmail(row.email || "") || normalizePhone(row.phone || "") || ""
        : row.sku.toUpperCase();
    if (!row.displayname && entityType === "customers") {
      issues.push({ rowNumber, code: "INVALID", message: "Display name is required." });
    } else if (
      entityType === "customers" &&
      !row.email &&
      !row.phone
    ) {
      issues.push({ rowNumber, code: "INVALID", message: "Email or phone is required." });
    } else if (
      entityType === "products" &&
      (!row.sku || !row.name || !/^\d+$/.test(row.pricecents))
    ) {
      issues.push({
        rowNumber,
        code: "INVALID",
        message: "SKU, name, and integer priceCents are required.",
      });
    } else if (!key || seenKeys.has(key)) {
      issues.push({ rowNumber, code: "DUPLICATE", message: "Duplicate row key in this file." });
    } else {
      seenKeys.add(key);
    }
    rows.push(row);
  }
  return {
    rows,
    issues,
    validRowCount: rows.length - issues.length,
    invalidRowCount: issues.filter((issue) => issue.code === "INVALID").length,
    duplicateCount: issues.filter((issue) => issue.code === "DUPLICATE").length,
  };
}
