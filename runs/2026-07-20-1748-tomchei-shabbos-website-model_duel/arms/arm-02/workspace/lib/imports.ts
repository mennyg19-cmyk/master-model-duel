import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { parseCsv } from "@/lib/csv";
import { normalizePhone } from "@/lib/customers";

// Staged CSV import (R-063, R-143). The same validation runs for preview and
// commit: every row lands in exactly one bucket — valid, duplicate (already in
// the database or earlier in the file), or invalid (with the reason). Commit
// is atomic over the whole file: ANY invalid row blocks everything, valid rows
// are written in one transaction, duplicates are skipped and reported.

export type ImportKind = "customers" | "products";

export type StagedRow = {
  line: number;
  values: Record<string, string>;
  status: "valid" | "duplicate" | "invalid";
  reason: string | null;
};

export type StagedImport =
  | { ok: true; kind: ImportKind; rows: StagedRow[]; valid: number; duplicates: number; invalid: number }
  | { ok: false; error: string };

const customerRowSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
  email: z.string().trim().toLowerCase().email("email is not valid").max(320),
  phone: z.string().trim().max(40).optional(),
});

const productRowSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug must be lowercase letters/numbers with dashes"),
  category: z.string().trim().max(100).optional(),
  pricecents: z.coerce.number().int("priceCents must be a whole number of cents").min(0),
  description: z.string().trim().max(2000).optional(),
});

const REQUIRED_HEADERS: Record<ImportKind, string[]> = {
  customers: ["name", "email"],
  products: ["name", "slug", "pricecents"],
};

export async function stageImport(kind: ImportKind, csv: string, seasonId: string): Promise<StagedImport> {
  const table = parseCsv(csv);
  if ("error" in table) return { ok: false, error: table.error };

  const missing = REQUIRED_HEADERS[kind].filter((header) => !table.headers.includes(header));
  if (missing.length > 0) {
    return { ok: false, error: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}` };
  }

  const toRecord = (row: string[]): Record<string, string> => {
    const record: Record<string, string> = {};
    table.headers.forEach((header, index) => {
      record[header] = (row[index] ?? "").trim();
    });
    return record;
  };
  const records = table.rows.map(toRecord);

  // One bounded lookup for existing keys instead of a query per row.
  const existingKeys = new Set<string>();
  if (kind === "customers") {
    const emails = records.map((record) => record.email.toLowerCase()).filter(Boolean);
    const found = await db.customer.findMany({
      where: { email: { in: emails } },
      select: { email: true },
    });
    for (const row of found) existingKeys.add(row.email);
  } else {
    const slugs = records.map((record) => record.slug).filter(Boolean);
    const found = await db.product.findMany({
      where: { seasonId, slug: { in: slugs } },
      select: { slug: true },
    });
    for (const row of found) existingKeys.add(row.slug);
  }

  const seenInFile = new Set<string>();
  const rows: StagedRow[] = records.map((values, index) => {
    const line = index + 2; // 1-based, after the header row
    const parsed = kind === "customers" ? customerRowSchema.safeParse(values) : productRowSchema.safeParse(values);
    if (!parsed.success) {
      return { line, values, status: "invalid", reason: parsed.error.issues[0].message };
    }
    const key = kind === "customers" ? (parsed.data as { email: string }).email : (parsed.data as { slug: string }).slug;
    if (existingKeys.has(key)) {
      return { line, values, status: "duplicate", reason: `${kind === "customers" ? "email" : "slug"} already exists` };
    }
    if (seenInFile.has(key)) {
      return { line, values, status: "duplicate", reason: "repeated earlier in this file" };
    }
    seenInFile.add(key);
    return { line, values, status: "valid", reason: null };
  });

  return {
    ok: true,
    kind,
    rows,
    valid: rows.filter((row) => row.status === "valid").length,
    duplicates: rows.filter((row) => row.status === "duplicate").length,
    invalid: rows.filter((row) => row.status === "invalid").length,
  };
}

export type CommitResult =
  | { ok: true; created: number; skippedDuplicates: number }
  | { ok: false; error: string; invalidLines?: number[] };

/** All-or-nothing commit (R-143): re-stages, refuses on any invalid row, writes in one transaction. */
export async function commitImport(kind: ImportKind, csv: string, seasonId: string): Promise<CommitResult> {
  const staged = await stageImport(kind, csv, seasonId);
  if (!staged.ok) return { ok: false, error: staged.error };
  if (staged.invalid > 0) {
    return {
      ok: false,
      error: `${staged.invalid} invalid row${staged.invalid > 1 ? "s" : ""} — fix them and re-stage; nothing was imported`,
      invalidLines: staged.rows.filter((row) => row.status === "invalid").map((row) => row.line),
    };
  }
  const validRows = staged.rows.filter((row) => row.status === "valid");
  if (validRows.length === 0) {
    return { ok: false, error: "No new rows to import — everything was a duplicate" };
  }

  await db.$transaction(async (tx) => {
    if (kind === "customers") {
      // Phone dedupe rule matches findOrLinkCustomer: a number someone else
      // already owns (in the DB or earlier in this file) is stored raw-only.
      const phones = validRows
        .map((row) => normalizePhone(row.values.phone))
        .filter((phone): phone is string => phone !== null);
      const taken = new Set(
        (
          await tx.customer.findMany({
            where: { phoneNormalized: { in: phones } },
            select: { phoneNormalized: true },
          })
        ).map((row) => row.phoneNormalized as string)
      );
      const data: Prisma.CustomerCreateManyInput[] = validRows.map((row) => {
        const phoneNormalized = normalizePhone(row.values.phone);
        const phoneFree = phoneNormalized !== null && !taken.has(phoneNormalized);
        if (phoneNormalized) taken.add(phoneNormalized);
        return {
          name: row.values.name,
          email: row.values.email.toLowerCase(),
          phone: row.values.phone || null,
          phoneNormalized: phoneFree ? phoneNormalized : null,
        };
      });
      await tx.customer.createMany({ data });
    } else {
      const data: Prisma.ProductCreateManyInput[] = validRows.map((row) => ({
        seasonId,
        name: row.values.name,
        slug: row.values.slug,
        category: row.values.category || null,
        description: row.values.description || null,
        basePriceCents: Number.parseInt(row.values.pricecents, 10),
      }));
      await tx.product.createMany({ data });
    }
  });

  return { ok: true, created: validRows.length, skippedDuplicates: staged.duplicates };
}
