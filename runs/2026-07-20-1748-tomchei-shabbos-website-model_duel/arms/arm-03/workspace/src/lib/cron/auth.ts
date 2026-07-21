import { timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/api-error";

/** R-182 — cron endpoints require Authorization: Bearer <CRON_SECRET>. */
export function requireCronBearer(request: Request): void {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    throw new ApiError("CRON_SECRET is not configured", 503);
  }
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const provided = match?.[1] ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApiError("Unauthorized cron request", 401);
  }
}
