import { NextResponse } from "next/server";
import { getAccount } from "@/lib/order-builder";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const account = await getAccount(request);
  if (!account) return NextResponse.json({ error: "Sign in to view your account." }, { status: 401 });
  const openSeason = await prisma.season.findFirst({
    where: { status: "OPEN" },
    orderBy: { year: "desc" },
    select: { id: true, name: true },
  });
  return NextResponse.json({ account, openSeason });
}
