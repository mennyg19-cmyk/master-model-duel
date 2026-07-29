import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/parse-body";
import { checkPin, DRIVER_PIN_COOKIE, issuePinCookie, loadLinkByToken } from "@/lib/routes/links";

export const dynamic = "force-dynamic";

const pinSchema = z.object({ pin: z.string().regex(/^\d{4}$/) });

// UR-015 PIN verify: throttled server-side (5 misses locks for 10 minutes),
// success issues an HMAC cookie bound to this link and its expiry — never a
// general pass for other routes.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = await parseBody(request, pinSchema, "A 4-digit PIN is required");
  if (!parsed.ok) return parsed.response;

  const { state, link } = await loadLinkByToken(token);
  if (state !== "active" || !link) {
    const status = state === "invalid" ? 404 : 410;
    return NextResponse.json({ error: "Link is not active", state }, { status });
  }
  if (!link.pinHash) {
    return NextResponse.json({ ok: true, pinRequired: false });
  }

  const check = await checkPin(link.id, parsed.data.pin);
  if (check.outcome === "locked") {
    return NextResponse.json({ error: "Too many attempts — link locked", retryAt: check.retryAt.toISOString() }, { status: 429 });
  }
  if (check.outcome === "failed") {
    return NextResponse.json({ error: "Wrong PIN", attemptsLeft: check.attemptsLeft }, { status: 403 });
  }

  const cookieValue = await issuePinCookie(link.id, link.expiresAt);
  const response = NextResponse.json({ ok: true, pinRequired: false });
  response.cookies.set(DRIVER_PIN_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: link.expiresAt,
    path: "/",
  });
  return response;
}
