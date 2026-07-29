import { Address, Prisma } from "@prisma/client";
import { normalizeEmail, isValidEmail } from "@/lib/text";
import { normalizePhone } from "@/lib/phone";
import { addressDedupeKey } from "@/lib/customers/addresses";
import { ImportPayload, KindHandler, StagedRow } from "@/lib/imports/engine";
import { normalizeRegion, normalizeZip, titleCaseName } from "@/lib/imports/legacy/normalize";
import {
  findLegacyCustomerMatches,
  resolveLegacyCustomer,
} from "@/lib/imports/legacy/resolve-customer";

// R-186/G-029 + UR-014: legacy customers. One CSV row = one customer ADDRESS;
// rows sharing an email/phone are ONE customer with a book — populating that
// book is the whole point (repeat-order works year one). Matching an existing
// customer is a merge, not a duplicate: the row's address attaches to the
// existing book (strict address dedupe still applies per book).
//
// Columns: customer_name, email, phone, address_label, line1, line2, city,
// region, postal_code, country (address columns optional as a group).

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
  const email = rawEmail && isValidEmail(rawEmail) ? rawEmail : null;
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
      // of dropping the customer outright (G-029 human mapping). m9: the flag
      // is also the staged row's reason, so the preview shows it before commit.
      data.addressNeedsReview = `ZIP "${record.postal_code}" could not be normalized`;
      staged.reason = data.addressNeedsReview;
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
  const candidates = rows.filter((row) => row.verdict === "valid");

  // One batched customer lookup for the whole batch (m11) instead of two
  // findUnique calls per row inside the open transaction; creations register
  // back into the maps so multi-row customers resolve once.
  const matches = await findLegacyCustomerMatches(
    tx,
    candidates.map((row) => {
      const data = row.data as unknown as LegacyCustomerData;
      return {
        email: data.email,
        phone: data.phone,
        normalizedPhone: data.normalizedPhone,
        customerName: data.customerName,
      };
    }),
  );
  const bookCache = new Map<string, Address[]>();

  for (const row of candidates) {
    const data = row.data as unknown as LegacyCustomerData;

    const resolved = await resolveLegacyCustomer(
      tx,
      {
        email: data.email,
        phone: data.phone,
        normalizedPhone: data.normalizedPhone,
        customerName: data.customerName,
      },
      matches,
    );
    if ("error" in resolved) {
      // G-029's never-guess rule as a row verdict: a human merges the two
      // customers, the import refuses to pick one.
      row.verdict = "invalid";
      row.reason = resolved.error;
      continue;
    }
    const { customer, created } = resolved;
    if (created) {
      landed += 1;
    } else if (customer.normalizedPhone === null && data.normalizedPhone !== null) {
      // A merge never renames; it only fills a phone gap honestly.
      await tx.customer.update({
        where: { id: customer.id },
        data: { phone: data.phone, normalizedPhone: data.normalizedPhone },
      });
    }

    if (!data.line1) {
      if (!created) row.reason = "merged into existing customer (contact match)";
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
    let book = bookCache.get(customer.id);
    if (!book) {
      book = await tx.address.findMany({ where: { customerId: customer.id } });
      bookCache.set(customer.id, book);
    }
    if (book.some((address) => addressDedupeKey(address) === key)) {
      row.reason = "address already in the book — merged";
      continue;
    }

    // Label uniqueness (@@unique [customerId, label]): suffix on collision.
    const baseLabel = data.addressLabel ?? data.line1;
    const taken = new Set(book.map((address) => address.label));
    let label: string = baseLabel;
    for (let n = 2; taken.has(label); n += 1) label = `${baseLabel} (${n})`;

    const address = await tx.address.create({
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
    book.push(address);
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
