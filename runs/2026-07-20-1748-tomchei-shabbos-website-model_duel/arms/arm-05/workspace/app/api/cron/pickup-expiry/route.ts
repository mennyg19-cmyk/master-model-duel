import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import { expirePickupPackages } from "@/lib/delivery";

export async function POST(request: Request) {
  const rejected = authorizeCron(request);
  if (rejected) return rejected;
  return NextResponse.json({ expired: await expirePickupPackages() });
}
