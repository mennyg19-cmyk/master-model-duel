import { Prisma } from "@prisma/client";
import { normalizeEmail } from "@/lib/text";
import { normalizePhone } from "@/lib/phone";
import { addressDedupeKey } from "@/lib/customers/addresses";
import { ImportPayload, KindHandler, StagedRow } from "@/lib/imports/engine";
import { normalizeRegion, normalizeZip, titleCaseName } from "@/lib/imports/legacy/normalize";

// R-186/G-029 + UR-014: legacy customers. One CSV row = one customer ADDRESS;
// rows sharing an email/phone are ONE customer with a book — populating that
// book is the whole point (repeat-order works year one). Matching an existing
// customer is a merge, not a duplicate: the row's address attaches to the
// existing book (strict address dedupe still applies per book).
//
// Columns: customer_name, email, phone, address_label, line1, line2, city,
// region, postal_code, country (address columns optional as a group).
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface LegacyCustomerData {
  customerName: string;
  email: string | null;
  phone: string | null;
  normalizedPhone: string | null;
  addressLabel: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string;
  /** Set when a field failed normalization — the address lands flagged. */
  addressNeedsReview: string | null;
}

function parseLegacyCustomerRow(rowNumber: number, record: Record<string, string>): StagedRow {
  const customerName = titleCaseName(record.customer_name ?? "");
  const rawEmail = normalizeEmail(record.email ?? "");
  const email = rawEmail && EMAIL_SHAPE.test(rawEmail) ? rawEmail : null;
  const phone = normalizePhone(record.phone ?? "");
  const zip = normalizeZip(record.postal_code ?? "");

  const anyAddressField = ["address_label", "line1", "line2", "city", "region", "postal_code"].some(
    (column) => (record[column] ?? "").trim() !== "",
  );
  const data: LegacyCustomerData = {
    customerName,
    email,
    phone: record.phone?.trim() ? record.phone.trim() : null,
    normalizedPhone: phone,
    addressLabel: record.address_label?.trim() || null,
    line1: record.line1?.trim() || null,
    line2: record.line2?.trim() || null,
    city: record.city ? titleCaseName(record.city) : null,
    region: record.region ? normalizeRegion(record.region) : null,
    postalCode: zip,
    country: (record.country?.trim() || "US").toUpperCase(),
    addressNeedsReview: null,
  };
  const staged: StagedRow = { row: rowNumber, data: data as unknown as StagedRow["data"], verdict: "valid" };

  if (!customerName) return { ...staged, verdict: "invalid", reason: "customer_name is required" };
  if (rawEmail && !email) return { ...staged, verdict: "invalid", reason: `email "${rawEmail}" is malformed` };
  if (!email && !phone) {
    return { ...staged, verdict: "invalid", reason: "no usable contact (email and phone both broken)" };
  }
  if (anyAddressField) {
    if (!data.line1 || !data.city || !data.region) {
      return { ...staged, verdict: "invalid", reason: "address rows need line1, city, and region" };
    }
    if (!zip) {
      // Not fatal — the address lands flagged for the review queue instead
      // of dropping the customer outright (G-029 human mapping).
      data.addressNeedsReview = `ZIP "${record.postal_code}" could not be normalized`;
    }
  }
  return staged;
}

// In-file: only an exact re-paste (same customer key AND same address) is a
// duplicate. Same email with a different address is the multi-row book case.
function legacyDuplicateKeys(data: StagedRow["data"]) {
  const customer = data as unknown as LegacyCustomerData;
  const customerKey = customer.email ? `email:${customer.email}` : `phone:${customer.normalizedPhone}`;
  const addressKey = addressDedupeKey({
    line1: customer.line1 ?? "",
    line2: customer.line2,
    city: customer.city ?? "",
    region: customer.region ?? "",
    postalCode: customer.postalCode ?? "",
    country: customer.country,
  });
  return [{ key: `${customerKey}|${addressKey}`, label: "row" }];
}

// No DB-duplicate marking: merging into an existing customer is the design.
async function markNoDatabaseDuplicates(_tx: Prisma.TransactionClient, _rows: StagedRow[]): Promise<void> {}

async function commitLegacyCustomerRows(
  tx: Prisma.TransactionClient,
  rows: StagedRow[],
  _payload: ImportPayload,
): Promise<number> {
  let landed = 0;

  for (const row of rows) {
    if (row.verdict !== "valid") continue;
    const data = row.data as unknown as LegacyCustomerData;

    // Email and phone pointing at DIFFERENT customers is ambiguous — a human
    // merges them; the import never guesses (same law as legacy orders).
    const byEmail = data.email ? await tx.customer.findUnique({ where: { email: data.email } }) : null;
    const byPhone = data.normalizedPhone ? await tx.customer.findUnique({ where: { normalizedPhone: data.normalizedPhone } }) : null;
    if (byEmail && byPhone && byEmail.id !== byPhone.id) {
      row.verdict = "invalid";
      row.reason = `email matches "${byEmail.name}" but phone matches "${byPhone.name}" — merge those customers first`;
      continue;
    }

    const existing = byEmail ?? byPhone;
    const customer = existing
      ? await tx.customer.update({
          where: { id: existing.id },
          // A merge never renames; it only fills a phone gap honestly.
          data: {
            phone: existing.phone ?? data.phone,
            normalizedPhone: existing.normalizedPhone ?? data.normalizedPhone,
          },
        })
      : await tx.customer.create({
          data: {
            name: data.customerName,
            email: data.email ?? `legacy-phone-${data.normalizedPhone!.replace(/\D/g, "")}@legacy.local`,
            phone: data.phone,
            normalizedPhone: data.normalizedPhone,
          },
        });
    if (!existing) landed += 1;

    if (!data.line1) {
      if (existing) row.reason = "merged into existing customer (contact match)";
      continue;
    }

    const key = addressDedupeKey({
      line1: data.line1,
      line2: data.line2,
      city: data.city!,
      region: data.region!,
      postalCode: data.postalCode ?? "",
      country: data.country,
    });
    const book = await tx.address.findMany({ where: { customerId: customer.id } });
    if (book.some((address) => addressDedupeKey(address) === key)) {
      row.reason = "address already in the book — merged";
      continue;
    }

    // Label uniqueness (@@unique [customerId, label]): suffix on collision.
    const baseLabel = data.addressLabel ?? data.line1;
    const taken = new Set(book.map((address) => address.label));
    let label: string = baseLabel;
    for (let n = 2; taken.has(label); n += 1) label = `${baseLabel} (${n})`;

    await tx.address.create({
      data: {
        customerId: customer.id,
        label,
        line1: data.line1,
        line2: data.line2,
        city: data.city!,
        region: data.region!,
        postalCode: data.postalCode ?? "",
        country: data.country,
        needsReview: data.addressNeedsReview !== null,
        reviewReason: data.addressNeedsReview,
      },
    });
    landed += 1;
  }
  return landed;
}

export const legacyCustomersImport: KindHandler = {
  requiredHeaders: ["customer_name"],
  parseRow: parseLegacyCustomerRow,
  duplicateKeys: legacyDuplicateKeys,
  markDatabaseDuplicates: markNoDatabaseDuplicates,
  commitRows: commitLegacyCustomerRows,
};
