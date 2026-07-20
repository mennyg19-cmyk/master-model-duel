import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import {
  createGuestDraftAccess,
  getAuthenticatedCustomer,
} from "@/lib/customer-access";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/normalize";
import { getCurrentSeason } from "@/lib/storefront";

export async function POST(request: Request) {
  const season = await getCurrentSeason();
  if (!season || season.status !== "OPEN") {
    return NextResponse.json({ error: "Ordering is closed for the current season." }, { status: 409 });
  }

  const account = await getAuthenticatedCustomer();
  const body = (await request.json().catch(() => ({}))) as {
    displayName?: string;
    email?: string;
  };
  let customerId = account?.customerId ?? null;
  let guestAccess: ReturnType<typeof createGuestDraftAccess> | null = null;

  if (!customerId) {
    guestAccess = createGuestDraftAccess();
    const guestCustomer = await db.customer.create({
      data: {
        displayName: body.displayName?.trim() || "Guest customer",
        email: body.email?.trim() || null,
        emailNormalized: body.email ? normalizeEmail(body.email) : null,
      },
    });
    customerId = guestCustomer.id;
  }

  const order = await db.order.create({
    data: {
      seasonId: season.id,
      customerId,
      draftReference: `D-${randomInt(1, 100_000_000).toString().padStart(8, "0")}`,
      guestAccessTokenHash: guestAccess?.tokenHash,
      guestAccessExpiresAt: guestAccess?.expiresAt,
    },
  });
  const response = NextResponse.json(
    { order, accessToken: guestAccess?.token ?? null },
    { status: 201 },
  );
  if (guestAccess) {
    response.cookies.set("draft_access_token", guestAccess.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      expires: guestAccess.expiresAt,
      path: "/",
    });
  }
  return response;
}
