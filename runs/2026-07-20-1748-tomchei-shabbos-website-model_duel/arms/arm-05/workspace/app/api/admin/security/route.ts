import { NextResponse } from "next/server";
import { authorize } from "@/lib/route-auth";

export async function GET(request: Request) {
  const authorization = await authorize(request, "audit.read");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  return NextResponse.json({ auditsAvailable: true });
}
