import { db } from "@/lib/db";
import { requirePermissionApi } from "@/lib/auth/current-user";

/** Subscriber directory for the hub, newest first, optional email search. */
export async function GET(request: Request) {
  const gate = await requirePermissionApi("email.manage");
  if ("response" in gate) return gate.response;

  const query = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
  const subscribers = await db.newsletterSubscriber.findMany({
    where: query ? { email: { contains: query } } : undefined,
    orderBy: { subscribedAt: "desc" },
    take: 200,
    include: { listMemberships: { include: { list: { select: { name: true } } } } },
  });
  const counts = {
    subscribed: await db.newsletterSubscriber.count({ where: { status: "SUBSCRIBED" } }),
    unsubscribed: await db.newsletterSubscriber.count({ where: { status: "UNSUBSCRIBED" } }),
  };
  return Response.json({ subscribers, counts });
}
