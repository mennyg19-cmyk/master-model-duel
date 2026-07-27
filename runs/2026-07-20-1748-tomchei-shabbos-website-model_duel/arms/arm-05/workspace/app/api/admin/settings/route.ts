import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorize, hasSameOrigin } from "@/lib/route-auth";
import { defaultDeliveryZipCodes } from "@/lib/storefront";

const settingsSchema = z.object({
  deliveryZipCodes: z.array(z.string().regex(/^\d{5}(-\d{4})?$/)).min(1).max(200),
  storeStatus: z.enum(["OPEN", "CLOSED"]),
});

export async function GET(request: Request) {
  const authorization = await authorize(request, "settings.manage");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const [zipCodes, currentSeason] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: "delivery.zipCodes" } }),
    prisma.season.findFirst({ orderBy: { year: "desc" } }),
  ]);
  return NextResponse.json({
    deliveryZipCodes: Array.isArray(zipCodes?.value) ? zipCodes.value : defaultDeliveryZipCodes,
    storeStatus: currentSeason?.status ?? "CLOSED",
  });
}

export async function PUT(request: Request) {
  const authorization = await authorize(request, "settings.manage");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });

  const parsed = settingsSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter one or more valid delivery ZIP codes." }, { status: 400 });

  const currentSeason = await prisma.season.findFirst({ orderBy: { year: "desc" } });
  await prisma.$transaction([
    prisma.appSetting.upsert({
      where: { key: "delivery.zipCodes" },
      create: { key: "delivery.zipCodes", value: parsed.data.deliveryZipCodes },
      update: { value: parsed.data.deliveryZipCodes },
    }),
    ...(currentSeason ? [prisma.season.update({
      where: { id: currentSeason.id },
      data: { status: parsed.data.storeStatus },
    })] : []),
  ]);
  return NextResponse.json(parsed.data);
}
