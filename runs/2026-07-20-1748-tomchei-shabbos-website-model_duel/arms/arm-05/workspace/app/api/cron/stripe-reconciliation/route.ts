import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron-auth";
import { runStripeReconciliation } from "@/lib/reporting";

export async function GET(request: Request) {
  const rejected = authorizeCron(request);
  if (rejected) return rejected;
  return NextResponse.json(await runStripeReconciliation(null));
}

export const POST = GET;
