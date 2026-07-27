import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorize, hasSameOrigin } from "@/lib/route-auth";

const createSeasonSchema = z.object({
  action: z.literal("create"),
  name: z.string().trim().min(3).max(120),
  year: z.number().int().min(2020).max(2100),
  opensAt: z.string().datetime().optional(),
});
const updateSeasonSchema = z.object({
  action: z.literal("update"),
  seasonId: z.string().cuid(),
  status: z.enum(["OPEN", "CLOSED"]),
  opensAt: z.string().datetime().nullable().optional(),
});
const mappingSchema = z.object({
  action: z.literal("map"),
  sourceProductId: z.string().cuid(),
  targetProductId: z.string().cuid(),
});
const postSchema = z.discriminatedUnion("action", [createSeasonSchema, updateSeasonSchema, mappingSchema]);

export async function GET(request: Request) {
  const authorization = await authorize(request, "settings.manage");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const [seasons, products] = await Promise.all([
    prisma.season.findMany({ orderBy: { year: "desc" } }),
    prisma.product.findMany({
      include: { season: { select: { name: true, year: true } }, replacementFrom: { include: { targetProduct: { include: { season: true } } } } },
      orderBy: [{ season: { year: "desc" } }, { name: "asc" }],
    }),
  ]);
  return NextResponse.json({ seasons, products });
}

export async function POST(request: Request) {
  const authorization = await authorize(request, "settings.manage");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide valid season or replacement details." }, { status: 400 });

  try {
    if (parsed.data.action === "create") {
      const season = await prisma.season.create({
        data: { name: parsed.data.name, year: parsed.data.year, status: "CLOSED", opensAt: parsed.data.opensAt ? new Date(parsed.data.opensAt) : null },
      });
      await prisma.auditEvent.create({ data: { actorId: authorization.staffMember.id, action: "season.created", subjectId: season.id, details: { year: season.year, opensAt: season.opensAt } } });
      return NextResponse.json({ season }, { status: 201 });
    }
    if (parsed.data.action === "update") {
      const season = await prisma.season.update({
        where: { id: parsed.data.seasonId },
        data: {
          status: parsed.data.status,
          opensAt: parsed.data.status === "CLOSED"
            ? null
            : parsed.data.opensAt !== undefined
              ? parsed.data.opensAt ? new Date(parsed.data.opensAt) : null
              : undefined,
        },
      });
      await prisma.auditEvent.create({ data: { actorId: authorization.staffMember.id, action: "season.status_changed", subjectId: season.id, details: { status: season.status, opensAt: season.opensAt } } });
      return NextResponse.json({ season });
    }

    const [source, target] = await Promise.all([
      prisma.product.findUnique({ where: { id: parsed.data.sourceProductId }, include: { season: true } }),
      prisma.product.findUnique({ where: { id: parsed.data.targetProductId }, include: { season: true } }),
    ]);
    if (!source || !target || source.id === target.id || source.season.year >= target.season.year) {
      return NextResponse.json({ error: "Map an older catalog item to a different item in a later season." }, { status: 400 });
    }
    const mapping = await prisma.productReplacement.upsert({
      where: { sourceProductId_targetProductId: { sourceProductId: source.id, targetProductId: target.id } },
      create: { sourceProductId: source.id, targetProductId: target.id },
      update: {},
    });
    await prisma.auditEvent.create({ data: { actorId: authorization.staffMember.id, action: "catalog.replacement_mapped", subjectId: mapping.id, details: { sourceProductId: source.id, targetProductId: target.id } } });
    return NextResponse.json({ mapping }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update the season." }, { status: 400 });
  }
}
