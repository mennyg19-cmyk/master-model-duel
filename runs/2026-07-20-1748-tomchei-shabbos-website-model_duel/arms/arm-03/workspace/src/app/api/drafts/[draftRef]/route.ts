import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse } from "@/lib/api-error";
import { assertCanMutateDraft, loadDraftForAccess } from "@/lib/orders/draft-access";
import {
  cancelDraft,
  draftInclude,
  markGuestDraftSuccess,
  serializeDraft,
} from "@/lib/orders/drafts";
import { GUEST_DRAFT_COOKIE } from "@/lib/orders/guest-token";
import { db } from "@/lib/db";
import { OrderStatus } from "@prisma/client";

type Ctx = { params: Promise<{ draftRef: string }> };

export async function GET(request: Request, ctx: Ctx) {
  try {
    const { draftRef } = await ctx.params;
    const { order } = await loadDraftForAccess(draftRef);
    const full = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: draftInclude,
    });
    return NextResponse.json({ ok: true, draft: serializeDraft(full) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const patchSchema = z.object({
  action: z.enum(["cancel", "guest_success", "greeting"]),
  greetingDefault: z.string().max(500).optional(),
});

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { draftRef } = await ctx.params;
    const body = patchSchema.parse(await request.json());

    if (body.action === "guest_success") {
      // Must not use assertCanMutateDraft — order is PLACED after finalize.
      const { order, actor } = await loadDraftForAccess(draftRef);
      if (actor.kind !== "guest" && actor.kind !== "staff") {
        return NextResponse.json({ ok: false, error: "Guest draft required" }, { status: 400 });
      }
      if (order.status === OrderStatus.DRAFT) {
        return NextResponse.json(
          { ok: false, error: "Guest success requires a finalized (PLACED+) order." },
          { status: 409 },
        );
      }
      const result = await markGuestDraftSuccess(order.id);
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
      }
      const res = NextResponse.json({ ok: true, cleared: true, draftRef: result.value.draftRef });
      res.cookies.set(GUEST_DRAFT_COOKIE, "", { path: "/", maxAge: 0 });
      return res;
    }

    const { order, actor } = await assertCanMutateDraft(draftRef, request);

    if (body.action === "greeting") {
      await db.order.update({
        where: { id: order.id },
        data: { greetingDefault: body.greetingDefault ?? "", version: { increment: 1 } },
      });
      const full = await db.order.findUniqueOrThrow({
        where: { id: order.id },
        include: draftInclude,
      });
      return NextResponse.json({ ok: true, draft: serializeDraft(full) });
    }

    if (body.action === "cancel") {
      const result = await cancelDraft(order.id);
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
      }
      const res = NextResponse.json({ ok: true, cancelled: true, draftRef: result.value.draftRef });
      if (actor.kind === "guest") {
        res.cookies.set(GUEST_DRAFT_COOKIE, "", { path: "/", maxAge: 0 });
      }
      return res;
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
