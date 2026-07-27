import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, database: { ok: true, adapter: "postgresql" } });
  } catch {
    return NextResponse.json(
      { ok: false, database: { ok: false, adapter: "postgresql" } },
      { status: 503 },
    );
  }
}
