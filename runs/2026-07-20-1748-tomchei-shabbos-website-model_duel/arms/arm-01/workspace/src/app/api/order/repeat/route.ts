import { NextResponse } from "next/server";
import { z } from "zod";
import { createRepeatDraft } from "@/domain/repeat-orders";
import { getAuthenticatedCustomer } from "@/lib/customer-access";
import { db } from "@/lib/db";
import { getCurrentSeason } from "@/lib/storefront";

const repeatSchema = z.object({
  sourceOrderId: z.string().min(1),
  sourceVersion: z.number().int().positive(),
  decisions: z.array(
    z.object({
      sourceLineId: z.string().min(1),
      productId: z.string().min(1).nullable(),
      recipientAddressId: z.string().min(1),
    }),
  ),
});

export async function POST(request: Request) {
  const account = await getAuthenticatedCustomer();
  if (!account?.customerId) {
    return NextResponse.json({ error: "Customer sign-in is required." }, { status: 401 });
  }
  const parsed = repeatSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Confirm every replacement and recipient." },
      { status: 400 },
    );
  }
  const source = await db.order.findFirst({
    where: {
      id: parsed.data.sourceOrderId,
      customerId: account.customerId,
      status: "FINALIZED",
    },
    select: { id: true },
  });
  if (!source) {
    return NextResponse.json({ error: "Source order not found." }, { status: 404 });
  }
  const currentSeason = await getCurrentSeason();
  if (!currentSeason || currentSeason.status !== "OPEN") {
    return NextResponse.json(
      { error: "Ordering is closed for the current season." },
      { status: 409 },
    );
  }
  try {
    const draft = await createRepeatDraft(db, {
      ...parsed.data,
      actorCustomerId: account.customerId,
      actorClerkUserId: account.clerkUserId,
    });
    return NextResponse.json({ draftId: draft.id }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Order could not be repeated." },
      { status: 400 },
    );
  }
}
