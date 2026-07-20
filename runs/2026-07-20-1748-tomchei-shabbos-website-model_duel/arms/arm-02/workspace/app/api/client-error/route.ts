import { z } from "zod";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const clientErrorSchema = z.object({
  message: z.string().max(500),
  path: z.string().max(200),
});

// Log forging defense: strip control characters (incl. CR/LF) so a report
// cannot inject fake log lines or terminal escapes.
function sanitize(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, " ");
}

// Bounded, redacted client-error intake (R-132/R-191): accepts a short message + path only,
// so no user data or stack internals land in server logs. Volume-bounded per IP.
export async function POST(request: Request) {
  if (!rateLimit(`client-error:${clientIp(request)}`, 10, 60 * 1000)) {
    return Response.json({ error: "Too many reports" }, { status: 429 });
  }

  const parsed = clientErrorSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid error report" }, { status: 400 });

  console.error(`[client-error] ${sanitize(parsed.data.path)}: ${sanitize(parsed.data.message)}`);
  return Response.json({ ok: true });
}
