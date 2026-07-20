import { createHash } from "node:crypto";
import { db } from "@/lib/db";

const PUBLIC_WRITE_LIMIT_PER_MINUTE = 30;

export class PublicRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PublicRequestError";
  }
}

export async function guardPublicWrite(request: Request, action: string) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = origin ? new URL(origin).host : null;
  } catch {
    originHost = null;
  }
  if (!host || originHost !== host) {
    throw new PublicRequestError("This request must come from the ordering site.", 403);
  }

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const source = forwardedFor || request.headers.get("x-real-ip") || "unknown";
  const key = createHash("sha256")
    .update(`${action}:${source}`)
    .digest("hex");
  const windowStartedAt = new Date(Date.now() - 60_000);
  const rows = await db.$queryRaw<{ attempts: number }[]>`
    INSERT INTO "PublicRequestThrottle" ("key", "windowStartedAt", "attempts", "updatedAt")
    VALUES (${key}, CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("key") DO UPDATE SET
      "attempts" = CASE
        WHEN "PublicRequestThrottle"."windowStartedAt" < ${windowStartedAt} THEN 1
        ELSE "PublicRequestThrottle"."attempts" + 1
      END,
      "windowStartedAt" = CASE
        WHEN "PublicRequestThrottle"."windowStartedAt" < ${windowStartedAt}
          THEN CURRENT_TIMESTAMP
        ELSE "PublicRequestThrottle"."windowStartedAt"
      END,
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "attempts"
  `;
  if ((rows[0]?.attempts ?? PUBLIC_WRITE_LIMIT_PER_MINUTE + 1) > PUBLIC_WRITE_LIMIT_PER_MINUTE) {
    throw new PublicRequestError("Too many checkout requests. Try again in a minute.", 429);
  }
}

export function publicRequestErrorResponse(error: unknown) {
  if (error instanceof PublicRequestError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  throw error;
}
