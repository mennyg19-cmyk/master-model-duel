import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1).max(160),
  line1: z.string().min(1).max(200),
  city: z.string().min(1).max(120),
  region: z.string().min(1).max(60),
  postalCode: z.string().regex(/^\d{5}$/, "ZIPs are 5 digits"),
});

// R-094 (Orders tab): pickup locations customers choose at checkout (P5).
export async function POST(request: Request) {
  const gate = await requireApiPermission("settings.manage");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, createSchema, "A name and full address are required");
  if (!parsed.ok) return parsed.response;

  const pickupLocation = await prisma.pickupLocation.create({
    data: {
      name: parsed.data.name.trim(),
      line1: parsed.data.line1.trim(),
      city: parsed.data.city.trim(),
      region: parsed.data.region.trim(),
      postalCode: parsed.data.postalCode,
    },
  });
  await recordAudit({
    ctx: gate.ctx,
    action: "settings_update",
    targetType: "PickupLocation",
    targetId: pickupLocation.id,
    metadata: { name: pickupLocation.name },
  });

  return NextResponse.json({ pickupLocation }, { status: 201 });
}
