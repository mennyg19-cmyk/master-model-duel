import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isClerkConfigured } from "@/lib/env";

export async function GET() {
  const startedAt = performance.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      database: "ok",
      auth: isClerkConfigured() ? "clerk" : "local-development",
      latencyMs: Math.round(performance.now() - startedAt),
    });
  } catch {
    return NextResponse.json(
      {
        status: "error",
        database: "unavailable",
        message: "The PostgreSQL health check failed.",
      },
      { status: 503 },
    );
  }
}
