import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { maskError } from "@/lib/result";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const env = getEnv();
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({
      ok: true,
      db: "ok",
      authMode: env.AUTH_MODE,
      webPort: env.WEB_PORT,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, db: "error", error: maskError(error) },
      { status: 503 },
    );
  }
}
