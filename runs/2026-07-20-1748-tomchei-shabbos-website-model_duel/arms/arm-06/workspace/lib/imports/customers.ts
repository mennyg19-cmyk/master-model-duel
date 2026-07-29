import { Prisma } from "@prisma/client";
import { normalizeEmail, normalizeWhitespace } from "@/lib/text";
import { normalizePhone } from "@/lib/phone";
import { ImportPayload, KindHandler, StagedRow } from "@/lib/imports/engine";

// Customers CSV: name,email,phone (phone optional). Duplicate = an existing
// customer already owns the normalized email or phone (same rule as R-144) —
// in-file too: two rows sharing one normalized phone can never both commit.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseCustomerRow(rowNumber: number, record: Record<string, string>): StagedRow {
  const name = normalizeWhitespace(record.name ?? "");
  const email = normalizeEmail(record.email ?? "");
  const phone = normalizeWhitespace(record.phone ?? "");

  const data = { name, email, phone: phone || null };
  if (!name) return { row: rowNumber, data, verdict: "invalid", reason: "name is required" };
  if (!email || !EMAIL_SHAPE.test(email)) {
    return { row: rowNumber, data, verdict: "invalid", reason: "a valid email is required" };
  }
  return { row: rowNumber, data, verdict: "valid" };
}

async function markCustomerDuplicates(tx: Prisma.TransactionClient, rows: StagedRow[]): Promise<void> {
  const candidates = rows.filter((row) => row.verdict === "valid");
  if (candidates.length === 0) return;
  const emails = candidates.map((row) => String(row.data.email));
  const phones = candidates
    .map((row) => (row.data.phone ? normalizePhone(String(row.data.phone)) : null))
    .filter((phone): phone is string => phone !== null && phone !== "");

  const existing = await tx.customer.findMany({
    where: {
      OR: [{ email: { in: emails } }, ...(phones.length > 0 ? [{ normalizedPhone: { in: phones } }] : [])],
    },
    select: { email: true, normalizedPhone: true },
  });
  const takenEmails = new Set(existing.map((customer) => customer.email));
  const takenPhones = new Set(
    existing.map((customer) => customer.normalizedPhone).filter((phone): phone is string => phone !== null),
  );

  for (const row of candidates) {
    const email = String(row.data.email);
    const phone = row.data.phone ? normalizePhone(String(row.data.phone)) : null;
    if (takenEmails.has(email)) {
      row.verdict = "duplicate";
      row.reason = "a customer already exists with this email";
    } else if (phone && takenPhones.has(phone)) {
      row.verdict = "duplicate";
      row.reason = "a customer already exists with this phone";
    }
  }
}

async function commitCustomerRows(
  tx: Prisma.TransactionClient,
  rows: StagedRow[],
  _payload: ImportPayload,
): Promise<number> {
  const valid = rows.filter((row) => row.verdict === "valid");
  if (valid.length === 0) return 0;
  // skipDuplicates is the atomic backstop: a row that raced in between the
  // in-transaction re-check and this statement is skipped, never an error.
  const result = await tx.customer.createMany({
    data: valid.map((row) => ({
      name: String(row.data.name),
      email: String(row.data.email),
      phone: row.data.phone === null ? null : String(row.data.phone),
      normalizedPhone: row.data.phone === null ? null : normalizePhone(String(row.data.phone)),
    })),
    skipDuplicates: true,
  });
  if (result.count < valid.length) {
    // A same-instant commit beat this batch to some rows — createMany dropped
    // them silently. Re-mark them so the committed batch's per-row verdicts
    // still tell the truth (a row landed iff its unique email now exists).
    const landed = await tx.customer.findMany({
      where: { email: { in: valid.map((row) => String(row.data.email)) } },
      select: { email: true },
    });
    const landedEmails = new Set(landed.map((customer) => customer.email));
    for (const row of valid) {
      if (!landedEmails.has(String(row.data.email))) {
        row.verdict = "duplicate";
        row.reason = "another import committed this email or phone first";
      }
    }
  }
  return result.count;
}

export const customersImport: KindHandler = {
  requiredHeaders: ["name", "email"],
  parseRow: parseCustomerRow,
  duplicateKeys: (data) => {
    const keys = [{ key: `email:${String(data.email)}`, label: "email" }];
    const phone = data.phone ? normalizePhone(String(data.phone)) : null;
    if (phone) keys.push({ key: `phone:${phone}`, label: "phone" });
    return keys;
  },
  markDatabaseDuplicates: markCustomerDuplicates,
  commitRows: commitCustomerRows,
};
