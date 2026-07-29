import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { importLegacyOrders } from "@/lib/repeat/import-hook";

export const dynamic = "force-dynamic";

const rowSchema = z.object({
  customerEmail: z.string().email(),
  customerName: z.string().max(120).optional(),
  year: z.number().int().min(2000).max(2100),
  externalKey: z.string().max(120).optional(),
  recipients: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        line1: z.string().min(1).max(200),
        line2: z.string().max(200).nullish(),
        city: z.string().min(1).max(120),
        region: z.string().min(1).max(120),
        postalCode: z.string().min(1).max(20),
        country: z.string().max(2).optional(),
        greeting: z.string().max(500).nullish(),
      }),
    )
    .max(100),
  lines: z
    .array(
      z.object({
        productName: z.string().min(1).max(200),
        qty: z.number().int().positive(),
        recipientName: z.string().max(120).optional(),
      }),
    )
    .min(1)
    .max(200),
});

const importSchema = z.object({ rows: z.array(rowSchema).min(1).max(200) });

// P10 (R-048): year-one migration hook — persists prior-year orders as
// FINALIZED rows in a "Legacy <year>" season so repeat works before the full
// P12 import pipeline exists. Manager-only: it mints seasons and products.
export async function POST(request: Request) {
  const gate = await requireApiPermission("catalog.manage");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, importSchema, "Legacy order rows are required");
  if (!parsed.ok) return parsed.response;

  try {
    const report = await importLegacyOrders(parsed.data.rows, { ctx: gate.ctx });
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
