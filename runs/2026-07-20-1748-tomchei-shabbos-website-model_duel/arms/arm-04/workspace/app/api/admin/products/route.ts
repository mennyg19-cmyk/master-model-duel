import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { validateSeasonExists } from "@/lib/catalog-validation";

export async function GET(request: Request) {
  const gate = await requirePermissionApi("catalog.manage");
  if ("response" in gate) return gate.response;

  const seasonId = new URL(request.url).searchParams.get("seasonId");
  if (!seasonId) return Response.json({ error: "seasonId query param is required" }, { status: 400 });

  const products = await db.product.findMany({
    where: { seasonId },
    include: { options: true, inventoryItem: true, image: true, replacement: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });
  return Response.json(products);
}

const createProductSchema = z.object({
  seasonId: z.string().min(1),
  name: z.string().min(1).max(120),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/, "Slug: lowercase letters, digits, dashes"),
  category: z.string().max(60).nullish(),
  description: z.string().max(2000).nullish(),
  basePriceCents: z.number().int().min(0),
  trackInventory: z.boolean().default(false),
});

export async function POST(request: Request) {
  const gate = await requirePermissionApi("catalog.manage");
  if ("response" in gate) return gate.response;

  const parsed = createProductSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const seasonError = await validateSeasonExists(parsed.data.seasonId);
  if (seasonError) return Response.json({ error: seasonError }, { status: 404 });

  const duplicate = await db.product.findUnique({
    where: { seasonId_slug: { seasonId: parsed.data.seasonId, slug: parsed.data.slug } },
  });
  if (duplicate) {
    return Response.json({ error: `Slug "${parsed.data.slug}" already exists in this season` }, { status: 409 });
  }

  const created = await db.$transaction(async (tx) => {
    const product = await tx.product.create({ data: parsed.data });
    if (parsed.data.trackInventory) {
      await tx.inventoryItem.create({ data: { productId: product.id } });
    }
    await writeAudit(
      gate.staff,
      { action: "catalog.product.create", targetType: "Product", targetId: product.id, detail: { name: product.name } },
      tx
    );
    return product;
  });
  return Response.json({ ok: true, id: created.id }, { status: 201 });
}
