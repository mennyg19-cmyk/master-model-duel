import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { slugify } from "@/lib/text";
import { productInputSchema, productScalars } from "@/lib/catalog/product-input";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireApiPermission("catalog.manage");
  if (!gate.ok) return gate.response;

  const products = await prisma.product.findMany({
    orderBy: [{ seasonId: "desc" }, { name: "asc" }],
    include: { season: { select: { name: true, status: true } } },
  });
  return NextResponse.json({ products });
}

// R-065: product create. Slug defaults to a slugified name; conflicts are a
// clean 409, never a silent suffix.
export async function POST(request: Request) {
  const gate = await requireApiPermission("catalog.manage");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, productInputSchema, "Product fields are missing or invalid");
  if (!parsed.ok) return parsed.response;

  const scalars = productScalars(parsed.data);
  if (!scalars.ok) {
    return NextResponse.json({ error: scalars.error }, { status: 400 });
  }

  const season = await prisma.season.findUnique({ where: { id: parsed.data.seasonId } });
  if (!season) {
    return NextResponse.json({ error: "Unknown season" }, { status: 400 });
  }

  const slug = parsed.data.slug?.trim() || slugify(parsed.data.name);
  if (!slug) {
    return NextResponse.json({ error: "Name must produce a usable slug" }, { status: 400 });
  }
  const slugTaken = await prisma.product.findUnique({ where: { slug } });
  if (slugTaken) {
    return NextResponse.json({ error: "Another product already uses that slug" }, { status: 409 });
  }

  const product = await prisma.product.create({
    data: { ...scalars.data, slug, seasonId: season.id },
  });
  await recordAudit({
    ctx: gate.ctx,
    action: "product_create",
    targetType: "Product",
    targetId: product.id,
    metadata: { slug: product.slug, seasonId: season.id },
  });

  return NextResponse.json({ product }, { status: 201 });
}
