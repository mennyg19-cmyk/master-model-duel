import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import { autoOpenScheduledSeasons } from "@/lib/seasons";

export async function POST(request: Request) {
  const unauthorized = authorizeCron(request);
  if (unauthorized) return unauthorized;
  return NextResponse.json({ opened: await autoOpenScheduledSeasons() });
}
