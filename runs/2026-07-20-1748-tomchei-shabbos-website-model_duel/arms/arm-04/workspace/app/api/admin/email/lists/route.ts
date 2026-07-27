import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";

export async function GET() {
  const gate = await requirePermissionApi("email.manage");
  if ("response" in gate) return gate.response;

  const lists = await db.emailList.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { members: true } } },
  });
  return Response.json({ lists });
}

const createSchema = z.object({ name: z.string().min(1).max(120) });

export async function POST(request: Request) {
  const gate = await requirePermissionApi("email.manage");
  if ("response" in gate) return gate.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a list name" }, { status: 400 });

  try {
    const list = await db.emailList.create({ data: { name: parsed.data.name } });
    await writeAudit(gate.staff, { action: "email.list.create", targetType: "EmailList", targetId: list.id });
    return Response.json({ ok: true, listId: list.id });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return Response.json({ error: "A list with that name already exists" }, { status: 409 });
    }
    throw error;
  }
}
