import { db } from "@/lib/db";
import { env } from "@/lib/env";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({
      status: "ok",
      database: "connected",
      authMode: env.AUTH_MODE,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Detail stays server-side: raw Prisma/Postgres messages leak host/port/db
    // names, and this endpoint is public.
    console.error("[health] database check failed:", error);
    return Response.json({ status: "error", database: "unreachable" }, { status: 503 });
  }
}
