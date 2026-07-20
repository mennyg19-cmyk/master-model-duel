import { NextResponse } from "next/server";
import { findAccessibleDraft } from "@/lib/customer-access";
import { db } from "@/lib/db";

export async function POST(
  request: Request,
  context: { params: Promise<{ draftId: string }> },
) {
  const { draftId } = await context.params;
  const accessibleDraft = await findAccessibleDraft(request, draftId);
  if (!accessibleDraft) {
    return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  }

  await db.order.update({
    where: { id: accessibleDraft.id },
    data: { guestAccessTokenHash: null, guestAccessExpiresAt: null },
  });
  const response = NextResponse.json({ cleared: true });
  response.cookies.set("draft_access_token", "", {
    httpOnly: true,
    sameSite: "lax",
    expires: new Date(0),
    path: "/",
  });
  return response;
}
