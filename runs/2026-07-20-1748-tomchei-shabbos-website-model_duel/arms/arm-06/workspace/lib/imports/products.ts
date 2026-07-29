import { Prisma } from "@prisma/client";
import { DomainRuleError } from "@/lib/errors";
import { normalizeWhitespace, slugify } from "@/lib/text";
import { dollarsToCents } from "@/lib/money";
import { ImportPayload, KindHandler, StagedRow } from "@/lib/imports/engine";

// Products CSV: name,price[,description,category,active]. Slug derives from
// the name (same rule as the single-product form); duplicate = slug taken.
// Rows land in the open season captured at stage time (payload.seasonId).
// A blank active column means "use the default" (true) — only explicit falsy
// tokens turn a product off.
const TRUTHY = new Set(["true", "yes", "1", "y"]);
const FALSY = new Set(["false", "no", "0", "n"]);

function parseProductRow(rowNumber: number, record: Record<string, string>): StagedRow {
  const name = normalizeWhitespace(record.name ?? "");
  const priceText = (record.price ?? "").trim();
  const description = normalizeWhitespace(record.description ?? "");
  const category = normalizeWhitespace(record.category ?? "");
  const activeText = (record.active ?? "").trim().toLowerCase();

  const slug = name ? slugify(name) : "";
  const data = {
    name,
    slug,
    priceCents: null as number | null,
    description: description || null,
    category: category || null,
    active: true,
  };

  if (!name) return { row: rowNumber, data, verdict: "invalid", reason: "name is required" };
  if (!slug) return { row: rowNumber, data, verdict: "invalid", reason: "name must produce a usable slug" };
  const priceCents = dollarsToCents(Number(priceText));
  if (priceCents === null || priceText === "") {
    return { row: rowNumber, data, verdict: "invalid", reason: "price must be a clean dollar-and-cents amount" };
  }
  data.priceCents = priceCents;
  if (activeText && !TRUTHY.has(activeText) && !FALSY.has(activeText)) {
    return { row: rowNumber, data, verdict: "invalid", reason: "active must be true/false (default true)" };
  }
  data.active = activeText === "" || TRUTHY.has(activeText);
  return { row: rowNumber, data, verdict: "valid" };
}

async function markProductDuplicates(tx: Prisma.TransactionClient, rows: StagedRow[]): Promise<void> {
  const candidates = rows.filter((row) => row.verdict === "valid");
  if (candidates.length === 0) return;
  const slugs = candidates.map((row) => String(row.data.slug));
  const existing = await tx.product.findMany({ where: { slug: { in: slugs } }, select: { slug: true } });
  const taken = new Set(existing.map((product) => product.slug));
  for (const row of candidates) {
    if (taken.has(String(row.data.slug))) {
      row.verdict = "duplicate";
      row.reason = "a product already uses this slug";
    }
  }
}

async function commitProductRows(
  tx: Prisma.TransactionClient,
  rows: StagedRow[],
  payload: ImportPayload,
): Promise<number> {
  const valid = rows.filter((row) => row.verdict === "valid");
  if (valid.length === 0) return 0;
  if (!payload.seasonId) throw new DomainRuleError("This products import has no target season recorded");
  const result = await tx.product.createMany({
    data: valid.map((row) => ({
      seasonId: payload.seasonId!,
      name: String(row.data.name),
      slug: String(row.data.slug),
      description: row.data.description === null ? null : String(row.data.description),
      category: row.data.category === null ? null : String(row.data.category),
      basePriceCents: Number(row.data.priceCents),
      kind: "GOOD",
      active: Boolean(row.data.active),
    })),
    skipDuplicates: true,
  });
  return result.count;
}

export const productsImport: KindHandler = {
  requiredHeaders: ["name", "price"],
  parseRow: parseProductRow,
  duplicateKeys: (data) => (data.slug ? [{ key: `slug:${String(data.slug)}`, label: "slug" }] : []),
  markDatabaseDuplicates: markProductDuplicates,
  commitRows: commitProductRows,
};
