import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";

export async function GET() {
  const gate = await requirePermissionApi("email.manage");
  if ("response" in gate) return gate.response;

  const campaigns = await db.campaign.findMany({
    orderBy: { createdAt: "desc" },
    include: { list: { select: { name: true } } },
  });
  return Response.json({ campaigns });
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(50_000),
  listId: z.string().nullable().default(null),
});

export async function POST(request: Request) {
  const gate = await requirePermissionApi("email.manage");
  if ("response" in gate) return gate.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });

  if (parsed.data.listId) {
    const list = await db.emailList.findUnique({ where: { id: parsed.data.listId } });
    if (!list) return Response.json({ error: "List not found" }, { status: 404 });
  }
  const campaign = await db.campaign.create({
    data: { ...parsed.data, createdByStaffId: gate.staff.realUser.id },
  });
  await writeAudit(gate.staff, { action: "email.campaign.create", targetType: "Campaign", targetId: campaign.id });
  return Response.json({ ok: true, campaignId: campaign.id });
}
