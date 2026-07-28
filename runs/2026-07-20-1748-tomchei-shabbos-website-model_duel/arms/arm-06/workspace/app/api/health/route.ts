import { NextResponse } from "next/server";
// Side-effect import: validates env at boot; a bad value crashes startup
// with a clear message before this route ever serves. Internal auth-mode
// flags are deliberately not exposed in the payload.
import "@/lib/env";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: "up", env: "ok" });
  } catch {
    return NextResponse.json({ ok: false, db: "down", env: "ok" }, { status: 503 });
  }
}
