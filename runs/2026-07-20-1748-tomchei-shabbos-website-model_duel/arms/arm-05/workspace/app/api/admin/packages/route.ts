import { NextResponse } from "next/server";
import { z } from "zod";
import { advancePackageStatus, materializeOrderPackages, packageDashboard, regroupPackages, splitPackage, updatePackageStatuses } from "@/lib/package-operations";
import { authorize, hasSameOrigin } from "@/lib/route-auth";

const statusSchema = z.enum(["PRINTED", "PACKED", "SENT", "PICKED_UP"]);
const versionSchema = z.number().int().positive();
const regroupSchema = z.object({
  action: z.literal("regroup"),
  packageIds: z.array(z.string().cuid()).min(2).max(25),
  versions: z.record(z.string(), versionSchema),
});
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("materialize"), orderId: z.string().cuid() }),
  z.object({ action: z.literal("advance"), packageId: z.string().cuid(), version: versionSchema, status: statusSchema }),
  z.object({
    action: z.literal("bulk_status"),
    packageIds: z.array(z.string().cuid()).min(1).max(100),
    versions: z.record(z.string(), versionSchema),
    status: statusSchema,
  }),
  z.object({ action: z.literal("split"), packageId: z.string().cuid(), version: versionSchema }),
  regroupSchema,
]);

export async function GET(request: Request) {
  const authorization = await authorize(request, "orders.read");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const requestedPage = Number(new URL(request.url).searchParams.get("page"));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  return NextResponse.json(await packageDashboard(page));
}

export async function POST(request: Request) {
  const authorization = await authorize(request, "orders.write");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid package operation." }, { status: 400 });
  try {
    if (parsed.data.action === "materialize") {
      return NextResponse.json({ packages: await materializeOrderPackages(parsed.data.orderId, authorization.staffMember.id) });
    }
    if (parsed.data.action === "advance") {
      await advancePackageStatus(parsed.data.packageId, parsed.data.version, parsed.data.status, authorization.staffMember.id);
      return NextResponse.json({ updated: true });
    }
    if (parsed.data.action === "bulk_status") {
      const bulk = parsed.data;
      if (bulk.packageIds.some((packageId) => bulk.versions[packageId] === undefined)) {
        return NextResponse.json({ error: "Provide a version for every package." }, { status: 400 });
      }
      return NextResponse.json({
        outcomes: await updatePackageStatuses(bulk.packageIds, bulk.versions, bulk.status, authorization.staffMember.id),
      });
    }
    if (parsed.data.action === "split") {
      return NextResponse.json({ package: await splitPackage(parsed.data.packageId, parsed.data.version, authorization.staffMember.id) });
    }
    const regroup = regroupSchema.safeParse(parsed.data);
    if (!regroup.success) {
      return NextResponse.json({ error: "Provide a valid package operation." }, { status: 400 });
    }
    if (regroup.data.packageIds.some((packageId) => regroup.data.versions[packageId] === undefined)) {
      return NextResponse.json({ error: "Provide a version for every package." }, { status: 400 });
    }
    return NextResponse.json({ package: await regroupPackages(regroup.data.packageIds, regroup.data.versions, authorization.staffMember.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Package operation could not be completed." }, { status: 400 });
  }
}
