import { createHash, randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { formatDraftReference } from "@/domain/order-engine";
import { requirePermission } from "@/lib/auth";
import {
  createGuestDraftAccess,
  getAuthenticatedCustomer,
  getDraftAccessToken,
  hashDraftAccessToken,
} from "@/lib/customer-access";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/normalize";
import { getCurrentSeason } from "@/lib/storefront";

const GUEST_DRAFT_LIMIT_PER_MINUTE = 10;

async function enforceGuestDraftLimit(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const source = forwardedFor || request.headers.get("x-real-ip") || "unknown";
  const key = createHash("sha256").update(source).digest("hex");
  const windowStartedAt = new Date(Date.now() - 60_000);
  const rows = await db.$queryRaw<{ attempts: number }[]>`
    INSERT INTO "GuestDraftThrottle" ("key", "windowStartedAt", "attempts", "updatedAt")
    VALUES (${key}, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("key") DO UPDATE SET
      "attempts" = CASE
        WHEN "GuestDraftThrottle"."windowStartedAt" < ${windowStartedAt} THEN 1
        ELSE "GuestDraftThrottle"."attempts" + 1
      END,
      "windowStartedAt" = CASE
        WHEN "GuestDraftThrottle"."windowStartedAt" < ${windowStartedAt}
          THEN CURRENT_TIMESTAMP
        ELSE "GuestDraftThrottle"."windowStartedAt"
      END,
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "attempts"
  `;
  if ((rows[0]?.attempts ?? GUEST_DRAFT_LIMIT_PER_MINUTE + 1) > GUEST_DRAFT_LIMIT_PER_MINUTE) {
    throw new Error("GUEST_DRAFT_RATE_LIMIT");
  }
}

export async function POST(request: Request) {
  const season = await getCurrentSeason();
  if (!season || season.status !== "OPEN") {
    return NextResponse.json({ error: "Ordering is closed for the current season." }, { status: 409 });
  }

  const account = await getAuthenticatedCustomer();
  const body = (await request.json().catch(() => ({}))) as {
    displayName?: string;
    email?: string;
    posCustomerId?: string;
  };
  let customerId = account?.customerId ?? null;
  let guestAccess: ReturnType<typeof createGuestDraftAccess> | null = null;

  if (body.posCustomerId) {
    await requirePermission("admin:view");
    const posCustomer = await db.customer.findUnique({
      where: { id: body.posCustomerId },
      select: { id: true },
    });
    if (!posCustomer) {
      return NextResponse.json({ error: "POS customer was not found." }, { status: 404 });
    }
    customerId = posCustomer.id;
  }

  if (!customerId) {
    const existingToken = getDraftAccessToken(request);
    if (existingToken) {
      const existingOrder = await db.order.findFirst({
        where: {
          seasonId: season.id,
          status: "DRAFT",
          guestAccessTokenHash: hashDraftAccessToken(existingToken),
          guestAccessExpiresAt: { gt: new Date() },
        },
      });
      if (existingOrder) {
        return NextResponse.json({ order: existingOrder });
      }
    }
    try {
      await enforceGuestDraftLimit(request);
    } catch (error) {
      if (error instanceof Error && error.message === "GUEST_DRAFT_RATE_LIMIT") {
        return NextResponse.json(
          { error: "Too many guest drafts were started. Try again in a minute." },
          { status: 429 },
        );
      }
      throw error;
    }
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
      draftReference: formatDraftReference(randomInt(1, 100_000_000)),
      guestAccessTokenHash: guestAccess?.tokenHash,
      guestAccessExpiresAt: guestAccess?.expiresAt,
    },
  });
  const response = NextResponse.json(
    { order },
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
