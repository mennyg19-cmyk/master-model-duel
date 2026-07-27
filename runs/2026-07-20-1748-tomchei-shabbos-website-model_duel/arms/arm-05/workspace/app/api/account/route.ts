import { NextResponse } from "next/server";
import { getAccount } from "@/lib/order-builder";

export async function GET(request: Request) {
  const account = await getAccount(request);
  if (!account) return NextResponse.json({ error: "Sign in to view your account." }, { status: 401 });
  return NextResponse.json({ account });
}
