import { NextResponse } from "next/server";
import { z } from "zod";
import { createPackageLabel, packageShippingSummary, refreshPackageTracking, validatePackageAddress, voidPackageLabel } from "@/lib/shipping";
import { authorize, hasSameOrigin } from "@/lib/route-auth";

type RouteContext = { params: Promise<{ packageId: string }> };

const actionSchema = z.object({
  action: z.enum(["create_label", "void_label", "refresh_tracking", "validate_address"]),
});

export async function GET(request: Request, context: RouteContext) {
  const authorization = await authorize(request, "orders.read");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { packageId } = await context.params;
  return NextResponse.json({ shipments: await packageShippingSummary(packageId, authorization.staffMember.role === "MANAGER") });
}

export async function POST(request: Request, context: RouteContext) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid shipping action." }, { status: 400 });
  const permission = ["validate_address", "refresh_tracking"].includes(parsed.data.action) ? "orders.read" : "orders.write";
  const authorization = await authorize(request, permission);
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const { packageId } = await context.params;
  try {
    if (parsed.data.action === "create_label") {
      return NextResponse.json({ shipment: await createPackageLabel(packageId, authorization.staffMember.id) });
    }
    if (parsed.data.action === "void_label") {
      await voidPackageLabel(packageId, authorization.staffMember.id);
      return NextResponse.json({ voided: true });
    }
    if (parsed.data.action === "refresh_tracking") {
      return NextResponse.json({ tracking: await refreshPackageTracking(packageId, authorization.staffMember.id) });
    }
    return NextResponse.json({ validation: await validatePackageAddress(packageId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Shipping action could not be completed." }, { status: 400 });
  }
}
