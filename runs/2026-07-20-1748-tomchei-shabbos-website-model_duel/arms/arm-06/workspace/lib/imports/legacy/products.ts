import { Prisma } from "@prisma/client";
import { ImportPayload, KindHandler, StagedRow } from "@/lib/imports/engine";
import { legacySeason, legacySeasonName } from "@/lib/imports/legacy/seasons";
import { titleCaseName } from "@/lib/imports/legacy/normalize";

// R-186: legacy catalog import. Rows target the "Legacy <year>" season named
// by the row's year column (upserted CLOSED, same convention as the P10
// repeat hook), so historical orders imported later can match their items by
// name instead of falling back to inactive stubs.
//
// Columns: year, product_name, price, product_type, size_text.
interface LegacyProductData {
  year: number;
  productName: string;
  priceCents: number;
  productType: string;
  sizeText: string;
  slug: string;
}

function slugify(year: number, name: string): string {
  return `legacy-${year}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function parseLegacyProductRow(rowNumber: number, record: Record<string, string>): StagedRow {
  const productName = titleCaseName(record.product_name ?? "");
  const rawPrice = (record.price ?? "").trim().replace(/^\$/, "");
  const price = Number(rawPrice);
  const year = Number((record.year ?? "").trim());

  const data: LegacyProductData = {
    year: Number.isInteger(year) ? year : 0,
    productName,
    priceCents: 0,
    productType: (record.product_type ?? "").trim(),
    sizeText: (record.size_text ?? "").trim(),
    slug: "",
  };
  const staged: StagedRow = { row: rowNumber, data: data as unknown as StagedRow["data"], verdict: "valid" };

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { ...staged, verdict: "invalid", reason: `year "${record.year}" — expected a 4-digit year` };
  }
  if (!productName) return { ...staged, verdict: "invalid", reason: "product_name is required" };
  if (!rawPrice || !Number.isFinite(price) || price < 0) {
    return { ...staged, verdict: "invalid", reason: "price must be a non-negative number (e.g. 47.85)" };
  }
  data.priceCents = Math.round(price * 100);
  data.slug = slugify(year, productName);
  return staged;
}

async function markProductDuplicates(tx: Prisma.TransactionClient, rows: StagedRow[]): Promise<void> {
  const slugs = [...new Set(rows.filter((r) => r.verdict === "valid").map((r) => (r.data as unknown as LegacyProductData).slug))];
  if (slugs.length === 0) return;
  const existing = await tx.product.findMany({ where: { slug: { in: slugs } }, select: { slug: true } });
  const taken = new Set(existing.map((product) => product.slug));
  for (const row of rows) {
    if (row.verdict !== "valid") continue;
    const data = row.data as unknown as LegacyProductData;
    if (taken.has(data.slug)) {
      row.verdict = "duplicate";
      row.reason = `"${data.productName}" already exists in ${legacySeasonName(data.year)} — left alone`;
    }
  }
}

async function commitLegacyProductRows(
  tx: Prisma.TransactionClient,
  rows: StagedRow[],
  _payload: ImportPayload,
): Promise<number> {
  let landed = 0;
  const seasonCache = new Map<number, string>();
  for (const row of rows) {
    if (row.verdict !== "valid") continue;
    const data = row.data as unknown as LegacyProductData;
    let seasonId = seasonCache.get(data.year);
    if (!seasonId) {
      seasonId = (await legacySeason(tx, data.year)).id;
      seasonCache.set(data.year, seasonId);
    }
    await tx.product.create({
      data: {
        slug: data.slug,
        name: data.productName,
        seasonId,
        basePriceCents: data.priceCents,
        category: data.productType || null,
        description: data.sizeText || null,
      },
    });
    landed += 1;
  }
  return landed;
}

export const legacyProductsImport: KindHandler = {
  requiredHeaders: ["year", "product_name", "price"],
  parseRow: parseLegacyProductRow,
  duplicateKeys: (data) => [{ key: (data as unknown as LegacyProductData).slug, label: "product" }],
  markDatabaseDuplicates: markProductDuplicates,
  commitRows: commitLegacyProductRows,
};
