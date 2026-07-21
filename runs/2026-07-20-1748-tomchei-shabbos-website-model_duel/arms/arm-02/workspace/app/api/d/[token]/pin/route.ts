import { z } from "zod";
import { cookies } from "next/headers";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { loadLinkByToken, pinCookieName, pinCookieValue, verifyPin } from "@/lib/routes/links";

const schema = z.object({ pin: z.string().regex(/^\d{4}$/) });

/**
 * Driver PIN gate (UR-015). Wrong tries are throttled twice over: per-link
 * lockout in the DB (5 tries -> 15 min) and a per-IP rate limit in front.
 */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!rateLimit(`route-pin:${clientIp(request)}`, 20, 60_000)) {
    return Response.json({ error: "Too many tries — wait a minute" }, { status: 429 });
  }

  const access = await loadLinkByToken(token);
  if (!access.ok) return Response.json({ error: "This link is no longer active" }, { status: 404 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter the 4-digit PIN" }, { status: 400 });

  const check = await verifyPin(access.link.id, parsed.data.pin);
  if (!check.ok) {
    if (check.noPin) {
      return Response.json({ error: "This link has no PIN — open it directly" }, { status: 400 });
    }
    return Response.json(
      {
        error: check.locked
          ? "Too many wrong PINs — this link is locked for 15 minutes"
          : `Wrong PIN — ${check.attemptsLeft} tr${check.attemptsLeft === 1 ? "y" : "ies"} left`,
      },
      { status: check.locked ? 429 : 401 }
    );
  }

  const cookieStore = await cookies();
  cookieStore.set(pinCookieName(access.link.id), pinCookieValue(access.link.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 24 * 3600,
  });
  return Response.json({ ok: true });
}
