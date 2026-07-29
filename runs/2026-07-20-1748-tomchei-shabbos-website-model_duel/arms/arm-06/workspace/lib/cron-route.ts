import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { mapDomainError } from "@/lib/http-errors";

// The one cron-route skeleton (R-182): bearer gate → domain call →
// { ok: true, ...result } or the mapped domain error. A handler may return a
// NextResponse to short-circuit (e.g. the no-open-season 422). Auth or
// error-shape changes land here once instead of in seven route files.
export function cronRoute(handler: (request: Request) => Promise<object | NextResponse>) {
  return async (request: Request) => {
    if (!isCronAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
      const result = await handler(request);
      if (result instanceof NextResponse) return result;
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      const mapped = mapDomainError(error);
      if (mapped) return mapped;
      throw error;
    }
  };
}
