import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorize, hasSameOrigin } from "@/lib/route-auth";

const productSchema = z.object({
  id: z.string().cuid().optional(),
  seasonId: z.string().cuid(),
  sku: z.string().trim().min(2).max(80),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  kind: z.enum(["PACKAGE", "ADD_ON", "DONATION"]).default("PACKAGE"),
  priceCents: z.number().int().min(0).max(1_000_000),
  mediaId: z.string().cuid().nullable().optional(),
  isActive: z.boolean().default(true),
  restrictedAddons: z.array(z.object({
    addOnProductId: z.string().cuid(),
    isRestricted: z.boolean(),
  })).max(20).optional(),
});

const deleteSchema = z.object({ id: z.string().cuid() });

export async function GET(request: Request) {
  const authorization = await authorize(request, "settings.manage");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const [seasons, products, media] = await Promise.all([
    prisma.season.findMany({ orderBy: { year: "desc" } }),
    prisma.product.findMany({
      include: {
        season: true,
        media: true,
        options: true,
        restrictedAddons: { include: { addOnProduct: true } },
      },
      orderBy: [{ season: { year: "desc" } }, { name: "asc" }],
    }),
    prisma.mediaAsset.findMany({ orderBy: { createdAt: "desc" } }),
  ]);
  return NextResponse.json({ seasons, products, media });
}

export async function POST(request: Request) {
  const authorization = await authorize(request, "settings.manage");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });

  const parsed = productSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid season, SKU, name, and price." }, { status: 400 });
  const { id, restrictedAddons, ...product } = parsed.data;
  if (restrictedAddons && new Set(restrictedAddons.map((addOn) => addOn.addOnProductId)).size !== restrictedAddons.length) {
    return NextResponse.json({ error: "Choose each add-on only once." }, { status: 400 });
  }
  if (id && restrictedAddons?.some((addOn) => addOn.addOnProductId === id)) {
    return NextResponse.json({ error: "A product cannot be its own add-on." }, { status: 400 });
  }
  if (restrictedAddons?.length) {
    const addOnCount = await prisma.product.count({
      where: { id: { in: restrictedAddons.map((addOn) => addOn.addOnProductId) }, kind: "ADD_ON" },
    });
    if (addOnCount !== restrictedAddons.length) {
      return NextResponse.json({ error: "Only existing add-on products can be linked." }, { status: 400 });
    }
  }

  const relationUpdate = restrictedAddons
    ? { restrictedAddons: { deleteMany: {}, create: restrictedAddons } }
    : {};
  try {
    const saved = id
      ? await prisma.product.update({ where: { id }, data: { ...product, ...relationUpdate }, include: { media: true } })
      : await prisma.product.create({ data: { ...product, ...relationUpdate }, include: { media: true } });
    return NextResponse.json({ product: saved }, { status: id ? 200 : 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A product with this SKU already exists for that season." }, { status: 409 });
    }
    console.error("Unable to save catalog product.", error);
    return NextResponse.json({ error: "Unable to save this catalog product. Please try again." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const authorization = await authorize(request, "settings.manage");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid catalog product is required." }, { status: 400 });
  try {
    await prisma.product.delete({ where: { id: parsed.data.id } });
    return NextResponse.json({ message: "Catalog product deleted." });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "That catalog product no longer exists." }, { status: 404 });
    }
    console.error("Unable to delete catalog product.", error);
    return NextResponse.json({ error: "Unable to delete this catalog product. Please try again." }, { status: 500 });
  }
}
