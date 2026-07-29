import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiPermission } from "@/lib/auth";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { createSeasonWizard } from "@/lib/seasons/manage";

export const dynamic = "force-dynamic";

// P10 (G-011/R-097): season list + new-season wizard. Catalog.manage because
// the wizard's heavy option is a catalog copy; the season IS the catalog's
// scope (P3).
export async function GET() {
  const gate = await requireApiPermission("catalog.manage");
  if (!gate.ok) return gate.response;

  const seasons = await prisma.season.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { products: true, orders: true } } },
  });
  return NextResponse.json({
    ok: true,
    seasons: seasons.map((season) => ({
      id: season.id,
      name: season.name,
      status: season.status,
      scheduledOpensAt: season.scheduledOpensAt,
      scheduledClosesAt: season.scheduledClosesAt,
      productCount: season._count.products,
      orderCount: season._count.orders,
      createdAt: season.createdAt,
    })),
  });
}

const wizardSchema = z.object({
  name: z.string().min(1).max(80),
  copyCatalogFromSeasonId: z.string().min(1).optional(),
  scheduledOpensAt: z.string().datetime({ offset: true }).optional(),
  scheduledClosesAt: z.string().datetime({ offset: true }).optional(),
});

export async function POST(request: Request) {
  const gate = await requireApiPermission("catalog.manage");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, wizardSchema, "A season name is required");
  if (!parsed.ok) return parsed.response;

  try {
    const result = await createSeasonWizard({
      name: parsed.data.name,
      copyCatalogFromSeasonId: parsed.data.copyCatalogFromSeasonId,
      scheduledOpensAt: parsed.data.scheduledOpensAt ? new Date(parsed.data.scheduledOpensAt) : null,
      scheduledClosesAt: parsed.data.scheduledClosesAt ? new Date(parsed.data.scheduledClosesAt) : null,
      ctx: gate.ctx,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
