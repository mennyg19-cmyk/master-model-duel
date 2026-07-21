import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiErrorResponse } from "@/lib/api-error";
import { resolveCustomerId } from "@/lib/orders/draft-access";
import {
  draftInclude,
  getOrCreateActiveDraft,
  serializeDraft,
} from "@/lib/orders/drafts";
import {
  GUEST_DRAFT_COOKIE,
  guestDraftCookieOptions,
  guestTokenMatches,
} from "@/lib/orders/guest-token";
import { db } from "@/lib/db";
import { OrderStatus } from "@prisma/client";

function setGuestCookie(res: NextResponse, token: string) {
  res.cookies.set(GUEST_DRAFT_COOKIE, token, guestDraftCookieOptions());
}

/** GET current draft for signed-in customer or guest cookie. */
export async function GET() {
  try {
    const customerId = await resolveCustomerId();
    if (customerId) {
      const existing = await db.order.findFirst({
        where: { customerId, status: OrderStatus.DRAFT },
        include: draftInclude,
        orderBy: { updatedAt: "desc" },
      });
      if (!existing) {
        return NextResponse.json({ ok: true, draft: null });
      }
      return NextResponse.json({ ok: true, draft: serializeDraft(existing) });
    }

    const jar = await cookies();
    const token = jar.get(GUEST_DRAFT_COOKIE)?.value ?? null;
    if (!token) {
      return NextResponse.json({ ok: true, draft: null });
    }

    const candidates = await db.order.findMany({
      where: {
        customerId: null,
        status: OrderStatus.DRAFT,
        guestClearedAt: null,
        guestAccessTokenHash: { not: null },
      },
      include: draftInclude,
      orderBy: { updatedAt: "desc" },
      take: 25,
    });
    const match = candidates.find((o) =>
      guestTokenMatches(token, o.guestAccessTokenHash, o.guestTokenVersion),
    );
    if (!match) {
      return NextResponse.json({ ok: true, draft: null });
    }
    return NextResponse.json({ ok: true, draft: serializeDraft(match) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** POST create or resume draft. Body: { guest?: boolean } */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { guest?: boolean };
    const customerId = await resolveCustomerId();
    const jar = await cookies();
    const existingGuestToken = jar.get(GUEST_DRAFT_COOKIE)?.value ?? null;

    if (customerId) {
      const result = await getOrCreateActiveDraft({ customerId });
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
      }
      return NextResponse.json({
        ok: true,
        draft: result.value.draft,
        created: result.value.created,
      });
    }

    // Guest path (explicit guest or unsigned default) — dedupe by cookie token (M3).
    void body.guest;
    const result = await getOrCreateActiveDraft({
      asGuest: true,
      existingGuestToken,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.publicMessage }, { status: 409 });
    }
    const res = NextResponse.json({
      ok: true,
      draft: result.value.draft,
      created: result.value.created,
    });
    if (result.value.guestAccessToken) {
      setGuestCookie(res, result.value.guestAccessToken);
    }
    return res;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
