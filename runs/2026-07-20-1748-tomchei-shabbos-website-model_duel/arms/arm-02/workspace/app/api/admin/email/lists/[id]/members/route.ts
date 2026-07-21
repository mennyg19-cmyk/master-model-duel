import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";

const memberSchema = z.object({
  email: z.string().email().max(254),
  action: z.enum(["add", "remove"]),
});

/** Add/remove one subscriber by email. Adding is upsert-quiet; both idempotent. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermissionApi("email.manage");
  if ("response" in gate) return gate.response;

  const { id } = await params;
  const parsed = memberSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a valid email address" }, { status: 400 });

  const list = await db.emailList.findUnique({ where: { id } });
  if (!list) return Response.json({ error: "List not found" }, { status: 404 });

  const email = parsed.data.email.toLowerCase();
  const subscriber = await db.newsletterSubscriber.findUnique({ where: { email } });
  if (!subscriber) {
    return Response.json({ error: "No newsletter subscriber with that address — they must subscribe first" }, { status: 404 });
  }

  if (parsed.data.action === "add") {
    await db.emailListMember.upsert({
      where: { listId_subscriberId: { listId: id, subscriberId: subscriber.id } },
      update: {},
      create: { listId: id, subscriberId: subscriber.id },
    });
  } else {
    await db.emailListMember.deleteMany({ where: { listId: id, subscriberId: subscriber.id } });
  }
  const memberCount = await db.emailListMember.count({ where: { listId: id } });
  return Response.json({ ok: true, memberCount });
}
