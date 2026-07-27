import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createRepeatDraft } from "@/lib/repeat-orders";
import { authorize, hasSameOrigin } from "@/lib/route-auth";

const singleSchema = z.object({ action: z.literal("single"), sourceOrderId: z.string().cuid(), targetSeasonId: z.string().cuid() });
const bulkSchema = z.object({ action: z.literal("bulk"), customerIds: z.array(z.string().cuid()).min(1).max(25), targetSeasonId: z.string().cuid() });
const postSchema = z.discriminatedUnion("action", [singleSchema, bulkSchema]);
const bulkRepeatConcurrency = 5;

type BulkRepeatOutcome = {
  customerId: string;
  sourceOrderId: string;
  draftId?: string;
  error?: string;
};

async function createBulkRepeatDrafts(sourceOrders: Array<[string, string]>, targetSeasonId: string) {
  const outcomes: BulkRepeatOutcome[] = [];
  for (let index = 0; index < sourceOrders.length; index += bulkRepeatConcurrency) {
    const batch = sourceOrders.slice(index, index + bulkRepeatConcurrency);
    const settled = await Promise.allSettled(batch.map(async ([customerId, sourceOrderId]) => ({
      customerId,
      sourceOrderId,
      draftId: (await createRepeatDraft(sourceOrderId, targetSeasonId)).id,
    })));
    outcomes.push(...settled.map((outcome, batchIndex) => outcome.status === "fulfilled"
      ? outcome.value
      : {
        customerId: batch[batchIndex]![0],
        sourceOrderId: batch[batchIndex]![1],
        error: outcome.reason instanceof Error ? outcome.reason.message : "Unable to prepare this customer's repeat draft.",
      }));
  }
  return outcomes;
}

export async function POST(request: Request) {
  const authorization = await authorize(request, "orders.write");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a target season and prior customer orders." }, { status: 400 });
  try {
    if (parsed.data.action === "single") {
      const draft = await createRepeatDraft(parsed.data.sourceOrderId, parsed.data.targetSeasonId);
      await prisma.auditEvent.create({ data: { actorId: authorization.staffMember.id, action: "order.repeated_by_staff", subjectId: draft.id, details: { sourceOrderId: parsed.data.sourceOrderId } } });
      return NextResponse.json({ draftId: draft.id }, { status: 201 });
    }
    const sourceOrders = await prisma.order.findMany({
      where: { customerId: { in: parsed.data.customerIds }, status: "FINALIZED" },
      orderBy: { updatedAt: "desc" },
      select: { id: true, customerId: true },
    });
    const latestByCustomer = new Map<string, string>();
    for (const sourceOrder of sourceOrders) if (sourceOrder.customerId && !latestByCustomer.has(sourceOrder.customerId)) latestByCustomer.set(sourceOrder.customerId, sourceOrder.id);
    const outcomes = await createBulkRepeatDrafts([...latestByCustomer.entries()], parsed.data.targetSeasonId);
    const created = outcomes.filter((outcome) => outcome.draftId);
    const failed = outcomes.filter((outcome) => outcome.error);
    await prisma.auditEvent.createMany({
      data: [
        ...failed.map((outcome) => ({
          actorId: authorization.staffMember.id,
          action: "order.bulk_repeat_failed",
          subjectId: outcome.sourceOrderId,
          details: { customerId: outcome.customerId, targetSeasonId: parsed.data.targetSeasonId, error: outcome.error },
        })),
        {
          actorId: authorization.staffMember.id,
          action: "orders.bulk_repeated",
          details: {
            customerIds: parsed.data.customerIds,
            requested: parsed.data.customerIds.length,
            matched: latestByCustomer.size,
            created: created.length,
            failed: failed.length,
            targetSeasonId: parsed.data.targetSeasonId,
          },
        },
      ],
    });
    return NextResponse.json(
      { draftIds: created.map((outcome) => outcome.draftId), created: created.length, failed },
      { status: failed.length > 0 ? 207 : 200 },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to prepare repeat drafts." }, { status: 400 });
  }
}
