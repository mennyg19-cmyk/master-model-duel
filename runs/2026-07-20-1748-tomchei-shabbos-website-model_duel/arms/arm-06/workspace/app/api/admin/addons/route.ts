import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { slugify } from "@/lib/text";
import { dollarsToCents } from "@/lib/money";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().max(200).optional(),
  priceDollars: z.coerce.number().nonnegative(),
});

export async function GET() {
  const gate = await requireApiPermission("catalog.manage");
  if (!gate.ok) return gate.response;

  const addOns = await prisma.addOn.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ addOns });
}

// R-066: add-on create.
export async function POST(request: Request) {
  const gate = await requireApiPermission("catalog.manage");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, createSchema, "Name and price are required");
  if (!parsed.ok) return parsed.response;

  const priceCents = dollarsToCents(parsed.data.priceDollars);
  if (priceCents === null) {
    return NextResponse.json({ error: "Price must be a clean dollar-and-cents amount" }, { status: 400 });
  }

  const slug = parsed.data.slug?.trim() || slugify(parsed.data.name);
  if (!slug) {
    return NextResponse.json({ error: "Name must produce a usable slug" }, { status: 400 });
  }
  const slugTaken = await prisma.addOn.findUnique({ where: { slug } });
  if (slugTaken) {
    return NextResponse.json({ error: "Another add-on already uses that slug" }, { status: 409 });
  }

  const addOn = await prisma.addOn.create({
    data: { slug, name: parsed.data.name.trim(), priceCents },
  });
  await recordAudit({
    ctx: gate.ctx,
    action: "addon_create",
    targetType: "AddOn",
    targetId: addOn.id,
    metadata: { slug: addOn.slug },
  });

  return NextResponse.json({ addOn }, { status: 201 });
}
