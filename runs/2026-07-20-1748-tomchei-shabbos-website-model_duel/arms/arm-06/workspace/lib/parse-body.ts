import { NextResponse } from "next/server";
import { z } from "zod";

// Shared body parsing for JSON API routes: bad JSON or a schema miss is a
// 400 with the route-specific message.
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
  errorMessage: string,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, response: NextResponse.json({ error: errorMessage }, { status: 400 }) };
  }
  return { ok: true, data: parsed.data };
}
